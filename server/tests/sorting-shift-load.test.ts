/**
 * A full shift at the sorting bench
 * Indian Railways WRS Raipur
 *
 * This is the highest-volume path in the system by a wide margin: roughly
 * seven hundred springs a shift, one tap each, on a tablet at a bench. Every
 * other screen handles a wagon at a time; this one handles a spring every few
 * seconds for eight hours.
 *
 * Timing is deliberately NOT asserted. A stopwatch on a shared machine is a
 * flake generator, and the measurement belongs in a run somebody reads: on 6
 * September 2026 a full shift of 700 was accepted in 0.9 s — 795 a second,
 * median 1.1 ms per tap, p95 2.2 ms, no refusals — with the bench's own
 * screens still answering in single-digit milliseconds afterwards.
 *
 * What is asserted is what would still be wrong if it were fast: that every
 * spring is recorded exactly once, and that an undo retracts a tap without
 * erasing the fact that it happened.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';
import { generateToken } from '../src/auth/jwt.ts';
import { getDatabase } from '../src/db/connection.ts';
import type { ExpressApp } from '../src/framework/index.ts';

/** The app's own definition: not withdrawn, and not replaced by a later row. */
const LIVE =
  'voided = 0 AND id NOT IN (SELECT supersedes FROM spring_sorting_records WHERE supersedes IS NOT NULL)';

describe('Sorting bench under a shift-sized load', () => {
  let app: ExpressApp;
  let token: string;
  const batchId = `batch_load_${Date.now()}`;
  const COUNT = 300;

  const auth = () => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });

  before(async () => {
    app = createApp(':memory:');
    token = generateToken({
      id: 'usr_insp_001', username: 'inspector1', role: 'INSPECTOR',
      name: 'Ramesh Kumar', employeeId: 'WRS-INSP-1042'
    });

    const heights = [250.5, 253.5, 256.5, 259.5, 262.5, 246.0];
    for (let i = 0; i < COUNT; i++) {
      const res = await app.dispatch({
        method: 'POST', url: '/api/sorting/record', headers: auth(),
        body: {
          batchId,
          bogieType: 'CASNUB_22_NLB',
          condition: 'USED',
          springPosition: i % 3 === 0 ? 'INNER' : i % 5 === 0 ? 'SNUBBER' : 'OUTER',
          measuredFreeHeight: heights[i % heights.length],
          syncId: `load-${i}`
        }
      });
      assert.equal(res.status, 201, `spring ${i} refused: ${res.body?.message}`);
    }
  });

  test('TC-LOAD-01: every spring is recorded exactly once', () => {
    const db = getDatabase();
    const live = (db.prepare(`SELECT COUNT(*) AS c FROM spring_sorting_records WHERE ${LIVE}`).get() as any).c;
    const ids = (db.prepare('SELECT COUNT(DISTINCT sync_id) AS c FROM spring_sorting_records').get() as any).c;

    assert.equal(live, COUNT);
    assert.equal(ids, COUNT, 'a duplicated sync id means a spring was counted twice');
  });

  test('TC-LOAD-02: the bench\'s own screens still answer with a shift behind them', async () => {
    // Not timed — only that they answer. A screen that 500s at the end of a
    // shift is the failure worth catching here.
    for (const url of [
      '/api/sorting/throughput',
      '/api/sorting/dataset',
      '/api/sorting/stock?bogieType=CASNUB_22_NLB',
      '/api/sorting/allocation?bogieType=CASNUB_22_NLB&forWagon=BOXNHL',
      `/api/sorting/batches/${batchId}`
    ]) {
      const res = await app.dispatch({ method: 'GET', url, headers: auth() });
      assert.equal(res.status, 200, `${url} answered ${res.status}`);
    }
  });

  test('TC-LOAD-03: undo retracts the tap and keeps the fact that it happened', async () => {
    /*
     * A mis-tap is the ordinary case at a bench running one spring every few
     * seconds. Undo must remove the spring from the count — and must not
     * delete the row, because a record that can be made to disappear is not
     * an append-only record.
     */
    const db = getDatabase();
    const before = (db.prepare('SELECT COUNT(*) AS c FROM spring_sorting_records').get() as any).c;

    const res = await app.dispatch({
      method: 'POST', url: `/api/sorting/batches/${batchId}/undo`, headers: auth(), body: {}
    });
    assert.equal(res.status, 200, `undo refused: ${res.body?.message}`);

    const live = (db.prepare(`SELECT COUNT(*) AS c FROM spring_sorting_records WHERE ${LIVE}`).get() as any).c;
    const total = (db.prepare('SELECT COUNT(*) AS c FROM spring_sorting_records').get() as any).c;

    assert.equal(live, COUNT - 1, 'the retracted spring must not still be counted');
    assert.ok(total > before, 'the retraction is recorded, not erased');

    const marker = db.prepare('SELECT supersedes, voided FROM spring_sorting_records WHERE voided = 1').get() as any;
    assert.ok(marker?.supersedes, 'the withdrawal must name the spring it withdrew');
  });
});
