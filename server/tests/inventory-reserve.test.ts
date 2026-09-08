/**
 * Reserving a part against a wagon
 * Indian Railways WRS Raipur
 *
 * WHY THESE EXIST
 * ---------------
 * POST /inventory/reserve shipped with the stores work and no screen ever
 * called it. Surfacing it exposed two faults that only mattered once a person
 * could reach it:
 *
 *   1. It never checked stock. reserved_quantity was incremented
 *      unconditionally, so a reservation for five hundred could be placed
 *      against three in the bin. Nothing failed — availability floored at zero
 *      and the shortage was discovered by a fitter walking to an empty bin.
 *
 *   2. Every reservation was logged against 'usr_adm_001'. That is the right
 *      actor for the forecast, which reserves with nobody at a keyboard. It
 *      put every inspector's stores movement in the administrator's name.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createApp } from '../src/app.ts';
import { getDatabase } from '../src/db/connection.ts';
import type { ExpressApp } from '../src/framework/index.ts';

async function call(app: ExpressApp, method: string, path: string, body?: any, headers: Record<string, string> = {}) {
  return app.dispatch({ method, url: path, body, headers });
}

async function signIn(app: ExpressApp, username: string): Promise<string> {
  const res = await call(app, 'POST', '/api/auth/login', { username, password: 'password123' });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  return res.body.token;
}

/** A part with a known, small stock level, so the limits are exact. */
function seedPart(code: string, stock: number, reserved = 0) {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO stores_inventory
      (id, part_code, part_name, category, unit_of_measure, stock_quantity,
       reserved_quantity, reorder_threshold, unit_cost_inr, bin_location)
    VALUES (?, ?, 'Test Snubber Spring', 'SPRINGS', 'NOS', ?, ?, 2, 100.0, 'A-1')
  `).run(`inv_${code}`, code, stock, reserved);
}

describe('Reserving stores against a wagon', () => {
  let app: ExpressApp;
  let token: string;

  beforeEach(async () => {
    app = createApp(':memory:');
    token = await signIn(app, 'inspector1');
  });

  it('TC-RES-01: a reservation within the available stock succeeds', async () => {
    seedPart('TESTPART1', 10);
    const res = await call(app, 'POST', '/api/inventory/reserve',
      { wagonNumber: 'SECR/BOXNHL/40101', partCode: 'TESTPART1', quantity: 3 },
      { authorization: `Bearer ${token}` });

    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(res.body.data.quantity, 3);
    assert.strictEqual(res.body.data.status, 'RESERVED');
  });

  it('TC-RES-02: reserving more than exists is refused, and nothing is reserved', async () => {
    seedPart('TESTPART2', 3);
    const res = await call(app, 'POST', '/api/inventory/reserve',
      { wagonNumber: 'SECR/BOXNHL/40101', partCode: 'TESTPART2', quantity: 500 },
      { authorization: `Bearer ${token}` });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'INSUFFICIENT_STOCK');
    // The number the person needs in order to correct the form.
    assert.match(res.body.message, /3/);

    const row = getDatabase()
      .prepare('SELECT reserved_quantity FROM stores_inventory WHERE part_code = ?')
      .get('TESTPART2') as { reserved_quantity: number };
    assert.strictEqual(row.reserved_quantity, 0, 'a refused reservation must reserve nothing');
  });

  it('TC-RES-03: stock already reserved by another wagon is not available to this one', async () => {
    // 10 in stock with 8 already spoken for leaves 2, not 10.
    seedPart('TESTPART3', 10, 8);
    const res = await call(app, 'POST', '/api/inventory/reserve',
      { wagonNumber: 'SECR/BOXNHL/40101', partCode: 'TESTPART3', quantity: 5 },
      { authorization: `Bearer ${token}` });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'INSUFFICIENT_STOCK');
  });

  it('TC-RES-04: reserving exactly what is available is allowed', async () => {
    // The boundary, in the permissive direction — an off-by-one here would
    // make the last item in the bin permanently unreservable.
    seedPart('TESTPART4', 4, 1);
    const res = await call(app, 'POST', '/api/inventory/reserve',
      { wagonNumber: 'SECR/BOXNHL/40101', partCode: 'TESTPART4', quantity: 3 },
      { authorization: `Bearer ${token}` });

    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
  });

  it('TC-RES-05: the reservation is recorded against the person who made it', async () => {
    seedPart('TESTPART5', 10);
    await call(app, 'POST', '/api/inventory/reserve',
      { wagonNumber: 'SECR/BOXNHL/40101', partCode: 'TESTPART5', quantity: 1 },
      { authorization: `Bearer ${token}` });

    const rows = getDatabase()
      .prepare(`SELECT user_id, user_role, payload_json FROM inspection_audit_log WHERE event_type = 'INVENTORY_RESERVED'`)
      .all() as Array<{ user_id: string; user_role: string; payload_json: string }>;

    const mine = rows.find((r) => JSON.parse(r.payload_json).partCode === 'TESTPART5');
    assert.ok(mine, 'the reservation must be audited');
    assert.strictEqual(mine.user_id, 'usr_insp_001', 'not the seeded administrator');
    assert.strictEqual(mine.user_role, 'INSPECTOR');
  });

  it('TC-RES-06: an unknown part is a 404, not a silent reservation', async () => {
    const res = await call(app, 'POST', '/api/inventory/reserve',
      { wagonNumber: 'SECR/BOXNHL/40101', partCode: 'NO_SUCH_PART', quantity: 1 },
      { authorization: `Bearer ${token}` });

    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.error, 'PART_NOT_FOUND');
  });

  it('TC-RES-07: a reserved part can then be issued, closing the cycle', async () => {
    // Reserve and issue were built at opposite ends and never joined, so the
    // round trip is worth asserting rather than assuming.
    seedPart('TESTPART7', 6);
    const reserved = await call(app, 'POST', '/api/inventory/reserve',
      { wagonNumber: 'SECR/BOXNHL/40101', partCode: 'TESTPART7', quantity: 2 },
      { authorization: `Bearer ${token}` });
    assert.strictEqual(reserved.status, 201, JSON.stringify(reserved.body));

    const issued = await call(app, 'POST', '/api/inventory/issue',
      { reservationId: reserved.body.data.id },
      { authorization: `Bearer ${token}` });
    assert.strictEqual(issued.status, 200, JSON.stringify(issued.body));

    const row = getDatabase()
      .prepare('SELECT stock_quantity, reserved_quantity FROM stores_inventory WHERE part_code = ?')
      .get('TESTPART7') as { stock_quantity: number; reserved_quantity: number };
    assert.strictEqual(row.stock_quantity, 4, 'issuing takes the parts out of stock');
    assert.strictEqual(row.reserved_quantity, 0, 'and releases the reservation');
  });
});
