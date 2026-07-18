#!/usr/bin/env node
// scripts/test-event-vault-fulfill.js — DELIBERATE, RUN-ONCE fulfillment test.
//
// Exercises lib/eventVaultFulfill.js against the LIVE Supabase project, covering
// BOTH owner-resolution branches, plus idempotency, then cleans up everything it
// created. This is the "synthetic run before Step 3" — it proves the novel
// mechanic (auth-user provisioning + the RLS-linking uid) without needing the
// landing page or a Stripe signature.
//
// ── HOW TO RUN (Patrick — needs the service key, which only you have) ──
//   In keepsay-web, with the service-role env available:
//     SUPABASE_URL=... SUPABASE_SERVICE_KEY=... EXISTING_ACCOUNT_EMAIL=you@example.com \
//       node scripts/test-event-vault-fulfill.js
//   (Or put SUPABASE_URL / SUPABASE_SERVICE_KEY in a local .env you source first.)
//   EXISTING_ACCOUNT_EMAIL must be an email that ALREADY has a Keepsay account
//   (e.g. your own) — Branch B checks it resolves to that existing uid with NO new
//   user created. If omitted, Branch B is skipped with a warning.
//
// SAFE: everything created is deleted at the end (in FK-correct order: vault
// first — event_vaults.creator_user_id → profiles is ON DELETE RESTRICT — then
// the throwaway auth user, which cascades its profile). Uses fake pi_/@example
// identifiers, never touches real customer data, and never sends email.

const { fulfillEventVault, resolveOwnerUid, supabase } = require('../lib/eventVaultFulfill');

const EXISTING_ACCOUNT_EMAIL = (process.env.EXISTING_ACCOUNT_EMAIL || '').trim().toLowerCase();
const THROWAWAY_EMAIL = `keepsay-vaulttest+${Date.now()}@example.com`;

const created = { vaultIds: [], authUserIds: [] };
let failures = 0;

function ok(msg) { console.log('  ✓ ' + msg); }
function bad(msg) { console.log('  ✗ ' + msg); failures++; }

function fakeIntent(overrides) {
  return {
    id: 'pi_test_' + Math.random().toString(36).slice(2) + '_' + Date.now(),
    metadata: Object.assign({
      type: 'event_vault',
      tier: 'digital',
      occasion_type: 'wedding',
      honoree_name: 'Test Honoree & Partner', // the & exercises HTML-escape downstream
    }, overrides),
  };
}

async function findAuthUserByEmail(email) {
  // No getUserByEmail in this supabase-js version; scan (fine for a one-off test).
  const { data } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
  return (data && data.users || []).find(u => (u.email || '').toLowerCase() === email) || null;
}

async function branchB_existingAccount() {
  console.log('\nBranch B — existing account (should resolve to existing uid, NO new user):');
  if (!EXISTING_ACCOUNT_EMAIL) { console.log('  ⚠ skipped (set EXISTING_ACCOUNT_EMAIL to run)'); return; }

  const { data: prof } = await supabase.from('profiles').select('id').eq('email', EXISTING_ACCOUNT_EMAIL).maybeSingle();
  if (!prof || !prof.id) { bad(`no profiles row for ${EXISTING_ACCOUNT_EMAIL} — is it a real account?`); return; }
  const expectedUid = prof.id;

  const intent = fakeIntent({ owner_email: EXISTING_ACCOUNT_EMAIL });
  const vault = await fulfillEventVault(intent);
  created.vaultIds.push(vault.id);

  if (vault.creator_user_id === expectedUid) ok(`resolved to existing uid ${expectedUid}`);
  else bad(`creator_user_id ${vault.creator_user_id} !== existing uid ${expectedUid}`);
  if (vault.vault_token) ok(`vault created, token ${vault.vault_token}`); else bad('no vault_token returned');
}

async function branchA_freshEmail() {
  console.log('\nBranch A — fresh email (should createUser + vault):');
  const before = await findAuthUserByEmail(THROWAWAY_EMAIL);
  if (before) { bad(`throwaway email ${THROWAWAY_EMAIL} already exists?!`); return; }

  const intent = fakeIntent({ owner_email: THROWAWAY_EMAIL });
  const vault = await fulfillEventVault(intent);
  created.vaultIds.push(vault.id);

  const after = await findAuthUserByEmail(THROWAWAY_EMAIL);
  if (after) { created.authUserIds.push(after.id); ok(`new auth user created ${after.id}`); }
  else { bad('no auth user created for throwaway email'); }
  if (after && vault.creator_user_id === after.id) ok('vault.creator_user_id === new uid (RLS will link on sign-in)');
  else bad(`creator_user_id ${vault.creator_user_id} !== new uid ${after && after.id}`);

  // Idempotency: re-run the SAME intent — must return the same vault, no 2nd user.
  console.log('  idempotency re-run (same intent id):');
  const usersBefore = (await supabase.auth.admin.listUsers({ page: 1, perPage: 200 })).data.users.length;
  const vault2 = await fulfillEventVault(intent);
  const usersAfter = (await supabase.auth.admin.listUsers({ page: 1, perPage: 200 })).data.users.length;
  if (vault2.id === vault.id) ok('same vault returned (idempotent)'); else bad(`different vault ${vault2.id}`);
  if (usersAfter === usersBefore) ok('no second auth user minted'); else bad(`user count changed ${usersBefore}→${usersAfter}`);
}

async function cleanup() {
  console.log('\nCleanup:');
  // Vaults FIRST (event_vaults.creator_user_id → profiles is ON DELETE RESTRICT,
  // so deleting the auth user while the vault exists would be blocked).
  for (const id of created.vaultIds) {
    const { error } = await supabase.from('event_vaults').delete().eq('id', id);
    if (error) bad(`vault ${id} delete failed: ${error.message}`); else ok(`vault ${id} deleted`);
  }
  // Then the throwaway auth users (cascades their profiles). Existing-account
  // users are NEVER deleted — only ones this test minted.
  for (const uid of created.authUserIds) {
    const { error } = await supabase.auth.admin.deleteUser(uid);
    if (error) bad(`auth user ${uid} delete failed: ${error.message}`); else ok(`auth user ${uid} deleted`);
  }
}

(async () => {
  console.log('=== Event Vault fulfillment test ===');
  console.log('Throwaway email:', THROWAWAY_EMAIL);
  try {
    await branchB_existingAccount();
    await branchA_freshEmail();
  } catch (e) {
    bad('threw: ' + e.message);
    console.error(e);
  } finally {
    try { await cleanup(); } catch (e) { bad('cleanup threw: ' + e.message); console.error(e); }
  }
  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED ✓' : `${failures} CHECK(S) FAILED ✗`));
  process.exit(failures === 0 ? 0 : 1);
})();
