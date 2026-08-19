/**
 * Tier 1 Test Suite — Feature R4: Component Health Passports & RFID/QR Ledger
 * Indian Railways WRS Raipur (Phase 3)
 *
 * Verifies serialized component registration, multi-protocol QR code parsing,
 * wagon & bogie mounting assignments, multi-wagon provenance tracking,
 * Stores Depot return unassignment, registry filtering, Stage 7 Release Certificate
 * manifest integration, and SQLite append-only trigger immutability.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { TestApp } from '../../harness/test_app.ts';
import { encodeComponentQR, decodeComponentQR, MockQRDetector } from '../../harness/qr_mock.ts';
import type {
  SerializedComponent,
  ComponentHistoryEvent,
  ChecklistItem
} from '../../../shared/types.ts';

describe('Tier 1 — Phase 3 Feature R4: Component Health Passports & RFID/QR Ledger', () => {
  let app: TestApp;
  let inspectorToken: string;
  let supervisorToken: string;
  const testWagonNumber1 = 'SECR/BOXNHL/90011';
  const testWagonNumber2 = 'SECR/BOXNHL/90022';

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
        wagonNumber: testWagonNumber1,
        wagonType: 'BOXNHL',
        owningRailway: 'SECR',
        entryNotes: 'Component Passports Test Wagon 1'
      },
      { Authorization: `Bearer ${inspectorToken}` }
    );

    await app.post(
      '/api/wagons/register',
      {
        wagonNumber: testWagonNumber2,
        wagonType: 'BOXNHL',
        owningRailway: 'SECR',
        entryNotes: 'Component Passports Test Wagon 2'
      },
      { Authorization: `Bearer ${inspectorToken}` }
    );
  });

  // TC-P3-COMP-01: Serialized Component Registration & Initial Manufactured Ledger Entry
  it('TC-P3-COMP-01: Registers serialized components and records initial MANUFACTURED ledger entry', async () => {
    const res = await app.post(
      '/api/components/register',
      {
        serialNumber: 'WRS-WS-2026-001',
        componentType: 'WHEELSET',
        category: 'WHEELS_AXLES',
        partName: 'CASNUB 22NLB Wheelset Assembly',
        manufacturer: 'RWF Yelahanka',
        manufacturingDate: '2026-01-15',
        initialStatus: 'AVAILABLE_IN_STORES',
        rfidTag: 'RFID-HEX-WS-001',
        binLocation: 'BAY-3-RACK-A'
      },
      { Authorization: `Bearer ${inspectorToken}` }
    );

    assert.strictEqual(res.status, 201);
    const body = res.body as { success: boolean; data: SerializedComponent };
    assert.strictEqual(body.success, true);
    assert.ok(body.data);

    const comp = body.data;
    assert.strictEqual(comp.serialNumber, 'WRS-WS-2026-001');
    assert.strictEqual(comp.componentType, 'WHEELSET');
    assert.strictEqual(comp.category, 'WHEELS_AXLES');
    assert.strictEqual(comp.status, 'AVAILABLE_IN_STORES');
    assert.strictEqual(comp.healthScore, 100);
    assert.strictEqual(comp.healthStatus, 'EXCELLENT');
    assert.strictEqual(comp.currentWagonNumber, null);
    assert.strictEqual(comp.currentBogiePosition, 'NONE');
    assert.ok(comp.qrCode.startsWith('WRS-PASSPORT://v1?sn=WRS-WS-2026-001'));

    // Check initial history ledger
    const histRes = await app.get('/api/components/WRS-WS-2026-001/history', { Authorization: `Bearer ${inspectorToken}` });
    assert.strictEqual(histRes.status, 200);
    const histBody = histRes.body as { success: boolean; data: ComponentHistoryEvent[] };
    assert.strictEqual(histBody.success, true);
    assert.strictEqual(histBody.data.length, 1);
    assert.strictEqual(histBody.data[0].eventType, 'MANUFACTURED');
    assert.ok(histBody.data[0].actionDetails.includes('RWF Yelahanka'));
  });

  // TC-P3-COMP-02: QR Code Decoding, Multi-Protocol Support & Error Diagnostics
  it('TC-P3-COMP-02: Decodes URI/JSON/Raw QR payloads and handles malformed and unregistered serials', async () => {
    // 1. Register a component for lookup
    await app.post(
      '/api/components/register',
      {
        serialNumber: 'WRS-BRG-2026-042',
        componentType: 'BEARING',
        category: 'BEARINGS',
        partName: 'CTRB Class E Cartridge Bearing',
        manufacturer: 'NEI Jaipur',
        manufacturingDate: '2026-02-10'
      },
      { Authorization: `Bearer ${inspectorToken}` }
    );

    const detector = new MockQRDetector();

    // 2. URI Protocol decoding
    const uriPayload = encodeComponentQR('WRS-BRG-2026-042', {
      componentType: 'BEARING',
      manufacturer: 'NEI Jaipur',
      mfgDate: '2026-02-10'
    });
    const decodedUri = await detector.detectFromPayload(uriPayload);
    assert.strictEqual(decodedUri.serialNumber, 'WRS-BRG-2026-042');
    assert.strictEqual(decodedUri.componentType, 'BEARING');
    assert.strictEqual(decodedUri.manufacturer, 'NEI Jaipur');

    // 3. Scan QR endpoint with URI payload
    const scanRes = await app.post(
      '/api/components/scan-qr',
      { qrPayload: uriPayload },
      { Authorization: `Bearer ${inspectorToken}` }
    );
    assert.strictEqual(scanRes.status, 200);
    const scanBody = scanRes.body as { success: boolean; component: SerializedComponent };
    assert.strictEqual(scanBody.success, true);
    assert.strictEqual(scanBody.component.serialNumber, 'WRS-BRG-2026-042');

    // 4. JSON Protocol decoding
    const jsonPayload = JSON.stringify({
      serialNumber: 'WRS-BRG-2026-042',
      componentType: 'BEARING',
      manufacturer: 'NEI Jaipur',
      version: 'v1'
    });
    const decodedJson = decodeComponentQR(jsonPayload);
    assert.strictEqual(decodedJson.serialNumber, 'WRS-BRG-2026-042');
    assert.strictEqual(decodedJson.componentType, 'BEARING');

    // 5. Raw serial string format fallback
    const decodedRaw = decodeComponentQR('WRS-BRG-889900');
    assert.strictEqual(decodedRaw.serialNumber, 'WRS-BRG-889900');
    assert.strictEqual(decodedRaw.componentType, 'BEARING');

    // 6. Malformed payload error handling
    assert.throws(
      () => decodeComponentQR('INVALID_CORRUPTED_STRING_DATA'),
      /MALFORMED_QR/
    );

    // 7. Unregistered component scan returns 404 with decoded info
    const unregUri = 'WRS-PASSPORT://v1?sn=WRS-DG-9999-999&type=DRAFT_GEAR&mfg=BESCO&date=2026-01-01';
    const unregScan = await app.post(
      '/api/components/scan-qr',
      { qrPayload: unregUri },
      { Authorization: `Bearer ${inspectorToken}` }
    );
    assert.strictEqual(unregScan.status, 404);
    const unregBody = unregScan.body as { success: boolean; error: string; decoded: any };
    assert.strictEqual(unregBody.success, false);
    assert.strictEqual(unregBody.decoded.serialNumber, 'WRS-DG-9999-999');
    assert.ok(unregBody.error.includes('COMPONENT_NOT_FOUND'));
  });

  // TC-P3-COMP-03: Wagon Assignment & Bogie Mounting Position Tracking
  it('TC-P3-COMP-03: Assigns serialized component to wagon and tracks bogie mounting position', async () => {
    // 1. Register Draft Gear
    await app.post(
      '/api/components/register',
      {
        serialNumber: 'WRS-DG-2026-105',
        componentType: 'DRAFT_GEAR',
        category: 'COUPLERS_DRAFT_GEAR',
        partName: 'Mark-50 High Capacity Draft Gear',
        manufacturer: 'BESCO Kolkata',
        manufacturingDate: '2026-01-20'
      },
      { Authorization: `Bearer ${inspectorToken}` }
    );

    // 2. Assign to Wagon 1 at UNDERFRAME position
    const assignRes = await app.post(
      '/api/components/WRS-DG-2026-105/assign',
      {
        wagonNumber: testWagonNumber1,
        bogiePosition: 'UNDERFRAME',
        stage: 'REASSEMBLY',
        notes: 'Mounted on CBC Pocket leading end'
      },
      { Authorization: `Bearer ${inspectorToken}` }
    );

    assert.strictEqual(assignRes.status, 200);
    const body = assignRes.body as { success: boolean; data: SerializedComponent };
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.currentWagonNumber, testWagonNumber1);
    assert.strictEqual(body.data.currentBogiePosition, 'UNDERFRAME');
    assert.strictEqual(body.data.status, 'IN_SERVICE');

    // 3. Verify history event ledger
    const histRes = await app.get('/api/components/WRS-DG-2026-105/history', { Authorization: `Bearer ${inspectorToken}` });
    const hist = (histRes.body as { data: ComponentHistoryEvent[] }).data;
    assert.strictEqual(hist.length, 2);
    assert.strictEqual(hist[0].eventType, 'MANUFACTURED');
    assert.strictEqual(hist[1].eventType, 'ASSIGNED_TO_WAGON');
    assert.strictEqual(hist[1].wagonNumber, testWagonNumber1);
    assert.ok(hist[1].actionDetails.includes('UNDERFRAME'));
  });

  // TC-P3-COMP-04: Multi-Wagon Reassignment & Historical Provenance Chain
  it('TC-P3-COMP-04: Tracks complete cross-wagon provenance timeline across multiple wagon reassignments', async () => {
    // 1. Register Wheelset
    await app.post(
      '/api/components/register',
      {
        serialNumber: 'WRS-WS-2026-099',
        componentType: 'WHEELSET',
        category: 'WHEELS_AXLES',
        partName: 'CASNUB 22HS Wheelset',
        manufacturer: 'RWF Yelahanka'
      },
      { Authorization: `Bearer ${inspectorToken}` }
    );

    // 2. Assign to Wagon 1 (BOGIE_1)
    await app.post(
      '/api/components/WRS-WS-2026-099/assign',
      {
        wagonNumber: testWagonNumber1,
        bogiePosition: 'BOGIE_1',
        stage: 'REASSEMBLY',
        notes: 'Initial fitting on Wagon 1'
      },
      { Authorization: `Bearer ${inspectorToken}` }
    );

    // 3. Reassign to Wagon 2 (BOGIE_2)
    const reassignRes = await app.post(
      '/api/components/WRS-WS-2026-099/assign',
      {
        wagonNumber: testWagonNumber2,
        bogiePosition: 'BOGIE_2',
        stage: 'REPAIR_REPLACEMENT',
        notes: 'Reassigned to Wagon 2 following ultrasonic clearance'
      },
      { Authorization: `Bearer ${inspectorToken}` }
    );

    assert.strictEqual(reassignRes.status, 200);
    const comp = (reassignRes.body as { data: SerializedComponent }).data;
    assert.strictEqual(comp.currentWagonNumber, testWagonNumber2);
    assert.strictEqual(comp.currentBogiePosition, 'BOGIE_2');

    // 4. Verify 4-stage chronological history ledger
    const histRes = await app.get('/api/components/WRS-WS-2026-099/history', { Authorization: `Bearer ${inspectorToken}` });
    const events = (histRes.body as { data: ComponentHistoryEvent[] }).data;
    assert.strictEqual(events.length, 4);

    assert.strictEqual(events[0].eventType, 'MANUFACTURED');

    assert.strictEqual(events[1].eventType, 'ASSIGNED_TO_WAGON');
    assert.strictEqual(events[1].wagonNumber, testWagonNumber1);

    assert.strictEqual(events[2].eventType, 'REMOVED_FROM_WAGON');
    assert.strictEqual(events[2].wagonNumber, testWagonNumber1);
    assert.ok(events[2].actionDetails.includes(`reassignment to ${testWagonNumber2}`));

    assert.strictEqual(events[3].eventType, 'ASSIGNED_TO_WAGON');
    assert.strictEqual(events[3].wagonNumber, testWagonNumber2);
  });

  // TC-P3-COMP-05: Component Unassignment & Return to Stores Depot
  it('TC-P3-COMP-05: Unassigns component from wagon and updates status to AVAILABLE_IN_STORES', async () => {
    // 1. Register and assign bearing
    await app.post(
      '/api/components/register',
      {
        serialNumber: 'WRS-BRG-2026-555',
        componentType: 'BEARING',
        category: 'BEARINGS',
        partName: 'TIMKEN CTRB Bearing'
      },
      { Authorization: `Bearer ${inspectorToken}` }
    );

    await app.post(
      '/api/components/WRS-BRG-2026-555/assign',
      {
        wagonNumber: testWagonNumber1,
        bogiePosition: 'BOGIE_1'
      },
      { Authorization: `Bearer ${inspectorToken}` }
    );

    // 2. Unassign component
    const unassignRes = await app.post(
      '/api/components/WRS-BRG-2026-555/unassign',
      { notes: 'Stripped for intermediate ultrasonic examination' },
      { Authorization: `Bearer ${inspectorToken}` }
    );

    assert.strictEqual(unassignRes.status, 200);
    const comp = (unassignRes.body as { data: SerializedComponent }).data;
    assert.strictEqual(comp.currentWagonNumber, null);
    assert.strictEqual(comp.currentBogiePosition, 'NONE');
    assert.strictEqual(comp.status, 'AVAILABLE_IN_STORES');

    // 3. Verify history event
    const histRes = await app.get('/api/components/WRS-BRG-2026-555/history', { Authorization: `Bearer ${inspectorToken}` });
    const events = (histRes.body as { data: ComponentHistoryEvent[] }).data;
    const lastEvent = events[events.length - 1];
    assert.strictEqual(lastEvent.eventType, 'REMOVED_FROM_WAGON');
    assert.ok(lastEvent.actionDetails.includes('returned to Stores Depot'));
  });

  // TC-P3-COMP-06: Component Registry Filtering & Wagon Manifest Queries
  it('TC-P3-COMP-06: Filters component catalog by type, status, and wagon number', async () => {
    // 1. Seed multiple components
    await app.post('/api/components/register', { serialNumber: 'WRS-WS-101', componentType: 'WHEELSET', category: 'WHEELS_AXLES', partName: 'Wheelset A' }, { Authorization: `Bearer ${inspectorToken}` });
    await app.post('/api/components/register', { serialNumber: 'WRS-WS-102', componentType: 'WHEELSET', category: 'WHEELS_AXLES', partName: 'Wheelset B' }, { Authorization: `Bearer ${inspectorToken}` });
    await app.post('/api/components/register', { serialNumber: 'WRS-BRG-101', componentType: 'BEARING', category: 'BEARINGS', partName: 'Bearing A' }, { Authorization: `Bearer ${inspectorToken}` });
    await app.post('/api/components/register', { serialNumber: 'WRS-DG-101', componentType: 'DRAFT_GEAR', category: 'COUPLERS_DRAFT_GEAR', partName: 'Draft Gear A' }, { Authorization: `Bearer ${inspectorToken}` });

    // 2. Assign 2 components to Wagon 1
    await app.post('/api/components/WRS-WS-101/assign', { wagonNumber: testWagonNumber1, bogiePosition: 'BOGIE_1' }, { Authorization: `Bearer ${inspectorToken}` });
    await app.post('/api/components/WRS-BRG-101/assign', { wagonNumber: testWagonNumber1, bogiePosition: 'BOGIE_1' }, { Authorization: `Bearer ${inspectorToken}` });

    // 3. Filter by type=WHEELSET
    const wheelsetsRes = await app.get('/api/components?type=WHEELSET', { Authorization: `Bearer ${inspectorToken}` });
    const wheelsets = (wheelsetsRes.body as { data: SerializedComponent[] }).data;
    assert.ok(wheelsets.length >= 2);
    assert.ok(wheelsets.every(c => c.componentType === 'WHEELSET'));

    // 4. Filter by status=AVAILABLE_IN_STORES
    const availRes = await app.get('/api/components?status=AVAILABLE_IN_STORES', { Authorization: `Bearer ${inspectorToken}` });
    const available = (availRes.body as { data: SerializedComponent[] }).data;
    assert.ok(available.every(c => c.status === 'AVAILABLE_IN_STORES'));

    // 5. Filter by wagonNumber=testWagonNumber1
    const wagonManifestRes = await app.get(`/api/components?wagonNumber=${encodeURIComponent(testWagonNumber1)}`, { Authorization: `Bearer ${inspectorToken}` });
    const wagonComps = (wagonManifestRes.body as { data: SerializedComponent[] }).data;
    assert.strictEqual(wagonComps.length, 2);
    const snList = wagonComps.map(c => c.serialNumber);
    assert.ok(snList.includes('WRS-WS-101'));
    assert.ok(snList.includes('WRS-BRG-101'));
  });

  // TC-P3-COMP-07: Stage 7 Wagon Release Certificate Serialized Manifest Integration
  it('TC-P3-COMP-07: Serialized component manifest integrates with Stage 7 exit gate and sign-off', async () => {
    // 1. Register and assign parts to Wagon 1
    await app.post('/api/components/register', { serialNumber: 'WRS-WS-777', componentType: 'WHEELSET', category: 'WHEELS_AXLES', partName: 'Mounted Wheelset' }, { Authorization: `Bearer ${inspectorToken}` });
    await app.post('/api/components/register', { serialNumber: 'WRS-BRG-777', componentType: 'BEARING', category: 'BEARINGS', partName: 'Mounted Bearing' }, { Authorization: `Bearer ${inspectorToken}` });

    await app.post('/api/components/WRS-WS-777/assign', { wagonNumber: testWagonNumber1, bogiePosition: 'BOGIE_1' }, { Authorization: `Bearer ${inspectorToken}` });
    await app.post('/api/components/WRS-BRG-777/assign', { wagonNumber: testWagonNumber1, bogiePosition: 'BOGIE_2' }, { Authorization: `Bearer ${inspectorToken}` });

    // 2. Advance wagon to Stage 6 (FINAL_QC_GATE)
    const stages = ['DISMANTLING', 'COMPONENT_INSPECTION', 'REPAIR_REPLACEMENT', 'REASSEMBLY', 'FINAL_QC_GATE'] as const;
    for (const s of stages) {
      await app.post(`/api/wagons/${encodeURIComponent(testWagonNumber1)}/transition`, { targetStage: s }, { Authorization: `Bearer ${inspectorToken}` });
    }

    // 3. Mark all checklist items as PASS
    const clRes = await app.get(`/api/wagons/${encodeURIComponent(testWagonNumber1)}/checklist`, { Authorization: `Bearer ${inspectorToken}` });
    const items = (clRes.body as { items: ChecklistItem[] }).items;
    for (const item of items) {
      await app.put(
        `/api/wagons/${encodeURIComponent(testWagonNumber1)}/checklist/items/${item.id}`,
        { status: 'PASS' },
        { Authorization: `Bearer ${inspectorToken}` }
      );
    }

    // 4. Perform Supervisor Sign-off
    const signoffRes = await app.post(
      `/api/wagons/${encodeURIComponent(testWagonNumber1)}/gate/signoff`,
      {
        supervisorName: 'S. K. Verma',
        supervisorEmployeeId: 'WRS-SUP-2019',
        digitalSignature: 'HMAC-SHA256-TEST-SIG-777'
      },
      { Authorization: `Bearer ${supervisorToken}` }
    );
    assert.strictEqual(signoffRes.status, 200);

    // 5. Verify wagon has transitioned to RELEASE stage and RELEASED status
    const wagon = app.auditDb.getWagonByNumber(testWagonNumber1);
    assert.ok(wagon);
    assert.strictEqual(wagon.currentStage, 'RELEASE');
    assert.strictEqual(wagon.status, 'RELEASED');

    // 6. Verify components for released wagon
    const manifest = app.auditDb.getAllComponents({ wagonNumber: testWagonNumber1 });
    assert.strictEqual(manifest.length, 2);
    assert.ok(manifest.some(c => c.serialNumber === 'WRS-WS-777' && c.currentBogiePosition === 'BOGIE_1'));
    assert.ok(manifest.some(c => c.serialNumber === 'WRS-BRG-777' && c.currentBogiePosition === 'BOGIE_2'));
  });

  // TC-P3-COMP-08: Append-Only Ledger Immutability & Tamper Resistance Triggers
  it('TC-P3-COMP-08: Enforces SQLite trigger immutability preventing UPDATE or DELETE on component history', async () => {
    // 1. Register component to create history record
    await app.post(
      '/api/components/register',
      {
        serialNumber: 'WRS-FW-2026-999',
        componentType: 'FRICTION_WEDGE',
        category: 'FRICTION_WEDGES',
        partName: 'CASNUB Friction Wedge'
      },
      { Authorization: `Bearer ${inspectorToken}` }
    );

    const histRes = await app.get('/api/components/WRS-FW-2026-999/history', { Authorization: `Bearer ${inspectorToken}` });
    const events = (histRes.body as { data: ComponentHistoryEvent[] }).data;
    assert.strictEqual(events.length, 1);
    const eventId = events[0].id;

    // 2. Direct database handle
    const rawDb = (app.auditDb as any).db;
    assert.ok(rawDb);

    // 3. Attempt UPDATE on component_history -> Should abort
    assert.throws(
      () => {
        rawDb.prepare('UPDATE component_history SET action_details = ? WHERE id = ?').run('TAMPERED_DETAILS', eventId);
      },
      (err: any) => {
        assert.ok(err.message.includes('Component history is strictly append-only'));
        return true;
      }
    );

    // 4. Attempt DELETE on component_history -> Should abort
    assert.throws(
      () => {
        rawDb.prepare('DELETE FROM component_history WHERE id = ?').run(eventId);
      },
      (err: any) => {
        assert.ok(err.message.includes('Component history is strictly append-only'));
        return true;
      }
    );

    // 5. Verify record is untouched
    const verified = (app.auditDb as any).getComponentHistory('WRS-FW-2026-999');
    assert.strictEqual(verified.length, 1);
    assert.strictEqual(verified[0].id, eventId);
    assert.ok(!verified[0].actionDetails.includes('TAMPERED'));
  });
});
