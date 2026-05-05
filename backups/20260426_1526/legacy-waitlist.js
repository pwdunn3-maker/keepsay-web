const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email } = req.body;
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  try {
    // Upsert so duplicate emails don't cause errors
    const { error } = await supabase
      .from('legacy_waitlist')
      .upsert({ email: email.toLowerCase().trim(), source: 'gift_page' }, { onConflict: 'email' });

    if (error) {
      console.error('Waitlist error:', error);
      // Don't expose error to user — just succeed silently
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Waitlist handler error:', err);
    return res.status(200).json({ success: true }); // Always succeed to user
  }
};
