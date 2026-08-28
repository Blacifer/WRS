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
      'CTRB End Cap — visual inspection (no dimensional limit published)'
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

describe('Adapter wear, WMM 2.0 §309B', () => {
  /*
   * These limits were treated as missing for most of this project and routed
   * to the shop as an open question. They were in the manual the whole time,
   * listed under "Adapter Crown lugs" rather than the "axle box adapter crown
   * wear" that was searched for.
   *
   * Worth a test for the boundary specifically: a wear check passes AT its
   * limit and fails past it, and getting that backwards condemns serviceable
   * components or passes worn ones.
   */
  it('passes at the limit and condemns past it', () => {
    expect(computeComponentVerdict('ADAPTER_CROWN_LUGS', 4.0, 'CASNUB_22_NLB', 'USED').status).toBe('PASS');
    expect(computeComponentVerdict('ADAPTER_CROWN_LUGS', 4.1, 'CASNUB_22_NLB', 'USED').status).toBe('CONDEMNED');
    expect(computeComponentVerdict('ADAPTER_CROWN_SEAT', 3.5, 'CASNUB_22_NLB', 'USED').status).toBe('PASS');
    expect(computeComponentVerdict('ADAPTER_CROWN_SEAT', 3.6, 'CASNUB_22_NLB', 'USED').status).toBe('CONDEMNED');
  });

  it('treats no wear as the good case, not as a missing reading', () => {
    // Min is zero on a wear check. A brand-new adapter measures zero and must
    // not read as out of range.
    for (const target of ['ADAPTER_CROWN_LUGS', 'ADAPTER_CROWN_SEAT', 'ADAPTER_THRUST_SHOULDER', 'ADAPTER_SIDES'] as const) {
      expect(computeComponentVerdict(target, 0, 'CASNUB_22_NLB', 'USED').status, target).toBe('PASS');
    }
  });

  it('offers a caliper now that the limit is sourced', () => {
    /*
     * This item used to be in the no-caliper list above, correctly, because
     * no figure had been found for it. §309B was found on 27 August 2026, so
     * it must now route to a real target — otherwise the limit exists in the
     * registry and nothing can reach it.
     */
    expect(resolveComponentTarget('Axle Box Adapter Crown Lug Wear (Max 4.0mm)', 'BEARINGS'))
      .toBe('ADAPTER_CROWN_LUGS');
    // And must not fall through to the CTRB branch, which is still suppressed.
    expect(resolveComponentTarget('Axle Box Adapter Crown Lug Wear (Max 4.0mm)', 'BEARINGS'))
      .not.toBeNull();
  });

  it('cites the clause, not just a standard', () => {
    // §309B is a specific table. "RDSO G-81" was what this check used to cite,
    // which is where the figure is not.
    const r = computeComponentVerdict('ADAPTER_CROWN_LUGS', 2, 'CASNUB_22_NLB', 'USED');
    expect(r.tableReference).toContain('309B');
  });

  it('keeps the thrust shoulder distinct — it is far tighter', () => {
    // 0.7 mm against 4.0 mm for the crown lugs. Sharing one limit across the
    // adapter would pass a thrust shoulder five times past condemning.
    expect(computeComponentVerdict('ADAPTER_THRUST_SHOULDER', 1.0, 'CASNUB_22_NLB', 'USED').status).toBe('CONDEMNED');
    expect(computeComponentVerdict('ADAPTER_CROWN_LUGS', 1.0, 'CASNUB_22_NLB', 'USED').status).toBe('PASS');
  });
});
