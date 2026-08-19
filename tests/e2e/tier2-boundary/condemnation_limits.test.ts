/**
 * Tier 2 Test Suite — Condemnation Micro-Limits & Boundary Precision
 * Indian Railways WRS Raipur (RDSO G-95 Rev-II)
 *
 * Verifies exact micro-step behavior (+0.01mm / -0.01mm) at condemning thresholds
 * across all RDSO tables and positions.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { classifySpring } from '../../harness/classification_engine.ts';

describe('Tier 2 — Condemnation Micro-Limits & Boundary Precision', () => {

  // Table 28 NLB Outer Used: Min 245.00mm, Max 263.00mm
  it('TC-CND-01: Table 28 Outer Used condemning limits (+0.01 / -0.01 mm)', () => {
    // Upper bound exact: 263.00 -> PASS (Band I)
    const exactMax = classifySpring({ bogieType: 'CASNUB_22_NLB', condition: 'USED', position: 'OUTER', measuredHeight: 263.00 });
    assert.strictEqual(exactMax.status, 'PASS');
    assert.strictEqual(exactMax.band, 'BLUE');

    // Upper bound + 0.01: 263.01 -> CONDEMNED
    const overMax = classifySpring({ bogieType: 'CASNUB_22_NLB', condition: 'USED', position: 'OUTER', measuredHeight: 263.01 });
    assert.strictEqual(overMax.status, 'CONDEMNED');
    assert.strictEqual(overMax.band, null);

    // Lower bound exact: 245.00 -> PASS (Band VI)
    const exactMin = classifySpring({ bogieType: 'CASNUB_22_NLB', condition: 'USED', position: 'OUTER', measuredHeight: 245.00 });
    assert.strictEqual(exactMin.status, 'PASS');
    assert.strictEqual(exactMin.band, 'RED');

    // Lower bound - 0.01: 244.99 -> CONDEMNED
    const underMin = classifySpring({ bogieType: 'CASNUB_22_NLB', condition: 'USED', position: 'OUTER', measuredHeight: 244.99 });
    assert.strictEqual(underMin.status, 'CONDEMNED');
    assert.strictEqual(underMin.band, null);
  });

  // Table 28 NLB Inner Used: Min 247.00mm, Max 265.00mm
  it('TC-CND-02: Table 28 Inner Used condemning limits (+0.01 / -0.01 mm)', () => {
    const exactMax = classifySpring({ bogieType: 'CASNUB_22_NLB', condition: 'USED', position: 'INNER', measuredHeight: 265.00 });
    assert.strictEqual(exactMax.status, 'PASS');
    assert.strictEqual(exactMax.band, 'BLUE');

    const overMax = classifySpring({ bogieType: 'CASNUB_22_NLB', condition: 'USED', position: 'INNER', measuredHeight: 265.01 });
    assert.strictEqual(overMax.status, 'CONDEMNED');

    const exactMin = classifySpring({ bogieType: 'CASNUB_22_NLB', condition: 'USED', position: 'INNER', measuredHeight: 247.00 });
    assert.strictEqual(exactMin.status, 'PASS');
    assert.strictEqual(exactMin.band, 'RED');

    const underMin = classifySpring({ bogieType: 'CASNUB_22_NLB', condition: 'USED', position: 'INNER', measuredHeight: 246.99 });
    assert.strictEqual(underMin.status, 'CONDEMNED');
  });

  // Table 29 HS Inner Used: Min 228.00mm, Max 246.00mm
  it('TC-CND-03: Table 29 Inner Used condemning limits (+0.01 / -0.01 mm)', () => {
    const exactMax = classifySpring({ bogieType: 'CASNUB_22_HS', condition: 'USED', position: 'INNER', measuredHeight: 246.00 });
    assert.strictEqual(exactMax.status, 'PASS');
    assert.strictEqual(exactMax.band, 'BLUE');

    const overMax = classifySpring({ bogieType: 'CASNUB_22_HS', condition: 'USED', position: 'INNER', measuredHeight: 246.01 });
    assert.strictEqual(overMax.status, 'CONDEMNED');

    const exactMin = classifySpring({ bogieType: 'CASNUB_22_HS', condition: 'USED', position: 'INNER', measuredHeight: 228.00 });
    assert.strictEqual(exactMin.status, 'PASS');
    assert.strictEqual(exactMin.band, 'RED');

    const underMin = classifySpring({ bogieType: 'CASNUB_22_HS', condition: 'USED', position: 'INNER', measuredHeight: 227.99 });
    assert.strictEqual(underMin.status, 'CONDEMNED');
  });

  // Table 30 RFT Snubber Used: Min 289.00mm, Max 307.00mm
  it('TC-CND-04: Table 30 Snubber Used condemning limits (+0.01 / -0.01 mm)', () => {
    const exactMax = classifySpring({ bogieType: 'CASNUB_22_RFT', condition: 'USED', position: 'SNUBBER', measuredHeight: 307.00 });
    assert.strictEqual(exactMax.status, 'PASS');
    assert.strictEqual(exactMax.band, 'BLUE');

    const overMax = classifySpring({ bogieType: 'CASNUB_22_RFT', condition: 'USED', position: 'SNUBBER', measuredHeight: 307.01 });
    assert.strictEqual(overMax.status, 'CONDEMNED');

    const exactMin = classifySpring({ bogieType: 'CASNUB_22_RFT', condition: 'USED', position: 'SNUBBER', measuredHeight: 289.00 });
    assert.strictEqual(exactMin.status, 'PASS');
    assert.strictEqual(exactMin.band, 'RED');

    const underMin = classifySpring({ bogieType: 'CASNUB_22_RFT', condition: 'USED', position: 'SNUBBER', measuredHeight: 288.99 });
    assert.strictEqual(underMin.status, 'CONDEMNED');
  });

  // Table 31 NLB Outer New: Min 257.00mm, Max 263.00mm (3 bands)
  it('TC-CND-05: Table 31 Outer New condemning limits (+0.01 / -0.01 mm)', () => {
    const exactMax = classifySpring({ bogieType: 'CASNUB_22_NLB', condition: 'NEW', position: 'OUTER', measuredHeight: 263.00 });
    assert.strictEqual(exactMax.status, 'PASS');
    assert.strictEqual(exactMax.band, 'GREEN');

    const overMax = classifySpring({ bogieType: 'CASNUB_22_NLB', condition: 'NEW', position: 'OUTER', measuredHeight: 263.01 });
    assert.strictEqual(overMax.status, 'CONDEMNED');

    const exactMin = classifySpring({ bogieType: 'CASNUB_22_NLB', condition: 'NEW', position: 'OUTER', measuredHeight: 257.00 });
    assert.strictEqual(exactMin.status, 'PASS');
    assert.strictEqual(exactMin.band, 'RED');

    const underMin = classifySpring({ bogieType: 'CASNUB_22_NLB', condition: 'NEW', position: 'OUTER', measuredHeight: 256.99 });
    assert.strictEqual(underMin.status, 'CONDEMNED');
  });

});
