// api/create-event-vault-payment.js — keepsay-web
// Occasion Vault checkout — creates a Stripe PaymentIntent ONLY.
//
// Deliberately unlike the gift flow (create-gift-payment.js), this writes
// NOTHING to the DB and provisions NO auth account here. ALL provisioning
// (auth user + event_vaults row + confirmation email) is deferred to
// stripe-webhook.js on `payment_intent.succeeded`, so an abandoned checkout
// never mints an auth user, a vault, or an email. Decided 2026-07-17
// (docs/wedding-vault-create-share-flow.md); this is intentionally a better
// split than the gift flow it mirrors.
//
// Prices are hardcoded (cents), mirroring create-gift-payment.js's PRICES
// pattern — no Stripe dashboard Product/Price objects needed. Locked
// 2026-07-17: Digital $59 / Gift Set $99, both 25 GB (storage set at
// fulfillment, not here). Sold web-only, never in-app (Apple 3.1.1 — same
// model as gifting).

const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const TIERS = {
  digital:  { amount: 5900, label: 'Keepsay Wedding Vault — Digital' },
  gift_set: { amount: 9900, label: 'Keepsay Wedding Vault — Gift Set' },
};

// The schema is occasion-generic (event_vaults.occasion_type), but only the
// wedding occasion is sold at launch. Gate here so a tampered client can't
// mint an unsupported occasion.
const ALLOWED_OCCASIONS = ['wedding'];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { tier, ownerEmail, honoreeName, occasionType, ownerUserId } = req.body || {};

    if (!TIERS[tier]) return res.status(400).json({ error: 'Invalid tier' });

    const occasion = occasionType || 'wedding';
    if (!ALLOWED_OCCASIONS.includes(occasion)) {
      return res.status(400).json({ error: 'Invalid occasion' });
    }

    // Lean checkout (locked 2026-07-17): only owner email + honoree name + tier
    // + occasion are collected at the payment moment. The two dates default
    // generously at fulfillment and are refined later in the couple dashboard.
    const email = String(ownerEmail || '').trim().toLowerCase();
    const honoree = String(honoreeName || '').trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'A valid email is required' });
    }
    if (!honoree || honoree.length > 120) {
      return res.status(400).json({ error: 'Honoree name is required (120 characters max)' });
    }

    const tierInfo = TIERS[tier];

    const paymentIntent = await stripe.paymentIntents.create({
      amount: tierInfo.amount,
      currency: 'usd',
      description: tierInfo.label + ' — ' + honoree,
      receipt_email: email,
      metadata: {
        type: 'event_vault',
        tier,
        occasion_type: occasion,
        owner_email: email,
        honoree_name: honoree,
        // If the buyer happened to be signed in on the web, the client MAY pass
        // their profiles.id so fulfillment links to that existing account
        // directly (the "use current uid" branch) instead of matching by email.
        // Empty for logged-out buyers, which is the common web-purchase case.
        owner_user_id: ownerUserId ? String(ownerUserId) : '',
      },
    });

    return res.status(200).json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error('create-event-vault-payment error:', err);
    return res.status(500).json({ error: err.message });
  }
};
