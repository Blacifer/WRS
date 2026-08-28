/**
 * Reading a wagon number off the wagon
 * Indian Railways WRS Raipur
 *
 * WHY THIS ONE AND NOT THE SPRINGS
 * --------------------------------
 * Free height cannot be recovered from a photograph, because an image carries
 * no scale — that is why the spring camera was removed and should stay
 * removed. A painted wagon number has no such problem: it is high-contrast
 * text, and reading text needs no reference dimension at all.
 *
 * So this is the one piece of computer vision in the system that is honest,
 * and it removes a real piece of manual work — typing a wagon number, in a
 * shop, on a tablet, at the start of every wagon.
 *
 * WHAT IT REFUSES TO DO
 * ---------------------
 * It never silently accepts a reading. A wagon number that is wrong by one
 * character attaches an entire overhaul to the wrong vehicle, which is worse
 * than any amount of typing. Every result comes back as a *candidate* for a
 * person to confirm, and a low-confidence or malformed read is reported as a
 * failure rather than a guess.
 *
 * FORMAT
 * ------
 * Indian Railways wagon numbers are eleven digits, and are usually stencilled
 * with the owning railway and type alongside. The digits are what identify the
 * vehicle, so those are what this looks for — while accepting that the shop
 * also uses shorter local forms, which are returned but flagged as not
 * matching the standard.
 */

import Tesseract from 'tesseract.js';
import { parseWagonNumber } from '../../../shared/wagons/wagonNumber.ts';

export interface WagonNumberCandidate {
  /** The reading, cleaned of spacing and stray punctuation. */
  text: string;
  /** 0–1, from the recogniser. */
  confidence: number;
  /** True when the reading is eleven digits, as an IR wagon number should be. */
  matchesStandardFormat: boolean;
  /**
   * True when the eleven digits satisfy the §417 check digit.
   *
   * This is the strongest signal available and it does not come from the
   * recogniser. OCR confidence says how sure Tesseract is about the shapes it
   * saw; the check digit says whether the digits can be a real wagon number at
   * all. A misread almost always fails it, so a reading that passes is worth
   * more than a high-confidence reading that does not.
   */
  checkDigitValid: boolean;
  /** Wagon type implied by the first two digits, when the check passes. */
  impliedType?: string;
}

export interface WagonNumberResult {
  ok: boolean;
  /** Best reading, when there is one worth offering. */
  candidate: WagonNumberCandidate | null;
  /** Other plausible readings, best first — a person may recognise the right one. */
  alternatives: WagonNumberCandidate[];
  /** Why nothing is being offered, when ok is false. */
  reason?: string;
}

/**
 * Below this the reading is not offered at all.
 *
 * Deliberately high. The cost of a confident wrong wagon number is an entire
 * overhaul recorded against the wrong vehicle; the cost of a rejected read is
 * that somebody types eleven digits. Those are not close, so the threshold sits
 * where it stops the first at the expense of the second.
 */
export const MIN_CONFIDENCE = 0.6;

/** Digits only — the wagon number itself, stripped of railway and type marks. */
function digitsOnly(raw: string): string {
  return raw.replace(/\D/g, '');
}

/**
 * Pulls plausible wagon numbers out of a block of recognised text.
 *
 * Stencilling puts the number among other markings — owning railway, wagon
 * type, tare weight — so the whole recognised block is searched for runs of
 * digits rather than assuming the number is alone.
 */
