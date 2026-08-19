/**
 * Tier 3 Test Suite — Cross-Feature Integration: Supervisor Override Flow
 * Indian Railways WRS Raipur
 *
 * Verifies supervisor override with OTP authentication, mandatory justification logging,
 * and complete dual-band preservation (originalBand and overrideBand).
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { TestApp } from '../../harness/test_app.ts';
import type { InspectionRecord } from '../../../shared/types.ts';

describe('Tier 3 — Supervisor Classification Override Workflow', () => {
  let app: TestApp;
  let supervisorToken: string;

  beforeEach(async () => {
    app = new TestApp(':memory:');
    const supLogin = await app.post('/api/auth/login', { username: 'supervisor1', password: 'password123' });
    supervisorToken = (supLogin.body as { token: string }).token;
  });

  it('TC-XF-02: Complete Supervisor Override with OTP and mandatory justification audit trail', async () => {
    // 1. Supervisor requests OTP for override
    const otpReq = await app.post('/api/auth/request-otp', { action: 'OVERRIDE' }, { Authorization: `Bearer ${supervisorToken}` });
    assert.strictEqual(otpReq.status, 200);
    const { otpId, codeForTest } = otpReq.body as { otpId: string; codeForTest: string };

    // 2. Supervisor verifies OTP code
    const verifyRes = await app.post('/api/auth/verify-otp', { otpId, otpCode: codeForTest }, { Authorization: `Bearer ${supervisorToken}` });
    assert.strictEqual(verifyRes.status, 200);
    const { otpToken } = verifyRes.body as { otpToken: string };

    // 3. Supervisor logs inspection with override
    const justification = 'Re-measured on precision vernier plate at ambient temp (25°C). Upper band transition verified.';
    const inspRes = await app.post(
      '/api/inspections',
      {
        wagonNumber: 'SE-BOXN-OVERRIDE-01',
        bogieType: 'CASNUB_22_NLB',
        springPosition: 'OUTER',
        condition: 'USED',
        measuredFreeHeight: 256.9, // Nominally Band III (Yellow)
        overrideBand: 'GREEN', // Overridden to Band II (Green)
        overrideReason: justification,
        otpToken
      },
      { Authorization: `Bearer ${supervisorToken}` }
    );

    assert.strictEqual(inspRes.status, 201);
    const record = inspRes.body as InspectionRecord;

    assert.strictEqual(record.isOverridden, true);
    assert.strictEqual(record.classifiedBand, 'GREEN'); // New override band
    assert.strictEqual(record.originalBand, 'YELLOW'); // Original auto-classified band
    assert.strictEqual(record.overrideBand, 'GREEN');
    assert.strictEqual(record.overrideReason, justification);
    assert.ok(record.supervisorId);
    assert.ok(record.supervisorName);

    // 4. Query audit log and verify override metadata is permanently stored
    const query = app.auditDb.getInspectionById(record.id);
    assert.ok(query);
    assert.strictEqual(query.isOverridden, true);
    assert.strictEqual(query.originalBand, 'YELLOW');
    assert.strictEqual(query.classifiedBand, 'GREEN');
    assert.strictEqual(query.overrideReason, justification);
  });

});
