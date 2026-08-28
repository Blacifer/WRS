/**
 * Tolerance Verification Status Tests
 * Indian Railways WRS Raipur
 *
 * "We have no sourced figure for this component" used to live in a code
 * comment plus a hardcoded exclusion in the wagon detail page. Knowledge held
 * that way survives exactly as long as the next person who reads the comment —
 * and it had already failed once: five bearings checklist items were routed to
 * a caliper backed by numbers nobody could cite.
 *
 * It is a field on the spec now, so the registry enforces the rule instead of
 * the UI remembering it.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RDSO_TOLERANCE_SPECS } from '../src/routes/cv.ts';
import {
  COMPONENT_TOLERANCE_SPECS,
  resolveComponentTarget
} from '../../client/src/services/classification.ts';

describe('Tolerance Verification Status', () => {
  it('TC-VER-01: every spec declares whether its limit is approved', () => {
    // An absent field would silently read as "not pending", which is the
    // permissive direction — the one that lets an unsourced limit judge a part.
    for (const [key, spec] of Object.entries(RDSO_TOLERANCE_SPECS) as [string, any][]) {
      assert.ok(
        spec.verificationStatus === 'VERIFIED' || spec.verificationStatus === 'PENDING_SIGNOFF',
        `${key} does not declare a verificationStatus`
      );
    }
  });

  it('TC-VER-02: a spec awaiting sign-off says why, and what would resolve it', () => {
    for (const [key, spec] of Object.entries(RDSO_TOLERANCE_SPECS) as [string, any][]) {
      if (spec.verificationStatus !== 'PENDING_SIGNOFF') continue;
      assert.ok(spec.verificationNote, `${key} is pending but gives no reason`);
      assert.match(spec.verificationNote, /sign-off/i);
    }
  });

  it('TC-VER-03: the CTRB end cap is the pending one, and is honest about it', () => {
    // The manual has a torque and a must-change-screw procedure for this and
    // no gap figure anywhere. That is a missing data point, not something to
    // be inferred.
    const spec = (RDSO_TOLERANCE_SPECS as any).CTRB_END_CAP;
    assert.strictEqual(spec.verificationStatus, 'PENDING_SIGNOFF');
    assert.match(spec.verificationNote, /no numeric end-cap gap limit/i);
  });

  it('TC-VER-04: nothing else is pending — the flag is not being used to duck sourcing', () => {
    const pending = Object.entries(RDSO_TOLERANCE_SPECS)
      .filter(([, s]: [string, any]) => s.verificationStatus === 'PENDING_SIGNOFF')
      .map(([k]) => k);
    assert.deepStrictEqual(pending, ['CTRB_END_CAP']);
  });

  // -------------------------------------------------------------------------
  // The client registry has to agree, or the two drift apart
  // -------------------------------------------------------------------------
  it('TC-VER-05: client and server agree on what is pending', () => {
    for (const [key, serverSpec] of Object.entries(RDSO_TOLERANCE_SPECS) as [string, any][]) {
      const clientSpec = (COMPONENT_TOLERANCE_SPECS as any)[key];
      if (!clientSpec) continue; // springs are classified by band, not by this registry
      const serverPending = serverSpec.verificationStatus === 'PENDING_SIGNOFF';
      const clientPending = clientSpec.verificationStatus === 'PENDING_SIGNOFF';
      assert.strictEqual(
        clientPending,
        serverPending,
        `${key}: client and server disagree on whether the limit is approved`
      );
    }
  });

  // -------------------------------------------------------------------------
  // What the inspector actually sees
  // -------------------------------------------------------------------------
  it('TC-VER-06: no caliper is offered for a component with no approved limit', () => {
    for (const partName of [
      'CTRB Cartridge Bearing Rotation',
      'CTRB End Cap Screws (100% Replace — POH)',
      'CTRB Grease Seal (100% Replace — POH)',
      'CTRB End Cap — visual inspection (no dimensional limit published)'
    ]) {
      assert.strictEqual(
        resolveComponentTarget(partName, 'BEARINGS'),
        null,
        `${partName} must not offer a caliper reading`
      );
    }
  });

  it('TC-VER-06b: the adapter DOES offer one, now that §309B was found', () => {
    /*
     * "Axle Box Adapter Crown Wear" was in the list above until 27 August
     * 2026, correctly — no figure had been found for it, so no caliper was
     * offered.
     *
     * It was in WMM 2.0 all along, under §309B WEAR LIMITS as "Adapter Crown
     * lugs", 4.0 mm. The search had been for the words the app used rather
     * than the words the manual uses. Absence of a search hit is not absence
     * of a limit, and this assertion flipping is the record of that.
     */
    assert.strictEqual(
      resolveComponentTarget('Axle Box Adapter Crown Lug Wear (Max 4.0mm)', 'BEARINGS'),
      'ADAPTER_CROWN_LUGS',
      'the adapter now has a sourced limit and must offer its caliper'
    );
  });

  it('TC-VER-07: components that do have a sourced limit still get their caliper', () => {
    // The other half of the fix: hiding the button everywhere would be just as
    // wrong, and would quietly remove working checks.
    const expected: [string, string, string][] = [
      ['Outer Spring (Bogie 1)', 'SPRINGS', 'OUTER_SPRING'],
      ['Wedge Main Slope Surface', 'FRICTION_WEDGES', 'FRICTION_WEDGE_SLOPE'],
      ['Wedge Vertical Face & Spigot Fit', 'FRICTION_WEDGES', 'FRICTION_WEDGE_VERTICAL'],
      ['Wheel Flange Thickness', 'WHEELS_AXLES', 'WHEEL_FLANGE'],
      ['Brake Block Thickness', 'BRAKE_SYSTEM', 'BRAKE_BLOCK'],
      ['Draft Gear Outer Coil Spring (Free Height Min 342mm)', 'COUPLERS_DRAFT_GEAR', 'DG_OUTER_COIL_SPRING']
    ];
    for (const [partName, category, target] of expected) {
      assert.strictEqual(resolveComponentTarget(partName, category), target, partName);
    }
  });

  it('TC-VER-08: physical GO/NO-GO gauges still get no caliper', () => {
    // A contact gauge is not a digital reading, whatever its tolerance says.
    assert.strictEqual(
      resolveComponentTarget('Draft Gear Spring Seat Gap Gauge (Max 0.38mm)', 'COUPLERS_DRAFT_GEAR'),
      null
    );
    assert.strictEqual(
      resolveComponentTarget('Draft Gear Housing Box Profile Gauge (Gauge No. 27200)', 'COUPLERS_DRAFT_GEAR'),
      null
    );
  });
});
