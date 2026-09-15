/**
 * Inspector quality with denominators, and a gauge that reads high
 * Indian Railways WRS Raipur
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createApp } from '../src/app.ts';
import { getDatabase } from '../src/db/connection.ts';
import { getAnalyticsInspectorQuality, MIN_FOR_RATE } from '../src/db/wagonAnalytics.ts';
import { gaugeDrift, DRIFT_THRESHOLD_MM, MIN_READINGS_EACH_SIDE } from '../../shared/analysis/gaugeDrift.ts';
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

async function sortMany(app: ExpressApp, token: string, n: number, heightFor: (i: number) => number, gauge: string | null = null, position = 'OUTER') {
  for (let i = 0; i < n; i++) {
    const r = await call(app, 'POST', '/api/sorting/record', { batchId: `b-${gauge}`, bogieType: 'CASNUB_22_NLB', condition: 'USED', springPosition: position, measuredFreeHeight: heightFor(i), gaugeCode: gauge }, auth(token));
    if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  }
}

describe('inspector quality', () => {
  it('TC-IQ-01: rates carry their denominators and are not quoted below thirty', async () => {
    const app = createApp(':memory:');
    const i1 = await signIn(app, 'inspector1');
    const i2 = await signIn(app, 'inspector2');
    await sortMany(app, i1, 40, (i) => (i < 8 ? 200 : 258));   // 20% condemned, quotable
    await sortMany(app, i2, 10, (i) => (i < 5 ? 200 : 258));   // 50%, too few to quote
    const q = getAnalyticsInspectorQuality(getDatabase());
    const a = q.inspectors.find((p: any) => p.inspectorId === 'usr_insp_001');
    const b = q.inspectors.find((p: any) => p.inspectorId === 'usr_insp_002');
    assert.strictEqual(a.springs.inspected, 40);
    assert.strictEqual(a.springs.condemned, 8);
    assert.strictEqual(a.condemnationRatePct, 20);
    assert.strictEqual(b.springs.inspected, 10);
    assert.strictEqual(b.condemnationRatePct, null, `below ${MIN_FOR_RATE} the rate is not a rate`);
    assert.strictEqual(q.shop.springs.inspected, 50);
    assert.strictEqual(q.shop.condemnationRatePct, 26);
    assert.strictEqual(a.inspectorName !== a.inspectorId, true, 'named, not an id');
  });

  it('TC-IQ-02: the amber box — asked, answered, and how often it was right — per person', async () => {
    const app = createApp(':memory:');
    const i1 = await signIn(app, 'inspector1');
    // Twelve ordinary readings so the anomaly check has a population, then one that looks transposed.
    await sortMany(app, i1, 12, () => 258);
    const odd = await call(app, 'POST', '/api/sorting/record', { batchId: 'b-null', bogieType: 'CASNUB_22_NLB', condition: 'USED', springPosition: 'OUTER', measuredFreeHeight: 285 }, auth(i1));
    assert.ok(odd.body.data.anomaly, 'the box should be raised');
    const before = getAnalyticsInspectorQuality(getDatabase()).inspectors.find((p: any) => p.inspectorId === 'usr_insp_001');
    assert.strictEqual(before.amber.raised, 1);
    assert.strictEqual(before.amber.answered, 0);
    await call(app, 'POST', `/api/sorting/records/${odd.body.data.id}/anomaly-outcome`, { action: 'RE_MEASURED', correctedHeight: 258 }, auth(i1));
    const after = getAnalyticsInspectorQuality(getDatabase()).inspectors.find((p: any) => p.inspectorId === 'usr_insp_001');
    assert.strictEqual(after.amber.answered, 1);
    assert.strictEqual(after.amber.reMeasured, 1);
    assert.strictEqual(after.amberAnsweredPct, null, 'ten raised before a share is quoted');
  });

  it('TC-IQ-03: served to analytics readers only', async () => {
    const app = createApp(':memory:');
    const drm = await signIn(app, 'drm1');
    const sup = await signIn(app, 'supervisor1');
    assert.strictEqual((await call(app, 'GET', '/api/analytics/inspector-quality', undefined, auth(drm))).status, 200);
    assert.strictEqual((await call(app, 'GET', '/api/analytics/inspector-quality', undefined, auth(sup))).status, 403);
  });
});

describe('gauge drift', () => {
  const k = 'CASNUB_22_NLB|USED|OUTER';
  const readings = (gauge: string, n: number, centre: number) => Array.from({ length: n }, (_, i) => ({ gaugeCode: gauge, kind: k, heightMm: centre + ((i % 5) - 2) * 0.5 }));

  it('TC-GD-01: a gauge a millimetre high against the others is flagged, with both medians and both counts', () => {
    const lines = gaugeDrift([...readings('SG-1', 40, 258), ...readings('SG-2', 40, 258), ...readings('SG-3', 40, 259.4)]);
    const bad = lines.find((l) => l.gaugeCode === 'SG-3')!;
    assert.strictEqual(bad.flagged, true);
    assert.strictEqual(bad.shiftMm, 1.4);
    assert.strictEqual(bad.othersN, 80);
    assert.match(bad.note, /1.4 mm higher/);
    assert.strictEqual(lines.find((l) => l.gaugeCode === 'SG-1')!.flagged, false);
    assert.strictEqual(lines[0].gaugeCode, 'SG-3', 'the largest shift first');
  });

  it('TC-GD-02: below thirty on either side nothing is claimed, and the only gauge for a kind is said to be alone', () => {
    const alone = gaugeDrift(readings('SG-1', 40, 258));
    assert.strictEqual(alone[0].shiftMm, null);
    assert.match(alone[0].note, /only gauge/);
    const thin = gaugeDrift([...readings('SG-1', 40, 258), ...readings('SG-2', 10, 262)]);
    assert.strictEqual(thin.length, 1, 'SG-2 has too few to be scored at all');
    assert.strictEqual(thin[0].shiftMm, null);
    assert.match(thin[0].note, new RegExp(`${MIN_READINGS_EACH_SIDE} needed`));
  });

  it('TC-GD-03: kinds are not mixed — an inner-spring gauge is not compared with outer springs', () => {
    const lines = gaugeDrift([...readings('SG-1', 40, 258), ...Array.from({ length: 40 }, (_, i) => ({ gaugeCode: 'SG-I', kind: 'CASNUB_22_NLB|USED|INNER', heightMm: 240 + (i % 3) }))]);
    for (const l of lines) assert.strictEqual(l.shiftMm, null);
  });

  it('TC-GD-04: from the bench, through the register, approximate heights and undone taps excluded', async () => {
    const app = createApp(':memory:');
    const i1 = await signIn(app, 'inspector1');
    await sortMany(app, i1, 35, (i) => 258 + (i % 3) * 0.5, 'SG-A');
    await sortMany(app, i1, 35, (i) => 259.5 + (i % 3) * 0.5, 'SG-B');
    const admin = await signIn(app, 'admin1');
    const r = await call(app, 'GET', '/api/gauges/drift', undefined, auth(admin));
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.data.readings, 70);
    assert.strictEqual(r.body.data.thresholdMm, DRIFT_THRESHOLD_MM);
    const b = r.body.data.lines.find((l: any) => l.gaugeCode === 'SG-B');
    assert.strictEqual(b.flagged, true);
    assert.strictEqual(b.shiftMm, 1.5);
    assert.match(r.body.data.summary, /Put them against the master/);
  });
});
