/**
 * Spring Sorting Repository
 * Indian Railways WRS Raipur
 *
 * The shop dismantles wagons and sorts the springs in bulk against the strip —
 * about 900 a day. The wagon they came off is frequently not known at that
 * point, so these are records of stock rather than of a wagon's nest.
 *
 * The useful output is not the individual record, it is what the pile adds up
 * to: how many springs are in each group, how many were rejected, and — the
 * part nobody can work out on a shop floor — how many complete matched nests
 * each group can actually supply. A group holding 143 outer springs sounds
 * healthy until you need twelve of one band and find they are spread across
 * four.
 */

import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import { logAuditEvent } from './auditLog.ts';
import type { BogieType, SpringCondition, SpringPosition, BandColor } from '../../../shared/types.ts';

export interface SortingRecordInput {
  batchId: string;
  bogieType: BogieType;
  condition: SpringCondition;
  springPosition: SpringPosition;
  measuredFreeHeight: number;
  heightIsApproximate?: boolean;
  classifiedBand?: BandColor | null;
  bandRoman?: string | null;
  status: 'PASS' | 'CONDEMNED';
  damageType?: string | null;
  condemnationReason?: string | null;
  tableReference?: string | null;
  inspectorId: string;
  inspectorName?: string | null;
  syncId?: string | null;
  /**
   * The record this one replaces, when correcting a mistap.
   *
   * Only the correcting record carries the link. Marking the original would
   * be an UPDATE, which the append-only trigger refuses — correctly.
   */
  supersedes?: string | null;
  /**
   * True when this record withdraws the one it supersedes without putting a
   * spring in its place — a mistap taken back. It is written, kept and
   * attributed like any other row, and counted nowhere.
   */
  voided?: boolean;
}

export interface BandTally {
  band: string;
  springPosition: SpringPosition;
  count: number;
}

export interface NestCapacity {
  springPosition: SpringPosition;
  band: string;
  available: number;
  /** Springs of this position needed for one nest of the target wagon. */
  requiredPerNest: number;
  /** Complete nests this band alone can supply. */
  completeNests: number;
}

/**
 * The rows that stand for a spring somebody is actually holding.
 *
 * Two exclusions, and they are not the same one twice. A row named in some
 * other row's `supersedes` has been replaced, so counting it would count the
 * spring twice — once wrong and once right. A row marked `voided` was itself
 * the taking-back of a tap, so it stands for no spring at all.
 *
 * Kept in one place because it must be applied to every tally without
 * exception. The first version of undo left it off the batch total, and the
 * count went UP when an inspector corrected a spring — the single most
 * confidence-destroying thing an undo button can do.
 */
const LIVE_RECORDS =
  "voided = 0 AND id NOT IN (SELECT supersedes FROM spring_sorting_records WHERE supersedes IS NOT NULL)";

export class SortingRepository {
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  /**
   * Records one sorted spring.
   *
   * The inspector must exist. Sorting is high-volume and unsupervised, which
   * is exactly when an unattributable record is least acceptable — 900 rows a
   * day with nobody's name against them is not a record, it is a rumour.
   */
  public record(input: SortingRecordInput): { id: string; alreadyRecorded: boolean } {
    /*
     * A spring recorded offline is replayed when the tablet reconnects, and a
     * replay must be safe to repeat. The device stamps each tap with a
     * `syncId` it generates once, so a second delivery of the same tap is
     * recognisable as the same spring rather than a second one.
     *
     * Without this the retry is worse than the drop it recovers from: the
     * column is UNIQUE, so a repeat throws, the batch never drains, and every
     * spring behind it stays stuck on the device. Answering with the record
     * that already exists is what lets the queue empty.
     */
    if (input.syncId) {
      const seen = this.db
        .prepare('SELECT id FROM spring_sorting_records WHERE sync_id = ?')
        .get(input.syncId) as { id: string } | undefined;
      if (seen) return { id: seen.id, alreadyRecorded: true };
    }

    const signer = this.db
      .prepare('SELECT id, is_active FROM users WHERE id = ?')
      .get(input.inspectorId) as { id: string; is_active: number } | undefined;

    if (!signer) {
      throw new Error(`Inspector ${input.inspectorId} is not a registered user.`);
    }
    if (!signer.is_active) {
      throw new Error(`Inspector ${input.inspectorId} is deactivated and cannot record sorting.`);
    }

    const id = `sort_${crypto.randomUUID()}`;

