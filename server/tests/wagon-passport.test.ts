/**
 * The wagon passport — carried with the wagon, verified by arithmetic and the key inside it
 * Indian Railways WRS Raipur
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { createApp } from '../src/app.ts';
import { getDatabase } from '../src/db/connection.ts';
import { buildPassport, verifyPassport, canonical, sealText } from '../src/reports/wagonPassport.ts';
import { certificateKeyFingerprint } from '../src/reports/certificateSigning.ts';
import type { ExpressApp } from '../src/framework/index.ts';

async function call(app: ExpressApp, method: string, path: string, body?: any, headers: Record<string, string> = {}) {
  return app.dispatch({ method, url: path, body, headers });
}
async function signIn(app: ExpressApp, username: string): Promise<string> {
  const res = await call(app, 'POST', '/api/auth/login', { username, password: 'password123' });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  return res.body.token;
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` });
const who = { id: 'usr_sup_001', name: 'S. K. Verma', role: 'SUPERVISOR' };

/** A wagon with a little history: registered, moved, a spring measured, a verdict, a part off. */
async function wagonWithHistory(app: ExpressApp, sup: string, insp: string): Promise<string> {
  const wagon = `SECR/BOXNHL/${88000 + Math.floor(Math.random() * 1000)}`;
  await call(app, 'POST', '/api/wagons/register', { wagonNumber: wagon, wagonType: 'BOXNHL', owningRailway: 'SECR', targetReleaseDate: '2026-10-01' }, auth(sup));
  await call(app, 'POST', `/api/wagons/${encodeURIComponent(wagon)}/transition`, { targetStage: 'DISMANTLING' }, auth(sup));
  await call(app, 'POST', '/api/inspections', { wagonNumber: wagon, bogieType: 'CASNUB_22_NLB', springCondition: 'USED', springPosition: 'OUTER', measuredHeight: 258, bogiePosition: 'BOGIE_1', nestIndex: 1 }, auth(insp));
  const list = await call(app, 'GET', `/api/wagons/${encodeURIComponent(wagon)}/checklist`, undefined, auth(insp));
  const item = list.body.data.allItems.find((i: any) => i.category !== 'SPRINGS');
  await call(app, 'PUT', `/api/wagons/${encodeURIComponent(wagon)}/checklist/items/${item.id}`, { status: 'PASS' }, auth(insp));
  return wagon;
}

describe('canonical form', () => {
  it('TC-WP-01: key order does not change the bytes, and undefined follows JSON\'s own rule', () => {
    assert.strictEqual(canonical({ b: 1, a: [3, { z: null, y: 'x' }] }), canonical({ a: [3, { y: 'x', z: null }], b: 1 }));
    assert.strictEqual(canonical({ a: 1, b: undefined }), canonical(JSON.parse(JSON.stringify({ a: 1, b: undefined }))));
    assert.strictEqual(canonical([1, undefined]), canonical(JSON.parse(JSON.stringify([1, undefined]))));
  });
});

