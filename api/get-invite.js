// api/get-invite.js
// Server-side resolver for the public invite page (invite.html).
// Replaces invite.html's direct anon-key reads of invite_links, connections,
// and profiles. Runs with the service-role key (bypasses RLS) and returns ONLY
// { inviterName, code }. Mirrors the api/get-gift.js pattern.

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function buildName(profile) {
  if (profile && profile.display_name) return profile.display_name;
  return 'Someone';
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { code } = req.query;
  if (!code) return res.status(400).json({ error: 'Code required' });

  try {
    let fromUserId = null;
    let type = null; // 'reusable' | 'single' — lets the page keep its two wordings

    // 1) Reusable family invite link
    const { data: link } = await supabase
      .from('invite_links')
      .select('from_user_id')
      .eq('code', code)
      .maybeSingle();

    if (link) {
      fromUserId = link.from_user_id;
      type = 'reusable';
    } else {
      // 2) Single-use pending connection invite
      const { data: conn } = await supabase
        .from('connections')
        .select('from_user_id')
        .eq('invite_code', code)
        .eq('status', 'pending')
        .maybeSingle();
      if (conn) {
        fromUserId = conn.from_user_id;
        type = 'single';
      }
    }

    if (!fromUserId) return res.status(404).json({ error: 'Invite not found' });

    // Resolve inviter display name only — no id, no email returned.
    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('id', fromUserId)
      .maybeSingle();

    return res.status(200).json({
      code,
      type,
      inviterName: buildName(profile),
    });
  } catch (err) {
    console.error('Invite lookup error:', err);
    return res.status(500).json({ error: 'Lookup failed' });
  }
};
