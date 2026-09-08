/**
 * Reading a spring photograph blind — the camera's go/no-go
 * Indian Railways WRS Raipur
 *
 * The one question that decides whether the DRM's camera is possible: can a
 * second person read the band from the stored photograph without seeing what
 * the bench recorded? These pin that the label never reaches the reader, that
 * a reader cannot read their own photographs, that agreement is computed from
 * the unseen label, and that no verdict is issued on too few reads.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createApp } from '../src/app.ts';
import { getDatabase } from '../src/db/connection.ts';
import { SortingRepository } from '../src/db/sortingRepository.ts';
import type { ExpressApp } from '../src/framework/index.ts';

async function call(app: ExpressApp, method: string, path: string, body?: any, headers: Record<string, string> = {}) {
  return app.dispatch({ method, url: path, body, headers });
}
async function signIn(app: ExpressApp, username: string): Promise<string> {
  const res = await call(app, 'POST', '/api/auth/login', { username, password: 'password123' });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  return res.body.token;
}
const px = (c: string) => 'data:image/jpeg;base64,' + c.repeat(64);

describe('Blind reading of spring photographs', () => {
  let app: ExpressApp;
  let ids: string[] = [];

  beforeEach(() => {
    app = createApp(':memory:');
    const repo = new SortingRepository(getDatabase());
    ids = [];
    // Three photographs taken by inspector1, labelled at the bench.
    for (const [band, status, c] of [['BLUE', 'PASS', 'A'], ['GREEN', 'PASS', 'B'], ['RED', 'CONDEMNED', 'C']] as const) {
      const r = repo.attachImage({ batchId: 'b1', bogieType: 'CASNUB_22_NLB', condition: 'USED', springPosition: 'OUTER', labelledBand: band, labelledStatus: status, imageData: px(c), inspectorId: 'usr_insp_001' });
      ids.push(r!.id);
    }
  });

  it('TC-BR-01: the next photograph carries no label', async () => {
    const token = await signIn(app, 'inspector2');
    const res = await call(app, 'GET', '/api/sorting/blind-read/next', undefined, { authorization: `Bearer ${token}` });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.data?.id, 'a photograph is offered');
    assert.strictEqual(res.body.data.band, undefined, 'the label must not travel');
    assert.strictEqual(res.body.data.status, undefined);
    assert.strictEqual(res.body.data.labelledBand, undefined);
    assert.strictEqual(res.body.data.measuredHeight, undefined);
  });

  it('TC-BR-02: a reader is never offered their own photographs', async () => {
    const token = await signIn(app, 'inspector1');
    const res = await call(app, 'GET', '/api/sorting/blind-read/next', undefined, { authorization: `Bearer ${token}` });
    assert.strictEqual(res.body.data, null, 'every photograph here is inspector1’s own');
  });

  it('TC-BR-03: agreement is computed from the label the reader did not see', async () => {
    const token = await signIn(app, 'inspector2');
    const right = await call(app, 'POST', '/api/sorting/blind-read', { imageId: ids[0], band: 'BLUE', status: 'PASS' }, { authorization: `Bearer ${token}` });
    assert.strictEqual(right.status, 201, JSON.stringify(right.body));
    assert.strictEqual(right.body.data.bandAgrees, true);
    const wrong = await call(app, 'POST', '/api/sorting/blind-read', { imageId: ids[1], band: 'YELLOW', status: 'PASS' }, { authorization: `Bearer ${token}` });
    assert.strictEqual(wrong.body.data.bandAgrees, false);
    assert.strictEqual(wrong.body.data.statusAgrees, true);
    const cannot = await call(app, 'POST', '/api/sorting/blind-read', { imageId: ids[2], band: null, status: 'CANNOT_TELL' }, { authorization: `Bearer ${token}` });
    assert.strictEqual(cannot.body.data.bandAgrees, null, '“cannot tell” is neither right nor wrong');
  });

  it('TC-BR-04: once read, a photograph is not offered to that reader again', async () => {
    const token = await signIn(app, 'inspector2');
    for (const id of ids) await call(app, 'POST', '/api/sorting/blind-read', { imageId: id, band: 'BLUE', status: 'PASS' }, { authorization: `Bearer ${token}` });
    const res = await call(app, 'GET', '/api/sorting/blind-read/next', undefined, { authorization: `Bearer ${token}` });
    assert.strictEqual(res.body.data, null);
  });

  it('TC-BR-05: no verdict on too few reads, and the thresholds are the plan’s', async () => {
    const token = await signIn(app, 'inspector2');
    await call(app, 'POST', '/api/sorting/blind-read', { imageId: ids[0], band: 'BLUE', status: 'PASS' }, { authorization: `Bearer ${token}` });
    const drm = await signIn(app, 'drm1');
    const res = await call(app, 'GET', '/api/sorting/blind-read/agreement', undefined, { authorization: `Bearer ${drm}` });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.data.verdict, 'INSUFFICIENT', 'one read is not evidence');
    assert.strictEqual(res.body.data.minReads, 30);
    assert.strictEqual(res.body.data.bandAgreementPct, 100);
  });

  it('TC-BR-06: the agreement figure is the division’s to read, not the bench’s', async () => {
    const insp = await signIn(app, 'inspector2');
    const res = await call(app, 'GET', '/api/sorting/blind-read/agreement', undefined, { authorization: `Bearer ${insp}` });
    assert.strictEqual(res.status, 403);
  });
});
