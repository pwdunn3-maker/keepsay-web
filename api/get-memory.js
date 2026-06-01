// api/get-memory.js
// Server-side resolver for the public memory page (memory.html).
// Replaces memory.html's direct anon-key reads of shared_memories, entries,
// profiles, and share_tokens. Runs with the service-role key (bypasses RLS)
// and returns ONLY whitelisted fields. Mirrors the api/get-gift.js pattern.

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Build a display name without ever returning the raw email to the client.
function buildSenderName(profile) {
  if (!profile) return 'Someone special';
  if (profile.display_name) return profile.display_name;
  if (profile.email) return profile.email.split('@')[0];
  return 'Someone special';
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // memory.html has two entry points:
  //   ?token=<share_tokens.token>   (QR / share-link path)
  //   ?id=<shared_memories.id UUID> (shared-to-a-person path)
  const { id, token } = req.query;
  if (!id && !token) return res.status(400).json({ error: 'id or token required' });

  try {
    let entryId = null;
    let senderUserId = null;
    let recipientName = null;  // from share_tokens (QR path)
    let sharedMessage = null;  // from shared_memories (shared path)
    let mediaToken = token || null; // fed to /api/get-signed-media

    if (token) {
      // ── QR / share-token path ──
      const { data: tok } = await supabase
        .from('share_tokens')
        .select('entry_id, user_id, recipient_name')
        .eq('token', token)
        .maybeSingle();
      if (!tok) return res.status(404).json({ error: 'Memory not found' });
      entryId = tok.entry_id;
      senderUserId = tok.user_id;
      recipientName = tok.recipient_name || null;
    } else {
      // ── Shared-memory UUID path ──
      const { data: shared } = await supabase
        .from('shared_memories')
        .select('entry_id, from_user_id, message')
        .eq('id', id)
        .maybeSingle();
      if (!shared) return res.status(404).json({ error: 'Memory not found' });
      entryId = shared.entry_id;
      senderUserId = shared.from_user_id;
      sharedMessage = shared.message || null;

      // Find a media token for this entry so the page can still call
      // get-signed-media without reading share_tokens itself.
      const { data: tok } = await supabase
        .from('share_tokens')
        .select('token')
        .eq('entry_id', entryId)
        .limit(1)
        .maybeSingle();
      mediaToken = tok ? tok.token : null;
    }

    if (!entryId) return res.status(404).json({ error: 'Memory not found' });

    // Load the entry — only the fields the page actually renders.
    const { data: entry } = await supabase
      .from('entries')
      .select('id, title, body, created_at, emotion, is_locked, unlock_date, recording_url')
      .eq('id', entryId)
      .maybeSingle();
    if (!entry) return res.status(404).json({ error: 'Memory not found' });

    // Resolve the sender's display name. The email is read here but NEVER
    // returned — only the computed name leaves the server.
    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name, email')
      .eq('id', senderUserId)
      .maybeSingle();
    const senderName = buildSenderName(profile);

    // Time-lock is now enforced SERVER-SIDE. Previously memory.html received the
    // full body and just hid it in JS while locked — i.e. the body shipped to the
    // browser anyway. Now, if still locked, the content never leaves the server.
    const stillLocked =
      !!entry.is_locked && !!entry.unlock_date && new Date() < new Date(entry.unlock_date);

    if (stillLocked) {
      return res.status(200).json({
        locked: true,
        unlock_date: entry.unlock_date,
        senderName,
        recipientName,
      });
    }

    return res.status(200).json({
      locked: false,
      entry_id: entry.id,
      title: entry.title,
      body: entry.body,
      created_at: entry.created_at,
      emotion: entry.emotion,
      has_recording: !!entry.recording_url, // for hero-layout decision in the page
      senderName,
      recipientName,
      sharedMessage,
      mediaToken, // page calls /api/get-signed-media?token=<mediaToken>
    });
  } catch (err) {
    console.error('Memory lookup error:', err);
    return res.status(500).json({ error: 'Lookup failed' });
  }
};
