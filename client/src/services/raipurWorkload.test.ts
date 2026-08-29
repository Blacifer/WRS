/**
 * What the shop overhauls, against what the app can actually serve
 * Indian Railways WRS Raipur
 *
 * This file exists because of one wrong entry that survived for months.
 *
 * The shop's out-turn return has a single line reading "BRN/BFKN/BFNS" with
 * 610 wagons against it — the second busiest line at Raipur. It was recorded
 * as one unknown designation and marked wholly unconfigured. Two of those
 * three are in fact fully configured, bandable, and offered in the wagon
 * picker; only BFKN is missing. So 610 wagons a year were described as beyond
 * the app when most of them already worked, and the figure was repeated as
 * fact because nothing imports this module and nothing could contradict it.
 *
 * The tests that matter here are the ones that check this file against
 * WAGON_SPRING_CONFIGS rather than against itself.
 */

import { describe, it, expect } from 'vitest';
import {
  RAIPUR_WORKLOAD_2025_26,
  RAIPUR_ANNUAL_TOTAL,
  configuredCoverage,
  unconfiguredDesignations
} from '../../../shared/knowledge/raipurWorkload.ts';
import { getWagonSpringConfig } from '../../../shared/classification/wagonTypes.ts';
import { isNonBandedBogie } from '../../../shared/classification/condemningLimits.ts';

interface Claim {
  designation: string;
  configured: boolean;
  classifiable: boolean;
  banded: boolean;
}

/** Every designation this file makes a claim about, group members included. */
function allClaims(): Claim[] {
  const out: Claim[] = [];
  for (const w of RAIPUR_WORKLOAD_2025_26) {
    if (w.members?.length) {
      for (const m of w.members) {
        out.push({
          designation: m.designation,
          configured: m.configured,
          classifiable: m.classifiable,
          banded: m.banded
        });
      }
      continue;
    }
    out.push({
      designation: w.designation,
      configured: w.configured,
      classifiable: w.classifiable,
      banded: !!w.banded
    });
  }
  return out;
}

describe('Claims about coverage must match what the app holds', () => {
  it('every designation claimed configured really has a spring config', () => {
    for (const c of allClaims()) {
      if (!c.configured) continue;
      expect(
        getWagonSpringConfig(c.designation),
        `${c.designation} is claimed configured but has no entry in WAGON_SPRING_CONFIGS`
      ).toBeTruthy();
    }
  });

  it('every designation claimed unserved really is unserved', () => {
    /*
     * The direction that was wrong. BRN and BFNS were both claimed
     * unconfigured while sitting in WAGON_SPRING_CONFIGS the whole time — an
     * error that only ever understated the app, which is why nobody noticed.
     */
    for (const c of allClaims()) {
      if (c.configured) continue;
      expect(
        getWagonSpringConfig(c.designation),
        `${c.designation} is claimed unserved but the app holds a config for it`
      ).toBeFalsy();
    }
  });

  it('never claims a verdict it cannot produce', () => {
    /*
     * The dangerous direction, and the one this caught: BOXNHAM was marked
     * classifiable and bandable while riding an IRF 108 bogie, for which no
     * G-95 band table and no §309C condemning limit is held. Understating
     * coverage is embarrassing; overstating it means promising the shop a
     * verdict the app cannot honestly give.
     */
    for (const c of allClaims()) {
      if (!c.classifiable && !c.banded) continue;
      const config = getWagonSpringConfig(c.designation);
      const judgeable = !!config?.bogieType || isNonBandedBogie(String(config?.bogieDescription || '').split(' ')[0]);
      expect(judgeable, `${c.designation} is claimed judgeable`).toBe(true);
      if (c.banded) {
        expect(config?.bogieType, `${c.designation} is claimed bandable, which needs a G-95 table`).toBeTruthy();
      }
    }
  });

  it('names BFKN as the gap, not the whole line it is reported on', () => {
    const unserved = unconfiguredDesignations().map((d) => d.designation);
    expect(unserved).toContain('BFKN');
    expect(unserved, 'BRN is configured and must not be listed as a gap').not.toContain('BRN');
    expect(unserved, 'BFNS is configured and must not be listed as a gap').not.toContain('BFNS');
    expect(unserved, 'the combined label is not a wagon').not.toContain('BRN/BFKN/BFNS');
  });
});

describe('Coverage over a line the shop does not split', () => {
  it('reports a range rather than inventing a split', () => {
    const c = configuredCoverage();
    expect(c.banded.uncertain, 'the BRN/BFKN/BFNS split is unknown').toBe(true);
    expect(c.banded.high).toBeGreaterThan(c.banded.low);
    expect(c.unknownSplit).toBe(610);
  });

  it('bounds the mixed line correctly at both ends', () => {
    // Low assumes all 610 are the uncovered type, high assumes none are.
    const c = configuredCoverage();
    expect(c.banded.high - c.banded.low).toBe(610);
  });

  it('keeps every bound inside the year it is drawn from', () => {
    const c = configuredCoverage();
    for (const band of [c.counted, c.classified, c.banded]) {
      expect(band.low).toBeGreaterThanOrEqual(0);
      expect(band.low).toBeLessThanOrEqual(band.high);
      expect(band.high).toBeLessThanOrEqual(c.total);
    }
    // Banding is a stronger claim than counting and can never exceed it.
    expect(c.banded.low).toBeLessThanOrEqual(c.counted.low);
    expect(c.banded.high).toBeLessThanOrEqual(c.counted.high);
  });

  it('adds up to the out-turn the shop actually reported', () => {
    const summed = RAIPUR_WORKLOAD_2025_26.reduce((s, w) => s + w.total, 0);
    expect(summed).toBe(RAIPUR_ANNUAL_TOTAL);
    for (const w of RAIPUR_WORKLOAD_2025_26) {
      expect(w.poh + w.npoh + w.roh, `${w.designation} line total`).toBe(w.total);
    }
  });
});
