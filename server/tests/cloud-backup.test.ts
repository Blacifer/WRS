/**
 * The cloud copy — signed like Amazon's own example, verified by the bytes that came back
 * Indian Railways WRS Raipur
 */

import { describe, it, after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { signV4, uriEncode, uploadAndVerify, syncBackupDirToCloud, readManifest, cloudSettings } from '../scripts/cloud-upload.mjs';

describe('the signature', () => {
  it('TC-CLD-01: reproduces the worked example in the S3 documentation (GET object, SigV4)', () => {
    // docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html — "Example: GET Object"
    const r = signV4({
      method: 'GET', host: 'examplebucket.s3.amazonaws.com', pathName: '/test.txt', query: '',
      headers: { host: 'examplebucket.s3.amazonaws.com', range: 'bytes=0-9', 'x-amz-content-sha256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'x-amz-date': '20130524T000000Z' },
      bodyHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      accessKey: 'AKIAIOSFODNN7EXAMPLE', secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1', amzDate: '20130524T000000Z'
    });
    assert.equal(r.signature, 'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
    assert.match(r.authorization, /^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/20130524\/us-east-1\/s3\/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=/);
  });

  it('TC-CLD-02: object keys are encoded the way S3 canonicalises them', () => {
    assert.equal(uriEncode('wrs_inspections_2026-09-16.db.enc'), 'wrs_inspections_2026-09-16.db.enc');
    assert.equal(uriEncode('photos/2026/09/a b.jpg.enc'), 'photos%2F2026%2F09%2Fa%20b.jpg.enc');
    assert.equal(uriEncode('/raipur/x', false), '/raipur/x');
  });

  it('TC-CLD-03: the copy is off until all four settings are present', () => {
    assert.equal(cloudSettings({}), null);
    assert.equal(cloudSettings({ WRS_CLOUD_ENDPOINT: 'https://s3.example', WRS_CLOUD_BUCKET: 'b' }), null);
    const s = cloudSettings({ WRS_CLOUD_ENDPOINT: 'https://s3.example/', WRS_CLOUD_BUCKET: 'b', WRS_CLOUD_ACCESS_KEY: 'a', WRS_CLOUD_SECRET_KEY: 'k', WRS_CLOUD_PREFIX: '/raipur/' });
    assert.deepEqual(s, { endpoint: 'https://s3.example', bucket: 'b', accessKey: 'a', secretKey: 'k', region: 'ap-south-1', prefix: 'raipur/' });
  });
});

/** A bucket on localhost that behaves like S3 for PUT and HEAD — and can be told to lie. */
function fakeBucket(opts: { corruptEtag?: boolean } = {}) {
  const objects = new Map<string, Buffer>();
  const seen: Array<{ method: string; url: string; auth: string }> = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      seen.push({ method: req.method!, url: req.url!, auth: String(req.headers.authorization || '') });
      const key = req.url!;
      if (!/^AWS4-HMAC-SHA256 Credential=.+\/s3\/aws4_request, SignedHeaders=.*x-amz-date.*, Signature=[0-9a-f]{64}$/.test(String(req.headers.authorization))) {
        res.writeHead(403); res.end('<Error>SignatureDoesNotMatch</Error>'); return;
      }
      if (req.method === 'PUT') { objects.set(key, Buffer.concat(chunks)); res.writeHead(200, { etag: `"${crypto.createHash('md5').update(objects.get(key)!).digest('hex')}"` }); res.end(); return; }
      if (req.method === 'HEAD') {
        const body = objects.get(key);
        if (!body) { res.writeHead(404); res.end(); return; }
        const md5 = crypto.createHash('md5').update(body).digest('hex');
        res.writeHead(200, { etag: `"${opts.corruptEtag ? md5.replace(/^./, (c) => (c === 'a' ? 'b' : 'a')) : md5}"`, 'content-length': String(body.length) }); res.end(); return;
      }
      res.writeHead(405); res.end();
    });
  });
  return { server, objects, seen, listen: () => new Promise<number>((r) => server.listen(0, '127.0.0.1', () => r((server.address() as any).port))) };
}

