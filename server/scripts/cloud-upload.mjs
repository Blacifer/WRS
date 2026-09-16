/**
 * Cloud copy of a backup — an S3-compatible PUT with nothing but Node
 * Indian Railways WRS Raipur
 *
 * A backup on a USB disk in another room protects against a dead PC. It does
 * not protect against the room. This puts the encrypted backup file — the
 * bytes exactly as they sit on the disk, AES-256 under a key the cloud never
 * sees — into an object-storage bucket, and then reads it back by HEAD and
 * compares the ETag (the MD5 of a single-part upload) with the MD5 of the
 * local file, so "uploaded" means "the same bytes are there".
 *
 * S3-compatible rather than one vendor: AWS in Mumbai (ap-south-1), any
 * Indian provider that speaks the S3 API, or a MinIO box the railway runs
 * itself all work with the same five settings. AWS Signature Version 4 is
 * implemented here in a hundred lines rather than pulled in as a 50 MB SDK,
 * because the bundle ships to a shop PC and every dependency is a thing that
 * can be wrong on it.
 *
 * Settings (environment or .env):
 *   WRS_CLOUD_ENDPOINT    https://s3.ap-south-1.amazonaws.com  (or the provider's)
 *   WRS_CLOUD_BUCKET      wrs-raipur-backups
 *   WRS_CLOUD_ACCESS_KEY  …
 *   WRS_CLOUD_SECRET_KEY  …
 *   WRS_CLOUD_REGION      ap-south-1   (default)
 *   WRS_CLOUD_PREFIX      raipur/      (optional; a folder inside the bucket)
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
const sha256Hex = (data) => crypto.createHash('sha256').update(data).digest('hex');
const md5Hex = (data) => crypto.createHash('md5').update(data).digest('hex');

/** RFC 3986 encoding, which S3 requires for the canonical URI and query. */
export function uriEncode(str, encodeSlash = true) {
  let out = '';
  for (const ch of str) {
    if (/[A-Za-z0-9\-_.~]/.test(ch) || (ch === '/' && !encodeSlash)) out += ch;
    else for (const b of Buffer.from(ch, 'utf8')) out += '%' + b.toString(16).toUpperCase().padStart(2, '0');
  }
  return out;
}

/**
 * AWS Signature Version 4 for one request. Pure, so it can be pinned against
 * the worked example in Amazon's own documentation.
 */
