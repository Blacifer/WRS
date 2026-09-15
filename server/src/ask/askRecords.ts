/**
 * Ask the records — the answers, computed, with what they were computed from
 * Indian Railways WRS Raipur
 *
 * Every question in shared/knowledge/askCatalogue.ts has one function here.
 * Each returns figures — a label, a value, and the count it rests on — and
 * the rows they came from, or the query that produced them. A reader who
 * doubts a figure can go to the rows. Nothing here is phrased by a model;
 * the sentence at the top is a template over the same numbers.
 *
 * Where the shop already computes something (recurring findings, blocked
 * wagons, stage dwell, the forecast, inspector quality, gauge drift), the
 * question calls that code rather than a second copy of it, so an answer
 * here and a panel on the dashboard cannot disagree.
 */

import type { DatabaseSync } from 'node:sqlite';
import { ASK_CATALOGUE, type AskQuestion } from '../../../shared/knowledge/askCatalogue.ts';
import { matchQuestion, validateParams, periodDays, WAGON_TYPES, type Resolved } from '../../../shared/knowledge/askResolver.ts';
import { getAnalyticsFindings, getAnalyticsDwell, getAnalyticsInspectorQuality, getObservedCondemnationRates } from '../db/wagonAnalytics.ts';
import { forecastConsumption } from '../../../shared/knowledge/consumptionForecast.ts';
import { gaugeDrift } from '../../../shared/analysis/gaugeDrift.ts';
import { collectEvents } from '../reports/wagonPassport.ts';
import { WagonRepository } from '../db/wagonRepository.ts';
import { askZapheit, isZapheitConfigured } from '../ai/zapheit.ts';
import { config } from '../config/index.ts';

export interface Figure {
  label: string;
  value: number | string;
  /** How many observations the value rests on, when it is a rate or a central figure. */
  n?: number;
}

export interface Citation {
  /** Which table, or which computation. */
  source: string;
  /** Row ids, when the answer is a set of rows small enough to name. */
  ids?: string[];
  /** The fixed query, with its bound parameters shown, so the arithmetic can be repeated. */
  query?: string;
  params?: Record<string, unknown>;
}

export interface Answer {
  question: string;
  id: string;
  describe: string;
  params: Record<string, string>;
  matchedBy: 'MATCHER' | 'MODEL';
  confidence: number;
  sentence: string;
  figures: Figure[];
  rows: Array<Record<string, unknown>>;
  columns: string[];
  citations: Citation[];
  caveats: string[];
}

export interface NoAnswer {
  question: string;
  answered: false;
  reason: string;
  /** The catalogue, so the person can pick. */
  catalogue: Array<{ id: string; describe: string; params: string[] }>;
}

const since = (period: string) => new Date(Date.now() - (periodDays(period) ?? 30) * 86400_000).toISOString();
/** "this quarter" reads as itself; "quarter" and "30 days" read as "the last …". */
const over = (period: string) => (/^(this |last |today|yesterday|all time|ever)/.test(period) ? period : `the last ${period}`);
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

type Runner = (db: DatabaseSync, p: Record<string, string>) => Omit<Answer, 'question' | 'id' | 'describe' | 'params' | 'matchedBy' | 'confidence'>;

