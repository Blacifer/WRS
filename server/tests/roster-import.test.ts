/**
 * The roster in one go — every row checked before any is written
 * Indian Railways WRS Raipur
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';
import type { ExpressApp } from '../src/framework/index.ts';

async function call(app: ExpressApp, method: string, path: string, body?: any, headers: Record<string, string> = {}) {
  return app.dispatch({ method, url: path, body, headers });
}
async function signIn(app: ExpressApp, username: string): Promise<string> {
  const res = await call(app, 'POST', '/api/auth/login', { username, password: 'password123' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.token;
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

describe('the roster import', () => {
  let app: ExpressApp; let admin: string;
  beforeEach(async () => { app = createApp(':memory:'); admin = await signIn(app, 'admin1'); });

  it('TC-RST-01: creates every account with a generated password, returned once, usernames made from names', async () => {
    const r = await call(app, 'POST', '/api/auth/users/import', { otpToken: 'test_token_override', rows: [
      { fullName: 'Ramesh Kumar', employeeId: 'wrs-insp-9001', role: 'inspector' },
      { fullName: 'Ramesh Kumar', employeeId: 'WRS-INSP-9002', role: 'INSPECTOR' },
      { fullName: 'S. K. Verma', employeeId: 'WRS-SUP-9003', role: 'Supervisor', username: 'sk.verma' }
    ] }, auth(admin));
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const created = r.body.data.created;
    assert.deepEqual(created.map((c: any) => c.username), ['ramesh.kumar', 'ramesh.kumar2', 'sk.verma']);
    assert.ok(created.every((c: any) => c.password.length === 14 && !/[0OIl1]/.test(c.password)), 'passwords have no look-alike characters');
    assert.equal(created[0].employeeId, 'WRS-INSP-9001');
    // Each can sign in with the slip, and the password is not in the response of anything else.
    const login = await call(app, 'POST', '/api/auth/login', { username: 'sk.verma', password: created[2].password });
    assert.equal(login.status, 200);
    const list = await call(app, 'GET', '/api/auth/users', undefined, auth(admin));
    assert.ok(!JSON.stringify(list.body).includes(created[2].password));
  });

  it('TC-RST-02: one bad row rejects the whole roster and nothing is written', async () => {
    const r = await call(app, 'POST', '/api/auth/users/import', { otpToken: 'test_token_override', rows: [
      { fullName: 'Good Person', employeeId: 'WRS-X-1', role: 'INSPECTOR' },
      { fullName: 'No Role', employeeId: 'WRS-X-2', role: 'FOREMAN' },
      { fullName: 'Ramesh Kumar', employeeId: 'WRS-INSP-1042', role: 'INSPECTOR' } // employee ID of the seeded inspector1
    ] }, auth(admin));
    assert.equal(r.status, 422);
    assert.equal(r.body.problems.length, 2);
    assert.match(r.body.problems[0].message, /role must be one of/);
    assert.match(r.body.problems[1].message, /already has an account/);
    const list = await call(app, 'GET', '/api/auth/users', undefined, auth(admin));
    assert.ok(!list.body.data.some((u: any) => u.username === 'good.person'), 'the good row was not written either');
  });

  it('TC-RST-03: needs the confirmation code and the users.manage capability', async () => {
    const noToken = await call(app, 'POST', '/api/auth/users/import', { rows: [{ fullName: 'A B', employeeId: 'WRS-1', role: 'INSPECTOR' }] }, auth(admin));
    assert.equal(noToken.status, 401);
    const sup = await signIn(app, 'supervisor1');
    const notAdmin = await call(app, 'POST', '/api/auth/users/import', { otpToken: 'test_token_override', rows: [{ fullName: 'A B', employeeId: 'WRS-1', role: 'INSPECTOR' }] }, auth(sup));
    assert.equal(notAdmin.status, 403);
  });
});
