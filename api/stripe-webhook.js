const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Disable body parsing — Stripe needs raw body for signature verification
export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object;
    const { type, gift_code, recipient_name, recipient_email, gifter_name } = paymentIntent.metadata;

    if (type !== 'gift' || !gift_code) return res.status(200).json({ received: true });

    // Build the redemption link
    const redeemUrl = 'https://www.getkeepsay.com/redeem/' + gift_code;

    // Send email to recipient via Supabase Edge Function (or just log for now)
    // TODO: wire up to Resend/SendGrid when email is configured
    console.log('GIFT PAYMENT SUCCEEDED:', {
      code: gift_code,
      recipient: recipient_email,
      gifter: gifter_name,
      redeemUrl,
    });

    // For now — the gift code is already in the database from payment intent creation
    // When email is configured, send the redemption email here
    // Example Resend call would go here
  }

  return res.status(200).json({ received: true });
};
