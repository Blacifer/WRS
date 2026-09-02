/**
 * Readings that do not belong
 * Indian Railways WRS Raipur
 *
 * WHY THIS EXISTS
 * ---------------
 * Every free height in this system is typed in by a person reading a caliper
 * display. There is no instrument path and, for this shop, there will not be
 * one — so transcription error is not a defect to be removed, it is a
 * permanent property of the process, and the only question is whether it gets
 * noticed.
 *
 * Shadow mode catches these by having a supervisor diff the app against paper
 * for one week. This module does the same job on every shift afterwards, for
 * the reading classes a diff would have caught.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * It never changes a verdict, never blocks a save, and never touches an RDSO
 * limit. A spring is condemned by Tables 28-33 and by nothing else. The whole
 * output of this module is one advisory sentence asking a human to measure
 * that spring again, which they are free to ignore — and which is recorded
 * either way, because "the app asked and the inspector confirmed the reading"
 * is a more useful audit record than silence.
 *
 * That distinction matters more than it might seem. A flag that blocks is a
 * safety limit written by a statistician instead of by RDSO. A flag that asks
 * is a second pair of eyes.
 *
 * WHY MEDIAN AND MAD RATHER THAN MEAN AND STANDARD DEVIATION
 * ----------------------------------------------------------
 * We are hunting outliers, and an outlier drags the mean toward itself and
 * inflates the standard deviation — so the very reading we want to catch
 * makes the test that should catch it weaker. A single 206 mm typo among
 * twenty 260 mm springs moves the mean by nearly 3 mm and roughly triples the
 * spread, which can be enough to let it pass a 3-sigma test it should fail.
 *
 * The median and the median absolute deviation do not move for one bad value
 * — you would have to corrupt half the readings before they shifted. That is
 * the property this job needs.
 */

import type { BogieType, SpringCondition, SpringPosition } from '../types.ts';

/**
 * Below this many prior readings, no anomaly is reported at all.
 *
 * The same principle as the throughput screen refusing to quote a rate from
 * five taps: a population statistic computed from four springs describes those
 * four springs, not the type. Calling the fifth one anomalous because it
 * differs from three others would train inspectors to dismiss the flag, and a
 * warning people have learned to dismiss is worse than no warning.
 */
export const MIN_POPULATION = 12;

/**
 * Iglewicz and Hoaglin's cutoff for the modified z-score.
 *
 * 3.5 is their published recommendation and it is deliberately not tuned
 * against this shop's data. A threshold fitted to our own readings would drift
 * with whatever it was fitted to, and would need re-justifying every time the
 * population changed; a published constant can be pointed at in a review.
 */
export const MODIFIED_Z_CUTOFF = 3.5;

/** Scaling that puts the MAD on the same footing as a standard deviation. */
const MAD_TO_SIGMA = 0.6745;

/**
 * How many identical readings in a row before we ask whether anyone is
 * actually measuring.
 *
 * Six is deliberately generous. Springs genuinely do repeat — they come off
 * the same wagon, off the same production batch, and free heights cluster
 * hard inside a 3 mm band, so four or five identical readings is an ordinary
 * morning. Six consecutive readings identical to 0.01 mm is a different
 * claim: it says the caliper was read once and the number reused.
 */
export const REPEAT_RUN_LENGTH = 6;

export type AnomalyKind =
  /** Far from every other reading of this spring type. */
  | 'OUT_OF_POPULATION'
  /** Two adjacent digits swapped would put it back in the population. */
  | 'DIGIT_TRANSPOSITION'
  /** The same value, again and again, to the hundredth of a millimetre. */
  | 'REPEATED_VALUE';

export interface AnomalyPopulation {
  bogieType: BogieType;
  springPosition: SpringPosition;
  condition: SpringCondition;
  /** Prior free heights in mm for this exact combination, any order. */
  heights: number[];
  /**
   * The most recent readings in the order they were entered, newest last.
   * Only needed for the repeated-value check; omit it and that check is
   * skipped rather than guessed at.
   */
  recentInOrder?: number[];
}

export interface AnomalyFinding {
  kind: AnomalyKind;
  /** Shown to the inspector, in their own terms. Never a verdict. */
  message: string;
  messageHi: string;
  /** Population median in mm, for context on screen. */
  median: number;
  /** Modified z-score, when one could be computed. */
  modifiedZ?: number;
  /** For a suspected transposition, the value that would have been ordinary. */
  suggested?: number;
}

export interface AnomalyResult {
  /** True when at least one finding is worth showing. */
  flagged: boolean;
  /** Why nothing was reported, when nothing was. */
  reason?: string;
  populationSize: number;
  findings: AnomalyFinding[];
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}

/** Median of the absolute deviations from the median. */
function medianAbsoluteDeviation(values: number[], med: number): number {
  return median(values.map((v) => Math.abs(v - med)));
}

/**
 * Every value obtainable by swapping one adjacent pair of digits.
 *
 * Restricted to adjacent pairs on purpose. That is the slip a person actually
 * makes copying a number off a display — 260.5 typed as 206.5 — and widening
 * it to arbitrary digit permutations would manufacture near-misses for almost
 * any reading, which is how a useful check turns into noise.
 *
 * The decimal point is held in place; only the digits move.
 */
