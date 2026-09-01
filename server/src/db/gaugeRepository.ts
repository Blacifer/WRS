/**
 * The instruments, and whether anyone can still trust them
 * Indian Railways WRS Raipur
 *
 * A spring record has always said what was measured, by whom, and against
 * which RDSO table. It has never said what it was measured *with*. For a
 * quality system that is a real hole: a reading is only as good as the
 * instrument's calibration record, and "260.5 mm, PASS" cannot be defended to
 * an auditor who asks which gauge produced it and when that gauge was last
 * checked.
 *
 * The shop floor makes the point more sharply than the principle does. The
 * snubber gauge in daily use, SSG-02, carries a calibration label with
 * "Calibrated on" and "Calibration valid upto" both left blank. That is worth
 * surfacing whether or not the instrument is sound, because nothing on it and
 * nothing in the record says when anybody last verified it.
 *
 * Nothing here invents a date. An unrecorded calibration is reported as
 * unrecorded.
 */

import type { DatabaseSync } from 'node:sqlite';

export type CalibrationState = 'VALID' | 'EXPIRED' | 'UNRECORDED' | 'NO_GAUGE_NAMED';

export interface GaugeRecord {
  id: string;
  gaugeCode: string;
  description: string;
  appliesTo: string | null;
  certificateNumber: string | null;
  issuedTo: string | null;
  calibratedOn: string | null;
  validUpto: string | null;
  isActive: boolean;
  notes: string | null;
  /** Derived, never stored on the gauge — see calibrationStateOf. */
  calibrationState: CalibrationState;
  calibrationSummary: string;
}

/**
 * What a gauge's calibration is worth today.
 *
 * Deliberately three outcomes rather than a boolean. "Not calibrated" and
 * "calibration lapsed" are different problems needing different action — one
 * is a missing record, the other is an overdue instrument — and collapsing
 * them into "not valid" loses the distinction exactly where it matters.
 */
export function calibrationStateOf(
  gauge: { calibratedOn?: string | null; validUpto?: string | null },
  now: Date = new Date()
): CalibrationState {
  if (!gauge.calibratedOn && !gauge.validUpto) return 'UNRECORDED';
  if (!gauge.validUpto) return 'UNRECORDED';

  const expiry = new Date(`${gauge.validUpto}T23:59:59Z`);
  if (Number.isNaN(expiry.getTime())) return 'UNRECORDED';

  return expiry.getTime() >= now.getTime() ? 'VALID' : 'EXPIRED';
}

/** One plain sentence, so the screen does not have to interpret the state. */
export function describeCalibration(state: CalibrationState, validUpto?: string | null): string {
  switch (state) {
    case 'VALID':
      return `Calibration valid to ${validUpto}.`;
    case 'EXPIRED':
      return `Calibration lapsed on ${validUpto}. Readings taken with it are recorded as such.`;
    case 'UNRECORDED':
      return 'No calibration date is recorded for this gauge. Readings will be marked accordingly.';
    case 'NO_GAUGE_NAMED':
      return 'No gauge was named for this reading.';
  }
}

function hydrate(row: any): GaugeRecord {
  const gauge = {
    id: row.id,
    gaugeCode: row.gauge_code,
    description: row.description,
    appliesTo: row.applies_to ?? null,
    certificateNumber: row.certificate_number ?? null,
    issuedTo: row.issued_to ?? null,
    calibratedOn: row.calibrated_on ?? null,
    validUpto: row.valid_upto ?? null,
    isActive: row.is_active === 1,
    notes: row.notes ?? null
  };
  const calibrationState = calibrationStateOf(gauge);
  return {
    ...gauge,
    calibrationState,
    calibrationSummary: describeCalibration(calibrationState, gauge.validUpto)
  };
}

