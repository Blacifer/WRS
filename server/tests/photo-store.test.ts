/**
 * Photographs are files beside the database, and the record vouches for them
 * Indian Railways WRS Raipur
 *
 * Every photograph was base64 inside the database file, and the readiness
 * panel's only advice as the file grew was to stop taking them. New ones go
 * to disk with their SHA-256 on the row; readers get the same data URL they
 * always did, hash-checked on the way. An altered file is refused, a legacy
 * inline row is read as before, and a reference cannot escape the directory.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { PhotoStore } from '../src/db/photoStore.ts';
import { createApp } from '../src/app.ts';
import { getDatabase } from '../src/db/connection.ts';
import { config } from '../src/config/index.ts';
import type { ExpressApp } from '../src/framework/index.ts';

// A tiny real JPEG-ish payload; the store never decodes it, only hashes it.
const PIXELS = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex');
const DATA_URL = `data:image/jpeg;base64,${PIXELS.toString('base64')}`;

async function call(app: ExpressApp, method: string, path: string, body?: any, headers: Record<string, string> = {}) {
  return app.dispatch({ method, url: path, body, headers });
}
async function signIn(app: ExpressApp, username: string): Promise<string> {
  const res = await call(app, 'POST', '/api/auth/login', { username, password: 'password123' });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  return res.body.token;
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

describe('PhotoStore', () => {
  let store: PhotoStore;
  beforeEach(() => {
    store = new PhotoStore(fs.mkdtempSync(path.join(os.tmpdir(), 'wrs-ps-')));
  });

  it('TC-PS-01: put writes the bytes under year/month and returns a reference and the hash', () => {
    const s = store.put('photo_1', DATA_URL, null, new Date('2026-09-15T00:00:00Z'));
    assert.strictEqual(s.ref, 'file:2026/09/photo_1.jpg');
    assert.strictEqual(s.bytes, PIXELS.length);
    assert.strictEqual(s.sha256, crypto.createHash('sha256').update(PIXELS).digest('hex'));
    assert.ok(fs.existsSync(store.pathOf(s.ref)));
    assert.strictEqual(fs.readdirSync(path.dirname(store.pathOf(s.ref))).some((f) => f.endsWith('.tmp')), false);
  });

  it('TC-PS-02: resolve gives back the same data URL, verified', () => {
    const s = store.put('photo_2', DATA_URL);
    const r = store.resolve(s.ref, s.sha256, 'image/jpeg');
    assert.strictEqual(r.dataUrl, DATA_URL);
    assert.strictEqual(r.verified, true);
    assert.strictEqual(r.source, 'FILE');
  });

  it('TC-PS-03: an altered file is not served as evidence', () => {
    const s = store.put('photo_3', DATA_URL);
    fs.writeFileSync(store.pathOf(s.ref), Buffer.concat([PIXELS, Buffer.from([0])]));
    const r = store.resolve(s.ref, s.sha256, 'image/jpeg');
    assert.strictEqual(r.dataUrl, null);
    assert.strictEqual(r.verified, false);
    assert.strictEqual(r.source, 'ALTERED');
  });

  it('TC-PS-04: a missing file is reported, not mistaken for an empty photograph', () => {
    const s = store.put('photo_4', DATA_URL);
    fs.rmSync(store.pathOf(s.ref));
    const r = store.resolve(s.ref, s.sha256, 'image/jpeg');
    assert.strictEqual(r.dataUrl, null);
    assert.strictEqual(r.source, 'MISSING');
  });

  it('TC-PS-05: a row written before photographs were files is read exactly as it was', () => {
    const r = store.resolve(DATA_URL, null, 'image/jpeg');
    assert.strictEqual(r.dataUrl, DATA_URL);
    assert.strictEqual(r.verified, null);
    assert.strictEqual(r.source, 'INLINE');
  });

  it('TC-PS-06: a reference cannot point outside the directory', () => {
    assert.throws(() => store.pathOf('file:../../etc/passwd'), /outside the photo directory/);
  });

  it('TC-PS-07: bare base64 is taken as JPEG; a data URL keeps its own type', () => {
    const png = store.put('p', `data:image/png;base64,${PIXELS.toString('base64')}`);
    assert.strictEqual(png.mimeType, 'image/png');
    assert.ok(png.ref.endsWith('.png'));
    const bare = store.put('q', PIXELS.toString('base64'));
    assert.strictEqual(bare.mimeType, 'image/jpeg');
  });

  it('TC-PS-08: size and listing see what is there and ignore a half-written file', () => {
    store.put('a', DATA_URL);
    store.put('b', DATA_URL);
    fs.writeFileSync(path.join(store.dir, 'stray.jpg.999.tmp'), 'x');
    assert.strictEqual(store.sizeOnDisk().files, 2);
    assert.strictEqual(store.list().length, 2);
  });
});

describe('through the API', () => {
  let app: ExpressApp;
  let token: string;
  let wagon: string;
  beforeEach(async () => {
    app = createApp(':memory:');
    token = await signIn(app, 'inspector1');
    wagon = `SECR/BOXNHL/${90000 + Math.floor(Math.random() * 9000)}`;
    await call(app, 'POST', '/api/wagons/register', { wagonNumber: wagon, wagonType: 'BOXNHL', owningRailway: 'SECR' }, auth(token));
  });

  it('TC-PS-10: an uploaded wagon photograph is a file, the row holds the reference and hash, and the reader gets it back verified', async () => {
    const up = await call(app, 'POST', '/api/photos/upload', { wagonNumber: wagon, partCategory: 'WHEELS_AXLES', partName: 'Wheel', imageBase64: DATA_URL }, auth(token));
    assert.strictEqual(up.status, 201, JSON.stringify(up.body));
    const row = getDatabase().prepare('SELECT image_data, sha256, file_size FROM wagon_photos WHERE id = ?').get(up.body.data.id) as any;
    assert.match(row.image_data, /^file:\d{4}\/\d{2}\/photo_/);
    assert.strictEqual(row.sha256, crypto.createHash('sha256').update(PIXELS).digest('hex'));
    assert.strictEqual(row.file_size, PIXELS.length);
    assert.ok(fs.existsSync(path.join(config.photoDir, row.image_data.slice(5))));

    const got = await call(app, 'GET', `/api/photos/${up.body.data.id}`, undefined, auth(token));
    assert.strictEqual(got.status, 200, JSON.stringify(got.body));
    assert.strictEqual(got.body.data.imageBase64, DATA_URL);
    assert.strictEqual(got.body.data.imageVerified, true);

    // The hash is in the chain.
    const audit = getDatabase().prepare("SELECT payload_json FROM inspection_audit_log WHERE event_type = 'PHOTO_UPLOADED' ORDER BY rowid DESC LIMIT 1").get() as any;
    assert.strictEqual(JSON.parse(audit.payload_json).sha256, row.sha256);
  });

  it('TC-PS-11: a photograph altered on disk comes back refused, not shown', async () => {
    const up = await call(app, 'POST', '/api/photos/upload', { wagonNumber: wagon, partCategory: 'WHEELS_AXLES', partName: 'Wheel', imageBase64: DATA_URL }, auth(token));
    const row = getDatabase().prepare('SELECT image_data FROM wagon_photos WHERE id = ?').get(up.body.data.id) as any;
    fs.writeFileSync(path.join(config.photoDir, row.image_data.slice(5)), 'not the photograph');
    const got = await call(app, 'GET', `/api/photos/${up.body.data.id}`, undefined, auth(token));
    assert.strictEqual(got.body.data.imageBase64, null);
    assert.strictEqual(got.body.data.imageVerified, false);
    assert.strictEqual(got.body.data.imageSource, 'ALTERED');
  });

  it('TC-PS-12: a spring evidence image goes the same way', async () => {
    const r = await call(app, 'POST', '/api/sorting/record', { batchId: 'b1', bogieType: 'CASNUB_22_NLB', condition: 'USED', springPosition: 'OUTER', measuredFreeHeight: 258 }, auth(token));
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    const img = await call(app, 'POST', `/api/sorting/records/${r.body.data.id}/image`, { batchId: 'b1', bogieType: 'CASNUB_22_NLB', condition: 'USED', springPosition: 'OUTER', status: 'PASS', imageData: DATA_URL }, auth(token));
    assert.ok(img.status < 300, JSON.stringify(img.body));
    const row = getDatabase().prepare('SELECT image_data, sha256 FROM spring_images LIMIT 1').get() as any;
    assert.match(row.image_data, /^file:/);
    assert.strictEqual(row.sha256, crypto.createHash('sha256').update(PIXELS).digest('hex'));
  });
});