function adjacentTranspositions(value: number): number[] {
  const text = value.toFixed(2);
  const chars = [...text];
  const out: number[] = [];

  for (let i = 0; i < chars.length - 1; i++) {
    const a = chars[i]!;
    const b = chars[i + 1]!;
    if (!/\d/.test(a) || !/\d/.test(b) || a === b) continue;

    const swapped = [...chars];
    swapped[i] = b;
    swapped[i + 1] = a;
    const n = Number(swapped.join(''));
    if (Number.isFinite(n)) out.push(n);
  }

  return out;
}

/**
 * Judge one reading against the readings that came before it.
 *
 * Returns an advisory only. The caller classifies the spring by the RDSO
 * tables exactly as it would have without this, and shows anything found
 * alongside that verdict rather than in place of it.
 */
export function findMeasurementAnomaly(
  measuredHeight: number,
  population: AnomalyPopulation
): AnomalyResult {
  const heights = (population.heights || []).filter((h) => Number.isFinite(h));
  const findings: AnomalyFinding[] = [];

  if (heights.length < MIN_POPULATION) {
    return {
      flagged: false,
      populationSize: heights.length,
      findings: [],
      reason: `Not enough history yet — ${heights.length} of ${MIN_POPULATION} readings needed for this spring type before an unusual one can be recognised.`
    };
  }

  const med = median(heights);
  const mad = medianAbsoluteDeviation(heights, med);

  /*
   * A zero MAD means over half the readings are identical. That happens
   * legitimately on a tight batch, and it makes the modified z-score divide by
   * zero. Fall back to a plain distance test against the band width: the 3 mm
   * grouping rule is the shop's own unit of "meaningfully different", so being
   * more than two bands from the median is the honest threshold here.
   */
  if (mad === 0) {
    const drift = Math.abs(measuredHeight - med);
    if (drift > 6) {
      findings.push({
        kind: 'OUT_OF_POPULATION',
        median: med,
        message: `${measuredHeight.toFixed(1)} mm is ${drift.toFixed(1)} mm from the ${med.toFixed(1)} mm every other spring of this type has measured. Worth measuring again before it is recorded.`,
        messageHi: `${measuredHeight.toFixed(1)} मिमी, इस प्रकार के अन्य सभी स्प्रिंग के ${med.toFixed(1)} मिमी से ${drift.toFixed(1)} मिमी दूर है। दर्ज करने से पहले दोबारा मापें।`
      });
    }
  } else {
    const modifiedZ = (MAD_TO_SIGMA * (measuredHeight - med)) / mad;

    if (Math.abs(modifiedZ) > MODIFIED_Z_CUTOFF) {
      findings.push({
        kind: 'OUT_OF_POPULATION',
        median: med,
        modifiedZ: Math.round(modifiedZ * 100) / 100,
        message: `${measuredHeight.toFixed(1)} mm sits well outside the usual range for this spring — the typical reading is around ${med.toFixed(1)} mm. Worth measuring again before it is recorded.`,
        messageHi: `${measuredHeight.toFixed(1)} मिमी इस स्प्रिंग की सामान्य सीमा से बाहर है — सामान्य माप लगभग ${med.toFixed(1)} मिमी है। दर्ज करने से पहले दोबारा मापें।`
      });

      /*
       * Only look for a transposition once the reading is already odd. Asking
       * "could a swap explain this?" of an ordinary reading would turn up
       * coincidences constantly; asking it of a reading we have already
       * decided is strange is a genuine diagnosis, and it gives the inspector
       * something far more useful than "unusual" — it names the likely typo.
       */
      for (const candidate of adjacentTranspositions(measuredHeight)) {
        const candidateZ = (MAD_TO_SIGMA * (candidate - med)) / mad;
        if (Math.abs(candidateZ) <= MODIFIED_Z_CUTOFF) {
          findings.push({
            kind: 'DIGIT_TRANSPOSITION',
            median: med,
            suggested: candidate,
            modifiedZ: Math.round(candidateZ * 100) / 100,
            message: `Did you mean ${candidate.toFixed(1)} mm? Swapping two digits of ${measuredHeight.toFixed(1)} gives a reading in the usual range for this spring.`,
            messageHi: `क्या आपका मतलब ${candidate.toFixed(1)} मिमी था? ${measuredHeight.toFixed(1)} के दो अंक बदलने पर यह इस स्प्रिंग की सामान्य सीमा में आ जाता है।`
          });
          break;
        }
      }
    }
  }

  /*
   * The stuck-value check is about the process rather than the number, so it
   * runs whether or not the reading itself looked odd. A run of identical
   * heights is not wrong — it is a question about whether each spring was
   * actually put in the gauge.
   */
  const ordered = population.recentInOrder;
  if (ordered && ordered.length >= REPEAT_RUN_LENGTH - 1) {
    const tail = [...ordered.slice(-(REPEAT_RUN_LENGTH - 1)), measuredHeight];
    if (tail.length === REPEAT_RUN_LENGTH && tail.every((v) => v === tail[0])) {
      findings.push({
        kind: 'REPEATED_VALUE',
        median: med,
        message: `That is ${REPEAT_RUN_LENGTH} springs in a row recorded at exactly ${measuredHeight.toFixed(1)} mm. If each one was gauged separately this is fine — please confirm.`,
        messageHi: `लगातार ${REPEAT_RUN_LENGTH} स्प्रिंग ठीक ${measuredHeight.toFixed(1)} मिमी दर्ज हुए हैं। यदि हर एक को अलग-अलग मापा गया है तो ठीक है — कृपया पुष्टि करें।`
      });
    }
  }

  return {
    flagged: findings.length > 0,
    populationSize: heights.length,
    findings
  };
}
