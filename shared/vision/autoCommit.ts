/**
 * When the camera is allowed to decide without asking
 * Indian Railways WRS Raipur
 *
 * THE RULE, AND WHY IT IS THE ONLY PLACE IT LIVES
 * ------------------------------------------------
 * Everything the camera does today ends in a tap: it proposes, a person
 * confirms. At seven hundred springs a shift that tap IS the work, and a
 * system that never removes it has not reduced anything. This is the one
 * function that may remove it, and both the sorting bench and the wagon
 * checklist call it — so a spring and a brake block are judged by the same
 * rule, and there is exactly one thing to read to know what that rule is.
 *
 * FIVE CONDITIONS, ALL REQUIRED
 * -----------------------------
 *   1. Every head that contributes has EARNED it: a measured leave-one-out
 *      accuracy of 95% or better, on at least thirty of this shop's own
 *      photographs. Not the drawn ones a drive uses, and not a number anybody
 *      asserted. On a fresh installation this is INSUFFICIENT for every head,
 *      so the camera cannot decide anything until it has been taught with
 *      real parts and scored on them.
 *
 *   2. THIS proposal is confident — at least four of the five nearest
 *      photographs agree. A head that is usually right is still allowed to
 *      be unsure about one frame.
 *
 *   3. The live agreement has not fallen. The learning ledger records every
 *      proposal and whether the person kept it; if the recent rate drops
 *      below 95%, the head is switched off for auto-commit until it recovers.
 *      A camera that was good last month and is not this month — new
 *      lighting, a new spring type, a new inspector labelling differently —
 *      switches itself off rather than waiting to be caught.
 *
 *   4. The outcome is a PASS. Any fault the camera sees — rust, a crack, a
 *      deformation — and any measurement out of band is a condemnation, and
 *      a condemnation is a decision with a cost: a part is scrapped, or a
 *      wagon is held. A person makes that call. The asymmetry is deliberate.
 *      Auto-passing a genuinely bad part is the failure that matters, so it
 *      is gated on all of the above; auto-condemning a good part would only
 *      waste it, and it is not allowed at all.
 *
 *   5. For a spring, the height was MEASURED and is in band. The band is not
 *      something the camera decides — it comes from a caliper or the marked
 *      strip — so an auto-committed spring is one where the instrument said
 *      pass and the camera saw nothing wrong. Both, not either.
 *
 * WHAT AUTO-COMMIT IS NOT
 * -----------------------
 * It is not the camera being trusted. It is the camera being MEASURED as
 * trustworthy on these parts, today, and the record saying so: every row it
 * writes carries CAMERA_AUTO, never MANUAL, with the confidence and the
 * photographs that produced it. A supervisor pulls a sample of those rows
 * blind, and the agreement feeds condition 3. The person has not left the
 * loop; they have moved from every part to the exceptions and the sample.
 */

import type { BrainHead, BrainVerdict } from './types.ts';

/** Four of five nearest must agree. Above CONFIDENCE_FLOOR, which is 0.65. */
export const AUTO_CONFIDENCE_FLOOR = 0.8;

/** The live agreement below which a head switches itself off. Same 95%. */
export const AUTO_AGREEMENT_FLOOR = 0.95;

/** Proposals the live agreement must be computed over before it counts. */
export const AUTO_AGREEMENT_MIN_SAMPLE = 30;

export interface HeadReading {
  head: BrainHead;
  /** From VisionBrain.evaluate — measured, leave-one-out, on real photographs. */
  verdict: BrainVerdict;
  /** This proposal's confidence, 0..1. */
  confidence: number;
  /** null means the camera declined to answer. */
  label: string | null;
}

export interface LiveAgreement {
  /** Proposals in the window the rate is computed over. */
  sampled: number;
  /** Share the person kept, 0..1, or null below the minimum sample. */
  rate: number | null;
}

