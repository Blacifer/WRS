/**
 * Tier 3 Test Suite — Cross-Feature Integration: Multi-Filter & Analytics Summary Flow
 * Indian Railways WRS Raipur
 *
 * Verifies that multiple inspection logs across different inspectors, wagons,
 * and bogie types correctly feed into multi-criteria queries and aggregate statistics.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { TestApp } from '../../harness/test_app.ts';
import type { InspectionStats, InspectionRecord } from '../../../shared/types.ts';

describe('Tier 3 — Multi-Filter & Analytics Summary Workflow', () => {
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

  it('TC-XF-03: Multiple inspections correctly aggregate into multi-filter queries and workshop analytics', async () => {
    // Seed 10 inspections
    const batch = [
      { wagon: 'WAGON-100', height: 261.0, type: 'CASNUB_22_NLB', pos: 'OUTER', cond: 'USED', damage: 'NONE' },
      { wagon: 'WAGON-100', height: 258.0, type: 'CASNUB_22_NLB', pos: 'OUTER', cond: 'USED', damage: 'NONE' },
      { wagon: 'WAGON-100', height: 240.0, type: 'CASNUB_22_NLB', pos: 'OUTER', cond: 'USED', damage: 'NONE' }, // Condemned (under height)
      { wagon: 'WAGON-200', height: 244.0, type: 'CASNUB_22_HS', pos: 'INNER', cond: 'USED', damage: 'NONE' },
      { wagon: 'WAGON-200', height: 241.0, type: 'CASNUB_22_HS', pos: 'INNER', cond: 'USED', damage: 'CRACK' }, // Condemned (crack)
      { wagon: 'WAGON-300', height: 305.0, type: 'CASNUB_22_RFT', pos: 'SNUBBER', cond: 'NEW', damage: 'NONE' },
      { wagon: 'WAGON-300', height: 302.0, type: 'CASNUB_22_RFT', pos: 'SNUBBER', cond: 'NEW', damage: 'NONE' },
      { wagon: 'WAGON-300', height: 262.0, type: 'CASNUB_22_NLB', pos: 'OUTER', cond: 'NEW', damage: 'NONE' },
      { wagon: 'WAGON-400', height: 259.0, type: 'CASNUB_22_NLB', pos: 'OUTER', cond: 'NEW', damage: 'NONE' },
      { wagon: 'WAGON-400', height: 257.0, type: 'CASNUB_22_NLB', pos: 'OUTER', cond: 'NEW', damage: 'NONE' }
    ];

    for (const item of batch) {
      await app.post(
        '/api/inspections',
        {
          wagonNumber: item.wagon,
          bogieType: item.type,
          springPosition: item.pos,
          condition: item.cond,
          measuredFreeHeight: item.height,
          damageType: item.damage
        },
        { Authorization: `Bearer ${inspectorToken}` }
      );
    }

    // 1. Multi-filter: WAGON-100 only
    const wagon100Res = await app.get('/api/inspections?wagonNumber=WAGON-100', { Authorization: `Bearer ${supervisorToken}` });
    const wagon100Data = wagon100Res.body as { records: InspectionRecord[]; total: number };
    assert.strictEqual(wagon100Data.total, 3);

    // 2. Multi-filter: Status CONDEMNED
    const condemnedRes = await app.get('/api/inspections?status=CONDEMNED', { Authorization: `Bearer ${supervisorToken}` });
    const condemnedData = condemnedRes.body as { records: InspectionRecord[]; total: number };
    assert.strictEqual(condemnedData.total, 2);

    // 3. Analytics stats calculation
    const statsRes = await app.get('/api/inspections/stats', { Authorization: `Bearer ${supervisorToken}` });
    assert.strictEqual(statsRes.status, 200);
    const stats = statsRes.body as InspectionStats;

    assert.strictEqual(stats.totalInspections, 10);
    assert.strictEqual(stats.totalPassed, 8);
    assert.strictEqual(stats.totalCondemned, 2);
    assert.strictEqual(stats.condemnationRatePercentage, 20.0);
    assert.strictEqual(stats.damageTypeDistribution.CRACK, 1);
  });

});
