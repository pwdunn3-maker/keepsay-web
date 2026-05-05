const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { code } = req.query;
  if (!code) return res.status(400).json({ error: 'Code required' });

  try {
    // Look up the gift code
    const { data, error } = await supabase
      .from('gift_codes')
      .select('*')
      .eq('code', code.toUpperCase())
      .single();

    if (error || !data) return res.status(404).json({ error: 'Gift not found' });

    // Verify payment was actually completed via Stripe
    if (data.stripe_payment_intent_id) {
      const paymentIntent = await stripe.paymentIntents.retrieve(data.stripe_payment_intent_id);
      if (paymentIntent.status !== 'succeeded') {
        return res.status(404).json({ error: 'Payment not completed' });
      }
    }

    // Return safe fields only — don't expose email addresses
    return res.status(200).json({
      code: data.code,
      tier: data.tier,
      gifter_name: data.gifter_name,
      recipient_name: data.recipient_name,
      message: data.message,
      redeemed_at: data.redeemed_at,
      expires_at: data.expires_at,
    });

  } catch (err) {
    console.error('Gift lookup error:', err);
    return res.status(500).json({ error: err.message });
  }
};
