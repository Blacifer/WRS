/**
 * Speech retry policy
 * Indian Railways WRS Raipur
 *
 * This exists because of a field report: roughly 150 "[Web Speech Error]
 * network" lines in a couple of seconds, from a tablet, in a tight
 * start-error-end-start loop.
 *
 * The test that matters is the one that would have caught it — that a
 * persistently failing recogniser stops rather than spinning.
 */

import { describe, it, expect } from 'vitest';
import {
  decideRetry,
  isRecoverable,
  MAX_CONSECUTIVE_ERRORS,
  HEALTHY_RESTART_MS
} from '../../../shared/voice/retryPolicy.ts';

describe('The runaway loop', () => {
  it('stops after a bounded number of failures', () => {
    /*
     * The actual bug. Simulated as the browser ran it: every attempt fails
     * with 'network', and the count carries forward. Without a ceiling this
     * never terminates.
     */
    let errors = 0;
    let attempts = 0;

    for (let i = 0; i < 1000; i++) {
      const d = decideRetry(errors, 'network', true);
      if (!d.shouldRetry) break;
      if (d.countsAsFailure) errors++;
      attempts++;
    }

    expect(attempts).toBeLessThan(MAX_CONSECUTIVE_ERRORS + 1);
    expect(attempts, 'it must try at least once before giving up').toBeGreaterThan(0);
  });

  it('tells the inspector what happened, and that nothing was lost', () => {
    const d = decideRetry(MAX_CONSECUTIVE_ERRORS - 1, 'network', true);
    expect(d.shouldRetry).toBe(false);
    expect(d.giveUpMessage).toMatch(/cannot reach its service/i);
    // The reassurance matters as much as the diagnosis: an inspector who
    // thinks their work stopped being recorded will start writing on paper.
    expect(d.giveUpMessage).toMatch(/nothing is lost/i);
  });

  it('backs off instead of restarting instantly', () => {
    // Each failure should wait longer than the last.
    const delays = [0, 1, 2, 3].map((n) => decideRetry(n, 'network', true).delayMs);
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i], `delay ${i} should exceed delay ${i - 1}`).toBeGreaterThan(delays[i - 1]);
    }
  });

  it('caps the wait so it never looks broken', () => {
    // Unbounded doubling would eventually schedule a restart minutes out,
    // which to the person holding the tablet is indistinguishable from dead.
    for (let n = 0; n < MAX_CONSECUTIVE_ERRORS; n++) {
      expect(decideRetry(n, 'network', true).delayMs).toBeLessThanOrEqual(8000);
    }
  });
});

describe('Not every error is a failure', () => {
  it('does not count silence against the ceiling', () => {
    /*
     * A quiet bay produces 'no-speech' indefinitely and is completely normal.
     * Counting it would make a working microphone in a quiet moment
     * indistinguishable from a broken one, and voice would switch itself off
     * mid-shift.
     */
    let errors = 0;
    for (let i = 0; i < 200; i++) {
      const d = decideRetry(errors, 'no-speech', true);
      expect(d.shouldRetry).toBe(true);
      if (d.countsAsFailure) errors++;
    }
    expect(errors).toBe(0);
  });

  it('restarts quickly when healthy, so listening feels continuous', () => {
    expect(decideRetry(0, 'no-speech', true).delayMs).toBe(HEALTHY_RESTART_MS);
    expect(decideRetry(0, null, true).delayMs).toBe(HEALTHY_RESTART_MS);
  });

  it('gives up at once on a blocked microphone', () => {
    // Retrying cannot grant permission — only the person can.
    for (const err of ['not-allowed', 'service-not-allowed']) {
      const d = decideRetry(0, err, true);
      expect(d.shouldRetry, err).toBe(false);
      expect(d.giveUpMessage).toMatch(/blocked/i);
    }
    expect(isRecoverable('not-allowed')).toBe(false);
    expect(isRecoverable('network')).toBe(true);
  });
});

describe('Respecting the inspector', () => {
  it('never restarts once they have turned it off', () => {
    // Whatever the error, "stillWanted false" wins. A component that kept
    // listening after the button was released would be holding a microphone
    // nobody asked it to hold.
    for (const err of ['network', 'no-speech', 'not-allowed', null]) {
      const d = decideRetry(0, err, false);
      expect(d.shouldRetry, String(err)).toBe(false);
      expect(d.delayMs).toBe(0);
    }
  });
});
