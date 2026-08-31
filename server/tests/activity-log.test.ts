/**
 * The activity ledger: who can read it, and whether it records where from
 * Indian Railways WRS Raipur
 *
 * Two things here are worth guarding, and both fail silently.
 *
 * The first is the async-context plumbing that carries a client's address from
 * the socket down to the audit writer. AsyncLocalStorage follows whoever
 * *emits* an event rather than whoever registered the listener, so the body
 * parser's 'end' callback ran outside the request's context and every POST —
 * which is to say every action worth auditing — recorded a null address, while
 * GETs recorded one correctly. Nothing failed; the column was simply empty.
 *
 * That regression can only be caught over a real socket. `dispatch` builds a
 * synthetic request whose stream events never fire, so it takes the parser's
 * early-return path and would pass whether the fix is present or not. The
 * address tests below therefore start an actual listener on an ephemeral port
 * and speak HTTP to it.
 *
 * The second is who may read the ledger. It names every person and every
 * action, so an inspector reading it would learn what has been noticed about
 * their own work.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.ts';
import { getDatabase } from '../src/db/connection.ts';
import { clientIpOf } from '../src/middleware/requestContext.ts';

const app = createApp();

let server: Server;
let base: string;

before(async () => {
  await new Promise<void>(resolve => {
    server = app.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      base = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

after(() => {
  server?.close();
});

const post = (path: string, body: any, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });

const get = (path: string, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, { headers });

async function tokenFor(username: string): Promise<string> {
  const res = await post('/api/auth/login', { username, password: 'password123' });
  assert.equal(res.status, 200, `${username} could not sign in`);
  return (await res.json()).data.token;
}

function lastAuditRow(eventType: string) {
  return getDatabase().prepare(`
    SELECT ip_address, payload_json FROM inspection_audit_log
    WHERE event_type = ? ORDER BY rowid DESC LIMIT 1
  `).get(eventType) as { ip_address: string | null; payload_json: string } | undefined;
}

describe('The activity ledger', () => {
  let supervisorToken: string;

  before(async () => {
    supervisorToken = await tokenFor('supervisor1');
  });

  it('records a sign-in, which it never used to', async () => {
    const count = () => (getDatabase()
      .prepare(`SELECT COUNT(*) AS n FROM inspection_audit_log WHERE event_type = 'AUTH_LOGIN'`)
      .get() as { n: number }).n;

    const before = count();
    await post('/api/auth/login', { username: 'supervisor1', password: 'password123' });
    assert.ok(count() > before, 'signing in wrote no audit entry');
  });

  it('records a refused sign-in without recording the password', async () => {
    await post('/api/auth/login', { username: 'nobody_here', password: 'hunter2' });

    const row = lastAuditRow('AUTH_LOGIN');
    assert.ok(row, 'no entry was written for a refused sign-in');
    const payload = JSON.parse(row.payload_json);
    assert.equal(payload.outcome, 'REFUSED');
    assert.equal(payload.attemptedUsername, 'nobody_here');
    assert.ok(
      !row.payload_json.includes('hunter2'),
      'the attempted password was written into the audit log'
    );
  });

  it('carries the client address through a POST, not only a GET', async () => {
    /*
     * The regression this exists for. Body parsing crosses an async boundary;
     * if the stream callbacks are not bound to the request's context the
     * address is lost for exactly the requests worth auditing.
     */
    await post('/api/auth/login', { username: 'supervisor1', password: 'password123' });

    const row = lastAuditRow('AUTH_LOGIN');
    assert.ok(row, 'no sign-in entry was written');
    assert.ok(
      row.ip_address && row.ip_address.length > 0,
      `a POST recorded no client address (got ${JSON.stringify(row.ip_address)})`
    );
    assert.ok(
      row.ip_address === '127.0.0.1' || row.ip_address === '::1',
      `expected the loopback address, got ${row.ip_address}`
    );
  });

  it('refuses X-Forwarded-For unless the deployment says to trust a proxy', () => {
    const spoofed: any = {
      headers: { 'x-forwarded-for': '203.0.113.9' },
      socket: { remoteAddress: '10.0.0.4' }
    };

    const previous = process.env.TRUST_PROXY;
    delete process.env.TRUST_PROXY;
    assert.equal(
      clientIpOf(spoofed),
      '10.0.0.4',
      'a client could write its own address into the audit log'
    );

    process.env.TRUST_PROXY = 'true';
    assert.equal(clientIpOf(spoofed), '203.0.113.9', 'a real proxy header was ignored');

    if (previous === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = previous;
  });

  it('strips the IPv4-in-IPv6 prefix Node reports on a dual-stack socket', () => {
    assert.equal(
      clientIpOf({ headers: {}, socket: { remoteAddress: '::ffff:10.0.0.4' } } as any),
      '10.0.0.4'
    );
  });

  it('shows a supervisor more than springs', async () => {
    const res = await get('/api/audit/activity?limit=200', {
      authorization: `Bearer ${supervisorToken}`
    });
    assert.equal(res.status, 200);

    const body = await res.json();
    const kinds = new Set(body.data.entries.map((e: any) => e.eventType));
    assert.ok(kinds.size > 1, 'the ledger returned only one kind of event');
    assert.ok(
      [...kinds].some(k => k !== 'INSPECTION_CREATED'),
      'the ledger still only talks about springs'
    );
  });

  it('filters by event type and by role', async () => {
    const byType = await (await get('/api/audit/activity?eventType=AUTH_LOGIN&limit=50', {
      authorization: `Bearer ${supervisorToken}`
    })).json();
    assert.ok(
      byType.data.entries.every((e: any) => e.eventType === 'AUTH_LOGIN'),
      'the event-type filter let something else through'
    );

    const byRole = await (await get('/api/audit/activity?role=SUPERVISOR&limit=50', {
      authorization: `Bearer ${supervisorToken}`
    })).json();
    assert.ok(
      byRole.data.entries.every((e: any) => e.actorRole === 'SUPERVISOR'),
      'the role filter let another role through'
    );
  });

  it('is closed to an inspector', async () => {
    const inspectorToken = await tokenFor('inspector1');
    const res = await get('/api/audit/activity', {
      authorization: `Bearer ${inspectorToken}`
    });
    assert.equal(res.status, 403, 'an inspector could read the record of who did what');
  });

  it('is closed to a request with no token at all', async () => {
    const res = await get('/api/audit/activity');
    assert.equal(res.status, 401);
  });

  it('never lets the caller ask for the whole ledger at once', async () => {
    const res = await get('/api/audit/activity?limit=99999', {
      authorization: `Bearer ${supervisorToken}`
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.data.limit <= 500, 'the page size cap can be argued away');
  });
});
