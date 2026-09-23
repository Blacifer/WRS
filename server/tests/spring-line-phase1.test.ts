/**
 * The spring line, phase 1 — the timed trial and the two doors closed first
 * Indian Railways WRS Raipur
 *
 * After the 23 Sep 2026 demonstration the CWM asked for 900–1000 springs in
 * under four hours: 14.4 s a spring. Phase 1 measures whether a real station
 * can hold that before anything is bought, and closes two gaps the line's
 * design found in the record's front door:
 *
 *   - POST /api/sorting/record took any valid sign-in — the DRM's, the
 *     administrator's — because it carried authMiddleware and nothing else.
 *   - verifyToken accepted any token signed with the secret. The day a
 *     station PC carries its own token, that token would have passed as a
 *     person's everywhere. Person tokens now say so, and nothing else does.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createApp } from '../src/app.ts';
import { verifyToken } from '../src/auth/jwt.ts';
import { config } from '../src/config/index.ts';
import type { ExpressApp } from '../src/framework/index.ts';
import { taktReading, TARGET_TAKT_SECONDS, MIN_INTERVALS, PAUSE_SECONDS } from '../../shared/line/takt.ts';
import { plausibleSpringCeiling, isLineBatch, ratePerHour, PLAUSIBLE_SPRINGS_PER_HOUR } from '../../shared/analysis/workedTime.ts';

let app: ExpressApp;
const call = (method: string, url: string, body?: any, headers: Record<string, string> = {}) => app.dispatch({ method, url, body, headers });
const login = async (username: string) => (await call('POST', '/api/auth/login', { username, password: 'password123' })).body.token as string;
const auth = (t: string) => ({ authorization: `Bearer ${t}` });
const spring = (batchId: string, extra: Record<string, unknown> = {}) => ({ batchId, bogieType: 'CASNUB_22_NLB', condition: 'USED', springPosition: 'OUTER', measuredFreeHeight: 258.5, ...extra });

/** Instants spaced by the given seconds, starting at a fixed moment. */
const at = (gaps: number[]) => { let t = Date.parse('2026-09-24T04:30:00Z'); const out = [t]; for (const g of gaps) { t += g * 1000; out.push(t); } return out; };

describe('the takt reading', () => {
  it('TC-LINE-01: the target is 14.4 s — 1000 springs in four hours', () => {
    assert.equal(TARGET_TAKT_SECONDS, 14.4);
  });

  it('TC-LINE-02: below the minimum sample it refuses a figure and says how many more', () => {
    const r = taktReading(at(Array(MIN_INTERVALS - 1).fill(12)));
    assert.equal(r.canQuote, false);
    assert.equal(r.medianSeconds, null);
    assert.match(r.reason!, /1 more/);
    assert.match(r.reasonHi!, /स्प्रिंग/);
  });

  it('TC-LINE-03: a station at 12 s a spring is within the target, and 1000 springs take 3.3 hours', () => {
    const r = taktReading(at(Array(20).fill(12)));
    assert.equal(r.canQuote, true);
    assert.equal(r.medianSeconds, 12);
    assert.equal(r.verdict, 'WITHIN');
    assert.equal(r.springsPerHour, 300);
    assert.equal(r.hoursFor1000, 3.3);
  });

  it('TC-LINE-04: the median, not the mean — one spring that sticks does not sink an on-time station', () => {
    const r = taktReading(at([...Array(19).fill(13), 100]));
    assert.equal(r.medianSeconds, 13);
    assert.equal(r.verdict, 'WITHIN');
  });

  it('TC-LINE-05: 16 s is close; 20 s is over', () => {
    assert.equal(taktReading(at(Array(15).fill(16))).verdict, 'CLOSE');
    assert.equal(taktReading(at(Array(15).fill(20))).verdict, 'OVER');
  });

  it('TC-LINE-06: a gap longer than two minutes is a stoppage, counted apart and kept out of the per-spring figure', () => {
    const r = taktReading(at([...Array(12).fill(14), PAUSE_SECONDS + 480, ...Array(3).fill(14)]));
    assert.equal(r.stoppages, 1);
    assert.equal(r.stoppageMinutes, 10);
    assert.equal(r.intervals, 15);
    assert.equal(r.medianSeconds, 14);
  });
});

