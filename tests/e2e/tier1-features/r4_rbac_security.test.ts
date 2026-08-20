/**
 * Tier 1 Test Suite — Feature R4: Role-Based Access Control (RBAC) & Security
 * Indian Railways WRS Raipur
 *
 * Verifies 3 distinct roles (Inspector, Supervisor, Admin), JWT authentication,
 * OTP verification for sensitive operations, and 401/403 authorization guards.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { TestApp } from '../../harness/test_app.ts';
import { canAccessTab, isUserInspector, isUserSupervisorOrAdmin } from '../../../shared/types.ts';

describe('Tier 1 — R4: Role-Based Access Control & Security', () => {
  let app: TestApp;
  let inspectorToken: string;
  let supervisorToken: string;
  let adminToken: string;

  beforeEach(async () => {
    app = new TestApp(':memory:');

    const inspLogin = await app.post('/api/auth/login', { username: 'inspector1', password: 'password123' });
    inspectorToken = (inspLogin.body as { token: string }).token;

    const supLogin = await app.post('/api/auth/login', { username: 'supervisor1', password: 'password123' });
    supervisorToken = (supLogin.body as { token: string }).token;

    const admLogin = await app.post('/api/auth/login', { username: 'admin1', password: 'password123' });
    adminToken = (admLogin.body as { token: string }).token;
  });

  // Test Case 1: Inspector Login & Allowed Actions
  it('TC-R4-01: Inspector can log inspections and view their own sessions', async () => {
    const meRes = await app.get('/api/auth/me', { Authorization: `Bearer ${inspectorToken}` });
    assert.strictEqual(meRes.status, 200);
    assert.strictEqual((meRes.body as { user: { role: string } }).user.role, 'Inspector');

    const inspRes = await app.post(
      '/api/inspections',
      {
        wagonNumber: 'SE-BOXN-101010',
        bogieType: 'CASNUB_22_NLB',
        springPosition: 'OUTER',
        condition: 'USED',
        measuredFreeHeight: 260.0
      },
      { Authorization: `Bearer ${inspectorToken}` }
    );

    assert.strictEqual(inspRes.status, 201);
    assert.strictEqual((inspRes.body as { classifiedBand: string }).classifiedBand, 'BLUE');
  });

  // Test Case 2: Inspector Forbidden Actions (403 Forbidden)
  it('TC-R4-02: Inspector is prohibited from viewing stats reports, overriding, or exporting data (403 Forbidden)', async () => {
    // Attempt stats view
    const statsRes = await app.get('/api/inspections/stats', { Authorization: `Bearer ${inspectorToken}` });
    assert.strictEqual(statsRes.status, 403);

    // Attempt export
    const exportRes = await app.get('/api/inspections/export', { Authorization: `Bearer ${inspectorToken}` });
    assert.strictEqual(exportRes.status, 403);

    // Attempt override
    const overrideRes = await app.post(
      '/api/inspections',
      {
        wagonNumber: 'SE-BOXN-202020',
        bogieType: 'CASNUB_22_NLB',
        springPosition: 'OUTER',
        condition: 'USED',
        measuredFreeHeight: 257.0,
        overrideBand: 'BLUE',
        overrideReason: 'Inspector trying to override'
      },
      { Authorization: `Bearer ${inspectorToken}` }
    );
    assert.strictEqual(overrideRes.status, 403);
  });

  // Test Case 3: Supervisor can view stats reports and perform overrides with OTP
  it('TC-R4-03: Supervisor can access stats reports and execute classification override with OTP justification', async () => {
    // 1. View stats
    const statsRes = await app.get('/api/inspections/stats', { Authorization: `Bearer ${supervisorToken}` });
    assert.strictEqual(statsRes.status, 200);

    // 2. Request OTP for override
    const otpReq = await app.post('/api/auth/request-otp', { action: 'OVERRIDE' }, { Authorization: `Bearer ${supervisorToken}` });
    assert.strictEqual(otpReq.status, 200);
    const { otpId, codeForTest } = otpReq.body as { otpId: string; codeForTest: string };

    // 3. Verify OTP
    const verifyRes = await app.post('/api/auth/verify-otp', { otpId, otpCode: codeForTest }, { Authorization: `Bearer ${supervisorToken}` });
    assert.strictEqual(verifyRes.status, 200);
    const { otpToken } = verifyRes.body as { otpToken: string };

    // 4. Submit inspection with override
    const inspRes = await app.post(
      '/api/inspections',
      {
        wagonNumber: 'SE-BOXN-303030',
        bogieType: 'CASNUB_22_NLB',
        springPosition: 'OUTER',
        condition: 'USED',
        measuredFreeHeight: 257.0, // Nominally Band II (Green)
        overrideBand: 'BLUE', // Overridden to Band I (Blue)
        overrideReason: 'Visual re-verification by Senior Section Engineer confirms upper boundary alignment',
        otpToken
      },
      { Authorization: `Bearer ${supervisorToken}` }
    );

    assert.strictEqual(inspRes.status, 201);
    const record = inspRes.body as { isOverridden: boolean; classifiedBand: string; originalBand: string; overrideReason: string };
    assert.strictEqual(record.isOverridden, true);
    assert.strictEqual(record.classifiedBand, 'BLUE');
    assert.strictEqual(record.originalBand, 'GREEN');
    assert.ok(record.overrideReason.includes('Senior Section Engineer'));
  });

  // Test Case 4: Admin full access including OTP-authorized data export
  it('TC-R4-04: Admin has full access to inspect, view reports, and export audit data with OTP', async () => {
    // Log a record first
    await app.post(
      '/api/inspections',
      {
        wagonNumber: 'SE-BOXN-404040',
        bogieType: 'CASNUB_22_NLB',
        springPosition: 'OUTER',
        condition: 'USED',
        measuredFreeHeight: 260.0
      },
      { Authorization: `Bearer ${adminToken}` }
    );

    // Request OTP for EXPORT
    const otpReq = await app.post('/api/auth/request-otp', { action: 'EXPORT' }, { Authorization: `Bearer ${adminToken}` });
    const { otpId, codeForTest } = otpReq.body as { otpId: string; codeForTest: string };

    // Verify OTP
    const verifyRes = await app.post('/api/auth/verify-otp', { otpId, otpCode: codeForTest }, { Authorization: `Bearer ${adminToken}` });
    const { otpToken } = verifyRes.body as { otpToken: string };

    // Export CSV
    const exportCsv = await app.get('/api/inspections/export?format=csv', {
      Authorization: `Bearer ${adminToken}`,
      'x-otp-token': otpToken
    });

    assert.strictEqual(exportCsv.status, 200);
    assert.ok(typeof exportCsv.body === 'string');
    assert.ok(exportCsv.body.includes('SequenceNumber,Timestamp,WagonNumber'));
  });

  // Test Case 5: 401 Unauthorized for missing authentication
  it('TC-R4-05: Missing or empty Authorization token returns 401 Unauthorized', async () => {
    const res = await app.get('/api/inspections');
    assert.strictEqual(res.status, 401);
  });

  // Test Case 6: 401 Unauthorized for tampered or invalid bearer token
  it('TC-R4-06: Tampered or invalid bearer token returns 401 Unauthorized', async () => {
    const tamperedToken = `${inspectorToken.substring(0, inspectorToken.length - 6)}FAKE12`;
    const res = await app.get('/api/inspections', { Authorization: `Bearer ${tamperedToken}` });
    assert.strictEqual(res.status, 401);
  });

  // Test Case 7: Single-use OTP token enforcement
  it('TC-R4-07: OTP token cannot be re-used twice for sensitive actions (single-use consumption)', async () => {
    // 1. Request & verify OTP
    const otpReq = await app.post('/api/auth/request-otp', { action: 'OVERRIDE' }, { Authorization: `Bearer ${supervisorToken}` });
    const { otpId, codeForTest } = otpReq.body as { otpId: string; codeForTest: string };
    const verifyRes = await app.post('/api/auth/verify-otp', { otpId, otpCode: codeForTest }, { Authorization: `Bearer ${supervisorToken}` });
    const { otpToken } = verifyRes.body as { otpToken: string };

    // 2. Use OTP token first time -> Success
    const firstUse = await app.post(
      '/api/inspections',
      {
        wagonNumber: 'SE-BOXN-505050',
        bogieType: 'CASNUB_22_NLB',
        springPosition: 'OUTER',
        condition: 'USED',
        measuredFreeHeight: 257.0,
        overrideBand: 'BLUE',
        overrideReason: 'First override with OTP token',
        otpToken
      },
      { Authorization: `Bearer ${supervisorToken}` }
    );
    assert.strictEqual(firstUse.status, 201);

    // 3. Attempt re-use of same OTP token -> 403 Forbidden
    const secondUse = await app.post(
      '/api/inspections',
      {
        wagonNumber: 'SE-BOXN-505051',
        bogieType: 'CASNUB_22_NLB',
        springPosition: 'OUTER',
        condition: 'USED',
        measuredFreeHeight: 257.0,
        overrideBand: 'BLUE',
        overrideReason: 'Second override trying to re-use consumed token',
        otpToken
      },
      { Authorization: `Bearer ${supervisorToken}` }
    );
    assert.strictEqual(secondUse.status, 403);
  });

  // Test Case 8: Inspector role UX isolation & route guard access checks
  it('TC-R4-08: canAccessTab route security strictly confines Inspector to inspector_home, inspection, smart_vision, and active checklist', () => {
    // Inspector allowed tabs
    assert.strictEqual(canAccessTab('INSPECTOR', 'inspector_home'), true);
    assert.strictEqual(canAccessTab('INSPECTOR', 'inspection'), true);
    assert.strictEqual(canAccessTab('INSPECTOR', 'smart_vision'), true);

    // Inspector accessing wagons pipeline with active selected wagon (WagonDetailPage checklist) -> allowed
    assert.strictEqual(canAccessTab('INSPECTOR', 'wagons', true), true);

    // Inspector accessing wagons table without selected wagon -> blocked (redirects to inspector_home)
    assert.strictEqual(canAccessTab('INSPECTOR', 'wagons', false), false);

    // Inspector prohibited from administrative & supervisory tabs
    assert.strictEqual(canAccessTab('INSPECTOR', 'dashboard'), false);
    assert.strictEqual(canAccessTab('INSPECTOR', 'inventory'), false);
    assert.strictEqual(canAccessTab('INSPECTOR', 'passports'), false);
    assert.strictEqual(canAccessTab('INSPECTOR', 'history'), false);
    assert.strictEqual(canAccessTab('INSPECTOR', 'analytics'), false);
    assert.strictEqual(canAccessTab('INSPECTOR', 'admin'), false);
  });

  // Test Case 9: Supervisor and Admin tab access permissions
  it('TC-R4-09: canAccessTab grants Supervisor pipeline & inventory access while restricting DRM analytics; Admin has full access', () => {
    // Supervisor permissions
    assert.strictEqual(canAccessTab('SUPERVISOR', 'wagons'), true);
    assert.strictEqual(canAccessTab('SUPERVISOR', 'inventory'), true);
    assert.strictEqual(canAccessTab('SUPERVISOR', 'passports'), true);
    assert.strictEqual(canAccessTab('SUPERVISOR', 'history'), true);
    assert.strictEqual(canAccessTab('SUPERVISOR', 'admin'), true);
    // Supervisor restricted from high-level DRM analytics/dashboards
    assert.strictEqual(canAccessTab('SUPERVISOR', 'dashboard'), false);
    assert.strictEqual(canAccessTab('SUPERVISOR', 'analytics'), false);

    // Admin has full access to all tabs
    assert.strictEqual(canAccessTab('ADMIN', 'wagons'), true);
    assert.strictEqual(canAccessTab('ADMIN', 'dashboard'), true);
    assert.strictEqual(canAccessTab('ADMIN', 'inventory'), true);
    assert.strictEqual(canAccessTab('ADMIN', 'passports'), true);
    assert.strictEqual(canAccessTab('ADMIN', 'history'), true);
    assert.strictEqual(canAccessTab('ADMIN', 'analytics'), true);
    assert.strictEqual(canAccessTab('ADMIN', 'admin'), true);
  });

  // Test Case 10: Role case-insensitivity and helper utilities
  it('TC-R4-10: isUserInspector and isUserSupervisorOrAdmin handle case variations gracefully', () => {
    assert.strictEqual(isUserInspector('Inspector'), true);
    assert.strictEqual(isUserInspector('INSPECTOR'), true);
    assert.strictEqual(isUserInspector('inspector'), true);
    assert.strictEqual(isUserInspector('Supervisor'), false);
    assert.strictEqual(isUserInspector(null), false);
    assert.strictEqual(isUserInspector(undefined), false);

    assert.strictEqual(isUserSupervisorOrAdmin('Supervisor'), true);
    assert.strictEqual(isUserSupervisorOrAdmin('SUPERVISOR'), true);
    assert.strictEqual(isUserSupervisorOrAdmin('Admin'), true);
    assert.strictEqual(isUserSupervisorOrAdmin('ADMIN'), true);
    assert.strictEqual(isUserSupervisorOrAdmin('Inspector'), false);
    assert.strictEqual(isUserSupervisorOrAdmin(null), false);
  });
});
