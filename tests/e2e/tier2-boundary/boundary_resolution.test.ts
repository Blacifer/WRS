/**
 * Tier 2 Test Suite — RDSO Boundary Resolution (Higher Band Rule)
 * Indian Railways WRS Raipur (RDSO G-95 Rev-II)
 *
 * Verifies that measurements falling EXACTLY on a boundary between two bands
 * are consistently and correctly assigned to the HIGHER band across all tables.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { classifySpring } from '../../harness/classification_engine.ts';

describe('Tier 2 — RDSO Exact Boundary Resolution (Higher Band Rule)', () => {

  // 1. Table 28 Outer Used: Band I (263-260), Band II (260-257), Band III (257-254), Band IV (254-251), Band V (251-248), Band VI (248-245)
  it('TC-BND-01: Table 28 NLB Outer Used boundaries map to Higher Band', () => {
    const boundaryChecks = [
      { height: 263.0, expectedBand: 'BLUE', expectedRoman: 'Band I', desc: 'Max limit of Band I' },
      { height: 260.0, expectedBand: 'BLUE', expectedRoman: 'Band I', desc: 'Boundary between I & II -> Band I (Blue)' },
      { height: 257.0, expectedBand: 'GREEN', expectedRoman: 'Band II', desc: 'Boundary between II & III -> Band II (Green)' },
      { height: 254.0, expectedBand: 'YELLOW', expectedRoman: 'Band III', desc: 'Boundary between III & IV -> Band III (Yellow)' },
      { height: 251.0, expectedBand: 'ORANGE', expectedRoman: 'Band IV', desc: 'Boundary between IV & V -> Band IV (Orange)' },
      { height: 248.0, expectedBand: 'WHITE', expectedRoman: 'Band V', desc: 'Boundary between V & VI -> Band V (White)' },
      { height: 245.0, expectedBand: 'RED', expectedRoman: 'Band VI', desc: 'Min permissible limit -> Band VI (Red)' }
    ];

    for (const bc of boundaryChecks) {
      const res = classifySpring({
        bogieType: 'CASNUB_22_NLB',
        condition: 'USED',
        position: 'OUTER',
        measuredHeight: bc.height
      });
      assert.strictEqual(res.status, 'PASS');
      assert.strictEqual(res.band, bc.expectedBand, `${bc.desc}: Expected ${bc.expectedBand}, got ${res.band}`);
      assert.strictEqual(res.bandRoman, bc.expectedRoman);
    }
  });

  // 2. Table 28 Inner Used: Band I (265-262), Band II (262-259), Band III (259-256), Band IV (256-253), Band V (253-250), Band VI (250-247)
  it('TC-BND-02: Table 28 NLB Inner Used boundaries map to Higher Band', () => {
    const boundaryChecks = [
      { height: 265.0, expectedBand: 'BLUE', expectedRoman: 'Band I' },
      { height: 262.0, expectedBand: 'BLUE', expectedRoman: 'Band I' },
      { height: 259.0, expectedBand: 'GREEN', expectedRoman: 'Band II' },
      { height: 256.0, expectedBand: 'YELLOW', expectedRoman: 'Band III' },
      { height: 253.0, expectedBand: 'ORANGE', expectedRoman: 'Band IV' },
      { height: 250.0, expectedBand: 'WHITE', expectedRoman: 'Band V' },
      { height: 247.0, expectedBand: 'RED', expectedRoman: 'Band VI' }
    ];

    for (const bc of boundaryChecks) {
      const res = classifySpring({
        bogieType: 'CASNUB_22_NLB',
        condition: 'USED',
        position: 'INNER',
        measuredHeight: bc.height
      });
      assert.strictEqual(res.status, 'PASS');
      assert.strictEqual(res.band, bc.expectedBand);
    }
  });

  // 3. Table 28 Snubber Used: Band I (297-294), Band II (294-291), Band III (291-288), Band IV (288-285), Band V (285-282), Band VI (282-279)
  it('TC-BND-03: Table 28 NLB Snubber Used boundaries map to Higher Band', () => {
    const boundaryChecks = [
      { height: 297.0, expectedBand: 'BLUE', expectedRoman: 'Band I' },
      { height: 294.0, expectedBand: 'BLUE', expectedRoman: 'Band I' },
      { height: 291.0, expectedBand: 'GREEN', expectedRoman: 'Band II' },
      { height: 288.0, expectedBand: 'YELLOW', expectedRoman: 'Band III' },
      { height: 285.0, expectedBand: 'ORANGE', expectedRoman: 'Band IV' },
      { height: 282.0, expectedBand: 'WHITE', expectedRoman: 'Band V' },
      { height: 279.0, expectedBand: 'RED', expectedRoman: 'Band VI' }
    ];

    for (const bc of boundaryChecks) {
      const res = classifySpring({
        bogieType: 'CASNUB_22_NLB',
        condition: 'USED',
        position: 'SNUBBER',
        measuredHeight: bc.height
      });
      assert.strictEqual(res.status, 'PASS');
      assert.strictEqual(res.band, bc.expectedBand);
    }
  });

  // 4. Table 29 Inner Used: Band I (246-243), Band II (243-240), Band III (240-237), Band IV (237-234), Band V (234-231), Band VI (231-228)
  it('TC-BND-04: Table 29 HS Inner Used boundaries map to Higher Band', () => {
    const boundaryChecks = [
      { height: 246.0, expectedBand: 'BLUE', expectedRoman: 'Band I' },
      { height: 243.0, expectedBand: 'BLUE', expectedRoman: 'Band I' },
      { height: 240.0, expectedBand: 'GREEN', expectedRoman: 'Band II' },
      { height: 237.0, expectedBand: 'YELLOW', expectedRoman: 'Band III' },
      { height: 234.0, expectedBand: 'ORANGE', expectedRoman: 'Band IV' },
      { height: 231.0, expectedBand: 'WHITE', expectedRoman: 'Band V' },
      { height: 228.0, expectedBand: 'RED', expectedRoman: 'Band VI' }
    ];

    for (const bc of boundaryChecks) {
      const res = classifySpring({
        bogieType: 'CASNUB_22_HS',
        condition: 'USED',
        position: 'INNER',
        measuredHeight: bc.height
      });
      assert.strictEqual(res.status, 'PASS');
      assert.strictEqual(res.band, bc.expectedBand);
    }
  });

  // 5. Table 30 Outer Used: Band I (275-272), Band II (272-269), Band III (269-266), Band IV (266-263), Band V (263-260), Band VI (260-257)
  it('TC-BND-05: Table 30 RFT Outer Used boundaries map to Higher Band', () => {
    const boundaryChecks = [
      { height: 275.0, expectedBand: 'BLUE', expectedRoman: 'Band I' },
      { height: 272.0, expectedBand: 'BLUE', expectedRoman: 'Band I' },
      { height: 269.0, expectedBand: 'GREEN', expectedRoman: 'Band II' },
      { height: 266.0, expectedBand: 'YELLOW', expectedRoman: 'Band III' },
      { height: 263.0, expectedBand: 'ORANGE', expectedRoman: 'Band IV' },
      { height: 260.0, expectedBand: 'WHITE', expectedRoman: 'Band V' },
      { height: 257.0, expectedBand: 'RED', expectedRoman: 'Band VI' }
    ];

    for (const bc of boundaryChecks) {
      const res = classifySpring({
        bogieType: 'CASNUB_22_RFT',
        condition: 'USED',
        position: 'OUTER',
        measuredHeight: bc.height
      });
      assert.strictEqual(res.status, 'PASS');
      assert.strictEqual(res.band, bc.expectedBand);
    }
  });

  // 6. Table 31 NLB New Outer: Band I (263-261 Green), Band II (261-259 Yellow), Band III (259-257 Red)
  it('TC-BND-06: Table 31 NLB New Outer boundaries map to Higher Band', () => {
    const boundaryChecks = [
      { height: 263.0, expectedBand: 'GREEN', expectedRoman: 'Band I' },
      { height: 261.0, expectedBand: 'GREEN', expectedRoman: 'Band I' },
      { height: 259.0, expectedBand: 'YELLOW', expectedRoman: 'Band II' },
      { height: 257.0, expectedBand: 'RED', expectedRoman: 'Band III' }
    ];

    for (const bc of boundaryChecks) {
      const res = classifySpring({
        bogieType: 'CASNUB_22_NLB',
        condition: 'NEW',
        position: 'OUTER',
        measuredHeight: bc.height
      });
      assert.strictEqual(res.status, 'PASS');
      assert.strictEqual(res.band, bc.expectedBand);
    }
  });

  // 7. Table 33 RFT New Snubber: Band I (307-305 Green), Band II (305-303 Yellow), Band III (303-301 Red)
  it('TC-BND-07: Table 33 RFT New Snubber boundaries map to Higher Band', () => {
    const boundaryChecks = [
      { height: 307.0, expectedBand: 'GREEN', expectedRoman: 'Band I' },
      { height: 305.0, expectedBand: 'GREEN', expectedRoman: 'Band I' },
      { height: 303.0, expectedBand: 'YELLOW', expectedRoman: 'Band II' },
      { height: 301.0, expectedBand: 'RED', expectedRoman: 'Band III' }
    ];

    for (const bc of boundaryChecks) {
      const res = classifySpring({
        bogieType: 'CASNUB_22_RFT',
        condition: 'NEW',
        position: 'SNUBBER',
        measuredHeight: bc.height
      });
      assert.strictEqual(res.status, 'PASS');
      assert.strictEqual(res.band, bc.expectedBand);
    }
  });

});
