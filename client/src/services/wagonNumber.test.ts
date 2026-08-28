/**
 * Reading a wagon number
 * Indian Railways WRS Raipur
 *
 * The check digit is the point of this file. A wagon number wrong by one digit
 * attaches an entire overhaul to a different vehicle and is found months
 * later, if ever — the sharpest single-keystroke risk in the system. So the
 * tests below measure how much of that risk the arithmetic actually removes,
 * rather than asserting it works on one happy example.
 */

import { describe, it, expect } from 'vitest';
import {
  readWagonNumber,
  computeCheckDigit,
  TYPE_CODES,
  RAILWAY_CODES
} from '../../../shared/wagons/wagonNumber.ts';

/** A well-formed number for the given first ten digits. */
function valid(firstTen: string): string {
  return firstTen + computeCheckDigit(firstTen);
}

describe('Taking a number apart', () => {
  it('reads type, railway, year and serial from the digits', () => {
    const n = valid('2207190123'); // BOXNHL, South Eastern, 2019
    const r = readWagonNumber(n);
    expect(r.valid).toBe(true);
    expect(r.wagonType).toBe('BOXNHL');
    expect(r.owningRailway).toBe('South Eastern Railway');
    expect(r.yearCode).toBe('19');
    expect(r.serial).toBe('0123');
  });

  it('follows the manual’s six steps, not a lookalike algorithm', () => {
    // Worked by hand from WMM 2.0 §417 for 2207190123:
    //   S1 (even positions) = 2+7+9+1+3 = 22
    //   S2 (odd  positions) = 2+0+1+0+2 = 5
    //   S4 = 3(22) + 5 = 71  → next multiple of ten is 80 → check digit 9
    expect(computeCheckDigit('2207190123')).toBe(9);
  });

  it('gives 0 when the total already lands on a multiple of ten', () => {
    // The special case the manual calls out explicitly.
    let found = false;
    for (let i = 0; i < 100 && !found; i++) {
      const ten = String(1000000000 + i);
      if (computeCheckDigit(ten) === 0) found = true;
    }
    expect(found, 'no ten-digit prefix produced a zero check digit').toBe(true);
  });

  it('does not pretend to know an unallocated type code', () => {
    // 99 is not allocated. Better to say nothing than to invent a wagon.
    const r = readWagonNumber(valid('9901190123'));
    expect(r.wagonType).toBeUndefined();
    expect(r.valid).toBe(true); // the number is still well-formed
  });
});

describe('Catching a wrong number', () => {
  const SAMPLES = ['2207190123', '1001200456', '7202150789', '5706180012', '8607170345'];

  it('catches every single-digit error', () => {
    /*
     * The common failure: one digit misread from a stencil, or one key
     * mistyped. If the check digit did not catch these it would be
     * decoration.
     */
    let tested = 0;
    for (const base of SAMPLES) {
      const good = valid(base);
      for (let pos = 0; pos < 11; pos++) {
        for (let d = 0; d <= 9; d++) {
          if (Number(good[pos]) === d) continue;
          const wrong = good.slice(0, pos) + d + good.slice(pos + 1);
          tested++;
          expect(
            readWagonNumber(wrong).valid,
            `a single wrong digit at position ${pos + 1} of ${good} was not caught`
          ).toBe(false);
        }
      }
    }
    expect(tested).toBeGreaterThan(400);
  });

  it('catches most transpositions, and the tests say how many', () => {
    /*
     * Adjacent transposition — 3 and 4 typed as 4 and 3. The 3:1 position
     * weighting catches these unless the two digits differ by exactly five,
     * which is a known and accepted limitation of this family of check digit,
     * not a defect in the implementation.
     *
     * Measured rather than asserted, because "most" is only a useful claim
     * with a number attached.
     */
    let total = 0;
    let caught = 0;
    for (const base of SAMPLES) {
      const good = valid(base);
      for (let i = 0; i < 10; i++) {
        if (good[i] === good[i + 1]) continue;
        const swapped = good.slice(0, i) + good[i + 1] + good[i] + good.slice(i + 2);
        total++;
        if (!readWagonNumber(swapped).valid) caught++;
      }
    }
    const rate = caught / total;
    expect(total).toBeGreaterThan(30);
    // Comfortably above the ~89% this weighting is expected to achieve.
    expect(rate).toBeGreaterThan(0.8);
  });

  it('explains the problem in words an inspector can act on', () => {
    const good = valid('2207190123');
    const wrong = good.slice(0, 4) + '8' + good.slice(5);
    const r = readWagonNumber(wrong);
    expect(r.valid).toBe(false);
    expect(r.problem).toMatch(/check digit/i);
    expect(r.problem, 'must tell them what to do').toMatch(/check it against the wagon/i);
  });

  it('handles a half-typed number without throwing', () => {
    // The realistic caller is a screen with a number being typed into it.
    for (const partial of ['', '2', '22071', '220719012', '220719012345678']) {
      const r = readWagonNumber(partial);
      expect(r.valid).toBe(false);
      expect(r.problem).toMatch(/eleven digits/);
    }
  });

  it('ignores spacing, since stencils are spaced in groups', () => {
    const good = valid('2207190123');
    const spaced = good.slice(0, 4) + ' ' + good.slice(4, 8) + '  ' + good.slice(8);
    expect(readWagonNumber(spaced).valid).toBe(true);
  });
});

describe('The code tables', () => {
  it('cover the types Raipur actually sees', () => {
    const designations = Object.values(TYPE_CODES);
    for (const seen of ['BOXN', 'BOXNHL', 'BOST', 'BOBRN', 'BOBYN', 'BFNS', 'BVZI', 'BTAP']) {
      expect(designations, `${seen} has no type code`).toContain(seen);
    }
  });

  it('has no duplicate codes', () => {
    const codes = Object.keys(TYPE_CODES);
    expect(new Set(codes).size).toBe(codes.length);
    const rly = Object.keys(RAILWAY_CODES);
    expect(new Set(rly).size).toBe(rly.length);
  });
});
