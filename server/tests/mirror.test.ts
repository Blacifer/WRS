/**
 * The read-only mirror — the shop backs up, the DRM's copy restores, and it cannot write
 * Indian Railways WRS Raipur
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/app.ts';
import { closeDatabase } from '../src/db/connection.ts';

const run = promisify(execFile);

/** A bucket on localhost: PUT, HEAD, GET and ListObjectsV2, enough for a shop and a mirror. */
function bucket() {
  const objects = new Map<string, Buffer>();
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (!String(req.headers.authorization).startsWith('AWS4-HMAC-SHA256')) { res.writeHead(403); res.end(); return; }
      const u = new URL(req.url!, 'http://x');
      if (req.method === 'GET' && u.searchParams.get('list-type') === '2') {
        const prefix = u.searchParams.get('prefix') || '';
        const keys = [...objects.keys()].map((k) => k.replace(/^\/wrs\//, '')).filter((k) => k.startsWith(prefix));
        res.writeHead(200, { 'content-type': 'application/xml' });
        res.end(`<?xml version="1.0"?><ListBucketResult>${keys.map((k) => `<Contents><Key>${k}</Key></Contents>`).join('')}</ListBucketResult>`);
        return;
      }
      const key = u.pathname;
      if (req.method === 'PUT') { objects.set(key, Buffer.concat(chunks)); res.writeHead(200, { etag: `"${crypto.createHash('md5').update(objects.get(key)!).digest('hex')}"` }); res.end(); return; }
      const body = objects.get(key);
      if (!body) { res.writeHead(404); res.end(); return; }
      if (req.method === 'HEAD') { res.writeHead(200, { etag: `"${crypto.createHash('md5').update(body).digest('hex')}"`, 'content-length': String(body.length) }); res.end(); return; }
      if (req.method === 'GET') { res.writeHead(200, { 'content-length': String(body.length) }); res.end(body); return; }
      res.writeHead(405); res.end();
    });
  });
  return { server, objects, listen: () => new Promise<number>((r) => server.listen(0, '127.0.0.1', () => r((server.address() as any).port))) };
}

describe('the mirror', () => {
  it('TC-MIR-01: the shop backs up to the bucket; the mirror restores the newest copy; sign-in works there and nothing else does', async () => {
    const b = bucket(); const port = await b.listen();
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wrs-mirror-'));
    const savedEnv = { ...process.env };
    try {
      // The shop: a real database with the demo users, backed up and pushed.
      const shopDb = path.join(work, 'shop', 'wrs.db'); fs.mkdirSync(path.dirname(shopDb), { recursive: true });
      const shopApp = createApp(shopDb);
      const reg = await shopApp.dispatch({ method: 'POST', url: '/api/auth/login', body: { username: 'drm1', password: 'password123' } });
      assert.equal(reg.status, 200);
      closeDatabase();
      const keyFile = path.join(work, 'backup.key'); fs.writeFileSync(keyFile, 'b'.repeat(64) + '\n');
      const cloudEnv = { WRS_BACKUP_KEY_FILE: keyFile, WRS_CLOUD_ENDPOINT: `http://127.0.0.1:${port}`, WRS_CLOUD_BUCKET: 'wrs', WRS_CLOUD_ACCESS_KEY: 'AKIA', WRS_CLOUD_SECRET_KEY: 'secret', WRS_CLOUD_PREFIX: 'raipur/' };
      const { stdout } = await run(process.execPath, ['--experimental-strip-types', path.resolve('scripts/backup-db.mjs'), shopDb, path.join(work, 'shop-backups')], { env: { ...process.env, ...cloudEnv }, encoding: 'utf8', timeout: 60_000 });
      assert.match(stdout, /Cloud copy: 2 file\(s\) uploaded and verified/);
      assert.ok([...b.objects.keys()].some((k) => /\.db\.enc$/.test(k)));

      // The mirror: nothing but the cloud settings and a copy of the key.
      const mirrorDb = path.join(work, 'mirror', 'wrs.db'); fs.mkdirSync(path.dirname(mirrorDb), { recursive: true });
      const r = await run(process.execPath, ['--experimental-strip-types', path.resolve('scripts/mirror-refresh.mjs'), mirrorDb], { env: { ...process.env, ...cloudEnv }, encoding: 'utf8', timeout: 60_000 });
      assert.match(r.stdout, /mirror now holds raipur\/wrs_inspections_.*\.db\.enc/);
      assert.ok(fs.existsSync(mirrorDb)); assert.ok(fs.existsSync(path.join(work, 'mirror', 'mirror-restart.flag')));
      const state = JSON.parse(fs.readFileSync(path.join(work, 'mirror', 'mirror-restored.json'), 'utf8'));
      assert.match(state.sourceKey, /^raipur\//);
      // A second refresh with nothing new does nothing.
      const again = await run(process.execPath, ['--experimental-strip-types', path.resolve('scripts/mirror-refresh.mjs'), mirrorDb], { env: { ...process.env, ...cloudEnv }, encoding: 'utf8', timeout: 60_000 });
      assert.match(again.stdout, /already at/);

      // The mirror server: reads yes, writes no, and it says what it is.
      process.env.WRS_READ_ONLY_MIRROR = 'true';
      process.env.DB_PATH = mirrorDb;
      const mirror = createApp(mirrorDb);
      const login = await mirror.dispatch({ method: 'POST', url: '/api/auth/login', body: { username: 'drm1', password: 'password123' } });
      assert.equal(login.status, 200, 'the DRM signs in to the mirror with the shop\'s own account');
      const H = { authorization: `Bearer ${login.body.token}` };
      const read = await mirror.dispatch({ method: 'GET', url: '/api/analytics/pipeline', headers: H });
      assert.equal(read.status, 200);
      const sup = await mirror.dispatch({ method: 'POST', url: '/api/auth/login', body: { username: 'supervisor1', password: 'password123' } });
      const write = await mirror.dispatch({ method: 'POST', url: '/api/wagons/register', headers: { authorization: `Bearer ${sup.body.token}` }, body: { wagonNumber: 'SECR/BOXNHL/1', wagonType: 'BOXNHL', owningRailway: 'SECR' } });
      assert.equal(write.status, 403); assert.equal(write.body.error, 'READ_ONLY_MIRROR');
      const health = await mirror.dispatch({ method: 'GET', url: '/api/health' });
      assert.equal(health.body.mirror.readOnly, true);
      assert.ok(health.body.mirror.restoredAt, 'the mirror says when its copy was taken');
    } finally {
      b.server.close();
      for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
      Object.assign(process.env, savedEnv);
      closeDatabase();
      fs.rmSync(work, { recursive: true, force: true });
    }
  });
});
