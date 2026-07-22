// api/submit-vault-contribution.js — keepsay-web
// Service-role write path for the Occasion Vault contributor page
// (vault/[token].html). Contributors never get a Supabase key — this
// endpoint validates token/window/storage and is the ONLY place an
// `event_contributions` row can be written.
//
// Depends on `event_vaults` + `event_contributions` (renamed from
// `wedding_vaults`/`vault_contributions` 2026-07-17 when the vault went
// occasion-generic; `honoree_name` replaced `couple_name`). DEPLOYED and
// live. Authoritative schema record: docs/sql/event_vault_schema.md in
// luminary-legacy (columns, FKs, indexes, RLS, and the
// increment_vault_storage function definition — that function was re-created
// at the rename, since a LANGUAGE sql text body does NOT follow a table
// rename). docs/wedding-vault-build-plan.md §3's SQL block is the
// pre-correction original draft — kept there for historical context only.
//
// ⚠️ SCHEMA ADDITIONS beyond the build-plan doc's original draft (confirmed
// live 2026-07-17, see docs/sql/wedding_vault_schema.md for the exact deployed
// definitions):
//   • `event_contributions.status text NOT NULL DEFAULT 'pending'`
//     (values: 'pending' | 'complete') — makes the init/finalize
//     reconciliation below possible — see api/cleanup-vault-uploads.js.
//   • A composite index on `event_contributions (status, submitted_at)` —
//     matches api/cleanup-vault-uploads.js's actual sweep query
//     (`.eq('status','pending').lt('submitted_at', cutoff)`) so that sweep
//     stays a fast indexed lookup instead of a growing table scan as
//     contributions accumulate. `submitted_at` is set EXPLICITLY by
//     handleInit below (see the comment there) rather than left to the
//     column's own `DEFAULT now()` — index the column the code actually
//     writes and the sweep actually filters on, not a column the schema
//     merely defaults.
//   • The `increment_vault_storage` Postgres RPC function used by
//     incrementStorageUsed below, confirmed live as SECURITY DEFINER with
//     SET search_path TO 'public' (properly hardened against the classic
//     mutable-search_path hijack risk — verify this stays true if the
//     function is ever recreated). `p_vault_id uuid` is correct:
//     event_vaults.id is NOT a user-reference column (it's this table's
//     own PK, never an FK to profiles.id), so it was unaffected by the
//     text-vs-uuid correction that applies to user-reference columns like
//     event_vaults.creator_user_id. The WHERE clause folds the "would this
//     exceed the limit" check INTO the atomic update (0 rows affected =
//     either the vault doesn't exist or the increment would have exceeded
//     storage_limit_mb) — no separate read step, no retry loop, no window
//     for a concurrent writer to clobber another's increment.
//
// ── Why this is a TWO-PHASE endpoint (init / finalize), not one POST
// carrying the recording bytes ─────────────────────────────────────────
// Vercel Serverless Functions hard-cap request body size at ~4.5MB,
// enforced at the platform's routing layer (not something bodyParser
// config can raise). A 3-minute browser-recorded video (webm/vp9, no
// bitrate cap set) can easily be 10s of MB — well over that limit — and
// the build plan itself flags "upload progress indicator critical for
// large video on slow connections," so this has to actually work for
// real video, not just short voice clips.
//
// So the flow is:
//   1. POST {action:'init', ...}     → validates token/window/storage,
//      writes a `status:'pending'` event_contributions row (see the
//      schema note above), and returns a short-lived, single-path
//      Supabase Storage signed UPLOAD URL. The contributor's browser
//      PUTs the recording BYTES directly to that URL (Supabase Storage),
//      never through this function — that's what makes large video
//      safe. This is still just a one-time, single-file-scoped URL, not
//      a reusable credential — it does not weaken "contributors never
//      get a Supabase key."
//   2. POST {action:'finalize', ...} → re-validates window/storage/
//      duration, confirms the object actually landed in storage, flips
//      that row's status to 'complete', and updates `storage_used_mb`.
// Both actions live in this one endpoint file.
//
// ── Orphan handling ─────────────────────────────────────────────────────
// If the guest closes the tab mid-upload (or finalize never runs for any
// reason), init's row stays 'pending' and its storage object (if any
// bytes made it up) is never referenced by a completed contribution.
// api/cleanup-vault-uploads.js (scheduled via the `crons` entry in
// vercel.json, same mechanism as api/r2-backup.js) sweeps rows still
// 'pending' after a staleness window and deletes both the row and any
// object at its `recording_url`.
//
// ── Known gap, not blocking a friends-and-family-scale launch ──────────
// This is a PUBLIC, unauthenticated write endpoint — the vault_token in
// the link IS the entire capability. There is no per-IP/per-token rate
// limit; the only backstop against a bad actor spamming contributions is
// the storage cap tripping (storage_full). Fine at wedding-guest-list
// scale; a future throttle (e.g. per-token submissions/hour) should be
// added before this is exposed to a larger/adversarial audience.

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const admin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const ALLOWED_ORIGIN = process.env.APP_ORIGIN || '*';
const BUCKET = 'memories'; // same bucket the app uses; vault recordings live under a vault-recordings/ prefix (per the build-plan schema comment)