describe('the upload', () => {
  let dir: string;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrs-cloud-'));
    fs.writeFileSync(path.join(dir, 'wrs_inspections_20260916_090000.db.enc'), crypto.randomBytes(20_000));
    fs.writeFileSync(path.join(dir, 'wrs_inspections_20260916_090000.db.enc.hmac'), 'abc\n');
    fs.mkdirSync(path.join(dir, 'photos', '2026', '09'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'photos', '2026', '09', 'photo_1.jpg.enc'), crypto.randomBytes(3_000));
    fs.writeFileSync(path.join(dir, 'photos', '2026', '09', 'photo_1.jpg.enc.hmac'), 'def\n');
  });
  after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ } });

  it('TC-CLD-10: every encrypted file goes up signed, comes back the same bytes, and the manifest says so', async () => {
    const b = fakeBucket(); const port = await b.listen();
    try {
      const settings = cloudSettings({ WRS_CLOUD_ENDPOINT: `http://127.0.0.1:${port}`, WRS_CLOUD_BUCKET: 'wrs', WRS_CLOUD_ACCESS_KEY: 'AKIA', WRS_CLOUD_SECRET_KEY: 'secret', WRS_CLOUD_PREFIX: 'raipur/' })!;
      const r = await syncBackupDirToCloud(settings, dir);
      assert.equal(r.uploaded, 4); assert.equal(r.failures.length, 0);
      assert.equal(r.newestBackup?.inCloud, true);
      assert.ok(b.objects.has('/wrs/raipur/wrs_inspections_20260916_090000.db.enc'));
      assert.ok(b.objects.has('/wrs/raipur/photos/2026/09/photo_1.jpg.enc'));
      assert.ok(b.seen.every((s) => s.auth.startsWith('AWS4-HMAC-SHA256')), 'every request was signed');
      const m = readManifest(dir);
      assert.equal(Object.keys(m.uploads).length, 4);
      assert.equal(m.newestBackup.file, 'wrs_inspections_20260916_090000.db.enc');
      // A second run uploads nothing: the manifest knows they are there.
      const again = await syncBackupDirToCloud(settings, dir);
      assert.equal(again.uploaded, 0); assert.equal(again.skipped, 4);
      // The database bytes never left in the clear: the object is the .enc as written.
      assert.ok(b.objects.get('/wrs/raipur/wrs_inspections_20260916_090000.db.enc')!.equals(fs.readFileSync(path.join(dir, 'wrs_inspections_20260916_090000.db.enc'))));
    } finally { b.server.close(); }
  });

  it('TC-CLD-11: a bucket that returns different bytes is not recorded as a copy', async () => {
    const b = fakeBucket({ corruptEtag: true }); const port = await b.listen();
    try {
      const settings = cloudSettings({ WRS_CLOUD_ENDPOINT: `http://127.0.0.1:${port}`, WRS_CLOUD_BUCKET: 'wrs', WRS_CLOUD_ACCESS_KEY: 'AKIA', WRS_CLOUD_SECRET_KEY: 'secret' })!;
      await assert.rejects(() => uploadAndVerify(settings, path.join(dir, 'wrs_inspections_20260916_090000.db.enc'), 'x.enc'), /not the file's MD5/);
      const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'wrs-cloud2-'));
      fs.writeFileSync(path.join(dir2, 'wrs_inspections_20260916_100000.db.enc'), crypto.randomBytes(500));
      const r = await syncBackupDirToCloud(settings, dir2);
      assert.equal(r.uploaded, 0); assert.equal(r.failures.length, 1); assert.equal(r.newestBackup?.inCloud, false);
      assert.equal(readManifest(dir2).failures.length, 1);
      fs.rmSync(dir2, { recursive: true, force: true });
    } finally { b.server.close(); }
  });

  it('TC-CLD-12: a bucket that refuses the signature is a failure, not a silent skip', async () => {
    const port = await new Promise<number>((r) => { const s = http.createServer((_q, res) => { res.writeHead(403); res.end(); }); s.listen(0, '127.0.0.1', () => { r((s.address() as any).port); setTimeout(() => s.close(), 2000); }); });
    const settings = cloudSettings({ WRS_CLOUD_ENDPOINT: `http://127.0.0.1:${port}`, WRS_CLOUD_BUCKET: 'wrs', WRS_CLOUD_ACCESS_KEY: 'AKIA', WRS_CLOUD_SECRET_KEY: 'wrong' })!;
    await assert.rejects(() => uploadAndVerify(settings, path.join(dir, 'wrs_inspections_20260916_090000.db.enc'), 'x.enc'), /PUT x\.enc: 403/);
  });

  it('TC-CLD-13: the real backup script takes a backup, pushes it, and the readiness manifest names the newest file', async () => {
    const b = fakeBucket(); const port = await b.listen();
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wrs-cloud-script-'));
    try {
      const dbPath = path.join(work, 'wrs.db');
      const db = new DatabaseSync(dbPath); db.exec('CREATE TABLE t (x); INSERT INTO t VALUES (1)'); db.close();
      const keyFile = path.join(work, 'backup.key'); fs.writeFileSync(keyFile, 'a'.repeat(64) + '\n');
      const backupDir = path.join(work, 'backups');
      // Spawned asynchronously: the fake bucket lives in this process, and a
      // synchronous spawn would block the very server the child is uploading to.
      const { stdout: out } = await promisify(execFile)(process.execPath, ['--experimental-strip-types', path.resolve('scripts/backup-db.mjs'), dbPath, backupDir], {
        env: { ...process.env, WRS_BACKUP_KEY_FILE: keyFile, WRS_CLOUD_ENDPOINT: `http://127.0.0.1:${port}`, WRS_CLOUD_BUCKET: 'wrs', WRS_CLOUD_ACCESS_KEY: 'AKIA', WRS_CLOUD_SECRET_KEY: 'secret', WRS_CLOUD_PREFIX: 'raipur/' },
        encoding: 'utf8', timeout: 60_000
      });
      assert.match(out, /Cloud copy: 2 file\(s\) uploaded and verified/);
      const m = readManifest(backupDir);
      assert.equal(m.newestBackup.inCloud, true);
      assert.ok(b.objects.has(`/wrs/raipur/${m.newestBackup.file}`));
    } finally { b.server.close(); fs.rmSync(work, { recursive: true, force: true }); }
  });
});
