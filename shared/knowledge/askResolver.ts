/**
 * Ask the records — turning a sentence into a catalogue question, without a model
 * Indian Railways WRS Raipur
 *
 * The matcher: fold synonyms, score every catalogue entry by how many of its
 * keywords the sentence contains (all required) plus hints (each a little),
 * pull the parameters out of the sentence against their allowlists, and
 * return the best entry if it is clearly best. It is deliberately dull. Its
 * job is to make the common questions work with no model at all, on the shop
 * PC, offline — and to refuse cleanly when it cannot tell, so a model (if
 * one is configured) gets a turn, and so the person is offered the list.
 *
 * Whatever picks the question, the same validateParams() checks the result
 * against the same allowlists. A model that replies with a wagon type this
 * shop does not overhaul, or a position that does not exist, is refused the
 * way a typo would be.
 */

import { ASK_CATALOGUE, PERIODS, SPRING_POSITIONS, STAGES, BANDS, SYNONYMS, type AskQuestion, type ParamKind } from './askCatalogue.ts';
import { WAGON_SPRING_CONFIGS } from '../classification/wagonTypes.ts';

export interface Resolved {
  id: string;
  params: Record<string, string>;
  /** 0..1 — how clearly this entry beat the next. */
  confidence: number;
  matchedBy: 'MATCHER' | 'MODEL';
}

export interface ParamProblem { param: string; message: string }

export const WAGON_TYPES: readonly string[] = WAGON_SPRING_CONFIGS.map((c) => c.designation);

export function foldSynonyms(text: string): string {
  let t = ` ${text.toLowerCase()} `;
  for (const [re, to] of SYNONYMS) t = t.replace(re, ` ${to} `);
  return t.replace(/\s+/g, ' ');
}

/** The allowlist for a parameter kind, as the values a caller may use. */
export function allowed(kind: ParamKind): readonly string[] | null {
  switch (kind) {
    case 'wagonType': return WAGON_TYPES;
    case 'springPosition': return SPRING_POSITIONS;
    case 'stage': return STAGES;
    case 'band': return BANDS;
    case 'period': return Object.keys(PERIODS);
    default: return null; // free text, validated by shape
  }
}

const WAGON_NUMBER_RE = /\b([A-Z]{2,5}\/[A-Z0-9 -]{3,12}\/\d{4,6})\b/i;

/** Pull parameters out of the sentence, by allowlist. */
export function extractParams(folded: string, original: string, q: AskQuestion): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, spec] of Object.entries(q.params)) {
    let value: string | undefined;
    if (spec.kind === 'wagonType') {
      // Longest designation first, so "BOXN M1" is not read as "BOXN".
      const types = [...WAGON_TYPES].sort((a, b) => b.length - a.length);
      const up = original.toUpperCase();
      value = types.find((t) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(up));
    } else if (spec.kind === 'springPosition') {
      value = SPRING_POSITIONS.find((p) => folded.includes(` ${p} `) || folded.includes(` ${p.toLowerCase()} `));
    } else if (spec.kind === 'stage') {
      value = STAGES.find((s) => folded.includes(s.toLowerCase().replace(/_/g, ' ')));
    } else if (spec.kind === 'band') {
      value = BANDS.find((b) => folded.includes(` ${b.toLowerCase()} `));
    } else if (spec.kind === 'period') {
      const keys = Object.keys(PERIODS).sort((a, b) => b.length - a.length);
      value = keys.find((k) => folded.includes(` ${k} `));
      const days = /\b(\d{1,3})\s*(days?|दिन)\b/.exec(folded);
      if (!value && days) value = `${days[1]} days`;
    } else if (spec.kind === 'wagonNumber') {
      const m = WAGON_NUMBER_RE.exec(original);
      value = m ? m[1].toUpperCase() : undefined;
    }
    if (value !== undefined) out[name] = value;
    else if (spec.default !== undefined) out[name] = spec.default;
  }
  return out;
}

/** Days for a period value — a catalogue word, or "N days". */
export function periodDays(value: string): number | null {
  if (value in PERIODS) return PERIODS[value];
  const m = /^(\d{1,3}) days$/.exec(value);
  return m ? Number(m[1]) : null;
}

export function validateParams(q: AskQuestion, params: Record<string, unknown>): { ok: true; params: Record<string, string> } | { ok: false; problems: ParamProblem[] } {
  const problems: ParamProblem[] = [];
  const clean: Record<string, string> = {};
  for (const [name, spec] of Object.entries(q.params)) {
    const raw = params[name];
    if (raw === undefined || raw === null || raw === '') {
      if (spec.required) problems.push({ param: name, message: `${name} is required for this question.` });
      else if (spec.default !== undefined) clean[name] = spec.default;
      continue;
    }
    const v = String(raw).trim();
    if (spec.kind === 'period') {
      if (periodDays(v) === null) { problems.push({ param: name, message: `${name} must be one of ${Object.keys(PERIODS).join(', ')}, or "N days".` }); continue; }
      clean[name] = v;
    } else if (spec.kind === 'wagonNumber') {
      if (!WAGON_NUMBER_RE.test(v)) { problems.push({ param: name, message: `${name} must look like SECR/BOXNHL/12345.` }); continue; }
      clean[name] = v.toUpperCase();
    } else if (spec.kind === 'partName') {
      if (v.length > 120) { problems.push({ param: name, message: `${name} is too long.` }); continue; }
      clean[name] = v;
    } else {
      const list = allowed(spec.kind)!;
      const hit = list.find((x) => x.toUpperCase() === v.toUpperCase());
      if (!hit) { problems.push({ param: name, message: `${name} must be one of ${list.join(', ')}.` }); continue; }
      clean[name] = hit;
    }
  }
  // Anything the caller sent that the question does not take is refused, not ignored.
  for (const k of Object.keys(params)) if (!(k in q.params)) problems.push({ param: k, message: `${k} is not a parameter of ${q.id}.` });
  return problems.length ? { ok: false, problems } : { ok: true, params: clean };
}

/** The plain matcher. Null when nothing is clearly meant. */
export function matchQuestion(sentence: string): Resolved | null {
  const folded = foldSynonyms(sentence);
  const scored = ASK_CATALOGUE.map((q) => {
    const required = q.keywords.every((k) => folded.includes(` ${k}`) || folded.includes(k));
    if (!required) return { q, score: 0 };
    let score = q.keywords.length * 2;
    for (const h of q.hints || []) if (folded.includes(h)) score += 1;
    return { q, score };
  }).filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
  if (scored.length === 0) return null;
  const best = scored[0];
  const next = scored[1]?.score ?? 0;
  // A tie is not a match. "wagon" alone is in several questions; the hints decide.
  if (next === best.score) return null;
  const params = extractParams(folded, sentence, best.q);
  const v = validateParams(best.q, params);
  if (!v.ok) return null;
  return { id: best.q.id, params: v.params, confidence: Math.min(1, (best.score - next) / best.score), matchedBy: 'MATCHER' };
}