    this.db.prepare(`
      INSERT INTO spring_sorting_records (
        id, batch_id, bogie_type, spring_condition, spring_position,
        measured_height, height_is_approximate, classified_band, band_roman,
        status, damage_type, condemnation_reason, table_reference,
        inspector_id, inspector_name, sync_id, supersedes, voided
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.batchId,
      input.bogieType,
      input.condition,
      input.springPosition,
      input.measuredFreeHeight,
      input.heightIsApproximate ? 1 : 0,
      input.classifiedBand ?? null,
      input.bandRoman ?? null,
      input.status,
      input.damageType ?? null,
      input.condemnationReason ?? null,
      input.tableReference ?? null,
      input.inspectorId,
      input.inspectorName ?? null,
      input.syncId ?? null,
      input.supersedes ?? null,
      input.voided ? 1 : 0
    );

    return { id, alreadyRecorded: false };
  }

  /**
   * Corrects the last spring recorded in a batch.
   *
   * Sorting is one tap per spring, roughly 700 a shift, so a wrong tap is a
   * certainty rather than a risk. There was no way to fix one, and an
   * inspector who cannot correct a mistake either stops trusting the record
   * or keeps the corrections on paper — and paper is the thing this replaces.
   *
   * Nothing is deleted or altered. The table is append-only at the database
   * engine and stays that way: this appends a NEW record carrying
   * `supersedes`, pointing back at the one it replaces. Both rows survive, so
   * the correction itself is part of the record — which is what an audit
   * trail is for. Counts simply stop including the superseded row.
   *
   * Returns null when there is nothing to correct, rather than throwing: the
   * caller is a button an inspector may tap twice.
   */
  public correctLast(
    batchId: string,
    replacement: Omit<SortingRecordInput, 'batchId' | 'supersedes'> | null,
    actorId: string
  ): { correctedId: string; newId: string | null } | null {
    const last = this.db.prepare(`
      SELECT id FROM spring_sorting_records
      WHERE batch_id = ?
        AND voided = 0
        AND id NOT IN (
          SELECT supersedes FROM spring_sorting_records
          WHERE supersedes IS NOT NULL AND batch_id = ?
        )
      ORDER BY created_at DESC, rowid DESC
      LIMIT 1
    `).get(batchId, batchId) as { id: string } | undefined;

    if (!last) return null;

    /*
     * A plain undo — the tap was an accident and there is no spring to
     * re-record — still appends a row, because the alternative is deleting
     * one. It carries the original's details so the record remains readable,
     * `supersedes` takes the original out of the count, and `voided` keeps
     * the withdrawal itself out of it. Without the second flag the undo would
     * remove one spring and add one back, which is how the tally first went
     * up when an inspector took a tap back.
     */
    const base = replacement ?? (this.db.prepare(
      'SELECT * FROM spring_sorting_records WHERE id = ?'
    ).get(last.id) as any);

    const { id: newId } = this.record({
      batchId,
      bogieType: replacement ? replacement.bogieType : base.bogie_type,
      condition: replacement ? replacement.condition : base.spring_condition,
      springPosition: replacement ? replacement.springPosition : base.spring_position,
      measuredFreeHeight: replacement ? replacement.measuredFreeHeight : base.measured_height,
      heightIsApproximate: replacement ? replacement.heightIsApproximate : base.height_is_approximate === 1,
      classifiedBand: replacement ? replacement.classifiedBand : base.classified_band,
      bandRoman: replacement ? replacement.bandRoman : base.band_roman,
      status: replacement ? replacement.status : base.status,
      damageType: replacement ? replacement.damageType : base.damage_type,
      condemnationReason: replacement
        ? replacement.condemnationReason
        : 'Withdrawn by the inspector — recorded in error.',
      tableReference: replacement ? replacement.tableReference : base.table_reference,
      inspectorId: actorId,
      inspectorName: replacement?.inspectorName,
      supersedes: last.id,
      voided: replacement === null
    } as SortingRecordInput);

    return { correctedId: last.id, newId: replacement ? newId : null };
  }

  /**
   * Closes a sorting batch by writing one audit entry summarising it.
   *
   * Deliberately one entry per batch rather than per spring: 900 chained rows
   * a day would bury the wagon lifecycle events the log exists to make
   * findable, and the sorting records are themselves append-only and
   * individually attributed. What the chain needs is that the session happened,
   * who did it, and what it produced.
   */
  public closeBatch(batchId: string, userId: string, userRole: string): void {
    const summary = this.batchSummary(batchId);
    logAuditEvent(this.db, {
      eventType: 'INSPECTION_CREATED' as any,
      userId,
      userRole,
      payload: {
        action: 'SPRING_SORTING_BATCH',
        batchId,
        ...summary
      }
    });
  }

  public batchSummary(batchId: string): {
    batchId: string;
    total: number;
    passed: number;
    condemned: number;
    byBand: BandTally[];
  } {
    const totals = this.db.prepare(`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN status = 'PASS' THEN 1 ELSE 0 END) AS passed,
             SUM(CASE WHEN status = 'CONDEMNED' THEN 1 ELSE 0 END) AS condemned
      FROM spring_sorting_records
      WHERE batch_id = ? AND ${LIVE_RECORDS}
    `).get(batchId) as any;

    const byBand = this.db.prepare(`
      SELECT classified_band AS band, spring_position AS springPosition, COUNT(*) AS count
      FROM spring_sorting_records
      WHERE batch_id = ? AND status = 'PASS' AND classified_band IS NOT NULL
        AND ${LIVE_RECORDS}
      GROUP BY classified_band, spring_position
      ORDER BY spring_position, classified_band
    `).all(batchId) as any[];

    return {
      batchId,
      total: totals?.total || 0,
      passed: totals?.passed || 0,
      condemned: totals?.condemned || 0,
      byBand: byBand as BandTally[]
    };
  }

  /**
   * Stock on hand for a bogie type and condition, grouped as the strip groups
   * them. Optionally narrowed to one day, which is how a shift is reviewed.
   */
  public stockByBand(
    bogieType: BogieType,
    condition: SpringCondition,
    options?: { fromDate?: string; toDate?: string }
  ): BandTally[] {
    const clauses = [
      'bogie_type = ?',
      'spring_condition = ?',
      "status = 'PASS'",
      'classified_band IS NOT NULL',
      'assigned_wagon_number IS NULL',
      // A corrected spring must not be counted twice — once wrong and once
      // right — and a withdrawn tap is not stock at all.
      LIVE_RECORDS
    ];
    const params: any[] = [bogieType, condition];

    if (options?.fromDate) {
      clauses.push('created_at >= ?');
      params.push(options.fromDate);
    }
    if (options?.toDate) {
      clauses.push('created_at <= ?');
      params.push(options.toDate);
    }

    return this.db.prepare(`
      SELECT classified_band AS band, spring_position AS springPosition, COUNT(*) AS count
      FROM spring_sorting_records
      WHERE ${clauses.join(' AND ')}
      GROUP BY classified_band, spring_position
      ORDER BY spring_position, classified_band
    `).all(...params) as BandTally[];
  }

  /**
   * How many complete nests the sorted stock can actually supply.
   *
   * This is the question the tally alone cannot answer. A nest must come from
   * a single band — that is the whole point of the grouping rule — so holding
   * 143 outer springs means nothing until you know how they split. Counting
   * per band and dividing by what one nest needs turns a pile into a plan.
   */
  public nestCapacity(
    bogieType: BogieType,
    condition: SpringCondition,
    required: { outer: number; inner: number; snubber: number }
  ): NestCapacity[] {
    const stock = this.stockByBand(bogieType, condition);
    const requiredFor = (position: SpringPosition): number => {
      if (position === 'OUTER') return required.outer;
      if (position === 'INNER') return required.inner;
      return required.snubber;
    };

    return stock
      .map((row) => {
        const requiredPerNest = requiredFor(row.springPosition);
        return {
          springPosition: row.springPosition,
          band: row.band,
          available: row.count,
          requiredPerNest,
          completeNests: requiredPerNest > 0 ? Math.floor(row.count / requiredPerNest) : 0
        };
      })
      .sort(
        (a, b) =>
          a.springPosition.localeCompare(b.springPosition) || b.completeNests - a.completeNests
      );
  }

  /**
   * Throughput for a day — the figure the DRM quoted as 900.
   *
   * Returns the first and last record times as well as the counts, so a rate
   * can be worked out from the span actually spent sorting rather than from
   * the clock since midnight. Someone who sorts for two hours after lunch has
   * not been working at a quarter of their real speed, and a figure that said
   * so would be worse than showing none.
   *
   * The caller decides whether the span is long enough to quote a rate from.
   * It is given the raw ends rather than a computed rate precisely so that
   * judgement is made where the display rules live.
   */
  public dailyThroughput(date: string): {
    date: string;
    total: number;
    passed: number;
    condemned: number;
    firstAt: string | null;
    lastAt: string | null;
  } {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN status = 'PASS' THEN 1 ELSE 0 END) AS passed,
             SUM(CASE WHEN status = 'CONDEMNED' THEN 1 ELSE 0 END) AS condemned,
             MIN(created_at) AS firstAt,
             MAX(created_at) AS lastAt
      FROM spring_sorting_records
      WHERE substr(created_at, 1, 10) = ? AND ${LIVE_RECORDS}
    `).get(date) as any;

    return {
      date,
      total: row?.total || 0,
      passed: row?.passed || 0,
      condemned: row?.condemned || 0,
      firstAt: row?.firstAt || null,
      lastAt: row?.lastAt || null
    };
  }
}
