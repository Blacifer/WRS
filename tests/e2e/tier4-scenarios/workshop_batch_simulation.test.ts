/**
 * Tier 4 Test Suite — Real-World Application Scenario: Full Workshop Batch Simulation (100+ Springs)
 * Indian Railways WRS Raipur
 *
 * Simulates an entire production overhaul shift inspecting 120 bogie springs across
 * 10 wagons (CASNUB 22 NLB, 22 HS, 22 RFT), measuring throughput, band distribution,
 * condemnation rate (~10-15%), and sequential audit trail immutability.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { TestApp } from '../../harness/test_app.ts';
import { getRDSOTable } from '../../harness/classification_engine.ts';
import type { BogieType, SpringCondition, SpringPosition, DamageType, InspectionRecord, InspectionStats } from '../../../shared/types.ts';

describe('Tier 4 — Full Workshop Batch Simulation (100+ Springs)', () => {
  let app: TestApp;
  let inspectorToken: string;
  let supervisorToken: string;

  beforeEach(async () => {
    app = new TestApp(':memory:');
    const inspLogin = await app.post('/api/auth/login', { username: 'inspector1', password: 'password123' });
    inspectorToken = (inspLogin.body as { token: string }).token;

    const supLogin = await app.post('/api/auth/login', { username: 'supervisor1', password: 'password123' });
    supervisorToken = (supLogin.body as { token: string }).token;
  });

  it('TC-SCN-01: Simulates 120-spring overhaul shift across 10 wagons with complete audit integrity', async () => {
    const TOTAL_SPRINGS = 120;
    const wagons = [
      'SE-BOXN-2101', 'SE-BOXN-2102', 'SE-BOXN-2103', 'SE-BOXN-2104', 'SE-BOXN-2105',
      'SE-BCN-3101', 'SE-BCN-3102', 'SE-BCN-3103', 'SE-BCN-3104', 'SE-BCN-3105'
    ];

    const bogieTypes: BogieType[] = ['CASNUB_22_NLB', 'CASNUB_22_HS', 'CASNUB_22_RFT'];
    const positions: SpringPosition[] = ['OUTER', 'INNER', 'SNUBBER'];
    const conditions: SpringCondition[] = ['USED', 'NEW'];

    const startTime = performance.now();
    const createdRecords: InspectionRecord[] = [];

    // Generate and log 120 realistic spring inspections
    for (let i = 0; i < TOTAL_SPRINGS; i++) {
      const wagonNumber = wagons[i % wagons.length];
      const bogieType = bogieTypes[i % bogieTypes.length];
      const springPosition = positions[i % positions.length];
      const condition = i % 5 === 0 ? 'NEW' : 'USED'; // 20% New, 80% Used

      let measuredFreeHeight: number;
      let damageType: DamageType = 'NONE';
      let damageNotes: string | undefined;

      // Introduce realistic distribution:
      // ~10% condemned due to height wear or physical cracks (i % 10 === 0 or i % 12 === 0)
      const table = getRDSOTable(bogieType, condition, springPosition)!;
      if (i % 10 === 0) {
        // Under-height condemned (below min permissible limit)
        measuredFreeHeight = table.condemningMinHeight - 2.5;
      } else if (i % 12 === 0) {
        // Physical crack damage
        measuredFreeHeight = table.condemningMaxHeight - 1.0;
        damageType = 'CRACK';
        damageNotes = `Coil hairline crack found on spring #${i + 1}`;
      } else {
        // Normal distribution across valid bands
        const span = table.condemningMaxHeight - table.condemningMinHeight;
        const fraction = 0.15 + (i % 7) * 0.1;
        measuredFreeHeight = Number((table.condemningMinHeight + span * fraction).toFixed(2));
      }

      const res = await app.post(
        '/api/inspections',
        {
          wagonNumber,
          bogieType,
          springPosition,
          condition,
          measuredFreeHeight,
          damageType,
          damageNotes
        },
        { Authorization: `Bearer ${inspectorToken}` }
      );

      assert.strictEqual(res.status, 201, `Failed logging inspection #${i + 1}`);
      createdRecords.push(res.body as InspectionRecord);
    }

    const durationMs = performance.now() - startTime;

    // 1. Verify total count
    assert.strictEqual(createdRecords.length, TOTAL_SPRINGS);

    // 2. Verify consecutive monotonic sequence IDs from 1 to 120
    for (let i = 0; i < TOTAL_SPRINGS; i++) {
      assert.strictEqual(createdRecords[i].sequenceNumber, i + 1, `Record at index ${i} must have sequenceNumber ${i + 1}`);
    }

    // 3. Verify statistics aggregation
    const statsRes = await app.get('/api/inspections/stats', { Authorization: `Bearer ${supervisorToken}` });
    assert.strictEqual(statsRes.status, 200);
    const stats = statsRes.body as InspectionStats;

    assert.strictEqual(stats.totalInspections, TOTAL_SPRINGS);
    assert.ok(stats.totalPassed > 0);
    assert.ok(stats.totalCondemned > 0);
    assert.ok(stats.condemnationRatePercentage >= 10.0 && stats.condemnationRatePercentage <= 25.0,
      `Condemnation rate ${stats.condemnationRatePercentage}% should be in realistic 10-25% range`);

    // 4. Verify workshop throughput latency: 120 inspections logged in under 2 seconds total
    assert.ok(durationMs < 2000, `Batch simulation took ${durationMs.toFixed(2)}ms (must be under 2000ms)`);
  });

});
