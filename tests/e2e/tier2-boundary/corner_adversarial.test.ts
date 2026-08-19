/**
 * Tier 2 Test Suite — Corner, Extreme & Adversarial Inputs
 * Indian Railways WRS Raipur (RDSO G-95 Rev-II)
 *
 * Verifies robust error handling, NaN/Infinity safety, negative/zero heights,
 * floating point precision edge cases, and complex damage combinations.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { classifySpring } from '../../harness/classification_engine.ts';
import type { ClassificationRequest } from '../../../shared/types.ts';

describe('Tier 2 — Corner, Extreme & Adversarial Inputs', () => {

  // 1. Zero and Negative Heights
  it('TC-CRN-01: Zero and negative free heights are safely rejected as CONDEMNED', () => {
    const edgeHeights = [0.0, -1.0, -250.0, -0.00001];

    for (const h of edgeHeights) {
      const res = classifySpring({
        bogieType: 'CASNUB_22_NLB',
        condition: 'USED',
        position: 'OUTER',
        measuredHeight: h
      });

      assert.strictEqual(res.status, 'CONDEMNED', `Height ${h} must be CONDEMNED`);
      assert.strictEqual(res.band, null);
      assert.ok(res.condemnationReason);
    }
  });

  // 2. Ultra-large and Astronomical Heights
  it('TC-CRN-02: Ultra-large and extreme heights are safely handled and marked CONDEMNED', () => {
    const extremeHeights = [9999.0, 100000.0, 999999999.0];

    for (const h of extremeHeights) {
      const res = classifySpring({
        bogieType: 'CASNUB_22_NLB',
        condition: 'USED',
        position: 'OUTER',
        measuredHeight: h
      });

      assert.strictEqual(res.status, 'CONDEMNED');
      assert.strictEqual(res.band, null);
      assert.ok(res.condemnationReason?.includes('exceeds maximum permissible limit'));
    }
  });

  // 3. Non-numeric, NaN, Infinity inputs
  it('TC-CRN-03: NaN, Infinity, -Infinity, and invalid numeric types return CONDEMNED with explicit error', () => {
    const nonNumerics = [NaN, Infinity, -Infinity, ('260.0' as unknown as number), (null as unknown as number), (undefined as unknown as number)];

    for (const val of nonNumerics) {
      const res = classifySpring({
        bogieType: 'CASNUB_22_NLB',
        condition: 'USED',
        position: 'OUTER',
        measuredHeight: val
      });

      assert.strictEqual(res.status, 'CONDEMNED');
      assert.strictEqual(res.band, null);
      assert.ok(res.condemnationReason?.includes('Invalid') || res.condemnationReason?.includes('limit'));
    }
  });

  // 4. Floating Point Precision / Epsilon Edge Cases
  it('TC-CRN-04: Floating point precision boundary transitions near 260.00mm', () => {
    // 260.0000001 -> Above 260.0, belongs to Band I (263-260)
    const justAbove = classifySpring({
      bogieType: 'CASNUB_22_NLB',
      condition: 'USED',
      position: 'OUTER',
      measuredHeight: 260.0000001
    });
    assert.strictEqual(justAbove.band, 'BLUE');

    // 259.9999999 -> Below 260.0, belongs to Band II (260-257)
    const justBelow = classifySpring({
      bogieType: 'CASNUB_22_NLB',
      condition: 'USED',
      position: 'OUTER',
      measuredHeight: 259.9999999
    });
    assert.strictEqual(justBelow.band, 'GREEN');
  });

  // 5. Dual Failure: Out of Range AND Physical Damage
  it('TC-CRN-05: Spring that is BOTH out of range AND damaged reports combined condemnation reasons', () => {
    const res = classifySpring({
      bogieType: 'CASNUB_22_NLB',
      condition: 'USED',
      position: 'OUTER',
      measuredHeight: 240.0, // Below min limit (245mm)
      damageType: 'CRACK',
      damageNotes: 'Longitudinal coil fracture'
    });

    assert.strictEqual(res.status, 'CONDEMNED');
    assert.strictEqual(res.band, null);
    assert.ok(res.condemnationReason?.includes('below minimum permissible limit'));
    assert.ok(res.condemnationReason?.includes('CRACK'));
    assert.ok(res.condemnationReason?.includes('Longitudinal coil fracture'));
  });

});
