/**
 * Consumption Forecast Tests
 * Indian Railways WRS Raipur
 *
 * The forecast exists so Stores can pre-position springs instead of reacting.
 * Its inputs are of three different kinds — a known wagon mix from the shop's
 * out-turn return, exact spring counts from RDSO WMM 2.0 §601, and a
 * condemnation rate observed from this shop's own inspections — and only the
 * third is learned.
 *
 * These tests pin the property that makes it trustworthy: it refuses to
 * produce an order quantity it cannot support. A number invented from four
 * observations is worse than a blank, because somebody will order against it.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  forecastConsumption,
  springsHandledIn,
  MIN_CONDEMNATIONS_FOR_RATE,
  type ObservedRate
} from '../../shared/knowledge/consumptionForecast.ts';
import { RAIPUR_WORKING_DAYS } from '../../shared/knowledge/raipurWorkload.ts';

/** A rate with enough behind it to be quoted. */
const solidRate: ObservedRate = {
  bogieType: 'CASNUB_22_NLB',
  springPosition: 'OUTER',
  inspected: 2000,
  condemned: 100 // 5%
};

describe('Consumption forecast — what Stores should expect to issue', () => {
  describe('1. Springs handled comes from the shop\'s own out-turn', () => {
    it('TC-FCST-01: a full year of working days covers the whole annual mix', () => {
      const handled = springsHandledIn(RAIPUR_WORKING_DAYS);
      const total = [...handled.values()].reduce((s, n) => s + n, 0);
      assert.ok(total > 0, 'the annual out-turn must produce springs');
      // 5,747 wagons, tens of springs each, two bogies apiece.
      assert.ok(total > 100000, `expected a six-figure annual spring count, got ${Math.round(total)}`);
    });

    it('TC-FCST-02: half the year is half the springs', () => {
      const full = springsHandledIn(RAIPUR_WORKING_DAYS);
      const half = springsHandledIn(RAIPUR_WORKING_DAYS / 2);

      const sum = (m: Map<string, number>) => [...m.values()].reduce((s, n) => s + n, 0);
      assert.ok(Math.abs(sum(full) / 2 - sum(half)) < 1, 'scaling must be linear in the period');
    });

    it('TC-FCST-03: outer springs outnumber snubbers, as the manual says they must', () => {
      const handled = springsHandledIn(RAIPUR_WORKING_DAYS);
      const outer = handled.get('CASNUB_22_NLB|OUTER') ?? 0;
      const snubber = handled.get('CASNUB_22_NLB|SNUBBER') ?? 0;
      assert.ok(outer > snubber, '§601 gives 12 outer against 4 snubber on a 20.32t NLB');
    });
  });

  describe('2. Refusing to forecast what it cannot support', () => {
    it('TC-FCST-04: a thin rate produces no order quantity, and says why', () => {
      const thin: ObservedRate = {
        bogieType: 'CASNUB_22_NLB',
        springPosition: 'OUTER',
        inspected: 60,
        condemned: 4
      };

      const f = forecastConsumption(14, [thin]);
      assert.equal(f.lines.length, 0, 'no line may be offered on four observations');
      assert.equal(f.notForecast.length, 1);
      assert.match(f.notForecast[0].reason, /Only 4 condemned/);
      assert.ok(f.notForecast[0].reason.includes(String(MIN_CONDEMNATIONS_FOR_RATE)));
    });

    it('TC-FCST-05: exactly at the threshold, it will quote', () => {
      const atThreshold: ObservedRate = {
        bogieType: 'CASNUB_22_NLB',
        springPosition: 'OUTER',
        inspected: 1000,
        condemned: MIN_CONDEMNATIONS_FOR_RATE
      };

      const f = forecastConsumption(14, [atThreshold]);
      assert.equal(f.lines.length, 1);
      assert.equal(f.notForecast.length, 0);
    });

    it('TC-FCST-06: with nothing quotable the summary explains the blank', () => {
      const f = forecastConsumption(14, []);
      assert.equal(f.totalReplacements, 0);
      assert.match(f.summary, /no order quantity is offered/);
    });
  });

  describe('3. The arithmetic a supervisor can check by hand', () => {
    it('TC-FCST-07: replacements are handled springs times the observed rate', () => {
      const f = forecastConsumption(14, [solidRate]);
      const line = f.lines[0];

      assert.equal(line.condemnationRatePct, 5);
      const expected = Math.ceil(line.springsHandled * 0.05);
      assert.equal(line.expectedReplacements, expected);
    });

    it('TC-FCST-08: a part spring is rounded up — a shortfall stops a wagon', () => {
      const f = forecastConsumption(14, [solidRate]);
      const line = f.lines[0];
      assert.equal(Number.isInteger(line.expectedReplacements), true);
      assert.ok(line.expectedReplacements >= line.springsHandled * 0.05);
    });

    it('TC-FCST-09: a longer period forecasts more', () => {
      const two = forecastConsumption(14, [solidRate]).totalReplacements;
      const four = forecastConsumption(28, [solidRate]).totalReplacements;
      assert.ok(four > two, 'twice the period must not forecast the same demand');
    });

    it('TC-FCST-10: the basis is reported so the figure can be questioned', () => {
      const f = forecastConsumption(14, [solidRate]);
      assert.equal(f.lines[0].basis, 2000, 'the reader must see how much sits behind the rate');
    });
  });

  describe('4. Reporting', () => {
    it('TC-FCST-11: the biggest demand is listed first', () => {
      const rates: ObservedRate[] = [
        { bogieType: 'CASNUB_22_NLB', springPosition: 'SNUBBER', inspected: 1000, condemned: 50 },
        { bogieType: 'CASNUB_22_NLB', springPosition: 'OUTER', inspected: 1000, condemned: 50 }
      ];

      const f = forecastConsumption(14, rates);
      assert.equal(f.lines.length, 2);
      assert.ok(
        f.lines[0].expectedReplacements >= f.lines[1].expectedReplacements,
        'Stores reads the top of the list first'
      );
      assert.equal(f.lines[0].springPosition, 'OUTER', 'more outers are handled, so more are replaced');
    });

    it('TC-FCST-12: the summary names the period, the wagons and the total', () => {
      const f = forecastConsumption(14, [solidRate]);
      assert.match(f.summary, /next 14 working days/);
      assert.match(f.summary, new RegExp(String(f.wagonsExpected)));
      assert.match(f.summary, new RegExp(String(f.totalReplacements)));
    });

    it('TC-FCST-13: wagons expected scales with the period and stays a whole wagon', () => {
      const f = forecastConsumption(14, [solidRate]);
      assert.ok(f.wagonsExpected > 0);
      assert.equal(Number.isInteger(f.wagonsExpected), true);
      assert.ok(f.wagonsExpected < 5747, 'a fortnight is not the whole year');
    });
  });
});

