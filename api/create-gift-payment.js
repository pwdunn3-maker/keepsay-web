const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const PRICES = {
  pro_monthly:    { amount: 499,  label: 'Keepsay Pro — 1 Month' },
  pro_annual:     { amount: 3499, label: 'Keepsay Pro — 1 Year' },
  legacy_monthly: { amount: 999,  label: 'Keepsay Legacy — 1 Month' },
  legacy_annual:  { amount: 7999, label: 'Keepsay Legacy — 1 Year' },
};

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I confusion
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

async function generateUniqueCode() {
  let code;
  let attempts = 0;
  do {
    code = generateCode();
    const { data } = await supabase
      .from('gift_codes')
      .select('code')
      .eq('code', code)
      .single();
    if (!data) break;
    attempts++;
  } while (attempts < 10);
  return code;
}

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { tier, recipientName, recipientEmail, gifterName, gifterEmail, message } = req.body;

    if (!PRICES[tier]) return res.status(400).json({ error: 'Invalid tier' });
    if (!recipientName || !recipientEmail || !gifterName || !gifterEmail) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const priceInfo = PRICES[tier];
    const code = await generateUniqueCode();

    // Create Stripe payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: priceInfo.amount,
      currency: 'usd',
      description: priceInfo.label + ' gift from ' + gifterName + ' to ' + recipientName,
      receipt_email: gifterEmail,
      metadata: {
        type: 'gift',
        tier,
        gift_code: code,
        gifter_name: gifterName,
        gifter_email: gifterEmail,
        recipient_name: recipientName,
        recipient_email: recipientEmail,
      },
    });

    // Insert gift code into Supabase (pending payment confirmation)
    const { error: dbError } = await supabase.from('gift_codes').insert({
      code,
      tier,
      stripe_payment_intent_id: paymentIntent.id,
      gifter_name: gifterName,
      gifter_email: gifterEmail,
      recipient_name: recipientName,
      recipient_email: recipientEmail,
      message: message || null,
    });

    if (dbError) {
      console.error('DB error:', dbError);
      return res.status(500).json({ error: 'Failed to create gift code' });
    }

    return res.status(200).json({
      clientSecret: paymentIntent.client_secret,
      code,
    });

  } catch (err) {
    console.error('Payment intent error:', err);
    return res.status(500).json({ error: err.message });
  }
};
