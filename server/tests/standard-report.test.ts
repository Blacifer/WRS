/**
 * The shop that measures the standard — the figures, and what is refused
 * Indian Railways WRS Raipur
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { standardReport, MIN_N, EDGE_MM } from '../../shared/analysis/standardReport.ts';
import { createApp } from '../src/app.ts';
import type { ExpressApp } from '../src/framework/index.ts';

const reading = (heightMm: number, status: 'PASS' | 'CONDEMNED' = heightMm >= 245 && heightMm <= 263 ? 'PASS' : 'CONDEMNED') =>
  ({ bogieType: 'CASNUB_22_NLB' as const, condition: 'USED' as const, position: 'OUTER' as const, heightMm, band: null, status });

describe('standardReport', () => {
  it('TC-STD-01: below thirty a kind shows its count and nothing else', () => {
    const r = standardReport(Array.from({ length: MIN_N - 1 }, (_, i) => reading(255 + (i % 5))));
    assert.strictEqual(r.lines.length, 1);
    assert.strictEqual(r.lines[0].reportable, false);
    assert.strictEqual(r.lines[0].n, MIN_N - 1);
    assert.strictEqual(r.lines[0].medianMm, null);
    assert.strictEqual(r.lines[0].histogram.length, 0);
  });

  it('TC-STD-02: centre, spread, band shares and condemnation are what the readings say, against RDSO\'s own limits', () => {
    // 40 outer springs: 30 spread 255–262 (passing), 10 at 243 (condemned by height).
    const rows = [...Array.from({ length: 30 }, (_, i) => reading(255 + (i % 8))), ...Array.from({ length: 10 }, () => reading(243))];
    const l = standardReport(rows).lines[0];
    assert.strictEqual(l.reportable, true);
    assert.strictEqual(l.n, 40);
    assert.strictEqual(l.condemned, 10);
    assert.strictEqual(l.condemnedPct, 25);
    assert.strictEqual(l.table, 'Table 28');
    assert.deepStrictEqual(l.limits, { nominal: 260, condemnMin: 245, condemnMax: 263 });
    assert.strictEqual(l.p10Mm, 243);
    assert.ok(l.medianMm! >= 255 && l.medianMm! <= 262);
    const sumBands = l.bands.reduce((a, b) => a + b.n, 0);
    assert.strictEqual(sumBands + l.condemned, 40, 'every reading is in a band or condemned');
    const blue = l.bands.find((b) => b.band === 'BLUE')!;
    assert.strictEqual(blue.minMm, 260);
    assert.ok(blue.n > 0);
  });

  it('TC-STD-03: readings on a band edge are counted, and the busiest edge is named', () => {
    // Thirty springs, all within half a millimetre of the 260 boundary.
    const rows = Array.from({ length: 30 }, (_, i) => reading(260 + ((i % 3) - 1) * 0.4));
    const l = standardReport(rows).lines[0];
    assert.strictEqual(l.onEdge.n, 30);
    assert.strictEqual(l.onEdge.pct, 100);
    assert.strictEqual(l.onEdge.busiestBoundaryMm, 260);
    assert.strictEqual(l.onEdge.busiestN, 30);
    assert.ok(EDGE_MM === 0.5);
  });

  it('TC-STD-04: the histogram is half-millimetre bins over the observed range, and every reading lands in one', () => {
    const rows = Array.from({ length: 40 }, (_, i) => reading(250 + i * 0.25));
    const l = standardReport(rows).lines[0];
    assert.strictEqual(l.histogram[0].fromMm, 250);
    assert.strictEqual(l.histogram.reduce((a, b) => a + b.n, 0), 40);
    assert.ok(l.histogram.every((b) => Math.abs((b.fromMm * 2) - Math.round(b.fromMm * 2)) < 1e-9), 'bins on the half-millimetre');
  });

  it('TC-STD-05: kinds with no G-95 table are still counted, with no limits invented', () => {
    const rows = Array.from({ length: 30 }, () => ({ bogieType: 'LWLH25' as any, condition: 'USED' as const, position: 'OUTER' as const, heightMm: 300, band: null, status: 'PASS' as const }));
    const l = standardReport(rows).lines[0];
    assert.strictEqual(l.table, null);
    assert.strictEqual(l.limits, null);
    assert.strictEqual(l.bands.length, 0);
    assert.strictEqual(l.belowNominalPassPct, null);
    assert.strictEqual(l.medianMm, 300);
  });

  it('TC-STD-06: served to analytics readers from the bench\'s measured readings only', async () => {
    const app: ExpressApp = createApp(':memory:');
    const login = async (u: string) => (await app.dispatch({ method: 'POST', url: '/api/auth/login', body: { username: u, password: 'password123' } })).body.token;
    const insp = await login('inspector1'); const admin = await login('admin1'); const sup = await login('supervisor1');
    for (let i = 0; i < 32; i++) {
      await app.dispatch({ method: 'POST', url: '/api/sorting/record', headers: { authorization: `Bearer ${insp}` }, body: { batchId: 'b', bogieType: 'CASNUB_22_NLB', condition: 'USED', springPosition: 'INNER', measuredFreeHeight: 240 + (i % 6) } });
    }
    // A strip-read band carries no height worth a distribution.
    await app.dispatch({ method: 'POST', url: '/api/sorting/record', headers: { authorization: `Bearer ${insp}` }, body: { batchId: 'b', bogieType: 'CASNUB_22_NLB', condition: 'USED', springPosition: 'INNER', measuredFreeHeight: 241.5, heightIsApproximate: true } });
    const r = await app.dispatch({ method: 'GET', url: '/api/analytics/standard', headers: { authorization: `Bearer ${admin}` } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.data.readings, 32, 'the approximate one is excluded');
    assert.strictEqual(r.body.data.lines[0].position, 'INNER');
    assert.strictEqual(r.body.data.lines[0].reportable, true);
    assert.strictEqual((await app.dispatch({ method: 'GET', url: '/api/analytics/standard', headers: { authorization: `Bearer ${sup}` } })).status, 403);
  });
});