const RUNNERS: Record<string, Runner> = {
  condemnation_by_wagon_type(db, p) {
    const sql = `SELECT w.wagon_type AS wagonType, COUNT(*) AS measured, SUM(CASE WHEN i.status = 'CONDEMNED' THEN 1 ELSE 0 END) AS condemned
                 FROM inspections i JOIN wagons w ON w.wagon_number = i.wagon_number
                 WHERE i.created_at >= ? ${p.springPosition ? 'AND i.spring_position = ?' : ''}
                 GROUP BY w.wagon_type ORDER BY condemned DESC, measured DESC`;
    const args = p.springPosition ? [since(p.period), p.springPosition] : [since(p.period)];
    const rows = db.prepare(sql).all(...args) as any[];
    const top = rows[0];
    return {
      sentence: rows.length === 0
        ? `No springs of ${p.springPosition ? p.springPosition.toLowerCase() + ' position' : 'any position'} were measured on a known wagon ${over(p.period)}.`
        : `${top.wagonType} condemned the most ${p.springPosition ? p.springPosition.toLowerCase() + ' ' : ''}springs ${over(p.period)}: ${top.condemned} of ${top.measured} measured (${pct(top.condemned, top.measured)}%). Per-wagon inspections only — the sorting bench does not know the wagon a loose spring came from.`,
      figures: rows.map((r) => ({ label: r.wagonType, value: `${r.condemned} of ${r.measured}`, n: r.measured })),
      rows, columns: ['wagonType', 'measured', 'condemned'],
      citations: [{ source: 'inspections ⋈ wagons', query: sql, params: { since: args[0], springPosition: p.springPosition ?? null } }],
      caveats: ['Per-wagon spring inspections only. The sorting bench records loose springs of no known wagon and is not counted here.']
    };
  },

  springs_sorted_per_day(db, p) {
    const sql = `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS sorted, SUM(CASE WHEN status = 'CONDEMNED' THEN 1 ELSE 0 END) AS condemned
                 FROM spring_sorting_records r WHERE created_at >= ? AND voided = 0
                   AND NOT EXISTS (SELECT 1 FROM spring_sorting_records l WHERE l.supersedes = r.id)
                 GROUP BY day ORDER BY day ASC`;
    const rows = db.prepare(sql).all(since(p.period)) as any[];
    const total = rows.reduce((a, r) => a + r.sorted, 0);
    const cond = rows.reduce((a, r) => a + r.condemned, 0);
    return {
      sentence: `${total} springs sorted on ${rows.length} day(s) ${over(p.period)}; ${cond} condemned (${pct(cond, total) ?? 0}%).`,
      figures: [{ label: 'sorted', value: total }, { label: 'condemned', value: cond, n: total }, { label: 'days with sorting', value: rows.length }],
      rows, columns: ['day', 'sorted', 'condemned'],
      citations: [{ source: 'spring_sorting_records', query: sql, params: { since: since(p.period) } }],
      caveats: ['Undone and corrected taps are excluded.']
    };
  },

  band_distribution(db, p) {
    const sql = `SELECT COALESCE(classified_band, 'CONDEMNED') AS band, COUNT(*) AS n
                 FROM spring_sorting_records r WHERE created_at >= ? AND voided = 0 ${p.springPosition ? 'AND spring_position = ?' : ''}
                   AND NOT EXISTS (SELECT 1 FROM spring_sorting_records l WHERE l.supersedes = r.id)
                 GROUP BY band ORDER BY n DESC`;
    const args = p.springPosition ? [since(p.period), p.springPosition] : [since(p.period)];
    const rows = db.prepare(sql).all(...args) as any[];
    const total = rows.reduce((a, r) => a + r.n, 0);
    return {
      sentence: total === 0 ? `No ${p.springPosition ? p.springPosition.toLowerCase() + ' ' : ''}springs sorted ${over(p.period)}.`
        : `${total} ${p.springPosition ? p.springPosition.toLowerCase() + ' ' : ''}springs ${over(p.period)}: ` + rows.map((r) => `${r.band} ${r.n} (${pct(r.n, total)}%)`).join(', ') + '.',
      figures: rows.map((r) => ({ label: r.band, value: r.n, n: total })),
      rows, columns: ['band', 'n'],
      citations: [{ source: 'spring_sorting_records', query: sql, params: { since: args[0], springPosition: p.springPosition ?? null } }],
      caveats: []
    };
  },

  part_fails_most(db) {
    const f = getAnalyticsFindings(db, 15);
    const rows = (f.findings || []).map((x: any) => ({ partName: x.partName, category: x.category, wagonsAffected: x.wagonsAffected, ofWagons: f.totalWagons, condemned: x.condemned, failed: x.failed, repaired: x.repaired, replaced: x.replaced }));
    const top = rows[0];
    return {
      sentence: top ? `${top.partName} comes back most: on ${top.wagonsAffected} of ${top.ofWagons} wagons on record (condemned ${top.condemned}, failed ${top.failed}, replaced ${top.replaced}). Counted by wagon, not by row.`
        : 'No part has been recorded as failed, condemned, repaired or replaced — a statement about the records, not the wagons.',
      figures: rows.slice(0, 5).map((r: any) => ({ label: r.partName, value: `${r.wagonsAffected} of ${r.ofWagons} wagons`, n: r.ofWagons })),
      rows, columns: ['partName', 'category', 'wagonsAffected', 'ofWagons', 'condemned', 'failed', 'repaired', 'replaced'],
      citations: [{ source: 'checklist_items (getAnalyticsFindings — the same computation as the dashboard\'s "What keeps coming back")' }],
      caveats: []
    };
  },

  wagons_blocked(db) {
    const b = new WagonRepository(db).getAnalyticsBlockers();
    const rows = (b.blockedWagons || []).map((w: any) => ({ wagonNumber: w.wagonNumber, wagonType: w.wagonType, stage: w.currentStage, blockers: (w.blockers || []).join('; ') }));
    return {
      sentence: rows.length === 0 ? 'No wagon is being held by the exit gate right now.' : `${rows.length} wagon(s) held by the exit gate: ` + rows.map((r: any) => `${r.wagonNumber} (${r.blockers})`).join('; ') + '.',
      figures: [{ label: 'wagons held', value: rows.length }],
      rows, columns: ['wagonNumber', 'wagonType', 'stage', 'blockers'],
      citations: [{ source: 'the exit gate, evaluated per wagon now (getAnalyticsBlockers)', ids: rows.map((r: any) => r.wagonNumber) }],
      caveats: []
    };
  },

  stage_dwell(db, p) {
    const d = getAnalyticsDwell(db);
    const rows = d.byStage.map((s) => ({ stage: s.stage, n: s.n, medianHours: s.medianHours, p90Hours: s.p90Hours, inStageNow: s.inStageNow }));
    return {
      sentence: d.bottleneck ? `${d.bottleneck.stage} holds a wagon longest: median ${d.bottleneck.medianHours} h from ${d.bottleneck.n} completed wagons.${p.wagonType ? ` (Per-type medians are used for projections of ${p.wagonType} wagons; the table is shop-wide.)` : ''}`
        : 'No stage has five completed wagons yet, so no median is quoted.',
      figures: rows.filter((r) => r.medianHours !== null).map((r) => ({ label: r.stage, value: `${r.medianHours} h`, n: r.n })),
      rows, columns: ['stage', 'n', 'medianHours', 'p90Hours', 'inStageNow'],
      citations: [{ source: 'wagon_transitions (getAnalyticsDwell — the dashboard\'s "Where wagons wait")' }],
      caveats: ['A median is quoted only from five completed intervals.']
    };
  },

  wagons_released(db, p) {
    const sql = `SELECT wagon_number AS wagonNumber, wagon_type AS wagonType, entry_date AS entryDate, actual_release_date AS releasedAt,
                        ROUND((julianday(actual_release_date) - julianday(entry_date)) * 24, 1) AS hours
                 FROM wagons WHERE actual_release_date >= ? ${p.wagonType ? 'AND wagon_type = ?' : ''} ORDER BY actual_release_date DESC`;
    const args = p.wagonType ? [since(p.period), p.wagonType] : [since(p.period)];
    const rows = db.prepare(sql).all(...args) as any[];
    const hrs = rows.map((r) => Number(r.hours)).filter(Number.isFinite).sort((a, b) => a - b);
    return {
      sentence: `${rows.length} ${p.wagonType ? p.wagonType + ' ' : ''}wagon(s) released ${over(p.period)}${hrs.length ? `; median turnaround ${hrs[Math.floor(hrs.length / 2)]} h` : ''}.`,
      figures: [{ label: 'released', value: rows.length }, ...(hrs.length ? [{ label: 'median turnaround (h)', value: hrs[Math.floor(hrs.length / 2)], n: hrs.length }] : [])],
      rows, columns: ['wagonNumber', 'wagonType', 'entryDate', 'releasedAt', 'hours'],
      citations: [{ source: 'wagons', query: sql, params: { since: args[0], wagonType: p.wagonType ?? null }, ids: rows.map((r) => r.wagonNumber) }],
      caveats: []
    };
  },

  wagons_in_shop(db) {
    const sql = `SELECT current_stage AS stage, wagon_type AS wagonType, COUNT(*) AS n FROM wagons WHERE current_stage <> 'RELEASE' GROUP BY current_stage, wagon_type ORDER BY n DESC`;
    const rows = db.prepare(sql).all() as any[];
    const total = rows.reduce((a, r) => a + r.n, 0);
    const byStage = new Map<string, number>();
    for (const r of rows) byStage.set(r.stage, (byStage.get(r.stage) || 0) + r.n);
    return {
      sentence: `${total} wagon(s) in the shop now: ` + [...byStage.entries()].map(([s, n]) => `${n} at ${s}`).join(', ') + '.',
      figures: [...byStage.entries()].map(([s, n]) => ({ label: s, value: n })),
      rows, columns: ['stage', 'wagonType', 'n'],
      citations: [{ source: 'wagons', query: sql }],
      caveats: []
    };
  },

  wagon_history(db, p) {
    const events = collectEvents(db, p.wagonNumber);
    const rows = events.map((e) => ({ at: e.at, kind: e.kind, detail: JSON.stringify(e.payload).slice(0, 160) }));
    const kinds = new Map<string, number>();
    for (const e of events) kinds.set(e.kind, (kinds.get(e.kind) || 0) + 1);
    return {
      sentence: `${p.wagonNumber}: ${events.length} recorded events — ` + [...kinds.entries()].map(([k, n]) => `${n} ${k.toLowerCase().replace(/_/g, ' ')}`).join(', ') + '.',
      figures: [...kinds.entries()].map(([k, n]) => ({ label: k, value: n })),
      rows, columns: ['at', 'kind', 'detail'],
      citations: [{ source: 'every table that holds this wagon (the same collection the passport is built from)' }],
      caveats: []
    };
  },

  parts_replaced_on_wagon(db, p) {
    const sql = `SELECT created_at AS at, event, part_name AS partName, bogie_position AS bogiePosition, quantity, reason, component_serial AS componentSerial, inspector_name AS recordedBy
                 FROM wagon_part_ledger WHERE wagon_number = ? AND event IN ('REPLACED', 'SCRAPPED', 'REFITTED', 'NOT_FITTED') ORDER BY created_at ASC`;
    const rows = db.prepare(sql).all(p.wagonNumber.toUpperCase()) as any[];
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.event, (counts.get(r.event) || 0) + Number(r.quantity || 1));
    return {
      sentence: rows.length === 0 ? `Nothing recorded as replaced, scrapped, refitted or deliberately not fitted on ${p.wagonNumber}. Silence is not balance — check the parts ledger.`
        : `${p.wagonNumber}: ` + [...counts.entries()].map(([e, n]) => `${n} ${e.toLowerCase().replace(/_/g, ' ')}`).join(', ') + '.',
      figures: [...counts.entries()].map(([e, n]) => ({ label: e, value: n })),
      rows, columns: ['at', 'event', 'partName', 'bogiePosition', 'quantity', 'reason', 'componentSerial', 'recordedBy'],
      citations: [{ source: 'wagon_part_ledger', query: sql, params: { wagonNumber: p.wagonNumber.toUpperCase() } }],
      caveats: []
    };
  },

  inspector_condemnation(db, p) {
    const q = getAnalyticsInspectorQuality(db, since(p.period));
    const rows = q.inspectors.map((i: any) => ({ inspector: i.inspectorName, inspected: i.springs.inspected, condemned: i.springs.condemned, ratePct: i.condemnationRatePct }));
    return {
      sentence: `Shop condemnation rate ${q.shop.condemnationRatePct ?? '—'}% (${q.shop.springs.condemned} of ${q.shop.springs.inspected}) ${over(p.period)}. ` +
        rows.filter((r: any) => r.ratePct !== null).map((r: any) => `${r.inspector} ${r.ratePct}% (${r.condemned}/${r.inspected})`).join('; ') +
        (rows.some((r: any) => r.ratePct === null) ? '. Rates are not quoted below 30 springs.' : '.'),
      figures: rows.map((r: any) => ({ label: r.inspector, value: r.ratePct === null ? `${r.condemned}/${r.inspected}` : `${r.ratePct}%`, n: r.inspected })),
      rows, columns: ['inspector', 'inspected', 'condemned', 'ratePct'],
      citations: [{ source: 'inspections + spring_sorting_records (getAnalyticsInspectorQuality)' }],
      caveats: ['A view of the records, not a verdict on a person: someone on the condemnation bench all week condemns more.']
    };
  },

  overrides(db, p) {
    const sql = `SELECT created_at AS at, wagon_number AS wagonNumber, from_stage AS fromStage, to_stage AS toStage, transition_type AS type, performer_name AS by, override_reason AS reason
                 FROM wagon_transitions WHERE is_override = 1 AND created_at >= ? ORDER BY created_at DESC`;
    const rows = db.prepare(sql).all(since(p.period)) as any[];
    const by = new Map<string, number>();
    for (const r of rows) by.set(r.by, (by.get(r.by) || 0) + 1);
    return {
      sentence: rows.length === 0 ? `No supervisor override recorded ${over(p.period)}.` : `${rows.length} override(s) ${over(p.period)}: ` + [...by.entries()].map(([n, c]) => `${n} ${c}`).join(', ') + '.',
      figures: [...by.entries()].map(([n, c]) => ({ label: n, value: c })),
      rows, columns: ['at', 'wagonNumber', 'fromStage', 'toStage', 'type', 'by', 'reason'],
      citations: [{ source: 'wagon_transitions', query: sql, params: { since: since(p.period) } }],
      caveats: []
    };
  },

  forecast_replacements(db, p) {
    const days = periodDays(p.period) ?? 14;
    const f = forecastConsumption(days, getObservedCondemnationRates(db));
    const rows = f.lines.map((l) => ({ spring: `${l.bogieType} ${l.springPosition}`, handled: l.springsHandled, ratePct: l.condemnationRatePct, order: l.expectedReplacements, basis: l.basis, fromBench: l.basisFromBench }));
    return {
      sentence: f.summary + (f.notForecast.length ? ` Not forecast: ${f.notForecast.map((n) => `${n.bogieType} ${n.springPosition} (${n.reason})`).join('; ')}.` : ''),
      figures: rows.map((r) => ({ label: r.spring, value: r.order, n: r.basis })),
      rows, columns: ['spring', 'handled', 'ratePct', 'order', 'basis', 'fromBench'],
      citations: [{ source: 'out-turn return × RDSO spring counts × observed condemnation rate (forecastConsumption)' }],
      caveats: ['The rate is the only learned input; the wagon mix and the spring counts are fixed.']
    };
  },

  wagons_of_type_received(db, p) {
    const sql = `SELECT wagon_type AS wagonType, COUNT(*) AS received, SUM(CASE WHEN current_stage = 'RELEASE' THEN 1 ELSE 0 END) AS released
                 FROM wagons WHERE entry_date >= ? ${p.wagonType ? 'AND wagon_type = ?' : ''} GROUP BY wagon_type ORDER BY received DESC`;
    const args = p.wagonType ? [since(p.period), p.wagonType] : [since(p.period)];
    const rows = db.prepare(sql).all(...args) as any[];
    const total = rows.reduce((a, r) => a + r.received, 0);
    const rel = rows.reduce((a, r) => a + r.released, 0);
    return {
      sentence: `${total} ${p.wagonType ? p.wagonType + ' ' : ''}wagon(s) came in over ${over(p.period)}; ${rel} of them have been released.`,
      figures: rows.map((r) => ({ label: r.wagonType, value: `${r.released} of ${r.received} released`, n: r.received })),
      rows, columns: ['wagonType', 'received', 'released'],
      citations: [{ source: 'wagons', query: sql, params: { since: args[0], wagonType: p.wagonType ?? null } }],
      caveats: []
    };
  },

  gauge_drift(db, p) {
    const rows0 = db.prepare(`
      SELECT gauge_code AS gaugeCode, bogie_type || '|' || spring_condition || '|' || spring_position AS kind, measured_height AS heightMm
      FROM spring_sorting_records r WHERE gauge_code IS NOT NULL AND measured_height IS NOT NULL AND height_is_approximate = 0 AND voided = 0 AND created_at >= ?
        AND NOT EXISTS (SELECT 1 FROM spring_sorting_records l WHERE l.supersedes = r.id)`).all(since(p.period)) as any[];
    const lines = gaugeDrift(rows0);
    const rows = lines.map((l) => ({ gauge: l.gaugeCode, kind: l.kind, n: l.n, medianMm: l.medianMm, othersMedianMm: l.othersMedianMm, shiftMm: l.shiftMm, flagged: l.flagged ? 'yes' : '' }));
    const flagged = lines.filter((l) => l.flagged);
    return {
      sentence: flagged.length ? flagged.map((l) => `${l.gaugeCode}: ${l.note}`).join(' ') : lines.some((l) => l.shiftMm !== null) ? 'No gauge reads more than a millimetre from the others on the same kind of spring.' : 'Not enough readings on more than one gauge per kind to compare yet.',
      figures: lines.filter((l) => l.shiftMm !== null).map((l) => ({ label: `${l.gaugeCode} on ${l.kind}`, value: `${l.shiftMm! >= 0 ? '+' : ''}${l.shiftMm} mm`, n: l.n })),
      rows, columns: ['gauge', 'kind', 'n', 'medianMm', 'othersMedianMm', 'shiftMm', 'flagged'],
      citations: [{ source: 'spring_sorting_records (gaugeDrift — the same computation as the gauge register)' }],
      caveats: ['Median against median, thirty readings each side, flagged at one millimetre.']
    };
  }
};

