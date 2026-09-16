/**
 * Wheel readings — recorded, judged at write time, latest per wheel counts
 * Indian Railways WRS Raipur
 *
 * The limits are in shared/classification/wheelLimits.ts and the wheel family
 * comes from the wagon's designation, never from the caller. A reading is
 * stored with the verdict it earned and the limit it was held against, so a
 * later change to the table cannot retrospectively pass or condemn a wheel
 * that was judged today.
 */

import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { getWagonSpringConfig } from '../../../shared/classification/wagonTypes.ts';
import {
  judgeWheel, judgeWheelSet, wheelFamilyFor, WHEEL_DIAMETER_LIMITS, WHEEL_PROFILE_LIMITS, SOURCE,
  type WheelFamily, type WheelJudgement, type WheelReadingInput, type WheelSetJudgement, type WheelVerdict
} from '../../../shared/classification/wheelLimits.ts';

export interface WheelReadingRow {
  id: string;
  wagonNumber: string;
  axle: 1 | 2 | 3 | 4;
  side: 'L' | 'R';
  family: WheelFamily | null;
  treadDiameterMm: number;
  flangeThicknessMm: number | null;
  flangeHeightMm: number | null;
  rootRadiusMm: number | null;
  flatMm: number | null;
  hollowMm: number | null;
  verdict: WheelVerdict;
  findings: WheelJudgement['findings'];
  instrument: string | null;
  inspectorId: string;
  inspectorName: string;
  createdAt: string;
}

export class WheelRepository {
  private readonly db: DatabaseSync;
  constructor(db: DatabaseSync) { this.db = db; }

  familyFor(wagonNumber: string): { family: WheelFamily | null; designation: string | null; bogieDescription: string | null } {
    const w = this.db.prepare('SELECT wagon_type FROM wagons WHERE wagon_number = ?').get(wagonNumber.trim().toUpperCase()) as any;
    const config = w ? getWagonSpringConfig(w.wagon_type) : null;
    return { family: wheelFamilyFor(config?.bogieDescription), designation: config?.designation ?? w?.wagon_type ?? null, bogieDescription: config?.bogieDescription ?? null };
  }

  private map(r: any): WheelReadingRow {
    let findings: WheelJudgement['findings'] = [];
    try { findings = JSON.parse(r.findings_json || '[]'); } catch { findings = []; }
    return {
      id: r.id, wagonNumber: r.wagon_number, axle: r.axle, side: r.side, family: r.wheel_family,
      treadDiameterMm: r.tread_diameter_mm, flangeThicknessMm: r.flange_thickness_mm, flangeHeightMm: r.flange_height_mm,
      rootRadiusMm: r.root_radius_mm, flatMm: r.flat_mm, hollowMm: r.hollow_mm, verdict: r.verdict, findings,
      instrument: r.instrument, inspectorId: r.inspector_id, inspectorName: r.inspector_name, createdAt: r.created_at
    };
  }

  record(input: { wagonNumber: string; axle: number; side: string; reading: WheelReadingInput; instrument?: string | null; inspectorId: string; inspectorName: string }): { row: WheelReadingRow; judgement: WheelJudgement } {
    const wagonNumber = input.wagonNumber.trim().toUpperCase();
    if (!this.db.prepare('SELECT 1 FROM wagons WHERE wagon_number = ?').get(wagonNumber)) throw Object.assign(new Error(`Wagon ${wagonNumber} not found.`), { code: 'WAGON_NOT_FOUND' });
    const signer = this.db.prepare('SELECT is_active FROM users WHERE id = ?').get(input.inspectorId) as any;
    if (!signer || !signer.is_active) throw Object.assign(new Error('A wheel reading must be attributable to an active inspector.'), { code: 'UNKNOWN_ACTOR' });
    const { family } = this.familyFor(wagonNumber);
    const judgement = judgeWheel(family, input.reading);
    const id = `whl_${randomUUID()}`;
    this.db.prepare(`
      INSERT INTO wheel_readings (id, wagon_number, axle, side, wheel_family, tread_diameter_mm, flange_thickness_mm, flange_height_mm, root_radius_mm, flat_mm, hollow_mm, verdict, findings_json, instrument, inspector_id, inspector_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, wagonNumber, input.axle, input.side, family, input.reading.treadDiameterMm, input.reading.flangeThicknessMm ?? null, input.reading.flangeHeightMm ?? null,
      input.reading.rootRadiusMm ?? null, input.reading.flatMm ?? null, input.reading.hollowMm ?? null, judgement.verdict, JSON.stringify(judgement.findings), input.instrument ?? null, input.inspectorId, input.inspectorName);
    return { row: this.map(this.db.prepare('SELECT * FROM wheel_readings WHERE id = ?').get(id)), judgement };
  }

  /** Every reading ever taken on the wagon, oldest first. */
  history(wagonNumber: string): WheelReadingRow[] {
    return (this.db.prepare('SELECT * FROM wheel_readings WHERE wagon_number = ? ORDER BY created_at ASC, rowid ASC').all(wagonNumber.trim().toUpperCase()) as any[]).map((r) => this.map(r));
  }

  /** The latest reading per wheel — what the gate judges. */
  latest(wagonNumber: string): WheelReadingRow[] {
    const by = new Map<string, WheelReadingRow>();
    for (const r of this.history(wagonNumber)) by.set(`${r.axle}${r.side}`, r);
    return [...by.values()].sort((a, b) => a.axle - b.axle || a.side.localeCompare(b.side));
  }

  summary(wagonNumber: string): {
    family: WheelFamily | null; designation: string | null; bogieDescription: string | null;
    limits: (typeof WHEEL_DIAMETER_LIMITS)[WheelFamily] | null; profile: typeof WHEEL_PROFILE_LIMITS; source: string;
    wheels: WheelReadingRow[]; set: WheelSetJudgement; condemned: WheelReadingRow[]; belowShopIssue: WheelReadingRow[];
  } {
    const f = this.familyFor(wagonNumber);
    const wheels = this.latest(wagonNumber);
    const set = judgeWheelSet(f.family, wheels.map((w) => ({ axle: w.axle, side: w.side, treadDiameterMm: w.treadDiameterMm })));
    return {
      ...f, limits: f.family ? WHEEL_DIAMETER_LIMITS[f.family] : null, profile: WHEEL_PROFILE_LIMITS, source: SOURCE,
      wheels, set, condemned: wheels.filter((w) => w.verdict === 'CONDEMN'), belowShopIssue: wheels.filter((w) => w.verdict === 'BELOW_SHOP_ISSUE')
    };
  }
}
