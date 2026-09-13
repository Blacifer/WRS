/**
 * When the camera may decide without asking — every condition, and the asymmetry
 * Indian Railways WRS Raipur
 *
 * This rule is the only thing in the system that removes a tap. Each test
 * here is one way it must refuse to, and the last is the one way it may.
 */

import { describe, it, expect } from 'vitest';
import {
  decideAutoCommit,
  isFault,
  AUTO_CONFIDENCE_FLOOR,
  AUTO_AGREEMENT_MIN_SAMPLE,
  type AutoCommitInput,
  type HeadReading
} from '../../shared/vision/autoCommit.ts';

const earned = (head: HeadReading['head'], label: string, confidence = 0.95): HeadReading => ({
  head, label, confidence, verdict: 'ASSIST'
});
const live = (rate = 0.98, sampled = 100) => ({ rate, sampled });
const allLive = { CATEGORY: live(), SURFACE: live(), DAMAGE: live(), PART_ID: live() };

const cleanSpring = (): AutoCommitInput => ({
  domain: 'SPRING',
  heads: [earned('CATEGORY', 'OUTER'), earned('SURFACE', 'CLEAN'), earned('DAMAGE', 'NONE')],
  measurementPassed: true,
  liveAgreement: allLive
});

describe('the one way it may decide', () => {
  it('TC-AC-01 auto-passes a spring that measured in band, looks clean, on heads that have earned it', () => {
    const d = decideAutoCommit(cleanSpring());
    expect(d.mode).toBe('AUTO');
    expect(d.outcome).toBe('PASS');
    expect(d.stoppedBy).toBeNull();
  });

  it('TC-AC-02 auto-passes a wagon part the same way, with no measurement to require', () => {
    const d = decideAutoCommit({
      domain: 'WAGON_PART',
      heads: [earned('PART_ID', 'BRAKE_BEAM'), earned('SURFACE', 'LIGHT_RUST'), earned('DAMAGE', 'NONE')],
      measurementPassed: null,
      liveAgreement: allLive
    });
    expect(d.mode).toBe('AUTO');
  });
});

