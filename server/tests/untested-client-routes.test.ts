/**
 * The routes the client calls that no test had ever called
 * Indian Railways WRS Raipur
 *
 * A sweep on 18 Sep 2026 listed every server route against every test and
 * drive: five routes the tablet uses had never been exercised on the real
 * server — reactivating an account, restocking a part, looking a part up,
 * scanning a component QR, and moving a wagon's target date. The client's
 * route-reachability test proves they exist; nothing proved they worked.
 * Two more (the certificate public key, the inspections sync batch) are
 * reachable without the client and are pinned here too.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';
import { getDatabase } from '../src/db/connection.ts';
import { seedDemoData } from '../src/db/seed.ts';
import type { ExpressApp } from '../src/framework/index.ts';

let app: ExpressApp;
const call = (method: string, url: string, body?: any, headers: Record<string, string> = {}) => app.dispatch({ method, url, body, headers });
const login = async (username: string) => (await call('POST', '/api/auth/login', { username, password: 'password123' })).body.token as string;
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

describe('routes the client calls that had no test', () => {
  let admin: string; let sup: string; let insp: string;
  before(async () => {
    app = createApp(':memory:');
    seedDemoData(getDatabase()); // the demo wagons, parts and component passports
    admin = await login('admin1'); sup = await login('supervisor1'); insp = await login('inspector1');
  });

  it('TC-RTE-01: an account can be deactivated and reactivated, each under the user-management code, and neither by a supervisor', async () => {
    const created = await call('POST', '/api/auth/users', { otpToken: 'test_token_override', username: 'temp.hand', password: 'Temporary-Pass-2026!', fullName: 'Temp Hand', employeeId: 'WRS-TMP-0001', role: 'INSPECTOR' }, auth(admin));
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = created.body.data.id;
    const off = await call('PATCH', `/api/auth/users/${id}/deactivate`, { otpToken: 'test_token_override' }, auth(admin));
    assert.equal(off.status, 200);
    const refused = await call('POST', '/api/auth/login', { username: 'temp.hand', password: 'Temporary-Pass-2026!' });
    assert.equal(refused.status, 401, 'a deactivated account cannot sign in');
    const bySup = await call('PATCH', `/api/auth/users/${id}/reactivate`, { otpToken: 'test_token_override' }, auth(sup));
    assert.equal(bySup.status, 403, 'a supervisor does not manage accounts');
    const noCode = await call('PATCH', `/api/auth/users/${id}/reactivate`, {}, auth(admin));
    assert.equal(noCode.status, 401, 'without the user-management code it is refused');
    const on = await call('PATCH', `/api/auth/users/${id}/reactivate`, { otpToken: 'test_token_override' }, auth(admin));
    assert.equal(on.status, 200, JSON.stringify(on.body));
    assert.equal(Number(on.body.data.is_active ?? on.body.data.isActive), 1);
    const back = await call('POST', '/api/auth/login', { username: 'temp.hand', password: 'Temporary-Pass-2026!' });
    assert.equal(back.status, 200, 'and signs in again');
  });

  it('TC-RTE-02: a part can be looked up by code and restocked; the quantity is validated; an inspector may not restock', async () => {
    const part = await call('GET', '/api/inventory/part/PRT-SPR-OUT-01', undefined, auth(insp));
    assert.equal(part.status, 200, JSON.stringify(part.body));
    assert.equal(part.body.data.partCode, 'PRT-SPR-OUT-01');
    const before = Number(part.body.data.stockQuantity);
    const unknown = await call('GET', '/api/inventory/part/NO-SUCH-PART', undefined, auth(insp));
    assert.equal(unknown.status, 404);
    const byInsp = await call('POST', '/api/inventory/restock', { partCode: 'PRT-SPR-OUT-01', quantity: 10 }, auth(insp));
    assert.equal(byInsp.status, 403);
    for (const bad of [0, -5, 'ten', 1.5]) {
      const r = await call('POST', '/api/inventory/restock', { partCode: 'PRT-SPR-OUT-01', quantity: bad }, auth(sup));
      assert.equal(r.status, 400, `quantity ${JSON.stringify(bad)} must be refused`);
    }
    const ok = await call('POST', '/api/inventory/restock', { partCode: 'PRT-SPR-OUT-01', quantity: 10 }, auth(sup));
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(Number(ok.body.data.stockQuantity), before + 10);
    const missing = await call('POST', '/api/inventory/restock', { partCode: 'NO-SUCH-PART', quantity: 1 }, auth(sup));
    assert.equal(missing.status, 404);
  });

  it('TC-RTE-03: a component QR resolves to its passport; a stranger\'s QR and an empty body are refused plainly', async () => {
    const hit = await call('POST', '/api/components/scan-qr', { qrPayload: 'WRS-PASSPORT|WHL-RWF-2023-8841|WHEELSET|RWF_YELAHANKA' }, auth(insp));
    assert.equal(hit.status, 200, JSON.stringify(hit.body));
    assert.match(JSON.stringify(hit.body.data), /WHL-RWF-2023-8841/);
    const same = await call('GET', '/api/components/qr/' + encodeURIComponent('WRS-PASSPORT|WHL-RWF-2023-8841|WHEELSET|RWF_YELAHANKA'), undefined, auth(insp));
    assert.equal(same.status, 200, 'the GET form agrees');
    const stranger = await call('POST', '/api/components/scan-qr', { qrPayload: 'https://example.com/not-a-passport' }, auth(insp));
    assert.ok(stranger.status === 400 || stranger.status === 404, `a foreign QR: ${stranger.status}`);
    assert.ok(stranger.body.message, 'with a message the person can read');
    const empty = await call('POST', '/api/components/scan-qr', {}, auth(insp));
    assert.equal(empty.status, 400);
  });

  it('TC-RTE-04: the target release date moves with a reason, is audited, can be cleared, and is refused to an inspector and for nonsense', async () => {
    const W = encodeURIComponent('SER/BOXNHL/30914');
    const byInsp = await call('PUT', `/api/wagons/${W}/target-release-date`, { targetReleaseDate: '2026-10-15', reason: 'test' }, auth(insp));
    assert.equal(byInsp.status, 403);
    const bad = await call('PUT', `/api/wagons/${W}/target-release-date`, { targetReleaseDate: 'next tuesday', reason: 'test' }, auth(sup));
    assert.equal(bad.status, 400);
    const moved = await call('PUT', `/api/wagons/${W}/target-release-date`, { targetReleaseDate: '2026-10-15', reason: 'Wheel set awaited from RWF' }, auth(sup));
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    const wagon = await call('GET', `/api/wagons/${W}`, undefined, auth(sup));
    assert.match(String(wagon.body.data.targetReleaseDate), /^2026-10-15/);
    const audit = await call('GET', '/api/audit/activity?limit=50', undefined, auth(sup));
    assert.equal(audit.status, 200, JSON.stringify(audit.body).slice(0, 200));
    assert.ok(JSON.stringify(audit.body).includes('Wheel set awaited from RWF'), 'the reason is in the audit trail');
    const cleared = await call('PUT', `/api/wagons/${W}/target-release-date`, { targetReleaseDate: null, reason: 'Date withdrawn pending CWM decision' }, auth(sup));
    assert.equal(cleared.status, 200);
    const after = await call('GET', `/api/wagons/${W}`, undefined, auth(sup));
    assert.equal(after.body.data.targetReleaseDate ?? null, null);
  });

  it('TC-RTE-05: the certificate public key is published to anyone and can issue nothing', async () => {
    const key = await call('GET', '/api/audit/certificate-key');
    assert.equal(key.status, 200);
    assert.match(String(key.body.data?.publicKeyPem || key.body.publicKeyPem || ''), /BEGIN PUBLIC KEY/);
    assert.ok(!JSON.stringify(key.body).includes('PRIVATE'), 'never the private key');
  });

  it('TC-RTE-06: the inspections sync batch is idempotent — a resend of the same batch creates nothing twice', async () => {
    const item = {
      syncId: 'sync-test-0001', wagonNumber: 'SECR/BOXNHL/10492', bogieType: 'CASNUB_22_NLB', condition: 'USED', springPosition: 'OUTER',
      bogiePosition: 'BOGIE_1', measuredFreeHeight: 258.5, classifiedBand: 'GREEN', bandRoman: 'Band II', status: 'PASS', damageType: 'NONE',
      tableReference: 'Table 28', valid_range_min: 245, valid_range_max: 263, inspectorId: 'usr_insp_001', clientTimestamp: new Date().toISOString()
    };
    const batch = { records: [item] };
    const before = (await call('GET', '/api/inspections?wagonNumber=10492&limit=200', undefined, auth(sup))).body.data.length;
    const first = await call('POST', '/api/inspections/sync-batch', batch, auth(insp));
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.insertedCount, 1);
    const again = await call('POST', '/api/inspections/sync-batch', batch, auth(insp));
    assert.equal(again.status, 200, 'a resend is not an error');
    assert.equal(again.body.insertedCount, 0);
    assert.equal(again.body.duplicateCount, 1, 'the resend is reported as a duplicate');
    const after = (await call('GET', '/api/inspections?wagonNumber=10492&limit=200', undefined, auth(sup))).body.data.length;
    assert.equal(after, before + 1, 'exactly one record exists after two sends');
  });
});
