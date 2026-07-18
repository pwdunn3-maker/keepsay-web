// api/get-vault-info.js — keepsay-web
// Public, unauthenticated resolver for the Occasion Vault contributor page
// (vault/[token].html). Mirrors the get-memory.js pattern: service-role
// client, explicit field whitelist, NEVER returns any recording content or
// contribution data — just enough to render the invite + gate recording.
//
// Depends on the `event_vaults` table (renamed from `wedding_vaults`
// 2026-07-17 when the vault went occasion-generic — the mechanism serves any
// occasion; `occasion_type` discriminates, `honoree_name` replaced
// `couple_name`). DEPLOYED and live. Authoritative schema record:
// docs/sql/event_vault_schema.md in luminary-legacy.

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token required' });

  try {
    const { data: vault, error } = await supabase
      .from('event_vaults')
      .select('honoree_name, contribution_closes_at, unlocks_at, is_unlocked, storage_used_mb, storage_limit_mb')
      .eq('vault_token', token)
      .maybeSingle();

    if (error) {
      console.error('get-vault-info lookup error:', error.message);
      return res.status(500).json({ error: 'Lookup failed', reason: 'lookup_failed' });
    }
    // `reason` is the CANONICAL field the client keys off of for every error /
    // gated state (vault/[token].html's showError() takes exactly one of
    // 'invalid_token' | 'window_closed' | 'storage_full' | 'lookup_failed').
    // Earlier this endpoint left the client to re-derive that string itself
    // from the HTTP status plus the isOpen/storageFull booleans — fragile,
    // and inconsistent with submit-vault-contribution.js, which already
    // returns an explicit `reason`. Always send `reason` so the client never
    // has to infer it.
    if (!vault) return res.status(404).json({ error: 'Vault not found', reason: 'invalid_token' });

    const now = new Date();
    // The contribution window is open only while the closing date hasn't
    // passed AND the owner hasn't already unlocked the vault. (Locked
    // decision: recordings stop being accepted once the seal is broken.)
    const isOpen = !vault.is_unlocked && now < new Date(vault.contribution_closes_at);
    const storageFull = Number(vault.storage_used_mb || 0) >= Number(vault.storage_limit_mb || 0);

    let reason = null;
    if (storageFull) reason = 'storage_full';
    else if (!isOpen) reason = 'window_closed';

    // WHITELIST: only these fields leave the server. Never recording_url,
    // never contributor data, never storage byte counts — just enough for
    // the contributor page to render its invite / error states.
    return res.status(200).json({
      honoreeName: vault.honoree_name,
      isOpen,
      contributionClosesAt: vault.contribution_closes_at,
      storageFull,
      reason, // null when the vault is open and accepting messages
    });
  } catch (err) {
    console.error('get-vault-info error:', err);
    return res.status(500).json({ error: 'Lookup failed', reason: 'lookup_failed' });
  }
};
