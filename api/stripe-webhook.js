const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');
const QRCode = require('qrcode');
// Occasion Vault fulfillment (auth-user provisioning + event_vaults insert) lives
// in a require()-able module so it can be unit-tested directly with a synthetic
// payment intent — see lib/eventVaultFulfill.js + scripts/test-event-vault-fulfill.js.
const { fulfillEventVault } = require('../lib/eventVaultFulfill');

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

async function sendEmail({ to, subject, html, attachments }) {
  const payload = {
    personalizations: [{ to: [{ email: to }] }],
    from: { email: 'hello@stubborngood.co', name: 'Keepsay' },
    subject,
    content: [{ type: 'text/html', value: html }],
  };
  // Optional SendGrid attachments (e.g. an inline QR referenced via cid).
  if (attachments && attachments.length) payload.attachments = attachments;

  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error('SendGrid error: ' + err);
  }

  return true;
}

async function sendGiftEmail({ recipientEmail, recipientName, gifterName, message, giftCode, tier, redeemUrl }) {
  const tierLabel = tier === 'legacy_annual' ? 'Keepsay Legacy — Annual' : 'Keepsay Pro — Annual';

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
  const tierLabel = tier === 'legacy_annual' ? 'Keepsay Legacy — Annual' : 'Keepsay Pro — Annual';
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

// ─────────────────────────────────────────────────────────────────────────────
// Occasion Vault confirmation email (fulfillment itself is in
// lib/eventVaultFulfill.js; this is transport-only and best-effort)
// ─────────────────────────────────────────────────────────────────────────────

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatFriendlyDate(iso) {
  // UTC-anchored: contribution_closes_at is derived from the wedding calendar
  // date at UTC midnight, so format in UTC to render the intended calendar day
  // (avoids the timezone off-by-one, ST58 family).
  try {
    return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
  } catch (e) { return ''; }
}

async function sendVaultConfirmationEmail({ ownerEmail, honoreeName, vaultToken, tier, contributionClosesAt }) {
  const isComplete = tier === 'complete';
  const tierLabel = isComplete ? 'Wedding Vault — Complete' : 'Wedding Vault — Digital';
  const shareUrl = 'https://www.getkeepsay.com/vault/' + vaultToken;
  const honoree = escapeHtml(honoreeName);
  const closesFriendly = formatFriendlyDate(contributionClosesAt);
  const closesLine = closesFriendly
    ? `<p style="font-size:13.5px;color:#666;margin:12px 0 0;">Guests can leave messages until ${escapeHtml(closesFriendly)}.</p>`
    : '';

  // Both tiers now carry a grant (Digital = a year of Pro, Complete = a year of
  // Legacy). Honest-minimal note, no getkeepsay.com sign-in promise — it's used
  // in the Keepsay app.
  const grantBlock = isComplete ? `
      <div style="background:#f0f7f4;border-radius:8px;padding:18px 22px;margin:0 0 28px;">
        <div style="font-size:12px;color:#1B4332;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;font-weight:bold;">Also included</div>
        <p style="font-size:14.5px;color:#3a3a3a;line-height:1.6;margin:0;">A full year of <strong>Keepsay Legacy</strong> is attached to this email &#8212; video, AI writing help, and your own private Vault, through your first anniversary. You&#39;ll use it in the Keepsay app.</p>
      </div>` : `
      <div style="background:#f0f7f4;border-radius:8px;padding:18px 22px;margin:0 0 28px;">
        <div style="font-size:12px;color:#1B4332;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;font-weight:bold;">Also included</div>
        <p style="font-size:14.5px;color:#3a3a3a;line-height:1.6;margin:0;">A year of <strong>Keepsay Pro</strong> is attached to this email, through your first anniversary. You&#39;ll use it in the Keepsay app.</p>
      </div>`;

  // Printable guest-link QR as an INLINE attachment (referenced via cid).
  // Best-effort: if generation fails, the prominent text link + button above
  // still carry the vault — never let a QR hiccup break the confirmation email.
  let attachments;
  let qrBlock = '';
  try {
    const qrBuffer = await QRCode.toBuffer(shareUrl, { type: 'png', errorCorrectionLevel: 'H', margin: 2, width: 600 });
    attachments = [{
      content: qrBuffer.toString('base64'),
      type: 'image/png',
      filename: 'keepsay-vault-qr.png',
      disposition: 'inline',
      content_id: 'guestqr',
    }];
    qrBlock = `
      <div style="text-align:center;margin:0 0 32px;">
        <div style="font-size:12px;color:#1B4332;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;font-weight:bold;">Print this QR for your guests</div>
        <img src="cid:guestqr" alt="Scan to leave a message" width="200" height="200" style="width:200px;height:200px;border:1px solid #eee;border-radius:8px;padding:10px;background:#ffffff;">
      </div>`;
  } catch (qrErr) {
    console.error('vault confirmation QR generation failed (link still sent):', qrErr.message);
  }

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f9f6f0;font-family:'Georgia',serif;">
  <div style="max-width:560px;margin:40px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
    <div style="background:#1B4332;padding:40px 40px 32px;text-align:center;">
      <img src="https://www.getkeepsay.com/icon.png" alt="Keepsay" style="width:72px;height:72px;border-radius:16px;margin-bottom:12px;"><div style="font-family:'Georgia',serif;font-size:28px;color:#ffffff;letter-spacing:1px;">Keepsay</div>
      <div style="color:#a8c5b5;font-size:14px;margin-top:6px;">Your Wedding Vault is ready</div>
    </div>
    <div style="padding:40px;">
      <p style="font-size:18px;color:#2d2d2d;margin:0 0 16px;">Your vault for <strong>${honoree}</strong> is sealed and ready.</p>
      <p style="font-size:16px;color:#4a4a4a;line-height:1.6;margin:0 0 24px;">
        Share the link below with your guests. They can leave a sealed voice or video message &#8212; no app, no account, nothing to download. It stays sealed until you choose to open it.
      </p>
      <div style="background:#f0f7f4;border-radius:8px;padding:20px 24px;margin:0 0 28px;text-align:center;">
        <div style="font-size:12px;color:#1B4332;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;font-weight:bold;">Your guest link</div>
        <a href="${shareUrl}" style="font-size:15px;color:#1B4332;word-break:break-all;">${shareUrl}</a>
        ${closesLine}
      </div>
      <div style="text-align:center;margin:0 0 32px;">
        <a href="${shareUrl}" style="display:inline-block;background:#D4A843;color:#1B4332;text-decoration:none;font-weight:bold;font-size:16px;padding:16px 40px;border-radius:50px;">
          Preview the guest page &#8594;
        </a>
      </div>
      ${qrBlock}
      ${grantBlock}
      <div style="border-top:1px solid #eee;padding-top:24px;">
        <div style="font-size:14px;color:#4a4a4a;line-height:1.7;">
          Your vault for <strong>${honoree}</strong> is created and sealed. Your vault stays sealed until you open it &#8212; no subscription is ever required to open your own vault. Managing your vault (setting your dates, opening it) is coming to the Keepsay app; we&#39;ll email you the moment it&#39;s ready. Keep this email &#8212; it&#39;s your key to everything. Questions? <a href="mailto:hello@stubborngood.co" style="color:#1B4332;">hello@stubborngood.co</a>
        </div>
      </div>
    </div>
    <div style="background:#f9f6f0;padding:24px 40px;text-align:center;border-top:1px solid #eee;">
      <div style="font-size:12px;color:#999;line-height:1.6;">
        ${escapeHtml(tierLabel)} &#183; Keepsay &#183; <a href="https://getkeepsay.com" style="color:#1B4332;">getkeepsay.com</a><br>
        Questions? Email us at <a href="mailto:hello@stubborngood.co" style="color:#1B4332;">hello@stubborngood.co</a>
      </div>
    </div>
  </div>
</body>
</html>`;

  return sendEmail({ to: ownerEmail, subject: 'Your Keepsay Wedding Vault is ready', html, attachments });
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
    const md = paymentIntent.metadata || {};

    // ── Occasion Vault purchase ──
    // Provision (auth user if needed) + create the event_vaults row + email the
    // share kit. All deferred to here so an abandoned checkout provisions
    // nothing (create-event-vault-payment.js writes nothing at intent time).
    if (md.type === 'event_vault') {
      let vault;
      try {
        vault = await fulfillEventVault(paymentIntent);
      } catch (fulfillErr) {
        console.error('event_vault fulfillment failed for intent', paymentIntent.id, fulfillErr.message);
        // Visibility monitor (concierge scale): the buyer PAID but has no vault.
        // Alert internally so a persistently-stuck purchase can be hand-created
        // from the Stripe payment. Best-effort — never let the alert itself throw
        // and swallow the 500 (which is what triggers Stripe's safe retry).
        // NOTE: fires on the FIRST failure even when a later retry self-heals, so
        // a transient blip yields a "failed → then fine" alert. At this volume
        // that mild over-alerting is the right trade vs. missing a stuck purchase.
        try {
          await sendEmail({
            to: 'hello@stubborngood.co',
            subject: '⚠️ Event vault fulfillment failed — may need manual creation',
            html:
              '<p>An event-vault purchase <strong>succeeded in Stripe</strong> but fulfillment failed. ' +
              'The buyer has paid and has no vault yet.</p>' +
              '<p><strong>Payment intent:</strong> ' + escapeHtml(paymentIntent.id) + '<br>' +
              '<strong>Owner email:</strong> ' + escapeHtml(md.owner_email || '(none)') + '<br>' +
              '<strong>Honoree:</strong> ' + escapeHtml(md.honoree_name || '(none)') + '<br>' +
              '<strong>Tier:</strong> ' + escapeHtml(md.tier || '(none)') + '<br>' +
              '<strong>Error:</strong> ' + escapeHtml(fulfillErr.message) + '</p>' +
              '<p>Stripe retries automatically; if it self-heals no follow-up is sent. ' +
              'If it persists, create the vault manually from the Stripe payment.</p>',
          });
        } catch (alertErr) {
          console.error('event_vault fulfillment ALERT email also failed:', alertErr.message);
        }
        // Return 500 so Stripe RETRIES — the idempotency gate in
        // fulfillEventVault makes the retry safe (never a second account/vault).
        return res.status(500).json({ error: 'fulfillment_failed' });
      }
      // The vault exists; the confirmation email is best-effort. If it fails the
      // owner can still reach the vault by signing in — never fail the webhook
      // (and trigger a retry that re-runs fulfillment) over an email hiccup.
      try {
        await sendVaultConfirmationEmail({
          ownerEmail: md.owner_email,
          honoreeName: md.honoree_name,
          vaultToken: vault.vault_token,
          tier: md.tier,
          contributionClosesAt: vault.contribution_closes_at,
        });
      } catch (emailErr) {
        console.error('event_vault confirmation email failed (vault OK):', emailErr.message);
      }
      console.log('event_vault fulfilled:', vault.id, 'token', vault.vault_token);
      return res.status(200).json({ received: true });
    }

    // ── Gift purchase (unchanged) ──
    const { type, gift_code, recipient_name, recipient_email, gifter_name, gifter_email, tier, message } = md;

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