// Locked caps (docs/wedding-vault-build-plan.md §2/§5) + a small grace window
// for client/network timing slack around the client-side auto-stop. This is
// the SERVER-SIDE bound — the 5:00/3:00 caps are also enforced by a
// client-side JS timer, but that's advisory only; a modified/malicious
// client could send any durationSeconds it wants, so both init AND finalize
// check every submitted duration against this, not just the client.
const CAPS = {
  voice: { seconds: 5 * 60, graceSeconds: 15 },
  video: { seconds: 3 * 60, graceSeconds: 15 },
};
const MAX_FILE_SIZE_MB = 1024; // sanity ceiling — anything past this is clearly bogus/tampered, not a real recording

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
}

// iOS Safari records video/mp4; Android Chrome records video/webm (voice is
// audio/webm;codecs=opus almost everywhere — see mediarecorder-test.html's
// device matrix). So `event_contributions.recording_url`/`recording_type`
// stores a MIX of containers from day one, by design — never assume every
// row shares one container/extension. Anything reading these rows for
// playback or a future format migration must branch on the actual stored
// extension/mimeType, not hardcode .webm or .mp4.
function extensionFor(recordingType, mimeType) {
  const mt = String(mimeType || '').toLowerCase();
  if (mt.indexOf('mp4') !== -1) return recordingType === 'video' ? 'mp4' : 'm4a';
  return 'webm';
}

// Shared validation for the fields both init and finalize write to the row —
// extracted so the two checks can't silently drift apart (the class of bug
// MAINTENANCE.md ST54/ST55 already flag for duplicated logic in this repo).
function validateDurationAndSize(recordingType, durationSeconds, fileSizeMb) {
  const duration = Number(durationSeconds);
  const sizeMb = Number(fileSizeMb);
  if (!(duration > 0) || !(sizeMb > 0) || sizeMb > MAX_FILE_SIZE_MB) {
    return { error: 'Invalid recording metadata' };
  }
  const cap = CAPS[recordingType];
  if (duration > cap.seconds + cap.graceSeconds) {
    return { error: 'Recording exceeds the allowed length' };
  }
  return { duration, sizeMb };
}

function validateContributor(contributorName, contributorEmail) {
  const name = String(contributorName || '').trim();
  if (!name || name.length > 60) {
    return { error: 'Name is required (60 characters max)' };
  }
  const email = String(contributorEmail || '').trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: 'That email doesn’t look right' };
  }
  return { name, email };
}

async function loadVault(token) {
  const { data: vault, error } = await admin
    .from('event_vaults')
    .select('id, vault_token, honoree_name, contribution_closes_at, unlocks_at, is_unlocked, storage_used_mb, storage_limit_mb')
    .eq('vault_token', token)
    .maybeSingle();
  if (error) throw error;
  return vault || null;
}

function windowOpen(vault) {
  // Only contribution_closes_at ends the window. Unlocking does NOT — the
  // locked unlock model (luminary-legacy STATE.md, 2026-07-18) is "new
  // messages arrive unsealed" after the couple opens, and the app's unlock
  // confirm promises exactly that. An earlier !vault.is_unlocked gate here
  // (mirrored in get-vault-info.js) silently rejected every guest submission
  // the moment a vault was opened (bug found live 2026-07-21).
  return new Date() < new Date(vault.contribution_closes_at);
}

