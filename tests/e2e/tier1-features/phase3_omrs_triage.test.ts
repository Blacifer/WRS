/**
 * Tier 1 Test Suite — Feature R5: Pre-Arrival OMRS Optical/RFID Triage & Stores Inventory Buffer Stock Alerts
 * Indian Railways WRS Raipur (Phase 3)
 *
 * Verifies trackside OMRS telemetry ingestion, automated defect prediction (WILD impact, ABD acoustic bearing, wheel profile),
 * Stage 1 pre-arrival triage with automatic replacement part reservations, Stores Depot inventory tracking, buffer stock alerts,
 * shop floor part issuance with stock decrement, restocking validation, and nominal zero-defect scan handling.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { TestApp } from '../../harness/test_app.ts';
import type {
  StoresPart,
  InventoryReservation,
  InventoryStats,
  OMRSScanRecord,
  AITriageResult
} from '../../../shared/types.ts';

describe('Tier 1 — Phase 3 Feature R5: Pre-Arrival OMRS Triage & Stores Inventory', () => {
  let app: TestApp;
  let inspectorToken: string;
  let supervisorToken: string;
  const triageWagon1 = 'SECR/BOXNHL/88101';
  const nominalWagon = 'SECR/BCNHL/77201';

  beforeEach(async () => {
    app = new TestApp(':memory:');

    // 1. Authenticate Inspector & Supervisor
    const inspLogin = await app.post('/api/auth/login', { username: 'inspector1', password: 'password123' });
    inspectorToken = (inspLogin.body as { token: string }).token;

    const supLogin = await app.post('/api/auth/login', { username: 'supervisor1', password: 'password123' });
    supervisorToken = (supLogin.body as { token: string }).token;

    // 2. Register base test wagons
    await app.post(
      '/api/wagons/register',
      {
        wagonNumber: triageWagon1,
        wagonType: 'BOXNHL',
        owningRailway: 'SECR',
        entryNotes: 'OMRS Triage Test Wagon'
      },
      { Authorization: `Bearer ${inspectorToken}` }
    );

    await app.post(
      '/api/wagons/register',
      {
        wagonNumber: nominalWagon,
        wagonType: 'BCNHL',
        owningRailway: 'SECR',
        entryNotes: 'OMRS Nominal Baseline Wagon'
      },
      { Authorization: `Bearer ${inspectorToken}` }
    );
  });

  // TC-P3-OMRS-01: Pre-Arrival Telemetry Ingestion & AI Defect Auto-Prediction
  it('TC-P3-OMRS-01: Ingests trackside OMRS telemetry and auto-predicts defects with recommended part codes', async () => {
    const scanRes = await app.post(
      '/api/omrs/simulate-scan',
      {
        wagonNumber: triageWagon1,
        trainSpeedKmph: 72.5,
        wheelImpactKn: 142.5,
        acousticBearingPeakDb: 86.0,
        temperatureCelsius: 64.0,
        wheelProfileDeviationMm: 4.2,
        location: 'BILASPUR-RAIPUR-UP-LINE-KM824'
      },
      { Authorization: `Bearer ${inspectorToken}` }
    );

    assert.strictEqual(scanRes.status, 201);
    const body = scanRes.body as { success: boolean; data: OMRSScanRecord };
    assert.strictEqual(body.success, true);
    assert.ok(body.data);

    const scan = body.data;
    assert.strictEqual(scan.wagonNumber, triageWagon1);
    assert.strictEqual(scan.triageSeverity, 'CRITICAL_TRIAGE');
    assert.strictEqual(scan.isTriaged, false);
    assert.strictEqual(scan.autoReservationTriggered, false);
    assert.strictEqual(scan.trainSpeedKmph, 72.5);
    assert.strictEqual(scan.wheelImpactKn, 142.5);
    assert.strictEqual(scan.acousticBearingPeakDb, 86.0);
    assert.strictEqual(scan.wheelProfileDeviationMm, 4.2);

    // Verify auto-predicted defect items and recommended parts
    assert.ok(scan.predictedDefects.length >= 3);

    const springDefect = scan.predictedDefects.find(d => d.recommendedPartCode === 'PART-SP-SNUB');
    assert.ok(springDefect);
    assert.strictEqual(springDefect.severity, 'CRITICAL');
    assert.ok(springDefect.confidence >= 0.9);

    const bearingDefect = scan.predictedDefects.find(d => d.recommendedPartCode === 'PART-BRG-01');
    assert.ok(bearingDefect);
    assert.strictEqual(bearingDefect.severity, 'CRITICAL');
    assert.ok(bearingDefect.confidence >= 0.9);

    const wheelDefect = scan.predictedDefects.find(d => d.recommendedPartCode === 'PART-WS-01');
    assert.ok(wheelDefect);
    assert.strictEqual(wheelDefect.severity, 'ADVISORY');

    // Verify scan is listed in recent scans endpoint
    const listRes = await app.get('/api/omrs/scans', { Authorization: `Bearer ${inspectorToken}` });
    assert.strictEqual(listRes.status, 200);
    const listBody = listRes.body as { success: boolean; data: OMRSScanRecord[] };
    assert.ok(listBody.data.some(s => s.wagonNumber === triageWagon1));
  });

  // TC-P3-OMRS-02: Stage 1 Pre-Arrival Triage & Automated Stores Depot Part Reservation
  it('TC-P3-OMRS-02: Executes AI triage for incoming wagon and automatically reserves defect parts in Stores Depot', async () => {
    // 1. Ingest telemetry scan
    await app.post(
      '/api/omrs/simulate-scan',
      {
        wagonNumber: triageWagon1,
        trainSpeedKmph: 68.0,
        wheelImpactKn: 135.0,
        acousticBearingPeakDb: 84.5,
        temperatureCelsius: 58.0
      },
      { Authorization: `Bearer ${inspectorToken}` }
    );

    // 2. Check initial inventory state
    const partSnubBefore = app.auditDb.getPartByCode('PART-SP-SNUB')!;
    const partBrgBefore = app.auditDb.getPartByCode('PART-BRG-01')!;

    // 3. Execute AI triage
    const triageRes = await app.get(`/api/omrs/triage/${encodeURIComponent(triageWagon1)}`, { Authorization: `Bearer ${inspectorToken}` });
    assert.strictEqual(triageRes.status, 200);
    const triageBody = triageRes.body as { success: boolean; data: AITriageResult; scan: OMRSScanRecord; reservations: InventoryReservation[] };
    assert.strictEqual(triageBody.success, true);

    const triage = triageBody.data || triageBody;
    assert.strictEqual(triage.scan.isTriaged, true);
    assert.strictEqual(triage.scan.autoReservationTriggered, true);
    assert.ok(triage.reservations.length >= 2);
    assert.ok(triage.triageSummary.includes('AI Triage flagged'));

    // 4. Verify reservations in database
    const wagonReservations = app.auditDb.getReservations(triageWagon1);
    assert.strictEqual(wagonReservations.length, triage.reservations.length);
    assert.ok(wagonReservations.every(r => r.wagonNumber === triageWagon1 && r.source === 'OMRS_AI_TRIAGE'));

    // 5. Verify Stores Depot stock reservation updates
    const partSnubAfter = app.auditDb.getPartByCode('PART-SP-SNUB')!;
    const partBrgAfter = app.auditDb.getPartByCode('PART-BRG-01')!;

    assert.strictEqual(partSnubAfter.reservedQuantity, partSnubBefore.reservedQuantity + 2);
    assert.strictEqual(partSnubAfter.availableQuantity, partSnubAfter.stockQuantity - partSnubAfter.reservedQuantity);

    assert.strictEqual(partBrgAfter.reservedQuantity, partBrgBefore.reservedQuantity + 1);
    assert.strictEqual(partBrgAfter.availableQuantity, partBrgAfter.stockQuantity - partBrgAfter.reservedQuantity);

    // 6. Verify idempotency: subsequent triage call does not duplicate reservations
    const repeatTriageRes = await app.get(`/api/omrs/triage/${encodeURIComponent(triageWagon1)}`, { Authorization: `Bearer ${inspectorToken}` });
    assert.strictEqual(repeatTriageRes.status, 200);
    const repeatReservations = app.auditDb.getReservations(triageWagon1);
    assert.strictEqual(repeatReservations.length, wagonReservations.length);
  });

  // TC-P3-OMRS-03: Stores Inventory Depletion, Buffer Stock Alerts & Insufficient Stock Handling
  it('TC-P3-OMRS-03: Tracks inventory stats, enforces buffer stock thresholds and rejects insufficient stock reservations', async () => {
    // 1. Query inventory stats
    const statsRes = await app.get('/api/inventory/stats', { Authorization: `Bearer ${inspectorToken}` });
    assert.strictEqual(statsRes.status, 200);
    const statsBody = statsRes.body as { success: boolean; data: InventoryStats };
    assert.strictEqual(statsBody.success, true);
    assert.ok(statsBody.data.totalParts >= 8);
    assert.ok(statsBody.data.totalValuationInr > 0);
    assert.ok(statsBody.data.lowStockCount >= 0);

    // 2. Query inventory list filtered by category
    const springsRes = await app.get('/api/inventory?category=SPRINGS', { Authorization: `Bearer ${inspectorToken}` });
    assert.strictEqual(springsRes.status, 200);
    const springs = (springsRes.body as { data: StoresPart[] }).data;
    assert.ok(springs.length >= 3);
    assert.ok(springs.every(p => p.category === 'SPRINGS'));

    // 3. Check low-stock threshold monitoring
    const dgPart = app.auditDb.getPartByCode('PART-DG-01')!;
    assert.ok(dgPart.stockQuantity >= dgPart.reorderThreshold);

    // 4. Attempt to reserve more than available quantity -> should return 409 Conflict
    const excessiveRes = await app.post(
      '/api/inventory/reserve',
      {
        wagonNumber: triageWagon1,
        partCode: 'PART-DG-01',
        quantity: dgPart.availableQuantity + 999
      },
      { Authorization: `Bearer ${inspectorToken}` }
    );
    assert.strictEqual(excessiveRes.status, 409);
    const excessiveBody = excessiveRes.body as { success: boolean; error: string };
    assert.strictEqual(excessiveBody.success, false);
    assert.ok(excessiveBody.error.includes('INSUFFICIENT_STOCK'));
  });

  // TC-P3-OMRS-04: Shop Floor Component Issuance & Stock Decrement
  it('TC-P3-OMRS-04: Issues reserved component to workshop floor and decrements inventory stock', async () => {
    // 1. Create a manual reservation
    const reserveRes = await app.post(
      '/api/inventory/reserve',
      {
        wagonNumber: triageWagon1,
        partCode: 'PART-BRK-BLK',
        quantity: 4,
        source: 'MANUAL_INSPECTION',
        predictedDefect: 'Brake Block Worn Out'
      },
      { Authorization: `Bearer ${inspectorToken}` }
    );

    assert.strictEqual(reserveRes.status, 201);
    const reservation = (reserveRes.body as { data: InventoryReservation }).data;
    assert.strictEqual(reservation.status, 'RESERVED');
    assert.strictEqual(reservation.quantity, 4);

    const partBeforeIssue = app.auditDb.getPartByCode('PART-BRK-BLK')!;

    // 2. Issue reservation to floor
    const issueRes = await app.post(
      '/api/inventory/issue',
      { reservationId: reservation.id },
      { Authorization: `Bearer ${inspectorToken}` }
    );
    assert.strictEqual(issueRes.status, 200);
    const issueBody = issueRes.body as { success: boolean; issuedQuantity: number; remainingStock: number };
    assert.strictEqual(issueBody.success, true);
    assert.strictEqual(issueBody.issuedQuantity, 4);

    // Verify reservation status in DB
    const resAfterIssue = app.auditDb.getReservations(triageWagon1).find(r => r.id === reservation.id);
    assert.ok(resAfterIssue);
    assert.strictEqual(resAfterIssue.status, 'ISSUED_TO_FLOOR');
    assert.ok(resAfterIssue.allocatedAt);

    // 3. Verify stock and reserved quantities are decremented
    const partAfterIssue = app.auditDb.getPartByCode('PART-BRK-BLK')!;
    assert.strictEqual(partAfterIssue.stockQuantity, partBeforeIssue.stockQuantity - 4);
    assert.strictEqual(partAfterIssue.reservedQuantity, partBeforeIssue.reservedQuantity - 4);

    // 4. Attempting to issue the same reservation again should fail
    const duplicateIssueRes = await app.post(
      '/api/inventory/issue',
      { reservationId: reservation.id },
      { Authorization: `Bearer ${inspectorToken}` }
    );
    assert.strictEqual(duplicateIssueRes.status, 400);
    const dupBody = duplicateIssueRes.body as { success: boolean; error: string };
    assert.strictEqual(dupBody.success, false);
    assert.ok(dupBody.error.includes('already been issued'));
  });

  // TC-P3-OMRS-05: Inventory Restocking & Negative / Invalid Input Rejection
  it('TC-P3-OMRS-05: Restocks inventory parts and enforces positive integer validation', async () => {
    const initialPart = app.auditDb.getPartByCode('PART-BRG-01')!;

    // 1. Valid restock
    const restockRes = await app.post(
      '/api/inventory/restock',
      {
        partCode: 'PART-BRG-01',
        quantity: 15
      },
      { Authorization: `Bearer ${supervisorToken}` }
    );
    assert.strictEqual(restockRes.status, 200);
    const restockedPart = (restockRes.body as { data: StoresPart }).data;
    assert.strictEqual(restockedPart.stockQuantity, initialPart.stockQuantity + 15);

    // 2. Reject negative quantity
    const negativeRes = await app.post(
      '/api/inventory/restock',
      {
        partCode: 'PART-BRG-01',
        quantity: -10
      },
      { Authorization: `Bearer ${supervisorToken}` }
    );
    assert.strictEqual(negativeRes.status, 400);

    // 3. Reject zero quantity
    const zeroRes = await app.post(
      '/api/inventory/restock',
      {
        partCode: 'PART-BRG-01',
        quantity: 0
      },
      { Authorization: `Bearer ${supervisorToken}` }
    );
    assert.strictEqual(zeroRes.status, 400);

    // 4. Reject non-existent part
    const unkRes = await app.post(
      '/api/inventory/restock',
      {
        partCode: 'PART-UNKNOWN-NON-EXISTENT',
        quantity: 5
      },
      { Authorization: `Bearer ${supervisorToken}` }
    );
    assert.strictEqual(unkRes.status, 400);
  });

  // TC-P3-OMRS-06: Nominal Telemetry Scan Handling (Zero Defect / Nominal Condition)
  it('TC-P3-OMRS-06: Handles nominal telemetry scans with zero defect false alarms and zero auto-reservations', async () => {
    // 1. Ingest nominal telemetry
    const scanRes = await app.post(
      '/api/omrs/simulate-scan',
      {
        wagonNumber: nominalWagon,
        trainSpeedKmph: 75.0,
        wheelImpactKn: 12.0,
        acousticBearingPeakDb: 42.0,
        temperatureCelsius: 32.0,
        wheelProfileDeviationMm: 0.6,
        location: 'BILASPUR-RAIPUR-UP-LINE-KM824'
      },
      { Authorization: `Bearer ${inspectorToken}` }
    );

    assert.strictEqual(scanRes.status, 201);
    const scan = (scanRes.body as { data: OMRSScanRecord }).data;
    assert.strictEqual(scan.triageSeverity, 'NORMAL');
    assert.strictEqual(scan.predictedDefects.length, 0);

    // 2. Run AI triage
    const triageRes = await app.get(`/api/omrs/triage/${encodeURIComponent(nominalWagon)}`, { Authorization: `Bearer ${inspectorToken}` });
    assert.strictEqual(triageRes.status, 200);
    const triage = (triageRes.body as { data: AITriageResult }).data;
    assert.strictEqual(triage.scan.isTriaged, true);
    assert.strictEqual(triage.reservations.length, 0);
    assert.ok(triage.triageSummary.includes('Telemetry nominal'));
  });
});