export class GaugeRepository {
  // Written out rather than a parameter property: the server runs under
  // Node's strip-only TypeScript, which does not support that shorthand.
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  public list(options?: { activeOnly?: boolean; appliesTo?: string }): GaugeRecord[] {
    const where: string[] = [];
    const params: any[] = [];
    if (options?.activeOnly !== false) where.push('is_active = 1');
    if (options?.appliesTo) {
      // A snubber gauge cannot judge an outer spring. A gauge with no stated
      // scope is offered for everything rather than hidden.
      where.push('(applies_to IS NULL OR applies_to = ?)');
      params.push(options.appliesTo);
    }
    const sql = `SELECT * FROM gauges ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY gauge_code`;
    return (this.db.prepare(sql).all(...params) as any[]).map(hydrate);
  }

  public byCode(gaugeCode: string): GaugeRecord | null {
    const row = this.db.prepare('SELECT * FROM gauges WHERE gauge_code = ?').get(gaugeCode) as any;
    return row ? hydrate(row) : null;
  }

  /**
   * The calibration state to stamp on a reading taken with this gauge.
   *
   * Resolved at the moment of the reading and stored on the record, because
   * the gauge's calibration will change and the record must keep saying what
   * was true when the spring was judged. Recalibrating an instrument next
   * month must not retrospectively make today's uncalibrated readings look
   * sound.
   */
  public stateForReading(gaugeCode?: string | null): CalibrationState {
    if (!gaugeCode) return 'NO_GAUGE_NAMED';
    const gauge = this.byCode(gaugeCode);
    if (!gauge) return 'NO_GAUGE_NAMED';
    return gauge.calibrationState;
  }

  public upsert(input: {
    gaugeCode: string;
    description: string;
    appliesTo?: string | null;
    certificateNumber?: string | null;
    issuedTo?: string | null;
    calibratedOn?: string | null;
    validUpto?: string | null;
    notes?: string | null;
  }): GaugeRecord {
    const existing = this.byCode(input.gaugeCode);
    if (existing) {
      this.db.prepare(`
        UPDATE gauges SET
          description = ?, applies_to = ?, certificate_number = ?, issued_to = ?,
          calibrated_on = ?, valid_upto = ?, notes = ?
        WHERE gauge_code = ?
      `).run(
        input.description,
        input.appliesTo ?? null,
        input.certificateNumber ?? null,
        input.issuedTo ?? null,
        input.calibratedOn ?? null,
        input.validUpto ?? null,
        input.notes ?? null,
        input.gaugeCode
      );
    } else {
      this.db.prepare(`
        INSERT INTO gauges
          (id, gauge_code, description, applies_to, certificate_number, issued_to,
           calibrated_on, valid_upto, is_active, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      `).run(
        `gauge_${crypto.randomUUID()}`,
        input.gaugeCode,
        input.description,
        input.appliesTo ?? null,
        input.certificateNumber ?? null,
        input.issuedTo ?? null,
        input.calibratedOn ?? null,
        input.validUpto ?? null,
        input.notes ?? null
      );
    }
    return this.byCode(input.gaugeCode)!;
  }

  public setActive(gaugeCode: string, isActive: boolean): void {
    this.db.prepare('UPDATE gauges SET is_active = ? WHERE gauge_code = ?')
      .run(isActive ? 1 : 0, gaugeCode);
  }

  /**
   * How many readings were taken with an instrument nobody had verified.
   *
   * The number a supervisor or the DRM actually wants: not "is the paperwork
   * tidy" but "how much of what we have signed rests on an unchecked gauge".
   */
  public readingsOnUnverifiedGauges(): { unrecorded: number; expired: number; noGauge: number } {
    const row = this.db.prepare(`
      SELECT
        SUM(CASE WHEN gauge_calibration_state = 'UNRECORDED' THEN 1 ELSE 0 END) AS unrecorded,
        SUM(CASE WHEN gauge_calibration_state = 'EXPIRED' THEN 1 ELSE 0 END) AS expired,
        SUM(CASE WHEN gauge_calibration_state IS NULL
                   OR gauge_calibration_state = 'NO_GAUGE_NAMED' THEN 1 ELSE 0 END) AS no_gauge
      FROM spring_sorting_records
      WHERE voided = 0
    `).get() as any;
    return {
      unrecorded: row?.unrecorded ?? 0,
      expired: row?.expired ?? 0,
      noGauge: row?.no_gauge ?? 0
    };
  }
}
