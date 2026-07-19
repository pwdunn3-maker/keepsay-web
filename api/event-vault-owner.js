// api/event-vault-owner.js — keepsay-web
//
// Authenticated OWNER actions on an Event Vault. Client-side UPDATE on event_vaults
// was DROPPED (it was a broad all-column write hole — see docs/sql/event_vault_schema.md),
// so EVERY owner write now goes through this service-role endpoint.
//
// AUTH (ST36/ST49 trust boundary): the app sends its Supabase session ACCESS TOKEN as
// `Authorization: Bearer <jwt>`. We validate it SERVER-SIDE (admin.auth.getUser(jwt))
// and take the uid from the VALIDATED token — NEVER from the request body. Then we
// confirm uid === event_vaults.creator_user_id before any write. Writes use the
// service role (bypass RLS, required now the client policy is gone).
//
// Actions (POST body { action, vaultToken, ... }):
//   'unlock'    — flip is_unlocked=true. ONE-WAY: if already unlocked, idempotent-return
//                 success; NEVER re-seal, never error the ceremony. (The couple-initiated
//                 reveal, anytime — unlock model, wedding-vault-build-plan.md §2.)
//   'set-dates' — update ONLY contribution_closes_at and/or unlocks_at (hard whitelist).
//                 NEVER storage/tier/stripe/creator/is_unlocked/event_date via this path.

const { createClient } = require('@supabase/supabase-js');

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

  // ── Auth: validate the Bearer JWT; uid comes from the TOKEN, never the body. ──
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) return res.status(401).json({ error: 'Missing bearer token' });

  const { data: userData, error: authErr } = await admin.auth.getUser(token);
  const uid = userData && userData.user && userData.user.id;
  if (authErr || !uid) return res.status(401).json({ error: 'Invalid or expired session' });

  const body = req.body || {};
  const { action, vaultToken } = body;
  if (!vaultToken || typeof vaultToken !== 'string') {
    return res.status(400).json({ error: 'vaultToken required' });
  }

  // ── Ownership: the vault must belong to the authenticated user. ──
  const { data: vault, error: vErr } = await admin
    .from('event_vaults')
    .select('id, creator_user_id, is_unlocked')
    .eq('vault_token', vaultToken)
    .maybeSingle();
  if (vErr) {
    console.error('event-vault-owner lookup error:', vErr.message);
    return res.status(500).json({ error: 'Lookup failed' });
  }
  if (!vault) return res.status(404).json({ error: 'Vault not found' });
  if (vault.creator_user_id !== uid) return res.status(403).json({ error: 'Not your vault' });

  try {
    // ── unlock — one-way, idempotent. ──
    if (action === 'unlock') {
      if (vault.is_unlocked) {
        return res.status(200).json({ ok: true, is_unlocked: true, alreadyUnlocked: true });
      }
      const { error } = await admin
        .from('event_vaults')
        .update({ is_unlocked: true })
        .eq('id', vault.id);
      if (error) throw error;
      return res.status(200).json({ ok: true, is_unlocked: true });
    }

    // ── set-dates — HARD whitelist: only these two columns are ever written here. ──
    if (action === 'set-dates') {
      const patch = {};
      if (body.contributionClosesAt !== undefined) {
        const d = new Date(body.contributionClosesAt);
        if (isNaN(d.getTime())) return res.status(400).json({ error: 'Invalid contributionClosesAt' });
        // No-past close date — endpoint-side backstop mirroring the app's DateEditModal
        // rule, so ANY other client (web management, a durability owner view) can't set a
        // clearly-past close date. Floor = start-of-YESTERDAY UTC: a full day of slack so
        // no legitimate app write (which anchors the close to a UTC-midnight calendar day)
        // is ever rejected, while obviously-past input is blocked. The app remains the
        // precise "today or later" UX guard; this is the drift-proof backstop.
        const floor = new Date();
        floor.setUTCHours(0, 0, 0, 0);
        floor.setUTCDate(floor.getUTCDate() - 1);
        if (d < floor) return res.status(400).json({ error: 'contribution_closes_at cannot be in the past' });
        patch.contribution_closes_at = d.toISOString();
      }
      if (body.unlocksAt !== undefined) {
        const d = new Date(body.unlocksAt);
        if (isNaN(d.getTime())) return res.status(400).json({ error: 'Invalid unlocksAt' });
        patch.unlocks_at = d.toISOString();
      }
      if (Object.keys(patch).length === 0) {
        return res.status(400).json({ error: 'Nothing to update' });
      }
      const { data: updated, error } = await admin
        .from('event_vaults')
        .update(patch)
        .eq('id', vault.id)
        .select('contribution_closes_at, unlocks_at')
        .single();
      if (error) throw error;
      return res.status(200).json({ ok: true, ...updated });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('event-vault-owner error:', err.message);
    return res.status(500).json({ error: 'Action failed' });
  }
};
