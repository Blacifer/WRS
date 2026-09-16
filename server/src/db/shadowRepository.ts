/**
 * The shadow run: the log, the summaries, and the app's own half of the day
 * Indian Railways WRS Raipur
 *
 * See the tables' note in migrations.ts and docs/SHADOW_MODE_ROLLOUT.md.
 * The supervisor writes what the app cannot know; everything the app can
 * know about a day — springs recorded, condemned, nests flagged, amber
 * boxes raised and how they were answered, worked minutes at the bench and
 * on checklists — is computed here from the records the app already keeps.
 */

import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import {
  WHO_WAS_RIGHT, DISCREPANCY_CAUSES, VERDICT_WORDS, shadowVerdict,
  type DiscrepancyRow, type AmberBoxFigures, type DailySummaryRow, type ShadowVerdict,
  type WhoWasRight, type DiscrepancyCause, type VerdictWord
} from '../../../shared/analysis/shadowRun.ts';
import { workedMinutes, ratePerHour, PLAUSIBLE_SPRINGS_PER_HOUR, PLAUSIBLE_ITEMS_PER_HOUR, IDLE_GAP_MINUTES, type Rate } from '../../../shared/analysis/workedTime.ts';

export interface DiscrepancyInput {
  occurredOn: string;
  shift: string;
  inspectorName: string;
  wagonNumber?: string | null;
  location?: string | null;
  registerSays: string;
  appSays: string;
  registerVerdict: VerdictWord;
  appVerdict: VerdictWord;
  whoWasRight: WhoWasRight;
  cause: DiscrepancyCause;
  why?: string | null;
  wouldHaveStoppedAWagon: boolean;
  supersedes?: string | null;
  reportedBy: string;
}

export interface SummaryInput {
  summaryDate: string;
  shift: string;
  supervisorId: string;
  registerMinutesOneWagon?: number | null;
  appMinutesOneWagon?: number | null;
  transcriptionErrorsBoxMissed?: number;
  whatAppGotWrong?: string | null;
  whatAppCaught?: string | null;
  whatSlowed?: string | null;
  wouldHaveStoppedAWagon?: string | null;
}

