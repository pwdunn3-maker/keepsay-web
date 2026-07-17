// api/cleanup-vault-uploads.js — keepsay-web
// Scheduled reconciliation for the Wedding Vault contributor upload flow
// (vault/[token].html + api/submit-vault-contribution.js).
//
// api/submit-vault-contribution.js's `init` action writes a
// `vault_contributions` row with status='pending' AND mints a Supabase
// Storage path BEFORE the browser's PUT/`finalize` call ever completes. If
// the guest closes the tab mid-upload (or `finalize` never runs for any
// other reason), that row + any bytes that made it to storage are orphaned
// — nothing else ever revisits them. This job sweeps rows still 'pending'
// past a staleness window and deletes both the storage object and the row.
//
// Runs on the SAME cron mechanism this repo already uses for r2-backup.js
// (see the `crons` array in vercel.json) — just its own schedule/entry,
// not a new mechanism. NOTE: unlike this file, r2-backup.js does NOT gate
// itself with any secret/auth check today (checked — it has none), so
// there was no existing "auth pattern" to literally match here; the
// CRON_SECRET check below follows Vercel's own documented convention for
// protecting scheduled functions instead. Worth revisiting whether
// r2-backup.js should get the same gate — out of scope for this file.
//
// ⚠️ Depends on `vault_contributions.status` AND an explicitly-set
// `submitted_at` (both written by api/submit-vault-contribution.js's
// handleInit — see the schema-note comment block at the top of that
// file, which also specs the `(status, submitted_at)` index this sweep
// query wants). Not deployed yet.

const { createClient } = require('@supabase/supabase-js');

const admin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const BUCKET = 'memories';
// Coordinator-specified window: 30–60 min. 45 gives a slow-but-legitimate
// upload real headroom to still finish before being swept.
const STALE_AFTER_MINUTES = 45;
// Cap how many rows one run can touch — a spam burst (or just organic
// growth) shouldn't be able to produce a batch large enough to blow the
// function's execution timeout. Runs DAILY (Vercel Hobby plan caps cron
// frequency at once/day — an hourly schedule failed the whole deployment
// outright, not just this function), so an orphaned upload may sit for up
// to ~24h before being swept, not 45 minutes — acceptable at this scale.
// Nothing is lost by leaving any excess backlog for the next day's run.
const MAX_ROWS_PER_RUN = 200;

module.exports = async function handler(req, res) {
  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` automatically
  // when the CRON_SECRET env var is set on the project — verify it so this
  // isn't a publicly-triggerable delete endpoint. Requires Patrick to set
  // CRON_SECRET in Vercel's project env vars; until then this refuses to
  // run (fails closed, never open).
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) {
    console.error('cleanup-vault-uploads: CRON_SECRET is not configured — refusing to run');
    return res.status(500).json({ error: 'Not configured' });
  }
  const authHeader = req.headers.authorization || '';
  if (authHeader !== `Bearer ${expectedSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const staleCutoff = new Date(Date.now() - STALE_AFTER_MINUTES * 60 * 1000).toISOString();

    const { data: stale, error: readErr } = await admin
      .from('vault_contributions')
      .select('id, vault_id, recording_url')
      .eq('status', 'pending')
      .lt('submitted_at', staleCutoff)
      .limit(MAX_ROWS_PER_RUN);
    if (readErr) throw readErr;

    let removedRows = 0, removedFiles = 0, failed = 0, wonByFinalize = 0;
    const errors = [];

    for (const row of (stale || [])) {
      try {
        // ── Conditional DELETE FIRST, storage.remove() SECOND ─────────────
        // This ordering matters for correctness, not just style. If a slow
        // finalize() call completes in the window between the SELECT scan
        // above and this delete, the row is no longer 'pending' — this
        // delete then claims nothing, and we must NEVER touch its storage
        // object, because it's now a real, completed contribution someone
        // is relying on. Running storage.remove() BEFORE this guarded
        // delete (the earlier version of this file) could destroy a
        // just-finalized message's file while its DB row survived the
        // guard — a real, permanent, undetectable data-loss bug.
        const { data: deleted, error: delErr } = await admin
          .from('vault_contributions')
          .delete()
          .eq('id', row.id)
          .eq('status', 'pending')
          .select('id, recording_url')
          .maybeSingle();
        if (delErr) throw delErr;

        if (!deleted) {
          // Lost the race to finalize() — leave the file alone.
          wonByFinalize++;
          continue;
        }
        removedRows++;

        const recordingUrl = deleted.recording_url || row.recording_url;
        if (recordingUrl) {
          const { error: rmErr } = await admin.storage.from(BUCKET).remove([recordingUrl]);
          if (rmErr) {
            // Not fatal — the object may never have existed at all (the
            // guest closed the tab before the PUT even started).
            console.error('cleanup-vault-uploads: storage remove failed for', recordingUrl, rmErr.message);
          } else {
            removedFiles++;
          }
        }
      } catch (e) {
        failed++;
        errors.push(row.id + ': ' + e.message);
        console.error('cleanup-vault-uploads: row cleanup failed', row.id, e.message);
      }
    }

    const summary = {
      scanned: (stale || []).length, removedRows, removedFiles, wonByFinalize, failed,
      staleAfterMinutes: STALE_AFTER_MINUTES, maxRowsPerRun: MAX_ROWS_PER_RUN,
      timestamp: new Date().toISOString(),
    };
    if (errors.length) summary.errors = errors.slice(0, 10);
    console.log('cleanup-vault-uploads summary:', JSON.stringify(summary));
    return res.status(200).json(Object.assign({ success: true }, summary));
  } catch (e) {
    console.error('cleanup-vault-uploads fatal:', e.message);
    return res.status(500).json({ error: e.message });
  }
};
