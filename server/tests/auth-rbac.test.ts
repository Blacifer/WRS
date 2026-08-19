/**
 * Authentication & RBAC Integration Tests
 * Indian Railways WRS Raipur
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createApp } from '../src/app.ts';
import type { ExpressApp } from '../src/framework/index.ts';

// Helper for sending simulated HTTP requests to the Express app
async function mockFetch(app: ExpressApp, method: string, path: string, body?: any, headers: Record<string, string> = {}) {
  return app.dispatch({
    method,
    url: path,
    body,
    headers
  });
}

describe('Authentication & RBAC Route Tests', () => {
  let app: Express;

  beforeEach(() => {
    app = createApp(':memory:');
  });

  it('TC-AUTH-01: Successful login for default inspector returns JWT token and user profile', async () => {
    const res = await mockFetch(app, 'POST', '/api/auth/login', {
      username: 'inspector1',
      password: 'password123'
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.token);
    assert.strictEqual(res.body.user.role, 'INSPECTOR');
    assert.strictEqual(res.body.user.username, 'inspector1');
  });

  it('TC-AUTH-02: Invalid password returns 401 Unauthorized', async () => {
    const res = await mockFetch(app, 'POST', '/api/auth/login', {
      username: 'inspector1',
      password: 'wrongpassword'
    });

    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(res.body.error, 'INVALID_CREDENTIALS');
  });

  it('TC-AUTH-03: OTP Request & Verification flow', async () => {
    // 1. Login as supervisor
    const loginRes = await mockFetch(app, 'POST', '/api/auth/login', {
      username: 'supervisor1',
      password: 'password123'
    });

    const token = loginRes.body.token;

    // 2. Request OTP
    const otpReqRes = await mockFetch(
      app,
      'POST',
      '/api/auth/request-otp',
      { action: 'OVERRIDE' },
      { authorization: `Bearer ${token}` }
    );

    assert.strictEqual(otpReqRes.status, 200);
    assert.ok(otpReqRes.body.otpId);
    assert.ok(otpReqRes.body.devOtpCode);

    // 3. Verify OTP
    const otpVerifyRes = await mockFetch(
      app,
      'POST',
      '/api/auth/verify-otp',
      {
        otpId: otpReqRes.body.otpId,
        otpCode: otpReqRes.body.devOtpCode
      },
      { authorization: `Bearer ${token}` }
    );

    assert.strictEqual(otpVerifyRes.status, 200);
    assert.strictEqual(otpVerifyRes.body.success, true);
    assert.ok(otpVerifyRes.body.otpToken);
  });

  it('TC-AUTH-04: Inspector attempting override without justification is blocked', async () => {
    const loginRes = await mockFetch(app, 'POST', '/api/auth/login', {
      username: 'inspector1',
      password: 'password123'
    });

    const token = loginRes.body.token;

    const res = await mockFetch(
      app,
      'POST',
      '/api/inspections',
      {
        wagonNumber: 'BOXN-OVERRIDE-TEST',
        bogieType: 'CASNUB_22_NLB',
        condition: 'USED',
        position: 'OUTER',
        measuredHeight: 260.0,
        overrideBand: 'GREEN'
      },
      { authorization: `Bearer ${token}` }
    );

    assert.strictEqual(res.status, 403, 'Inspector should not be allowed to perform override');
  });
});
