/**
 * Tier 1 Test Suite — Feature R1: Spring Classification Engine
 * Indian Railways WRS Raipur (RDSO G-95 Rev-II)
 *
 * Verifies all 6 RDSO tables (Tables 28-33), used/new spring conditions,
 * out-of-range condemnation, and manual damage flagging.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { classifySpring, getRDSOTable } from '../../harness/classification_engine.ts';
import type { ClassificationRequest } from '../../../shared/types.ts';

describe('Tier 1 — R1: Spring Classification Engine', () => {

  // Test Case 1: Table 28 CASNUB 22 NLB Used Outer Spring (6 Bands)
  it('TC-R1-01: Correctly classifies CASNUB 22 NLB Used Outer spring across all 6 bands (Table 28)', () => {
    const testCases = [
      { height: 262.0, expectedBand: 'BLUE', expectedRoman: 'Band I' },
      { height: 258.5, expectedBand: 'GREEN', expectedRoman: 'Band II' },
      { height: 255.0, expectedBand: 'YELLOW', expectedRoman: 'Band III' },
      { height: 252.0, expectedBand: 'ORANGE', expectedRoman: 'Band IV' },
      { height: 249.5, expectedBand: 'WHITE', expectedRoman: 'Band V' },
      { height: 246.0, expectedBand: 'RED', expectedRoman: 'Band VI' }
    ];

    for (const tc of testCases) {
      const res = classifySpring({
        bogieType: 'CASNUB_22_NLB',
        condition: 'USED',
        position: 'OUTER',
        measuredHeight: tc.height
      });

      assert.strictEqual(res.status, 'PASS', `Height ${tc.height} should pass`);
      assert.strictEqual(res.band, tc.expectedBand, `Height ${tc.height} should be ${tc.expectedBand}`);
      assert.strictEqual(res.bandRoman, tc.expectedRoman);
      assert.strictEqual(res.tableReference, 'Table 28');
    }
  });

  // Test Case 2: Table 29 CASNUB 22 HS Used Inner Spring (6 Bands)
  it('TC-R1-02: Correctly classifies CASNUB 22 HS Used Inner spring across all 6 bands (Table 29)', () => {
    const testCases = [
      { height: 245.0, expectedBand: 'BLUE', expectedRoman: 'Band I' },
      { height: 241.5, expectedBand: 'GREEN', expectedRoman: 'Band II' },
      { height: 238.5, expectedBand: 'YELLOW', expectedRoman: 'Band III' },
      { height: 235.0, expectedBand: 'ORANGE', expectedRoman: 'Band IV' },
      { height: 232.5, expectedBand: 'WHITE', expectedRoman: 'Band V' },
      { height: 229.0, expectedBand: 'RED', expectedRoman: 'Band VI' }
    ];

    for (const tc of testCases) {
      const res = classifySpring({
        bogieType: 'CASNUB_22_HS',
        condition: 'USED',
        position: 'INNER',
        measuredHeight: tc.height
      });

      assert.strictEqual(res.status, 'PASS', `Height ${tc.height} should pass`);
      assert.strictEqual(res.band, tc.expectedBand, `Height ${tc.height} should be ${tc.expectedBand}`);
      assert.strictEqual(res.bandRoman, tc.expectedRoman);
      assert.strictEqual(res.tableReference, 'Table 29');
    }
  });

  // Test Case 3: Table 30 CASNUB 22 RFT Used Snubber Spring (6 Bands)
  it('TC-R1-03: Correctly classifies CASNUB 22 RFT Used Snubber spring across all 6 bands (Table 30)', () => {
    const testCases = [
      { height: 306.0, expectedBand: 'BLUE', expectedRoman: 'Band I' },
      { height: 302.5, expectedBand: 'GREEN', expectedRoman: 'Band II' },
      { height: 299.5, expectedBand: 'YELLOW', expectedRoman: 'Band III' },
      { height: 296.0, expectedBand: 'ORANGE', expectedRoman: 'Band IV' },
      { height: 293.5, expectedBand: 'WHITE', expectedRoman: 'Band V' },
      { height: 290.0, expectedBand: 'RED', expectedRoman: 'Band VI' }
    ];

    for (const tc of testCases) {
      const res = classifySpring({
        bogieType: 'CASNUB_22_RFT',
        condition: 'USED',
        position: 'SNUBBER',
        measuredHeight: tc.height
      });

      assert.strictEqual(res.status, 'PASS', `Height ${tc.height} should pass`);
      assert.strictEqual(res.band, tc.expectedBand, `Height ${tc.height} should be ${tc.expectedBand}`);
      assert.strictEqual(res.bandRoman, tc.expectedRoman);
      assert.strictEqual(res.tableReference, 'Table 30');
    }
  });

  // Test Case 4: Table 31 CASNUB 22 NLB New Springs (3 Bands: Green, Yellow, Red)
  it('TC-R1-04: Correctly classifies CASNUB 22 NLB New Outer spring across 3 bands (Table 31)', () => {
    const testCases = [
      { height: 262.0, expectedBand: 'GREEN', expectedRoman: 'Band I' },
      { height: 260.0, expectedBand: 'YELLOW', expectedRoman: 'Band II' },
      { height: 258.0, expectedBand: 'RED', expectedRoman: 'Band III' }
    ];

    for (const tc of testCases) {
      const res = classifySpring({
        bogieType: 'CASNUB_22_NLB',
        condition: 'NEW',
        position: 'OUTER',
        measuredHeight: tc.height
      });

      assert.strictEqual(res.status, 'PASS');
      assert.strictEqual(res.band, tc.expectedBand);
      assert.strictEqual(res.bandRoman, tc.expectedRoman);
      assert.strictEqual(res.tableReference, 'Table 31');
    }
  });

  // Test Case 5: Table 32 CASNUB 22 HS New Springs (3 Bands)
  it('TC-R1-05: Correctly classifies CASNUB 22 HS New Snubber spring across 3 bands (Table 32)', () => {
    const testCases = [
      { height: 295.0, expectedBand: 'GREEN', expectedRoman: 'Band I' },
      { height: 293.0, expectedBand: 'YELLOW', expectedRoman: 'Band II' },
      { height: 291.0, expectedBand: 'RED', expectedRoman: 'Band III' }
    ];

    for (const tc of testCases) {
      const res = classifySpring({
        bogieType: 'CASNUB_22_HS',
        condition: 'NEW',
        position: 'SNUBBER',
        measuredHeight: tc.height
      });

      assert.strictEqual(res.status, 'PASS');
      assert.strictEqual(res.band, tc.expectedBand);
      assert.strictEqual(res.bandRoman, tc.expectedRoman);
      assert.strictEqual(res.tableReference, 'Table 32');
    }
  });

  // Test Case 6: Table 33 CASNUB 22 RFT New Springs (3 Bands)
  it('TC-R1-06: Correctly classifies CASNUB 22 RFT New Outer spring across 3 bands (Table 33)', () => {
    const testCases = [
      { height: 274.0, expectedBand: 'GREEN', expectedRoman: 'Band I' },
      { height: 272.0, expectedBand: 'YELLOW', expectedRoman: 'Band II' },
      { height: 270.0, expectedBand: 'RED', expectedRoman: 'Band III' }
    ];

    for (const tc of testCases) {
      const res = classifySpring({
        bogieType: 'CASNUB_22_RFT',
        condition: 'NEW',
        position: 'OUTER',
        measuredHeight: tc.height
      });

      assert.strictEqual(res.status, 'PASS');
      assert.strictEqual(res.band, tc.expectedBand);
      assert.strictEqual(res.bandRoman, tc.expectedRoman);
      assert.strictEqual(res.tableReference, 'Table 33');
    }
  });

  // Test Case 7: Out of Range Free Heights -> CONDEMNED
  it('TC-R1-07: Out of range free heights are flagged as CONDEMNED with explanatory reason', () => {
    // Under minimum limit for CASNUB 22 NLB Outer Used (245mm)
    const resLow = classifySpring({
      bogieType: 'CASNUB_22_NLB',
      condition: 'USED',
      position: 'OUTER',
      measuredHeight: 242.5
    });
    assert.strictEqual(resLow.status, 'CONDEMNED');
    assert.strictEqual(resLow.band, null);
    assert.ok(resLow.condemnationReason?.includes('below minimum permissible limit'));

    // Exceeds maximum limit (263mm)
    const resHigh = classifySpring({
      bogieType: 'CASNUB_22_NLB',
      condition: 'USED',
      position: 'OUTER',
      measuredHeight: 268.0
    });
    assert.strictEqual(resHigh.status, 'CONDEMNED');
    assert.strictEqual(resHigh.band, null);
    assert.ok(resHigh.condemnationReason?.includes('exceeds maximum permissible limit'));
  });

  // Test Case 8: Manual Damage Flags Force CONDEMNED Status
  it('TC-R1-08: Manual damage flags (CRACK, CORROSION, DEFORMATION) force CONDEMNED status even for Band I height', () => {
    const damageTypes: Array<'CRACK' | 'CORROSION' | 'DEFORMATION'> = ['CRACK', 'CORROSION', 'DEFORMATION'];

    for (const damage of damageTypes) {
      const res = classifySpring({
        bogieType: 'CASNUB_22_NLB',
        condition: 'USED',
        position: 'OUTER',
        measuredHeight: 262.0, // Nominally Band I (Blue)
        damageType: damage,
        damageNotes: `Severe ${damage.toLowerCase()} observed on 2nd active coil`
      });

      assert.strictEqual(res.status, 'CONDEMNED', `Spring with ${damage} must be CONDEMNED`);
      assert.strictEqual(res.band, null, 'Condemned spring should not have a valid band');
      assert.ok(res.condemnationReason?.includes(damage));
      assert.ok(res.condemnationReason?.includes('2nd active coil'));
    }
  });

});
