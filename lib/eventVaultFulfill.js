// lib/eventVaultFulfill.js — keepsay-web
// Core provisioning + vault-creation for Occasion Vault purchases, extracted
// from api/stripe-webhook.js so it can be exercised DIRECTLY with a synthetic
// payment-intent payload (see scripts/test-event-vault-fulfill.js) — the webhook
// endpoint itself can't be called without a real Stripe signature, and this is
// the novel, risky mechanic (auth-user provisioning + the RLS-linking uid) that
// most needs a deliberate test before anything is built on top of it.
//
// Plain CommonJS (no ESM `export`), so it's `require()`-able by both the webhook
// and a local test harness. Self-contained: its own service-role Supabase client
// from env, same pattern as every other api/ file in this repo.
//
// Owner-resolution correctness (verified live 2026-07-17): the on_auth_user_created
// trigger runs `INSERT INTO profiles (id, email, display_name) VALUES (new.id,
// new.email, ...)`, so profiles.email is populated transactionally for every
// account; the app has NO email-change feature (the only auth.updateUser call is
// for password), so profiles.email never diverges from auth.users.email; and a
// live count showed 52/52 profiles with a non-null email (0 nulls). So keying
// owner resolution off profiles.email is correct here — no auth.users RPC needed.

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Resolve the profiles.id that will own this vault (event_vaults.creator_user_id
// is NOT NULL REFERENCES profiles(id)). "Use current uid if present, else
// match-or-invite the AUTH user by email." Provisioning the auth user (not just a
// profiles row) is what makes in-app RLS link: the trigger creates the profiles
// row at profiles.id = the new auth uid, so when the buyer later signs in with
// this email, auth.uid() === creator_user_id and "couples read own vault" returns
// their vault. Inserting a bare profiles row would give a profiles.id that never
// equals any auth.uid() → the vault would be silently unreachable in-app.
async function resolveOwnerUid({ ownerUserId, ownerEmail }) {
  // 1. Buyer was signed in on the web and passed their uid — trust it directly.
  if (ownerUserId) return ownerUserId;

  const email = String(ownerEmail || '').trim().toLowerCase();
  if (!email) throw new Error('resolveOwnerUid: no ownerUserId and no ownerEmail');

  // 2. Match an existing account by email (see the correctness note at top —
  //    profiles.email is reliably populated and never stale in this app).
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
  //     concurrent request won the race, or an account the step-2 lookup missed).
  //     The trigger has by now ensured a profiles row exists — re-match.
  const { data: raced } = await supabase
    .from('profiles').select('id').eq('email', email).maybeSingle();
  if (raced && raced.id) return raced.id;

  // Unresolvable (rare). Fail LOUD so Stripe retries and it's visible in logs — a
  // manual account-link is the fallback, never a silent mis-link. (The
  // idempotency gate in fulfillEventVault makes the retry safe.)
  throw new Error('resolveOwnerUid: could not resolve or create owner for ' + email +
    (createErr ? ' — createUser: ' + createErr.message : ''));
}

// Provision (if needed) + create the event_vaults row for a succeeded payment.
// `paymentIntent` is a Stripe PaymentIntent-shaped object: { id, metadata }.
// Idempotent on stripe_payment_intent_id.
async function fulfillEventVault(paymentIntent) {
  const md = paymentIntent.metadata || {};
  const stripeId = paymentIntent.id;

  // ── IDEMPOTENCY GATE — before ANY side effect, especially createUser ──
  // payment_intent.succeeded can fire more than once (Stripe retries). If a vault
  // already exists for this intent, this is a duplicate delivery — no-op. Gating
  // here (not just before the insert) means a retry never mints a second AUTH
  // ACCOUNT, which is why it matters more here than for a plain row.
  const { data: already } = await supabase
    .from('event_vaults').select('id, vault_token').eq('stripe_payment_intent_id', stripeId).maybeSingle();
  if (already) {
    console.log('event_vault already fulfilled for intent', stripeId, '— skipping (idempotent)');
    return already;
  }

  const ownerUid = await resolveOwnerUid({ ownerUserId: md.owner_user_id, ownerEmail: md.owner_email });

  // Lean-checkout date defaults (locked 2026-07-17). The contribution window opens
  // FAR out so it never slams shut before the couple configures it; get-vault-info's
  // isOpen handles the closed state safely. unlocks_at is a DISPLAYED INTENTION
  // (unlock is couple-initiated, not date-triggered), safe as a placeholder until
  // they set the real date in the dashboard.
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
    .select('id, vault_token, creator_user_id')
    .single();
  if (insErr) throw insErr;

  return vault;
}

module.exports = { resolveOwnerUid, fulfillEventVault, supabase };