export interface AutoCommitInput {
  domain: 'SPRING' | 'WAGON_PART';
  heads: HeadReading[];
  /**
   * Springs: whether the measured height put the spring in band. null when
   * there is no measurement, which is never enough.
   * Wagon parts: null — there is no instrument reading for a brake block.
   */
  measurementPassed: boolean | null;
  /** From the server, per head. Absent means "not known", which is never enough. */
  liveAgreement: Partial<Record<BrainHead, LiveAgreement>> | null;
  /**
   * What the bench is set up to expect for a naming head, from a source that
   * is not the camera — the sorting queue's position, or the checklist item
   * being judged. When given, the camera's answer must AGREE with it or the
   * spring is asked about.
   *
   * This is the sixth condition, and it was added after a drive caught the
   * camera name an inner spring "outer" at 80%+ confidence, on heads that had
   * all earned 95%, and commit it. A wrong category selects the wrong band
   * table, so that is the one wrong auto-commit that could pass a bad spring.
   * Two independent sources that agree are worth more than one source at any
   * threshold, and the second one is already on the bench.
   */
  expected?: Partial<Record<BrainHead, string>>;
}

export type AutoCommitMode = 'AUTO' | 'ASK';

export interface AutoCommitDecision {
  mode: AutoCommitMode;
  /** PASS when AUTO. When ASK, what the evidence points to, or null if unclear. */
  outcome: 'PASS' | 'CONDEMN' | null;
  /** One sentence a person can read on screen. */
  reason: string;
  /** Which condition stopped it, for the ledger and the dashboard. */
  stoppedBy:
    | null
    | 'DISAGREES_WITH_BENCH'
    | 'NOT_EARNED'
    | 'NOT_CONFIDENT'
    | 'AGREEMENT_FELL'
    | 'FAULT_SEEN'
    | 'MEASUREMENT_FAILED'
    | 'NO_MEASUREMENT'
    | 'NO_ANSWER';
}

/**
 * Which labels count as a fault, per head.
 *
 * Stated here rather than inferred, because "is this a fault" is exactly the
 * kind of thing that must not be a heuristic. LIGHT_RUST is not a fault: a
 * used spring in a shed carries surface rust and passes on it. Anything the
 * shop teaches beyond these labels is treated as a fault until listed —
 * refusing to auto-pass an unknown label is the safe direction.
 */
export const PASSING_LABELS: Partial<Record<BrainHead, readonly string[]>> = {
  SURFACE: ['CLEAN', 'LIGHT_RUST'],
  DAMAGE: ['NONE']
};

export function isFault(head: BrainHead, label: string | null): boolean {
  if (label === null) return false;
  const passing = PASSING_LABELS[head];
  // Heads with no fault semantics (CATEGORY, PART_ID) name things; they do not
  // judge them.
  if (!passing) return false;
  return !passing.includes(label);
}