describe('the line has its own rate ceiling; the bench keeps its own', () => {
  it('TC-LINE-07: 250 an hour is implausible for one pair of hands at a bench and plausible for a line', () => {
    assert.equal(ratePerHour(250, 60, plausibleSpringCeiling('BENCH')).plausible, false);
    assert.equal(ratePerHour(250, 60, plausibleSpringCeiling('LINE')).plausible, true);
    assert.equal(plausibleSpringCeiling('BENCH'), PLAUSIBLE_SPRINGS_PER_HOUR);
  });

  it('TC-LINE-08: seeded data — hundreds a second — is still caught on the line', () => {
    assert.equal(ratePerHour(1000, 1 / 60, plausibleSpringCeiling('LINE')).plausible, false);
  });

  it('TC-LINE-09: a trial or line batch is recognised by the id the bench mints; an ordinary one is not', () => {
    assert.equal(isLineBatch('trial_1790000000000_ab12cd'), true);
    assert.equal(isLineBatch('line_run_1'), true);
    assert.equal(isLineBatch('batch_1790000000000_ab12cd'), false);
    assert.equal(isLineBatch(null), false);
  });
});

describe('the record takes springs only from those who record springs', () => {
  let insp: string; let sup: string; let drm: string; let admin: string;
  before(async () => {
    app = createApp(':memory:');
    insp = await login('inspector1'); sup = await login('supervisor1'); drm = await login('drm1'); admin = await login('admin1');
  });

  it('TC-LINE-10: an inspector and a supervisor record a spring; the DRM and the administrator are refused', async () => {
    assert.equal((await call('POST', '/api/sorting/record', spring('b-insp'), auth(insp))).status, 201);
    assert.equal((await call('POST', '/api/sorting/record', spring('b-sup'), auth(sup))).status, 201);
    assert.equal((await call('POST', '/api/sorting/record', spring('b-drm'), auth(drm))).status, 403);
    assert.equal((await call('POST', '/api/sorting/record', spring('b-adm'), auth(admin))).status, 403);
  });

  it('TC-LINE-11: undo needs the correction capability — the DRM cannot take back an inspector\'s spring', async () => {
    await call('POST', '/api/sorting/record', spring('b-undo'), auth(insp));
    assert.equal((await call('POST', '/api/sorting/batches/b-undo/undo', {}, auth(drm))).status, 403);
    assert.equal((await call('POST', '/api/sorting/batches/b-undo/undo', {}, auth(insp))).status, 200);
  });

  it('TC-LINE-12: a gauge reading is stored as a measurement, not an approximation, and the server judges its band', async () => {
    const r = await call('POST', '/api/sorting/record', spring('trial_1_x', { measuredFreeHeight: 258.2, heightIsApproximate: false }), auth(insp));
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.data.band, 'GREEN');
  });
});

describe('only a person\'s token is a person\'s token', () => {
  const sign = (payload: Record<string, unknown>) => {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const data = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}`;
    const sig = crypto.createHmac('sha256', config.jwtSecret).update(data).digest('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    return `${data}.${sig}`;
  };
  const now = Math.floor(Date.now() / 1000);
  const person = { id: 'usr_insp_001', username: 'inspector1', role: 'INSPECTOR', name: 'R', iat: now, exp: now + 600 };

  it('TC-LINE-13: a token issued at sign-in carries typ "user" and verifies', async () => {
    app = createApp(':memory:');
    const tok = await login('inspector1');
    const p = verifyToken(tok);
    assert.equal(p?.typ, 'user');
  });

  it('TC-LINE-14: a validly signed token of any other kind is refused — a station PC cannot pass as an inspector', () => {
    assert.equal(verifyToken(sign({ ...person, typ: 'device' })), null);
    assert.equal(verifyToken(sign({ ...person, typ: 'user' }))?.id, 'usr_insp_001');
  });

  it('TC-LINE-15: a token from before the claim existed is still read as a person\'s until it expires', () => {
    assert.equal(verifyToken(sign(person))?.id, 'usr_insp_001');
  });
});
