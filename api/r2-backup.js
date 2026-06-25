const { createClient } = require('@supabase/supabase-js');
const { S3Client, HeadObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;

const SUPABASE_BUCKET = 'memories';

// R2's S3-compatible API requires AWS SigV4 signing (access key id + secret),
// NOT a Bearer token. The S3Client signs every request for us.
const s3 = new S3Client({
  region: 'auto',
  endpoint: 'https://' + R2_ACCOUNT_ID + '.r2.cloudflarestorage.com',
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

// Recursively list every file in a Supabase Storage bucket. Items with an `id`
// are files; items without are folders to descend into.
async function listSupabaseFiles(supabase, bucket, prefix, allFiles) {
  if (!prefix) prefix = '';
  if (!allFiles) allFiles = [];
  const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 1000, offset: 0 });
  if (error) throw error;
  for (const item of (data || [])) {
    const path = prefix ? prefix + '/' + item.name : item.name;
    if (item.id) {
      allFiles.push(path);
    } else {
      await listSupabaseFiles(supabase, bucket, path, allFiles);
    }
  }
  return allFiles;
}

async function fileExistsInR2(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }));
    return true;
  } catch (e) {
    const code = e && e.$metadata ? e.$metadata.httpStatusCode : undefined;
    if (e.name === 'NotFound' || code === 404) return false;
    // A 401/403 (bad creds/permissions) is a REAL error — surface it instead of
    // silently treating the object as missing (that masked the original bug).
    throw e;
  }
}

function contentTypeFor(filePath) {
  const ext = (filePath.split('.').pop() || '').toLowerCase();
  if (ext === 'mp4' || ext === 'mov') return 'video/mp4';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'm4a' || ext === 'aac') return 'audio/mp4';
  if (ext === 'mp3') return 'audio/mpeg';
  return 'application/octet-stream';
}

module.exports = async function handler(req, res) {
  try {
    if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
      console.error('r2-backup: missing R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY');
      return res.status(500).json({ error: 'Missing R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY env vars' });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const files = await listSupabaseFiles(supabase, SUPABASE_BUCKET);

    let copied = 0, skipped = 0, failed = 0;
    const errors = [];

    for (const filePath of files) {
      try {
        if (await fileExistsInR2(filePath)) { skipped++; continue; }

        const { data, error } = await supabase.storage.from(SUPABASE_BUCKET).download(filePath);
        if (error || !data) { failed++; errors.push(filePath + ': download failed'); continue; }

        const buffer = Buffer.from(await data.arrayBuffer());
        await s3.send(new PutObjectCommand({
          Bucket: R2_BUCKET_NAME,
          Key: filePath,
          Body: buffer,
          ContentType: contentTypeFor(filePath),
        }));
        copied++;
      } catch (e) {
        failed++;
        errors.push(filePath + ': ' + (e.name || '') + ' ' + e.message);
        console.error('r2-backup file error:', filePath, e.message);
      }
    }

    const summary = {
      total: files.length, copied, skipped, failed,
      timestamp: new Date().toISOString(),
    };
    if (errors.length) summary.errors = errors.slice(0, 10);

    // Log the summary every run so the backup is no longer "silent" — the counts
    // show up in Vercel logs. And if EVERY file failed (the all-broken case, like
    // the old Bearer-auth bug), return 500 so the cron is visibly marked failed
    // instead of masquerading as a clean 200.
    const allFailed = files.length > 0 && copied === 0 && failed > 0;
    console[allFailed ? 'error' : 'log']('r2-backup summary:', JSON.stringify(summary));
    return res.status(allFailed ? 500 : 200).json(Object.assign({ success: !allFailed }, summary));
  } catch (e) {
    console.error('r2-backup fatal:', e.message);
    return res.status(500).json({ error: e.message });
  }
};
