const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function sendEmail({ to, subject, html }) {
  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: 'hello@stubborngood.co', name: 'Keepsay' },
      subject,
      content: [{ type: 'text/html', value: html }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error('SendGrid error: ' + err);
  }

  return true;
}

async function sendGiftEmail({ recipientEmail, recipientName, gifterName, message, giftCode, tier, redeemUrl }) {
  const tierLabel = tier === 'pro_annual' ? 'Keepsay Pro — Annual' : 'Keepsay Pro — Monthly';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f9f6f0;font-family:'Georgia',serif;">
  <div style="max-width:560px;margin:40px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
    <div style="background:#1B4332;padding:40px 40px 32px;text-align:center;">
      <img src="https://www.getkeepsay.com/icon.png" alt="Keepsay" style="width:72px;height:72px;border-radius:16px;margin-bottom:12px;"><div style="font-family:'Georgia',serif;font-size:28px;color:#ffffff;letter-spacing:1px;">Keepsay</div>
      <div style="color:#a8c5b5;font-size:14px;margin-top:6px;">A gift for ${recipientName}</div>
    </div>
    <div style="padding:40px;">
      <p style="font-size:18px;color:#2d2d2d;margin:0 0 16px;">Hi ${recipientName},</p>
      <p style="font-size:16px;color:#4a4a4a;line-height:1.6;margin:0 0 24px;">
        <strong>${gifterName}</strong> has given you a Keepsay subscription &#8212; a place to keep your voice, your memories, and your story for the people you love.
      </p>
      ${message ? `
      <div style="background:#f9f6f0;border-left:3px solid #D4A843;padding:16px 20px;border-radius:0 8px 8px 0;margin:0 0 28px;">
        <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">A message from ${gifterName}</div>
        <p style="font-size:15px;color:#3a3a3a;line-height:1.6;margin:0;font-style:italic;">"${message}"</p>
      </div>
      ` : ''}
      <div style="background:#f0f7f4;border-radius:8px;padding:20px 24px;margin:0 0 28px;">
        <div style="font-size:12px;color:#1B4332;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;font-weight:bold;">Your Gift</div>
        <div style="font-size:16px;color:#2d2d2d;font-weight:bold;margin-bottom:4px;">${tierLabel}</div>
        <div style="font-size:13px;color:#666;">From: ${gifterName}</div>
      </div>
      <div style="text-align:center;margin:0 0 28px;">
        <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;">Your Redemption Code</div>
        <div style="display:inline-block;background:#1B4332;color:#ffffff;font-family:'Courier New',monospace;font-size:28px;letter-spacing:8px;padding:16px 32px;border-radius:8px;">${giftCode}</div>
        <div style="font-size:13px;color:#888;margin-top:10px;">Enter this code in the Keepsay app under Profile &#8594; Redeem a gift</div>
      </div>
      <div style="text-align:center;margin:0 0 32px;">
        <a href="${redeemUrl}" style="display:inline-block;background:#D4A843;color:#1B4332;text-decoration:none;font-weight:bold;font-size:16px;padding:16px 40px;border-radius:50px;">
          Redeem Your Gift &#8594;
        </a>
      </div>
      <div style="border-top:1px solid #eee;padding-top:24px;">
        <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:16px;">How to get started</div>
        <div style="font-size:14px;color:#4a4a4a;line-height:1.8;">
          1. Download Keepsay from the App Store or Google Play<br>
          2. Create your account<br>
          3. Go to Profile &#8594; Redeem a gift<br>
          4. Enter code <strong style="font-family:'Courier New',monospace;color:#1B4332;">${giftCode}</strong>
        </div>
      </div>
    </div>
    <div style="background:#f9f6f0;padding:24px 40px;text-align:center;border-top:1px solid #eee;">
      <div style="font-size:12px;color:#999;line-height:1.6;">
        Keepsay &#183; <a href="https://getkeepsay.com" style="color:#1B4332;">getkeepsay.com</a><br>
        Questions? Email us at <a href="mailto:hello@stubborngood.co" style="color:#1B4332;">hello@stubborngood.co</a>
      </div>
    </div>
  </div>
</body>
</html>`;

  return sendEmail({ to: recipientEmail, subject: `${gifterName} gave you Keepsay`, html });
}

async function sendReceiptEmail({ gifterEmail, gifterName, recipientName, tier, amount }) {
  const tierLabel = tier === 'pro_annual' ? 'Keepsay Pro — Annual' : 'Keepsay Pro — Monthly';
  const amountFormatted = '$' + (amount / 100).toFixed(2);

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f9f6f0;font-family:'Georgia',serif;">
  <div style="max-width:520px;margin:40px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
    <div style="background:#1B4332;padding:32px 40px;text-align:center;">
      <img src="https://www.getkeepsay.com/icon.png" alt="Keepsay" style="width:72px;height:72px;border-radius:16px;margin-bottom:12px;"><div style="font-family:'Georgia',serif;font-size:24px;color:#ffffff;">Keepsay</div><div style="color:#a8c5b5;font-size:14px;margin-top:4px;">Gift Receipt</div>
    </div>
    <div style="padding:36px 40px;">
      <p style="font-size:16px;color:#2d2d2d;margin:0 0 24px;">Hi ${gifterName}, your gift is on its way to ${recipientName}!</p>
      <div style="background:#f9f6f0;border-radius:8px;padding:20px 24px;margin:0 0 24px;">
        <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;">Order Summary</div>
        <div style="margin-bottom:8px;">
          <span style="font-size:15px;color:#3a3a3a;">${tierLabel}</span>
          &nbsp;&nbsp;
          <strong style="font-size:15px;color:#3a3a3a;">${amountFormatted}</strong>
        </div>
        <div style="font-size:13px;color:#888;">Gift for: ${recipientName}</div>
      </div>
      <p style="font-size:14px;color:#666;line-height:1.6;margin:0;">
        ${recipientName} will receive an email with their redemption code and instructions to get started. Questions? Email us at <a href="mailto:hello@stubborngood.co" style="color:#1B4332;">hello@stubborngood.co</a>.
      </p>
    </div>
    <div style="background:#f9f6f0;padding:20px 40px;text-align:center;border-top:1px solid #eee;">
      <div style="font-size:12px;color:#999;">Keepsay &#183; <a href="https://getkeepsay.com" style="color:#1B4332;">getkeepsay.com</a></div>
    </div>
  </div>
</body>
</html>`;

  return sendEmail({ to: gifterEmail, subject: `Your gift to ${recipientName} is confirmed`, html });
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
    const { type, gift_code, recipient_name, recipient_email, gifter_name, gifter_email, tier, message } = paymentIntent.metadata;

    if (type !== 'gift' || !gift_code) {
      return res.status(200).json({ received: true });
    }

    const redeemUrl = 'https://www.getkeepsay.com/redeem/' + gift_code;

    try {
      await Promise.all([
        sendGiftEmail({ recipientEmail: recipient_email, recipientName: recipient_name, gifterName: gifter_name, message: message || '', giftCode: gift_code, tier, redeemUrl }),
        sendReceiptEmail({ gifterEmail: gifter_email, gifterName: gifter_name, recipientName: recipient_name, tier, amount: paymentIntent.amount }),
      ]);
      console.log('Gift emails sent successfully for code:', gift_code);
    } catch (emailErr) {
      console.error('Email send error:', emailErr.message);
    }
  }

  return res.status(200).json({ received: true });
};




