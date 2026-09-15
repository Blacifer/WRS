/**
 * Ask the records — a model may pick the question; it may never produce the number
 * Indian Railways WRS Raipur
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { createApp } from '../src/app.ts';
import { getDatabase } from '../src/db/connection.ts';
import { config } from '../src/config/index.ts';
import { matchQuestion, validateParams, foldSynonyms } from '../../shared/knowledge/askResolver.ts';
import { ASK_CATALOGUE } from '../../shared/knowledge/askCatalogue.ts';
import { ask, resolveWithModel, modelPosture } from '../src/ask/askRecords.ts';
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

describe('the matcher, offline', () => {
  it('TC-ASK-01: the common questions resolve with no model, in either language', () => {
    const cases: Array<[string, string, Record<string, string>]> = [
      ['which wagon type condemns the most snubbers this quarter', 'condemnation_by_wagon_type', { springPosition: 'SNUBBER', period: 'this quarter' }],
      ['how many springs were sorted per day this week', 'springs_sorted_per_day', { period: 'this week' }],
      ['band distribution for outer springs this month', 'band_distribution', { springPosition: 'OUTER', period: 'this month' }],
      ['which part keeps coming back', 'part_fails_most', {}],
      ['which wagons are blocked at the gate', 'wagons_blocked', {}],
      ['how long does each stage take for BOXNHL', 'stage_dwell', { wagonType: 'BOXNHL' }],
      ['wagons released last month', 'wagons_released', { period: 'last month' }],
      ['how many wagons are in the shop now', 'wagons_in_shop', {}],
      ['show me everything on wagon SECR/BOXNHL/40101', 'wagon_history', { wagonNumber: 'SECR/BOXNHL/40101' }],
      ['what was replaced on wagon SECR/BOXNHL/40101', 'parts_replaced_on_wagon', { wagonNumber: 'SECR/BOXNHL/40101' }],
      ['condemnation rate per inspector this quarter', 'inspector_condemnation', { period: 'this quarter' }],
      ['how many supervisor overrides this month', 'overrides', { period: 'this month' }],
      ['forecast spring replacements for the next 30 days', 'forecast_replacements', { period: '30 days' }],
      ['how many BOXN M1 wagons came in this year', 'wagons_of_type_received', { wagonType: 'BOXN M1', period: 'this year' }],
      ['is any gauge reading high', 'gauge_drift', { period: 'quarter' }],
      ['इस तिमाही में किस वैगन प्रकार में सबसे अधिक स्नबर कंडम हुए', 'condemnation_by_wagon_type', { springPosition: 'SNUBBER', period: 'this quarter' }],
      ['इस सप्ताह प्रति दिन कितनी स्प्रिंग छाँटी गईं', 'springs_sorted_per_day', { period: 'this week' }]
    ];
    for (const [q, id, params] of cases) {
      const r = matchQuestion(q);
      assert.ok(r, `no match for "${q}"`);
      assert.strictEqual(r!.id, id, `"${q}" -> ${r!.id}`);
      for (const [k, v] of Object.entries(params)) assert.strictEqual(r!.params[k], v, `"${q}" ${k}`);
      assert.strictEqual(r!.matchedBy, 'MATCHER');
    }
  });

  it('TC-ASK-02: a sentence that could mean two things, or nothing, is not guessed at', () => {
    assert.strictEqual(matchQuestion('tell me about the wagon'), null, 'a wagon question with no number is unanswerable');
    assert.strictEqual(matchQuestion('what is the meaning of life'), null);
    assert.strictEqual(matchQuestion(''), null);
  });

  it('TC-ASK-03: every question in the catalogue has a runner, and synonyms fold both ways', () => {
    assert.ok(ASK_CATALOGUE.length >= 15);
    assert.match(foldSynonyms('scrapped by inspector'), / condemn .* inspector /);
    assert.match(foldSynonyms('कंडम'), / condemn /);
  });

  it('TC-ASK-04: parameters are allowlisted, whoever sends them', () => {
    const q = ASK_CATALOGUE.find((x) => x.id === 'condemnation_by_wagon_type')!;
    assert.strictEqual(validateParams(q, { springPosition: 'SNUBBER', period: 'year' }).ok, true);
    assert.strictEqual(validateParams(q, { springPosition: 'ROBOT' }).ok, false);
    assert.strictEqual(validateParams(q, { period: "'; DROP TABLE wagons; --" }).ok, false);
    assert.strictEqual(validateParams(q, { period: '45 days' }).ok, true);
    assert.strictEqual(validateParams(q, { somethingElse: 1 }).ok, false, 'a parameter the question does not take is refused, not ignored');
    const h = ASK_CATALOGUE.find((x) => x.id === 'wagon_history')!;
    assert.strictEqual(validateParams(h, {}).ok, false, 'a required parameter missing');
    assert.strictEqual(validateParams(h, { wagonNumber: 'not a wagon' }).ok, false);
  });
});

describe('the answers', () => {
  let app: ExpressApp; let sup: string; let insp: string;
  const savedKey = (config as any).zapheitApiKey;
  beforeEach(async () => {
    // A developer .env may carry a real key; these tests are about the matcher and must not call anyone.
    (config as any).zapheitApiKey = null;
    app = createApp(':memory:');
    sup = await signIn(app, 'supervisor1');
    insp = await signIn(app, 'inspector1');
  });

  it('TC-ASK-10: every answer carries figures with counts and a citation naming its source', async () => {
    await call(app, 'POST', '/api/wagons/register', { wagonNumber: 'SECR/BOXNHL/40101', wagonType: 'BOXNHL', owningRailway: 'SECR' }, auth(sup));
    for (let i = 0; i < 6; i++) await call(app, 'POST', '/api/sorting/record', { batchId: 'b', bogieType: 'CASNUB_22_NLB', condition: 'USED', springPosition: 'OUTER', measuredFreeHeight: i < 2 ? 200 : 258 }, auth(insp));
    for (const q of ASK_CATALOGUE) {
      const params: Record<string, string> = {};
      if (q.params.wagonNumber) params.wagonNumber = 'SECR/BOXNHL/40101';
      const a: any = await ask(getDatabase(), q.id, 'en', { id: q.id, params });
      assert.strictEqual(a.answered, undefined, `${q.id}: ${a.reason}`);
      assert.ok(typeof a.sentence === 'string' && a.sentence.length > 10, `${q.id} has a sentence`);
      assert.ok(Array.isArray(a.citations) && a.citations.length >= 1, `${q.id} cites its source`);
      assert.ok(a.citations.every((c: any) => typeof c.source === 'string' && c.source.length > 0));
      assert.ok(Array.isArray(a.columns) && Array.isArray(a.rows), `${q.id} returns rows`);
    }
  });

  it('TC-ASK-11: the sorted-per-day answer is arithmetic over the rows it cites', async () => {
    for (let i = 0; i < 5; i++) await call(app, 'POST', '/api/sorting/record', { batchId: 'b', bogieType: 'CASNUB_22_NLB', condition: 'USED', springPosition: 'OUTER', measuredFreeHeight: i === 0 ? 200 : 258 }, auth(insp));
    const r = await call(app, 'POST', '/api/ask', { question: 'how many springs were sorted today' }, auth(sup));
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const a = r.body.data;
    assert.strictEqual(a.id, 'springs_sorted_per_day');
    assert.match(a.sentence, /^5 springs sorted on 1 day/);
    assert.strictEqual(a.rows[0].sorted, 5);
    assert.strictEqual(a.rows[0].condemned, 1);
    assert.match(a.citations[0].query, /spring_sorting_records/);
    assert.strictEqual(a.matchedBy, 'MATCHER');
  });

  it('TC-ASK-12: an unanswerable sentence returns the list, not a guess, and says whether a model tried', async () => {
    const r = await call(app, 'POST', '/api/ask', { question: 'what is the capital of Chhattisgarh' }, auth(sup));
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.data.answered, false);
    assert.match(r.body.data.reason, /no model is configured/);
    assert.ok(r.body.data.catalogue.length >= 15);
  });

  it('TC-ASK-13: DRM and admin may ask; an inspector may not', async () => {
    const drm = await signIn(app, 'drm1');
    assert.strictEqual((await call(app, 'POST', '/api/ask', { id: 'wagons_in_shop' }, auth(drm))).status, 200);
    assert.strictEqual((await call(app, 'POST', '/api/ask', { id: 'wagons_in_shop' }, auth(insp))).status, 403);
  });
  afterEach(() => { (config as any).zapheitApiKey = savedKey; });
});

describe('the model\'s turn', () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => { (config as any).zapheitApiKey = 'test-key'; });
  afterEach(() => { (config as any).zapheitApiKey = null; globalThis.fetch = originalFetch; (config as any).zapheitBaseUrl = 'https://api.zapheit.com/v1'; });

  const reply = (content: string) => { globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200, headers: { 'content-type': 'application/json' } })) as any; };

  it('TC-ASK-20: the model sees the sentence and the catalogue, never a record, and its pick is validated like anyone\'s', async () => {
    let sent: any = null;
    globalThis.fetch = (async (_url: any, init: any) => { sent = JSON.parse(init.body); return new Response(JSON.stringify({ choices: [{ message: { content: '{"id":"band_distribution","params":{"springPosition":"INNER","period":"month"}}' } }] }), { status: 200, headers: { 'content-type': 'application/json' } }); }) as any;
    const r = await resolveWithModel('so how are the inner ones spread out lately');
    assert.deepStrictEqual(r, { id: 'band_distribution', params: { springPosition: 'INNER', period: 'month' }, confidence: 0.5, matchedBy: 'MODEL' });
    const text = JSON.stringify(sent.messages);
    assert.match(text, /band_distribution/);
    assert.doesNotMatch(text, /spring_sorting_records|SELECT|wagon_number/, 'no table, no query, no record goes to the model');
  });

  it('TC-ASK-21: a catalogue id the model invents, or a value it invents, is refused', async () => {
    reply('{"id":"delete_everything","params":{}}');
    assert.strictEqual(await resolveWithModel('anything'), null);
    reply('{"id":"condemnation_by_wagon_type","params":{"springPosition":"MIDDLE"}}');
    assert.strictEqual(await resolveWithModel('anything'), null);
    reply('not json at all');
    assert.strictEqual(await resolveWithModel('anything'), null);
  });

  it('TC-ASK-22: the answer to a model-picked question is still the fixed query — the model wrote no number', async () => {
    const app = createApp(':memory:');
    const sup = await signIn(app, 'supervisor1');
    reply('{"id":"wagons_in_shop","params":{}}');
    const r = await call(app, 'POST', '/api/ask', { question: 'roughly what have we got on the floor at the minute' }, auth(sup));
    assert.strictEqual(r.body.data.matchedBy, 'MODEL');
    assert.strictEqual(r.body.data.id, 'wagons_in_shop');
    assert.match(r.body.data.citations[0].query, /FROM wagons/);
  });

  it('TC-ASK-23: the posture says whether the model is on this machine', () => {
    (config as any).zapheitBaseUrl = 'http://localhost:11434/v1';
    assert.deepStrictEqual(modelPosture(), { configured: true, local: true, baseUrl: 'http://localhost:11434/v1' });
    (config as any).zapheitBaseUrl = 'https://api.zapheit.com/v1';
    assert.strictEqual(modelPosture().local, false);
  });
});