// Atomic, single-round-trip storage increment via the increment_vault_storage
// Postgres RPC function (SQL in the schema-note comment block at the top of
// this file). Replaces an earlier JS compare-and-swap retry loop (read,
// then a conditionally-guarded update, retried on contention) — that loop
// WAS race-safe (a losing concurrent write matched zero rows and retried
// rather than clobbering, so it never actually undercounted), but it was
// two round trips per attempt. A single `UPDATE ... SET x = x + amount
// WHERE ... AND x + amount <= limit` folds the read, the add, the limit
// check, and the write into one atomic statement — no window for a
// concurrent writer to interleave, no retry loop needed.
async function incrementStorageUsed(vaultId, addMb) {
  const { data, error } = await admin.rpc('increment_vault_storage', {
    p_vault_id: vaultId,
    p_amount: addMb,
  });
  if (error) throw error;
  // The RPC's WHERE guard rejects the update (0 rows returned) when the
  // increment would exceed storage_limit_mb, or the vault no longer
  // exists — either way, nothing was written.
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { ok: false, reason: 'storage_full' };
  return { ok: true };
}

async function handleInit(req, res) {
  const { token, recordingType, durationSeconds, fileSizeMb, mimeType, contributorName, contributorEmail } = req.body || {};

  if (!token) return res.status(400).json({ error: 'Missing token' });
  if (recordingType !== 'voice' && recordingType !== 'video') {
    return res.status(400).json({ error: 'Invalid recordingType' });
  }
  const metaCheck = validateDurationAndSize(recordingType, durationSeconds, fileSizeMb);
  if (metaCheck.error) return res.status(400).json({ error: metaCheck.error });
  const { duration, sizeMb } = metaCheck;

  const contributorCheck = validateContributor(contributorName, contributorEmail);
  if (contributorCheck.error) return res.status(400).json({ error: contributorCheck.error });
  const { name, email } = contributorCheck;

  const vault = await loadVault(token);
  if (!vault) return res.status(404).json({ error: 'Vault not found', reason: 'invalid_token' });
  if (!windowOpen(vault)) {
    return res.status(409).json({ error: 'This vault is no longer accepting messages', reason: 'window_closed' });
  }
  if (Number(vault.storage_used_mb || 0) + sizeMb > Number(vault.storage_limit_mb || 0)) {
    return res.status(413).json({ error: 'This vault is full', reason: 'storage_full' });
  }

  const contributionId = crypto.randomUUID();
  const ext = extensionFor(recordingType, mimeType);
  const path = `vault-recordings/${vault.id}/${contributionId}.${ext}`;

  // Write the pending row FIRST, before minting the signed upload URL — so
  // if the client ever receives a usable uploadUrl, a row already exists to
  // track it (and for cleanup-vault-uploads.js to find if it's abandoned).
  // is_visible/gift_artifact_id are left at their schema defaults.
  //
  // `submitted_at` is set EXPLICITLY here, in code, rather than left to the
  // column's own `DEFAULT now()` in the documented schema. Despite its
  // name, this column means "row created / guest hit Submit" — NOT "guest
  // confirmed/finalized" — because cleanup-vault-uploads.js's staleness
  // sweep filters on it, and a pending row must have this populated at
  // INIT time or the sweep would never find it (a null `submitted_at`
  // never satisfies `.lt(cutoff)` in Postgres). handleFinalize below never
  // touches this field once set. Setting it explicitly here — instead of
  // trusting an implicit DB default that isn't even deployed yet — removes
  // any risk of a future schema/migration author reasonably (but wrongly,
  // for this table) wiring it to be set only at finalize.
  const { error: pendingErr } = await admin.from('event_contributions').insert({
    id: contributionId,
    vault_id: vault.id,
    contributor_name: name,
    contributor_email: email || null,
    recording_url: path,
    recording_type: recordingType,
    duration_seconds: Math.round(duration),
    file_size_mb: sizeMb, // client-supplied ESTIMATE only — the object doesn't exist in storage yet at init time, so a real measured size isn't available. handleFinalize overwrites this with the real, storage-measured size once the upload completes.
    message: null,
    status: 'pending',
    submitted_at: new Date().toISOString(),
  });
  if (pendingErr) {
    console.error('submit-vault-contribution: pending row insert failed', pendingErr.message);
    return res.status(500).json({ error: 'Could not prepare upload' });
  }

  const { data: signed, error: signErr } = await admin
    .storage
    .from(BUCKET)
    .createSignedUploadUrl(path);
  if (signErr || !signed) {
    console.error('submit-vault-contribution: createSignedUploadUrl failed', signErr && signErr.message);
    // Best-effort immediate cleanup rather than waiting for the sweep —
    // this contribution never got a usable URL, so it can never complete.
    await admin.from('event_contributions').delete().eq('id', contributionId).eq('status', 'pending').catch(() => {});
    return res.status(500).json({ error: 'Could not prepare upload' });
  }

  return res.status(200).json({
    vaultId: vault.id,
    contributionId,
    path,
    uploadUrl: signed.signedUrl,
  });
}

