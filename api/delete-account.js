// api/delete-account.js — keepsay-web
// C1 Phase 2 — Part 3: server-side account deletion.
// Conventions match redeem-gift.js: CommonJS, service-role client, setCors,
// method guard, verify JWT -> uid (never trust the body). A user can only delete
// themselves. Runs the transactional delete_account RPC, removes the returned
// storage files (best-effort), then deletes the auth user (last).

const { createClient } = require('@supabase/supabase-js');

// Service-role client — bypasses RLS. Server-only; key never ships to the app.
const admin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const ALLOWED_ORIGIN = process.env.APP_ORIGIN || '*';
const BUCKET = 'memories';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
}

// Mirror of luminary-legacy src/utils/getSignedUrl.js extractStoragePath — KEEP IN SYNC.
function extractStoragePath(url) {
  if (!url) return null;
  if (url.startsWith('file://')) return null;
  if (!url.startsWith('http')) return url;                 // already a raw storage path
  const pub = '/object/public/' + BUCKET + '/';
  let idx = url.indexOf(pub);
  if (idx !== -1) return url.substring(idx + pub.length);
  const sign = '/object/sign/' + BUCKET + '/';
  idx = url.indexOf(sign);
  if (idx !== -1) return url.substring(idx + sign.length).split('?')[0];
  return null;
}

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // 1. Verify the access token; derive uid from the VERIFIED token (never the body).
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });

    const { data: userData, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !userData || !userData.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const uid = userData.user.id;

    // 2. Transactional DB deletion. Returns storage URLs of the DELETED (non-gifted)
    //    entries. Gifts (direct + fanned-out circle shares) are preserved by the RPC.
    const { data: rows, error: rpcErr } = await admin.rpc('delete_account', { p_uid: uid });
    if (rpcErr) {
      console.error('[delete-account] RPC failed for', uid, rpcErr.message);
      return res.status(500).json({ error: 'Deletion failed; please contact support@stubborngood.co' });
    }

    // 3. Remove the deleted entries' files. BEST-EFFORT: a storage hiccup must NOT
    //    block deletion (DB already committed). Orphans are recoverable; a
    //    half-deleted account is not.
    const paths = (rows || []).map(r => extractStoragePath(r.storage_url)).filter(Boolean);
    if (paths.length) {
      const { error: rmErr } = await admin.storage.from(BUCKET).remove(paths);
      if (rmErr) console.error('[delete-account] storage.remove partial failure for', uid, rmErr.message);
    }

    // 4. Delete the auth user LAST — retry-safe if anything above failed; frees the
    //    email for immediate re-signup (intended).
    const { error: delErr } = await admin.auth.admin.deleteUser(uid);
    if (delErr) {
      console.error('[delete-account] auth deleteUser failed for', uid, delErr.message);
      return res.status(500).json({ error: 'Account data removed but final step failed; contact support@stubborngood.co' });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[delete-account] unexpected', e.message);
    return res.status(500).json({ error: 'Deletion failed; please contact support@stubborngood.co' });
  }
};
