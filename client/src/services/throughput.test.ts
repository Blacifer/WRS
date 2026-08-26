/**
 * Sorting throughput
 * Indian Railways WRS Raipur
 *
 * This produces a number the DRM will read as a claim about the shop's
 * performance, so the tests that matter are the ones proving it refuses to
 * quote a rate it cannot support. An inflated figure on screen in front of
 * the person who knows the real one is worse than showing nothing.
 */

import { describe, it, expect } from 'vitest';
import {
  readThroughput,
  DAILY_PILE,
  MIN_SPRINGS_FOR_RATE,
  MIN_SPAN_MINUTES
} from '../../../shared/sorting/throughput.ts';

/** Builds an input spanning `minutes`, ending now. */
function span(total: number, minutes: number) {
  const end = new Date();
  const start = new Date(end.getTime() - minutes * 60000);
  return { total, firstAt: start.toISOString(), lastAt: end.toISOString() };
}

describe('Refusing to quote a rate', () => {
  it('says nothing before any springs are recorded', () => {
    const r = readThroughput({ total: 0, firstAt: null, lastAt: null });
    expect(r.canQuoteRate).toBe(false);
    expect(r.springsPerHour).toBeUndefined();
  });

  it('refuses a rate from a burst of taps over seconds', () => {
    // The dangerous case. Five springs in twenty seconds is 900 an hour, and
    // putting that on screen in front of the DRM would be indefensible.
    const r = readThroughput(span(5, 0.33));
    expect(r.canQuoteRate).toBe(false);
    expect(r.springsPerHour).toBeUndefined();
  });

  it('refuses when there are enough springs but too short a stretch', () => {
    // Enough springs alone is not enough evidence: twenty taps in one minute
    // is someone testing the screen, not working at 1,200 an hour.
    const r = readThroughput(span(20, 1));
    expect(r.canQuoteRate).toBe(false);
    expect(r.springsPerHour).toBeUndefined();
  });

  it('refuses when there is a long stretch but too few springs', () => {
    const r = readThroughput(span(3, 90));
    expect(r.canQuoteRate).toBe(false);
    expect(r.springsPerHour).toBeUndefined();
  });

  it('always explains why it is not showing a rate', () => {
    // A blank space reads as a broken screen; the inspector should know the
    // app is measuring rather than failing.
    for (const input of [
      { total: 0, firstAt: null, lastAt: null },
      span(5, 0.33),
      span(20, 1),
      span(3, 90)
    ]) {
      const r = readThroughput(input);
      expect(r.canQuoteRate).toBe(false);
      expect(typeof r.reason).toBe('string');
      expect(r.reason!.length).toBeGreaterThan(10);
    }
  });

  it('refuses rather than producing a negative or NaN rate from bad clocks', () => {
    const backwards = readThroughput({
      total: 50,
      firstAt: new Date().toISOString(),
      lastAt: new Date(Date.now() - 3600000).toISOString()
    });
    expect(backwards.canQuoteRate).toBe(false);

    const unparseable = readThroughput({ total: 50, firstAt: 'not a date', lastAt: 'also not' });
    expect(unparseable.canQuoteRate).toBe(false);
    expect(unparseable.springsPerHour).toBeUndefined();
  });
});

describe('Quoting a rate once there is enough to go on', () => {
  it('computes springs per hour across the span actually worked', () => {
    // 60 springs across 30 minutes is 120/hour. Measured first-to-last, not
    // from midnight — someone who starts after lunch is not working slowly.
    const r = readThroughput(span(60, 30));
    expect(r.canQuoteRate).toBe(true);
    expect(r.springsPerHour).toBe(120);
    expect(r.activeMinutes).toBe(30);
  });

  it('expresses the rate as hours for the day’s pile', () => {
    // The DRM's own number. At 120/hour, 900 springs is 7.5 hours.
    const r = readThroughput(span(60, 30));
    expect(r.hoursForDailyPile).toBeCloseTo(DAILY_PILE / 120, 1);
  });

  it('starts quoting exactly at the stated thresholds, not before', () => {
    // The thresholds are documented to the reader, so they should be real.
    const justUnder = readThroughput(span(MIN_SPRINGS_FOR_RATE - 1, MIN_SPAN_MINUTES + 5));
    expect(justUnder.canQuoteRate).toBe(false);

    const atThreshold = readThroughput(span(MIN_SPRINGS_FOR_RATE, MIN_SPAN_MINUTES + 5));
    expect(atThreshold.canQuoteRate).toBe(true);
  });

  it('reports elapsed time even when it will not yet quote a rate', () => {
    // "You have been going 40 minutes" is useful on its own, and showing it
    // makes clear the app is counting rather than stuck.
    const r = readThroughput(span(3, 40));
    expect(r.canQuoteRate).toBe(false);
    expect(r.activeMinutes).toBe(40);
  });

  it('never returns Infinity for the day’s pile', () => {
    for (const minutes of [3, 10, 60, 480]) {
      for (const total of [8, 100, 900, 5000]) {
        const r = readThroughput(span(total, minutes));
        if (r.hoursForDailyPile !== undefined) {
          expect(Number.isFinite(r.hoursForDailyPile)).toBe(true);
        }
      }
    }
  });
});