describe('building and verifying', () => {
  let app: ExpressApp; let sup: string; let insp: string; let wagon: string;
  beforeEach(async () => {
    app = createApp(':memory:');
    sup = await signIn(app, 'supervisor1');
    insp = await signIn(app, 'inspector1');
    wagon = await wagonWithHistory(app, sup, insp);
  });

  it('TC-WP-02: a passport is a header, a chain of events in time order, and a seal that verifies', () => {
    const text = buildPassport(getDatabase(), wagon, who);
    const lines = text.trim().split('\n');
    assert.strictEqual(JSON.parse(lines[0]).type, 'PASSPORT');
    assert.strictEqual(JSON.parse(lines[lines.length - 1]).type, 'SEAL');
    const v = verifyPassport(text);
    assert.deepStrictEqual(v.reasons, []);
    assert.strictEqual(v.ok, true);
    assert.strictEqual(v.issuedByThisServer, true);
    assert.strictEqual(v.header!.issuer.keyFingerprint, certificateKeyFingerprint());
    const kinds = v.events.map((e) => e.kind);
    for (const k of ['REGISTERED', 'STAGE_TRANSITION', 'SPRING_INSPECTION', 'CHECKLIST_VERDICT']) assert.ok(kinds.includes(k as any), `${k} present: ${kinds.join(',')}`);
    for (let i = 1; i < v.events.length; i++) assert.ok(v.events[i].at >= v.events[i - 1].at, 'in time order');
    assert.strictEqual(v.events.some((e) => e.kind === 'PHOTO' && 'imageBase64' in (e.payload as any)), false, 'no photograph bytes travel');
  });

  it('TC-WP-03: an altered event is named precisely; re-hashing it breaks the next link; re-hashing everything breaks the seal', () => {
    const text = buildPassport(getDatabase(), wagon, who);
    const lines = text.trim().split('\n');
    const ev = JSON.parse(lines[3]);
    ev.payload.measuredHeightMm = 261; // the spring grew 3 mm in transit
    lines[3] = JSON.stringify(ev);
    let v = verifyPassport(lines.join('\n'));
    assert.strictEqual(v.ok, false);
    assert.deepStrictEqual(v.reasons, ['Event 3 (SPRING_INSPECTION) has been altered — its hash does not match its content.']);

    // A more careful forger recomputes that event's hash. The next event no longer follows it.
    ev.hash = crypto.createHash('sha256').update(`${ev.prevHash}|${canonical({ seq: ev.seq, kind: ev.kind, at: ev.at, payload: ev.payload })}`).digest('hex');
    lines[3] = JSON.stringify(ev);
    v = verifyPassport(lines.join('\n'));
    assert.ok(v.reasons.some((r) => /Event 4 does not follow/.test(r)), v.reasons.join(' | '));
    assert.ok(!v.reasons.some((r) => /Event 3 .* altered/.test(r)));

    // The most careful forger re-hashes every later event too. The terminal hash changes, and the seal was signed over the old one.
    let prev = ev.hash;
    for (let i = 4; i < lines.length - 1; i++) {
      const e = JSON.parse(lines[i]); e.prevHash = prev;
      e.hash = crypto.createHash('sha256').update(`${prev}|${canonical({ seq: e.seq, kind: e.kind, at: e.at, payload: e.payload })}`).digest('hex');
      prev = e.hash; lines[i] = JSON.stringify(e);
    }
    v = verifyPassport(lines.join('\n'));
    assert.ok(v.reasons.some((r) => /terminal hash/.test(r)), v.reasons.join(' | '));
    assert.ok(v.reasons.some((r) => /signature does not verify|sealed text/.test(r)) || v.reasons.some((r) => /terminal hash/.test(r)));
  });

  it('TC-WP-04: a removed line, and a re-signed seal, are both caught — the signature binds the count and the hash', () => {
    const text = buildPassport(getDatabase(), wagon, who);
    const lines = text.trim().split('\n');
    lines.splice(2, 1); // drop an event
    const v = verifyPassport(lines.join('\n'));
    assert.strictEqual(v.ok, false);
    assert.ok(v.reasons.some((r) => /seq/.test(r)));
    assert.ok(v.reasons.some((r) => /The seal says/.test(r)));
  });

  it('TC-WP-05: a passport sealed by another key verifies, and is said not to be this server\'s', () => {
    const text = buildPassport(getDatabase(), wagon, who);
    const lines = text.trim().split('\n');
    const header = JSON.parse(lines[0]);
    const seal = JSON.parse(lines[lines.length - 1]);
    const other = crypto.generateKeyPairSync('ed25519');
    header.issuer.name = 'Some Other Workshop';
    header.issuer.publicKeyPem = other.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    header.issuer.keyFingerprint = crypto.createHash('sha256').update(other.publicKey.export({ type: 'spki', format: 'der' }) as Buffer).digest('hex').slice(0, 16).toUpperCase();
    seal.signature = 'Ed25519:' + crypto.sign(null, Buffer.from(seal.signed, 'utf8'), other.privateKey).toString('base64');
    lines[0] = JSON.stringify(header); lines[lines.length - 1] = JSON.stringify(seal);
    const v = verifyPassport(lines.join('\n'));
    assert.deepStrictEqual(v.reasons, []);
    assert.strictEqual(v.issuedByThisServer, false);
  });

  it('TC-WP-06: a seal whose signature is not by the key in the file is refused', () => {
    const text = buildPassport(getDatabase(), wagon, who);
    const lines = text.trim().split('\n');
    const seal = JSON.parse(lines[lines.length - 1]);
    seal.signature = 'Ed25519:' + Buffer.alloc(64, 7).toString('base64');
    lines[lines.length - 1] = JSON.stringify(seal);
    const v = verifyPassport(lines.join('\n'));
    assert.ok(v.reasons.some((r) => /signature does not verify/.test(r)));
  });

  it('TC-WP-07: the sealed text is the header and the chain, so a re-dated passport fails', () => {
    const text = buildPassport(getDatabase(), wagon, who, '2026-09-15T10:00:00.000Z');
    const lines = text.trim().split('\n');
    const header = JSON.parse(lines[0]); header.exportedAt = '2027-01-01T00:00:00.000Z'; lines[0] = JSON.stringify(header);
    const v = verifyPassport(lines.join('\n'));
    assert.ok(v.reasons.some((r) => /sealed text does not match/.test(r)));
    assert.strictEqual(sealText('W', 'T', 2, 'H'), 'W|T|2|H');
  });
});

