/**
 * Whether this deployment is being backed up
 * Indian Railways WRS Raipur
 *
 * The database holds every inspection, every release certificate and the
 * whole hash-chained audit log. backup-db.sh exists to protect it — encrypted,
 * verified, refusing to run without a key — and nothing schedules it, and
 * nothing reported whether it had ever run.
 *
 * That is the failure mode worth designing against, because it is silent. A
 * backup job that stops produces no error, only an absence, and an absence is
 * noticed at exactly the moment the file is needed and not before.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';
import { generateToken } from '../src/auth/jwt.ts';
import type { ExpressApp } from '../src/framework/index.ts';

describe('Storage and backup visibility', () => {
  let app: ExpressApp;
  let adminToken: string;
  let supervisorToken: string;

  const auth = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

  before(() => {
    app = createApp(':memory:');
    adminToken = generateToken({
      id: 'usr_admin_001', username: 'admin1', role: 'ADMIN',
      name: 'System Administrator', employeeId: 'WRS-ADM-0001'
    });
    supervisorToken = generateToken({
      id: 'usr_sup_001', username: 'supervisor1', role: 'SUPERVISOR',
      name: 'S. K. Verma', employeeId: 'WRS-SUP-2019'
    });
  });

  test('TC-SYS-01: a deployment with no backup says NEVER, not nothing', async () => {
    const res = await app.dispatch({
      method: 'GET', url: '/api/system/storage', headers: auth(adminToken)
    });

    assert.equal(res.status, 200);
    const b = res.body.data.backup;

    // The whole point: "no backups" must be a stated finding, not an empty
    // list somebody has to interpret.
    assert.equal(b.state, 'NEVER');
    assert.equal(b.count, 0);
    assert.equal(b.newestAt, null);
    assert.equal(b.ageHours, null);
  });

  test('TC-SYS-02: it reports what the file actually holds', async () => {
    const res = await app.dispatch({
      method: 'GET', url: '/api/system/storage', headers: auth(adminToken)
    });
    const d = res.body.data;

    for (const k of ['databaseBytes', 'photoCount', 'photoBytes', 'inspectionCount', 'auditEventCount']) {
      assert.equal(typeof d[k], 'number', `${k} must be a number, not absent`);
      assert.ok(d[k] >= 0);
    }
  });

  test('TC-SYS-03: a missing backup directory is a finding, not a crash', async () => {
    // The usual case on a fresh install: the directory does not exist at all.
    const res = await app.dispatch({
      method: 'GET', url: '/api/system/storage', headers: auth(adminToken)
    });
    assert.equal(res.status, 200, 'an absent directory must not 500');
    assert.equal(res.body.data.backup.state, 'NEVER');
  });

  test('TC-SYS-04: this is the administrator\'s view, not the workshop\'s', async () => {
    // system.configure. A supervisor runs a shift; the state of the
    // installation is not theirs to read.
    const res = await app.dispatch({
      method: 'GET', url: '/api/system/storage', headers: auth(supervisorToken)
    });
    assert.ok(res.status === 403 || res.status === 401, `expected refusal, got ${res.status}`);
  });

  test('TC-SYS-05: it is refused without a token at all', async () => {
    const res = await app.dispatch({ method: 'GET', url: '/api/system/storage' });
    assert.ok(res.status === 401 || res.status === 403);
  });
});
