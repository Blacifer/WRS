/**
 * The shadow run in the app — the forms, the app's half, the verdict
 * Indian Railways WRS Raipur
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createApp } from '../src/app.ts';
import { getDatabase } from '../src/db/connection.ts';
import { shadowVerdict } from '../../shared/analysis/shadowRun.ts';
import { workedMinutes, ratePerHour, PLAUSIBLE_SPRINGS_PER_HOUR } from '../../shared/analysis/workedTime.ts';
import type { ExpressApp } from '../src/framework/index.ts';

async function call(app: ExpressApp, method: string, path: string, body?: any, headers: Record<string, string> = {}) {
  return app.dispatch({ method, url: path, body, headers });
}
async function signIn(app: ExpressApp, username: string): Promise<string> {
  const res = await call(app, 'POST', '/api/auth/login', { username, password: 'password123' });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  return res.body.token;
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` });
const TODAY = new Date().toISOString().slice(0, 10);

const disc = (extra: Record<string, unknown> = {}) => ({
  occurredOn: TODAY, shift: 'A', inspectorName: 'Ramesh', wagonNumber: 'SECR/BOXNHL/40101', location: 'bogie 1, outer 3',
  registerSays: 'YELLOW', appSays: 'GREEN', registerVerdict: 'PASS', appVerdict: 'PASS', whoWasRight: 'APP', cause: 'BAND_MISREAD', ...extra
});

describe('worked time', () => {
  it('TC-SH-01: idle gaps are not work, and one instant has no duration', () => {
    const t0 = Date.parse('2026-09-15T08:00:00Z');
    const m = (min: number) => t0 + min * 60_000;
    assert.strictEqual(workedMinutes([m(0)]), 0);
    assert.strictEqual(workedMinutes([m(0), m(5), m(10)]), 10);
    // Lunch: a 40-minute gap is excluded, the runs either side count.
    assert.strictEqual(workedMinutes([m(0), m(5), m(45), m(50)]), 10);
  });
  it('TC-SH-02: a rate a person could not have produced is flagged, not printed as fact', () => {
    assert.strictEqual(ratePerHour(90, 60, PLAUSIBLE_SPRINGS_PER_HOUR).plausible, true);
    assert.strictEqual(ratePerHour(500, 60, PLAUSIBLE_SPRINGS_PER_HOUR).plausible, false);
    assert.strictEqual(ratePerHour(10, 0, PLAUSIBLE_SPRINGS_PER_HOUR).perHour, null);
  });
});

describe('the verdict', () => {
  const amber = { raised: 20, reMeasured: 6, stands: 10, unanswered: 4 };
  it('TC-SH-03: one case of the app passing what the register condemned blocks, whatever else is true', () => {
    const v = shadowVerdict([{ occurredOn: TODAY, registerVerdict: 'CONDEMNED', appVerdict: 'PASS', whoWasRight: 'REGISTER', cause: 'BAND_MISREAD', wouldHaveStoppedAWagon: true }], amber, [], TODAY);
    assert.strictEqual(v.blocking, true);
    assert.match(v.findings[0], /blocks going live/);
  });
  it('TC-SH-04: the app being over-cautious is not a blocker', () => {
    const v = shadowVerdict([{ occurredOn: TODAY, registerVerdict: 'PASS', appVerdict: 'CONDEMNED', whoWasRight: 'REGISTER', cause: 'OFF_STRIP_JUDGEMENT', wouldHaveStoppedAWagon: false }], amber, [], TODAY);
    assert.strictEqual(v.blocking, false);
  });
  it('TC-SH-05: amber boxes nobody answers are a finding about the app', () => {
    const v = shadowVerdict([], { raised: 20, reMeasured: 2, stands: 3, unanswered: 15 }, [], TODAY);
    assert.strictEqual(v.amber.answeredShare, 0.25);
    assert.ok(v.findings.some((f) => /amber boxes were answered/.test(f)));
    assert.strictEqual(v.amber.falseAlarmShare, 0.6);
  });
  it('TC-SH-06: fewer than five paired timings are said to be too few for a precise figure', () => {
    const v = shadowVerdict([], amber, [{ summaryDate: TODAY, transcriptionErrorsBoxMissed: 0, registerMinutesOneWagon: 40, appMinutesOneWagon: 25 }], TODAY);
    assert.strictEqual(v.timing.pairs, 1);
    assert.match(v.timing.note, /a precise one is not/);
    assert.strictEqual(v.timing.medianRegisterMinutes, 40);
  });
  it('TC-SH-07: week on week', () => {
    const d = (daysAgo: number) => new Date(Date.parse(TODAY) - daysAgo * 86400_000).toISOString().slice(0, 10);
    const row = (day: string) => ({ occurredOn: day, registerVerdict: 'PASS' as const, appVerdict: 'PASS' as const, whoWasRight: 'APP' as const, cause: 'BAND_MISREAD' as const, wouldHaveStoppedAWagon: false });
    const v = shadowVerdict([row(d(1)), row(d(8)), row(d(9)), row(d(10))], amber, [], TODAY);
    assert.deepStrictEqual(v.trend, { latest7: 1, previous7: 3, falling: true });
  });
});

describe('through the API', () => {
  let app: ExpressApp;
  let sup: string;
  beforeEach(async () => {
    app = createApp(':memory:');
    sup = await signIn(app, 'supervisor1');
  });

  it('TC-SH-10: a supervisor records a discrepancy; it is append-only; a correction supersedes it', async () => {
    const r = await call(app, 'POST', '/api/shadow/discrepancies', disc(), auth(sup));
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    assert.throws(() => getDatabase().prepare('DELETE FROM shadow_discrepancies').run(), /cannot be deleted/);
    assert.throws(() => getDatabase().prepare("UPDATE shadow_discrepancies SET who_was_right = 'REGISTER'").run(), /cannot be rewritten/);
    const fix = await call(app, 'POST', '/api/shadow/discrepancies', disc({ whoWasRight: 'REGISTER', supersedes: r.body.data.id }), auth(sup));
    assert.strictEqual(fix.status, 201, JSON.stringify(fix.body));
    const list = await call(app, 'GET', '/api/shadow/discrepancies', undefined, auth(sup));
    assert.strictEqual(list.body.data.length, 1, 'the corrected row is the record');
    assert.strictEqual(list.body.data[0].whoWasRight, 'REGISTER');
    const all = await call(app, 'GET', '/api/shadow/discrepancies?all=1', undefined, auth(sup));
    assert.strictEqual(all.body.data.length, 2, 'and the original survives');
  });

  it('TC-SH-11: the important column cannot be left blank, and the vocabulary is closed', async () => {
    const r = await call(app, 'POST', '/api/shadow/discrepancies', disc({ whoWasRight: '' }), auth(sup));
    assert.strictEqual(r.status, 400);
    assert.match(r.body.message, /important column/);
    const c = await call(app, 'POST', '/api/shadow/discrepancies', disc({ cause: 'GREMLINS' }), auth(sup));
    assert.strictEqual(c.status, 400);
  });

  it('TC-SH-12: the DRM reads and cannot write; an inspector can do neither', async () => {
    const drm = await signIn(app, 'drm1');
    const insp = await signIn(app, 'inspector1');
    assert.strictEqual((await call(app, 'GET', '/api/shadow/report', undefined, auth(drm))).status, 200);
    assert.strictEqual((await call(app, 'POST', '/api/shadow/discrepancies', disc(), auth(drm))).status, 403);
    assert.strictEqual((await call(app, 'GET', '/api/shadow/report', undefined, auth(insp))).status, 403);
  });

  it('TC-SH-13: the app\'s half of the day is computed from its records, and the report carries the verdict', async () => {
    const insp = await signIn(app, 'inspector1');
    for (let i = 0; i < 12; i++) {
      await call(app, 'POST', '/api/sorting/record', { batchId: 'b', bogieType: 'CASNUB_22_NLB', condition: 'USED', springPosition: 'OUTER', measuredFreeHeight: i < 3 ? 200 : 258 }, auth(insp));
    }
    await call(app, 'POST', '/api/shadow/discrepancies', disc({ registerVerdict: 'CONDEMNED', appVerdict: 'PASS', whoWasRight: 'REGISTER' }), auth(sup));
    await call(app, 'POST', '/api/shadow/summaries', { summaryDate: TODAY, shift: 'A', registerMinutesOneWagon: 42, appMinutesOneWagon: 30, transcriptionErrorsBoxMissed: 1, whatAppGotWrong: 'one band' }, auth(sup));
    const rep = await call(app, 'GET', '/api/shadow/report?days=7', undefined, auth(sup));
    assert.strictEqual(rep.status, 200, JSON.stringify(rep.body));
    const today = rep.body.data.days.find((d: any) => d.date === TODAY);
    assert.strictEqual(today.springsRecorded, 12);
    assert.strictEqual(today.springsCondemned, 3);
    assert.strictEqual(today.discrepanciesLogged, 1);
    // Twelve taps in milliseconds: the rate is flagged as not a person's.
    assert.strictEqual(today.bench.springsPerHour.plausible, false);
    assert.strictEqual(rep.body.data.anyImplausible, true);
    assert.strictEqual(rep.body.data.verdict.blocking, true);
    assert.strictEqual(rep.body.data.summaries.length, 1);
    assert.strictEqual(rep.body.data.verdict.timing.pairs, 1);
  });

  it('TC-SH-14: the latest summary for a shift is the record; the earlier one survives', async () => {
    await call(app, 'POST', '/api/shadow/summaries', { summaryDate: TODAY, shift: 'A', registerMinutesOneWagon: 40 }, auth(sup));
    await call(app, 'POST', '/api/shadow/summaries', { summaryDate: TODAY, shift: 'A', registerMinutesOneWagon: 45 }, auth(sup));
    const list = await call(app, 'GET', '/api/shadow/summaries', undefined, auth(sup));
    assert.strictEqual(list.body.data.length, 1);
    assert.strictEqual(list.body.data[0].registerMinutesOneWagon, 45);
    assert.strictEqual((getDatabase().prepare('SELECT COUNT(*) n FROM shadow_daily_summaries').get() as any).n, 2);
  });

  it('TC-SH-15: the export carries the log, the summaries, the app\'s days and the verdict', async () => {
    await call(app, 'POST', '/api/shadow/discrepancies', disc({ why: 'strip read as "yellow", app said green; re-measured 262.1' }), auth(sup));
    const csv = await call(app, 'GET', '/api/shadow/export.csv?days=7', undefined, auth(sup));
    assert.strictEqual(csv.status, 200);
    const text = String(csv.body);
    assert.match(text, /discrepancy log/);
    assert.match(text, /"yellow"/);
    assert.match(text, /Daily summaries/);
    assert.match(text, /app_passed_register_condemned,0/);
  });
});
