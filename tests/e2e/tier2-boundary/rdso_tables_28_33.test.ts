/**
 * Tier 2 Test Suite — Exhaustive RDSO Tables 28-33 Coverage
 * Indian Railways WRS Raipur (RDSO G-95 Rev-II)
 *
 * Exhaustively exercises all 6 RDSO tables, 3 spring positions (Outer, Inner, Snubber),
 * 2 conditions (Used, New), across all bands with nominal and midpoint measurements.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { classifySpring, RDSO_TABLES } from '../../harness/classification_engine.ts';
import type { BogieType, SpringCondition, SpringPosition } from '../../../shared/types.ts';

describe('Tier 2 — RDSO Tables 28-33 Exhaustive Coverage', () => {

  // 1. Table 28: CASNUB 22 NLB Used (Outer, Inner, Snubber)
  describe('Table 28: CASNUB 22 NLB Used', () => {
    it('Table 28 Outer: classifies midpoints of all 6 bands', () => {
      const cases = [
        { mid: 261.5, band: 'BLUE', roman: 'Band I' },
        { mid: 258.5, band: 'GREEN', roman: 'Band II' },
        { mid: 255.5, band: 'YELLOW', roman: 'Band III' },
        { mid: 252.5, band: 'ORANGE', roman: 'Band IV' },
        { mid: 249.5, band: 'WHITE', roman: 'Band V' },
        { mid: 246.5, band: 'RED', roman: 'Band VI' }
      ];
      for (const c of cases) {
        const res = classifySpring({ bogieType: 'CASNUB_22_NLB', condition: 'USED', position: 'OUTER', measuredHeight: c.mid });
        assert.strictEqual(res.status, 'PASS');
        assert.strictEqual(res.band, c.band);
        assert.strictEqual(res.bandRoman, c.roman);
      }
    });

    it('Table 28 Inner: classifies midpoints of all 6 bands', () => {
      const cases = [
        { mid: 263.5, band: 'BLUE', roman: 'Band I' },
        { mid: 260.5, band: 'GREEN', roman: 'Band II' },
        { mid: 257.5, band: 'YELLOW', roman: 'Band III' },
        { mid: 254.5, band: 'ORANGE', roman: 'Band IV' },
        { mid: 251.5, band: 'WHITE', roman: 'Band V' },
        { mid: 248.5, band: 'RED', roman: 'Band VI' }
      ];
      for (const c of cases) {
        const res = classifySpring({ bogieType: 'CASNUB_22_NLB', condition: 'USED', position: 'INNER', measuredHeight: c.mid });
        assert.strictEqual(res.status, 'PASS');
        assert.strictEqual(res.band, c.band);
        assert.strictEqual(res.bandRoman, c.roman);
      }
    });

    it('Table 28 Snubber: classifies midpoints of all 6 bands', () => {
      const cases = [
        { mid: 295.5, band: 'BLUE', roman: 'Band I' },
        { mid: 292.5, band: 'GREEN', roman: 'Band II' },
        { mid: 289.5, band: 'YELLOW', roman: 'Band III' },
        { mid: 286.5, band: 'ORANGE', roman: 'Band IV' },
        { mid: 283.5, band: 'WHITE', roman: 'Band V' },
        { mid: 280.5, band: 'RED', roman: 'Band VI' }
      ];
      for (const c of cases) {
        const res = classifySpring({ bogieType: 'CASNUB_22_NLB', condition: 'USED', position: 'SNUBBER', measuredHeight: c.mid });
        assert.strictEqual(res.status, 'PASS');
        assert.strictEqual(res.band, c.band);
        assert.strictEqual(res.bandRoman, c.roman);
      }
    });
  });

  // 2. Table 29: CASNUB 22 HS Used (Outer, Inner, Snubber)
  describe('Table 29: CASNUB 22 HS Used', () => {
    it('Table 29 Outer: classifies midpoints of all 6 bands', () => {
      const cases = [
        { mid: 261.5, band: 'BLUE', roman: 'Band I' },
        { mid: 258.5, band: 'GREEN', roman: 'Band II' },
        { mid: 255.5, band: 'YELLOW', roman: 'Band III' },
        { mid: 252.5, band: 'ORANGE', roman: 'Band IV' },
        { mid: 249.5, band: 'WHITE', roman: 'Band V' },
        { mid: 246.5, band: 'RED', roman: 'Band VI' }
      ];
      for (const c of cases) {
        const res = classifySpring({ bogieType: 'CASNUB_22_HS', condition: 'USED', position: 'OUTER', measuredHeight: c.mid });
        assert.strictEqual(res.status, 'PASS');
        assert.strictEqual(res.band, c.band);
      }
    });

    it('Table 29 Inner: classifies midpoints of all 6 bands', () => {
      const cases = [
        { mid: 244.5, band: 'BLUE', roman: 'Band I' },
        { mid: 241.5, band: 'GREEN', roman: 'Band II' },
        { mid: 238.5, band: 'YELLOW', roman: 'Band III' },
        { mid: 235.5, band: 'ORANGE', roman: 'Band IV' },
        { mid: 232.5, band: 'WHITE', roman: 'Band V' },
        { mid: 229.5, band: 'RED', roman: 'Band VI' }
      ];
      for (const c of cases) {
        const res = classifySpring({ bogieType: 'CASNUB_22_HS', condition: 'USED', position: 'INNER', measuredHeight: c.mid });
        assert.strictEqual(res.status, 'PASS');
        assert.strictEqual(res.band, c.band);
      }
    });

    it('Table 29 Snubber: classifies midpoints of all 6 bands', () => {
      const cases = [
        { mid: 294.5, band: 'BLUE', roman: 'Band I' },
        { mid: 291.5, band: 'GREEN', roman: 'Band II' },
        { mid: 288.5, band: 'YELLOW', roman: 'Band III' },
        { mid: 285.5, band: 'ORANGE', roman: 'Band IV' },
        { mid: 282.5, band: 'WHITE', roman: 'Band V' },
        { mid: 279.5, band: 'RED', roman: 'Band VI' }
      ];
      for (const c of cases) {
        const res = classifySpring({ bogieType: 'CASNUB_22_HS', condition: 'USED', position: 'SNUBBER', measuredHeight: c.mid });
        assert.strictEqual(res.status, 'PASS');
        assert.strictEqual(res.band, c.band);
      }
    });
  });

  // 3. Table 30: CASNUB 22 RFT Used (Outer, Inner, Snubber)
  describe('Table 30: CASNUB 22 RFT Used', () => {
    it('Table 30 Outer: classifies midpoints of all 6 bands', () => {
      const cases = [
        { mid: 273.5, band: 'BLUE', roman: 'Band I' },
        { mid: 270.5, band: 'GREEN', roman: 'Band II' },
        { mid: 267.5, band: 'YELLOW', roman: 'Band III' },
        { mid: 264.5, band: 'ORANGE', roman: 'Band IV' },
        { mid: 261.5, band: 'WHITE', roman: 'Band V' },
        { mid: 258.5, band: 'RED', roman: 'Band VI' }
      ];
      for (const c of cases) {
        const res = classifySpring({ bogieType: 'CASNUB_22_RFT', condition: 'USED', position: 'OUTER', measuredHeight: c.mid });
        assert.strictEqual(res.status, 'PASS');
        assert.strictEqual(res.band, c.band);
      }
    });

    it('Table 30 Inner: classifies midpoints of all 6 bands', () => {
      const cases = [
        { mid: 238.5, band: 'BLUE', roman: 'Band I' },
        { mid: 235.5, band: 'GREEN', roman: 'Band II' },
        { mid: 232.5, band: 'YELLOW', roman: 'Band III' },
        { mid: 229.5, band: 'ORANGE', roman: 'Band IV' },
        { mid: 226.5, band: 'WHITE', roman: 'Band V' },
        { mid: 223.5, band: 'RED', roman: 'Band VI' }
      ];
      for (const c of cases) {
        const res = classifySpring({ bogieType: 'CASNUB_22_RFT', condition: 'USED', position: 'INNER', measuredHeight: c.mid });
        assert.strictEqual(res.status, 'PASS');
        assert.strictEqual(res.band, c.band);
      }
    });

    it('Table 30 Snubber(O) / Snubber(I): classifies midpoints of all 6 bands', () => {
      const cases = [
        { mid: 305.5, band: 'BLUE', roman: 'Band I' },
        { mid: 302.5, band: 'GREEN', roman: 'Band II' },
        { mid: 299.5, band: 'YELLOW', roman: 'Band III' },
        { mid: 296.5, band: 'ORANGE', roman: 'Band IV' },
        { mid: 293.5, band: 'WHITE', roman: 'Band V' },
        { mid: 290.5, band: 'RED', roman: 'Band VI' }
      ];
      for (const c of cases) {
        const resO = classifySpring({ bogieType: 'CASNUB_22_RFT', condition: 'USED', position: 'SNUBBER_OUTER', measuredHeight: c.mid });
        assert.strictEqual(resO.status, 'PASS');
        assert.strictEqual(resO.band, c.band);

        const resI = classifySpring({ bogieType: 'CASNUB_22_RFT', condition: 'USED', position: 'SNUBBER_INNER', measuredHeight: c.mid });
        assert.strictEqual(resI.status, 'PASS');
        assert.strictEqual(resI.band, c.band);
      }
    });
  });

  // 4. Tables 31-33: New Springs (3 Bands: Green, Yellow, Red)
  describe('Tables 31-33: New Springs (3 Bands)', () => {
    it('Table 31 (NLB New): classifies midpoints of all 3 bands across Outer, Inner, Snubber', () => {
      const outerCases = [
        { mid: 262.0, band: 'GREEN', roman: 'Band I' },
        { mid: 260.0, band: 'YELLOW', roman: 'Band II' },
        { mid: 258.0, band: 'RED', roman: 'Band III' }
      ];
      for (const c of outerCases) {
        const res = classifySpring({ bogieType: 'CASNUB_22_NLB', condition: 'NEW', position: 'OUTER', measuredHeight: c.mid });
        assert.strictEqual(res.band, c.band);
      }

      const innerCases = [
        { mid: 264.0, band: 'GREEN', roman: 'Band I' },
        { mid: 262.0, band: 'YELLOW', roman: 'Band II' },
        { mid: 260.0, band: 'RED', roman: 'Band III' }
      ];
      for (const c of innerCases) {
        const res = classifySpring({ bogieType: 'CASNUB_22_NLB', condition: 'NEW', position: 'INNER', measuredHeight: c.mid });
        assert.strictEqual(res.band, c.band);
      }

      const snubberCases = [
        { mid: 296.0, band: 'GREEN', roman: 'Band I' },
        { mid: 294.0, band: 'YELLOW', roman: 'Band II' },
        { mid: 292.0, band: 'RED', roman: 'Band III' }
      ];
      for (const c of snubberCases) {
        const res = classifySpring({ bogieType: 'CASNUB_22_NLB', condition: 'NEW', position: 'SNUBBER', measuredHeight: c.mid });
        assert.strictEqual(res.band, c.band);
      }
    });

    it('Table 32 (HS New): classifies midpoints of all 3 bands across Outer, Inner, Snubber', () => {
      const outerCases = [
        { mid: 262.0, band: 'GREEN', roman: 'Band I' },
        { mid: 260.0, band: 'YELLOW', roman: 'Band II' },
        { mid: 258.0, band: 'RED', roman: 'Band III' }
      ];
      for (const c of outerCases) {
        const res = classifySpring({ bogieType: 'CASNUB_22_HS', condition: 'NEW', position: 'OUTER', measuredHeight: c.mid });
        assert.strictEqual(res.band, c.band);
      }

      const innerCases = [
        { mid: 245.0, band: 'GREEN', roman: 'Band I' },
        { mid: 243.0, band: 'YELLOW', roman: 'Band II' },
        { mid: 241.0, band: 'RED', roman: 'Band III' }
      ];
      for (const c of innerCases) {
        const res = classifySpring({ bogieType: 'CASNUB_22_HS', condition: 'NEW', position: 'INNER', measuredHeight: c.mid });
        assert.strictEqual(res.band, c.band);
      }

      const snubberCases = [
        { mid: 295.0, band: 'GREEN', roman: 'Band I' },
        { mid: 293.0, band: 'YELLOW', roman: 'Band II' },
        { mid: 291.0, band: 'RED', roman: 'Band III' }
      ];
      for (const c of snubberCases) {
        const res = classifySpring({ bogieType: 'CASNUB_22_HS', condition: 'NEW', position: 'SNUBBER', measuredHeight: c.mid });
        assert.strictEqual(res.band, c.band);
      }
    });

    it('Table 33 (RFT New): classifies midpoints of all 3 bands across Outer, Inner, Snubber', () => {
      const outerCases = [
        { mid: 274.0, band: 'GREEN', roman: 'Band I' },
        { mid: 272.0, band: 'YELLOW', roman: 'Band II' },
        { mid: 270.0, band: 'RED', roman: 'Band III' }
      ];
      for (const c of outerCases) {
        const res = classifySpring({ bogieType: 'CASNUB_22_RFT', condition: 'NEW', position: 'OUTER', measuredHeight: c.mid });
        assert.strictEqual(res.band, c.band);
      }

      const innerCases = [
        { mid: 239.0, band: 'GREEN', roman: 'Band I' },
        { mid: 237.0, band: 'YELLOW', roman: 'Band II' },
        { mid: 235.0, band: 'RED', roman: 'Band III' }
      ];
      for (const c of innerCases) {
        const res = classifySpring({ bogieType: 'CASNUB_22_RFT', condition: 'NEW', position: 'INNER', measuredHeight: c.mid });
        assert.strictEqual(res.band, c.band);
      }

      const snubberCases = [
        { mid: 306.0, band: 'GREEN', roman: 'Band I' },
        { mid: 304.0, band: 'YELLOW', roman: 'Band II' },
        { mid: 302.0, band: 'RED', roman: 'Band III' }
      ];
      for (const c of snubberCases) {
        const res = classifySpring({ bogieType: 'CASNUB_22_RFT', condition: 'NEW', position: 'SNUBBER', measuredHeight: c.mid });
        assert.strictEqual(res.band, c.band);
      }
    });
  });

});
