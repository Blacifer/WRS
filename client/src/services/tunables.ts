/**
 * Tuned thresholds, as approved by a supervisor
 * Indian Railways WRS Raipur
 *
 * The learning loop records outcomes, measures accuracy, and proposes changes
 * that a named person accepts or rejects. This is the other end of it: the
 * place the running app reads those values from.
 *
 * Without it the loop did not close. Approved values were written to a table
 * nothing read, so accepting a proposal changed no behaviour at all — a dial
 * connected to nothing, which is worse than no dial, because someone turns it
 * and believes they have changed something.
 *
 * Every read has a fallback equal to the shipped default, so a failed fetch
 * degrades to the behaviour the app would have had anyway rather than to zero
 * or undefined. A threshold that silently becomes 0 would accept every reading
 * the OCR ever produced.
 */

import { api } from './api.ts';

const DEFAULTS: Record<string, number> = {
  'ocr.manual_confirm_threshold': 0.5,
  'acoustic.alert_threshold': 0.6,
  'voice.match_threshold': 0.7
};

let cache: Record<string, number> | null = null;
let inFlight: Promise<void> | null = null;

/** Loads the approved values once. Safe to call repeatedly. */
export async function loadTunables(): Promise<void> {
  if (cache) return;
  if (inFlight) return inFlight;

  inFlight = api
    .getEffectiveParameters()
    .then((r) => {
      cache = { ...DEFAULTS, ...(r.data || {}) };
    })
    .catch(() => {
      // Offline, or not signed in yet. The shipped defaults are the right
      // answer here — they are what the system was tuned to before anyone
      // changed anything.
      cache = { ...DEFAULTS };
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/** The approved value, or the shipped default if nothing has been loaded. */
export function tunable(key: keyof typeof DEFAULTS | string): number {
  if (cache && key in cache) return cache[key];
  return DEFAULTS[key] ?? 0;
}

/** Forces a re-read, for after a supervisor approves a change. */
export function refreshTunables(): Promise<void> {
  cache = null;
  return loadTunables();
}
