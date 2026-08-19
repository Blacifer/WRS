/**
 * Tier 4 Test Suite — Real-World Application Scenario: Audit Data Export with OTP Security
 * Indian Railways WRS Raipur
 *
 * Verifies regulatory audit data export (CSV/JSON), mandatory DRM/Admin OTP authentication,
 * and complete CSV header and field structure verification.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { TestApp } from '../../harness/test_app.ts';

describe('Tier 4 — Audit Data Export with OTP Security', () => {
  let app: TestApp;
  let adminToken: string;

  beforeEach(async () => {
    app = new TestApp(':memory:');
    const adminLogin = await app.post('/api/auth/login', { username: 'admin1', password: 'password123' });
    adminToken = (adminLogin.body as { token: string }).token;

    // Seed 5 sample inspections for export
    for (let i = 1; i <= 5; i++) {
      await app.post(
        '/api/inspections',
        {
          wagonNumber: `SE-BOXN-EXP-0${i}`,
          bogieType: 'CASNUB_22_NLB',
          springPosition: 'OUTER',
          condition: 'USED',
          measuredFreeHeight: 260.0 - i,
          damageType: 'NONE'
        },
        { Authorization: `Bearer ${adminToken}` }
      );
    }
  });

  it('TC-SCN-03: Regulatory audit trail export generates valid CSV and JSON after OTP authorization', async () => {
    // 1. Attempt export without OTP -> 403 Forbidden
    const unauthExport = await app.get('/api/inspections/export?format=csv', { Authorization: `Bearer ${adminToken}` });
    assert.strictEqual(unauthExport.status, 403);
    assert.ok((unauthExport.body as { error: string }).error.includes('OTP'));

    // 2. Request OTP for EXPORT
    const otpReq = await app.post('/api/auth/request-otp', { action: 'EXPORT' }, { Authorization: `Bearer ${adminToken}` });
    assert.strictEqual(otpReq.status, 200);
    const { otpId, codeForTest } = otpReq.body as { otpId: string; codeForTest: string };

    // 3. Verify OTP
    const verifyRes = await app.post('/api/auth/verify-otp', { otpId, otpCode: codeForTest }, { Authorization: `Bearer ${adminToken}` });
    assert.strictEqual(verifyRes.status, 200);
    const { otpToken } = verifyRes.body as { otpToken: string };

    // 4. Request CSV Export with valid OTP token
    const csvRes = await app.get(`/api/inspections/export?format=csv&otpToken=${otpToken}`, {
      Authorization: `Bearer ${adminToken}`
    });
    assert.strictEqual(csvRes.status, 200);
    assert.strictEqual(csvRes.headers['content-type'], 'text/csv');

    const csvContent = csvRes.body as string;
    const lines = csvContent.trim().split('\n');

    // Header line + 5 record lines = 6 lines
    assert.strictEqual(lines.length, 6);
    assert.ok(lines[0].includes('SequenceNumber,Timestamp,WagonNumber,BogieType'));
    assert.ok(csvContent.includes('SE-BOXN-EXP-01'));
    assert.ok(csvContent.includes('SE-BOXN-EXP-05'));

    // 5. Request JSON Export with new OTP
    const otpReq2 = await app.post('/api/auth/request-otp', { action: 'EXPORT' }, { Authorization: `Bearer ${adminToken}` });
    const verify2 = await app.post('/api/auth/verify-otp', { otpId: (otpReq2.body as { otpId: string }).otpId, otpCode: (otpReq2.body as { codeForTest: string }).codeForTest }, { Authorization: `Bearer ${adminToken}` });
    const otpToken2 = (verify2.body as { otpToken: string }).otpToken;

    const jsonRes = await app.get(`/api/inspections/export?format=json&otpToken=${otpToken2}`, {
      Authorization: `Bearer ${adminToken}`
    });
    assert.strictEqual(jsonRes.status, 200);
    const jsonData = jsonRes.body as { totalRecords: number; inspections: unknown[] };
    assert.strictEqual(jsonData.totalRecords, 5);
    assert.strictEqual(jsonData.inspections.length, 5);
  });

});
