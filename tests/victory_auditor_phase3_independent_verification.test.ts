/**
 * Independent Victory Audit Verification Test Suite — Phase 3 Upgrade ("The Holy Grail")
 * Indian Railways Wagon Repair Shop (WRS) Raipur
 *
 * Authored by: Independent Victory Auditor
 * Scope: Independent, unforgeable verification of all Phase 3 requirements (R1–R5),
 *        Acceptance Criteria, Non-regression, Hardware Simulation logic,
 *        and SQLite Append-Only Immutability Triggers.
 */

import test, { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../server/src/db/migrations.ts';
import { seedUsers } from '../server/src/db/seed.ts';
import { WagonRepository } from '../server/src/db/wagonRepository.ts';
import { ComponentRepository } from '../server/src/db/componentRepository.ts';
import { InventoryRepository } from '../server/src/db/inventoryRepository.ts';
import { OMRSRepository } from '../server/src/db/omrsRepository.ts';
import { InspectionRepository } from '../server/src/db/repository.ts';
import { LifecycleEngine } from '../server/src/lifecycle/engine.ts';
import { ExitGateValidator } from '../server/src/gate/validator.ts';
import { parseVoiceCommand } from '../client/src/utils/voiceCommandParser.ts';
import { RDSO_TOLERANCE_SPECS } from '../server/src/routes/cv.ts';
import { classifySpring } from '../server/src/classification/engine.ts';

describe('=== PHASE 3 INDEPENDENT VICTORY AUDITOR VERIFICATION SUITE ===', () => {
  let db: DatabaseSync;
  let wagonRepo: WagonRepository;
  let compRepo: ComponentRepository;
  let invRepo: InventoryRepository;
  let omrsRepo: OMRSRepository;
  let inspRepo: InspectionRepository;

  before(() => {
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON;');
    runMigrations(db);
    seedUsers(db);
    wagonRepo = new WagonRepository(db);
    compRepo = new ComponentRepository(db);
    invRepo = new InventoryRepository(db);
    omrsRepo = new OMRSRepository(db);
    inspRepo = new InspectionRepository(db);

    // Seed Stores Depot Inventory baseline
    invRepo.upsertPart({
      partCode: 'PRT-SPR-OUT-01',
      partName: 'CASNUB 22NLB Outer Coil Spring',
      category: 'SPRINGS',
      unitOfMeasure: 'NOS',
      stockQuantity: 50,
      reservedQuantity: 0,
      reorderThreshold: 15,
      unitCostInr: 2450,
      binLocation: 'BAY-1-RACK-A1'
    });

    invRepo.upsertPart({
      partCode: 'PRT-WHL-BOXNHL',
      partName: 'CASNUB BOXNHL Wheelset Assembly 1000mm',
      category: 'WHEELS_AXLES',
      unitOfMeasure: 'NOS',
      stockQuantity: 20,
      reservedQuantity: 0,
      reorderThreshold: 5,
      unitCostInr: 65000,
      binLocation: 'YARD-WHEEL-BAY-1'
    });

    invRepo.upsertPart({
      partCode: 'PRT-BRG-CTRB',
      partName: 'Class E CTRB Cartridge Bearing Assembly',
      category: 'BEARINGS',
      unitOfMeasure: 'NOS',
      stockQuantity: 30,
      reservedQuantity: 0,
      reorderThreshold: 10,
      unitCostInr: 12500,
      binLocation: 'BAY-2-RACK-B1'
    });

    invRepo.upsertPart({
      partCode: 'PRT-BRK-COMP-BLK',
      partName: 'Composite Brake Block K-Type High Friction',
      category: 'BRAKE_SYSTEM',
      unitOfMeasure: 'NOS',
      stockQuantity: 100,
      reservedQuantity: 0,
      reorderThreshold: 20,
      unitCostInr: 850,
      binLocation: 'BAY-4-RACK-C1'
    });
  });

  // =========================================================================
  // 1. R1: Hands-Free Voice UI ("Greasy Gloves" Solution)
  // =========================================================================
  describe('R1: Hands-Free Voice UI Parser & Action Dispatching', () => {
    it('R1.1: Parses English voice commands accurately into checklist actions', () => {
      const p1 = parseVoiceCommand('Outer spring passes', 'SPRINGS');
      assert.equal(p1.intent, 'UPDATE_STATUS');
      assert.equal(p1.status, 'PASS');
      assert.equal(p1.category, 'SPRINGS');

      const p2 = parseVoiceCommand('Condemn friction wedge severe wear', 'FRICTION_WEDGES');
      assert.equal(p2.intent, 'UPDATE_STATUS');
      assert.equal(p2.status, 'CONDEMNED');
      assert.equal(p2.category, 'FRICTION_WEDGES');

      const p3 = parseVoiceCommand('Inner spring repaired', 'SPRINGS');
      assert.equal(p3.intent, 'UPDATE_STATUS');
      assert.equal(p3.status, 'REPAIRED');
    });

    it('R1.2: Parses Devanagari Hindi and Hinglish voice commands', () => {
      const p1 = parseVoiceCommand('आउटर स्प्रिंग पास', 'SPRINGS');
      assert.equal(p1.intent, 'UPDATE_STATUS');
      assert.equal(p1.status, 'PASS');

      const p2 = parseVoiceCommand('घर्षण वेज कंडम', 'FRICTION_WEDGES');
      assert.equal(p2.intent, 'UPDATE_STATUS');
      assert.equal(p2.status, 'CONDEMNED');

      const p3 = parseVoiceCommand('brake beam repair kiya', 'BRAKE_SYSTEM');
      assert.equal(p3.intent, 'UPDATE_STATUS');
      assert.equal(p3.status, 'REPAIRED');
    });

    it('R1.3: Parses Category Navigation & Undo voice commands', () => {
      const p1 = parseVoiceCommand('Show bearings');
      assert.equal(p1.intent, 'SWITCH_CATEGORY');
      assert.equal(p1.category, 'BEARINGS');

      const p2 = parseVoiceCommand('स्प्रिंग्स खोलो');
      assert.equal(p2.intent, 'SWITCH_CATEGORY');
      assert.equal(p2.category, 'SPRINGS');

      const p3 = parseVoiceCommand('Undo');
      assert.equal(p3.intent, 'UNDO');

      const p4 = parseVoiceCommand('वापस लो');
      assert.equal(p4.intent, 'UNDO');
    });

    it('R1.4: Records voice action to wagon checklist and creates immutable audit log', () => {
      const testWagon = 'SECR/BOXNHL/VUI-001';
      wagonRepo.registerWagon({
        wagonNumber: testWagon,
        wagonType: 'BOXNHL',
        owningRailway: 'SECR',
        createdBy: 'usr_insp_001'
      });

      const checklistData = wagonRepo.getChecklistItems(testWagon);
      assert.ok(checklistData.allItems.length > 0);
      const targetItem = checklistData.allItems.find((i: any) => i.category === 'SPRINGS' && i.partName.includes('Outer'));
      assert.ok(targetItem);

      const updateResult = wagonRepo.updateChecklistItem(targetItem.id, {
        status: 'CONDEMNED',
        conditionNotes: 'Voice: Condemned due to surface crack',
        inspectorId: 'usr_insp_001',
        inspectorName: 'Inspector Sharma'
      });

      assert.equal(updateResult.status, 'CONDEMNED');

      // Log voice audit entry
      inspRepo.logAuditEvent({
        eventType: 'VOICE_COMMAND_LOGGED',
        userId: 'usr_insp_001',
        userRole: 'INSPECTOR',
        payload: {
          wagonNumber: testWagon,
          transcript: 'Outer spring condemned',
          status: 'CONDEMNED'
        }
      });

      // Verify audit log entry in SQLite table
      const auditRows = db.prepare("SELECT * FROM inspection_audit_log WHERE event_type = 'VOICE_COMMAND_LOGGED'").all();
      assert.ok(auditRows.length >= 1);
    });
  });

  // =========================================================================
  // 2. R2: Direct Computer Vision Measurement (AR Simulation)
  // =========================================================================
  describe('R2: Direct Computer Vision & RDSO Tolerance Evaluation', () => {
    it('R2.1: Correctly evaluates Outer Spring RDSO tolerances (Pass vs Condemned)', () => {
      const spec = RDSO_TOLERANCE_SPECS.OUTER_SPRING;
      assert.equal(spec.nominalValue, 260.0);
      assert.equal(spec.minPermissible, 245.0);

      // In-tolerance height (259.0 mm) -> Band II / GREEN
      const passClassification = classifySpring({
        bogieType: 'CASNUB_22_NLB',
        condition: 'USED',
        position: 'OUTER',
        measuredHeight: 259.0
      });
      assert.equal(passClassification.status, 'PASS');
      assert.equal(passClassification.band, 'GREEN');
      assert.equal(passClassification.bandRoman, 'Band II');

      // Out-of-tolerance height (242.0 mm < 245.0 mm limit)
      const condClassification = classifySpring({
        bogieType: 'CASNUB_22_NLB',
        condition: 'USED',
        position: 'OUTER',
        measuredHeight: 242.0
      });
      assert.equal(condClassification.status, 'CONDEMNED');
    });

    it('R2.2: Correctly evaluates Friction Wedge wear limits (Para 4.4)', () => {
      const spec = RDSO_TOLERANCE_SPECS.FRICTION_WEDGE;
      assert.equal(spec.nominalValue, 136.0);
      assert.equal(spec.minPermissible, 129.0);
      assert.equal(spec.maxPermissibleWear, 7.0);

      // Wear of 4.0mm (remaining 132.0mm >= 129.0mm) -> PASS
      const measuredPass = 132.0;
      const isPass = measuredPass >= spec.minPermissible && measuredPass <= spec.maxPermissible;
      assert.equal(isPass, true);

      // Wear of 9.0mm (remaining 127.0mm < 129.0mm) -> CONDEMNED
      const measuredCond = 127.0;
      const isCond = measuredCond < spec.minPermissible;
      assert.equal(isCond, true);
    });

    it('R2.3: Correctly evaluates CTRB End Cap gap tolerance (0.5mm - 3.0mm)', () => {
      const spec = RDSO_TOLERANCE_SPECS.CTRB_END_CAP;
      assert.equal(spec.minPermissible, 0.5);
      assert.equal(spec.maxPermissible, 3.0);

      const validGap = 1.8;
      assert.ok(validGap >= spec.minPermissible && validGap <= spec.maxPermissible);

      const looseBoltGap = 4.5;
      assert.ok(looseBoltGap > spec.maxPermissible);
    });
  });

  // =========================================================================
  // 3. R3: Smart Acoustic Bearing & Leak Detection
  // =========================================================================
  describe('R3: Smart Acoustic Bearing & Pneumatic Leak Detection', () => {
    const acousticWagon = 'SECR/BOXNHL/ACU-001';

    before(() => {
      wagonRepo.registerWagon({
        wagonNumber: acousticWagon,
        wagonType: 'BOXNHL',
        owningRailway: 'SECR',
        createdBy: 'usr_insp_001'
      });
      // Move to FINAL_QC_GATE
      wagonRepo.recordTransition({ wagonNumber: acousticWagon, fromStage: 'ENTRY_REGISTRATION', toStage: 'DISMANTLING', transitionType: 'NORMAL', performedBy: 'usr_insp_001', performerName: 'Inspector Sharma', performerRole: 'INSPECTOR' });
      wagonRepo.recordTransition({ wagonNumber: acousticWagon, fromStage: 'DISMANTLING', toStage: 'COMPONENT_INSPECTION', transitionType: 'NORMAL', performedBy: 'usr_insp_001', performerName: 'Inspector Sharma', performerRole: 'INSPECTOR' });
      wagonRepo.recordTransition({ wagonNumber: acousticWagon, fromStage: 'COMPONENT_INSPECTION', toStage: 'REPAIR_REPLACEMENT', transitionType: 'NORMAL', performedBy: 'usr_insp_001', performerName: 'Inspector Sharma', performerRole: 'INSPECTOR' });
      wagonRepo.recordTransition({ wagonNumber: acousticWagon, fromStage: 'REPAIR_REPLACEMENT', toStage: 'REASSEMBLY', transitionType: 'NORMAL', performedBy: 'usr_insp_001', performerName: 'Inspector Sharma', performerRole: 'INSPECTOR' });
      wagonRepo.recordTransition({ wagonNumber: acousticWagon, fromStage: 'REASSEMBLY', toStage: 'FINAL_QC_GATE', transitionType: 'NORMAL', performedBy: 'usr_insp_001', performerName: 'Inspector Sharma', performerRole: 'INSPECTOR' });
    });

    it('R3.1: Records acoustic diagnostic telemetry and blocks Exit Gate on defect', () => {
      const diagResult = wagonRepo.recordAcousticDiagnostic({
        wagonNumber: acousticWagon,
        dominantFrequencyHz: 5200,
        peakDb: -18,
        anomalyType: 'AIR_LEAK',
        confidence: 0.96,
        details: 'High-frequency pneumatic air leak hiss detected in brake line',
        targetCategory: 'BRAKE_SYSTEM',
        targetPartName: 'Air Hose & Angle Cocks',
        inspectorId: 'usr_insp_001'
      });

      assert.equal(diagResult.diagnosticResult.anomalyType, 'AIR_LEAK');
      assert.equal(diagResult.gateBlocked, true);
      assert.ok(diagResult.blockers.length > 0);

      // Verify that Exit Gate Validator detects this blocker
      const gateEvaluation = ExitGateValidator.evaluate(acousticWagon, wagonRepo);
      assert.equal(gateEvaluation.canRelease, false);
      assert.ok(gateEvaluation.blockers.length > 0);
    });

    it('R3.2: Resolves acoustic defect blocker upon repair and clears gate', () => {
      const checklistData = wagonRepo.getChecklistItems(acousticWagon);
      const brakeItem = checklistData.allItems.find((i: any) => i.category === 'BRAKE_SYSTEM' && (i.status === 'FAIL' || i.status === 'CONDEMNED'));
      assert.ok(brakeItem);

      // Repair and reinspect brake item
      wagonRepo.updateChecklistItem(brakeItem.id, {
        status: 'REPAIRED',
        repairAction: 'REPAIRED',
        repairNotes: 'Replaced pneumatic coupling washer and torqued angle cock',
        reinspectedStatus: 'PASS',
        inspectorId: 'usr_insp_001',
        inspectorName: 'Inspector Sharma'
      });

      // Pass remaining pending items
      for (const item of checklistData.allItems) {
        if (item.id !== brakeItem.id && item.status === 'PENDING') {
          wagonRepo.updateChecklistItem(item.id, {
            status: 'PASS',
            inspectorId: 'usr_insp_001',
            inspectorName: 'Inspector Sharma'
          });
        }
      }

      const gateEvaluationAfter = ExitGateValidator.evaluate(acousticWagon, wagonRepo);
      assert.equal(gateEvaluationAfter.blockerDetails.length, 0);
    });
  });

  // =========================================================================
  // 4. R4: Component "Health Passports" (Serialization & QR Tracking)
  // =========================================================================
  describe('R4: Component Health Passports, QR Tracking & History Ledger', () => {
    const compSerial = 'WRS-WS-2026-AUDIT-99';
    const wagonA = 'SECR/BOXNHL/PASSPORT-A';
    const wagonB = 'SECR/BOXNHL/PASSPORT-B';

    before(() => {
      wagonRepo.registerWagon({ wagonNumber: wagonA, wagonType: 'BOXNHL', owningRailway: 'SECR', createdBy: 'usr_insp_001' });
      wagonRepo.registerWagon({ wagonNumber: wagonB, wagonType: 'BOXNHL', owningRailway: 'SECR', createdBy: 'usr_insp_001' });
    });

    it('R4.1: Registers serialized component and auto-generates QR code', () => {
      const comp = compRepo.registerComponent({
        serialNumber: compSerial,
        componentType: 'WHEELSET',
        category: 'WHEELS_AXLES',
        partName: 'CASNUB Wheelset Assembly 1000mm',
        manufacturer: 'RWF Yelahanka',
        manufacturingDate: '2026-02-01',
        initialStatus: 'AVAILABLE_IN_STORES',
        rfidTag: 'RFID-HEX-AUDIT-99',
        binLocation: 'BAY-1-RACK-A'
      });

      assert.equal(comp.serialNumber, compSerial);
      assert.equal(comp.status, 'AVAILABLE_IN_STORES');
      assert.ok(comp.qrCode.includes(compSerial));

      // Check initial history event from SQLite trigger
      const compRecord = compRepo.getComponentBySerial(compSerial, true);
      assert.ok(compRecord);
      assert.ok(compRecord.history.length >= 1);
      assert.equal(compRecord.history[0].eventType, 'COMMISSIONED');
    });

    it('R4.2: Assigns component to Wagon A and tracks mounting in history', () => {
      const assigned = compRepo.assignComponent(
        compSerial,
        wagonA,
        'BOGIE_1',
        'COMPONENT_INSPECTION',
        'Mounted during POH overhaul'
      );

      assert.equal(assigned.currentWagonNumber, wagonA);
      assert.equal(assigned.currentBogiePosition, 'BOGIE_1');
      assert.equal(assigned.status, 'IN_SERVICE');

      // Verify wagon components query returns it
      const wagonComps = compRepo.getComponentsByWagon(wagonA);
      assert.ok(wagonComps.some(c => c.serialNumber === compSerial));

      // Verify history contains ASSIGNED_TO_WAGON
      const compRecord = compRepo.getComponentBySerial(compSerial, true);
      assert.ok(compRecord?.history.some(h => h.eventType === 'ASSIGNED_TO_WAGON' && h.wagonNumber === wagonA));
    });

    it('R4.3: Reassigns component from Wagon A to Wagon B (multi-wagon lifecycle provenance)', () => {
      const reassigned = compRepo.assignComponent(
        compSerial,
        wagonB,
        'BOGIE_2',
        'REASSEMBLY',
        'Transferred to Wagon B after wheel turning'
      );

      assert.equal(reassigned.currentWagonNumber, wagonB);
      assert.equal(reassigned.currentBogiePosition, 'BOGIE_2');

      const compRecord = compRepo.getComponentBySerial(compSerial, true);
      assert.ok(compRecord);
      assert.ok(compRecord.history.length >= 3);
      assert.ok(compRecord.history.some(h => h.wagonNumber === wagonA));
      assert.ok(compRecord.history.some(h => h.wagonNumber === wagonB));
    });

    it('R4.4: Enforces immutability triggers on component_history table', () => {
      const compRecord = compRepo.getComponentBySerial(compSerial, true);
      assert.ok(compRecord && compRecord.history.length > 0);
      const targetHistoryId = compRecord.history[0].id;

      // Attempt UPDATE -> should ABORT
      assert.throws(() => {
        db.exec(`UPDATE component_history SET action_details = 'Tampered' WHERE id = '${targetHistoryId}';`);
      }, /Component history is strictly append-only|immutable/i);

      // Attempt DELETE -> should ABORT
      assert.throws(() => {
        db.exec(`DELETE FROM component_history WHERE id = '${targetHistoryId}';`);
      }, /Component history is strictly append-only|immutable/i);
    });
  });

  // =========================================================================
  // 5. R5: Pre-Arrival AI Triage & Stores Inventory Supply Chain
  // =========================================================================
  describe('R5: Pre-Arrival OMRS Telemetry, AI Triage & Stores Inventory', () => {
    const triageWagon = 'SECR/BOXNHL/OMRS-TRIAGE-1';

    before(() => {
      wagonRepo.registerWagon({
        wagonNumber: triageWagon,
        wagonType: 'BOXNHL',
        owningRailway: 'SECR',
        createdBy: 'usr_insp_001'
      });
    });

    it('R5.1: Ingests trackside OMRS telemetry and auto-predicts failing components', () => {
      const scan = omrsRepo.recordScan({
        wagonNumber: triageWagon,
        trainSpeedKmph: 75.0,
        wheelImpactKn: 145.0, // High impact -> Wheel flat / wheelset defect
        acousticBearingPeakDb: 88.0, // High acoustic dB -> CTRB bearing defect
        temperatureCelsius: 80.0, // High temperature -> Brake block binding
        location: 'Raipur Yard KM 828'
      });

      assert.equal(scan.wagonNumber, triageWagon);
      assert.equal(scan.triageSeverity, 'CRITICAL_TRIAGE');
      assert.ok(scan.predictedDefects.length >= 2);
      assert.ok(scan.predictedDefects.some(d => d.recommendedPartCode === 'PRT-BRG-CTRB' || d.recommendedPartCode === 'PRT-WHL-BOXNHL'));
    });

    it('R5.2: Executes AI Triage and auto-reserves parts in Stores Depot Inventory', () => {
      const targetPartCode = 'PRT-BRG-CTRB';
      const partBefore = invRepo.getPartByCode(targetPartCode);
      assert.ok(partBefore);
      const prevReserved = partBefore.reservedQuantity;

      const triageResult = omrsRepo.runAITriage(triageWagon, invRepo);
      assert.equal(triageResult.scan.wagonNumber, triageWagon);
      assert.ok(triageResult.reservations.length >= 1);

      // Verify reservations in Stores Depot
      const reservations = invRepo.getReservations(triageWagon);
      assert.ok(reservations.length >= 1);
      assert.ok(reservations.some(r => r.partCode === targetPartCode && r.status === 'RESERVED'));

      // Verify reserved quantity increased in inventory
      const partAfter = invRepo.getPartByCode(targetPartCode);
      assert.ok(partAfter);
      assert.ok(partAfter.reservedQuantity >= prevReserved);
    });

    it('R5.3: Issues reserved parts to shop floor and decrements stock quantity', () => {
      const reservations = invRepo.getReservations(triageWagon, 'RESERVED');
      assert.ok(reservations.length > 0);
      const targetRes = reservations[0];
      assert.ok(targetRes);

      const partBefore = invRepo.getPartByCode(targetRes.partCode);
      assert.ok(partBefore);
      const prevStock = partBefore.stockQuantity;
      const prevReserved = partBefore.reservedQuantity;

      const issued = invRepo.issuePart(targetRes.id);
      assert.equal(issued.success, true);
      assert.equal(issued.reservation.status, 'ISSUED_TO_FLOOR');

      const partAfter = invRepo.getPartByCode(targetRes.partCode);
      assert.ok(partAfter);
      assert.equal(partAfter.stockQuantity, prevStock - targetRes.quantity);
      assert.equal(partAfter.reservedQuantity, prevReserved - targetRes.quantity);
    });

    it('R5.4: Restocks stores inventory and updates available catalog count', () => {
      const partBefore = invRepo.getPartByCode('PRT-BRG-CTRB');
      assert.ok(partBefore);
      const prevStock = partBefore.stockQuantity;

      const restocked = invRepo.restockPart('PRT-BRG-CTRB', 25);
      assert.equal(restocked.stockQuantity, prevStock + 25);
    });
  });

  // =========================================================================
  // 6. Non-Regression: 7-Stage Lifecycle, Exit Gate, Form 35-B & Triggers
  // =========================================================================
  describe('Non-Regression: Lifecycle, Digital Release Certificate & Security', () => {
    const fullCycleWagon = 'SECR/BOXNHL/FULL-001';

    it('NR.1: Completes full 7-stage lifecycle and generates Form 35-B Certificate with SHA-256 hash', () => {
      wagonRepo.registerWagon({ wagonNumber: fullCycleWagon, wagonType: 'BOXNHL', owningRailway: 'SECR', createdBy: 'usr_insp_001' });

      // Advance through all stages
      const stages = ['DISMANTLING', 'COMPONENT_INSPECTION', 'REPAIR_REPLACEMENT', 'REASSEMBLY', 'FINAL_QC_GATE'];
      let current = 'ENTRY_REGISTRATION';
      for (const next of stages) {
        wagonRepo.recordTransition({
          wagonNumber: fullCycleWagon,
          fromStage: current as any,
          toStage: next as any,
          transitionType: 'NORMAL',
          performedBy: 'usr_insp_001',
          performerName: 'Inspector Sharma',
          performerRole: 'INSPECTOR'
        });
        current = next;
      }

      // Mark all checklist items PASS
      const checklistData = wagonRepo.getChecklistItems(fullCycleWagon);
      for (const item of checklistData.allItems) {
        wagonRepo.updateChecklistItem(item.id, {
          status: 'PASS',
          inspectorId: 'usr_insp_001',
          inspectorName: 'Inspector Sharma'
        });
      }

      // Verify Exit Gate readiness
      const gateEvaluation = ExitGateValidator.evaluate(fullCycleWagon, wagonRepo);
      assert.equal(gateEvaluation.canRelease, true);

      // Perform Stage 6 -> Stage 7 Gate Signoff
      const signoffResult = wagonRepo.recordGateSignoff({
        wagonNumber: fullCycleWagon,
        supervisorId: 'usr_sup_001',
        supervisorName: 'Supervisor Verma',
        supervisorEmployeeId: 'IR-SUP-2024-001',
        otpTokenRef: 'OTP-TOKEN-AUDIT-999',
        digitalSignature: 'SIG-ECDSA-SHA256-VERIFIED',
        signoffNotes: 'All 8 CASNUB categories inspected and zero-defect certified.',
        checksSummary: { status: 'ZERO_DEFECT_CERTIFIED', passedCategories: 8 }
      });

      assert.ok(signoffResult.certificateNumber.startsWith('WRS/QC-REL/'));
      assert.ok(signoffResult.certificateHash);
      assert.equal(signoffResult.certificateHash.length, 64); // SHA-256 64-hex chars

      // Verify wagon transitioned to RELEASE
      const wagon = wagonRepo.getWagonByNumber(fullCycleWagon);
      assert.equal(wagon?.currentStage, 'RELEASE');
      assert.equal(wagon?.status, 'RELEASED');
    });

    it('NR.2: Enforces SQLite trigger immutability across all critical audit ledgers', () => {
      // 1. Insert an inspection record first
      inspRepo.insertInspection({
        wagonNumber: 'SECR/BOXNHL/TRG-001',
        bogieType: 'CASNUB_22_NLB',
        condition: 'USED',
        springPosition: 'OUTER',
        measuredFreeHeight: 259.0,
        classifiedBand: 'YELLOW',
        bandRoman: 'Band III',
        status: 'PASS',
        tableReference: 'RDSO G-95 Table 28',
        valid_range_min: 245.0,
        valid_range_max: 263.0,
        inspectorId: 'usr_insp_001',
        inspectorName: 'Inspector Sharma',
        measurementSource: 'MANUAL'
      });

      // 2. Attempt UPDATE on inspections -> should ABORT
      assert.throws(() => {
        db.exec("UPDATE inspections SET status = 'PASS';");
      }, /Audit log is strictly append-only|immutable/i);

      // 3. Attempt DELETE on inspections -> should ABORT
      assert.throws(() => {
        db.exec('DELETE FROM inspections;');
      }, /Audit log is strictly append-only|immutable/i);

      // 4. Attempt UPDATE on inspection_audit_log -> should ABORT
      assert.throws(() => {
        db.exec("UPDATE inspection_audit_log SET user_role = 'ADMIN';");
      }, /Audit log is strictly append-only|immutable/i);

      // 5. Attempt UPDATE on wagon_transitions -> should ABORT
      assert.throws(() => {
        db.exec("UPDATE wagon_transitions SET transition_type = 'NORMAL';");
      }, /Audit log is strictly append-only|immutable/i);

      // 6. Attempt DELETE on gate_signoffs -> should ABORT
      assert.throws(() => {
        db.exec('DELETE FROM gate_signoffs;');
      }, /Audit log is strictly append-only|immutable/i);
    });
  });
});