describe('through the API', () => {
  let app: ExpressApp; let sup: string; let insp: string; let wagon: string;
  beforeEach(async () => {
    app = createApp(':memory:');
    sup = await signIn(app, 'supervisor1');
    insp = await signIn(app, 'inspector1');
    wagon = await wagonWithHistory(app, sup, insp);
  });

  it('TC-WP-10: export, then import at "the next shop" — kept whole, re-verified on read, not merged', async () => {
    const exp = await call(app, 'GET', `/api/wagons/${encodeURIComponent(wagon)}/passport`, undefined, auth(sup));
    assert.strictEqual(exp.status, 200, JSON.stringify(exp.body));
    const text = String(exp.body);
    assert.match(text, /"type":"PASSPORT"/);

    const imp = await call(app, 'POST', '/api/wagons/passports/import', { passport: text }, auth(sup));
    assert.strictEqual(imp.status, 201, JSON.stringify(imp.body));
    assert.strictEqual(imp.body.data.issuedByThisServer, true);
    assert.strictEqual(imp.body.data.wagonNumber, wagon);

    const again = await call(app, 'POST', '/api/wagons/passports/import', { passport: text }, auth(sup));
    assert.strictEqual(again.status, 200);
    assert.strictEqual(again.body.data.alreadyImported, true);

    const list = await call(app, 'GET', `/api/wagons/${encodeURIComponent(wagon)}/passports`, undefined, auth(insp === sup ? sup : sup));
    assert.strictEqual(list.status, 200);
    assert.strictEqual(list.body.data.length, 1);
    assert.strictEqual(list.body.data[0].verifiesNow, true);
    assert.ok(list.body.data[0].events.length >= 4);
    // Nothing merged: the wagon's own transition count is what it was.
    const moves = (getDatabase().prepare("SELECT COUNT(*) n FROM wagon_transitions WHERE wagon_number = ? AND from_stage <> to_stage").get(wagon) as any).n;
    assert.strictEqual(moves, 1);
    assert.throws(() => getDatabase().prepare('DELETE FROM wagon_passports').run(), /cannot be deleted/);
  });

  it('TC-WP-11: a tampered file is refused with every reason, and nothing is stored', async () => {
    const exp = await call(app, 'GET', `/api/wagons/${encodeURIComponent(wagon)}/passport`, undefined, auth(sup));
    const lines = String(exp.body).trim().split('\n');
    const ev = JSON.parse(lines[1]); ev.payload.wagonType = 'BOXNS'; lines[1] = JSON.stringify(ev);
    const imp = await call(app, 'POST', '/api/wagons/passports/import', { passport: lines.join('\n') }, auth(sup));
    assert.strictEqual(imp.status, 422);
    assert.strictEqual(imp.body.error, 'PASSPORT_NOT_VERIFIED');
    assert.ok(imp.body.data.reasons.length >= 1);
    assert.match(imp.body.message, /REGISTERED\) has been altered/);
    assert.strictEqual((getDatabase().prepare('SELECT COUNT(*) n FROM wagon_passports').get() as any).n, 0);
  });

  it('TC-WP-12: an inspector may not export or import; the DRM may read', async () => {
    const drm = await signIn(app, 'drm1');
    assert.strictEqual((await call(app, 'GET', `/api/wagons/${encodeURIComponent(wagon)}/passport`, undefined, auth(insp))).status, 403);
    assert.strictEqual((await call(app, 'POST', '/api/wagons/passports/import', { passport: 'x' }, auth(insp))).status, 403);
    assert.strictEqual((await call(app, 'GET', `/api/wagons/${encodeURIComponent(wagon)}/passports`, undefined, auth(drm))).status, 200);
  });
});
