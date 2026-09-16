/**
 * Wheel readings — the chalk on the disc, judged against published limits
 * Indian Railways WRS Raipur
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';
import { getDatabase } from '../src/db/connection.ts';
import { WagonRepository } from '../src/db/wagonRepository.ts';
import { judgeWheel, judgeWheelSet, wheelFamilyFor, WHEEL_DIAMETER_LIMITS } from '../../shared/classification/wheelLimits.ts';
import type { ExpressApp } from '../src/framework/index.ts';

async function call(app: ExpressApp, method: string, path: string, body?: any, headers: Record<string, string> = {}) {
  return app.dispatch({ method, url: path, body, headers });
}
async function signIn(app: ExpressApp, username: string): Promise<string> {
  const res = await call(app, 'POST', '/api/auth/login', { username, password: 'password123' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.token;
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

describe('the limits', () => {
  it('TC-WHL-01: BOXN on CASNUB is judged against 919 (last shop issue) and 906 (condemn), drawing WD-97037 S-01', () => {
    const L = WHEEL_DIAMETER_LIMITS.CASNUB_BOXN;
    assert.equal(L.newMm, 1000); assert.equal(L.lastShopIssueMm, 919); assert.equal(L.condemnMm, 906); assert.match(L.drawing, /WD-97037/);
    assert.equal(judgeWheel('CASNUB_BOXN', { treadDiameterMm: 980.65 }).verdict, 'PASS');
    assert.equal(judgeWheel('CASNUB_BOXN', { treadDiameterMm: 912 }).verdict, 'BELOW_SHOP_ISSUE', 'legal on the line, may not leave a POH');
    assert.equal(judgeWheel('CASNUB_BOXN', { treadDiameterMm: 905.5 }).verdict, 'CONDEMN');
    assert.equal(judgeWheel('CASNUB_BOXN', { treadDiameterMm: 919 }).verdict, 'PASS', 'the issue limit itself passes');
  });

  it('TC-WHL-02: the family comes from the bogie, and a bogie with no table records without judging', () => {
    assert.equal(wheelFamilyFor('CASNUB 22 HS'), 'CASNUB_BOXN');
    assert.equal(wheelFamilyFor('CASNUB 22 NLC'), 'CASNUB_22NLC');
    assert.equal(wheelFamilyFor('LCCF 20 (C)'), 'LCCF_BLC');
    assert.equal(wheelFamilyFor('LWLH25'), null);
    const j = judgeWheel(null, { treadDiameterMm: 850 });
    assert.equal(j.verdict, 'PASS'); assert.match(j.findings[0].limit, /no diameter table/);
    assert.equal(judgeWheel('CASNUB_22NLC', { treadDiameterMm: 954 }).verdict, 'CONDEMN');
    assert.equal(judgeWheel('LCCF_BLC', { treadDiameterMm: 790 }).verdict, 'BELOW_SHOP_ISSUE');
  });

  it('TC-WHL-03: flange and tread defects condemn at the published figures, each finding naming its limit', () => {
    const j = judgeWheel('CASNUB_BOXN', { treadDiameterMm: 980, flangeThicknessMm: 16, flangeHeightMm: 35, rootRadiusMm: 13, flatMm: 60, hollowMm: 5 });
    assert.equal(j.verdict, 'CONDEMN');
    assert.equal(j.findings.filter((f) => f.verdict === 'CONDEMN').length, 5);
    assert.ok(j.findings.every((f) => f.limit.length > 5));
    const ok = judgeWheel('CASNUB_BOXN', { treadDiameterMm: 980, flangeThicknessMm: 16.5, flangeHeightMm: 34.9, rootRadiusMm: 13.5, flatMm: 59, hollowMm: 4.9 });
    assert.equal(ok.verdict, 'PASS');
    assert.match(j.source, /IRIMEE/);
  });

  it('TC-WHL-04: variation — 0.5 mm on an axle, 13 in a bogie, 25 across the wagon; a missing wheel is named, not assumed', () => {
    const r = (axle: 1 | 2 | 3 | 4, side: 'L' | 'R', d: number) => ({ axle, side, treadDiameterMm: d });
    const good = judgeWheelSet('CASNUB_BOXN', [r(1, 'L', 980), r(1, 'R', 980.4), r(2, 'L', 975), r(2, 'R', 975.2), r(3, 'L', 990), r(3, 'R', 990), r(4, 'L', 978), r(4, 'R', 978)]);
    assert.equal(good.ok, true); assert.equal(good.missing.length, 0);
    const axleBad = judgeWheelSet('CASNUB_BOXN', [r(1, 'L', 980), r(1, 'R', 981)]);
    assert.equal(axleBad.ok, false); assert.equal(axleBad.variations[0].scope, 'axle 1'); assert.equal(axleBad.missing.length, 6);
    const bogieBad = judgeWheelSet('CASNUB_BOXN', [r(1, 'L', 990), r(1, 'R', 990), r(2, 'L', 976), r(2, 'R', 976)]);
    assert.ok(bogieBad.variations.find((v) => v.scope === 'bogie 1' && !v.ok));
  });
});

describe('the record', () => {
  let app: ExpressApp; let insp: string; let sup: string;
  const W = 'SECR/BOXNHL/70101';
  const wheel = (axle: number, side: string, tread: number, extra: Record<string, unknown> = {}) => call(app, 'POST', `/api/wagons/${encodeURIComponent(W)}/wheels`, { axle, side, treadDiameterMm: tread, ...extra }, auth(insp));

  beforeEach(async () => {
    app = createApp(':memory:');
    insp = await signIn(app, 'inspector1');
    sup = await signIn(app, 'supervisor1');
    await call(app, 'POST', '/api/wagons/register', { wagonNumber: W, wagonType: 'BOXNHL', owningRailway: 'SECR' }, auth(sup));
  });

  it('TC-WHL-10: a reading is judged at write time against the wagon\'s family, and a limit sent by the caller is refused', async () => {
    const r = await wheel(1, 'L', 980.65, { flangeThicknessMm: 27.5 });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.data.row.family, 'CASNUB_BOXN');
    assert.equal(r.body.data.judgement.verdict, 'PASS');
    const refused = await wheel(1, 'R', 980, { condemnMm: 800 });
    assert.equal(refused.status, 400); assert.equal(refused.body.error, 'LIMIT_NOT_ACCEPTED');
    const bad = await wheel(1, 'R', 12);
    assert.equal(bad.status, 400);
    const drm = await signIn(app, 'drm1');
    const notInspector = await call(app, 'POST', `/api/wagons/${encodeURIComponent(W)}/wheels`, { axle: 1, side: 'R', treadDiameterMm: 980 }, auth(drm));
    assert.equal(notInspector.status, 403, 'reading a wheel is shop-floor work');
  });

  it('TC-WHL-11: a condemned wheel and a below-issue wheel both block the gate; the latest reading per wheel is the one that counts', async () => {
    await wheel(1, 'L', 905);
    await wheel(2, 'R', 912);
    let gate = new WagonRepository(getDatabase()).evaluateExitGate(W);
    assert.ok(gate.blockerDetails.some((b) => b.issueType === 'WHEEL_CONDEMNED' && b.partName === 'Wheel A1L'));
    assert.ok(gate.blockerDetails.some((b) => b.issueType === 'WHEEL_BELOW_SHOP_ISSUE' && b.partName === 'Wheel A2R'));
    // The wheel set is changed and read again: the new rows supersede.
    await wheel(1, 'L', 985); await wheel(2, 'R', 985);
    gate = new WagonRepository(getDatabase()).evaluateExitGate(W);
    assert.ok(!gate.blockerDetails.some((b) => String(b.issueType).startsWith('WHEEL')));
    const history = (await call(app, 'GET', `/api/wagons/${encodeURIComponent(W)}/wheels`, undefined, auth(insp))).body.data;
    assert.equal(history.history.length, 4); assert.equal(history.wheels.length, 2);
    assert.equal(history.limits.condemnMm, 906);
  });

  it('TC-WHL-12: diameters that differ by more than the rule block, and the checklist items follow the readings', async () => {
    const d = [980, 980.2, 975, 975, 990, 990, 978, 978];
    let i = 0;
    for (const axle of [1, 2, 3, 4]) for (const side of ['L', 'R']) await wheel(axle, side, d[i++], { flangeThicknessMm: 26 });
    const gate = new WagonRepository(getDatabase()).evaluateExitGate(W);
    assert.ok(!gate.blockerDetails.some((b) => String(b.issueType).startsWith('WHEEL')), JSON.stringify(gate.blockerDetails.filter((b) => String(b.issueType).startsWith('WHEEL'))));
    const chk = (await call(app, 'GET', `/api/wagons/${encodeURIComponent(W)}/checklist`, undefined, auth(insp))).body.data.allItems;
    const tread = chk.find((c: any) => /tread diameter/i.test(c.partName));
    const flange = chk.find((c: any) => /flange thickness/i.test(c.partName));
    assert.equal(tread.status, 'PASS', JSON.stringify(tread));
    assert.match(tread.conditionNotes || tread.condition_notes || '', /8 wheels 975–990 mm/);
    assert.equal(flange.status, 'PASS');
    // One wheel re-read 14 mm smaller than its axle mate: the axle rule fails and the item is not passed.
    await wheel(1, 'R', 966);
    const gate2 = new WagonRepository(getDatabase()).evaluateExitGate(W);
    const v = gate2.blockerDetails.find((b) => b.issueType === 'WHEEL_VARIATION');
    assert.ok(v, JSON.stringify(gate2.blockerDetails)); assert.match(v!.description, /axle 1 differ by 14 mm; the limit is 0.5 mm/);
  });

  it('TC-WHL-13: a condemned reading condemns the checklist item, and readings are append-only', async () => {
    await wheel(3, 'L', 900);
    const chk = (await call(app, 'GET', `/api/wagons/${encodeURIComponent(W)}/checklist`, undefined, auth(insp))).body.data.allItems;
    const tread = chk.find((c: any) => /tread diameter/i.test(c.partName));
    assert.equal(tread.status, 'CONDEMNED');
    const db = getDatabase();
    assert.throws(() => db.prepare('UPDATE wheel_readings SET tread_diameter_mm = 990').run(), /cannot be rewritten/);
    assert.throws(() => db.prepare('DELETE FROM wheel_readings').run(), /cannot be deleted/);
  });
});
