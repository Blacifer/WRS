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

export interface WagonNumberCandidate {
  /** The reading, cleaned of spacing and stray punctuation. */
  text: string;
  /** 0–1, from the recogniser. */
  confidence: number;
  /** True when the reading is eleven digits, as an IR wagon number should be. */
  matchesStandardFormat: boolean;
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
    candidates.push({
      text: run,
      confidence,
      matchesStandardFormat: run.length === 11
    });
  }

  // An eleven-digit run is what a wagon number looks like, so prefer those;
  // then longer over shorter, since a truncated read is the common failure.
  return candidates.sort((a, b) => {
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
        reason: 'No number could be read from that photograph. Move closer, or type it in.'
      };
    }

    if (confidence < MIN_CONFIDENCE) {
      return {
        ok: false,
        candidate: null,
        alternatives: candidates,
        reason:
          `The number was not read clearly enough to offer (${(confidence * 100).toFixed(0)}% certain). ` +
          `A wagon number that is wrong by one digit attaches the whole overhaul to another vehicle, ` +
          `so it is better to type it.`
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
