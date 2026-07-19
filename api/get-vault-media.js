// api/get-vault-media.js — keepsay-web
//
// Playback signing for the couple's vault REVEAL. Returns the vault's contributions
// with SERVICE-ROLE-SIGNED media URLs, mapped for the in-app KnowMe player.
//
// This endpoint EXISTS because the couple cannot sign the media themselves: vault
// recordings live under `vault-recordings/` in the `memories` bucket and were
// uploaded by the service role, so a couple's client `createSignedUrl` is denied by
// storage RLS. Signing server-side is also where the SEAL is enforced.
//
// AUTH + GATES (all three, in order):
//   1. Validate the Bearer JWT server-side; uid from the TOKEN, never the body (ST36/ST49).
//   2. Ownership — uid === event_vaults.creator_user_id.
//   3. THE SEAL — is_unlocked === true, else 403. Ownership alone is NOT enough: pre-unlock
//      the seal is metadata-enforced (the couple can't even learn object paths), and this
//      endpoint must not become a second door around it.
//
// Mapping for KnowMe (KnowMeScreen.js distinguishes on the field): a video-type
// contribution's signed URL goes in `video_url`; a voice one in `recording_url`.

const { createClient } = require('@supabase/supabase-js');

const BUCKET = 'memories';            // vault media lives under a vault-recordings/ prefix here
// Signed-URL TTL — deliberately GENEROUS (24h). A reveal can be a long or paused
// sitting (up to ~150 messages); a short TTL would expire mid-playthrough (the ST52
// stale-URL failure class). The app also re-requests get-vault-media on each playback
// OPEN, so cross-session URLs are always fresh — 24h just needs to cover one continuous
// sitting, while bounding leaked-link exposure for private vault media.
const SIGNED_URL_EXPIRY = 60 * 60 * 24; // 24 hours

const admin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // 1. Auth — validate JWT, uid from the token.
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) return res.status(401).json({ error: 'Missing bearer token' });
  const { data: userData, error: authErr } = await admin.auth.getUser(token);
  const uid = userData && userData.user && userData.user.id;
  if (authErr || !uid) return res.status(401).json({ error: 'Invalid or expired session' });

  const { vaultToken } = req.body || {};
  if (!vaultToken || typeof vaultToken !== 'string') {
    return res.status(400).json({ error: 'vaultToken required' });
  }

  // 2 + 3. Ownership AND the seal.
  const { data: vault, error: vErr } = await admin
    .from('event_vaults')
    .select('id, creator_user_id, is_unlocked')
    .eq('vault_token', vaultToken)
    .maybeSingle();
  if (vErr) {
    console.error('get-vault-media lookup error:', vErr.message);
    return res.status(500).json({ error: 'Lookup failed' });
  }
  if (!vault) return res.status(404).json({ error: 'Vault not found' });
  if (vault.creator_user_id !== uid) return res.status(403).json({ error: 'Not your vault' });
  if (!vault.is_unlocked) return res.status(403).json({ error: 'Vault is sealed', reason: 'sealed' });

  try {
    const { data: rows, error } = await admin
      .from('event_contributions')
      .select('id, contributor_name, message, recording_url, playback_url, transcode_status, recording_type, duration_seconds, submitted_at')
      .eq('vault_id', vault.id)
      .eq('status', 'complete')
      .order('submitted_at', { ascending: true });
    if (error) throw error;

    if (!rows || rows.length === 0) {
      return res.status(200).json({ ok: true, count: 0, messages: [] });
    }

    // A row is PLAYABLE once transcoded, or if it never needed transcoding (an mp4
    // upload from iOS Safari). Its playable object is playback_url, falling back to
    // recording_url for a 'not_needed' row that stored the mp4 there. A row still
    // pending/failed transcode is NOT playable — it must NEVER be served an
    // undecodable WebM (that IS the iOS green-screen we're fixing); it surfaces as
    // status:'processing' so the app shows a "still being prepared" card and Play-all
    // skips it. (transcode_failed is treated as processing too — the couple sees
    // "preparing" while the failure alert gets a human to intervene; see
    // docs/server-transcode-plan.md.)
    const playablePath = (r) => {
      // 'transcoded' MUST have its derivative — never fall back to recording_url (the
      // undecodable WebM master); a transcoded row with a null playback_url (a manual
      // edit / partial write) degrades to 'processing', not a green screen.
      if (r.transcode_status === 'transcoded') return r.playback_url || null;
      // 'not_needed' stored the already-playable mp4/m4a in recording_url (iOS Safari).
      if (r.transcode_status === 'not_needed') return r.playback_url || r.recording_url;
      return null; // pending_transcode | transcoding | transcode_failed | null(legacy)
    };

    // Batch-sign only the playable paths — one Storage round-trip, no N-parallel
    // requests for a 150-guest vault.
    const playablePaths = rows.map(playablePath).filter(Boolean);
    const urlByPath = {};
    if (playablePaths.length) {
      const { data: signedArr, error: signErr } = await admin.storage
        .from(BUCKET)
        .createSignedUrls(playablePaths, SIGNED_URL_EXPIRY);
      if (signErr) throw signErr;
      (signedArr || []).forEach((s) => { if (s && s.signedUrl) urlByPath[s.path] = s.signedUrl; });
    }

    const messages = rows.map((r) => {
      const isVideo = String(r.recording_type || '').toLowerCase().includes('video');
      const base = {
        id: r.id,
        contributorName: r.contributor_name,
        message: r.message || null,
        durationSeconds: r.duration_seconds || null,
        isVideo,
      };
      const p = playablePath(r);
      if (!p) {
        // Still being prepared — no media served, the app shows a "preparing" card.
        return { ...base, status: 'processing', video_url: null, recording_url: null };
      }
      const url = urlByPath[p];
      if (!url) return null; // unsignable — skip rather than fail the whole reveal
      // KnowMe field mapping: video-type -> video_url, voice -> recording_url.
      return { ...base, status: 'ready', video_url: isVideo ? url : null, recording_url: isVideo ? null : url };
    }).filter(Boolean);

    const readyCount = messages.filter((m) => m.status === 'ready').length;
    return res.status(200).json({ ok: true, count: messages.length, readyCount, messages });
  } catch (err) {
    console.error('get-vault-media error:', err.message);
    return res.status(500).json({ error: 'Could not load messages' });
  }
};
