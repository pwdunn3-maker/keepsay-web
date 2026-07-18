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
  // 'complete' ($99) = vault + a full year of Keepsay Legacy (granted at
  // fulfillment). Renamed from 'gift_set' 2026-07-17: the printed-cards half of
  // the original Gift Set isn't fulfillable yet (no address/production pipeline),
  // so launch is all-digital and the name no longer implies a physical gift.
  complete: { amount: 9900, label: 'Keepsay Wedding Vault — Complete' },
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
    const { tier, ownerEmail, honoreeName, occasionType, eventDate } = req.body || {};

    if (!TIERS[tier]) return res.status(400).json({ error: 'Invalid tier' });

    const occasion = occasionType || 'wedding';
    if (!ALLOWED_OCCASIONS.includes(occasion)) {
      return res.status(400).json({ error: 'Invalid occasion' });
    }

    // Wedding date (required). Drives the contribution-close + suggested-opening
    // dates AND the tier-grant duration at fulfillment (lib/eventVaultFulfill.js).
    // Validate a REAL YYYY-MM-DD: regex-shape + a UTC round-trip so a rolled-over
    // impossible date (e.g. 2026-02-30) can't slip through.
    const weddingDate = String(eventDate || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weddingDate)) {
      return res.status(400).json({ error: 'A valid wedding date is required' });
    }
    const parsedDate = new Date(weddingDate + 'T00:00:00Z');
    if (isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== weddingDate) {
      return res.status(400).json({ error: 'A valid wedding date is required' });
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
        event_date: weddingDate,
        // NOTE: no client-supplied owner uid. This endpoint is public (CORS *),
        // so the vault owner is resolved server-side FROM owner_email at
        // fulfillment (match-or-create the auth user) — never asserted by the
        // client body. Trusting a raw-body uid would be the ST36/ST49
        // trust-boundary trap. If a verified web session is added later, derive
        // the uid from a bearer token, not the request body.
      },
    });

    return res.status(200).json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error('create-event-vault-payment error:', err);
    return res.status(500).json({ error: 'Could not start checkout. Please try again.' });
  }
};
