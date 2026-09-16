#!/usr/bin/env node
/**
 * Refresh the read-only mirror from the newest cloud backup
 * Indian Railways WRS Raipur
 *
 * Runs where the DRM's mirror runs (a small VM, or a PC at division HQ),
 * on a schedule — hourly, nightly, whatever the office wants. It lists the
 * bucket the shop backs up to, takes the newest encrypted backup and its
 * .hmac, restores them beside the mirror's database with the same key the
 * shop uses, swaps the file in, and drops a flag so the mirror server
 * reopens it. Nothing here writes to the bucket; the mirror only reads.
 *
 *   WRS_CLOUD_* (same as the shop), WRS_BACKUP_KEY_FILE (a copy of the shop's key)
 *   node --experimental-strip-types server/scripts/mirror-refresh.mjs [mirror_db_path]
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { cloudSettings, newestBackupInCloud, download } from './cloud-upload.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
for (const candidate of [path.join(here, '..', '.env'), path.join(here, '..', '..', '.env')]) {
  try {
    for (const line of fs.readFileSync(candidate, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
    }
  } catch { /* no .env here */ }
}

const log = (m) => console.log(`[mirror-refresh] ${m}`);
const fail = (m) => { console.error(`[mirror-refresh] ERROR: ${m}`); process.exit(1); };

const settings = cloudSettings();
if (!settings) fail('WRS_CLOUD_ENDPOINT / BUCKET / ACCESS_KEY / SECRET_KEY are required — the same four the shop backs up with.');
if (!process.env.WRS_BACKUP_KEY_FILE) fail('WRS_BACKUP_KEY_FILE is required — a copy of the shop\'s backup key.');

const mirrorDb = path.resolve(process.argv[2] || process.env.DB_PATH || path.join(here, '..', 'data', 'wrs_inspections.db'));
const dataDir = path.dirname(mirrorDb);
fs.mkdirSync(dataDir, { recursive: true });
const stateFile = path.join(dataDir, 'mirror-restored.json');
const prior = (() => { try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { return null; } })();

const key = await newestBackupInCloud(settings);
if (!key) fail(`no database backup found in ${settings.bucket}/${settings.prefix}`);
if (prior?.sourceKey === key && fs.existsSync(mirrorDb)) { log(`already at ${key}; nothing to do.`); process.exit(0); }

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wrs-mirror-'));
try {
  const enc = path.join(work, path.basename(key));
  log(`fetching ${key}`);
  await download(settings, key, enc);
  try { await download(settings, `${key}.hmac`, `${enc}.hmac`); } catch { log('no .hmac beside this backup in the bucket; restore will say so'); }
  const next = path.join(work, 'restored.db');
  execFileSync(process.execPath, ['--experimental-strip-types', path.join(here, 'backup-db.mjs'), '--restore', enc, next], { stdio: 'inherit' });
  if (!fs.existsSync(next)) fail('the restore produced no database');
  // Swap: the previous copy is kept once, the new one takes the mirror's name.
  const swapped = path.join(dataDir, 'mirror-next.db');
  fs.copyFileSync(next, swapped);
  if (fs.existsSync(mirrorDb)) fs.renameSync(mirrorDb, `${mirrorDb}.prev`);
  for (const suffix of ['-wal', '-shm']) { try { fs.rmSync(mirrorDb + suffix, { force: true }); } catch { /* none */ } }
  fs.renameSync(swapped, mirrorDb);
  fs.writeFileSync(stateFile, JSON.stringify({ restoredAt: new Date().toISOString(), sourceKey: key, sourceBucket: settings.bucket }, null, 2) + '\n');
  fs.writeFileSync(path.join(dataDir, 'mirror-restart.flag'), new Date().toISOString());
  log(`mirror now holds ${key}; the server will reopen it within a few seconds.`);
} finally {
  try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* temp */ }
}