// ---------------------------------------------------------------------------
// The rate comes from both records, and says so
// ---------------------------------------------------------------------------

import { createApp } from '../src/app.ts';
import { getDatabase } from '../src/db/connection.ts';
import { getObservedCondemnationRates } from '../src/db/wagonAnalytics.ts';

describe('5. The bench counts', () => {
  async function bench(app: any, token: string, n: number, condemned: number, batchId = 'b') {
    for (let i = 0; i < n; i++) {
      const r = await app.dispatch({
        method: 'POST', url: '/api/sorting/record', headers: { authorization: `Bearer ${token}` },
        body: { batchId, bogieType: 'CASNUB_22_NLB', condition: 'USED', springPosition: 'INNER', measuredFreeHeight: i < condemned ? 200 : 258 }
      });
      if (r.status !== 201) throw new Error(JSON.stringify(r.body));
    }
  }

  it('TC-FCST-20: the sorting bench feeds the rate — a shop that only sorts still gets a forecast', async () => {
    const app = createApp(':memory:');
    const login = await app.dispatch({ method: 'POST', url: '/api/auth/login', body: { username: 'inspector1', password: 'password123' } });
    const token = login.body.token;
    // Forty inner springs on the bench, thirty-two of them condemned by height; no wagon inspections at all.
    await bench(app, token, 40, 32);
    const rates = getObservedCondemnationRates(getDatabase());
    const inner = rates.find((r) => r.bogieType === 'CASNUB_22_NLB' && r.springPosition === 'INNER')!;
    if (!inner) throw new Error('no INNER rate');
    if (inner.inspected !== 40 || inner.condemned !== 32) throw new Error(JSON.stringify(inner));
    if (inner.fromBench?.inspected !== 40 || inner.fromWagons?.inspected !== 0) throw new Error('the split must say where they came from');
    const fc = await app.dispatch({ method: 'GET', url: '/api/analytics/forecast?days=14', headers: { authorization: `Bearer ${(await app.dispatch({ method: 'POST', url: '/api/auth/login', body: { username: 'admin1', password: 'password123' } })).body.token}` } });
    const line = fc.body.data.lines.find((l: any) => l.bogieType === 'CASNUB_22_NLB' && l.springPosition === 'INNER');
    if (!line) throw new Error(`INNER should be forecast now: ${JSON.stringify(fc.body.data.notForecast)}`);
    if (line.basis !== 40 || line.basisFromBench !== 40 || line.basisFromWagons !== 0) throw new Error(JSON.stringify(line));
  });

  it('TC-FCST-21: an undone tap and a corrected tap are not observations', async () => {
    const app = createApp(':memory:');
    const login = await app.dispatch({ method: 'POST', url: '/api/auth/login', body: { username: 'inspector1', password: 'password123' } });
    const token = login.body.token;
    await bench(app, token, 3, 3, 'undo-batch');
    // Undo the last (voids it), then correct the new last (supersedes it).
    const undo = await app.dispatch({ method: 'POST', url: '/api/sorting/batches/undo-batch/undo', headers: { authorization: `Bearer ${token}` }, body: {} });
    if (!undo.body.data?.corrected) throw new Error(JSON.stringify(undo.body));
    const fix = await app.dispatch({ method: 'POST', url: '/api/sorting/batches/undo-batch/undo', headers: { authorization: `Bearer ${token}` }, body: { replacement: {
      bogieType: 'CASNUB_22_NLB', condition: 'USED', springPosition: 'INNER', measuredFreeHeight: 258, heightIsApproximate: false,
      classifiedBand: 'BLUE', bandRoman: 'Band I', status: 'PASS', damageType: null, condemnationReason: null, tableReference: null
    } } });
    if (!fix.body.data?.corrected) throw new Error(JSON.stringify(fix.body));
    const inner = getObservedCondemnationRates(getDatabase()).find((r) => r.springPosition === 'INNER')!;
    // Three taps: one voided, one superseded by a PASS correction, one untouched condemnation.
    if (inner.inspected !== 2 || inner.condemned !== 1) throw new Error(JSON.stringify(inner));
  });
});
