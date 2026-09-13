/**
 * The camera's vocabulary, shared by the browser that runs it and the server
 * that remembers what it learned.
 * Indian Railways WRS Raipur
 */

/**
 * The questions the camera is allowed to answer.
 *
 * Kept separate rather than as one combined label because they are genuinely
 * independent — a rusty outer spring and a clean outer spring are the same
 * category — and because they should be able to fail independently. Category
 * will work long before damage does, and it should not be held back by it.
 *
 * There is no BAND head and there must never be one. See visionBrain.ts.
 */
export type BrainHead = 'CATEGORY' | 'SURFACE' | 'DAMAGE' | 'PART_ID';

export const BRAIN_HEADS: readonly BrainHead[] = ['CATEGORY', 'SURFACE', 'DAMAGE', 'PART_ID'] as const;

export type BrainDomain = 'SPRING' | 'WAGON_PART';

export const BRAIN_DOMAINS: readonly BrainDomain[] = ['SPRING', 'WAGON_PART'] as const;

/**
 * What a head's measured accuracy permits. The same three thresholds as the
 * blind spring read, deliberately: a threshold chosen after seeing the result
 * is not a threshold.
 */
export type BrainVerdict = 'INSUFFICIENT' | 'ASSIST' | 'FLAG_ONLY' | 'STOP';
