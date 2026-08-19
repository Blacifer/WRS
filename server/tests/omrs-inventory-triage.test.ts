/**
 * Pre-Arrival Trackside OMRS AI Triage & Stores Depot Inventory Tests (Phase 3 - M1 / R5)
 * Indian Railways WRS Raipur
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';
import { generateToken } from '../src/auth/jwt.ts';
import { getDatabase } from '../src/db/connection.ts';
import { InventoryRepository } from '../src/db/inventoryRepository.ts';
import { OMRSRepository } from '../src/db/omrsRepository.ts';
import type { ExpressApp } from '../src/framework/index.ts';

describe('Phase 3 M1: Pre-Arrival OMRS AI Triage & Stores Depot Inventory (R5)', () => {
  let app: ExpressApp;
  let inspectorToken: string;
  let supervisorToken: string;
  let inventoryRepo: InventoryRepository;
  let omrsRepo: OMRSRepository;

  before(() => {
    app = createApp(':memory:');
    const db = getDatabase();
    inventoryRepo = new InventoryRepository(db);
    omrsRepo = new OMRSRepository(db);

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

    // Seed test inventory parts
    inventoryRepo.upsertPart({
      partCode: 'PRT-SPR-OUT-01',
      partName: 'CASNUB 22NLB Outer Coil Spring',
      category: 'SPRINGS',
      unitOfMeasure: 'NOS',
      stockQuantity: 50,
      reservedQuantity: 10,
      reorderThreshold: 15,
      unitCostInr: 2450,
      binLocation: 'BAY-1-RACK-A1'
    });

    inventoryRepo.upsertPart({
      partCode: 'PRT-BRG-CTRB',
      partName: 'Cartridge Tapered Roller Bearing (CTRB Class E)',
      category: 'BEARINGS',
      unitOfMeasure: 'SET',
      stockQuantity: 20,
      reservedQuantity: 4,
      reorderThreshold: 8,
      unitCostInr: 18500,
      binLocation: 'BAY-2-RACK-B1'
    });

    inventoryRepo.upsertPart({
      partCode: 'PRT-WHL-BOXNHL',
      partName: 'BOXNHL Heavy Freight Wheelset Assembly',
      category: 'WHEELS_AXLES',
      unitOfMeasure: 'SET',
      stockQuantity: 10,
      reservedQuantity: 2,
      reorderThreshold: 5,
      unitCostInr: 68000,
      binLocation: 'WHEEL-PARK-BAY-A'
    });

    inventoryRepo.upsertPart({
      partCode: 'PRT-BRK-COMP-BLK',
      partName: 'High Friction Composite Brake Block',
      category: 'BRAKE_SYSTEM',
      unitOfMeasure: 'NOS',
      stockQuantity: 100,
      reservedQuantity: 20,
      reorderThreshold: 30,
      unitCostInr: 650,
      binLocation: 'BAY-3-BIN-104'
    });
  });

  // -------------------------------------------------------------------------
  // 1. Inventory Repository Unit Tests
  // -------------------------------------------------------------------------
  test('TC-INV-01: Retrieves parts and correctly calculates availableQuantity', () => {
    const parts = inventoryRepo.getInventory();
    assert.ok(parts.length >= 4);

    const outerSpring = parts.find(p => p.partCode === 'PRT-SPR-OUT-01');
    assert.ok(outerSpring);
    assert.equal(outerSpring.stockQuantity, 50);
    assert.equal(outerSpring.reservedQuantity, 10);
    assert.equal(outerSpring.availableQuantity, 40); // 50 - 10
  });

  test('TC-INV-02: Filters parts by RDSO category', () => {
    const springParts = inventoryRepo.getInventory('SPRINGS');
    assert.ok(springParts.every(p => p.category === 'SPRINGS'));

    const bearingParts = inventoryRepo.getInventory('BEARINGS');
    assert.ok(bearingParts.every(p => p.category === 'BEARINGS'));
  });

  test('TC-INV-03: Successfully reserves parts and updates reserved_quantity', () => {
    const initialPart = inventoryRepo.getPartByCode('PRT-SPR-OUT-01')!;
    const reservation = inventoryRepo.reservePart({
      wagonNumber: 'SER/BOXNHL/99001',
      partCode: 'PRT-SPR-OUT-01',
      quantity: 4,
      source: 'MANUAL_INSPECTION',
      predictedDefect: 'NEST_OUTER_CRACK'
    });

    assert.ok(reservation.id);
    assert.equal(reservation.wagonNumber, 'SER/BOXNHL/99001');
    assert.equal(reservation.partCode, 'PRT-SPR-OUT-01');
    assert.equal(reservation.quantity, 4);
    assert.equal(reservation.status, 'RESERVED');

    const updatedPart = inventoryRepo.getPartByCode('PRT-SPR-OUT-01')!;
    assert.equal(updatedPart.reservedQuantity, initialPart.reservedQuantity + 4);
    assert.equal(updatedPart.availableQuantity, updatedPart.stockQuantity - updatedPart.reservedQuantity);
  });

  test('TC-INV-04: Throws error when attempting to reserve a non-existent part code', () => {
    assert.throws(() => {
      inventoryRepo.reservePart({
        wagonNumber: 'ER/BOXNHL/12345',
        partCode: 'PRT-NON-EXISTENT-XYZ',
        quantity: 1,
        source: 'MANUAL_INSPECTION'
      });
    }, /does not exist/);
  });

  test('TC-INV-05: Successfully issues reserved part to shop floor, decrementing stock and reservations', () => {
    // First reserve
    const reservation = inventoryRepo.reservePart({
      wagonNumber: 'ECoR/BOXNHL/77002',
      partCode: 'PRT-BRG-CTRB',
      quantity: 2,
      source: 'OMRS_AI_TRIAGE',
      predictedDefect: 'CTRB_BEARING_ACOUSTIC_DEFECT'
    });

    const partBeforeIssue = inventoryRepo.getPartByCode('PRT-BRG-CTRB')!;
    const issueResult = inventoryRepo.issuePart(reservation.id);

    assert.equal(issueResult.success, true);
    assert.equal(issueResult.reservation.status, 'ISSUED_TO_FLOOR');
    assert.ok(issueResult.reservation.allocatedAt);

    const partAfterIssue = inventoryRepo.getPartByCode('PRT-BRG-CTRB')!;
    assert.equal(partAfterIssue.stockQuantity, partBeforeIssue.stockQuantity - 2);
    assert.equal(partAfterIssue.reservedQuantity, partBeforeIssue.reservedQuantity - 2);
  });

  test('TC-INV-06: Prevents duplicate issuing of already issued reservation', () => {
    const reservation = inventoryRepo.reservePart({
      wagonNumber: 'SECR/BOXNHL/44001',
      partCode: 'PRT-BRK-COMP-BLK',
      quantity: 2,
      source: 'MANUAL_INSPECTION'
    });

    inventoryRepo.issuePart(reservation.id);

    assert.throws(() => {
      inventoryRepo.issuePart(reservation.id);
    }, /already been issued/);
  });

  test('TC-INV-07: Restocks part inventory and enforces positive integer quantity', () => {
    const initialPart = inventoryRepo.getPartByCode('PRT-WHL-BOXNHL')!;
    const restocked = inventoryRepo.restockPart('PRT-WHL-BOXNHL', 5);

    assert.equal(restocked.stockQuantity, initialPart.stockQuantity + 5);

    assert.throws(() => {
      inventoryRepo.restockPart('PRT-WHL-BOXNHL', -3);
    }, /positive integer/);

    assert.throws(() => {
      inventoryRepo.restockPart('PRT-WHL-BOXNHL', 0);
    }, /positive integer/);
  });

  test('TC-INV-08: Calculates accurate aggregate inventory statistics and valuations', () => {
    const stats = inventoryRepo.getInventoryStats();
    assert.ok(stats.totalParts >= 4);
    assert.ok(stats.totalValuationInr > 0);
    assert.ok(stats.totalReservedCount >= 0);
  });

  // -------------------------------------------------------------------------
  // 2. OMRS AI Triage Logic & Telemetry Evaluation Tests
  // -------------------------------------------------------------------------
  test('TC-OMRS-01: Correctly evaluates WILD wheel impact thresholds', () => {
    const criticalDefects = omrsRepo.evaluateTelemetryDefects({
      wheelImpactKn: 145.0
    });
    assert.ok(criticalDefects.some(d => d.defectType === 'WHEEL_FLAT_IMPACT_HIGH' && d.severity === 'CRITICAL'));
    assert.ok(criticalDefects.some(d => d.recommendedPartCode === 'PRT-WHL-BOXNHL'));

    const advisoryDefects = omrsRepo.evaluateTelemetryDefects({
      wheelImpactKn: 115.0
    });
    assert.ok(advisoryDefects.some(d => d.defectType === 'WHEEL_TREAD_IRREGULARITY' && d.severity === 'ADVISORY'));
  });

  test('TC-OMRS-02: Correctly evaluates ABD Acoustic Bearing Detector thresholds', () => {
    const bearingDefects = omrsRepo.evaluateTelemetryDefects({
      acousticBearingPeakDb: 88.5
    });
    assert.ok(bearingDefects.some(d => d.defectType === 'CTRB_BEARING_ACOUSTIC_DEFECT' && d.severity === 'CRITICAL'));
    assert.ok(bearingDefects.some(d => d.recommendedPartCode === 'PRT-BRG-CTRB'));
  });

  test('TC-OMRS-03: Correctly evaluates HABD Hot Axle Box thermal signatures', () => {
    const thermalDefects = omrsRepo.evaluateTelemetryDefects({
      temperatureCelsius: 82.0
    });
    assert.ok(thermalDefects.some(d => d.defectType === 'HOT_AXLE_BRAKE_BINDING' && d.severity === 'CRITICAL'));
    assert.ok(thermalDefects.some(d => d.recommendedPartCode === 'PRT-BRK-COMP-BLK'));
  });

  test('TC-OMRS-04: Runs end-to-end AI Triage and triggers auto-reservations against stores', () => {
    const testWagon = 'SER/BOXNHL/88301';
    // Record scan with WILD and ABD critical breaches
    omrsRepo.recordScan({
      wagonNumber: testWagon,
      trainSpeedKmph: 65.0,
      wheelImpactKn: 139.5,
      acousticBearingPeakDb: 84.0,
      temperatureCelsius: 52.0
    });

    const triageResult = omrsRepo.runAITriage(testWagon, inventoryRepo);

    assert.equal(triageResult.scan.isTriaged, true);
    assert.equal(triageResult.scan.autoReservationTriggered, true);
    assert.equal(triageResult.scan.triageSeverity, 'CRITICAL_TRIAGE');
    assert.ok(triageResult.reservations.length >= 2);
    assert.ok(triageResult.triageSummary.includes('CRITICAL'));

    // Verify reservations in stores
    const wagonReservations = inventoryRepo.getReservations(testWagon);
    assert.ok(wagonReservations.length >= 2);
    assert.ok(wagonReservations.some(r => r.source === 'OMRS_AI_TRIAGE'));
    assert.ok(wagonReservations.some(r => r.partCode === 'PRT-WHL-BOXNHL'));
    assert.ok(wagonReservations.some(r => r.partCode === 'PRT-BRG-CTRB'));
  });

  // -------------------------------------------------------------------------
  // 3. REST API Routers Integration Tests
  // -------------------------------------------------------------------------
  test('TC-API-INV-01: GET /api/inventory returns parts catalog', async () => {
    const res = await app.dispatch({
      method: 'GET',
      url: '/api/inventory'
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.data));
    assert.ok(res.body.data.length >= 4);
  });

  test('TC-API-INV-02: GET /api/inventory/stats returns KPI summary', async () => {
    const res = await app.dispatch({
      method: 'GET',
      url: '/api/inventory/stats'
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.data.totalParts > 0);
    assert.ok(res.body.data.totalValuationInr > 0);
  });

  test('TC-API-INV-03: GET /api/inventory/part/:partCode returns single part or 404', async () => {
    const validRes = await app.dispatch({
      method: 'GET',
      url: '/api/inventory/part/PRT-SPR-OUT-01'
    });
    assert.equal(validRes.status, 200);
    assert.equal(validRes.body.data.partCode, 'PRT-SPR-OUT-01');

    const notFoundRes = await app.dispatch({
      method: 'GET',
      url: '/api/inventory/part/PRT-UNKNOWN-999'
    });
    assert.equal(notFoundRes.status, 404);
    assert.equal(notFoundRes.body.error, 'PART_NOT_FOUND');
  });

  test('TC-API-INV-04: POST /api/inventory/reserve creates reservation', async () => {
    const res = await app.dispatch({
      method: 'POST',
      url: '/api/inventory/reserve',
      headers: {
        authorization: `Bearer ${inspectorToken}`,
        'content-type': 'application/json'
      },
      body: {
        wagonNumber: 'NCR/BOXNHL/55201',
        partCode: 'PRT-SPR-OUT-01',
        quantity: 2,
        source: 'MANUAL_INSPECTION',
        predictedDefect: 'CRACKED_OUTER_COIL'
      }
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.wagonNumber, 'NCR/BOXNHL/55201');
    assert.equal(res.body.data.quantity, 2);
  });

  test('TC-API-INV-05: POST /api/inventory/issue issues part to floor', async () => {
    // Create reservation first
    const res = await app.dispatch({
      method: 'POST',
      url: '/api/inventory/reserve',
      headers: {
        authorization: `Bearer ${inspectorToken}`,
        'content-type': 'application/json'
      },
      body: {
        wagonNumber: 'ER/BOXNHL/88102',
        partCode: 'PRT-BRK-COMP-BLK',
        quantity: 4,
        source: 'MANUAL_INSPECTION'
      }
    });
    const reservationId = res.body.data.id;

    // Issue reservation
    const issueRes = await app.dispatch({
      method: 'POST',
      url: '/api/inventory/issue',
      headers: {
        authorization: `Bearer ${inspectorToken}`,
        'content-type': 'application/json'
      },
      body: { reservationId }
    });
    assert.equal(issueRes.status, 200);
    assert.equal(issueRes.body.success, true);
    assert.equal(issueRes.body.data.reservation.status, 'ISSUED_TO_FLOOR');
  });

  test('TC-API-INV-06: POST /api/inventory/restock requires Supervisor role', async () => {
    // Inspector should fail with 403 Forbidden
    const inspRes = await app.dispatch({
      method: 'POST',
      url: '/api/inventory/restock',
      headers: {
        authorization: `Bearer ${inspectorToken}`,
        'content-type': 'application/json'
      },
      body: {
        partCode: 'PRT-SPR-OUT-01',
        quantity: 10
      }
    });
    assert.equal(inspRes.status, 403);

    // Supervisor should succeed
    const supRes = await app.dispatch({
      method: 'POST',
      url: '/api/inventory/restock',
      headers: {
        authorization: `Bearer ${supervisorToken}`,
        'content-type': 'application/json'
      },
      body: {
        partCode: 'PRT-SPR-OUT-01',
        quantity: 10
      }
    });
    assert.equal(supRes.status, 200);
    assert.equal(supRes.body.success, true);
  });

  test('TC-API-OMRS-01: POST /api/omrs/simulate-scan records telemetry', async () => {
    const res = await app.dispatch({
      method: 'POST',
      url: '/api/omrs/simulate-scan',
      headers: {
        'content-type': 'application/json'
      },
      body: {
        wagonNumber: 'SR/BOXNHL/33910',
        trainSpeedKmph: 71.5,
        wheelImpactKn: 138.0,
        acousticBearingPeakDb: 79.5,
        temperatureCelsius: 62.0
      }
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.wagonNumber, 'SR/BOXNHL/33910');
    assert.equal(res.body.data.triageSeverity, 'CRITICAL_TRIAGE');
  });

  test('TC-API-OMRS-02: GET /api/omrs/scans/:wagonNumber returns scan or 404', async () => {
    const res = await app.dispatch({
      method: 'GET',
      url: '/api/omrs/scans/SR/BOXNHL/33910'
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.wagonNumber, 'SR/BOXNHL/33910');

    const notFound = await app.dispatch({
      method: 'GET',
      url: '/api/omrs/scans/NON_EXISTENT_WAGON_99'
    });
    assert.equal(notFound.status, 404);
  });

  test('TC-API-OMRS-03: POST /api/omrs/triage/:wagonNumber runs AI triage via REST', async () => {
    const res = await app.dispatch({
      method: 'POST',
      url: '/api/omrs/triage/SR/BOXNHL/33910',
      headers: {
        authorization: `Bearer ${inspectorToken}`,
        'content-type': 'application/json'
      }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.scan.isTriaged, true);
    assert.ok(res.body.data.reservations.length > 0);
    assert.ok(res.body.data.triageSummary);
  });
});
