#!/usr/bin/env node
// scripts/test-vault-endpoints-security.js — Event Vault endpoint SECURITY harness.
//
// Proves the 401/403 SECURITY claims a happy-path device test cannot reach:
//   • no token / garbage token       → 401 on BOTH endpoints
//   • non-owner valid token          → 403 on BOTH endpoints (against the REAL test vault)
//   • owner + SEALED vault           → get-vault-media 403 "sealed"  (THE SEAL)
//   • owner unlock                   → flips is_unlocked (idempotent one-way)
//   • owner + UNLOCKED vault         → get-vault-media 200
//   • set-dates                      → writes ONLY the close/unlock whitelist; 400 on a bad date
//
// It creates a THROWAWAY user + a THROWAWAY sealed vault to exercise the owner/seal
// paths, and only READ-PROBES the real test vault for the non-owner 403s (those
// return before any write) — so it NEVER unlocks or mutates your real test vault.
// Everything it creates is deleted at the end (vault first — creator_user_id →
// profiles is ON DELETE RESTRICT — then the throwaway auth user).
//
// ── HOW TO RUN (Patrick — needs the service key, which only you have) ──
//   In keepsay-web, with the service-role env available:
//     SUPABASE_SERVICE_KEY=... TEST_VAULT_TOKEN=<your real sealed test vault token> \
//       node scripts/test-vault-endpoints-security.js
//   SUPABASE_URL / SUPABASE_ANON_KEY default to the public production values below
//   (the anon key is public by design — ST35); override via env if needed.
//   API_BASE defaults to the live deployment.

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://amijtfctukogekemryjq.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFtaWp0ZmN0dWtvZ2VrZW1yeWpxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxMzM3NzAsImV4cCI6MjA5MTcwOTc3MH0.IvyqU5Ep5aJz5HNhqcf30ofBL-7JoCl0DLU3zcqYHcc';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const API_BASE = process.env.API_BASE || 'https://www.getkeepsay.com/api';
const REAL_VAULT_TOKEN = process.env.TEST_VAULT_TOKEN || '';

if (!SERVICE_KEY) { console.error('✗ SUPABASE_SERVICE_KEY required (only Patrick has it).'); process.exit(2); }
if (!REAL_VAULT_TOKEN) { console.error('✗ TEST_VAULT_TOKEN required (your real sealed test vault token).'); process.exit(2); }

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

let failures = 0;
function ok(m) { console.log('  ✓ ' + m); }
function bad(m) { console.log('  ✗ ' + m); failures++; }

