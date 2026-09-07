/**
 * Changing a password
 * Indian Railways WRS Raipur
 *
 * WHY THESE EXIST
 * ---------------
 * Until these routes were added there was no way for anybody to change a
 * password. The production login guard already refused accounts still on the
 * demonstration password and told the administrator to "set a real password
 * for it from the User Accounts screen" — a screen with no such control. The
 * error named a remedy the application did not have.
 *
 * What is worth guarding is not that the happy path works. It is that the
 * change cannot be made by the wrong person: not with a lifted bearer token
 * and no knowledge of the current password, and not by a supervisor reaching
 * for somebody else's account.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createApp } from '../src/app.ts';
import type { ExpressApp } from '../src/framework/index.ts';

async function call(app: ExpressApp, method: string, path: string, body?: any, headers: Record<string, string> = {}) {
  return app.dispatch({ method, url: path, body, headers });
}

async function signIn(app: ExpressApp, username: string, password = 'password123'): Promise<string> {
  const res = await call(app, 'POST', '/api/auth/login', { username, password });
  assert.strictEqual(res.status, 200, `sign-in failed for ${username}: ${JSON.stringify(res.body)}`);
  return res.body.token;
}

/** A USER_MGMT confirmation token, the way the screen obtains one. */
async function userMgmtToken(app: ExpressApp, bearer: string): Promise<string> {
  const req = await call(app, 'POST', '/api/auth/request-otp', { action: 'USER_MGMT' }, { authorization: `Bearer ${bearer}` });
  assert.strictEqual(req.status, 200, JSON.stringify(req.body));
  const verify = await call(
    app, 'POST', '/api/auth/verify-otp',
    { otpId: req.body.otpId, otpCode: req.body.devOtpCode },
    { authorization: `Bearer ${bearer}` }
  );
  assert.strictEqual(verify.status, 200, JSON.stringify(verify.body));
  return verify.body.otpToken;
}

describe('Changing a password', () => {
  let app: ExpressApp;

  beforeEach(() => {
    app = createApp(':memory:');
  });

  it('TC-PWD-01: an inspector can change their own password, and the new one works', async () => {
    const token = await signIn(app, 'inspector1');

    const res = await call(
      app, 'POST', '/api/auth/password',
      { currentPassword: 'password123', newPassword: 'a-longer-one-99' },
      { authorization: `Bearer ${token}` }
    );
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));

    // The point of the whole exercise: the old one stops working...
    const old = await call(app, 'POST', '/api/auth/login', { username: 'inspector1', password: 'password123' });
    assert.strictEqual(old.status, 401);

    // ...and the new one is accepted.
    const fresh = await call(app, 'POST', '/api/auth/login', { username: 'inspector1', password: 'a-longer-one-99' });
    assert.strictEqual(fresh.status, 200, JSON.stringify(fresh.body));
  });

  it('TC-PWD-02: a valid session is not enough — the current password is required', async () => {
    // The tablet left unlocked on the bench. Whoever picks it up holds a valid
    // token; without this check they could lock the owner out of their own name.
    const token = await signIn(app, 'inspector1');

    const res = await call(
      app, 'POST', '/api/auth/password',
      { currentPassword: 'not-the-password', newPassword: 'a-longer-one-99' },
      { authorization: `Bearer ${token}` }
    );
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.error, 'WRONG_PASSWORD');

    const still = await call(app, 'POST', '/api/auth/login', { username: 'inspector1', password: 'password123' });
    assert.strictEqual(still.status, 200, 'the password must not have changed');
  });

  it('TC-PWD-03: the demonstration password cannot be set, in either route', async () => {
    // Production logins refuse it, so accepting it here would hand somebody an
    // account that cannot sign in at all.
    const token = await signIn(app, 'inspector1');
    const self = await call(
      app, 'POST', '/api/auth/password',
      { currentPassword: 'password123', newPassword: 'password123' },
      { authorization: `Bearer ${token}` }
    );
    assert.strictEqual(self.status, 400);

    const adminToken = await signIn(app, 'admin1');
    const otp = await userMgmtToken(app, adminToken);
    const byAdmin = await call(
      app, 'POST', '/api/auth/users/usr_insp_002/password',
      { password: 'password123', otpToken: otp },
      { authorization: `Bearer ${adminToken}` }
    );
    assert.strictEqual(byAdmin.status, 400);
  });

  it('TC-PWD-04: too short is refused, and nothing changes', async () => {
    const token = await signIn(app, 'inspector1');
    const res = await call(
      app, 'POST', '/api/auth/password',
      { currentPassword: 'password123', newPassword: 'short' },
      { authorization: `Bearer ${token}` }
    );
    assert.strictEqual(res.status, 400);

    const still = await call(app, 'POST', '/api/auth/login', { username: 'inspector1', password: 'password123' });
    assert.strictEqual(still.status, 200);
  });

  it('TC-PWD-05: an administrator can set a password without knowing the old one', async () => {
    // The case this exists for: an inspector who has forgotten theirs cannot
    // supply it, so authority comes from users.manage plus the OTP instead.
    const adminToken = await signIn(app, 'admin1');
    const otp = await userMgmtToken(app, adminToken);

    const res = await call(
      app, 'POST', '/api/auth/users/usr_insp_002/password',
      { password: 'set-by-the-admin-1', otpToken: otp },
      { authorization: `Bearer ${adminToken}` }
    );
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));

    const fresh = await call(app, 'POST', '/api/auth/login', { username: 'inspector2', password: 'set-by-the-admin-1' });
    assert.strictEqual(fresh.status, 200, JSON.stringify(fresh.body));
  });

  it('TC-PWD-06: a supervisor cannot set anybody else’s password', async () => {
    const supToken = await signIn(app, 'supervisor1');
    const res = await call(
      app, 'POST', '/api/auth/users/usr_insp_002/password',
      { password: 'set-by-a-supervisor', otpToken: 'anything' },
      { authorization: `Bearer ${supToken}` }
    );
    assert.strictEqual(res.status, 403, JSON.stringify(res.body));

    const still = await call(app, 'POST', '/api/auth/login', { username: 'inspector2', password: 'password123' });
    assert.strictEqual(still.status, 200);
  });

  it('TC-PWD-07: an administrator without the OTP confirmation is refused', async () => {
    const adminToken = await signIn(app, 'admin1');
    const res = await call(
      app, 'POST', '/api/auth/users/usr_insp_002/password',
      { password: 'no-confirmation-given' },
      { authorization: `Bearer ${adminToken}` }
    );
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.error, 'OTP_REQUIRED');
  });

  it('TC-PWD-08: the change is recorded in the audit chain', async () => {
    // A password change is a security event. If it were not logged, an account
    // taken over by somebody with a lifted token would leave no trace at all.
    const token = await signIn(app, 'inspector1');
    await call(
      app, 'POST', '/api/auth/password',
      { currentPassword: 'password123', newPassword: 'a-longer-one-99' },
      { authorization: `Bearer ${token}` }
    );

    const adminToken = await signIn(app, 'admin1');
    const audit = await call(app, 'GET', '/api/audit/activity?limit=200', undefined, { authorization: `Bearer ${adminToken}` });
    assert.strictEqual(audit.status, 200, JSON.stringify(audit.body));

    const entries = audit.body.data?.entries || audit.body.data || [];
    const found = JSON.stringify(entries).includes('PASSWORD_CHANGED_BY_OWNER');
    assert.ok(found, 'the password change should appear in the audit log');
  });
});
