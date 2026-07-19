// api/transcode-vault-media.js — keepsay-web
//
// Event Vault IN-HOUSE transcode (privacy decider — see docs/server-transcode-plan.md).
// Guest recordings are WebM (VP9/Opus), unplayable on iOS. This cron claims ONE
// pending contribution per invocation, transcodes WebM→H.264/AAC mp4 (or Opus→AAC
// m4a) with ffmpeg-static, writes playback_url, and marks it transcoded. The couple's
// get-vault-media then serves playback_url so KnowMe can decode it.
//
// CONCURRENCY: claims via the atomic claim_vault_transcode() RPC (FOR UPDATE SKIP
// LOCKED + a >15min stuck-reclaim) — a frequent cron plus 90-250s jobs WILL overlap
// its own prior invocation, and a crashed function must not strand a clip forever.
// One clip per invocation (a batch could blow the same 300s cap); latency is
// irrelevant (vaults seal for months), so the backlog drains steadily.
//
// FAILURE: 3 attempts → transcode_status='transcode_failed' → alert email fires ONCE
// (guarded by transcode_alerted). The reveal treats transcode_failed the same as
// still-preparing, but the alert guarantees a human intervenes — "still preparing"
// must never be a forever state.
//
// OUTPUT is pinned to the app's conventions (matches ST50 iOS compression so guest
// and couple videos are consistent in quality + storage): H.264 + AAC mp4, MANDATORY
// faststart (moov before mdat), 1080p downscale cap, ~8 Mbps ceiling.
//
// Vercel function config (maxDuration 300 / memory 3008) is set in vercel.json.

const { createClient } = require('@supabase/supabase-js');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ffmpegPath = require('ffmpeg-static');

const BUCKET = 'memories';
const MAX_ATTEMPTS = 3;

const admin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Internal watchdog (< Vercel's 300s hard kill): a CORRUPT guest clip can make
// ffmpeg HANG with no clean exit. Without this, only Vercel's maxDuration kill stops
// it — an uncaught path that never runs the catch below (see the terminal guard in
// the handler). Killing at 270s makes a hang REJECT cleanly → it flows through the
// catch → is counted as an attempt → terminates via the normal 3-strike path.
function runFfmpeg(args, timeoutMs = 270000) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    const watchdog = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch (e) {}
      reject(new Error(`ffmpeg timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    proc.stderr.on('data', (d) => { err += d.toString(); if (err.length > 20000) err = err.slice(-20000); });
    proc.on('error', (e) => { clearTimeout(watchdog); reject(e); });
    proc.on('close', (code) => {
      clearTimeout(watchdog);
      code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${err.slice(-800)}`));
    });
  });
}

async function sendFailureAlert(row) {
  if (!process.env.SENDGRID_API_KEY) return;
  try {
    await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: 'hello@stubborngood.co' }] }],
        from: { email: 'hello@stubborngood.co', name: 'Keepsay' },
        subject: `[Keepsay] Vault transcode FAILED — contribution ${row.id}`,
        content: [{ type: 'text/plain', value:
          `A vault contribution failed to transcode after ${MAX_ATTEMPTS} attempts and needs manual attention.\n\n` +
          `contribution_id: ${row.id}\nvault_id: ${row.vault_id}\ncontributor: ${row.contributor_name}\n` +
          `type: ${row.recording_type}\nsource: ${row.recording_url}\n\n` +
          `The couple currently sees this message as "still being prepared" until it is resolved.` }],
      }),
    });
  } catch (e) { console.error('transcode-vault-media: alert email failed', e.message); }
}

