/**
 * Release Sign-off Integrity Tests
 * Indian Railways WRS Raipur
 *
 * The release certificate is the most consequential record the system
 * produces — it is the document asserting that a wagon is fit to leave the
 * shop. Everything it claims about *who* released the wagon, and everything
 * it offers as proof, has to be true.
 *
 * Four things were not:
 *
 *   1. The OTP block ran only `if (tokenToVerify)`, so omitting the field
 *      skipped verification entirely.
 *   2. The signatory fell back to a body-supplied id and then to a hardcoded
 *      demo supervisor, and the employee ID — never present in the JWT — fell
 *      back to a constant on every single certificate ever issued.
 *   3. The "digital signature" was 16 random bytes behind an "HMAC-" prefix.
 *      It signed nothing and could verify nothing.
 *   4. An unrecognised supervisor id caused a SUPERVISOR user row to be
 *      created rather than being refused.
 *
 * These tests pin all four closed.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createApp } from '../src/app.ts';
import { generateToken } from '../src/auth/jwt.ts';
import { getDatabase } from '../src/db/connection.ts';
import { config } from '../src/config/index.ts';
import type { ExpressApp } from '../src/framework/index.ts';

describe('Release Sign-off Integrity', () => {
  let app: ExpressApp;
  let inspectorToken: string;
  let supervisorToken: string;

  const auth = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

  /** Registers a wagon and clears every gate blocker, so only sign-off remains. */
  async function driveToReleasable(wagonNumber: string) {
    await app.dispatch({
      method: 'POST',
      url: '/api/wagons/register',
      headers: auth(inspectorToken),
      body: { wagonNumber, wagonType: 'BOXNHL', owningRailway: 'SECR' }
    });

    for (const stg of ['DISMANTLING', 'COMPONENT_INSPECTION', 'REPAIR_REPLACEMENT', 'REASSEMBLY', 'FINAL_QC_GATE']) {
      await app.dispatch({
        method: 'POST',
        url: `/api/wagons/${wagonNumber}/transition`,
        headers: auth(inspectorToken),
        body: { targetStage: stg }
      });
    }

    const chk = await app.dispatch({
      method: 'GET',
      url: `/api/wagons/${wagonNumber}/checklist`,
      headers: auth(inspectorToken)
    });
    for (const item of chk.body.data.allItems) {
      await app.dispatch({
        method: 'PUT',
        url: `/api/wagons/${wagonNumber}/checklist/items/${item.id}`,
        headers: auth(inspectorToken),
        body: { status: 'PASS', reinspectedStatus: 'PASS' }
      });
    }

    await app.dispatch({
      method: 'POST',
      url: '/api/inspections',
      headers: auth(inspectorToken),
      body: {
        wagonNumber,
        bogieType: 'CASNUB_22_NLB',
        condition: 'USED',
        springPosition: 'OUTER',
        measuredFreeHeight: 258.0
      }
    });

    const gate = await app.dispatch({
      method: 'GET',
      url: `/api/wagons/${wagonNumber}/gate/status`,
      headers: auth(inspectorToken)
    });
    assert.equal(gate.body.data.canRelease, true, `wagon not releasable: ${gate.body.data.blockers.join('; ')}`);
  }

  const signoff = (wagonNumber: string, token: string, body: Record<string, unknown>) =>
    app.dispatch({
      method: 'POST',
      url: `/api/wagons/${wagonNumber}/gate/signoff`,
      headers: auth(token),
      body
    });

  before(() => {
    app = createApp(':memory:');
    inspectorToken = generateToken({
      id: 'usr_insp_001', username: 'inspector1', role: 'INSPECTOR', name: 'Ramesh Kumar'
    } as any);
    supervisorToken = generateToken({
      id: 'usr_sup_001', username: 'supervisor1', role: 'SUPERVISOR', name: 'S. K. Verma'
    } as any);
  });

  // -------------------------------------------------------------------------
  // OTP is mandatory
  // -------------------------------------------------------------------------
  test('TC-SGN-01: sign-off with no OTP at all is refused', async () => {
    // Previously the verification block was skipped entirely when the field
    // was absent — the gate could be walked past by not mentioning it.
    const wagonNumber = 'SECR/BOXNHL/SGN001';
    await driveToReleasable(wagonNumber);

    const res = await signoff(wagonNumber, supervisorToken, { notes: 'no otp supplied' });

    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'OTP_REQUIRED');
  });

  test('TC-SGN-02: sign-off with an unrecognised OTP is refused', async () => {
    const wagonNumber = 'SECR/BOXNHL/SGN002';
    await driveToReleasable(wagonNumber);

    const res = await signoff(wagonNumber, supervisorToken, { otpToken: 'not_a_real_token' });

    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'INVALID_OTP_TOKEN');
  });

  test('TC-SGN-03: a wagon left unsigned by a refused OTP has no certificate', async () => {
    // The refusal must actually stop the release, not merely return 401 after
    // recording one.
    const row = getDatabase()
      .prepare('SELECT COUNT(*) c FROM gate_signoffs WHERE wagon_number IN (?, ?)')
      .get('SECR/BOXNHL/SGN001', 'SECR/BOXNHL/SGN002') as any;
    assert.equal(row.c, 0);
  });

  // -------------------------------------------------------------------------
  // Identity comes from the token, not the caller
  // -------------------------------------------------------------------------
  test('TC-SGN-04: a body-supplied supervisorId cannot choose whose name is on the certificate', async () => {
    const wagonNumber = 'SECR/BOXNHL/SGN003';
    await driveToReleasable(wagonNumber);

    const res = await signoff(wagonNumber, supervisorToken, {
      otpToken: 'test_token_override',
      // A caller trying to attribute the release to someone else.
      supervisorId: 'usr_insp_001',
      digitalSignature: 'HMAC-TOTALLY-MADE-UP'
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.supervisorId, 'usr_sup_001', 'must use the authenticated signer');
    assert.notEqual(res.body.data.digitalSignature, 'HMAC-TOTALLY-MADE-UP', 'client signature must be ignored');
  });

  test('TC-SGN-05: the employee ID is the signer’s real one, not a fallback constant', async () => {
    // Signed here by the ADMIN, whose employee ID is WRS-ADM-0001. The JWT
    // carries no employeeId at all, so the old code resolved this to the
    // hardcoded 'WRS-SUP-2019' — the certificate would have named the demo
    // supervisor's ID for a release the admin performed. Using the seeded
    // supervisor for this test would prove nothing, since their real ID
    // happens to equal the constant.
    const db = getDatabase();
    const wagonNumber = 'SECR/BOXNHL/SGN007';
    await driveToReleasable(wagonNumber);

    const adminToken = generateToken({
      id: 'usr_adm_001', username: 'admin1', role: 'ADMIN', name: 'A. K. Mishra'
    } as any);

    const res = await signoff(wagonNumber, adminToken, { otpToken: 'test_token_override' });
    assert.equal(res.status, 200);

    const stored = db
      .prepare('SELECT supervisor_id, supervisor_employee_id FROM gate_signoffs WHERE wagon_number = ?')
      .get(wagonNumber) as any;

    assert.equal(stored.supervisor_id, 'usr_adm_001');
    assert.equal(stored.supervisor_employee_id, 'WRS-ADM-0001', 'must be the signer’s own employee ID');
    assert.notEqual(stored.supervisor_employee_id, 'WRS-SUP-2019', 'must not be the old hardcoded fallback');
  });

  // -------------------------------------------------------------------------
  // The signature actually signs something
  // -------------------------------------------------------------------------
  test('TC-SGN-06: the digital signature verifies against the certificate contents', async () => {
    // The real test of the fix: recompute the HMAC from the stored fields and
    // require it to match. Random bytes could never satisfy this.
    const row = getDatabase().prepare(`
      SELECT wagon_number, certificate_number, supervisor_id, supervisor_employee_id,
             signed_at, checks_summary_json, digital_signature, certificate_hash
      FROM gate_signoffs WHERE wagon_number = ?
    `).get('SECR/BOXNHL/SGN003') as any;

    const canonical = JSON.stringify({
      wagonNumber: row.wagon_number,
      certificateNumber: row.certificate_number,
      supervisorId: row.supervisor_id,
      supervisorEmployeeId: row.supervisor_employee_id,
      signedAt: row.signed_at,
      summary: JSON.parse(row.checks_summary_json)
    });

    const expectedSig =
      'HMAC-SHA256:' + crypto.createHmac('sha256', config.jwtSecret).update(canonical).digest('hex');
    const expectedHash = crypto.createHash('sha256').update(canonical).digest('hex');

    assert.equal(row.digital_signature, expectedSig, 'signature must verify over the canonical contents');
    assert.equal(row.certificate_hash, expectedHash, 'certificate hash must be re-derivable from stored fields');
  });

  test('TC-SGN-07: altering a released certificate breaks its signature', async () => {
    const db = getDatabase();
    const row = db.prepare(`
      SELECT wagon_number, certificate_number, supervisor_id, supervisor_employee_id,
             signed_at, checks_summary_json, digital_signature
      FROM gate_signoffs WHERE wagon_number = ?
    `).get('SECR/BOXNHL/SGN003') as any;

    // Someone edits the wagon the certificate refers to.
    const tampered = JSON.stringify({
      wagonNumber: 'SECR/BOXNHL/OTHER',
      certificateNumber: row.certificate_number,
      supervisorId: row.supervisor_id,
      supervisorEmployeeId: row.supervisor_employee_id,
      signedAt: row.signed_at,
      summary: JSON.parse(row.checks_summary_json)
    });
    const tamperedSig =
      'HMAC-SHA256:' + crypto.createHmac('sha256', config.jwtSecret).update(tampered).digest('hex');

    assert.notEqual(tamperedSig, row.digital_signature, 'a changed certificate must not keep its signature');
  });

  test('TC-SGN-08: the signature is keyed, so it cannot be forged without the server secret', async () => {
    const row = getDatabase().prepare(`
      SELECT wagon_number, certificate_number, supervisor_id, supervisor_employee_id,
             signed_at, checks_summary_json, digital_signature
      FROM gate_signoffs WHERE wagon_number = ?
    `).get('SECR/BOXNHL/SGN003') as any;

    const canonical = JSON.stringify({
      wagonNumber: row.wagon_number,
      certificateNumber: row.certificate_number,
      supervisorId: row.supervisor_id,
      supervisorEmployeeId: row.supervisor_employee_id,
      signedAt: row.signed_at,
      summary: JSON.parse(row.checks_summary_json)
    });

    const wrongKey =
      'HMAC-SHA256:' + crypto.createHmac('sha256', 'not-the-server-secret').update(canonical).digest('hex');

    assert.notEqual(wrongKey, row.digital_signature, 'the same contents under another key must not match');
    assert.match(row.digital_signature, /^HMAC-SHA256:[0-9a-f]{64}$/);
  });

  test('TC-SGN-09: two certificates do not share a signature', async () => {
    // Guards against the signature collapsing to a constant.
    const wagonNumber = 'SECR/BOXNHL/SGN004';
    await driveToReleasable(wagonNumber);
    const res = await signoff(wagonNumber, supervisorToken, { otpToken: 'test_token_override' });
    assert.equal(res.status, 200);

    const sigs = getDatabase()
      .prepare('SELECT digital_signature FROM gate_signoffs')
      .all() as any[];
    const unique = new Set(sigs.map((s) => s.digital_signature));
    assert.equal(unique.size, sigs.length, 'every certificate must carry its own signature');
  });

  // -------------------------------------------------------------------------
  // No ghost signatories
  // -------------------------------------------------------------------------
  test('TC-SGN-10: an unregistered supervisor cannot sign, and no account is conjured', async () => {
    // The repository used to INSERT the unknown id as an active SUPERVISOR
    // with password 'none' — on the one route whose purpose is accountability.
    const db = getDatabase();
    const wagonNumber = 'SECR/BOXNHL/SGN005';
    await driveToReleasable(wagonNumber);

    const ghostToken = generateToken({
      id: 'usr_ghost_999', username: 'ghost', role: 'SUPERVISOR', name: 'Nobody At All'
    } as any);

    const before = db.prepare('SELECT COUNT(*) c FROM users').get() as any;
    const res = await signoff(wagonNumber, ghostToken, { otpToken: 'test_token_override' });
    const after = db.prepare('SELECT COUNT(*) c FROM users').get() as any;

    assert.ok(res.status >= 400, `expected refusal, got ${res.status}`);
    assert.equal(after.c, before.c, 'no user account may be created by attempting to sign');
    assert.equal(
      db.prepare('SELECT COUNT(*) c FROM users WHERE id = ?').get('usr_ghost_999').c,
      0
    );
    assert.equal(
      db.prepare('SELECT COUNT(*) c FROM gate_signoffs WHERE wagon_number = ?').get(wagonNumber).c,
      0,
      'and no certificate is issued'
    );
  });

  test('TC-SGN-11: a deactivated supervisor cannot sign', async () => {
    const db = getDatabase();
    const wagonNumber = 'SECR/BOXNHL/SGN006';
    await driveToReleasable(wagonNumber);

    db.prepare("UPDATE users SET is_active = 0 WHERE id = 'usr_sup_001'").run();
    const res = await signoff(wagonNumber, supervisorToken, { otpToken: 'test_token_override' });
    db.prepare("UPDATE users SET is_active = 1 WHERE id = 'usr_sup_001'").run();

    assert.ok(res.status >= 400, `a deactivated supervisor must not sign, got ${res.status}`);
    assert.equal(
      db.prepare('SELECT COUNT(*) c FROM gate_signoffs WHERE wagon_number = ?').get(wagonNumber).c,
      0,
      'no certificate may be issued for a deactivated signatory'
    );
  });
});
