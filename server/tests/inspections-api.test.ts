/**
 * REST API Integration Tests: Classification, Inspection Logging, and Immutability (405)
 * Indian Railways WRS Raipur
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createApp } from '../src/app.ts';
import { generateToken } from '../src/auth/jwt.ts';
import type { ExpressApp } from '../src/framework/index.ts';

/*
 * POST /api/inspections now requires authentication. These tests used to
 * rely on it not doing so — the route accepted an unauthenticated write and
 * attributed it to a hardcoded inspector, which is the fault being fixed.
 */
const INSPECTOR_AUTH = {
  authorization: `Bearer ${generateToken({
    id: 'usr_insp_001', username: 'inspector1', role: 'INSPECTOR', name: 'Ramesh Kumar'
  } as any)}`
};

// Helper for sending simulated HTTP requests to the Express app
/*
 * These cases check the endpoints' own behaviour — filters, aggregates — not
 * who may call them. They ran anonymously because the read routes accepted
 * anonymous callers, which was the bug; the helper now signs in as an
 * inspector. A case about authentication passes its own headers.
 */
const INSPECTOR_FOR_READS = generateToken({
  id: 'usr_insp_001',
  username: 'inspector1',
  role: 'INSPECTOR',
  name: 'Ramesh Kumar',
  employeeId: 'WRS-INSP-1042'
});

async function mockFetch(app: ExpressApp, method: string, path: string, body?: any, headers: Record<string, string> = {}) {
  const withAuth = 'authorization' in headers || 'Authorization' in headers
    ? headers
    : { ...headers, authorization: `Bearer ${INSPECTOR_FOR_READS}` };
  return app.dispatch({
    method,
    url: path,
    body,
    headers: withAuth
  });
}

describe('Inspection & Classification REST API Endpoints', () => {
  let app: Express;

  beforeEach(() => {
    app = createApp(':memory:');
  });

  // Test Case 1: Standalone classification endpoint
  it('TC-API-01: POST /api/classify returns correct band and status', async () => {
    const res = await mockFetch(app, 'POST', '/api/classify', {
      bogieType: 'CASNUB_22_NLB',
      condition: 'USED',
      position: 'OUTER',
      measuredHeight: 260.0
    });

    if (res.status !== 200) {
      console.error('DEBUG TC-API-01 ERROR:', res.body);
    }

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.band, 'BLUE');
    assert.strictEqual(res.body.data.status, 'PASS');
    assert.strictEqual(res.body.data.tableReference, 'Table 28');
  });

  // Test Case 2: Append-only inspection creation
  it('TC-API-02: POST /api/inspections creates new inspection and audit record', async () => {
    const res = await mockFetch(app, 'POST', '/api/inspections', {
      wagonNumber: 'WAGON-TEST-001',
      bogieType: 'CASNUB_22_NLB',
      condition: 'USED',
      position: 'OUTER',
      measuredHeight: 260.0
    }, INSPECTOR_AUTH);

    if (res.status !== 201) {
      console.error('DEBUG TC-API-02 ERROR:', res.body);
    }

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.wagonNumber, 'WAGON-TEST-001');
    assert.strictEqual(res.body.data.classifiedBand, 'BLUE');
    assert.strictEqual(res.body.data.status, 'PASS');
    assert.ok(res.body.data.id);
  });

  // Test Case 3: HTTP Immutability — PUT / PATCH / DELETE reject with 405 Method Not Allowed
  it('TC-API-03: PUT, PATCH, and DELETE on /api/inspections/:id return 405 Method Not Allowed', async () => {
    const resPut = await mockFetch(app, 'PUT', '/api/inspections/insp_123', { measuredHeight: 250.0 });
    assert.strictEqual(resPut.status, 405);
    assert.strictEqual(resPut.body.error, 'METHOD_NOT_ALLOWED');

    const resPatch = await mockFetch(app, 'PATCH', '/api/inspections/insp_123', { status: 'CONDEMNED' });
    assert.strictEqual(resPatch.status, 405);

    const resDelete = await mockFetch(app, 'DELETE', '/api/inspections/insp_123');
    assert.strictEqual(resDelete.status, 405);
  });

  // Test Case 4: Search & Multi-criteria filter
  it('TC-API-04: GET /api/inspections filters by wagonNumber and status', async () => {
    await mockFetch(app, 'POST', '/api/inspections', {
      wagonNumber: 'BOXN-SPECIAL-1',
      bogieType: 'CASNUB_22_NLB',
      condition: 'USED',
      position: 'OUTER',
      measuredHeight: 260.0
    }, INSPECTOR_AUTH);

    await mockFetch(app, 'POST', '/api/inspections', {
      wagonNumber: 'BOXN-SPECIAL-2',
      bogieType: 'CASNUB_22_NLB',
      condition: 'USED',
      position: 'OUTER',
      measuredHeight: 240.0 // CONDEMNED
    }, INSPECTOR_AUTH);

    const res = await mockFetch(app, 'GET', '/api/inspections?wagonNumber=SPECIAL&status=PASS');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.length, 1);
    assert.strictEqual(res.body.data[0].wagonNumber, 'BOXN-SPECIAL-1');
  });

  // Test Case 5: Inspection Statistics
  it('TC-API-05: GET /api/inspections/stats returns aggregate metrics', async () => {
    await mockFetch(app, 'POST', '/api/inspections', {
      wagonNumber: 'W-STATS-1',
      bogieType: 'CASNUB_22_NLB',
      condition: 'USED',
      position: 'OUTER',
      measuredHeight: 260.0
    }, INSPECTOR_AUTH);

    const res = await mockFetch(app, 'GET', '/api/inspections/stats');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.data.totalInspections >= 1);
    assert.strictEqual(res.body.data.bandDistribution.BLUE >= 1, true);
  });

  // Test Case 6: Health Endpoint
  it('TC-API-06: GET /api/health returns healthy database status', async () => {
    const res = await mockFetch(app, 'GET', '/api/health');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'healthy');
    assert.strictEqual(res.body.database.connected, true);
  });
});
