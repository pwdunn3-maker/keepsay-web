// api/accept-invite.js — keepsay-web
// Reusable invite_links acceptance, server-side. Same pattern as redeem-gift.js.
// The single-use connections-code path stays IN-APP (reads connections, not invite_links).

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const admin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const ALLOWED_ORIGIN = process.env.APP_ORIGIN || '*';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
}

// Inviter display name for the success UI (no email ever leaves the server).
async function getInviterName(inviterId) {
  const { data } = await admin
    .from('profiles')
    .select('display_name')
    .eq('id', inviterId)
    .maybeSingle();
  return (data && data.display_name) || null;
}

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // ---- Caller identity: verify the Supabase access token (same as redeem). --
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });

    const { data: userData, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !userData || !userData.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const uid = userData.user.id;
    // ----------------------------------------------------------------------

    const code = ((req.body && req.body.code) || '').trim().toUpperCase();
    if (!code) return res.status(400).json({ error: 'Missing invite code' });

    // ---- Path 1: reusable family link (invite_links) -> insert a new connection ----
    const { data: invite } = await admin
      .from('invite_links')
      .select('from_user_id')
      .eq('code', code)
      .maybeSingle();

    if (invite) {
      const inviterId = invite.from_user_id;
      if (inviterId === uid) return res.status(400).json({ error: 'You cannot connect with yourself' });

      // Duplicate-connection guard (both directions).
      const { data: existing } = await admin
        .from('connections')
        .select('id')
        .or(
          'and(from_user_id.eq.' + uid + ',to_user_id.eq.' + inviterId + '),' +
          'and(from_user_id.eq.' + inviterId + ',to_user_id.eq.' + uid + ')'
        )
        .maybeSingle();
      if (existing) return res.status(409).json({ error: 'You are already connected with this person' });

      const { error: insErr } = await admin
        .from('connections')
        .insert({
          id: crypto.randomUUID(),
          from_user_id: inviterId,
          to_user_id: uid,
          status: 'accepted',
        });
      if (insErr) throw insErr;

      return res.status(200).json({ connected: true, inviterName: await getInviterName(inviterId) });
    }

    // ---- Path 2: single-use personal code (connections.invite_code, pending) ----
    // The accepter is not yet a participant, so RLS prevents the app from reading
    // or claiming this row. Acceptance MUST happen here, server-side (service role).
    const { data: pending } = await admin
      .from('connections')
      .select('id, from_user_id')
      .eq('invite_code', code)
      .eq('status', 'pending')
      .maybeSingle();

    if (pending) {
      const inviterId = pending.from_user_id;
      if (inviterId === uid) return res.status(400).json({ error: 'You cannot connect with yourself' });

      // Already connected another way? Don't duplicate.
      const { data: existing } = await admin
        .from('connections')
        .select('id')
        .or(
          'and(from_user_id.eq.' + uid + ',to_user_id.eq.' + inviterId + '),' +
          'and(from_user_id.eq.' + inviterId + ',to_user_id.eq.' + uid + ')'
        )
        .maybeSingle();
      if (existing) return res.status(409).json({ error: 'You are already connected with this person' });

      // Race-safe claim: only succeeds while the row is still pending.
      const { data: claimed, error: claimErr } = await admin
        .from('connections')
        .update({ to_user_id: uid, status: 'accepted' })
        .eq('id', pending.id)
        .eq('status', 'pending')
        .select('id')
        .maybeSingle();
      if (claimErr) throw claimErr;
      if (!claimed) return res.status(409).json({ error: 'This invite code was already used' });

      return res.status(200).json({ connected: true, inviterName: await getInviterName(inviterId) });
    }

    // Neither a reusable link nor a pending personal code.
    return res.status(404).json({ error: 'Invalid invite code' });
  } catch (e) {
    return res.status(500).json({ error: 'Could not accept invite' });
  }
};