async function handleFinalize(req, res) {
  const {
    token, vaultId, contributionId, path, recordingType,
    durationSeconds, fileSizeMb, contributorName, contributorEmail,
  } = req.body || {};

  if (!token || !vaultId || !contributionId || !path) {
    return res.status(400).json({ error: 'Missing upload reference' });
  }
  if (recordingType !== 'voice' && recordingType !== 'video') {
    return res.status(400).json({ error: 'Invalid recordingType' });
  }
  // Server-side bound on the SUBMITTED duration — independent of whatever
  // the client's own timer says, since that timer is advisory-only and a
  // modified client could send anything here.
  const metaCheck = validateDurationAndSize(recordingType, durationSeconds, fileSizeMb);
  if (metaCheck.error) return res.status(400).json({ error: metaCheck.error });
  const { duration, sizeMb } = metaCheck;

  const contributorCheck = validateContributor(contributorName, contributorEmail);
  if (contributorCheck.error) return res.status(400).json({ error: contributorCheck.error });
  const { name, email } = contributorCheck;

  const vault = await loadVault(token);
  if (!vault || vault.id !== vaultId) {
    return res.status(404).json({ error: 'Vault not found', reason: 'invalid_token' });
  }
  if (!windowOpen(vault)) {
    // Guest recorded before the window closed, but took long enough
    // (slow upload, long pause) that it closed before they finished.
    return res.status(409).json({ error: 'This vault stopped accepting messages while you were recording', reason: 'window_closed' });
  }
  if (path.indexOf(`vault-recordings/${vaultId}/${contributionId}.`) !== 0) {
    return res.status(400).json({ error: 'Upload reference mismatch' });
  }

  // Confirm the object actually landed in storage before marking the row
  // complete — a client could call finalize without a successful upload
  // (network drop, tab closed mid-PUT). This same list() call also gives us
  // the object's REAL byte size via its `metadata.size` — that measured
  // value, NOT the client-supplied `fileSizeMb`, is what feeds the storage
  // cap and what gets stored. A client could lie about file size (or just
  // be wrong about it) to dodge the cap; `fileSizeMb`/`sizeMb` above is
  // only ever used as a cheap early sanity pre-filter (obviously-bogus
  // values get rejected before any storage round trip), never as the
  // authoritative figure.
  const folder = `vault-recordings/${vaultId}`;
  const fileName = path.split('/').pop();
  const { data: listing, error: listErr } = await admin.storage.from(BUCKET).list(folder);
  const matchedFile = !listErr && Array.isArray(listing) ? listing.find((f) => f.name === fileName) : null;
  if (!matchedFile) {
    return res.status(409).json({ error: 'We didn’t receive the recording — please try submitting again.', reason: 'upload_missing' });
  }
  const actualBytes = matchedFile.metadata && typeof matchedFile.metadata.size === 'number'
    ? matchedFile.metadata.size
    : null;
  if (actualBytes === null) {
    console.error('submit-vault-contribution: uploaded object is missing size metadata', path);
    return res.status(500).json({ error: 'Could not verify the uploaded file' });
  }
  const actualSizeMb = actualBytes / (1024 * 1024);

  // FLOOR guard — reject an empty / implausibly-small stored object. A 0-byte upload
  // that returned 2xx to the client (seen live: a 3-min iOS recording that stored 0
  // bytes) would otherwise be marked 'complete' and the guest shown "your message is
  // safe" for a message that stored NOTHING — silent loss of a sealed memory, the
  // worst failure class this product has. Honest failure beats silent loss.
  // The heuristic is DELIBERATELY CONSERVATIVE — a false rejection of a REAL message
  // is worse than what we're fixing: reject only 0 bytes (always), OR < 1 KB total,
  // OR (VIDEO only) < ~500 bytes/sec vs the reported duration (a real 1080p clip is
  // ~1 MB/sec, so this floor is ~2000x below reality — it cannot false-reject a real
  // recording). Voice gets only the 0/<1KB checks (no bytes/sec floor). Logged with a
  // distinct FLOOR-REJECT tag so a recurring pattern flags the upload-reliability fix
  // (recorder timeslice / bucket limit / TUS — feature-backlog #15) as urgent.
  const FLOOR_MIN_BYTES = 1024;            // 1 KB, any media type
  const VIDEO_MIN_BYTES_PER_SEC = 500;     // video only
  const durSec = Math.max(0, Number(duration) || 0);
  const flooredOut =
    actualBytes === 0 ||
    actualBytes < FLOOR_MIN_BYTES ||
    (recordingType === 'video' && durSec > 0 && actualBytes < durSec * VIDEO_MIN_BYTES_PER_SEC);
  if (flooredOut) {
    console.error(
      `submit-vault-contribution: FLOOR-REJECT empty/implausible upload — ` +
      `contribution=${contributionId} vault=${vaultId} type=${recordingType} ` +
      `bytes=${actualBytes} durationSec=${durSec} path=${path}`
    );
    // Same cleanup as the over-MAX path: delete the object + the pending row, reject.
    await admin.storage.from(BUCKET).remove([path]).catch(() => {});
    await admin.from('event_contributions').delete().eq('id', contributionId).eq('status', 'pending').catch(() => {});
    return res.status(400).json({
      error: `We didn't receive your recording — please record and try again.`,
      reason: 'upload_empty',
    });
  }

  if (actualSizeMb > MAX_FILE_SIZE_MB) {
    // The real, uploaded file exceeds the sanity ceiling even though the
    // client's claimed size passed the earlier pre-filter — clean it up
    // and reject, same as any other rejected finalize.
    await admin.storage.from(BUCKET).remove([path]).catch(() => {});
    await admin.from('event_contributions').delete().eq('id', contributionId).eq('status', 'pending').catch(() => {});
    return res.status(400).json({ error: 'That recording is larger than allowed' });
  }

  let storageResult;
  try {
    storageResult = await incrementStorageUsed(vault.id, actualSizeMb);
  } catch (e) {
    console.error('submit-vault-contribution: storage increment failed', e.message);
    return res.status(500).json({ error: 'Could not finalize this recording' });
  }
  if (!storageResult.ok) {
    // The vault filled up between init and finalize (a concurrent guest won
    // the remaining space). Clean up the orphaned upload + its pending row
    // now rather than waiting for the sweep.
    await admin.storage.from(BUCKET).remove([path]).catch(() => {});
    await admin.from('event_contributions').delete().eq('id', contributionId).eq('status', 'pending').catch(() => {});
    return res.status(413).json({ error: 'This vault is full', reason: 'storage_full' });
  }

  // Flip the pending row (written by init) to complete, guarded on it still
  // being 'pending' — never a raw insert, since init already created it.
  // file_size_mb here is the REAL, storage-measured actualSizeMb — this
  // overwrites init's client-supplied estimate with the authoritative value.
  // Transcode routing (in-house pipeline — docs/server-transcode-plan.md): a WebM
  // upload (Android/desktop MediaRecorder) is unplayable on iOS → needs transcode;
  // an already-mp4/m4a upload (iOS Safari) is playable now → skip. transcode-vault-media
  // (cron) claims 'pending_transcode' rows; get-vault-media serves playback_url.
  const needsTranscode = /\.webm$/i.test(path);
  const { data: updated, error: updErr } = await admin
    .from('event_contributions')
    .update({
      status: 'complete',
      contributor_name: name,
      contributor_email: email || null,
      duration_seconds: Math.round(duration),
      file_size_mb: actualSizeMb,
      transcode_status: needsTranscode ? 'pending_transcode' : 'not_needed',
      playback_url: needsTranscode ? null : path,
    })
    .eq('id', contributionId)
    .eq('vault_id', vault.id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();
  if (updErr) {
    console.error('submit-vault-contribution: finalize update failed', updErr.message);
    return res.status(500).json({ error: 'Could not save this recording' });
  }

  if (!updated) {
    // No row moved from pending→complete. Two possibilities: this is a
    // retried finalize call after a network blip (already complete —
    // treat as an idempotent success), or the pending row aged out and was
    // swept by cleanup-vault-uploads.js before this call landed (a very
    // slow upload, past the sweep window). Distinguish rather than guess.
    const { data: existing } = await admin
      .from('event_contributions')
      .select('id, status')
      .eq('id', contributionId)
      .maybeSingle();
    if (!existing || existing.status !== 'complete') {
      return res.status(410).json({
        error: 'This upload took too long and was cleared. Please record and submit again.',
        reason: 'upload_missing',
      });
    }
    // else: already complete — fall through to the success response.
  }

  return res.status(200).json({ success: true, honoreeName: vault.honoree_name, unlockDate: vault.unlocks_at });
}

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const action = req.body && req.body.action;
    if (action === 'init') return await handleInit(req, res);
    if (action === 'finalize') return await handleFinalize(req, res);
    return res.status(400).json({ error: 'Invalid action' });
  } catch (e) {
    console.error('submit-vault-contribution error:', e);
    return res.status(500).json({ error: 'Something went wrong' });
  }
};