export function extractCandidates(rawText: string, confidence: number): WagonNumberCandidate[] {
  const runs = rawText
    .split(/[^0-9]+/)
    .map((r) => r.trim())
    .filter((r) => r.length >= 6);

  // Also try the whole text with separators removed, which catches a number
  // the recogniser broke across a space or a stray mark.
  const joined = digitsOnly(rawText);
  if (joined.length >= 6 && !runs.includes(joined)) runs.push(joined);

  const seen = new Set<string>();
  const candidates: WagonNumberCandidate[] = [];

  for (const run of runs) {
    if (seen.has(run)) continue;
    seen.add(run);
    const parsed = run.length === 11 ? parseWagonNumber(run) : null;
    candidates.push({
      text: run,
      confidence,
      matchesStandardFormat: run.length === 11,
      checkDigitValid: parsed?.valid === true,
      impliedType: parsed?.valid ? parsed.wagonType : undefined
    });
  }

  /*
   * Ordering, strongest evidence first.
   *
   * A passing check digit outranks everything, including OCR confidence.
   * Tesseract's confidence describes how certain it is about the glyph shapes;
   * the check digit describes whether those digits can be a wagon number at
   * all. Roughly nine in ten misreads fail it, so a candidate that passes is
   * far more likely correct than a confident one that does not — and before
   * this, a confident misread would have been offered first.
   */
  return candidates.sort((a, b) => {
    if (a.checkDigitValid !== b.checkDigitValid) return a.checkDigitValid ? -1 : 1;
    if (a.matchesStandardFormat !== b.matchesStandardFormat) return a.matchesStandardFormat ? -1 : 1;
    return b.text.length - a.text.length;
  });
}

/**
 * Reads a wagon number from an image.
 *
 * `image` is anything Tesseract accepts — a data URL, a blob, a canvas.
 */
export async function readWagonNumber(image: string | Blob | HTMLCanvasElement): Promise<WagonNumberResult> {
  let worker: Tesseract.Worker | null = null;

  try {
    worker = await Tesseract.createWorker('eng');

    // Constrained to digits. Stencilled numerals are frequently misread as
    // letters otherwise — 0 as O, 1 as I, 8 as B — and every one of those
    // would produce a wrong wagon rather than a failed read.
    await worker.setParameters({ tessedit_char_whitelist: '0123456789 ' });

    const result = await worker.recognize(image);
    const text = result?.data?.text ?? '';
    const confidence = (result?.data?.confidence ?? 0) / 100;

    const candidates = extractCandidates(text, confidence);

    if (candidates.length === 0) {
      return {
        ok: false,
        candidate: null,
        alternatives: [],
        reason:
          'No number could be read from that photograph. This reads the eleven digits ' +
          'painted on the wagon — point it at those, move closer, or type them in.'
      };
    }

    /*
     * A candidate whose check digit passes is offered even when the recogniser
     * was unsure, because the arithmetic is better evidence than the
     * confidence score. The reading is still shown for a person to confirm —
     * a valid check digit means "no reason to doubt this", never "certainly
     * right".
     */
    const checked = candidates.find((c) => c.checkDigitValid);
    if (checked) {
      return {
        ok: true,
        candidate: checked,
        alternatives: candidates.filter((c) => c !== checked)
      };
    }

    if (confidence < MIN_CONFIDENCE) {
      return {
        ok: false,
        candidate: null,
        alternatives: candidates,
        /*
         * Say what it was looking for, not just how unsure it was.
         *
         * A photograph of a spring, or of a calibration label, produces digits
         * and a low percentage — and "19% certain" tells the reader nothing
         * about why. It was reported from the field as a puzzling result when
         * the app was, correctly, refusing. The refusal was right; the
         * explanation was not.
         *
         * When digits were found but none of them satisfies the §417 check
         * digit, that is the more useful thing to say: these are not a wagon
         * number, whatever else they are.
         */
        reason: candidates.some((c) => c.matchesStandardFormat)
          ? `Eleven digits were read but they do not check out as a wagon number ` +
            `(${(confidence * 100).toFixed(0)}% certain). Point the camera at the number painted ` +
            `on the wagon, or type it in — a number wrong by one digit attaches the whole ` +
            `overhaul to another vehicle.`
          : `No wagon number could be made out (${(confidence * 100).toFixed(0)}% certain). ` +
            `This reads the eleven digits painted on the wagon; if that is not what the ` +
            `camera is pointed at, it will not find one.`
      };
    }

    return {
      ok: true,
      candidate: candidates[0],
      alternatives: candidates.slice(1)
    };
  } catch (err: any) {
    return {
      ok: false,
      candidate: null,
      alternatives: [],
      reason: err?.message || 'The camera reading failed. Type the number in instead.'
    };
  } finally {
    // Tesseract holds a worker thread; leaking one per attempt would degrade a
    // tablet over a shift.
    if (worker) await worker.terminate().catch(() => {});
  }
}
