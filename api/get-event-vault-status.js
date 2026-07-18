// api/get-event-vault-status.js — keepsay-web
// Public read-only resolver for the Occasion Vault purchase CONFIRMATION screen.
//
// After payment, the browser holds the Stripe payment_intent id but NOT the
// vault_token — provisioning is deferred to the webhook (create-event-vault-payment.js
// writes nothing at intent time). This endpoint lets the confirmation page poll
// for the vault the webhook creates, then render the share kit live.
//
// Same hard-whitelist discipline as get-vault-info.js: returns ONLY the token +
// minimal display fields, NEVER owner internals (creator_user_id, email, stripe
// id) or contributor data.
//
// Keyed on the FULL payment_intent id — high-entropy, non-enumerable, and the
// browser already holds it. Deliberately does NOT distinguish "vault not created
// yet" from "unknown/mistyped intent": BOTH return {status:'preparing'}. The
// client's poll timeout + the always-sent confirmation email handle a bogus id
// gracefully, so there's no need for a per-poll Stripe API call just to tell them
// apart. (The webhook is the single writer + a UNIQUE partial index on
// stripe_payment_intent_id guarantees ≤1 match, so maybeSingle can't error.)

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const paymentIntent = req.query.payment_intent;
  if (!paymentIntent || typeof paymentIntent !== 'string') {
    return res.status(400).json({ error: 'payment_intent required' });
  }

  try {
    const { data: vault, error } = await supabase
      .from('event_vaults')
      .select('vault_token, honoree_name, unlocks_at, contribution_closes_at')
      .eq('stripe_payment_intent_id', paymentIntent)
      .maybeSingle();

    if (error) {
      console.error('get-event-vault-status lookup error:', error.message);
      return res.status(500).json({ error: 'Lookup failed' });
    }

    // Not created yet, OR an unknown/mistyped intent — tell the poller to wait.
    // The client's timeout + email fallback cover the bogus-id case.
    if (!vault) return res.status(200).json({ status: 'preparing' });

    // WHITELIST — only these fields ever leave the server.
    return res.status(200).json({
      status: 'ready',
      vaultToken: vault.vault_token,
      honoreeName: vault.honoree_name,
      unlockDate: vault.unlocks_at,
      contributionClosesAt: vault.contribution_closes_at,
    });
  } catch (err) {
    console.error('get-event-vault-status error:', err);
    return res.status(500).json({ error: 'Lookup failed' });
  }
};
