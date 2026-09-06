/**
 * Two inspectors on the same part must not silently overwrite each other
 * Indian Railways WRS Raipur
 *
 * The repository has carried an optimistic-concurrency check from early on,
 * with a comment saying the silent-overwrite bug was fixed: when the caller
 * says which version it read, a write is refused if the row moved underneath
 * it. The route accepts the field, checks it, and answers 409 with the other
 * person's row.
 *
 * No screen ever sent it. The protection existed and never once engaged, so
 * two inspectors working the same wagon still overwrote each other silently —
 * the exact failure it was written to stop. This is the seventh thing in this
 * codebase found built on both ends and never connected.
 *
 * What that costs is specific. A condemnation is the verdict that stops a
 * wagon. If one inspector marks a brake beam CONDEMNED and another, holding a
 * screen loaded a minute earlier, taps PASS, the condemnation disappears with
 * nothing said to anybody — and the exit gate then counts a passed part.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';
import { generateToken } from '../src/auth/jwt.ts';
import type { ExpressApp } from '../src/framework/index.ts';

describe('Concurrent edits to one checklist item', () => {
  let app: ExpressApp;
  let inspectorA: string;
  let inspectorB: string;
  const wagonNumber = 'SECR/BOXNHL/CON001';

  const auth = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

  before(async () => {
    app = createApp(':memory:');
    inspectorA = generateToken({
      id: 'usr_insp_001', username: 'inspector1', role: 'INSPECTOR',
      name: 'Ramesh Kumar', employeeId: 'WRS-INSP-1042'
    });
    inspectorB = generateToken({
      id: 'usr_insp_002', username: 'inspector2', role: 'INSPECTOR',
      name: 'Praveen Singh', employeeId: 'WRS-INSP-1043'
    });
    await app.dispatch({
      method: 'POST', url: '/api/wagons/register', headers: auth(inspectorA),
      body: { wagonNumber, wagonType: 'BOXNHL', owningRailway: 'SECR' }
    });
  });

  const firstItem = async () => {
    const chk = await app.dispatch({
      method: 'GET', url: `/api/wagons/${wagonNumber}/checklist`, headers: auth(inspectorA)
    });
    return chk.body.data.allItems[0];
  };

  test('TC-CON-01: a stale verdict is refused, and the standing one survives', async () => {
    const item = await firstItem();
    const versionBothRead = item.updatedAt;

    // A condemns the part.
    const first = await app.dispatch({
      method: 'PUT', url: `/api/wagons/${wagonNumber}/checklist/items/${item.id}`,
      headers: auth(inspectorA),
      body: { status: 'CONDEMNED', conditionNotes: 'Crack along the web.', expectedUpdatedAt: versionBothRead }
    });
    assert.equal(first.status, 200);

    // B, holding a screen loaded before that, passes it.
    const second = await app.dispatch({
      method: 'PUT', url: `/api/wagons/${wagonNumber}/checklist/items/${item.id}`,
      headers: auth(inspectorB),
      body: { status: 'PASS', expectedUpdatedAt: versionBothRead }
    });

    assert.equal(second.status, 409, 'the second write must be refused, not applied');
    assert.equal(second.body.error, 'CONCURRENT_MODIFICATION');

    const after = await firstItem();
    assert.equal(after.status, 'CONDEMNED', 'the condemnation must still stand');
    assert.equal(after.conditionNotes, 'Crack along the web.');
  });

  test('TC-CON-02: the refusal hands back what the other person actually recorded', async () => {
    /*
     * Without it the second inspector is told "someone changed this" and has
     * to go and look. With it the screen can show them the standing verdict
     * immediately, which is what makes re-applying a considered decision
     * rather than a guess.
     */
    const item = await firstItem();

    const res = await app.dispatch({
      method: 'PUT', url: `/api/wagons/${wagonNumber}/checklist/items/${item.id}`,
      headers: auth(inspectorB),
      body: { status: 'PASS', expectedUpdatedAt: '2020-01-01T00:00:00.000Z' }
    });

    assert.equal(res.status, 409);
    assert.ok(res.body.data, 'the current row must come back with the refusal');
    assert.equal(res.body.data.status, 'CONDEMNED');
    assert.match(res.body.message, /changed by someone else/i);
  });

  test('TC-CON-03: a write with the current version still succeeds', async () => {
    // The check must not become an obstacle to ordinary work: one inspector
    // on one part, with a fresh screen, proceeds normally.
    const item = await firstItem();

    const res = await app.dispatch({
      method: 'PUT', url: `/api/wagons/${wagonNumber}/checklist/items/${item.id}`,
      headers: auth(inspectorA),
      body: { status: 'REPAIRED', repairAction: 'REPAIRED', expectedUpdatedAt: item.updatedAt }
    });

    assert.equal(res.status, 200, `a current write must not be refused: ${res.body?.message}`);
  });

  test('TC-CON-04: omitting the version still works, for callers that cannot send it', async () => {
    /*
     * The offline queue settles conflicts by its own rules — a queued verdict
     * is judged against the server's current state, not against a version the
     * device read hours ago — so it does not send this field. That path must
     * keep working.
     */
    const item = await firstItem();
    const res = await app.dispatch({
      method: 'PUT', url: `/api/wagons/${wagonNumber}/checklist/items/${item.id}`,
      headers: auth(inspectorA),
      body: { status: 'PASS' }
    });
    assert.equal(res.status, 200);
  });
});
