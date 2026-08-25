/**
 * TOTP enrolment, verification and account-change confirmation
 * Indian Railways WRS Raipur
 *
 * The supervisor OTP was never a second factor: the server generated the code
 * and returned it to whoever asked, because no SMS gateway is integrated.
 * TOTP replaces the code-generation half — the code now comes from the
 * supervisor's own device — while keeping the action-token half, which was
 * well designed: action-scoped, single-use, short-lived.
 *
 * Also pinned here: USER_MGMT, which was declared as an action type and
 * enforced nowhere. Creating an account is how someone grants themselves
 * supervisor rights, so it was the least defensible route in the system to
 * have had no second confirmation.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../src/db/migrations.ts';
import { seedUsers } from '../src/db/seed.ts';
import { TotpService } from '../src/auth/totpService.ts';
import { generateTotp } from '../src/auth/totp.ts';
import { seal, open } from '../src/auth/secretBox.ts';
import { createApp } from '../src/app.ts';
import { generateToken } from '../src/auth/jwt.ts';
import { otpService } from '../src/auth/otpService.ts';
import type { ExpressApp } from '../src/framework/index.ts';

describe('TOTP enrolment', () => {
  let db: DatabaseSync;
  let svc: TotpService;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    runMigrations(db);
    seedUsers(db);
    svc = new TotpService(db);
  });

  it('TC-TE-01: enrolment is not complete until a code is confirmed', () => {
    // If closing the page mid-scan left the user "enrolled", they would be
    // locked out of the release gate by a factor they cannot produce.
    const offer = svc.beginEnrolment('usr_sup_001');
    assert.strictEqual(svc.isEnrolled('usr_sup_001'), false, 'not enrolled on offer alone');

    assert.strictEqual(svc.confirmEnrolment('usr_sup_001', generateTotp(offer.secret)), true);
    assert.strictEqual(svc.isEnrolled('usr_sup_001'), true);
  });

  it('TC-TE-02: a wrong code does not complete enrolment', () => {
    const offer = svc.beginEnrolment('usr_sup_001');
    assert.strictEqual(svc.confirmEnrolment('usr_sup_001', '000000'), false);
    assert.strictEqual(svc.isEnrolled('usr_sup_001'), false);
    assert.ok(offer.secret.length > 0);
  });

  it('TC-TE-03: the secret is never stored in the clear', () => {
    // The database file is not encrypted, so a credential stored plainly would
    // be handed over entirely by one copied backup.
    const offer = svc.beginEnrolment('usr_sup_001');
    const row = db.prepare('SELECT totp_secret_sealed FROM users WHERE id = ?').get('usr_sup_001') as any;

    assert.ok(!row.totp_secret_sealed.includes(offer.secret), 'secret appears verbatim in the column');
    assert.strictEqual(open(row.totp_secret_sealed), offer.secret, 'and must still be recoverable by the server');
  });

  it('TC-TE-04: a tampered sealed secret fails to open rather than opening to rubbish', () => {
    // AES-GCM is authenticated; without that, a flipped byte would decrypt to
    // garbage that then gets used as a secret.
    const sealed = seal('MZXW6YTBOI');
    const parts = sealed.split(':');
    const body = Buffer.from(parts[3], 'base64');
    body[0] ^= 0xff;
    parts[3] = body.toString('base64');
    assert.strictEqual(open(parts.join(':')), null);
  });

  it('TC-TE-05: a code cannot be used twice', () => {
    // TOTP codes stay valid for about ninety seconds with drift tolerance. A
    // code seen over a supervisor's shoulder at the gate must not be reusable
    // inside that window.
    const offer = svc.beginEnrolment('usr_sup_001');
    svc.confirmEnrolment('usr_sup_001', generateTotp(offer.secret));

    // Confirmation consumed the current counter, so the current code is spent.
    const first = svc.verify('usr_sup_001', generateTotp(offer.secret));
    assert.strictEqual(first.ok, false);
    assert.match(first.reason!, /already been used/);
  });

  it('TC-TE-06: an unenrolled user cannot verify', () => {
    const r = svc.verify('usr_insp_001', '123456');
    assert.strictEqual(r.ok, false);
    assert.match(r.reason!, /No authenticator is enrolled/);
  });

  it('TC-TE-07: a deactivated user cannot verify', () => {
    const offer = svc.beginEnrolment('usr_sup_001');
    svc.confirmEnrolment('usr_sup_001', generateTotp(offer.secret));
    db.prepare("UPDATE users SET is_active = 0 WHERE id = 'usr_sup_001'").run();

    const r = svc.verify('usr_sup_001', generateTotp(offer.secret));
    assert.strictEqual(r.ok, false);
    assert.match(r.reason!, /deactivated/);
  });

  it('TC-TE-08: an unreadable secret says so, rather than blaming the phone', () => {
    // Sealed under a different server secret. Reporting "incorrect code" would
    // send the supervisor to check a phone that is working perfectly.
    svc.beginEnrolment('usr_sup_001');
    db.prepare("UPDATE users SET totp_enrolled_at = ?, totp_secret_sealed = 'v1:AAAA:BBBB:CCCC' WHERE id = 'usr_sup_001'")
      .run(new Date().toISOString());

    const r = svc.verify('usr_sup_001', '123456');
    assert.strictEqual(r.ok, false);
    assert.match(r.reason!, /cannot be read.*Re-enrol/i);
  });

  it('TC-TE-09: an admin can clear a lost phone, and it is recorded', () => {
    // A lost phone is the ordinary case. Removing someone's second factor is
    // also exactly what an attacker would want, so it goes in the chain.
    const offer = svc.beginEnrolment('usr_sup_001');
    svc.confirmEnrolment('usr_sup_001', generateTotp(offer.secret));
    assert.strictEqual(svc.isEnrolled('usr_sup_001'), true);

    svc.resetEnrolment('usr_sup_001', 'usr_adm_001', 'ADMIN');
    assert.strictEqual(svc.isEnrolled('usr_sup_001'), false);

    const row = db.prepare(
      "SELECT payload_json, user_id FROM inspection_audit_log WHERE event_type = 'SECURITY_ALERT' ORDER BY rowid DESC LIMIT 1"
    ).get() as any;
    const payload = JSON.parse(row.payload_json);
    assert.strictEqual(payload.action, 'TOTP_RESET');
    assert.strictEqual(payload.targetUserId, 'usr_sup_001');
    assert.strictEqual(row.user_id, 'usr_adm_001', 'recorded against the admin who did it');
  });

  it('TC-TE-10: re-enrolling issues a different secret', () => {
    const first = svc.beginEnrolment('usr_sup_001');
    const second = svc.beginEnrolment('usr_sup_001');
    assert.notStrictEqual(first.secret, second.secret);
    assert.strictEqual(
      svc.confirmEnrolment('usr_sup_001', generateTotp(first.secret)),
      false,
      'the superseded secret must stop working'
    );
  });
});

describe('Account changes require confirmation', () => {
  let app: ExpressApp;
  const admin = generateToken({ id: 'usr_adm_001', username: 'admin1', role: 'ADMIN', name: 'A' } as any);
  const H = { authorization: `Bearer ${admin}`, 'content-type': 'application/json' };
  const newUser = (over: any = {}) => ({
    username: 'newperson', password: 'Railway@2026', role: 'SUPERVISOR',
    fullName: 'New Person', employeeId: 'EMP-9001', ...over
  });

  beforeEach(() => {
    app = createApp(':memory:');
  });

  it('TC-UM-01: creating an account without confirmation is refused', async () => {
    const res: any = await app.dispatch({ method: 'POST', url: '/api/auth/users', headers: H, body: newUser() });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.error, 'OTP_REQUIRED');
  });

  it('TC-UM-02: deactivating an account without confirmation is refused', async () => {
    // Deactivating is how someone would lock out the person who might notice.
    const res: any = await app.dispatch({
      method: 'PATCH', url: '/api/auth/users/usr_insp_002/deactivate', headers: H, body: {}
    });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.error, 'OTP_REQUIRED');
  });

  it('TC-UM-03: a valid USER_MGMT token allows it', async () => {
    const otpToken = otpService.issueActionToken('usr_adm_001', 'USER_MGMT');
    const res: any = await app.dispatch({
      method: 'POST', url: '/api/auth/users', headers: H, body: newUser({ otpToken })
    });
    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
  });

  it('TC-UM-04: the token is single use', async () => {
    const otpToken = otpService.issueActionToken('usr_adm_001', 'USER_MGMT');
    await app.dispatch({ method: 'POST', url: '/api/auth/users', headers: H, body: newUser({ otpToken }) });

    const replay: any = await app.dispatch({
      method: 'POST', url: '/api/auth/users', headers: H,
      body: newUser({ otpToken, username: 'other', employeeId: 'EMP-9002' })
    });
    assert.strictEqual(replay.status, 401);
    assert.strictEqual(replay.body.error, 'INVALID_OTP_TOKEN');
  });

  it('TC-UM-05: a token for a different action does not work here', async () => {
    // Action scoping is the point: a token obtained to export data must not
    // also create a supervisor.
    const exportToken = otpService.issueActionToken('usr_adm_001', 'EXPORT');
    const res: any = await app.dispatch({
      method: 'POST', url: '/api/auth/users', headers: H,
      body: newUser({ otpToken: exportToken, username: 'sneaky', employeeId: 'EMP-9003' })
    });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.error, 'INVALID_OTP_TOKEN');
  });
});
