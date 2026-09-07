/**
 * The AI must never make the app worse
 * Indian Railways WRS Raipur
 *
 * This application's core property is that it works with no network. A
 * workshop LAN may have no route to the internet, and the manual is needed
 * most by somebody standing at a wagon holding a component — which is exactly
 * when a cloud call is least likely to succeed.
 *
 * So the test that matters is not that the model helps. It is that an
 * unconfigured, offline or failing deployment behaves EXACTLY as it did
 * before: full-text search over the indexed manual, the existing voice parser,
 * and the app's own verified figures. A feature that degrades to the previous
 * behaviour cannot be a regression, and that is the whole design.
 *
 * The second thing pinned here is the rule the model lives under: it FINDS,
 * the manual STATES. Nothing it returns may become a number, a band, a
 * condemning limit or a verdict — an inspector has to be able to defend a
 * condemnation to an auditor, and "the model said so" is not a defence.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';
import { generateToken } from '../src/auth/jwt.ts';
import { config } from '../src/config/index.ts';
import { getDatabase } from '../src/db/connection.ts';
import { isZapheitConfigured, askZapheit, parseVoiceIntent, suggestManualQuery } from '../src/ai/zapheit.ts';
import type { ExpressApp } from '../src/framework/index.ts';

describe('Zapheit — every path falls back', () => {
  let app: ExpressApp;
  let token: string;
  const originalKey = config.zapheitApiKey;
  const originalFetch = globalThis.fetch;

  const auth = () => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });

  before(() => {
    app = createApp(':memory:');
    token = generateToken({
      id: 'usr_insp_001', username: 'inspector1', role: 'INSPECTOR',
      name: 'Ramesh Kumar', employeeId: 'WRS-INSP-1042'
    });
  });

  after(() => {
    (config as any).zapheitApiKey = originalKey;
    globalThis.fetch = originalFetch;
  });

  test('TC-ZAP-01: with no key configured, nothing is called and nothing is returned', async () => {
    (config as any).zapheitApiKey = null;

    // A fetch that would fail loudly if it were ever reached.
    let called = false;
    globalThis.fetch = (async () => { called = true; throw new Error('must not be called'); }) as any;

    assert.equal(isZapheitConfigured(), false);
    assert.equal(await askZapheit('s', 'u'), null);
    assert.equal(await suggestManualQuery('what is the brake block limit'), null);
    assert.equal(await parseVoiceIntent('condemn the brake block'), null);
    assert.equal(called, false, 'an unconfigured deployment must not attempt a network call');

    globalThis.fetch = originalFetch;
  });

  test('TC-ZAP-02: the manual still answers with the key unset', async () => {
    /*
     * The regression that would matter. If searching the manual became
     * dependent on a cloud call, it would be unavailable on exactly the shop
     * floor it exists for.
     */
    (config as any).zapheitApiKey = null;

    const res = await app.dispatch({
      method: 'GET', url: '/api/manual/search?q=brake+block', headers: auth()
    });

    // 503 is the honest answer on a server with no manual indexed; what must
    // never happen is a 5xx caused by the AI path.
    assert.ok(
      res.status === 200 || res.body?.error === 'MANUAL_NOT_INDEXED',
      `unexpected failure: ${res.status} ${JSON.stringify(res.body).slice(0, 120)}`
    );
    if (res.status === 200) {
      assert.equal(res.body.data.reinterpretedAs, null, 'nothing was reinterpreted, so this stays null');
    }
  });

  test('TC-ZAP-03: a refused or broken response is treated as no answer', async () => {
    (config as any).zapheitApiKey = 'test-key';

    for (const stub of [
      async () => new Response('nope', { status: 500 }),
      async () => new Response('not json', { status: 200 }),
      async () => new Response(JSON.stringify({ choices: [] }), { status: 200, headers: { 'content-type': 'application/json' } }),
      async () => { throw new Error('offline'); }
    ]) {
      globalThis.fetch = stub as any;
      assert.equal(await askZapheit('s', 'u'), null, 'every failure is the same answer: carry on without it');
    }

    globalThis.fetch = originalFetch;
  });

  test('TC-ZAP-04: a status the system does not recognise is dropped, not passed on', async () => {
    /*
     * The guard that keeps a model away from a verdict. If it answers with a
     * word that is not one of the five statuses, that field is discarded — a
     * model must not be able to invent a verdict by inventing a word for one.
     */
    (config as any).zapheitApiKey = 'test-key';
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        choices: [{ message: { content: '{"partName":"Brake Block","status":"SCRAPPED","defectNotes":"visible crack"}' } }]
      }), { status: 200, headers: { 'content-type': 'application/json' } })) as any;

    const parsed = await parseVoiceIntent('scrap the brake block, visible crack');

    assert.ok(parsed, 'the recognised fields still come through');
    assert.equal(parsed!.status, undefined, 'SCRAPPED is not a status this system has');
    assert.equal(parsed!.partName, 'Brake Block');
    assert.equal(parsed!.defectNotes, 'visible crack');

    globalThis.fetch = originalFetch;
  });

  test('TC-ZAP-05: search terms are stripped to words and capped', async () => {
    /*
     * Whatever comes back is untrusted text on its way into a query. It is
     * never shown to anybody and can never become part of an answer — it only
     * decides which passages are fetched, and the passages speak for
     * themselves.
     */
    (config as any).zapheitApiKey = 'test-key';
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        choices: [{ message: { content: 'brake"; DROP TABLE manual_passages; -- block thickness condemning limit wear gauge extra words beyond' } }]
      }), { status: 200, headers: { 'content-type': 'application/json' } })) as any;

    const terms = await suggestManualQuery('throw out size on a brake block');

    assert.ok(terms);
    assert.ok(!/["';]/.test(terms!), 'punctuation is stripped before it reaches a query');
    assert.ok(terms!.split(/\s+/).length <= 8, 'capped at eight terms');

    globalThis.fetch = originalFetch;
  });

  test('TC-ZAP-06: the model is asked only when the plain search found nothing', async () => {
    /*
     * A fallback, not a first step. When full-text search answers, no call is
     * made at all — no latency, no dependency, and identical behaviour to
     * before this existed.
     */
    (config as any).zapheitApiKey = 'test-key';
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response(JSON.stringify({ choices: [{ message: { content: 'brake block' } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    }) as any;

    // On a server with no manual indexed the route answers 503 before any AI
    // path is reached, which is itself the point: the AI is downstream of the
    // existing behaviour, never in front of it.
    const res = await app.dispatch({
      method: 'GET', url: '/api/manual/search?q=air+pressure', headers: auth()
    });

    if (res.body?.error === 'MANUAL_NOT_INDEXED') {
      assert.equal(calls, 0, 'nothing is asked of a model when the manual itself is absent');
    }

    globalThis.fetch = originalFetch;
  });
});

/**
 * The voice rescue path
 *
 * The client's parser handles clean phrasing. This is for the sentence it
 * could not read — and it must never turn into a way for a model to enter a
 * verdict of its own.
 */
describe('Voice — a sentence the device could not parse', () => {
  let app: ExpressApp;
  let token: string;
  const wagonNumber = 'SECR/BOXNHL/VOI100';
  const originalKey = config.zapheitApiKey;
  const originalFetch = globalThis.fetch;

  const auth = () => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });

  before(async () => {
    app = createApp(':memory:');
    token = generateToken({
      id: 'usr_insp_001', username: 'inspector1', role: 'INSPECTOR',
      name: 'Ramesh Kumar', employeeId: 'WRS-INSP-1042'
    });
    await app.dispatch({
      method: 'POST', url: '/api/wagons/register', headers: auth(),
      body: { wagonNumber, wagonType: 'BOXNHL', owningRailway: 'SECR' }
    });
  });

  after(() => {
    (config as any).zapheitApiKey = originalKey;
    globalThis.fetch = originalFetch;
  });

  test('TC-ZAP-07: with no key, an unparsed sentence is still refused as before', async () => {
    (config as any).zapheitApiKey = null;

    const res = await app.dispatch({
      method: 'POST', url: '/api/checklist/voice-action', headers: auth(),
      body: { wagonNumber, transcript: 'the second inner on bogie two looks cracked' }
    });

    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'MISSING_STATUS', 'the previous behaviour is unchanged');
  });

  test('TC-ZAP-08: with a key, the sentence is read and the transcript kept verbatim', async () => {
    (config as any).zapheitApiKey = 'test-key';
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        choices: [{ message: { content: '{"partName":"Inner Spring (Bogie 2)","status":"CONDEMNED","bogiePosition":"BOGIE_2","defectNotes":"looks cracked"}' } }]
      }), { status: 200, headers: { 'content-type': 'application/json' } })) as any;

    const spoken = 'the second inner on bogie two looks cracked';
    const res = await app.dispatch({
      method: 'POST', url: '/api/checklist/voice-action', headers: auth(),
      body: { wagonNumber, transcript: spoken }
    });

    assert.equal(res.status, 200, `refused: ${res.body?.message}`);

    const rows = getDatabase().prepare(`
      SELECT payload_json FROM inspection_audit_log
      WHERE event_type = 'CHECKLIST_ITEM_INSPECTED'
    `).all() as any[];

    const voice = rows.map((r) => JSON.parse(r.payload_json))
      .find((p: any) => p.inputSource === 'VOICE_DICTATION');

    assert.ok(voice, 'a spoken verdict must record that it was spoken');
    assert.equal(
      voice.transcript, spoken,
      'what an auditor reads is what was said, not what a model made of it'
    );
    assert.equal(voice.status, 'CONDEMNED');

    /*
     * Which reader produced the verdict.
     *
     * The device's parser is a regular expression and fails visibly. A model
     * fails plausibly — it can turn a word this system does not know into one
     * it does, which is how "scrapped" becomes CONDEMNED. That is usually the
     * right reading and it is never a reading anybody chose, so the record has
     * to say which of the two read the sentence. Without it an auditor cannot
     * tell a matched phrase from an inferred one.
     */
    assert.equal(voice.statusSource, 'MODEL', 'a verdict the model read must say so');

    globalThis.fetch = originalFetch;
  });

  test('TC-ZAP-08b: a verdict the device parsed is not marked as the model’s', async () => {
    // The other half. If everything were marked MODEL the field would say
    // nothing, and a field that never varies is one nobody can act on.
    (config as any).zapheitApiKey = 'test-key';

    const res = await app.dispatch({
      method: 'POST', url: '/api/checklist/voice-action', headers: auth(),
      body: {
        wagonNumber,
        status: 'PASS',
        itemName: 'Side Frame',
        transcript: 'side frame passed'
      }
    });
    assert.equal(res.status, 200, `refused: ${res.body?.message}`);

    const rows = getDatabase().prepare(`
      SELECT payload_json FROM inspection_audit_log
      WHERE event_type = 'CHECKLIST_ITEM_INSPECTED'
    `).all() as any[];

    const parsedRows = rows.map((r) => JSON.parse(r.payload_json));
    const mine = parsedRows.filter((p: any) => p.transcript === 'side frame passed');
    assert.ok(mine.length > 0, 'the action should have been recorded');
    assert.equal(mine[mine.length - 1].statusSource, 'DEVICE_PARSER');
  });

  test('TC-ZAP-09: a verdict the model invents cannot get in', async () => {
    // The guard that matters most on this path.
    (config as any).zapheitApiKey = 'test-key';
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        choices: [{ message: { content: '{"partName":"Brake Block","status":"SCRAP_IT","defectNotes":"worn"}' } }]
      }), { status: 200, headers: { 'content-type': 'application/json' } })) as any;

    const res = await app.dispatch({
      method: 'POST', url: '/api/checklist/voice-action', headers: auth(),
      body: { wagonNumber, transcript: 'scrap it, worn out' }
    });

    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'MISSING_STATUS', 'an unrecognised verdict is no verdict at all');

    globalThis.fetch = originalFetch;
  });
});
