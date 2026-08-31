/**
 * Serialized Component Health Passports REST API Integration Tests (Phase 3 - M1 / R4)
 * Indian Railways WRS Raipur
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';
import { generateToken } from '../src/auth/jwt.ts';
import { getDatabase } from '../src/db/connection.ts';
import { ComponentRepository } from '../src/db/componentRepository.ts';
import { WagonRepository } from '../src/db/wagonRepository.ts';
import type { ExpressApp } from '../src/framework/index.ts';

describe('Phase 3 M1: /api/components REST API Integration Tests (R4 Serialization)', () => {
  let app: ExpressApp;
  let inspectorToken: string;
  let supervisorToken: string;
  let componentRepo: ComponentRepository;
  let wagonRepo: WagonRepository;

  before(() => {
    app = createApp(':memory:');
    const db = getDatabase();
    componentRepo = new ComponentRepository(db);
    wagonRepo = new WagonRepository(db);

    inspectorToken = generateToken({
      id: 'usr_insp_001',
      username: 'inspector1',
      role: 'INSPECTOR',
      name: 'Ramesh Kumar',
      employeeId: 'WRS-INSP-1042'
    });

    supervisorToken = generateToken({
      id: 'usr_sup_001',
      username: 'supervisor1',
      role: 'SUPERVISOR',
      name: 'S. K. Verma',
      employeeId: 'WRS-SUP-2019'
    });

    // Seed test wagon
    wagonRepo.registerWagon({
      wagonNumber: 'SECR/BOXNHL/10492',
      wagonType: 'BOXNHL',
      owningRailway: 'SECR',
      createdBy: 'usr_insp_001'
    });

    wagonRepo.registerWagon({
      wagonNumber: 'ECOR/BOXNHL/20831',
      wagonType: 'BOXNHL',
      owningRailway: 'ECOR',
      createdBy: 'usr_insp_001'
    });
  });

  // -------------------------------------------------------------------------
  // 1. Component Registration Endpoints
  // -------------------------------------------------------------------------
  it('TC-COMP-API-01: POST /api/components/register successfully creates component with 201 Created', async () => {
    const res = await app.dispatch({
      method: 'POST',
      url: '/api/components/register',
      headers: {
        authorization: `Bearer ${inspectorToken}`,
        'content-type': 'application/json'
      },
      body: {
        serialNumber: 'WHL-RWF-2024-8841',
        componentType: 'WHEELSET',
        manufacturer: 'Rail Wheel Factory Yelahanka',
        manufacturingDate: '2024-01-15',
        binLocation: 'BAY-W-01'
      }
    });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.serialNumber, 'WHL-RWF-2024-8841');
    assert.strictEqual(res.body.data.componentType, 'WHEELSET');
    assert.strictEqual(res.body.data.category, 'WHEELS_AXLES');
    assert.strictEqual(res.body.data.status, 'AVAILABLE_IN_STORES');
    assert.strictEqual(res.body.data.healthScore, 100.0);
    assert.strictEqual(res.body.data.healthStatus, 'EXCELLENT');
  });

  it('TC-COMP-API-02: POST /api/components/register rejects duplicate serial number with 409 Conflict', async () => {
    const res = await app.dispatch({
      method: 'POST',
      url: '/api/components/register',
      headers: {
        authorization: `Bearer ${inspectorToken}`,
        'content-type': 'application/json'
      },
      body: {
        serialNumber: 'WHL-RWF-2024-8841',
        componentType: 'WHEELSET'
      }
    });

    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(res.body.error, 'COMPONENT_ALREADY_EXISTS');
  });

  it('TC-COMP-API-03: POST /api/components/register rejects unauthenticated request with 401 Unauthorized', async () => {
    const res = await app.dispatch({
      method: 'POST',
      url: '/api/components/register',
      headers: {
        'content-type': 'application/json'
      },
      body: {
        serialNumber: 'BRG-SKF-2024-9941',
        componentType: 'BEARING'
      }
    });

    assert.strictEqual(res.status, 401);
  });

  it('TC-COMP-API-04: POST /api/components/register rejects invalid missing serial number with 400 Bad Request', async () => {
    const res = await app.dispatch({
      method: 'POST',
      url: '/api/components/register',
      headers: {
        authorization: `Bearer ${inspectorToken}`,
        'content-type': 'application/json'
      },
      body: {
        componentType: 'BEARING'
      }
    });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'INVALID_SERIAL_NUMBER');
  });

  // -------------------------------------------------------------------------
  // 2. Component Query & Search Endpoints
  // -------------------------------------------------------------------------
  it('TC-COMP-API-05: GET /api/components returns paginated list of components with filters', async () => {
    // Register additional components
    await app.dispatch({
      method: 'POST',
      url: '/api/components/register',
      headers: { authorization: `Bearer ${inspectorToken}`, 'content-type': 'application/json' },
      body: { serialNumber: 'BRG-SKF-2024-9941', componentType: 'BEARING', manufacturer: 'SKF India' }
    });

    await app.dispatch({
      method: 'POST',
      url: '/api/components/register',
      headers: { authorization: `Bearer ${inspectorToken}`, 'content-type': 'application/json' },
      body: { serialNumber: 'DGF-CW-2024-3810', componentType: 'DRAFT_GEAR', manufacturer: 'Cardwell Westinghouse' }
    });

    const res = await app.dispatch({
      method: 'GET',
      headers: { authorization: `Bearer ${supervisorToken}` },
      url: '/api/components?page=1&limit=10'
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(Array.isArray(res.body.data));
    assert.ok(res.body.data.length >= 3);
    assert.ok(res.body.pagination);
    assert.strictEqual(res.body.pagination.page, 1);
  });

  it('TC-COMP-API-06: GET /api/components filters by componentType and search query', async () => {
    const res = await app.dispatch({
      method: 'GET',
      headers: { authorization: `Bearer ${supervisorToken}` },
      url: '/api/components?type=BEARING'
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.length, 1);
    assert.strictEqual(res.body.data[0].serialNumber, 'BRG-SKF-2024-9941');

    const searchRes = await app.dispatch({
      method: 'GET',
      headers: { authorization: `Bearer ${supervisorToken}` },
      url: '/api/components?search=Westinghouse'
    });

    assert.strictEqual(searchRes.status, 200);
    assert.strictEqual(searchRes.body.data.length, 1);
    assert.strictEqual(searchRes.body.data[0].serialNumber, 'DGF-CW-2024-3810');
  });

  // -------------------------------------------------------------------------
  // 3. Serial Number and QR Lookups
  // -------------------------------------------------------------------------
  it('TC-COMP-API-07: GET /api/components/:serialNumber returns component with complete history', async () => {
    const res = await app.dispatch({
      method: 'GET',
      headers: { authorization: `Bearer ${supervisorToken}` },
      url: '/api/components/WHL-RWF-2024-8841'
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.serialNumber, 'WHL-RWF-2024-8841');
    assert.ok(Array.isArray(res.body.data.history));
    assert.strictEqual(res.body.data.history[0].eventType, 'COMMISSIONED');
  });

  it('TC-COMP-API-08: GET /api/components/:serialNumber returns 404 for unknown serial number', async () => {
    const res = await app.dispatch({
      method: 'GET',
      headers: { authorization: `Bearer ${supervisorToken}` },
      url: '/api/components/NON-EXISTENT-SERIAL-999'
    });

    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.error, 'COMPONENT_NOT_FOUND');
  });

  it('TC-COMP-API-09: GET /api/components/qr/:qrCode performs QR code lookup', async () => {
    const compRes = await app.dispatch({
      method: 'GET',
      headers: { authorization: `Bearer ${supervisorToken}` },
      url: '/api/components/WHL-RWF-2024-8841'
    });
    const qrCode = compRes.body.data.qrCode;

    const res = await app.dispatch({
      method: 'GET',
      headers: { authorization: `Bearer ${supervisorToken}` },
      url: `/api/components/qr/${encodeURIComponent(qrCode)}`
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.serialNumber, 'WHL-RWF-2024-8841');
  });

  // -------------------------------------------------------------------------
  // 4. Assignment, Unassignment & Wagon Queries
  // -------------------------------------------------------------------------
  it('TC-COMP-API-10: POST /api/components/:serialNumber/assign assigns component to wagon', async () => {
    const res = await app.dispatch({
      method: 'POST',
      url: '/api/components/WHL-RWF-2024-8841/assign',
      headers: {
        authorization: `Bearer ${inspectorToken}`,
        'content-type': 'application/json'
      },
      body: {
        wagonNumber: 'SECR/BOXNHL/10492',
        bogiePosition: 'BOGIE_1',
        stage: 'REASSEMBLY',
        notes: 'Mounted to Bogie 1 axle 1'
      }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.currentWagonNumber, 'SECR/BOXNHL/10492');
    assert.strictEqual(res.body.data.currentBogiePosition, 'BOGIE_1');
    assert.strictEqual(res.body.data.status, 'IN_SERVICE');
  });

  it('TC-COMP-API-11: GET /api/components/wagon/:wagonNumber returns all components on the wagon', async () => {
    const res = await app.dispatch({
      method: 'GET',
      headers: { authorization: `Bearer ${supervisorToken}` },
      url: '/api/components/wagon/SECR/BOXNHL/10492'
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.length, 1);
    assert.strictEqual(res.body.data[0].serialNumber, 'WHL-RWF-2024-8841');
  });

  it('TC-COMP-API-12: POST /api/components/:serialNumber/unassign unassigns component from wagon', async () => {
    const res = await app.dispatch({
      method: 'POST',
      url: '/api/components/WHL-RWF-2024-8841/unassign',
      headers: {
        authorization: `Bearer ${inspectorToken}`,
        'content-type': 'application/json'
      },
      body: {
        reason: 'Wheel profile skimming required',
        targetStatus: 'UNDER_MAINTENANCE',
        notes: 'Sent to Wheel Lathe machine shop'
      }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.currentWagonNumber, null);
    assert.strictEqual(res.body.data.currentBogiePosition, 'NONE');
    assert.strictEqual(res.body.data.status, 'UNDER_MAINTENANCE');
  });

  // -------------------------------------------------------------------------
  // 5. Health Score and Statistics Endpoints
  // -------------------------------------------------------------------------
  it('TC-COMP-API-13: POST /api/components/:serialNumber/health updates health score and status', async () => {
    const res = await app.dispatch({
      method: 'POST',
      url: '/api/components/BRG-SKF-2024-9941/health',
      headers: {
        authorization: `Bearer ${inspectorToken}`,
        'content-type': 'application/json'
      },
      body: {
        healthScore: 78.5,
        notes: 'Slight seal degradation'
      }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.healthScore, 78.5);
    assert.strictEqual(res.body.data.healthStatus, 'GOOD');
  });

  it('TC-COMP-API-14: GET /api/components/stats returns aggregated workshop metrics', async () => {
    const res = await app.dispatch({
      method: 'GET',
      headers: { authorization: `Bearer ${supervisorToken}` },
      url: '/api/components/stats'
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.data.totalComponents >= 3);
    assert.ok(res.body.data.averageHealthScore > 0);
  });
});
