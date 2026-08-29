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

  /*
   * Undo.
   *
   * Sorting is one tap per spring and roughly 700 a shift, so a wrong tap is
   * a certainty. These tests exist because the first implementation made the
   * count go UP when a spring was taken back — it excluded the superseded row
   * and then counted the row that withdrew it. An undo button that increases
   * the tally is worse than no undo button: it teaches the inspector that the
   * number on the screen is not the number in the pile.
   */
  const replacement = {
    bogieType: 'CASNUB_22_NLB' as const,
    condition: 'USED' as const,
    springPosition: 'OUTER' as const,
    measuredFreeHeight: 262.0,
    classifiedBand: 'BLUE' as const,
    bandRoman: 'Band I',
    status: 'PASS' as const,
    tableReference: 'Table 28',
    inspectorId: 'usr_insp_001'
  };

  it('TC-SRT-11: taking a tap back lowers the count by exactly one', () => {
    sort('OUTER', 'GREEN', 258.5, 5);
    assert.strictEqual(repo.batchSummary('batch_1').total, 5);

    const result = repo.correctLast('batch_1', null, 'usr_insp_001');
    assert.ok(result, 'there was a spring to undo');
    assert.strictEqual(repo.batchSummary('batch_1').total, 4, 'undo must subtract, never add');
  });

  it('TC-SRT-12: every tally agrees after an undo, not just the batch total', () => {
    // The original defect was one query out of four missing the exclusion.
    // A stock figure that disagrees with the session figure sends someone to
    // the rack for a spring that is not there.
    sort('OUTER', 'GREEN', 258.5, 3);
    repo.correctLast('batch_1', null, 'usr_insp_001');

    const today = new Date().toISOString().slice(0, 10);
    const stock = repo.stockByBand('CASNUB_22_NLB', 'USED')
      .reduce((sum, r) => sum + r.count, 0);
    const byBand = repo.batchSummary('batch_1').byBand
      .reduce((sum, r) => sum + r.count, 0);

    assert.strictEqual(repo.batchSummary('batch_1').total, 2);
    assert.strictEqual(stock, 2, 'stock on hand');
    assert.strictEqual(byBand, 2, 'the batch band breakdown');
    assert.strictEqual(repo.dailyThroughput(today).total, 2, 'the day\'s throughput');
  });

  it('TC-SRT-13: nothing is deleted — the withdrawal is part of the record', () => {
    sort('OUTER', 'GREEN', 258.5, 1);
    const original = (db.prepare('SELECT id FROM spring_sorting_records').get() as any).id;

    const result = repo.correctLast('batch_1', null, 'usr_insp_001')!;
    assert.strictEqual(result.correctedId, original);

    const rows = db.prepare('SELECT id, supersedes, voided FROM spring_sorting_records ORDER BY rowid').all() as any[];
    assert.strictEqual(rows.length, 2, 'both the spring and its withdrawal survive');
    assert.strictEqual(rows[0].id, original, 'the original row is untouched');
    assert.strictEqual(rows[1].supersedes, original);
    assert.strictEqual(rows[1].voided, 1);
    assert.strictEqual(repo.batchSummary('batch_1').total, 0);
  });

  it('TC-SRT-14: undoing repeatedly walks back, and stops at empty', () => {
    // The button an inspector taps twice. It must never go negative and must
    // never start voiding its own voids.
    sort('OUTER', 'GREEN', 258.5, 3);
    for (let i = 0; i < 3; i++) {
      assert.ok(repo.correctLast('batch_1', null, 'usr_insp_001'), `undo ${i + 1}`);
    }
    assert.strictEqual(repo.batchSummary('batch_1').total, 0);

    for (let i = 0; i < 5; i++) {
      assert.strictEqual(
        repo.correctLast('batch_1', null, 'usr_insp_001'),
        null,
        'undoing an empty session reports nothing to undo rather than throwing'
      );
    }
    assert.strictEqual(repo.batchSummary('batch_1').total, 0, 'never below zero');
  });

  it('TC-SRT-15: a correction replaces the spring rather than removing it', () => {
    // Distinct from an undo: the spring exists, it was filed in the wrong
    // band. The count must hold and the band must move.
    sort('OUTER', 'GREEN', 258.5, 4);
    const result = repo.correctLast('batch_1', replacement, 'usr_insp_001')!;
    assert.ok(result.newId, 'a correction produces a replacement record');

    const summary = repo.batchSummary('batch_1');
    assert.strictEqual(summary.total, 4, 'a correction is not a removal');

    const bands = Object.fromEntries(summary.byBand.map((b) => [b.band, b.count]));
    assert.strictEqual(bands.GREEN, 3);
    assert.strictEqual(bands.BLUE, 1, 'the corrected spring moved band');
  });

  /*
   * Replaying a spring recorded offline.
   *
   * Sorting was the one workflow posting straight to the network with nothing
   * behind it — a dropped connection on shop wifi lost the tap outright. The
   * device now queues it and sends it later, which only works if a repeated
   * delivery is recognised as the same spring. `sync_id` is UNIQUE, so
   * without this the retry would throw, the queue would never drain, and
   * every spring behind it would stay stuck on the tablet.
   */
  it('TC-SRT-17: replaying a queued spring records it once, not twice', () => {
    const spring = {
      batchId: 'batch_1', bogieType: 'CASNUB_22_NLB' as const, condition: 'USED' as const,
      springPosition: 'OUTER' as const, measuredFreeHeight: 258.5,
      classifiedBand: 'GREEN' as const, status: 'PASS' as const,
      inspectorId: 'usr_insp_001', syncId: 'srt-1756450000000-ab12c'
    };

    const first = repo.record(spring);
    assert.strictEqual(first.alreadyRecorded, false);

    // The tablet did not hear the answer and sends it again.
    const second = repo.record(spring);
    assert.strictEqual(second.alreadyRecorded, true, 'the second delivery is the same spring');
    assert.strictEqual(second.id, first.id, 'and answers with the record that exists');

    assert.strictEqual(repo.batchSummary('batch_1').total, 1, 'one tap, one spring');
  });

  it('TC-SRT-18: a queue that is sent three times still counts once', () => {
    // What a flaky connection actually does: partial deliveries, repeated.
    const queue = [1, 2, 3].map((n) => ({
      batchId: 'batch_1', bogieType: 'CASNUB_22_NLB' as const, condition: 'USED' as const,
      springPosition: 'OUTER' as const, measuredFreeHeight: 258.5,
      classifiedBand: 'GREEN' as const, status: 'PASS' as const,
      inspectorId: 'usr_insp_001', syncId: `srt-queued-${n}`
    }));

    for (let attempt = 0; attempt < 3; attempt++) {
      for (const spring of queue) repo.record(spring);
    }

    assert.strictEqual(repo.batchSummary('batch_1').total, 3, 'three springs, nine deliveries');
    assert.strictEqual(
      (db.prepare('SELECT COUNT(*) c FROM spring_sorting_records').get() as any).c,
      3,
      'and only three rows were ever written'
    );
  });

  it('TC-SRT-19: springs without a syncId are never deduplicated together', () => {
    /*
     * Two springs of the same kind and the same height are two springs. Only
     * the device-generated id makes a repeat recognisable, so an absent id
     * must never be treated as a match — that would silently swallow every
     * identical spring after the first, and identical springs are the normal
     * case when a pile sorts into one band.
     */
    sort('OUTER', 'GREEN', 258.5, 6);
    assert.strictEqual(repo.batchSummary('batch_1').total, 6);
  });

  /*
   * Bogies with no band table.
   *
   * BOXNS rides LWLH25 and is 369 wagons a year at Raipur, the fifth busiest
   * type in the shop. The §309C condemning limits that judge it were
   * transcribed and tested months ago and then imported by nothing: the
   * sorting screen offered three CASNUB bogies, `BogieType` listed only those
   * three, and this route classified every spring through the G-95 band
   * lookup — which has no table for LWLH25 and threw.
   *
   * So the springs could be counted and never judged, and a condemnation had
   * nowhere to go.
   */
  it('TC-SRT-20: an LWLH25 spring can be recorded and judged', () => {
    const { id } = repo.record({
      batchId: 'batch_lw', bogieType: 'LWLH25' as any, condition: 'USED',
      springPosition: 'OUTER', measuredFreeHeight: 260,
      classifiedBand: null, bandRoman: null, status: 'PASS',
      tableReference: 'WMM 2.0 §309C (LWLH25)', inspectorId: 'usr_insp_001'
    });

    const row = db.prepare('SELECT * FROM spring_sorting_records WHERE id = ?').get(id) as any;
    assert.strictEqual(row.bogie_type, 'LWLH25');
    assert.strictEqual(row.classified_band, null, 'no band is invented for a bogie with no table');
    assert.strictEqual(row.status, 'PASS');
    assert.strictEqual(repo.batchSummary('batch_lw').total, 1, 'and it counts in the session');
  });

  it('TC-SRT-21: unbanded springs count in the session even though no band tally can show them', () => {
    /*
     * The band breakdown groups by colour and these have none, so they are
     * absent from it by definition. The session total must still include
     * them: an inspector counts the pile in front of them, and a screen that
     * showed four after they had sorted six would be the same lie the undo
     * bug told.
     */
    for (let i = 0; i < 6; i++) {
      repo.record({
        batchId: 'batch_lw2', bogieType: 'LWLH25' as any, condition: 'USED',
        springPosition: 'OUTER', measuredFreeHeight: 260,
        classifiedBand: null, status: 'PASS', inspectorId: 'usr_insp_001'
      });
    }
    const summary = repo.batchSummary('batch_lw2');
    assert.strictEqual(summary.total, 6);
    assert.strictEqual(summary.passed, 6);
    assert.strictEqual(summary.byBand.length, 0, 'no band rows, because there are no bands');
  });

  it('TC-SRT-16: a correction can be undone in its turn', () => {
    // Correct a spring, then take the whole thing back. The undo must land on
    // the correction — the newest live record — not on some earlier row.
    sort('OUTER', 'GREEN', 258.5, 2);
    const corrected = repo.correctLast('batch_1', replacement, 'usr_insp_001')!;
    assert.strictEqual(repo.batchSummary('batch_1').total, 2);

    const undone = repo.correctLast('batch_1', null, 'usr_insp_001')!;
    assert.strictEqual(undone.correctedId, corrected.newId, 'undo takes the newest live record');
    assert.strictEqual(repo.batchSummary('batch_1').total, 1);

    const bands = Object.fromEntries(repo.batchSummary('batch_1').byBand.map((b) => [b.band, b.count]));
    assert.strictEqual(bands.BLUE, undefined, 'the corrected spring is gone entirely');
    assert.strictEqual(bands.GREEN, 1);
  });
});
