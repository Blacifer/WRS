/**
 * Client-side verdicts
 * Indian Railways WRS Raipur
 *
 * This is the code that decides, on the device, whether a component passes or
 * is condemned. It runs locally so the app works without a network, which is
 * the right call for a workshop — and it means the client is making a safety
 * judgement rather than displaying one the server made.
 *
 * Two properties matter more than any individual verdict:
 *
 *   1. The client must agree with the server. Two implementations of the same
 *      RDSO table that disagree is worse than one that is wrong, because the
 *      record and the screen would say different things.
 *   2. A component with no approved limit must produce no verdict here either.
 *      The server was taught to refuse; a client that quietly judged anyway
 *      would put an unbacked pass/fail in front of the inspector.
 */

import { describe, it, expect } from 'vitest';
import { computeComponentVerdict, resolveComponentTarget } from './classification.ts';
import { classifySpring } from '../../../shared/classification/engine.ts';
import { RDSO_TABLES } from '../../../shared/classification/tables.ts';

describe('The client agrees with the server on every band', () => {
  it('matches the shared engine for every band of every table', () => {
    // Both sides read the same shared tables, and this asserts they stay that
    // way — a divergence would show one verdict on screen and record another.
    for (const table of Object.values(RDSO_TABLES) as any[]) {
      const target = `${table.position}_SPRING` as any;
      if (!['OUTER_SPRING', 'INNER_SPRING', 'SNUBBER_SPRING'].includes(target)) continue;

      for (const band of table.bands) {
        const midpoint = Number(((band.minHeight + band.maxHeight) / 2).toFixed(1));

        const client = computeComponentVerdict(target, midpoint, table.bogieType, table.condition);
        const server = classifySpring({
          bogieType: table.bogieType,
          condition: table.condition,
          position: table.position,
          measuredHeight: midpoint
        });

        expect(client.status, `${table.tableNumber} ${band.band} status`).toBe(server.status);
        expect(client.band, `${table.tableNumber} ${band.band} band`).toBe(server.band);
      }
    }
  });

  it('condemns below the condemning limit, on both sides', () => {
    for (const table of Object.values(RDSO_TABLES) as any[]) {
      const target = `${table.position}_SPRING` as any;
      if (!['OUTER_SPRING', 'INNER_SPRING', 'SNUBBER_SPRING'].includes(target)) continue;

      const tooShort = table.condemningMinHeight - 1;
      const client = computeComponentVerdict(target, tooShort, table.bogieType, table.condition);
      expect(client.status, `${table.tableNumber} at ${tooShort}mm`).toBe('CONDEMNED');
    }
  });
});

describe('Routing a checklist item to a measurement', () => {
  it('sends each spring position to its own table', () => {
    expect(resolveComponentTarget('Outer Spring (Bogie 1)', 'SPRINGS')).toBe('OUTER_SPRING');
    expect(resolveComponentTarget('Inner Spring (Bogie 2)', 'SPRINGS')).toBe('INNER_SPRING');
    expect(resolveComponentTarget('Snubber Spring (Bogie 1)', 'SPRINGS')).toBe('SNUBBER_SPRING');
  });

  it('separates the two friction wedge surfaces', () => {
    // WMM 2.0 §309D gives different wear limits for the vertical face and the
    // slope. One shared target would judge both against one number.
    expect(resolveComponentTarget('Wedge Vertical Face & Spigot Fit', 'FRICTION_WEDGES'))
      .toBe('FRICTION_WEDGE_VERTICAL');
    expect(resolveComponentTarget('Wedge Main Slope Surface', 'FRICTION_WEDGES'))
      .toBe('FRICTION_WEDGE_SLOPE');
  });

  it('offers no caliper where no limit is published', () => {
    // The CTRB end-cap gap has no figure in WMM 2.0 or G-81. The server
    // refuses to judge it; the client must not offer a measurement that
    // implies otherwise.
    for (const part of [
      'CTRB Cartridge Bearing Rotation',
      'CTRB End Cap Screws (100% Replace — POH)',
      'Axle Box Adapter Crown Wear'
    ]) {
      expect(resolveComponentTarget(part, 'BEARINGS'), part).toBeNull();
    }
  });

  it('offers no caliper for a physical gauge', () => {
    // A GO/NO-GO gap gauge is a contact test. Dressing it as a digital reading
    // would put a decimal on something nobody measured.
    expect(resolveComponentTarget('Draft Gear Spring Seat Gap Gauge (Max 0.38mm)', 'COUPLERS_DRAFT_GEAR'))
      .toBeNull();
    expect(resolveComponentTarget('Draft Gear Housing Box Profile Gauge (Gauge No. 27200)', 'COUPLERS_DRAFT_GEAR'))
      .toBeNull();
  });

  it('does not let a draft gear spring fall through to a spring table', () => {
    // "Spring Seat Gap Gauge" contains the word spring. Falling through to the
    // generic spring branch would judge a 0.38 mm gauge against a 260 mm free
    // height and condemn it with an RDSO citation.
    const t = resolveComponentTarget('Draft Gear Outer Coil Spring (Free Height Min 342mm)', 'COUPLERS_DRAFT_GEAR');
    expect(t).toBe('DG_OUTER_COIL_SPRING');
    expect(t).not.toBe('OUTER_SPRING');
  });

  it('still routes the components that do have published limits', () => {
    // The opposite failure: hiding every caliper would quietly remove working
    // checks rather than misleading ones.
    expect(resolveComponentTarget('Wheel Flange Thickness', 'WHEELS_AXLES')).toBe('WHEEL_FLANGE');
    expect(resolveComponentTarget('Brake Block Thickness', 'BRAKE_SYSTEM')).toBe('BRAKE_BLOCK');
  });
});
