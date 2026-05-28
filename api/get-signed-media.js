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
    // Step 1 — look up the share token
    const { data: tokenData, error: tokenError } = await supabase
      .from('share_tokens')
      .select('entry_id')
      .eq('token', token)
      .single();

    if (tokenError || !tokenData) {
      return res.status(404).json({ error: 'Token not found', detail: tokenError?.message });
    }

    // Step 2 — fetch the entry (service role bypasses RLS)
    const { data: entry, error: entryError } = await supabase
      .from('entries')
      .select('recording_url, video_url, photo_url')
      .eq('id', tokenData.entry_id)
      .single();

    if (entryError || !entry) {
      return res.status(404).json({ error: 'Entry not found', detail: entryError?.message, entry_id: tokenData.entry_id });
    }

    const result = {};

    // Step 3 — generate signed URL for voice recording
    if (entry.recording_url) {
      const cleanPath = entry.recording_url.replace(/^\//, '');
      const { data: signedRecording, error: recError } = await supabase
        .storage
        .from('memories')
        .createSignedUrl(cleanPath, SIGNED_URL_EXPIRY);

      if (recError) {
        console.error('Recording signing error:', recError.message, 'path:', cleanPath);
      } else if (signedRecording?.signedUrl) {
        result.recording_url = signedRecording.signedUrl;
      }
    }

    // Step 4 — generate signed URL for video
    if (entry.video_url) {
      const cleanPath = entry.video_url.replace(/^\//, '');
      const { data: signedVideo, error: vidError } = await supabase
        .storage
        .from('memories')
        .createSignedUrl(cleanPath, SIGNED_URL_EXPIRY);

      if (vidError) {
        console.error('Video signing error:', vidError.message, 'path:', cleanPath);
      } else if (signedVideo?.signedUrl) {
        result.video_url = signedVideo.signedUrl;
      }
    }

    // Step 5 — generate signed URL for photo
    if (entry.photo_url) {
      const cleanPath = entry.photo_url.replace(/^\//, '');
      const { data: signedPhoto, error: photoError } = await supabase
        .storage
        .from('memories')
        .createSignedUrl(cleanPath, SIGNED_URL_EXPIRY);
      if (photoError) {
        console.error('Photo signing error:', photoError.message, 'path:', cleanPath);
      } else if (signedPhoto?.signedUrl) {
        result.photo_url = signedPhoto.signedUrl;
      }
    }
    return res.status(200).json(result);

  } catch (err) {
    console.error('get-signed-media error:', err);
    return res.status(500).json({ error: err.message });
  }
};