describe('the asymmetry — it may never condemn on its own', () => {
  it('TC-AC-03 a fault seen is always a person\'s call, however sure the camera is', () => {
    const i = cleanSpring();
    i.heads[2] = earned('DAMAGE', 'CRACK', 1.0);
    const d = decideAutoCommit(i);
    expect(d.mode).toBe('ASK');
    expect(d.outcome).toBe('CONDEMN');
    expect(d.stoppedBy).toBe('FAULT_SEEN');
    expect(d.reason).toMatch(/person's decision/i);
  });

  it('TC-AC-04 heavy rust is a fault; light rust on a used spring is not', () => {
    expect(isFault('SURFACE', 'HEAVY_RUST')).toBe(true);
    expect(isFault('SURFACE', 'SCALING')).toBe(true);
    expect(isFault('SURFACE', 'LIGHT_RUST')).toBe(false);
    expect(isFault('SURFACE', 'CLEAN')).toBe(false);
    expect(isFault('DAMAGE', 'NONE')).toBe(false);
    expect(isFault('DAMAGE', 'DEFORMATION')).toBe(true);
  });

  it('TC-AC-05 a label the shop taught that is not on the passing list is treated as a fault', () => {
    // Refusing to auto-pass an unknown label is the safe direction.
    expect(isFault('SURFACE', 'PITTED')).toBe(true);
    expect(isFault('DAMAGE', 'HAIRLINE')).toBe(true);
  });

  it('TC-AC-06 naming heads never count as faults', () => {
    expect(isFault('CATEGORY', 'SNUBBER')).toBe(false);
    expect(isFault('PART_ID', 'ANYTHING')).toBe(false);
  });

  it('TC-AC-07 a measured height out of band is a condemnation, and a person\'s call', () => {
    const i = cleanSpring();
    i.measurementPassed = false;
    const d = decideAutoCommit(i);
    expect(d.mode).toBe('ASK');
    expect(d.outcome).toBe('CONDEMN');
    expect(d.stoppedBy).toBe('MEASUREMENT_FAILED');
  });
});

describe('the four ways it must refuse to pass', () => {
  it('TC-AC-08 a spring with no measured height is never auto-passed — the band is not the camera\'s', () => {
    const i = cleanSpring();
    i.measurementPassed = null;
    const d = decideAutoCommit(i);
    expect(d.mode).toBe('ASK');
    expect(d.stoppedBy).toBe('NO_MEASUREMENT');
    expect(d.reason).toMatch(/never from the camera/i);
  });

  it('TC-AC-09 a head that has not earned 95% on real photographs stops it', () => {
    for (const verdict of ['INSUFFICIENT', 'FLAG_ONLY', 'STOP'] as const) {
      const i = cleanSpring();
      i.heads[1] = { ...earned('SURFACE', 'CLEAN'), verdict };
      const d = decideAutoCommit(i);
      expect(d.mode).toBe('ASK');
      expect(d.stoppedBy).toBe('NOT_EARNED');
    }
  });

  it('TC-AC-10 a fresh installation cannot auto-commit anything', () => {
    // Every head is INSUFFICIENT until taught with real parts and scored.
    const i = cleanSpring();
    i.heads = i.heads.map((h) => ({ ...h, verdict: 'INSUFFICIENT' as const }));
    expect(decideAutoCommit(i).mode).toBe('ASK');
  });

  it('TC-AC-11 an unsure frame on an earned head still asks', () => {
    const i = cleanSpring();
    i.heads[0] = earned('CATEGORY', 'OUTER', AUTO_CONFIDENCE_FLOOR - 0.01);
    const d = decideAutoCommit(i);
    expect(d.mode).toBe('ASK');
    expect(d.stoppedBy).toBe('NOT_CONFIDENT');
  });

  it('TC-AC-12 four of five nearest agreeing is the floor', () => {
    const i = cleanSpring();
    i.heads[0] = earned('CATEGORY', 'OUTER', 0.8);
    expect(decideAutoCommit(i).mode).toBe('AUTO');
  });

  it('TC-AC-13 when inspectors have stopped agreeing with a head, it switches itself off', () => {
    const i = cleanSpring();
    i.liveAgreement = { ...allLive, SURFACE: live(0.9, 100) };
    const d = decideAutoCommit(i);
    expect(d.mode).toBe('ASK');
    expect(d.stoppedBy).toBe('AGREEMENT_FELL');
    expect(d.reason).toMatch(/switched off/i);
  });

  it('TC-AC-14 too few recent proposals to know is treated as not knowing', () => {
    const i = cleanSpring();
    i.liveAgreement = { ...allLive, DAMAGE: live(1.0, AUTO_AGREEMENT_MIN_SAMPLE - 1) };
    expect(decideAutoCommit(i).stoppedBy).toBe('AGREEMENT_FELL');
    i.liveAgreement = null;
    expect(decideAutoCommit(i).stoppedBy).toBe('AGREEMENT_FELL');
  });

  it('TC-AC-15 a head that declined to answer stops it', () => {
    const i = cleanSpring();
    i.heads[2] = { ...earned('DAMAGE', 'NONE'), label: null };
    expect(decideAutoCommit(i).stoppedBy).toBe('NO_ANSWER');
  });

  it('TC-AC-16 the fault is reported before anything else, so the person sees what matters', () => {
    // Unearned AND a crack: the crack is the reason, not the statistics.
    const i = cleanSpring();
    i.heads = i.heads.map((h) => ({ ...h, verdict: 'INSUFFICIENT' as const }));
    i.heads[2] = { ...i.heads[2], label: 'CRACK' };
    expect(decideAutoCommit(i).stoppedBy).toBe('FAULT_SEEN');
  });
});

describe('the reason a person reads is the one that matters', () => {
  it('TC-AC-17 an unrecognised spring says so, not "no measured height"', () => {
    // When the camera cannot name the spring there is no band lookup at all,
    // so the measurement is null for that reason — and the person must be
    // told the camera does not know it, which is what they can act on.
    const i = cleanSpring();
    i.heads[0] = { ...earned('CATEGORY', 'OUTER'), label: null };
    i.measurementPassed = null;
    const d = decideAutoCommit(i);
    expect(d.stoppedBy).toBe('NO_ANSWER');
    expect(d.reason).toMatch(/did not recognise/i);
    expect(d.reason).not.toMatch(/measured height/i);
  });
});

describe('two sources must agree', () => {
  it('TC-AC-18 the camera naming a different spring than the bench expects always asks', () => {
    // Caught by a drive: an inner spring named "outer" at high confidence on
    // heads that had all earned 95%, and committed. A wrong category selects
    // the wrong band table — the one wrong auto-commit that could pass a bad
    // spring. The bench's own setting is the second source.
    const i = cleanSpring();
    i.expected = { CATEGORY: 'INNER' };
    const d = decideAutoCommit(i);
    expect(d.mode).toBe('ASK');
    expect(d.stoppedBy).toBe('DISAGREES_WITH_BENCH');
    expect(d.reason).toMatch(/camera thinks this is outer/i);
    expect(d.reason).toMatch(/bench is set to inner/i);
  });

  it('TC-AC-19 agreement with the bench lets an earned head through as before', () => {
    const i = cleanSpring();
    i.expected = { CATEGORY: 'OUTER' };
    expect(decideAutoCommit(i).mode).toBe('AUTO');
  });

  it('TC-AC-20 a wagon part named differently from the item being judged asks', () => {
    const d = decideAutoCommit({
      domain: 'WAGON_PART',
      heads: [earned('PART_ID', 'SIDE_BEARER'), earned('SURFACE', 'CLEAN'), earned('DAMAGE', 'NONE')],
      measurementPassed: null,
      liveAgreement: allLive,
      expected: { PART_ID: 'BRAKE_BEAM' }
    });
    expect(d.stoppedBy).toBe('DISAGREES_WITH_BENCH');
  });
});
