/**
 * Parts in, parts out — over real HTTP
 * Indian Railways WRS Raipur
 *
 * The DRM's worry is what happens after a wagon leaves: that somebody asks
 * whether anything was missing and the record cannot answer. These pin the
 * properties that make the answer worth having — that the balance is derived
 * from immutable events rather than stored, that a part not going back needs a
 * recorded decision rather than a silent absence, that more going back on than
 * came off is reported rather than netted away, and that the route is
 * reachable at all past a wagon number full of slashes.
 *
 * That last one is not paranoia. Wagon numbers here look like
 * SECR/BOXNHL/40101, so a bare `/:wagonNumber` matches across path segments
 * and silently swallows everything registered after it — which has already
 * happened once in this codebase, to the single wagon test route.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createApp } from '../src/app.ts';
import { getDatabase } from '../src/db/connection.ts';
import { partKeyFor, PartLedgerRepository } from '../src/db/partLedgerRepository.ts';
import type { ExpressApp } from '../src/framework/index.ts';

async function call(
  app: ExpressApp,
  method: string,
  path: string,
  body?: any,
  headers: Record<string, string> = {}
) {
  return app.dispatch({ method, url: path, body, headers });
}

async function signIn(app: ExpressApp, username: string): Promise<string> {
  const res = await call(app, 'POST', '/api/auth/login', { username, password: 'password123' });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  return res.body.token;
}

const auth = (t: string) => ({ authorization: `Bearer ${t}` });

const WAGON = 'SECR/BOXNHL/40101';
const enc = encodeURIComponent(WAGON).replace(/%2F/g, '/');

async function registerWagon(app: ExpressApp, token: string): Promise<void> {
  const res = await call(
    app,
    'POST',
    '/api/wagons/register',
    { wagonNumber: WAGON, wagonType: 'BOXNHL', owningRailway: 'SECR' },
    auth(token)
  );
  assert.ok(res.status === 201 || res.status === 200, JSON.stringify(res.body));
}

const wedge = (event: string, extra: Record<string, unknown> = {}) => ({
  category: 'FRICTION_WEDGES',
  partName: 'Friction Wedge',
  bogiePosition: 'BOGIE_1',
  event,
  ...extra
});

describe('The parts ledger', () => {
  let app: ExpressApp;
  let token: string;

  beforeEach(async () => {
    app = createApp(':memory:');
    token = await signIn(app, 'inspector1');
    await registerWagon(app, token);
  });

  it('TC-PL-01: the route survives a wagon number full of slashes', async () => {
    // The trap this codebase has already fallen into once. If partLedgerRouter
    // were mounted after wagonsRouter, this would come back as a wagon record
    // rather than a ledger, with a 200 that looks like success.
    const res = await call(app, 'GET', `/api/wagons/${enc}/parts`, undefined, auth(token));
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.deepStrictEqual(res.body.data.entries, []);
    assert.strictEqual(res.body.data.wagonNumber, WAGON);
  });

  it('TC-PL-02: an empty ledger says it cannot answer, rather than saying nothing is missing', async () => {
    // The dangerous failure would be a wagon with no recorded dismantling
    // reading as "balanced" at the gate.
    const res = await call(
      app,
      'GET',
      `/api/wagons/${enc}/parts/reconciliation`,
      undefined,
      auth(token)
    );
    assert.strictEqual(res.status, 200);
    assert.match(res.body.data.summary, /Nothing has been recorded coming off/i);
    assert.match(res.body.data.summary, /can say nothing/i);
  });

  it('TC-PL-03: four off and three back leaves one outstanding, named', async () => {
    await call(app, 'POST', `/api/wagons/${enc}/parts`, wedge('REMOVED', { quantity: 4 }), auth(token));
    await call(app, 'POST', `/api/wagons/${enc}/parts`, wedge('REFITTED', { quantity: 3 }), auth(token));

    const res = await call(app, 'GET', `/api/wagons/${enc}/parts/reconciliation`, undefined, auth(token));
    assert.strictEqual(res.body.data.balanced, false);
    assert.strictEqual(res.body.data.outstandingParts.length, 1);

    const p = res.body.data.outstandingParts[0];
    assert.strictEqual(p.outstanding, 1);
    assert.strictEqual(p.removed, 4);
    assert.strictEqual(p.refitted, 3);
    assert.match(res.body.data.summary, /Friction Wedge/);
    assert.match(res.body.data.summary, /BOGIE_1/);
    // The assistant half: something a fitter can act on without leaving the wagon.
    assert.match(p.suggestion, /4 came off, 3 back on/);
    assert.match(p.suggestion, /deliberately not being refitted/i);
  });

  it('TC-PL-04: a part deliberately not refitted balances the wagon, with a reason on the record', async () => {
    await call(app, 'POST', `/api/wagons/${enc}/parts`, wedge('REMOVED', { quantity: 4 }), auth(token));
    await call(app, 'POST', `/api/wagons/${enc}/parts`, wedge('REFITTED', { quantity: 3 }), auth(token));
    const nf = await call(
      app,
      'POST',
      `/api/wagons/${enc}/parts`,
      wedge('NOT_FITTED', { quantity: 1, reason: 'Condemned; replacement on indent IND-2291.' }),
      auth(token)
    );
    assert.strictEqual(nf.status, 201, JSON.stringify(nf.body));

    const res = await call(app, 'GET', `/api/wagons/${enc}/parts/reconciliation`, undefined, auth(token));
    assert.strictEqual(res.body.data.balanced, true);
    assert.match(res.body.data.summary, /every one is accounted for/i);
    assert.match(res.body.data.summary, /reason and a name against it/i);
  });

  it('TC-PL-05: a part not going back cannot be recorded without saying why', async () => {
    // Without this the only way to balance a wagon is to write something
    // untrue, and a ledger people must lie in is worse than no ledger.
    for (const event of ['NOT_FITTED', 'SCRAPPED']) {
      const res = await call(app, 'POST', `/api/wagons/${enc}/parts`, wedge(event), auth(token));
      assert.strictEqual(res.status, 400, `${event}: ${JSON.stringify(res.body)}`);
      assert.match(res.body.message, /needs a reason/i);
    }
  });

  it('TC-PL-06: more going back on than came off is reported, not netted away', async () => {
    // An unrecorded removal is exactly the gap this ledger exists to close.
    // Quietly balancing it would hide the one thing worth finding.
    await call(app, 'POST', `/api/wagons/${enc}/parts`, wedge('REMOVED', { quantity: 2 }), auth(token));
    await call(app, 'POST', `/api/wagons/${enc}/parts`, wedge('REFITTED', { quantity: 4 }), auth(token));

    const res = await call(app, 'GET', `/api/wagons/${enc}/parts/reconciliation`, undefined, auth(token));
    assert.strictEqual(res.body.data.balanced, false);
    assert.strictEqual(res.body.data.unaccountedParts.length, 1);
    assert.match(res.body.data.summary, /more go back on than came off/i);
    assert.match(res.body.data.unaccountedParts[0].suggestion, /not recorded|entered twice/i);
  });

  it('TC-PL-07: two positions of the same part are two balances, not one', async () => {
    // A wagon has friction wedges on both bogies. Collapsing them would let a
    // wedge missing from bogie 2 be hidden by a spare fitted to bogie 1.
    await call(app, 'POST', `/api/wagons/${enc}/parts`, wedge('REMOVED', { quantity: 4 }), auth(token));
    await call(app, 'POST', `/api/wagons/${enc}/parts`, wedge('REFITTED', { quantity: 4 }), auth(token));
    await call(
      app,
      'POST',
      `/api/wagons/${enc}/parts`,
      { ...wedge('REMOVED', { quantity: 4 }), bogiePosition: 'BOGIE_2' },
      auth(token)
    );

    const res = await call(app, 'GET', `/api/wagons/${enc}/parts/reconciliation`, undefined, auth(token));
    assert.strictEqual(res.body.data.parts.length, 2);
    assert.strictEqual(res.body.data.outstandingParts.length, 1);
    assert.strictEqual(res.body.data.outstandingParts[0].bogiePosition, 'BOGIE_2');
  });

  it('TC-PL-08: the same part named untidily still joins to one balance', async () => {
    // A removal on Tuesday and a refit on Friday, typed by two people.
    await call(
      app,
      'POST',
      `/api/wagons/${enc}/parts`,
      { category: 'friction wedges', partName: '  Friction  Wedge ', bogiePosition: 'bogie_1', event: 'REMOVED', quantity: 2 },
      auth(token)
    );
    await call(app, 'POST', `/api/wagons/${enc}/parts`, wedge('REFITTED', { quantity: 2 }), auth(token));

    const res = await call(app, 'GET', `/api/wagons/${enc}/parts/reconciliation`, undefined, auth(token));
    assert.strictEqual(res.body.data.parts.length, 1);
    assert.strictEqual(res.body.data.balanced, true);
  });

  it('TC-PL-09: the ledger records the stage the wagon is really in, not one the client claims', async () => {
    const res = await call(
      app,
      'POST',
      `/api/wagons/${enc}/parts`,
      wedge('REMOVED', { stage: 'RELEASE' }),
      auth(token)
    );
    assert.strictEqual(res.status, 201);
    assert.notStrictEqual(res.body.data.stage, 'RELEASE');
    assert.strictEqual(res.body.data.stage, 'ENTRY_REGISTRATION');
  });

  it('TC-PL-10: what happened cannot afterwards be rewritten or deleted', async () => {
    const r = await call(app, 'POST', `/api/wagons/${enc}/parts`, wedge('REMOVED'), auth(token));
    const id = r.body.data.id;
    const db = getDatabase();
    assert.throws(
      () => db.prepare('UPDATE wagon_part_ledger SET quantity = 9 WHERE id = ?').run(id),
      /cannot be rewritten/
    );
    assert.throws(
      () => db.prepare('DELETE FROM wagon_part_ledger WHERE id = ?').run(id),
      /cannot be deleted/
    );
  });

  it('TC-PL-11: an administrator cannot record shop-floor work', async () => {
    const admin = await signIn(app, 'admin1');
    const res = await call(app, 'POST', `/api/wagons/${enc}/parts`, wedge('REMOVED'), auth(admin));
    assert.strictEqual(res.status, 403);
  });

  it('TC-PL-12: a ledger entry against an unregistered wagon is refused', async () => {
    const res = await call(
      app,
      'POST',
      '/api/wagons/SECR/BOXNHL/99999/parts',
      wedge('REMOVED'),
      auth(token)
    );
    assert.strictEqual(res.status, 404);
  });

  it('TC-PL-13: the suggestion names what stores actually hold, and where', async () => {
    // The difference between a finding and something a fitter can act on
    // without walking back to the office.
    const db = getDatabase();
    db.prepare(
      `INSERT INTO stores_inventory
         (id, part_code, part_name, category, unit_of_measure, stock_quantity,
          reserved_quantity, reorder_threshold, unit_cost_inr, bin_location)
       VALUES ('inv_fw', 'FW-01', 'Friction Wedge', 'FRICTION_WEDGES', 'EA', 14, 2, 4, 900, 'B-14')`
    ).run();

    await call(app, 'POST', `/api/wagons/${enc}/parts`, wedge('REMOVED', { quantity: 4 }), auth(token));
    await call(app, 'POST', `/api/wagons/${enc}/parts`, wedge('REFITTED', { quantity: 3 }), auth(token));

    const res = await call(app, 'GET', `/api/wagons/${enc}/parts/reconciliation`, undefined, auth(token));
    const s = res.body.data.outstandingParts[0].suggestion;
    // 14 on the shelf less 2 already reserved for another wagon. Suggesting
    // the shelf figure sends somebody to a bin that cannot supply them.
    assert.match(s, /Stores holds 12/);
    assert.match(s, /bin B-14/);
  });

  it('TC-PL-14: the balance is derived from the events and cannot be set directly', async () => {
    // A stored total can be corrected until it agrees with itself, which is
    // what would make it worthless as evidence.
    const repo = new PartLedgerRepository(getDatabase());
    const cols = (getDatabase().prepare('PRAGMA table_info(wagon_part_ledger)').all() as any[]).map(
      (c) => c.name
    );
    for (const forbidden of ['outstanding', 'balance', 'remaining', 'total']) {
      assert.ok(!cols.includes(forbidden), `${forbidden} must not be a stored column`);
    }
    assert.strictEqual(
      partKeyFor('FRICTION_WEDGES', 'Friction Wedge', 'BOGIE_1'),
      partKeyFor('friction wedges', '  Friction  Wedge ', 'bogie_1')
    );
    assert.strictEqual(repo.reconcile(WAGON).parts.length, 0);
  });
});
