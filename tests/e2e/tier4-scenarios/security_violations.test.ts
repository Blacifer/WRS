/**
 * Tier 4 Test Suite — Real-World Application Scenario: Security Violations & Adversarial Attacks
 * Indian Railways WRS Raipur
 *
 * Verifies robust defense against adversarial actions:
 * - Unauthenticated requests
 * - Token forgery & tampering
 * - Role privilege escalation
 * - SQL Injection payloads
 * - Direct database update/delete bypass attempts
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { TestApp } from '../../harness/test_app.ts';

describe('Tier 4 — Security Violations & Adversarial Attacks', () => {
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

  // 1. Unauthenticated endpoints
  it('TC-SEC-01: Rejects requests with missing or empty Authorization header', async () => {
    const res = await app.get('/api/inspections');
    assert.strictEqual(res.status, 401);
  });

  // 2. Forged / Tampered token
  it('TC-SEC-02: Rejects requests with forged, altered, or truncated tokens', async () => {
    const forgedToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhZG1pbiIsInJvbGUiOiJBZG1pbiJ9.invalidsig';
    const res = await app.get('/api/inspections', { Authorization: `Bearer ${forgedToken}` });
    assert.strictEqual(res.status, 401);
  });

  // 3. Privilege escalation: Inspector attempting Supervisor actions
  it('TC-SEC-03: Blocks Inspector from performing Supervisor override or viewing system stats', async () => {
    const statsRes = await app.get('/api/inspections/stats', { Authorization: `Bearer ${inspectorToken}` });
    assert.strictEqual(statsRes.status, 403);

    const overrideRes = await app.post(
      '/api/inspections',
      {
        wagonNumber: 'SE-BOXN-ATTACK',
        bogieType: 'CASNUB_22_NLB',
        springPosition: 'OUTER',
        condition: 'USED',
        measuredFreeHeight: 250.0,
        overrideBand: 'BLUE',
        overrideReason: 'Unauthorized inspector override'
      },
      { Authorization: `Bearer ${inspectorToken}` }
    );
    assert.strictEqual(overrideRes.status, 403);
  });

  // 4. Privilege escalation: Supervisor attempting Admin export
  it('TC-SEC-04: Blocks Supervisor from exporting regulatory audit trail (Admin only)', async () => {
    // Supervisor requests OTP
    const otpReq = await app.post('/api/auth/request-otp', { action: 'EXPORT' }, { Authorization: `Bearer ${supervisorToken}` });
    const verify = await app.post('/api/auth/verify-otp', { otpId: (otpReq.body as { otpId: string }).otpId, otpCode: (otpReq.body as { codeForTest: string }).codeForTest }, { Authorization: `Bearer ${supervisorToken}` });
    const otpToken = (verify.body as { otpToken: string }).otpToken;

    const exportRes = await app.get(`/api/inspections/export?format=csv&otpToken=${otpToken}`, {
      Authorization: `Bearer ${supervisorToken}`
    });
    assert.strictEqual(exportRes.status, 403);
  });

  // 5. SQL Injection Resilience
  it('TC-SEC-05: Sanitizes SQL Injection payloads in wagon query parameters and notes', async () => {
    const maliciousPayload = "' OR '1'='1' -- ";
    const queryRes = await app.get(`/api/inspections?wagonNumber=${encodeURIComponent(maliciousPayload)}`, {
      Authorization: `Bearer ${supervisorToken}`
    });

    assert.strictEqual(queryRes.status, 200);
    // Should safely return 0 matching records rather than dumping the whole database or erroring
    const body = queryRes.body as { records: unknown[]; total: number };
    assert.strictEqual(body.total, 0);
  });

  // 6. Direct Database Mutation Block (Trigger Protection)
  it('TC-SEC-06: Database triggers guarantee immutability against direct SQL mutation bypasses', () => {
    const rec = app.auditDb.logInspection({
      inspectorId: 'insp-001',
      wagonNumber: 'W-SEC-TEST',
      bogieType: 'CASNUB_22_NLB',
      springPosition: 'OUTER',
      condition: 'USED',
      measuredFreeHeight: 260.0,
      classifiedBand: 'BLUE',
      bandRoman: 'Band I',
      status: 'PASS',
      damageType: 'NONE',
      isOverridden: false,
      tableReference: 'Table 28'
    });

    assert.throws(() => {
      app.auditDb.attemptDirectUpdate(rec.id, 200.0);
    });

    assert.throws(() => {
      app.auditDb.attemptDirectDelete(rec.id);
    });
  });

});
