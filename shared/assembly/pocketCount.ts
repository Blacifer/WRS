/**
 * Pocket occupancy — counting what a photograph of an open bogie shows
 * Indian Railways WRS Raipur
 *
 * docs/ASSEMBLY_COMPLETENESS.md scoped the one thing a photograph can
 * honestly settle in this domain: whether every spring pocket was occupied
 * when the bogie was closed up. Counting, not classifying — no datum plane,
 * no scale, nothing a lens can distort. This module is the arithmetic of
 * that count and the rules around it, and it is deliberately the same
 * whether the count came from a person tapping each spring on a tablet or,
 * one day, from a model: the count is a set of marks on the photograph, the
 * expected number comes from WAGON_SPRING_CONFIGS, and the comparison is
 * done here, in plain code, every time.
 *
 * Three rules, from the scope, that this file exists to hold:
 *
 *   1. The expected count never comes from the counter. It is a property of
 *      the wagon designation and is derived from the registry at comparison
 *      time — never stored on the photograph, never typed by the person,
 *      never reported by a model.
 *   2. A count that matches produces nothing. No tick, no "verified": a
 *      count is a person's (or a model's) reading of a photograph, not
 *      evidence that the pockets were full. A count that falls SHORT raises
 *      an advisory the supervisor acknowledges by name at sign-off. A count
 *      that runs OVER is a different question — the wagon type on record or
 *      the count is wrong — and says so.
 *   3. The counts are the labelled dataset. Every count is a label on a
 *      photograph; a second person's blind recount is the inter-rater
 *      agreement figure; and no model is proposed until the shop has both
 *      enough covered bogies and enough agreement to measure it against.
 *      Today's model is NONE, and this file says so in code.
 */

import { getWagonSpringConfig, type WagonSpringConfig } from '../classification/wagonTypes.ts';
import type { BogiePosition, BogieSide } from './assemblyCapture.ts';

export type PocketKind = 'OUTER' | 'INNER' | 'SNUBBER';
export const POCKET_KINDS: readonly PocketKind[] = ['OUTER', 'INNER', 'SNUBBER'] as const;

/** One mark on the photograph: where, in unit coordinates, and what kind of spring was seen. */
export interface PocketTap {
  /** 0..1 across the image. */
  x: number;
  /** 0..1 down the image. */
  y: number;
  kind: PocketKind;
}

export interface PocketCounts { outer: number; inner: number; snubber: number; total: number }

export type CountKind = 'FIRST' | 'BLIND_RECOUNT';

/**
 * Springs one side-frame nest of this wagon's bogie holds.
 *
 * A CASNUB bogie carries its springs in two nests, one over each side frame,
 * and the capture protocol photographs each side from its marked floor
 * position, so one frame is one nest. Every designation in the registry
 * carries an even count in every kind; if one is ever added that does not,
 * this refuses rather than halving it — a nest with "seven and a half"
 * expected springs is a registry fault, not a rounding decision.
 */
export function expectedPerSide(config: WagonSpringConfig): PocketCounts {
  const half = (n: number, kind: string): number => {
    if (n % 2 !== 0) {
      throw new Error(`${config.designation} has an odd ${kind} count (${n}) per bogie; it cannot be split across two nests.`);
    }
    return n / 2;
  };
  const outer = half(config.counts.outer, 'outer');
  const inner = half(config.counts.inner, 'inner');
  const snubber = half(config.counts.snubber, 'snubber');
  return { outer, inner, snubber, total: outer + inner + snubber };
}

/** Tally the taps by kind. Anything that is not a well-formed tap is not counted. */
export function tallyTaps(taps: PocketTap[]): PocketCounts {
  const c = { outer: 0, inner: 0, snubber: 0 };
  for (const t of taps) {
    if (t.kind === 'OUTER') c.outer++;
    else if (t.kind === 'INNER') c.inner++;
    else if (t.kind === 'SNUBBER') c.snubber++;
  }
  return { ...c, total: c.outer + c.inner + c.snubber };
}

/** A tap is a point on the image with a known kind. Refuse anything else before it is stored. */
export function validateTaps(input: unknown): { ok: true; taps: PocketTap[] } | { ok: false; reason: string } {
  if (!Array.isArray(input)) return { ok: false, reason: 'taps must be an array of {x, y, kind}.' };
  if (input.length > 200) return { ok: false, reason: 'More than 200 taps on one frame is not a count of springs.' };
  const taps: PocketTap[] = [];
  for (const t of input) {
    const x = Number(t?.x), y = Number(t?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
      return { ok: false, reason: 'Each tap needs x and y between 0 and 1.' };
    }
    if (!POCKET_KINDS.includes(t?.kind)) return { ok: false, reason: `Each tap needs a kind: ${POCKET_KINDS.join(', ')}.` };
    taps.push({ x, y, kind: t.kind });
  }
  return { ok: true, taps };
}

export type PocketVerdict = 'MATCH' | 'SHORT' | 'OVER';

export interface PocketComparison {
  verdict: PocketVerdict;
  expected: PocketCounts;
  counted: PocketCounts;
  byKind: Array<{ kind: PocketKind; expected: number; counted: number; diff: number }>;
  /** Kinds the count fell short in. Empty on MATCH and on a pure OVER. */
  short: PocketKind[];
  /** Kinds the count ran over in. */
  over: PocketKind[];
  message: string;
}

const label = (k: PocketKind) => k.toLowerCase();

