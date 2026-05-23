const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const SIGNED_URL_EXPIRY = 3600; // 1 hour — regenerated fresh on every scan

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token required' });

  try {
    // Look up the share token to get entry_id
    const { data: tokenData, error: tokenError } = await supabase
      .from('share_tokens')
      .select('entry_id')
      .eq('token', token)
      .single();

    if (tokenError || !tokenData) {
      return res.status(404).json({ error: 'Token not found' });
    }

    // Fetch the entry
    const { data: entry, error: entryError } = await supabase
      .from('entries')
      .select('recording_url, recording_uri, video_url')
      .eq('id', tokenData.entry_id)
      .single();

    if (entryError || !entry) {
      return res.status(404).json({ error: 'Entry not found' });
    }

    const result = {};

    // Generate signed URL for voice recording
    const recordingPath = entry.recording_url || entry.recording_uri;
    if (recordingPath) {
      // Strip any leading slash
      const cleanPath = recordingPath.replace(/^\//, '');
      const { data: signedRecording, error: recError } = await supabase
        .storage
        .from('memories')
        .createSignedUrl(cleanPath, SIGNED_URL_EXPIRY);

      if (!recError && signedRecording?.signedUrl) {
        result.recording_url = signedRecording.signedUrl;
      }
    }

    // Generate signed URL for video
    if (entry.video_url) {
      const cleanPath = entry.video_url.replace(/^\//, '');
      const { data: signedVideo, error: vidError } = await supabase
        .storage
        .from('memories')
        .createSignedUrl(cleanPath, SIGNED_URL_EXPIRY);

      if (!vidError && signedVideo?.signedUrl) {
        result.video_url = signedVideo.signedUrl;
      }
    }

    return res.status(200).json(result);

  } catch (err) {
    console.error('get-signed-media error:', err);
    return res.status(500).json({ error: err.message });
  }
};