module.exports = async function handler(req, res) {
  // Cron auth — same CRON_SECRET gate the other crons use (Vercel Cron sends
  // `Authorization: Bearer <CRON_SECRET>` automatically when the env var is set).
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) {
    console.error('transcode-vault-media: CRON_SECRET not configured — refusing to run');
    return res.status(500).json({ error: 'Not configured' });
  }
  if ((req.headers.authorization || '') !== `Bearer ${expectedSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // 1. Atomic claim (race-safe; reclaims rows stuck >15min).
  const { data: claimed, error: claimErr } = await admin.rpc('claim_vault_transcode');
  if (claimErr) {
    console.error('transcode-vault-media: claim failed', claimErr.message);
    return res.status(500).json({ error: 'Claim failed' });
  }
  const row = Array.isArray(claimed) ? claimed[0] : claimed;
  if (!row) return res.status(200).json({ ok: true, claimed: 0 }); // nothing pending

  // TERMINAL GUARD (before any work). A HARD failure — Vercel killing the function at
  // maxDuration, an OOM, or an ffmpeg hard-crash — never runs the catch below, so the
  // row stays 'transcoding', is stale-reclaimed after 15min, and transcode_attempts
  // (incremented by the claim, committed BEFORE ffmpeg runs, so it persists across a
  // hard kill) keeps climbing. Because the claim intentionally doesn't filter on
  // attempts (so a crashed row is always recoverable), it would otherwise re-claim
  // FOREVER and never alert — a guest's sealed message lost silently, breaking the
  // header invariant. Once attempts exceeds the cap even on that path, mark it failed
  // + alert ONCE here, without attempting more work. (The catch below still handles
  // the clean-reject path at exactly MAX_ATTEMPTS; this catches the hard-crash path.)
  if (row.transcode_attempts > MAX_ATTEMPTS) {
    const shouldAlert = !row.transcode_alerted;
    await admin.from('event_contributions').update({
      transcode_status: 'transcode_failed',
      transcode_claimed_at: null,
      transcode_alerted: true,
    }).eq('id', row.id);
    if (shouldAlert) await sendFailureAlert(row);
    return res.status(200).json({ ok: false, id: row.id, terminal: true, reason: 'exhausted' });
  }

  const isVideo = String(row.recording_type || '').toLowerCase().includes('video');
  const outExt = isVideo ? 'mp4' : 'm4a';
  // Sibling of the master (…/<id>.webm → …/<id>_playback.mp4); master preserved.
  const outPath = row.recording_url.replace(/\.[^.]+$/, `_playback.${outExt}`);
  const tmpIn = path.join(os.tmpdir(), `${row.id}_in`);
  const tmpOut = path.join(os.tmpdir(), `${row.id}_out.${outExt}`);

  try {
    // 2. Download the WebM master from storage.
    const { data: dl, error: dlErr } = await admin.storage.from(BUCKET).download(row.recording_url);
    if (dlErr || !dl) throw new Error(`download: ${dlErr && dlErr.message}`);
    fs.writeFileSync(tmpIn, Buffer.from(await dl.arrayBuffer()));

    // 3. Transcode → app conventions (H.264+AAC, faststart, 1080p cap, ~ST50 bitrate).
    const args = isVideo
      ? ['-y', '-i', tmpIn,
         '-vf', "scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
         '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-maxrate', '8M', '-bufsize', '16M',
         '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', tmpOut]
      : ['-y', '-i', tmpIn,
         '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', tmpOut];
    await runFfmpeg(args);

    // 4. Upload the transcoded output alongside the master.
    const outBuf = fs.readFileSync(tmpOut);
    const { error: upErr } = await admin.storage.from(BUCKET).upload(outPath, outBuf, {
      contentType: isVideo ? 'video/mp4' : 'audio/mp4',
      upsert: true,
    });
    if (upErr) throw new Error(`upload: ${upErr.message}`);

    // 5. Mark transcoded + record the playback path.
    //    STORAGE POLICY (2026-07-19, Patrick — DO NOT "fix" back): the 25 GB cap
    //    counts ORIGINAL guest uploads ONCE (at finalize). Transcoded DERIVATIVES
    //    (this mp4/m4a, and future thumbnails) are internal COGS, EXCLUDED from the
    //    cap — so NO increment_vault_storage call here. Counting them would
    //    double-charge AND, worse, the RPC's cap-guard would REJECT the transcode on
    //    a nearly-full vault, stranding good guest messages in transcode_failed on
    //    exactly the big video-heavy vaults that matter most. See
    //    docs/server-transcode-plan.md + docs/storage-economics.md.
    await admin.from('event_contributions').update({
      transcode_status: 'transcoded',
      playback_url: outPath,
      transcode_claimed_at: null,
    }).eq('id', row.id);

    return res.status(200).json({ ok: true, id: row.id, playbackUrl: outPath });
  } catch (e) {
    console.error('transcode-vault-media: transcode failed', row.id, e.message);
    // attempts was already incremented by the claim, so this reflects THIS attempt.
    const terminal = row.transcode_attempts >= MAX_ATTEMPTS;
    if (terminal) {
      const shouldAlert = !row.transcode_alerted;
      await admin.from('event_contributions').update({
        transcode_status: 'transcode_failed',
        transcode_claimed_at: null,
        transcode_alerted: true,
      }).eq('id', row.id);
      if (shouldAlert) await sendFailureAlert(row); // fires exactly once
    } else {
      await admin.from('event_contributions').update({
        transcode_status: 'pending_transcode', // retry next sweep
        transcode_claimed_at: null,
      }).eq('id', row.id);
    }
    return res.status(200).json({ ok: false, id: row.id, terminal, error: e.message });
  } finally {
    try { fs.unlinkSync(tmpIn); } catch (e) {}
    try { fs.unlinkSync(tmpOut); } catch (e) {}
  }
};