/**
 * Compare a count to the registry's expectation for this side.
 *
 * SHORT wins over OVER when both occur on one frame (three outers missing
 * and one extra inner is a short nest, whatever the extra is), because the
 * failure directions are not symmetric: a short count is the one that must
 * reach the sign-off screen.
 */
export function comparePocketCount(expected: PocketCounts, counted: PocketCounts, where: { bogie: BogiePosition; side: BogieSide }): PocketComparison {
  const byKind = POCKET_KINDS.map((kind) => {
    const e = expected[label(kind) as 'outer' | 'inner' | 'snubber'];
    const c = counted[label(kind) as 'outer' | 'inner' | 'snubber'];
    return { kind, expected: e, counted: c, diff: c - e };
  });
  const short = byKind.filter((k) => k.diff < 0).map((k) => k.kind);
  const over = byKind.filter((k) => k.diff > 0).map((k) => k.kind);
  const at = `${where.bogie.replace('_', ' ')} ${where.side.replace('_', ' ')}`;
  if (short.length > 0) {
    const parts = byKind.filter((k) => k.diff < 0).map((k) => `${k.counted} of ${k.expected} ${label(k.kind)}`);
    return {
      verdict: 'SHORT', expected, counted, byKind, short, over,
      message: `${at}: ${parts.join(', ')} counted on the photograph. A pocket may be empty — look at the frame before this wagon is signed off.`
    };
  }
  if (over.length > 0) {
    const parts = byKind.filter((k) => k.diff > 0).map((k) => `${k.counted} where ${k.expected} ${label(k.kind)} are expected`);
    return {
      verdict: 'OVER', expected, counted, byKind, short, over,
      message: `${at}: ${parts.join(', ')}. More springs were counted than this wagon type carries — check the count, and check the wagon type on record.`
    };
  }
  return { verdict: 'MATCH', expected, counted, byKind, short, over, message: '' };
}

/** Convenience: expected for a designation, or null when the registry does not hold it. */
export function expectedPerSideFor(designation: string): PocketCounts | null {
  const config = getWagonSpringConfig(designation);
  return config ? expectedPerSide(config) : null;
}

/** Two counts of the same frame agree when every kind agrees. Positions of the taps are not compared. */
export function countsAgree(a: PocketCounts, b: PocketCounts): boolean {
  return a.outer === b.outer && a.inner === b.inner && a.snubber === b.snubber;
}

/**
 * Where the labelled dataset stands, and whether a model may be attempted.
 *
 * The gate is two figures, both required: enough bogies with both sides
 * counted, and enough blind recounts agreeing. Agreement is what a model
 * would be measured against — if two people looking at the same frame
 * disagree one time in five, a model that "agrees 90% of the time" has
 * been measured against noise. The thresholds are round and are not
 * pretending to be derived; they are stated in whole bogies and whole
 * recounts so that counting one side twice as fast cannot move them.
 */
export const POCKET_MODEL_GATE = { minCoveredBogies: 300, minRecounts: 30, minAgreementPct: 95 } as const;

/** The model this shop runs for pocket occupancy today. */
export const POCKET_MODEL = 'NONE' as const;

export interface PocketDatasetReadiness {
  labelledPhotos: number;
  /** Bogies with a FIRST count on both sides. */
  coveredBogies: number;
  recounts: number;
  agreeing: number;
  agreementPct: number | null;
  /** Frames where the first count and the blind recount differ — the ones to look at. */
  disagreements: number;
  model: typeof POCKET_MODEL;
  gate: { allowed: boolean; why: string; thresholds: typeof POCKET_MODEL_GATE };
}

export function pocketDatasetReadiness(input: { labelledPhotos: number; coveredBogies: number; recounts: number; agreeing: number }): PocketDatasetReadiness {
  const agreementPct = input.recounts > 0 ? Math.round((input.agreeing / input.recounts) * 1000) / 10 : null;
  const enoughBogies = input.coveredBogies >= POCKET_MODEL_GATE.minCoveredBogies;
  const enoughRecounts = input.recounts >= POCKET_MODEL_GATE.minRecounts;
  const agrees = agreementPct !== null && agreementPct >= POCKET_MODEL_GATE.minAgreementPct;
  const allowed = enoughBogies && enoughRecounts && agrees;
  let why: string;
  if (allowed) {
    why = `${input.coveredBogies} covered bogies and ${input.recounts} blind recounts agreeing ${agreementPct}% of the time. A model may be attempted; it must beat the always-full baseline and be measured per bogie against these recounts, and it may only ever raise a question.`;
  } else {
    const missing: string[] = [];
    if (!enoughBogies) missing.push(`${input.coveredBogies} of ${POCKET_MODEL_GATE.minCoveredBogies} covered bogies`);
    if (!enoughRecounts) missing.push(`${input.recounts} of ${POCKET_MODEL_GATE.minRecounts} blind recounts`);
    else if (!agrees) missing.push(`recounts agree ${agreementPct}% of the time; ${POCKET_MODEL_GATE.minAgreementPct}% is needed before a model has anything to be measured against`);
    why = `No model. ${missing.join('; ')}. Every count is a label; keep counting, and have a second person recount blind.`;
  }
  return {
    labelledPhotos: input.labelledPhotos,
    coveredBogies: input.coveredBogies,
    recounts: input.recounts,
    agreeing: input.agreeing,
    agreementPct,
    disagreements: input.recounts - input.agreeing,
    model: POCKET_MODEL,
    gate: { allowed, why, thresholds: POCKET_MODEL_GATE }
  };
}
