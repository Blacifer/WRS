/**
 * Comprehensive Unit Tests for RDSO G-95 Revision-II Tables 28-33
 * Indian Railways WRS Raipur
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { classifySpring, getRDSOTable } from '../../shared/classification/index.ts';

describe('RDSO G-95 Revision-II Spring Classification Engine Tests', () => {

  // -------------------------------------------------------------------------
  // Table 28: CASNUB 22 NLB Used (Outer, Inner, Snubber)
  // -------------------------------------------------------------------------
  describe('Table 28: CASNUB 22 NLB Used Springs', () => {
    it('TC-T28-01: Correctly classifies NLB Outer Used across all 6 bands', () => {
      const cases = [
        { h: 263.0, expectedBand: 'BLUE', expectedRoman: 'Band I' },
        { h: 261.5, expectedBand: 'BLUE', expectedRoman: 'Band I' },
        { h: 260.0, expectedBand: 'BLUE', expectedRoman: 'Band I' }, // Exact boundary -> HIGHER band
        { h: 259.99, expectedBand: 'GREEN', expectedRoman: 'Band II' },
        { h: 258.5, expectedBand: 'GREEN', expectedRoman: 'Band II' },
        { h: 257.0, expectedBand: 'GREEN', expectedRoman: 'Band II' }, // Exact boundary -> HIGHER band
        { h: 256.99, expectedBand: 'YELLOW', expectedRoman: 'Band III' },
        { h: 255.5, expectedBand: 'YELLOW', expectedRoman: 'Band III' },
        { h: 254.0, expectedBand: 'YELLOW', expectedRoman: 'Band III' }, // Exact boundary -> HIGHER band
        { h: 253.99, expectedBand: 'ORANGE', expectedRoman: 'Band IV' },
        { h: 252.5, expectedBand: 'ORANGE', expectedRoman: 'Band IV' },
        { h: 251.0, expectedBand: 'ORANGE', expectedRoman: 'Band IV' }, // Exact boundary -> HIGHER band
        { h: 250.99, expectedBand: 'WHITE', expectedRoman: 'Band V' },
        { h: 249.5, expectedBand: 'WHITE', expectedRoman: 'Band V' },
        { h: 248.0, expectedBand: 'WHITE', expectedRoman: 'Band V' }, // Exact boundary -> HIGHER band
        { h: 247.99, expectedBand: 'RED', expectedRoman: 'Band VI' },
        { h: 246.0, expectedBand: 'RED', expectedRoman: 'Band VI' },
        { h: 245.0, expectedBand: 'RED', expectedRoman: 'Band VI' }  // Minimum usable limit
      ];

      for (const tc of cases) {
        const res = classifySpring({
          bogieType: 'CASNUB_22_NLB',
          condition: 'USED',
          position: 'OUTER',
          measuredHeight: tc.h
        });

        assert.strictEqual(res.status, 'PASS', `Height ${tc.h} should pass`);
        assert.strictEqual(res.band, tc.expectedBand, `Height ${tc.h} should be ${tc.expectedBand}`);
        assert.strictEqual(res.bandRoman, tc.expectedRoman);
        assert.strictEqual(res.tableReference, 'Table 28');
      }
    });

    it('TC-T28-02: Correctly classifies NLB Inner Used across all 6 bands', () => {
      const cases = [
        { h: 265.0, expectedBand: 'BLUE', expectedRoman: 'Band I' },
        { h: 262.0, expectedBand: 'BLUE', expectedRoman: 'Band I' }, // Boundary -> Band I
        { h: 261.99, expectedBand: 'GREEN', expectedRoman: 'Band II' },
        { h: 259.0, expectedBand: 'GREEN', expectedRoman: 'Band II' }, // Boundary -> Band II
        { h: 258.99, expectedBand: 'YELLOW', expectedRoman: 'Band III' },
        { h: 256.0, expectedBand: 'YELLOW', expectedRoman: 'Band III' }, // Boundary -> Band III
        { h: 255.99, expectedBand: 'ORANGE', expectedRoman: 'Band IV' },
        { h: 253.0, expectedBand: 'ORANGE', expectedRoman: 'Band IV' }, // Boundary -> Band IV
        { h: 252.99, expectedBand: 'WHITE', expectedRoman: 'Band V' },
        { h: 250.0, expectedBand: 'WHITE', expectedRoman: 'Band V' }, // Boundary -> Band V
        { h: 249.99, expectedBand: 'RED', expectedRoman: 'Band VI' },
        { h: 247.0, expectedBand: 'RED', expectedRoman: 'Band VI' }  // Min limit
      ];

      for (const tc of cases) {
        const res = classifySpring({
          bogieType: 'CASNUB_22_NLB',
          condition: 'USED',
          position: 'INNER',
          measuredHeight: tc.h
        });

        assert.strictEqual(res.status, 'PASS');
        assert.strictEqual(res.band, tc.expectedBand);
        assert.strictEqual(res.bandRoman, tc.expectedRoman);
        assert.strictEqual(res.tableReference, 'Table 28');
      }
    });

    it('TC-T28-03: Correctly classifies NLB Snubber Used across all 6 bands', () => {
      const cases = [
        { h: 297.0, expectedBand: 'BLUE', expectedRoman: 'Band I' },
        { h: 294.0, expectedBand: 'BLUE', expectedRoman: 'Band I' },
        { h: 291.0, expectedBand: 'GREEN', expectedRoman: 'Band II' },
        { h: 288.0, expectedBand: 'YELLOW', expectedRoman: 'Band III' },
        { h: 285.0, expectedBand: 'ORANGE', expectedRoman: 'Band IV' },
        { h: 282.0, expectedBand: 'WHITE', expectedRoman: 'Band V' },
        { h: 279.0, expectedBand: 'RED', expectedRoman: 'Band VI' }
      ];

      for (const tc of cases) {
        const res = classifySpring({
          bogieType: 'CASNUB_22_NLB',
          condition: 'USED',
          position: 'SNUBBER',
          measuredHeight: tc.h
        });

        assert.strictEqual(res.status, 'PASS');
        assert.strictEqual(res.band, tc.expectedBand);
        assert.strictEqual(res.tableReference, 'Table 28');
      }
    });
  });

  // -------------------------------------------------------------------------
  // Table 29: CASNUB 22HS Used (Outer, Inner, Snubber)
  // -------------------------------------------------------------------------
  describe('Table 29: CASNUB 22HS Used Springs', () => {
    it('TC-T29-01: Correctly classifies 22HS Inner Used across all 6 bands', () => {
      const cases = [
        { h: 246.0, expectedBand: 'BLUE', expectedRoman: 'Band I' },
        { h: 243.0, expectedBand: 'BLUE', expectedRoman: 'Band I' },
        { h: 240.0, expectedBand: 'GREEN', expectedRoman: 'Band II' },
        { h: 237.0, expectedBand: 'YELLOW', expectedRoman: 'Band III' },
        { h: 234.0, expectedBand: 'ORANGE', expectedRoman: 'Band IV' },
        { h: 231.0, expectedBand: 'WHITE', expectedRoman: 'Band V' },
        { h: 228.0, expectedBand: 'RED', expectedRoman: 'Band VI' }
      ];

      for (const tc of cases) {
        const res = classifySpring({
          bogieType: 'CASNUB_22_HS',
          condition: 'USED',
          position: 'INNER',
          measuredHeight: tc.h
        });

        assert.strictEqual(res.status, 'PASS');
        assert.strictEqual(res.band, tc.expectedBand);
        assert.strictEqual(res.tableReference, 'Table 29');
      }
    });
  });

  // -------------------------------------------------------------------------
  // Table 30: CASNUB 22 RFT Used (Outer, Inner, Snubber)
  // -------------------------------------------------------------------------
  describe('Table 30: CASNUB 22 RFT Used Springs', () => {
    it('TC-T30-01: Correctly classifies 22 RFT Snubber Used across all 6 bands', () => {
      const cases = [
        { h: 307.0, expectedBand: 'BLUE', expectedRoman: 'Band I' },
        { h: 304.0, expectedBand: 'BLUE', expectedRoman: 'Band I' },
        { h: 301.0, expectedBand: 'GREEN', expectedRoman: 'Band II' },
        { h: 298.0, expectedBand: 'YELLOW', expectedRoman: 'Band III' },
        { h: 295.0, expectedBand: 'ORANGE', expectedRoman: 'Band IV' },
        { h: 292.0, expectedBand: 'WHITE', expectedRoman: 'Band V' },
        { h: 289.0, expectedBand: 'RED', expectedRoman: 'Band VI' }
      ];

      for (const tc of cases) {
        const res = classifySpring({
          bogieType: 'CASNUB_22_RFT',
          condition: 'USED',
          position: 'SNUBBER',
          measuredHeight: tc.h
        });

        assert.strictEqual(res.status, 'PASS');
        assert.strictEqual(res.band, tc.expectedBand);
        assert.strictEqual(res.tableReference, 'Table 30');
      }
    });
  });

  // -------------------------------------------------------------------------
  // Tables 31-33: New Springs (3 Bands: Green, Yellow, Red)
  // -------------------------------------------------------------------------
  describe('Tables 31-33: New Springs (3 Bands)', () => {
    it('TC-T31-01: Table 31 NLB New Outer (Green, Yellow, Red)', () => {
      const cases = [
        { h: 263.0, expectedBand: 'GREEN', expectedRoman: 'Band I' },
        { h: 261.0, expectedBand: 'GREEN', expectedRoman: 'Band I' }, // Boundary -> Band I
        { h: 260.99, expectedBand: 'YELLOW', expectedRoman: 'Band II' },
        { h: 259.0, expectedBand: 'YELLOW', expectedRoman: 'Band II' }, // Boundary -> Band II
        { h: 258.99, expectedBand: 'RED', expectedRoman: 'Band III' },
        { h: 257.0, expectedBand: 'RED', expectedRoman: 'Band III' }  // Min limit
      ];

      for (const tc of cases) {
        const res = classifySpring({
          bogieType: 'CASNUB_22_NLB',
          condition: 'NEW',
          position: 'OUTER',
          measuredHeight: tc.h
        });

        assert.strictEqual(res.status, 'PASS');
        assert.strictEqual(res.band, tc.expectedBand);
        assert.strictEqual(res.tableReference, 'Table 31');
      }
    });

    it('TC-T32-01: Table 32 HS New Snubber (Green, Yellow, Red)', () => {
      const cases = [
        { h: 296.0, expectedBand: 'GREEN', expectedRoman: 'Band I' },
        { h: 294.0, expectedBand: 'GREEN', expectedRoman: 'Band I' },
        { h: 292.0, expectedBand: 'YELLOW', expectedRoman: 'Band II' },
        { h: 290.0, expectedBand: 'RED', expectedRoman: 'Band III' }
      ];

      for (const tc of cases) {
        const res = classifySpring({
          bogieType: 'CASNUB_22_HS',
          condition: 'NEW',
          position: 'SNUBBER',
          measuredHeight: tc.h
        });

        assert.strictEqual(res.status, 'PASS');
        assert.strictEqual(res.band, tc.expectedBand);
        assert.strictEqual(res.tableReference, 'Table 32');
      }
    });

    it('TC-T33-01: Table 33 RFT New Outer (Green, Yellow, Red)', () => {
      const cases = [
        { h: 275.0, expectedBand: 'GREEN', expectedRoman: 'Band I' },
        { h: 273.0, expectedBand: 'GREEN', expectedRoman: 'Band I' },
        { h: 271.0, expectedBand: 'YELLOW', expectedRoman: 'Band II' },
        { h: 269.0, expectedBand: 'RED', expectedRoman: 'Band III' }
      ];

      for (const tc of cases) {
        const res = classifySpring({
          bogieType: 'CASNUB_22_RFT',
          condition: 'NEW',
          position: 'OUTER',
          measuredHeight: tc.h
        });

        assert.strictEqual(res.status, 'PASS');
        assert.strictEqual(res.band, tc.expectedBand);
        assert.strictEqual(res.tableReference, 'Table 33');
      }
    });
  });

  // -------------------------------------------------------------------------
  // Out of Range & Condemnation Tests
  // -------------------------------------------------------------------------
  describe('Condemnation & Defect Flags', () => {
    it('TC-COND-01: Under-height measurement results in CONDEMNED status', () => {
      const res = classifySpring({
        bogieType: 'CASNUB_22_NLB',
        condition: 'USED',
        position: 'OUTER',
        measuredHeight: 244.9
      });

      assert.strictEqual(res.status, 'CONDEMNED');
      assert.strictEqual(res.band, null);
      assert.strictEqual(res.bandRoman, null);
      assert.ok(res.condemnationReason?.includes('below minimum permissible limit'));
    });

    it('TC-COND-02: Over-height measurement results in CONDEMNED status', () => {
      const res = classifySpring({
        bogieType: 'CASNUB_22_NLB',
        condition: 'USED',
        position: 'OUTER',
        measuredHeight: 263.1
      });

      assert.strictEqual(res.status, 'CONDEMNED');
      assert.strictEqual(res.band, null);
      assert.strictEqual(res.bandRoman, null);
      assert.ok(res.condemnationReason?.includes('exceeds maximum permissible limit'));
    });

    it('TC-COND-03: Physical defect flags force CONDEMNED status regardless of height', () => {
      const defects = ['CRACK', 'CORROSION', 'DEFORMATION', 'OTHER'] as const;

      for (const d of defects) {
        const res = classifySpring({
          bogieType: 'CASNUB_22_NLB',
          condition: 'USED',
          position: 'OUTER',
          measuredHeight: 262.0, // Nominally Band I
          damageType: d,
          damageNotes: `Severe ${d} on outer turn`
        });

        assert.strictEqual(res.status, 'CONDEMNED', `${d} must force CONDEMNED`);
        assert.strictEqual(res.band, null);
        assert.ok(res.condemnationReason?.includes(d));
      }
    });
  });

});