export function signV4({ method, host, pathName, query = '', headers, bodyHash, accessKey, secretKey, region, service = 's3', amzDate }) {
  const dateStamp = amzDate.slice(0, 8);
  const signedHeaderNames = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const canonicalHeaders = signedHeaderNames.map((h) => `${h}:${String(headers[Object.keys(headers).find((k) => k.toLowerCase() === h)]).trim().replace(/\s+/g, ' ')}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');
  const canonicalRequest = [method, uriEncode(pathName, false), query, canonicalHeaders, signedHeaders, bodyHash].join('\n');
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const kDate = hmac(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  void host;
  return {
    signature,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    canonicalRequest, stringToSign
  };
}

export function cloudSettings(env = process.env) {
  const endpoint = env.WRS_CLOUD_ENDPOINT, bucket = env.WRS_CLOUD_BUCKET, accessKey = env.WRS_CLOUD_ACCESS_KEY, secretKey = env.WRS_CLOUD_SECRET_KEY;
  if (!endpoint || !bucket || !accessKey || !secretKey) return null;
  return { endpoint: endpoint.replace(/\/+$/, ''), bucket, accessKey, secretKey, region: env.WRS_CLOUD_REGION || 'ap-south-1', prefix: (env.WRS_CLOUD_PREFIX || '').replace(/^\/+/, '') };
}

export async function signedFetch(settings, method, key, body, extraHeaders = {}) {
  const url = new URL(`${settings.endpoint}/${settings.bucket}/${key.split('/').map((s) => uriEncode(s)).join('/')}`);
  const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const bodyHash = body ? sha256Hex(body) : sha256Hex('');
  const headers = { host: url.host, 'x-amz-content-sha256': bodyHash, 'x-amz-date': amzDate, ...extraHeaders };
  const { authorization } = signV4({ method, host: url.host, pathName: url.pathname, query: '', headers, bodyHash, accessKey: settings.accessKey, secretKey: settings.secretKey, region: settings.region, amzDate });
  const sendHeaders = { ...headers, authorization };
  delete sendHeaders.host; // fetch sets it
  return fetch(url, { method, headers: sendHeaders, body });
}

/**
 * Upload one file and prove it arrived. Returns what the manifest records.
 * Throws with a plain reason on any failure — the caller decides whether a
 * failed cloud copy fails the backup (it does not: the local copy is made).
 */
export async function uploadAndVerify(settings, localPath, key) {
  const body = fs.readFileSync(localPath);
  const md5 = md5Hex(body);
  const put = await signedFetch(settings, 'PUT', key, body, { 'content-length': String(body.length), 'content-md5': Buffer.from(md5, 'hex').toString('base64') });
  if (!put.ok) throw new Error(`PUT ${key}: ${put.status} ${(await put.text().catch(() => '')).slice(0, 200)}`);
  const head = await signedFetch(settings, 'HEAD', key, null);
  if (!head.ok) throw new Error(`HEAD ${key} after upload: ${head.status}`);
  const etag = String(head.headers.get('etag') || '').replace(/"/g, '');
  const length = Number(head.headers.get('content-length'));
  if (length !== body.length) throw new Error(`${key}: the cloud holds ${length} bytes, the file is ${body.length}`);
  if (etag !== md5) throw new Error(`${key}: the cloud's ETag ${etag} is not the file's MD5 ${md5} — the bytes there are not these bytes`);
  return { key, bytes: body.length, md5, verifiedAt: new Date().toISOString() };
}

/** The manifest the readiness panel reads. Beside the backups, never in the cloud. */
export function manifestPath(backupDir) { return path.join(backupDir, 'cloud-manifest.json'); }

export function readManifest(backupDir) {
  try { return JSON.parse(fs.readFileSync(manifestPath(backupDir), 'utf8')); } catch { return { uploads: {} }; }
}

export function writeManifest(backupDir, manifest) {
  fs.writeFileSync(manifestPath(backupDir), JSON.stringify(manifest, null, 2) + '\n');
}

/**
 * Copy everything in the backup directory that is not yet in the cloud:
 * the database backups with their .hmac, and the photograph files. Each is
 * verified by ETag before it is recorded as uploaded.
 */
export async function syncBackupDirToCloud(settings, backupDir, log = () => {}) {
  const manifest = readManifest(backupDir);
  manifest.endpoint = settings.endpoint; manifest.bucket = settings.bucket; manifest.prefix = settings.prefix;
  manifest.uploads = manifest.uploads || {};
  const files = [];
  const walk = (dir, rel = '') => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name); const r = rel ? `${rel}/${name}` : name;
      if (fs.statSync(full).isDirectory()) walk(full, r);
      else if (/\.(enc|hmac)$/.test(name)) files.push({ full, rel: r });
    }
  };
  walk(backupDir);
  let uploaded = 0, skipped = 0; const failures = [];
  for (const f of files) {
    const key = `${settings.prefix}${f.rel}`;
    const stat = fs.statSync(f.full);
    const prior = manifest.uploads[key];
    if (prior && prior.bytes === stat.size && prior.mtimeMs === stat.mtimeMs) { skipped++; continue; }
    try {
      const rec = await uploadAndVerify(settings, f.full, key);
      manifest.uploads[key] = { ...rec, mtimeMs: stat.mtimeMs };
      uploaded++;
      log(`cloud: ${key} (${(rec.bytes / 1048576).toFixed(1)} MB) verified`);
    } catch (e) {
      failures.push(`${key}: ${e.message}`);
    }
  }
  const newestDb = files.filter((f) => /\.db\.enc$/.test(f.rel)).sort((a, b) => fs.statSync(b.full).mtimeMs - fs.statSync(a.full).mtimeMs)[0];
  manifest.lastRunAt = new Date().toISOString();
  manifest.newestBackup = newestDb ? { file: newestDb.rel, inCloud: Boolean(manifest.uploads[`${settings.prefix}${newestDb.rel}`]) } : null;
  manifest.failures = failures;
  writeManifest(backupDir, manifest);
  return { uploaded, skipped, failures, newestBackup: manifest.newestBackup };
}

/**
 * The newest database backup in the bucket, by name — the names carry the
 * timestamp (wrs_inspections_YYYYMMDD_HHMMSS.db.enc), so the greatest key is
 * the newest. ListObjectsV2 is XML; the keys are the only thing needed from it.
 */
export async function newestBackupInCloud(settings) {
  const url = new URL(`${settings.endpoint}/${settings.bucket}/`);
  url.search = `list-type=2&prefix=${encodeURIComponent(settings.prefix)}&max-keys=1000`;
  const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const bodyHash = sha256Hex('');
  const headers = { host: url.host, 'x-amz-content-sha256': bodyHash, 'x-amz-date': amzDate };
  const query = `list-type=2&max-keys=1000&prefix=${uriEncode(settings.prefix)}`;
  const { authorization } = signV4({ method: 'GET', host: url.host, pathName: url.pathname, query, headers, bodyHash, accessKey: settings.accessKey, secretKey: settings.secretKey, region: settings.region, amzDate });
  const listUrl = `${settings.endpoint}/${settings.bucket}/?${query}`;
  const res = await fetch(listUrl, { headers: { 'x-amz-content-sha256': bodyHash, 'x-amz-date': amzDate, authorization } });
  if (!res.ok) throw new Error(`list ${settings.bucket}: ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const xml = await res.text();
  const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]).filter((k) => /\.db\.enc$/.test(k)).sort();
  return keys.length ? keys[keys.length - 1] : null;
}

/** Download one object to a local file. */
export async function download(settings, key, localPath) {
  const res = await signedFetch(settings, 'GET', key, null);
  if (!res.ok) throw new Error(`GET ${key}: ${res.status}`);
  fs.writeFileSync(localPath, Buffer.from(await res.arrayBuffer()));
}