export function decideAutoCommit(input: AutoCommitInput): AutoCommitDecision {
  const { heads, measurementPassed, liveAgreement, domain } = input;

  if (heads.length === 0) {
    return { mode: 'ASK', outcome: null, reason: 'Nothing was looked at.', stoppedBy: 'NO_ANSWER' };
  }

  // 4. A fault anywhere is a condemnation, and a person makes that call.
  //    Checked first so the reason a person sees is the one that matters.
  const fault = heads.find((h) => isFault(h.head, h.label));
  if (fault) {
    return {
      mode: 'ASK',
      outcome: 'CONDEMN',
      reason: `The camera sees ${fault.label!.replace(/_/g, ' ').toLowerCase()}. A condemnation is a person's decision.`,
      stoppedBy: 'FAULT_SEEN'
    };
  }

  // The camera declined on some head. Nothing to commit — and this is said
  // before the measurement is judged, because when the camera cannot name
  // the spring there IS no band lookup, and "no measured height" would be
  // the wrong reason for a person to read.
  const silent = heads.find((h) => h.label === null);
  if (silent) {
    return {
      mode: 'ASK',
      outcome: null,
      reason: `The camera did not recognise this (${silent.head.toLowerCase()}). Tap the right answer and it will know next time.`,
      stoppedBy: 'NO_ANSWER'
    };
  }

  // 6. The camera's name for the thing must agree with what the bench was
  //    set up for. Checked before the measurement, because a disagreement
  //    means the band lookup below was done against the wrong table.
  if (input.expected) {
    for (const h of heads) {
      const want = input.expected[h.head];
      if (want && h.label !== want) {
        return {
          mode: 'ASK',
          outcome: null,
          reason: `The camera thinks this is ${h.label!.replace(/_/g, ' ').toLowerCase()}, but the bench is set to ${want.replace(/_/g, ' ').toLowerCase()}. One of them is wrong — please check.`,
          stoppedBy: 'DISAGREES_WITH_BENCH'
        };
      }
    }
  }

  // 5. For a spring, the instrument has to have said pass.
  if (domain === 'SPRING') {
    if (measurementPassed === null) {
      return {
        mode: 'ASK',
        outcome: null,
        reason: 'No measured height. The band comes from the caliper or the strip, never from the camera.',
        stoppedBy: 'NO_MEASUREMENT'
      };
    }
    if (measurementPassed === false) {
      return {
        mode: 'ASK',
        outcome: 'CONDEMN',
        reason: 'The measured height is out of band. A condemnation is a person\'s decision.',
        stoppedBy: 'MEASUREMENT_FAILED'
      };
    }
  }

  for (const h of heads) {

    // 1. Earned, on real photographs.
    if (h.verdict !== 'ASSIST') {
      return {
        mode: 'ASK',
        outcome: 'PASS',
        reason:
          h.verdict === 'INSUFFICIENT'
            ? `Too few of this shop's photographs to score ${h.head.toLowerCase()} yet. It proposes; you decide.`
            : `${h.head.toLowerCase()} has not reached 95% on this shop's photographs (${h.verdict.replace(/_/g, ' ').toLowerCase()}).`,
        stoppedBy: 'NOT_EARNED'
      };
    }

    // 2. Confident about this frame.
    if (h.confidence < AUTO_CONFIDENCE_FLOOR) {
      return {
        mode: 'ASK',
        outcome: 'PASS',
        reason: `Only ${Math.round(h.confidence * 100)}% sure about ${h.head.toLowerCase()} on this one. Please confirm.`,
        stoppedBy: 'NOT_CONFIDENT'
      };
    }

    // 3. Still agreeing with people, lately.
    const live = liveAgreement?.[h.head];
    if (!live || live.rate === null || live.sampled < AUTO_AGREEMENT_MIN_SAMPLE) {
      return {
        mode: 'ASK',
        outcome: 'PASS',
        reason: `Not enough recent proposals to know whether ${h.head.toLowerCase()} is still agreeing with inspectors (${live?.sampled ?? 0} of ${AUTO_AGREEMENT_MIN_SAMPLE}).`,
        stoppedBy: 'AGREEMENT_FELL'
      };
    }
    if (live.rate < AUTO_AGREEMENT_FLOOR) {
      return {
        mode: 'ASK',
        outcome: 'PASS',
        reason: `Inspectors kept only ${Math.round(live.rate * 100)}% of recent ${h.head.toLowerCase()} answers. Switched off until it recovers.`,
        stoppedBy: 'AGREEMENT_FELL'
      };
    }
  }

  return {
    mode: 'AUTO',
    outcome: 'PASS',
    reason:
      domain === 'SPRING'
        ? 'Measured in band, nothing seen wrong, every head at 95% or better on this shop\'s springs. Recorded.'
        : 'Nothing seen wrong, every head at 95% or better on this shop\'s parts. Recorded.',
    stoppedBy: null
  };
}

// ---------------------------------------------------------------------------
// What a client may claim about how a verdict was reached
// ---------------------------------------------------------------------------

import { ALL_MEASUREMENT_SOURCES, type MeasurementSource } from '../types.ts';

/**
 * A client may say a verdict was MANUAL, CAMERA_ASSISTED or CAMERA_AUTO. It
 * may not say OCR here — that is set by the caliper route, which knows — and
 * anything else is refused rather than coerced to MANUAL. Coercing would let a
 * typo turn a camera decision into "a person did this", which is the one
 * relabelling this whole design exists to prevent.
 */
export const CLIENT_CLAIMABLE_SOURCES: readonly MeasurementSource[] = [
  'MANUAL',
  'CAMERA_ASSISTED',
  'CAMERA_AUTO'
] as const;

export function parseClaimedSource(raw: unknown): MeasurementSource | null {
  if (raw === undefined || raw === null || raw === '') return 'MANUAL';
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toUpperCase() as MeasurementSource;
  if (!ALL_MEASUREMENT_SOURCES.includes(v)) return null;
  if (!CLIENT_CLAIMABLE_SOURCES.includes(v)) return null;
  return v;
}
