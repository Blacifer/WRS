/**
 * Wagon number recognition — parsing and refusal
 * Indian Railways WRS Raipur
 *
 * The recogniser itself needs a browser, so what is tested here is everything
 * around it: how recognised text becomes a candidate, and — more importantly —
 * when the system declines to offer one.
 *
 * That second part carries the risk. A wagon number wrong by a single digit
 * attaches an entire overhaul to a different vehicle, and would be discovered
 * long after the wagon left. Typing eleven digits is the cheap failure; a
 * confident wrong reading is the expensive one.
 */

import { describe, it, expect } from 'vitest';
import { extractCandidates, MIN_CONFIDENCE } from './wagonNumberOcr.ts';

describe('Extracting a wagon number from recognised text', () => {
  it('finds an eleven-digit number on its own', () => {
    const c = extractCandidates('31103456789', 0.9);
    expect(c[0].text).toBe('31103456789');
    expect(c[0].matchesStandardFormat).toBe(true);
  });

  it('finds the number among the other stencilling', () => {
    // A wagon carries its owning railway, type and tare weight alongside the
    // number. Assuming the number is alone on the panel would fail on every
    // real wagon.
    const c = extractCandidates('SECR BOXNHL\n31103456789\nTARE 22.5 T', 0.85);
    expect(c[0].text).toBe('31103456789');
    expect(c[0].matchesStandardFormat).toBe(true);
  });

  it('prefers a standard-format number over a longer run of digits', () => {
    // Length alone is the wrong ordering: a tare weight and a date can run
    // together into something longer than the number itself.
    const c = extractCandidates('20240115 31103456789 225', 0.8);
    expect(c[0].text).toBe('31103456789');
  });

  it('rejoins a number the recogniser split across a space', () => {
    // Stencilling is often spaced in groups, and a smudge splits it further.
    const c = extractCandidates('3110 3456 789', 0.8);
    expect(c.some((x) => x.text === '31103456789' && x.matchesStandardFormat)).toBe(true);
  });

  it('flags a non-standard length rather than padding or truncating it', () => {
    // The shop uses shorter local forms. Those are returned, because refusing
    // them would make the feature useless in the bays that use them — but they
    // are not passed off as a standard number.
    const c = extractCandidates('4567890', 0.9);
    expect(c[0].text).toBe('4567890');
    expect(c[0].matchesStandardFormat).toBe(false);
  });

  it('ignores runs too short to be a wagon number', () => {
    // Tare weights, axle loads and dates are all over a wagon panel.
    const c = extractCandidates('SECR 225 T 2024', 0.9);
    expect(c.every((x) => x.text.length >= 6)).toBe(true);
  });

  it('returns nothing when there are no digits at all', () => {
    expect(extractCandidates('SECR BOXNHL TARE', 0.95)).toEqual([]);
    expect(extractCandidates('', 0.9)).toEqual([]);
  });

  it('does not repeat the same reading', () => {
    const c = extractCandidates('31103456789 31103456789', 0.9);
    expect(c.filter((x) => x.text === '31103456789')).toHaveLength(1);
  });

  it('carries the confidence through to every candidate', () => {
    // The caller decides whether to offer a reading, so it needs the number
    // the recogniser actually reported rather than an assumption.
    const c = extractCandidates('31103456789 987654321', 0.42);
    expect(c.every((x) => x.confidence === 0.42)).toBe(true);
  });
});

describe('The refusal threshold', () => {
  it('sits high, deliberately', () => {
    // If this is ever lowered, it should be a decision someone argued for.
    // The asymmetry is the reason: a rejected read costs somebody eleven
    // keystrokes, a wrong one costs an overhaul recorded against the wrong
    // wagon and found months later.
    expect(MIN_CONFIDENCE).toBeGreaterThanOrEqual(0.6);
  });
});