export function catalogueForPeople(lang: 'en' | 'hi' = 'en') {
  return ASK_CATALOGUE.map((q) => ({ id: q.id, describe: q.describe[lang], params: Object.keys(q.params) }));
}

/**
 * The model's turn, only when the matcher could not tell. It sees the
 * sentence and the catalogue — never a record — and replies with an id and
 * parameters, which are then checked exactly as a typed request would be.
 * A local model (ZAPHEIT_BASE_URL on localhost) keeps even the sentence on
 * the machine.
 */
export async function resolveWithModel(sentence: string): Promise<Resolved | null> {
  if (!isZapheitConfigured()) return null;
  const menu = ASK_CATALOGUE.map((q) => `${q.id}: ${q.describe.en} params: ${Object.entries(q.params).map(([k, v]) => `${k}(${v.kind}${v.required ? ', required' : ''})`).join(', ') || 'none'}`).join('\n');
  const text = await askZapheit(
    'You map a railway workshop question to ONE entry of a fixed catalogue. Reply with JSON only: {"id": "<catalogue id>", "params": {...}} or {"id": null} if none fits. ' +
    'Parameter values: wagonType is a designation such as BOXNHL; springPosition is OUTER, INNER or SNUBBER; period is one of today, week, month, quarter, year, fortnight, or "N days"; wagonNumber looks like SECR/BOXNHL/12345. Never invent a value not present in the question.\n\nCatalogue:\n' + menu,
    sentence, { maxTokens: 120 }
  );
  if (!text) return null;
  let parsed: any;
  try { parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { return null; }
  const q = ASK_CATALOGUE.find((x) => x.id === parsed?.id);
  if (!q) return null;
  const v = validateParams(q, parsed.params && typeof parsed.params === 'object' ? parsed.params : {});
  if (!v.ok) return null;
  return { id: q.id, params: v.params, confidence: 0.5, matchedBy: 'MODEL' };
}

export function runQuestion(db: DatabaseSync, resolved: Resolved, question: string, lang: 'en' | 'hi' = 'en'): Answer {
  const q = ASK_CATALOGUE.find((x) => x.id === resolved.id) as AskQuestion;
  const runner = RUNNERS[q.id];
  const out = runner(db, resolved.params);
  return { question, id: q.id, describe: q.describe[lang], params: resolved.params, matchedBy: resolved.matchedBy, confidence: resolved.confidence, ...out };
}

export async function ask(db: DatabaseSync, question: string, lang: 'en' | 'hi' = 'en', explicit?: { id: string; params: Record<string, unknown> }): Promise<Answer | NoAnswer> {
  let resolved: Resolved | null = null;
  if (explicit) {
    const q = ASK_CATALOGUE.find((x) => x.id === explicit.id);
    if (!q) return { question, answered: false, reason: `No catalogue question "${explicit.id}".`, catalogue: catalogueForPeople(lang) };
    const v = validateParams(q, explicit.params || {});
    if (!v.ok) return { question, answered: false, reason: v.problems.map((p) => p.message).join(' '), catalogue: catalogueForPeople(lang) };
    resolved = { id: q.id, params: v.params, confidence: 1, matchedBy: 'MATCHER' };
  } else {
    resolved = matchQuestion(question) ?? (await resolveWithModel(question));
  }
  if (!resolved) {
    return {
      question, answered: false,
      reason: isZapheitConfigured()
        ? 'Neither the matcher nor the model could tell which question this is. Pick one from the list, or rephrase with the words it uses.'
        : 'The matcher could not tell which question this is, and no model is configured to try. Pick one from the list, or rephrase with the words it uses.',
      catalogue: catalogueForPeople(lang)
    };
  }
  return runQuestion(db, resolved, question, lang);
}

/** Whether a configured model runs on this machine — the posture a supervisor should know. */
export function modelPosture(): { configured: boolean; local: boolean; baseUrl: string | null } {
  if (!isZapheitConfigured()) return { configured: false, local: false, baseUrl: null };
  const url = config.zapheitBaseUrl;
  const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(url);
  return { configured: true, local, baseUrl: url };
}

export { WAGON_TYPES };
