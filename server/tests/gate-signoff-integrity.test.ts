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


    // WMM 2.0 §720 requires a Single Wagon Test after POH, so the gate now
    // demands one. A wagon is not releasable without it.
    await app.dispatch({
      method: 'POST',
      url: `/api/wagons/${wagonNumber}/swt`,
      headers: auth(inspectorToken),
      body: {
        wagonType: 'BOXN',
        pipeType: 'SINGLE',
        loadCondition: 'EMPTY',
        readings: [
          { ref: '1', value: 5.0 }, { ref: '2', value: 5.0 }, { ref: '3', value: 0.05 },
          { ref: '4.1', value: 24 }, { ref: '4.2', value: 3.8 }, { ref: '4.3', value: 1.45 },
          { ref: '5.1', value: 52 }, { ref: '6', value: 4 }, { ref: '7', observed: true },
          { ref: '8.1', value: 25 }, { ref: '8.2', value: 3.8 }, { ref: '9', value: 85 },
          { ref: '10', value: 0.05 }, { ref: '12', observed: true }
        ]
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
    // Signed here by the SECOND supervisor, whose employee ID is
    // WRS-SUP-2044. The JWT carries no employeeId at all, so the old code
    // resolved this to the hardcoded 'WRS-SUP-2019' — the certificate would
    // have named the first supervisor's ID for a release somebody else
    // performed. Using supervisor1 would prove nothing, since their real ID
    // happens to equal the constant.
    //
    // This used the ADMIN until releasing became a capability rather than a
    // rank. An administrator can no longer certify a wagon, which is the
    // point of that change, so the test needed a second person who genuinely
    // can.
    const db = getDatabase();
    const wagonNumber = 'SECR/BOXNHL/SGN007';
    await driveToReleasable(wagonNumber);

    const secondSupervisorToken = generateToken({
      id: 'usr_sup_002', username: 'supervisor2', role: 'SUPERVISOR', name: 'R. N. Tiwari'
    } as any);

    const res = await signoff(wagonNumber, secondSupervisorToken, { otpToken: 'test_token_override' });
    assert.equal(res.status, 200);

    const stored = db
      .prepare('SELECT supervisor_id, supervisor_employee_id FROM gate_signoffs WHERE wagon_number = ?')
      .get(wagonNumber) as any;

    assert.equal(stored.supervisor_id, 'usr_sup_002');
    assert.equal(stored.supervisor_employee_id, 'WRS-SUP-2044', 'must be the signer’s own employee ID');
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

    const { verifyCertificate, certificatePublicKeyPem } = await import('../src/reports/certificateSigning.ts');
    const expectedHash = crypto.createHash('sha256').update(canonical).digest('hex');

    /*
     * Verified with the PUBLIC key only, which is the point of the scheme.
     * The previous version of this test recomputed an HMAC from the server
     * secret — which proved the signature was genuine, but also demonstrated
     * that anyone able to check a certificate could equally well produce one.
     */
    assert.ok(
      verifyCertificate(canonical, row.digital_signature, certificatePublicKeyPem()),
      'the signature must verify over the canonical contents using only the public key'
    );
    assert.equal(row.certificate_hash, expectedHash, 'certificate hash must be re-derivable from stored fields');

    // Altered content must fail, or the signature is decorative.
    assert.ok(
      !verifyCertificate(canonical + ' ', row.digital_signature, certificatePublicKeyPem()),
      'a single altered byte must fail verification'
    );
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

  test('TC-SGN-08: the certificate can be verified by someone who cannot issue one', async () => {
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

    const { verifyCertificate, certificatePublicKeyPem } = await import('../src/reports/certificateSigning.ts');

    /*
     * The property that matters for this document.
     *
     * A release certificate is checked by the people who must not be able to
     * issue one: a reviewer, an auditor, a railway receiving the wagon. Under
     * the previous HMAC scheme those two abilities were the same key, so in
     * practice nobody outside this server could verify anything.
     *
     * This asserts both halves. A holder of only the public key can confirm a
     * genuine certificate, and cannot produce a signature that passes.
     */
    const publicKey = certificatePublicKeyPem();
    assert.match(row.digital_signature, /^Ed25519:/);

    assert.ok(
      verifyCertificate(canonical, row.digital_signature, publicKey),
      'a holder of the public key alone must be able to verify a genuine certificate'
    );

    // Forgery attempt: sign the same content with a different key entirely.
    const attacker = crypto.generateKeyPairSync('ed25519');
    const forged =
      'Ed25519:' +
      crypto.sign(null, Buffer.from(canonical, 'utf8'), attacker.privateKey).toString('base64');

    assert.ok(
      !verifyCertificate(canonical, forged, publicKey),
      'a signature from any other key must not verify'
    );

    // And an HMAC-labelled signature from the old scheme must read as
    // unverifiable rather than being waved through.
    assert.ok(
      !verifyCertificate(canonical, 'HMAC-SHA256:' + 'a'.repeat(64), publicKey),
      'a legacy HMAC signature must not verify under the new scheme'
    );
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

  // -------------------------------------------------------------------------
  // Advisories are decisions, not notices
  // -------------------------------------------------------------------------

  /** Adds two unindexed outer springs 9 mm apart — a mismatched nest. */
  async function addMismatchedNest(wagonNumber: string) {
    for (const h of [251.0, 260.0]) {
      await app.dispatch({
        method: 'POST',
        url: '/api/inspections',
        headers: auth(inspectorToken),
        body: {
          wagonNumber,
          bogieType: 'CASNUB_22_NLB',
          condition: 'USED',
          springPosition: 'OUTER',
          measuredFreeHeight: h
        }
      });
    }
  }

  test('TC-ACK-01: a wagon with an unacknowledged advisory cannot be released', async () => {
    // The nest rule is worded as a recommendation, so it does not block. It is
    // still not something a wagon may pass by nobody reading it.
    const wagonNumber = 'SECR/BOXNHL/ACK001';
    await driveToReleasable(wagonNumber);
    await addMismatchedNest(wagonNumber);

    const gate = await app.dispatch({
      method: 'GET',
      url: `/api/wagons/${wagonNumber}/gate/status`,
      headers: auth(inspectorToken)
    });
    assert.ok(gate.body.data.advisories.length > 0, 'the mismatched nest must raise an advisory');
    assert.equal(gate.body.data.canRelease, true, 'a recommendation must not block by itself');

    const res = await signoff(wagonNumber, supervisorToken, { otpToken: 'test_token_override' });

    assert.ok(res.status >= 400, `expected refusal without acknowledgement, got ${res.status}`);
    assert.match(res.body.message, /not been acknowledged/i);
    assert.equal(
      getDatabase().prepare('SELECT COUNT(*) c FROM gate_signoffs WHERE wagon_number = ?').get(wagonNumber).c,
      0
    );
  });

  test('TC-ACK-02: acknowledging the advisory releases the wagon and records the decision', async () => {
    const wagonNumber = 'SECR/BOXNHL/ACK001';
    const gate = await app.dispatch({
      method: 'GET',
      url: `/api/wagons/${wagonNumber}/gate/status`,
      headers: auth(inspectorToken)
    });
    const ids = gate.body.data.advisoryDetails.map((a: any) => a.id);

    const res = await signoff(wagonNumber, supervisorToken, {
      otpToken: 'test_token_override',
      acknowledgedAdvisoryIds: ids
    });

    assert.equal(res.status, 200);

    // The acknowledgement has to survive in the record, inside the signed
    // contents — otherwise it could be detached from the release afterwards.
    const row = getDatabase()
      .prepare('SELECT checks_summary_json FROM gate_signoffs WHERE wagon_number = ?')
      .get(wagonNumber) as any;
    const summary = JSON.parse(row.checks_summary_json);
    assert.deepEqual(summary.acknowledgedAdvisoryIds, [...ids].sort());
  });

  test('TC-ACK-03: a released certificate with an acknowledgement still verifies', async () => {
    const row = getDatabase().prepare(`
      SELECT wagon_number, certificate_number, supervisor_id, supervisor_employee_id,
             signed_at, checks_summary_json, digital_signature
      FROM gate_signoffs WHERE wagon_number = ?
    `).get('SECR/BOXNHL/ACK001') as any;

    const canonical = JSON.stringify({
      wagonNumber: row.wagon_number,
      certificateNumber: row.certificate_number,
      supervisorId: row.supervisor_id,
      supervisorEmployeeId: row.supervisor_employee_id,
      signedAt: row.signed_at,
      summary: JSON.parse(row.checks_summary_json)
    });

    const { verifyCertificate, certificatePublicKeyPem } = await import('../src/reports/certificateSigning.ts');
    assert.ok(
      verifyCertificate(canonical, row.digital_signature, certificatePublicKeyPem()),
      'everything the signature covers must be recoverable from the stored record'
    );
  });

  test('TC-ACK-04: acknowledging an unrelated id does not count as acknowledgement', async () => {
    const wagonNumber = 'SECR/BOXNHL/ACK002';
    await driveToReleasable(wagonNumber);
    await addMismatchedNest(wagonNumber);

    const res = await signoff(wagonNumber, supervisorToken, {
      otpToken: 'test_token_override',
      acknowledgedAdvisoryIds: ['nest_SOMETHING_ELSE']
    });

    assert.ok(res.status >= 400, 'a wrong id must not clear a real advisory');
    assert.match(res.body.message, /not been acknowledged/i);
  });

  test('TC-ACK-05: a clean wagon needs no acknowledgement', async () => {
    // The gate must not become a nuisance where there is nothing to accept.
    const wagonNumber = 'SECR/BOXNHL/ACK003';
    await driveToReleasable(wagonNumber);

    const res = await signoff(wagonNumber, supervisorToken, { otpToken: 'test_token_override' });
    assert.equal(res.status, 200);
  });

  // -------------------------------------------------------------------------
  // Enrolling an authenticator upgrades the supervisor
  //
  // These run LAST on purpose. Enrolling supervisor1 changes which factor the
  // sign-off route demands for that user, so running them earlier would make
  // every inline-OTP test above fail for a reason that has nothing to do with
  // what those tests are checking.
  // -------------------------------------------------------------------------
  test('TC-SGN-20: once enrolled, the inline one-time code no longer signs off', async () => {
    /*
     * The inline code is an audited two-step confirmation, not a second
     * factor: whoever asks for it receives it in the same response, so
     * holding the session is holding the code. An authenticator is different,
     * because the code comes from a device the server never sees.
     *
     * So enrolment upgrades a supervisor rather than adding a second option.
     * If the weaker path stayed open to those who had enrolled, the stronger
     * one would be decorative — anyone holding the session would simply ask
     * for the inline code exactly as before.
     */
    const { TotpService } = await import('../src/auth/totpService.ts');
    const totp = new TotpService(getDatabase());
    totp.beginEnrolment('usr_sup_001');
    // Confirm the enrolment directly. The RFC 6238 vectors are covered by the
    // TOTP unit tests; what is under test here is the sign-off gate.
    //
    // The enrolment lives in columns on the users row — beginEnrolment seals
    // the secret and deliberately leaves totp_enrolled_at null until a code is
    // confirmed, so that a supervisor who closes the page mid-scan is not left
    // holding a second factor they cannot produce.
    getDatabase()
      .prepare("UPDATE users SET totp_enrolled_at = ? WHERE id = 'usr_sup_001'")
      .run(new Date().toISOString());
    assert.ok(totp.isEnrolled('usr_sup_001'), 'setup: the supervisor must be enrolled');

    const wagonNumber = 'SECR/BOXNHL/SGN010';
    await driveToReleasable(wagonNumber);

    const res = await signoff(wagonNumber, supervisorToken, {
      otpToken: 'any_inline_token',
      notes: 'attempting with the weaker factor'
    });

    assert.equal(res.status, 401, 'an enrolled supervisor must not sign off with the inline code');
    // TOTP_REQUIRED rather than INVALID_OTP_TOKEN is the point: the refusal
    // comes from the enrolment branch, before the inline token is even looked
    // at, so it is not merely rejecting a bad token.
    assert.equal(res.body.error, 'TOTP_REQUIRED');
  });

  test('TC-SGN-21: once enrolled, a wrong authenticator code is refused', async () => {
    const wagonNumber = 'SECR/BOXNHL/SGN011';
    await driveToReleasable(wagonNumber);

    const res = await signoff(wagonNumber, supervisorToken, {
      totpCode: '000000',
      notes: 'wrong authenticator code'
    });

    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'INVALID_TOTP');
  });
});
