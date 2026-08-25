/**
 * Spring Sorting Tests
 * Indian Railways WRS Raipur
 *
 * Springs arrive at WRS Raipur already dismantled and are sorted in bulk
 * against the strip — around 900 a day — and the shop confirmed the wagon they
 * came off is often unknown at that point. The app modelled only the other
 * half of the workflow, a wagon's 48-spring sweep, so the DRM's actual pain
 * point had no representation at all.
 *
 * These pin the sorting path, and the one output that makes it worth
 * digitising: how many complete matched nests the sorted stock can supply.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../src/db/migrations.ts';
import { seedUsers } from '../src/db/seed.ts';
import { SortingRepository } from '../src/db/sortingRepository.ts';
import { verifyAuditChain } from '../src/db/auditLog.ts';
import { getWagonSpringConfig } from '../../shared/classification/wagonTypes.ts';

describe('Spring Sorting', () => {
  let db: DatabaseSync;
  let repo: SortingRepository;

  const sort = (position: string, band: string, height: number, n = 1, batch = 'batch_1') => {
    for (let i = 0; i < n; i++) {
      repo.record({
        batchId: batch,
        bogieType: 'CASNUB_22_NLB',
        condition: 'USED',
        springPosition: position as any,
        measuredFreeHeight: height,
        heightIsApproximate: true,
        classifiedBand: band as any,
        bandRoman: 'Band II',
        status: 'PASS',
        tableReference: 'Table 28',
        inspectorId: 'usr_insp_001'
      });
    }
  };

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    runMigrations(db);
    seedUsers(db);
    repo = new SortingRepository(db);
  });

  it('TC-SRT-01: a spring can be sorted with no wagon at all', () => {
    // The whole point. Every other measurement path in this system requires a
    // wagon number, which is why bulk sorting had nowhere to go.
    const { id } = repo.record({
      batchId: 'b1',
      bogieType: 'CASNUB_22_NLB',
      condition: 'USED',
      springPosition: 'OUTER',
      measuredFreeHeight: 258.5,
      heightIsApproximate: true,
      classifiedBand: 'GREEN',
      status: 'PASS',
      inspectorId: 'usr_insp_001'
    });
    assert.ok(id.startsWith('sort_'));

    const row = db.prepare('SELECT * FROM spring_sorting_records WHERE id = ?').get(id) as any;
    assert.strictEqual(row.classified_band, 'GREEN');
    assert.strictEqual(row.assigned_wagon_number, null, 'sorted stock belongs to no wagon yet');
    assert.strictEqual(row.height_is_approximate, 1);
  });

  it('TC-SRT-02: sorted springs are append-only like every other measurement', () => {
    const { id } = repo.record({
      batchId: 'b1', bogieType: 'CASNUB_22_NLB', condition: 'USED', springPosition: 'OUTER',
      measuredFreeHeight: 258.5, classifiedBand: 'GREEN', status: 'PASS', inspectorId: 'usr_insp_001'
    });
    assert.throws(
      () => db.prepare("UPDATE spring_sorting_records SET classified_band='BLUE' WHERE id=?").run(id),
      /append-only/
    );
    assert.throws(
      () => db.prepare('DELETE FROM spring_sorting_records WHERE id=?').run(id),
      /append-only/
    );
  });

  it('TC-SRT-03: an unknown or deactivated inspector cannot record', () => {
    // 900 rows a day with nobody's name against them is not a record.
    assert.throws(
      () => repo.record({ batchId: 'b1', bogieType: 'CASNUB_22_NLB', condition: 'USED', springPosition: 'OUTER', measuredFreeHeight: 258, status: 'PASS', inspectorId: 'usr_nobody' }),
      /not a registered user/
    );

    db.prepare("UPDATE users SET is_active = 0 WHERE id = 'usr_insp_002'").run();
    assert.throws(
      () => repo.record({ batchId: 'b1', bogieType: 'CASNUB_22_NLB', condition: 'USED', springPosition: 'OUTER', measuredFreeHeight: 258, status: 'PASS', inspectorId: 'usr_insp_002' }),
      /deactivated/
    );
  });

  it('TC-SRT-04: the batch totals up', () => {
    sort('OUTER', 'GREEN', 258.5, 10);
    sort('OUTER', 'BLUE', 261.5, 5);
    repo.record({
      batchId: 'batch_1', bogieType: 'CASNUB_22_NLB', condition: 'USED', springPosition: 'OUTER',
      measuredFreeHeight: 244, status: 'CONDEMNED', inspectorId: 'usr_insp_001'
    });

    const s = repo.batchSummary('batch_1');
    assert.strictEqual(s.total, 16);
    assert.strictEqual(s.passed, 15);
    assert.strictEqual(s.condemned, 1);
    assert.strictEqual(s.byBand.find((b) => b.band === 'GREEN')!.count, 10);
    assert.strictEqual(s.byBand.find((b) => b.band === 'BLUE')!.count, 5);
  });

  it('TC-SRT-05: capacity counts complete nests, not springs', () => {
    // The question a tally cannot answer. 30 outer springs sounds like plenty
    // until you need twelve of ONE band: 25 GREEN and 5 BLUE is two nests, not
    // two and a half.
    sort('OUTER', 'GREEN', 258.5, 25);
    sort('OUTER', 'BLUE', 261.5, 5);

    const boxn = getWagonSpringConfig('BOXN')!;
    assert.deepStrictEqual(boxn.counts, { outer: 12, inner: 8, snubber: 4 });

    const cap = repo.nestCapacity('CASNUB_22_NLB', 'USED', boxn.counts);
    const green = cap.find((c) => c.band === 'GREEN')!;
    const blue = cap.find((c) => c.band === 'BLUE')!;

    assert.strictEqual(green.available, 25);
    assert.strictEqual(green.requiredPerNest, 12);
    assert.strictEqual(green.completeNests, 2, '25 GREEN outers make two nests of twelve');
    assert.strictEqual(blue.completeNests, 0, 'five BLUE cannot make a nest of twelve');
  });

  it('TC-SRT-06: capacity follows the wagon, not a fixed number', () => {
    // BOSTHS M1 needs 14 outer per nest, M2 needs 12. The same pile of springs
    // supplies different numbers of nests depending on what is being built.
    sort('OUTER', 'GREEN', 258.5, 28);

    const m1 = getWagonSpringConfig('BOSTHS M1')!;
    const m2 = getWagonSpringConfig('BOSTHS M2')!;

    const capM1 = repo.nestCapacity('CASNUB_22_NLB', 'USED', m1.counts).find((c) => c.band === 'GREEN')!;
    const capM2 = repo.nestCapacity('CASNUB_22_NLB', 'USED', m2.counts).find((c) => c.band === 'GREEN')!;

    assert.strictEqual(capM1.completeNests, 2, '28 / 14');
    assert.strictEqual(capM2.completeNests, 2, '28 / 12 rounds down');
    assert.strictEqual(capM1.requiredPerNest, 14);
    assert.strictEqual(capM2.requiredPerNest, 12);
  });

  it('TC-SRT-07: condemned springs are never counted as available stock', () => {
    sort('OUTER', 'GREEN', 258.5, 12);
    for (let i = 0; i < 5; i++) {
      repo.record({
        batchId: 'batch_1', bogieType: 'CASNUB_22_NLB', condition: 'USED', springPosition: 'OUTER',
        measuredFreeHeight: 244, status: 'CONDEMNED', classifiedBand: null, inspectorId: 'usr_insp_001'
      });
    }
    const stock = repo.stockByBand('CASNUB_22_NLB', 'USED');
    assert.strictEqual(stock.reduce((n, s) => n + s.count, 0), 12, 'rejects are not stock');
  });

  it('TC-SRT-08: new and used stock are counted separately', () => {
    // Mixing them in a nest is prohibited, so they cannot share a tally.
    sort('OUTER', 'GREEN', 258.5, 10);
    repo.record({
      batchId: 'batch_1', bogieType: 'CASNUB_22_NLB', condition: 'NEW', springPosition: 'OUTER',
      measuredFreeHeight: 262, classifiedBand: 'GREEN', status: 'PASS', inspectorId: 'usr_insp_001'
    });

    assert.strictEqual(repo.stockByBand('CASNUB_22_NLB', 'USED').reduce((n, s) => n + s.count, 0), 10);
    assert.strictEqual(repo.stockByBand('CASNUB_22_NLB', 'NEW').reduce((n, s) => n + s.count, 0), 1);
  });

  it('TC-SRT-09: daily throughput answers the 900-a-day question', () => {
    sort('OUTER', 'GREEN', 258.5, 40);
    const today = new Date().toISOString().slice(0, 10);
    const t = repo.dailyThroughput(today);
    assert.strictEqual(t.total, 40);
    assert.strictEqual(t.passed, 40);
  });

  it('TC-SRT-10: closing a batch writes one audit entry, not nine hundred', () => {
    // Chaining every sorted spring would bury the wagon lifecycle events the
    // audit log exists to make findable. The records are individually
    // attributed and immutable; the chain needs the session.
    sort('OUTER', 'GREEN', 258.5, 50);
    const before = (db.prepare('SELECT COUNT(*) c FROM inspection_audit_log').get() as any).c;
    repo.closeBatch('batch_1', 'usr_insp_001', 'INSPECTOR');
    const after = (db.prepare('SELECT COUNT(*) c FROM inspection_audit_log').get() as any).c;

    assert.strictEqual(after - before, 1);
    const row = db.prepare('SELECT payload_json FROM inspection_audit_log ORDER BY rowid DESC LIMIT 1').get() as any;
    const payload = JSON.parse(row.payload_json);
    assert.strictEqual(payload.action, 'SPRING_SORTING_BATCH');
    assert.strictEqual(payload.total, 50);
    assert.strictEqual(verifyAuditChain(db).verified, true);
  });
});
