// api/redeem-gift.js — keepsay-web
// Server-side gift redemption. Mirrors the get-gift.js pattern:
// service-role client, CORS guard, method guard, explicit field whitelist.
// NEVER returns email, redeemed_by, or any payment identifier.

const { createClient } = require('@supabase/supabase-js');

// Service-role client — bypasses RLS. Server-only; key never ships to the app.
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
    // ---- Caller identity: verify the Supabase access token; derive uid from
    // the VERIFIED token. Do NOT trust a user_id sent in the body. ----------
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });

    const { data: userData, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !userData || !userData.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const uid = userData.user.id;
    // ----------------------------------------------------------------------

    const code = ((req.body && req.body.code) || '').trim();
    if (!code) return res.status(400).json({ error: 'Missing gift code' });

    // Look up the gift (service role; no RLS).
    const { data: gift, error: readErr } = await admin
      .from('gift_codes')
      .select('code, tier, gifter_name, redeemed_at')
      .eq('code', code)
      .single();
    if (readErr || !gift) return res.status(404).json({ error: 'Gift code not found' });

    if (gift.redeemed_at) return res.status(200).json({ already_redeemed: true });

    // Conditional, race-safe redeem: only succeeds if still unredeemed.
    const { data: claimed, error: claimErr } = await admin
      .from('gift_codes')
      .update({ redeemed_by: uid, redeemed_at: new Date().toISOString() })
      .eq('code', code)
      .is('redeemed_at', null)
      .select('code')
      .maybeSingle();
    if (claimErr) throw claimErr;
    if (!claimed) return res.status(200).json({ already_redeemed: true }); // lost the race

    // Activate the caller's tier.
    const resolvedTier = String(gift.tier || '').includes('legacy') ? 'legacy' : 'pro';
    const giftExpiresAt = new Date();
    giftExpiresAt.setFullYear(giftExpiresAt.getFullYear() + 1);

    const profileUpdate = {
      gift_tier: resolvedTier,
      gift_expires_at: giftExpiresAt.toISOString(),
    };
    if (resolvedTier === 'legacy') profileUpdate.is_legacy = true;

    const { error: actErr } = await admin
      .from('profiles')
      .update(profileUpdate)
      .eq('id', uid);
    if (actErr) {
      return res.status(500).json({ error: 'Gift redeemed but activation failed' });
    }

    // WHITELIST: only these fields leave the server.
    return res.status(200).json({
      already_redeemed: false,
      gifter_name: gift.gifter_name || null,
      tier: resolvedTier,
    });
  } catch (e) {
    return res.status(500).json({ error: 'Redemption failed' });
  }
};
