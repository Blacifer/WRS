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
  public record(input: SortingRecordInput): { id: string } {
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
        inspector_id, inspector_name, sync_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      input.syncId ?? null
    );

    return { id };
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
      FROM spring_sorting_records WHERE batch_id = ?
    `).get(batchId) as any;

    const byBand = this.db.prepare(`
      SELECT classified_band AS band, spring_position AS springPosition, COUNT(*) AS count
      FROM spring_sorting_records
      WHERE batch_id = ? AND status = 'PASS' AND classified_band IS NOT NULL
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
      'assigned_wagon_number IS NULL'
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

  /** Throughput for a day — the figure the DRM quoted as 900. */
  public dailyThroughput(date: string): { date: string; total: number; passed: number; condemned: number } {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN status = 'PASS' THEN 1 ELSE 0 END) AS passed,
             SUM(CASE WHEN status = 'CONDEMNED' THEN 1 ELSE 0 END) AS condemned
      FROM spring_sorting_records
      WHERE substr(created_at, 1, 10) = ?
    `).get(date) as any;

    return {
      date,
      total: row?.total || 0,
      passed: row?.passed || 0,
      condemned: row?.condemned || 0
    };
  }
}
