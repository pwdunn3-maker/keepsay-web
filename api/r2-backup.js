const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_TOKEN = process.env.R2_ACCESS_TOKEN;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;

function getR2Endpoint() { return 'https://' + R2_ACCOUNT_ID + '.r2.cloudflarestorage.com'; }

async function listSupabaseFiles(supabase, bucket, prefix, allFiles) {
  if (!prefix) prefix = '';
  if (!allFiles) allFiles = [];
  const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 1000, offset: 0 });
  if (error) throw error;
  for (const item of (data || [])) {
    if (item.id) {
      allFiles.push(prefix ? prefix + '/' + item.name : item.name);
    } else {
      await listSupabaseFiles(supabase, bucket, prefix ? prefix + '/' + item.name : item.name, allFiles);
    }
  }
  return allFiles;
}

async function fileExistsInR2(key) {
  const url = getR2Endpoint() + '/' + R2_BUCKET_NAME + '/' + key;
  const res = await fetch(url, { method: 'HEAD', headers: { 'Authorization': 'Bearer ' + R2_ACCESS_TOKEN } });
  return res.ok;
}

async function copyToR2(key, fileBuffer, contentType) {
  const url = getR2Endpoint() + '/' + R2_BUCKET_NAME + '/' + key;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Authorization': 'Bearer ' + R2_ACCESS_TOKEN, 'Content-Type': contentType || 'application/octet-stream' },
    body: fileBuffer,
  });
  return res.ok;
}

module.exports = async function handler(req, res) {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const files = await listSupabaseFiles(supabase, 'memories');
    let copied = 0, skipped = 0, failed = 0;
    for (const filePath of files) {
      try {
        const exists = await fileExistsInR2(filePath);
        if (exists) { skipped++; continue; }
        const { data, error } = await supabase.storage.from('memories').download(filePath);
        if (error || !data) { failed++; continue; }
        const buffer = await data.arrayBuffer();
        const ext = filePath.split('.').pop().toLowerCase();
        const contentType = ext === 'mp4' ? 'video/mp4' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'png' ? 'image/png' : 'application/octet-stream';
        const success = await copyToR2(filePath, buffer, contentType);
        if (success) copied++; else failed++;
      } catch (e) {
        console.error('Error processing file:', filePath, e.message);
        failed++;
      }
    }
    return res.status(200).json({ success: true, total: files.length, copied, skipped, failed, timestamp: new Date().toISOString() });
  } catch (e) {
    console.error('Backup error:', e.message);
    return res.status(500).json({ error: e.message });
  }
};