/** The app's half of one day, from its own records. */
export interface AppDay {
  date: string;
  wagonsSwept: number;
  springsRecorded: number;
  springsCondemned: number;
  nestsFlagged: number;
  discrepanciesLogged: number;
  amber: AmberBoxFigures;
  bench: { workedMinutes: number; springsPerHour: Rate; inspectors: number };
  checklists: { verdicts: number; wagons: number; workedMinutes: number; itemsPerHour: Rate; medianMinutesPerWagon: number | null };
  overrides: number;
  withdrawn: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class ShadowRepository {
  private db: DatabaseSync;
  constructor(db: DatabaseSync) { this.db = db; }

  static validateDiscrepancy(b: any): { ok: true; value: Omit<DiscrepancyInput, 'reportedBy'> } | { ok: false; message: string } {
    const s = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
    if (!DATE_RE.test(s(b?.occurredOn))) return { ok: false, message: 'occurredOn must be a date, YYYY-MM-DD.' };
    if (!s(b?.shift)) return { ok: false, message: 'shift is required (e.g. A, B, C or morning/evening).' };
    if (!s(b?.inspectorName)) return { ok: false, message: 'inspectorName is required — who was on the part.' };
    if (!s(b?.registerSays)) return { ok: false, message: 'registerSays is required — what the register recorded.' };
    if (!s(b?.appSays)) return { ok: false, message: 'appSays is required — what the app recorded.' };
    const rv = s(b?.registerVerdict).toUpperCase() as VerdictWord;
    const av = s(b?.appVerdict).toUpperCase() as VerdictWord;
    if (!VERDICT_WORDS.includes(rv) || !VERDICT_WORDS.includes(av)) return { ok: false, message: `registerVerdict and appVerdict must each be one of ${VERDICT_WORDS.join(', ')}.` };
    const who = s(b?.whoWasRight).toUpperCase() as WhoWasRight;
    if (!WHO_WAS_RIGHT.includes(who)) return { ok: false, message: `whoWasRight must be one of ${WHO_WAS_RIGHT.join(', ')}. It is the important column.` };
    const cause = s(b?.cause).toUpperCase() as DiscrepancyCause;
    if (!DISCREPANCY_CAUSES.includes(cause)) return { ok: false, message: `cause must be one of ${DISCREPANCY_CAUSES.join(', ')}.` };
    return {
      ok: true,
      value: {
        occurredOn: s(b.occurredOn), shift: s(b.shift, 40), inspectorName: s(b.inspectorName, 120),
        wagonNumber: s(b?.wagonNumber, 40) || null, location: s(b?.location, 200) || null,
        registerSays: s(b.registerSays), appSays: s(b.appSays), registerVerdict: rv, appVerdict: av,
        whoWasRight: who, cause, why: s(b?.why, 2000) || null,
        wouldHaveStoppedAWagon: b?.wouldHaveStoppedAWagon === true || b?.wouldHaveStoppedAWagon === 1,
        supersedes: s(b?.supersedes, 80) || null
      }
    };
  }

  recordDiscrepancy(input: DiscrepancyInput): { id: string } {
    const id = `shd_${randomUUID()}`;
    if (input.supersedes) {
      const prior = this.db.prepare('SELECT id FROM shadow_discrepancies WHERE id = ?').get(input.supersedes);
      if (!prior) throw new Error(`Cannot correct ${input.supersedes}: no such discrepancy.`);
    }
    this.db.prepare(`
      INSERT INTO shadow_discrepancies (
        id, occurred_on, shift, inspector_name, wagon_number, location, register_says, app_says,
        register_verdict, app_verdict, who_was_right, cause, why, would_have_stopped_a_wagon, supersedes, reported_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, input.occurredOn, input.shift, input.inspectorName, input.wagonNumber ?? null, input.location ?? null,
      input.registerSays, input.appSays, input.registerVerdict, input.appVerdict, input.whoWasRight, input.cause,
      input.why ?? null, input.wouldHaveStoppedAWagon ? 1 : 0, input.supersedes ?? null, input.reportedBy
    );
    return { id };
  }

  /** Current rows: every discrepancy not superseded by a later one. */
  listDiscrepancies(sinceDate?: string, includeSuperseded = false): any[] {
    const rows = this.db.prepare(`
      SELECT d.*, u.full_name AS reported_by_name
      FROM shadow_discrepancies d
      LEFT JOIN users u ON u.id = d.reported_by
      WHERE (? IS NULL OR d.occurred_on >= ?)
        ${includeSuperseded ? '' : 'AND NOT EXISTS (SELECT 1 FROM shadow_discrepancies later WHERE later.supersedes = d.id)'}
      ORDER BY d.occurred_on DESC, d.created_at DESC
    `).all(sinceDate ?? null, sinceDate ?? null) as any[];
    return rows.map((r) => ({
      id: r.id, occurredOn: r.occurred_on, shift: r.shift, inspectorName: r.inspector_name,
      wagonNumber: r.wagon_number, location: r.location, registerSays: r.register_says, appSays: r.app_says,
      registerVerdict: r.register_verdict, appVerdict: r.app_verdict, whoWasRight: r.who_was_right, cause: r.cause,
      why: r.why, wouldHaveStoppedAWagon: r.would_have_stopped_a_wagon === 1, supersedes: r.supersedes,
      reportedBy: r.reported_by, reportedByName: r.reported_by_name ?? null, createdAt: r.created_at
    }));
  }

  recordSummary(input: SummaryInput): { id: string } {
    const id = `shs_${randomUUID()}`;
    this.db.prepare(`
      INSERT INTO shadow_daily_summaries (
        id, summary_date, shift, supervisor_id, register_minutes_one_wagon, app_minutes_one_wagon,
        transcription_errors_box_missed, what_app_got_wrong, what_app_caught, what_slowed, would_have_stopped_a_wagon
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, input.summaryDate, input.shift, input.supervisorId,
      input.registerMinutesOneWagon ?? null, input.appMinutesOneWagon ?? null,
      Math.max(0, Math.floor(input.transcriptionErrorsBoxMissed ?? 0)),
      input.whatAppGotWrong ?? null, input.whatAppCaught ?? null, input.whatSlowed ?? null, input.wouldHaveStoppedAWagon ?? null
    );
    return { id };
  }

  /** The latest summary per (date, shift); earlier ones survive but are not the record. */
  listSummaries(sinceDate?: string): any[] {
    const rows = this.db.prepare(`
      SELECT s.*, u.full_name AS supervisor_name
      FROM shadow_daily_summaries s
      LEFT JOIN users u ON u.id = s.supervisor_id
      WHERE (? IS NULL OR s.summary_date >= ?)
        -- The newest for the shift; rowid breaks a tie within one millisecond.
        AND NOT EXISTS (
          SELECT 1 FROM shadow_daily_summaries x
          WHERE x.summary_date = s.summary_date AND x.shift = s.shift
            AND (x.created_at > s.created_at OR (x.created_at = s.created_at AND x.rowid > s.rowid))
        )
      ORDER BY s.summary_date DESC, s.shift ASC
    `).all(sinceDate ?? null, sinceDate ?? null) as any[];
    return rows.map((r) => ({
      id: r.id, summaryDate: r.summary_date, shift: r.shift, supervisorId: r.supervisor_id, supervisorName: r.supervisor_name ?? null,
      registerMinutesOneWagon: r.register_minutes_one_wagon, appMinutesOneWagon: r.app_minutes_one_wagon,
      transcriptionErrorsBoxMissed: r.transcription_errors_box_missed,
      whatAppGotWrong: r.what_app_got_wrong, whatAppCaught: r.what_app_caught, whatSlowed: r.what_slowed,
      wouldHaveStoppedAWagon: r.would_have_stopped_a_wagon, createdAt: r.created_at
    }));
  }

  /** The amber box over a window: raised, and how each was answered. */
  amberFigures(sinceIso: string, untilIso: string): AmberBoxFigures {
    const asked = this.db.prepare(`
      SELECT inspection_id AS id FROM machine_learning_events
      WHERE subsystem = 'MEASUREMENT_ANOMALY' AND COALESCE(json_extract(context_json, '$.answered'), 0) = 0
        AND created_at >= ? AND created_at < ?
    `).all(sinceIso, untilIso) as Array<{ id: string }>;
    const answered = this.db.prepare(`
      SELECT inspection_id AS id, json_extract(human_output_json, '$.action') AS action FROM machine_learning_events
      WHERE subsystem = 'MEASUREMENT_ANOMALY' AND COALESCE(json_extract(context_json, '$.answered'), 0) = 1
        AND inspection_id IN (SELECT inspection_id FROM machine_learning_events WHERE subsystem = 'MEASUREMENT_ANOMALY' AND COALESCE(json_extract(context_json, '$.answered'), 0) = 0 AND created_at >= ? AND created_at < ?)
    `).all(sinceIso, untilIso) as Array<{ id: string; action: string }>;
    const answers = new Map(answered.map((a) => [a.id, a.action]));
    let reMeasured = 0, stands = 0;
    for (const q of asked) {
      const a = answers.get(q.id);
      if (a === 'RE_MEASURED') reMeasured++;
      else if (a === 'CONFIRMED') stands++;
    }
    return { raised: asked.length, reMeasured, stands, unanswered: asked.length - reMeasured - stands };
  }

  /** Everything the app knows about one day, from its own records. */
  appDay(date: string): AppDay {
    const since = `${date}T00:00:00.000Z`;
    const until = new Date(Date.parse(since) + 86400_000).toISOString();

    const springs = this.db.prepare(`
      SELECT created_at, inspector_id, status FROM spring_sorting_records
      WHERE created_at >= ? AND created_at < ? AND voided = 0
        AND NOT EXISTS (SELECT 1 FROM spring_sorting_records later WHERE later.supersedes = spring_sorting_records.id)
      ORDER BY created_at
    `).all(since, until) as any[];
    const wagonSprings = this.db.prepare(`SELECT created_at, inspector_id, status, wagon_number FROM inspections WHERE created_at >= ? AND created_at < ? ORDER BY created_at`).all(since, until) as any[];
    const benchMinutes = workedMinutes([...springs, ...wagonSprings].map((r) => r.created_at));
    const allSprings = [...springs, ...wagonSprings];

    const verdicts = this.db.prepare(`
      SELECT wagon_number, COALESCE(manual_verdict_at, updated_at) AS at FROM checklist_items
      WHERE status != 'PENDING' AND COALESCE(manual_verdict_at, updated_at) >= ? AND COALESCE(manual_verdict_at, updated_at) < ?
      ORDER BY wagon_number, at
    `).all(since, until) as any[];
    const byWagon = new Map<string, string[]>();
    for (const v of verdicts) { const arr = byWagon.get(v.wagon_number); if (arr) arr.push(v.at); else byWagon.set(v.wagon_number, [v.at]); }
    // A wagon with one verdict has no duration to speak of.
    const perWagon = [...byWagon.values()].filter((ts) => ts.length > 1).map((ts) => workedMinutes(ts));
    const checklistMinutes = perWagon.reduce((a, b) => a + b, 0);

    const nests = this.db.prepare(`
      SELECT COUNT(*) AS n FROM inspection_audit_log
      WHERE event_type = 'CHECKLIST_ITEM_UPDATED' AND created_at >= ? AND created_at < ?
        AND (payload_json LIKE '%HEIGHT_VARIATION_EXCEEDED%' OR payload_json LIKE '%BAND_MIXED%' OR payload_json LIKE '%NEW_OLD_MIXED%')
    `).get(since, until) as any;
    const overrides = this.db.prepare(`SELECT COUNT(*) AS n FROM inspections WHERE supervisor_override = 1 AND created_at >= ? AND created_at < ?`).get(since, until) as any;
    const withdrawn = this.db.prepare(`SELECT COUNT(*) AS n FROM spring_sorting_records WHERE supersedes IS NOT NULL AND created_at >= ? AND created_at < ?`).get(since, until) as any;
    const disc = this.db.prepare(`SELECT COUNT(*) AS n FROM shadow_discrepancies d WHERE occurred_on = ? AND NOT EXISTS (SELECT 1 FROM shadow_discrepancies l WHERE l.supersedes = d.id)`).get(date) as any;

    return {
      date,
      wagonsSwept: new Set(wagonSprings.map((r) => r.wagon_number)).size,
      springsRecorded: allSprings.length,
      springsCondemned: allSprings.filter((r) => r.status === 'CONDEMNED').length,
      nestsFlagged: Number(nests?.n || 0),
      discrepanciesLogged: Number(disc?.n || 0),
      amber: this.amberFigures(since, until),
      bench: {
        workedMinutes: Math.round(benchMinutes * 10) / 10,
        springsPerHour: ratePerHour(allSprings.length, benchMinutes, PLAUSIBLE_SPRINGS_PER_HOUR),
        inspectors: new Set(allSprings.map((r) => r.inspector_id)).size
      },
      checklists: {
        verdicts: verdicts.length,
        wagons: byWagon.size,
        workedMinutes: Math.round(checklistMinutes * 10) / 10,
        itemsPerHour: ratePerHour(verdicts.length, checklistMinutes, PLAUSIBLE_ITEMS_PER_HOUR),
        medianMinutesPerWagon: perWagon.length ? Math.round(([...perWagon].sort((a, b) => a - b)[Math.floor(perWagon.length / 2)]) * 10) / 10 : null
      },
      overrides: Number(overrides?.n || 0),
      withdrawn: Number(withdrawn?.n || 0)
    };
  }

  /** The week: each day the app's half, the log, the summaries, and the verdict. */
  report(days: number, today = new Date().toISOString().slice(0, 10)): {
    days: AppDay[]; discrepancies: any[]; summaries: any[]; verdict: ShadowVerdict; idleGapMinutes: number; anyImplausible: boolean;
  } {
    const dates: string[] = [];
    for (let i = days - 1; i >= 0; i--) dates.push(new Date(Date.parse(today) - i * 86400_000).toISOString().slice(0, 10));
    const dayReports = dates.map((d) => this.appDay(d));
    const sinceDate = dates[0];
    const discrepancies = this.listDiscrepancies(sinceDate);
    const summaries = this.listSummaries(sinceDate);
    const amber = this.amberFigures(`${sinceDate}T00:00:00.000Z`, new Date(Date.parse(`${today}T00:00:00.000Z`) + 86400_000).toISOString());
    const verdict = shadowVerdict(
      discrepancies.map((d): DiscrepancyRow => ({ occurredOn: d.occurredOn, registerVerdict: d.registerVerdict, appVerdict: d.appVerdict, whoWasRight: d.whoWasRight, cause: d.cause, wouldHaveStoppedAWagon: d.wouldHaveStoppedAWagon })),
      amber,
      summaries.map((s): DailySummaryRow => ({ summaryDate: s.summaryDate, transcriptionErrorsBoxMissed: s.transcriptionErrorsBoxMissed, registerMinutesOneWagon: s.registerMinutesOneWagon, appMinutesOneWagon: s.appMinutesOneWagon })),
      today
    );
    return {
      days: dayReports, discrepancies, summaries, verdict, idleGapMinutes: IDLE_GAP_MINUTES,
      anyImplausible: dayReports.some((d) => !d.bench.springsPerHour.plausible || !d.checklists.itemsPerHour.plausible)
    };
  }
}
