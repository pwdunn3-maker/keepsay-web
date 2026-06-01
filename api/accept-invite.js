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

    // Resolve the reusable invite link.
    const { data: invite, error: readErr } = await admin
      .from('invite_links')
      .select('from_user_id')
      .eq('code', code)
      .single();
    if (readErr || !invite) return res.status(404).json({ error: 'Invalid or expired invite code' });

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

    // Create the connection (inviter -> caller), matching the in-app shape.
    const { error: insErr } = await admin
      .from('connections')
      .insert({
        id: crypto.randomUUID(),
        from_user_id: inviterId,
        to_user_id: uid,
        status: 'accepted',
      });
    if (insErr) throw insErr;

    // Inviter display name for the success UI (no email).
    const { data: inviter } = await admin
      .from('profiles')
      .select('display_name')
      .eq('id', inviterId)
      .maybeSingle();

    // WHITELIST: only these fields leave the server.
    return res.status(200).json({
      connected: true,
      inviterName: (inviter && inviter.display_name) || null,
    });
  } catch (e) {
    return res.status(500).json({ error: 'Could not accept invite' });
  }
};
