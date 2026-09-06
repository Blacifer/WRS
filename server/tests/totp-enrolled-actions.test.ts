/**
 * Enrolling an authenticator must not lock a supervisor out
 * Indian Railways WRS Raipur
 *
 * Once a supervisor enrols, the server requires the authenticator and refuses
 * the inline confirmation code. That is deliberate and right: the inline code
 * is handed to whoever asks, so possession of the session is possession of
 * the code, and enrolment should not leave a weaker path open beside the
 * stronger one.
 *
 * But the screens verify the six-digit code first — POST /auth/totp/verify —
 * and carry the action token it returns into the action itself. The check
 * accepted only a raw `totpCode`, so it demanded the stronger factor and then
 * rejected the stronger factor for arriving in the wrong shape.
 *
 * The effect: enrolling an authenticator made a supervisor unable to release
 * a wagon or override a stage AT ALL. The security improvement locked people
 * out of the two actions it existed to protect, and silently — every refusal
 * read as a wrong code.
 *
 * Found by sweeping for fields the server accepts that no client sends. The
 * existing suites covered both refusals and never once covered a success.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createApp } from '../src/app.ts';
import { generateToken } from '../src/auth/jwt.ts';
import { getDatabase } from '../src/db/connection.ts';
import type { ExpressApp } from '../src/framework/index.ts';

/** RFC 6238, so the test proves the real thing rather than a stub. */
function totpFor(secret: string, at = Date.now()): string {
  const b32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secret.replace(/=+$/, '')) bits += b32.indexOf(c.toUpperCase()).toString(2).padStart(5, '0');
  const key = Buffer.from((bits.match(/.{8}/g) || []).map((b) => parseInt(b, 2)));
  const ctr = Buffer.alloc(8);
  ctr.writeUInt32BE(Math.floor(at / 30000), 4);
  const hm = crypto.createHmac('sha1', key).update(ctr).digest();
  const o = hm[hm.length - 1] & 0xf;
  return String(((hm.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0');
}

describe('An enrolled supervisor can still do their job', () => {
  let app: ExpressApp;
  let sup: string;
  let insp: string;
  let secret: string;

  const hs = () => ({ authorization: `Bearer ${sup}`, 'content-type': 'application/json' });
  const hi = () => ({ authorization: `Bearer ${insp}`, 'content-type': 'application/json' });

  before(async () => {
    app = createApp(':memory:');
    sup = generateToken({
      id: 'usr_sup_001', username: 'supervisor1', role: 'SUPERVISOR',
      name: 'S. K. Verma', employeeId: 'WRS-SUP-2019'
    });
    insp = generateToken({
      id: 'usr_insp_001', username: 'inspector1', role: 'INSPECTOR',
      name: 'Ramesh Kumar', employeeId: 'WRS-INSP-1042'
    });

    const start = await app.dispatch({ method: 'POST', url: '/api/auth/totp/enrol', headers: hs(), body: {} });
    secret = start.body.data.secret;
    const confirmed = await app.dispatch({
      method: 'POST', url: '/api/auth/totp/confirm', headers: hs(), body: { code: totpFor(secret) }
    });
    assert.equal(confirmed.status, 200, 'enrolment must succeed for this suite to mean anything');

    /*
     * Represent a supervisor who enrolled earlier, rather than one who
     * enrolled a second ago.
     *
     * Confirming an enrolment consumes that 30-second window — the replay
     * check refuses a counter it has already seen — so a code generated in
     * the same window is correctly rejected as reused. Every supervisor hits
     * this once, on the day they enrol, and waits half a minute. Making three
     * tests wait would add a minute and a half to the suite to reproduce
     * something already covered by the replay check itself.
     *
     * Clearing the last counter is the state a supervisor is in every day
     * after their first.
     */
    getDatabase().prepare('UPDATE users SET totp_last_counter = NULL WHERE id = ?').run('usr_sup_001');
  });

  /** Exactly what the screens do: verify the code, carry the token. */
  const tokenFromAuthenticator = async () => {
    // Same reason as above: each verification consumes the window, and these
    // tests act several times inside one.
    getDatabase().prepare('UPDATE users SET totp_last_counter = NULL WHERE id = ?').run('usr_sup_001');
    const v = await app.dispatch({
      method: 'POST', url: '/api/auth/totp/verify', headers: hs(),
      body: { action: 'OVERRIDE', code: totpFor(secret) }
    });
    return { status: v.status, token: v.body?.data?.otpToken, body: v.body };
  };

  test('TC-TOT-01: a stage override succeeds with the token the UI carries', async () => {
    const wagonNumber = 'SECR/BOXNHL/TOT010';
    await app.dispatch({
      method: 'POST', url: '/api/wagons/register', headers: hi(),
      body: { wagonNumber, wagonType: 'BOXNHL', owningRailway: 'SECR' }
    });

    const v = await tokenFromAuthenticator();
    assert.equal(v.status, 200, `authenticator verification failed: ${JSON.stringify(v.body)}`);

    const res = await app.dispatch({
      method: 'POST', url: `/api/wagons/${wagonNumber}/transition`, headers: hs(),
      body: {
        targetStage: 'REPAIR_REPLACEMENT',
        supervisorOverride: true,
        overrideJustification: 'Documented reason for skipping a stage.',
        otpToken: v.token
      }
    });

    assert.notEqual(res.status, 401, `an enrolled supervisor was locked out: ${res.body?.message}`);
    assert.equal(res.status, 200, `override refused: ${res.body?.message}`);
  });

  test('TC-TOT-02: an inline code is still refused for an enrolled supervisor', async () => {
    /*
     * The property that must survive the fix. If enrolment could fall back to
     * the code the server hands out, the authenticator would be decorative.
     */
    const wagonNumber = 'SECR/BOXNHL/TOT011';
    await app.dispatch({
      method: 'POST', url: '/api/wagons/register', headers: hi(),
      body: { wagonNumber, wagonType: 'BOXNHL', owningRailway: 'SECR' }
    });

    const r = await app.dispatch({ method: 'POST', url: '/api/auth/request-otp', headers: hs(), body: { action: 'OVERRIDE' } });
    const vv = await app.dispatch({
      method: 'POST', url: '/api/auth/verify-otp', headers: hs(),
      body: { otpId: r.body?.data?.otpId, otpCode: r.body?.data?.otpCode }
    });
    const inlineToken = vv.body?.data?.otpToken ?? vv.body?.otpToken;

    const res = await app.dispatch({
      method: 'POST', url: `/api/wagons/${wagonNumber}/transition`, headers: hs(),
      body: {
        targetStage: 'REPAIR_REPLACEMENT',
        supervisorOverride: true,
        overrideJustification: 'Documented reason for skipping a stage.',
        otpToken: inlineToken
      }
    });

    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'TOTP_REQUIRED');
  });

  test('TC-TOT-03: another person\'s authenticator token does not authorise this one', async () => {
    /*
     * The token records who it was minted for. Without that check, any TOTP
     * token in circulation would clear anybody's gate.
     */
    const other = generateToken({
      id: 'usr_sup_002', username: 'supervisor2', role: 'SUPERVISOR',
      name: 'Other Supervisor', employeeId: 'WRS-SUP-2020'
    });
    const wagonNumber = 'SECR/BOXNHL/TOT012';
    await app.dispatch({
      method: 'POST', url: '/api/wagons/register', headers: hi(),
      body: { wagonNumber, wagonType: 'BOXNHL', owningRailway: 'SECR' }
    });

    const v = await tokenFromAuthenticator();   // minted for supervisor1
    const res = await app.dispatch({
      method: 'POST', url: `/api/wagons/${wagonNumber}/transition`,
      headers: { authorization: `Bearer ${other}`, 'content-type': 'application/json' },
      body: {
        targetStage: 'REPAIR_REPLACEMENT',
        supervisorOverride: true,
        overrideJustification: 'Documented reason for skipping a stage.',
        otpToken: v.token
      }
    });

    // supervisor2 is not enrolled, so this falls to the ordinary inline check,
    // which must not honour a token minted for somebody else.
    assert.notEqual(res.status, 200, 'a token minted for another user must not authorise this override');
  });
});