async function call(endpoint, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}/${endpoint}`, { method: 'POST', headers, body: JSON.stringify(body) });
  let json = {};
  try { json = await res.json(); } catch (e) {}
  return { status: res.status, json };
}
function sameInstant(a, b) { return !!(a && b) && new Date(a).getTime() === new Date(b).getTime(); }
function expect(label, got, wantStatus, wantReasonSubstr) {
  const statusOk = got.status === wantStatus;
  const reasonOk = wantReasonSubstr == null
    || JSON.stringify(got.json || {}).toLowerCase().includes(String(wantReasonSubstr).toLowerCase());
  if (statusOk && reasonOk) ok(`${label} → ${got.status} ${JSON.stringify(got.json)}`);
  else bad(`${label} → got ${got.status} ${JSON.stringify(got.json)} (wanted ${wantStatus}${wantReasonSubstr ? ` incl "${wantReasonSubstr}"` : ''})`);
}

async function main() {
  const email = `keepsay-sectest+${Date.now()}@example.com`;
  const password = `Test!${Math.random().toString(36).slice(2)}Aa1`;
  let uid = null, throwawayVaultId = null, throwawayToken = null;
  let throwawayVaultToken = null;

  try {
    // ── Setup: throwaway user + its access token + a throwaway SEALED vault ──
    const { data: cu, error: cErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (cErr) throw new Error('createUser: ' + cErr.message);
    uid = cu.user.id;
    console.log(`\nSetup: throwaway user ${email} (${uid})`);

    const { data: sess, error: sErr } = await anon.auth.signInWithPassword({ email, password });
    if (sErr) throw new Error('signIn: ' + sErr.message);
    throwawayToken = sess.session.access_token;
    ok('minted throwaway (non-owner) access token');

    const nowY = new Date().getUTCFullYear();
    const { data: v, error: vErr } = await admin.from('event_vaults').insert({
      creator_user_id: uid,
      honoree_name: 'Security Harness',
      occasion_type: 'wedding',
      is_unlocked: false,
      contribution_closes_at: new Date(Date.UTC(nowY + 1, 0, 1)).toISOString(),
      unlocks_at: new Date(Date.UTC(nowY + 2, 0, 1)).toISOString(),
    }).select('id, vault_token, is_unlocked').single();
    if (vErr) throw new Error('insert vault: ' + vErr.message);
    throwawayVaultId = v.id;
    throwawayVaultToken = v.vault_token;
    ok(`created throwaway SEALED vault ${throwawayVaultToken}`);

    console.log('\n── Auth gate (401) ──');
    expect('event-vault-owner  no-token',  await call('event-vault-owner', { action: 'unlock', vaultToken: REAL_VAULT_TOKEN }, null), 401);
    expect('event-vault-owner  bad-token', await call('event-vault-owner', { action: 'unlock', vaultToken: REAL_VAULT_TOKEN }, 'not.a.jwt'), 401);
    expect('get-vault-media    no-token',  await call('get-vault-media', { vaultToken: REAL_VAULT_TOKEN }, null), 401);
    expect('get-vault-media    bad-token', await call('get-vault-media', { vaultToken: REAL_VAULT_TOKEN }, 'not.a.jwt'), 401);

    console.log('\n── Non-owner (403) against the REAL test vault — NON-MUTATING (ownership check precedes any write) ──');
    expect('unlock     non-owner', await call('event-vault-owner', { action: 'unlock', vaultToken: REAL_VAULT_TOKEN }, throwawayToken), 403, 'not your vault');
    expect('set-dates  non-owner', await call('event-vault-owner', { action: 'set-dates', vaultToken: REAL_VAULT_TOKEN, unlocksAt: new Date().toISOString() }, throwawayToken), 403, 'not your vault');
    expect('get-media  non-owner', await call('get-vault-media', { vaultToken: REAL_VAULT_TOKEN }, throwawayToken), 403, 'not your vault');

    console.log('\n── THE SEAL — owner + sealed throwaway vault → get-vault-media 403 ──');
    expect('get-media  owner/SEALED', await call('get-vault-media', { vaultToken: throwawayVaultToken }, throwawayToken), 403, 'sealed');

    console.log('\n── Owner unlock flips is_unlocked (idempotent one-way) — on the THROWAWAY vault ──');
    expect('unlock     owner (1st)', await call('event-vault-owner', { action: 'unlock', vaultToken: throwawayVaultToken }, throwawayToken), 200, '"is_unlocked":true');
    expect('unlock     owner (2nd, idempotent)', await call('event-vault-owner', { action: 'unlock', vaultToken: throwawayVaultToken }, throwawayToken), 200, 'alreadyunlocked');
    const { data: after } = await admin.from('event_vaults').select('is_unlocked').eq('id', throwawayVaultId).single();
    after && after.is_unlocked === true ? ok('DB confirms is_unlocked = true') : bad(`DB is_unlocked = ${after && after.is_unlocked}`);

    console.log('\n── Seal opens after unlock — owner + unlocked → get-vault-media 200 (0 messages) ──');
    expect('get-media  owner/UNLOCKED', await call('get-vault-media', { vaultToken: throwawayVaultToken }, throwawayToken), 200, '"count":0');

    console.log('\n── set-dates happy path — VALUES persist (stands alone, not device-dependent) ──');
    const futClose = new Date(Date.UTC(nowY + 3, 5, 15)).toISOString();   // Jun 15
    const futUnlock = new Date(Date.UTC(nowY + 4, 0, 20)).toISOString();  // Jan 20
    expect('set-dates  close + unlocks', await call('event-vault-owner', { action: 'set-dates', vaultToken: throwawayVaultToken, contributionClosesAt: futClose, unlocksAt: futUnlock }, throwawayToken), 200);
    {
      const { data: row } = await admin.from('event_vaults').select('contribution_closes_at, unlocks_at').eq('id', throwawayVaultId).single();
      (sameInstant(row.contribution_closes_at, futClose) && sameInstant(row.unlocks_at, futUnlock))
        ? ok(`both persisted — close=${row.contribution_closes_at}, unlocks=${row.unlocks_at}`)
        : bad(`persist mismatch — close=${row.contribution_closes_at} (want ${futClose}), unlocks=${row.unlocks_at} (want ${futUnlock})`);
    }
    // Suggested-opening-only save: change unlocks, leave close UNTOUCHED → close must NOT move.
    const futUnlock2 = new Date(Date.UTC(nowY + 4, 2, 3)).toISOString(); // Mar 3
    expect('set-dates  unlocks-only', await call('event-vault-owner', { action: 'set-dates', vaultToken: throwawayVaultToken, unlocksAt: futUnlock2 }, throwawayToken), 200);
    {
      const { data: row } = await admin.from('event_vaults').select('contribution_closes_at, unlocks_at').eq('id', throwawayVaultId).single();
      (sameInstant(row.unlocks_at, futUnlock2) && sameInstant(row.contribution_closes_at, futClose))
        ? ok(`unlocks moved, close untouched — close=${row.contribution_closes_at}, unlocks=${row.unlocks_at}`)
        : bad(`partial-update wrong — close=${row.contribution_closes_at} (want unchanged ${futClose}), unlocks=${row.unlocks_at} (want ${futUnlock2})`);
    }

    console.log('\n── set-dates whitelist + validation ──');
    // Try to sneak is_unlocked/tier/storage through set-dates → must be IGNORED.
    await call('event-vault-owner', { action: 'set-dates', vaultToken: throwawayVaultToken, unlocksAt: futUnlock2, is_unlocked: false, tier: 'complete', storage_limit_mb: 999999 }, throwawayToken);
    const { data: wl } = await admin.from('event_vaults').select('is_unlocked, tier, storage_limit_mb').eq('id', throwawayVaultId).single();
    (wl.is_unlocked === true && wl.tier === 'digital' && Number(wl.storage_limit_mb) === 25600)
      ? ok(`whitelist held — is_unlocked=${wl.is_unlocked}, tier=${wl.tier}, storage=${wl.storage_limit_mb} (non-whitelisted fields ignored)`)
      : bad(`whitelist LEAK — is_unlocked=${wl.is_unlocked}, tier=${wl.tier}, storage=${wl.storage_limit_mb}`);
    expect('set-dates  bad date → 400', await call('event-vault-owner', { action: 'set-dates', vaultToken: throwawayVaultToken, contributionClosesAt: 'not-a-date' }, throwawayToken), 400);

    // No-past close date: server backstop (added 2026-07-19). 400 once deployed; before
    // deploy the app-side DateEditModal guard still enforces it (200 here) — informational,
    // not a hard fail, so the harness is safe to run pre- OR post-deploy.
    const pastClose = await call('event-vault-owner', { action: 'set-dates', vaultToken: throwawayVaultToken, contributionClosesAt: '2000-01-01' }, throwawayToken);
    if (pastClose.status === 400) ok('server no-past backstop ACTIVE — past close-date rejected (400)');
    else if (pastClose.status === 200) console.log('  · NOTE: server no-past backstop not yet deployed (past date → 200). App-side guard still enforces it. Redeploy event-vault-owner to activate.');
    else bad(`past close-date → unexpected ${pastClose.status} ${JSON.stringify(pastClose.json)}`);

  } catch (e) {
    bad('harness error: ' + e.message);
  } finally {
    // Cleanup — vault BEFORE user (creator_user_id → profiles is ON DELETE RESTRICT).
    if (throwawayVaultId) { const { error } = await admin.from('event_vaults').delete().eq('id', throwawayVaultId); console.log(error ? '  ! vault cleanup: ' + error.message : '  · throwaway vault deleted'); }
    if (uid) { const { error } = await admin.auth.admin.deleteUser(uid); console.log(error ? '  ! user cleanup: ' + error.message : '  · throwaway user deleted'); }
  }

  console.log(`\n${failures === 0 ? '✅ ALL SECURITY ASSERTIONS PASSED' : `❌ ${failures} ASSERTION(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
