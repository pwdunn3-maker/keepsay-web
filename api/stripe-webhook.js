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
// Occasion Vault fulfillment (payment_intent metadata.type === 'event_vault')
// ─────────────────────────────────────────────────────────────────────────────

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Resolve the profiles.id that will own this vault (creator_user_id is
// NOT NULL REFERENCES profiles(id)). "Use current uid if present, else
// match-or-invite the AUTH user by email" — provisioning the auth user (not
// just a profile row) is what makes in-app RLS link: the on_auth_user_created
// trigger creates the profiles row at profiles.id = the new auth uid (verified
// live 2026-07-17), so when the buyer later signs in with this email,
// auth.uid() === creator_user_id and "couples read own vault" returns their
// vault. Inserting a bare profiles row instead would give a profiles.id that
// never equals any auth.uid() → the vault would be silently unreachable in-app.
async function resolveOwnerUid({ ownerUserId, ownerEmail }) {
  // 1. Buyer was signed in on the web and passed their uid — trust it directly.
  if (ownerUserId) return ownerUserId;

  const email = String(ownerEmail || '').trim().toLowerCase();
  if (!email) throw new Error('resolveOwnerUid: no ownerUserId and no ownerEmail');

  // 2. Match an existing account by email. profiles.id === auth uid and
  //    profiles.email is populated (the app normalizes it lowercase at signup),
  //    so this is the reliable "does this person already have Keepsay?" check.
  const { data: existing } = await supabase
    .from('profiles').select('id').eq('email', email).maybeSingle();
  if (existing && existing.id) return existing.id;

  // 3. No account — provision a passwordless auth user. email_confirm:true so a
  //    later OTP sign-in isn't blocked by an unconfirmed email (ST45). The
  //    trigger creates the matching profiles row synchronously.
  const { data: created, error: createErr } =
    await supabase.auth.admin.createUser({ email, email_confirm: true });
  if (!createErr && created && created.user && created.user.id) return created.user.id;

  // 3b. createUser threw (almost always "email already registered" — a
  //     concurrent request won the race, or a pre-existing account whose
  //     profiles.email the step-2 lookup somehow missed). The trigger has by
  //     now ensured a profiles row exists for a normal account — re-match.
  const { data: raced } = await supabase
    .from('profiles').select('id').eq('email', email).maybeSingle();
  if (raced && raced.id) return raced.id;

  // Unresolvable (rare: an auth user with a null profiles.email). Fail LOUD so
  // Stripe retries and the failure is visible in logs — a manual account-link
  // is the fallback here, never a silent mis-link. (The idempotency gate makes
  // the retry safe.)
  throw new Error('resolveOwnerUid: could not resolve or create owner for ' + email +
    (createErr ? ' — createUser: ' + createErr.message : ''));
}

async function fulfillEventVault(paymentIntent) {
  const md = paymentIntent.metadata || {};
  const stripeId = paymentIntent.id;

  // ── IDEMPOTENCY GATE — before ANY side effect, especially createUser ──
  // payment_intent.succeeded can fire more than once (Stripe retries). If a
  // vault already exists for this intent, this is a duplicate delivery — no-op.
  // Gating here (not just before the insert) means a retry never mints a second
  // AUTH ACCOUNT, which is why it matters more here than for a plain row.
  const { data: already } = await supabase
    .from('event_vaults').select('id, vault_token').eq('stripe_payment_intent_id', stripeId).maybeSingle();
  if (already) {
    console.log('event_vault already fulfilled for intent', stripeId, '— skipping (idempotent)');
    return already;
  }

  const ownerUid = await resolveOwnerUid({ ownerUserId: md.owner_user_id, ownerEmail: md.owner_email });

  // Lean-checkout date defaults (locked 2026-07-17). The contribution window
  // opens FAR out so it never slams shut before the couple configures it;
  // get-vault-info's isOpen already handles the closed state safely. unlocks_at
  // is a DISPLAYED INTENTION (unlock is couple-initiated, not date-triggered),
  // safe as a placeholder until they set the real date in the dashboard.
  const now = Date.now();
  const closesAt  = new Date(now + 60  * 24 * 3600 * 1000).toISOString(); // +60 days
  const unlocksAt = new Date(now + 365 * 24 * 3600 * 1000).toISOString(); // +1 year (placeholder)

  const { data: vault, error: insErr } = await supabase
    .from('event_vaults')
    .insert({
      creator_user_id: ownerUid,
      honoree_name: md.honoree_name,
      occasion_type: md.occasion_type || 'wedding',
      contribution_closes_at: closesAt,
      unlocks_at: unlocksAt,
      tier: md.tier,
      storage_limit_mb: 25600, // 25 GB, both tiers (locked 2026-07-17)
      stripe_payment_intent_id: stripeId,
      // vault_token is minted by the column DEFAULT gen_random_uuid()::text
    })
    .select('id, vault_token')
    .single();
  if (insErr) throw insErr;

  return vault;
}

async function sendVaultConfirmationEmail({ ownerEmail, honoreeName, vaultToken, tier }) {
  const tierLabel = tier === 'gift_set' ? 'Wedding Vault — Gift Set' : 'Wedding Vault — Digital';
  const shareUrl = 'https://www.getkeepsay.com/vault/' + vaultToken;
  const honoree = escapeHtml(honoreeName);

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
      <p style="font-size:18px;color:#2d2d2d;margin:0 0 16px;">Your vault for <strong>${honoree}</strong> is open.</p>
      <p style="font-size:16px;color:#4a4a4a;line-height:1.6;margin:0 0 24px;">
        Share the link below with your guests. They can leave a sealed voice or video message &#8212; no app, no account, nothing to download. It stays sealed until you choose to open it.
      </p>
      <div style="background:#f0f7f4;border-radius:8px;padding:20px 24px;margin:0 0 28px;text-align:center;">
        <div style="font-size:12px;color:#1B4332;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;font-weight:bold;">Your guest link</div>
        <a href="${shareUrl}" style="font-size:15px;color:#1B4332;word-break:break-all;">${shareUrl}</a>
      </div>
      <div style="text-align:center;margin:0 0 32px;">
        <a href="${shareUrl}" style="display:inline-block;background:#D4A843;color:#1B4332;text-decoration:none;font-weight:bold;font-size:16px;padding:16px 40px;border-radius:50px;">
          Preview the guest page &#8594;
        </a>
      </div>
      <div style="border-top:1px solid #eee;padding-top:24px;">
        <div style="font-size:14px;color:#4a4a4a;line-height:1.7;">
          Your vault lives under <strong>${escapeHtml(ownerEmail)}</strong>. Sign in anytime at
          <a href="https://www.getkeepsay.com" style="color:#1B4332;">getkeepsay.com</a> with this email to manage it &#8212;
          set your contribution and reveal dates, see how many messages have come in, and open it when you're ready.
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

  return sendEmail({ to: ownerEmail, subject: 'Your Keepsay Wedding Vault is ready', html });
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




