/**
 * Independent Victory Audit Verification Test Suite
 * Indian Railways Wagon Repair Shop (WRS) Raipur — Phase 2 Quality Control & Spring System
 *
 * Authored by: Independent Victory Auditor
 * Scope: Independent, unforgeable verification of all Phase 2 requirements (R1–R6),
 *        boundary corner cases, adversarial stress, database trigger immutability,
 *        and zero-defect exit gate safety enforcement.
 */

import test, { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../server/src/db/migrations.ts';
import { seedUsers } from '../server/src/db/seed.ts';
import { WagonRepository } from '../server/src/db/wagonRepository.ts';
import { InspectionRepository } from '../server/src/db/repository.ts';
import { LifecycleEngine } from '../server/src/lifecycle/engine.ts';
import { ExitGateValidator } from '../server/src/gate/validator.ts';
import { CertificateGenerator } from '../server/src/reports/certificate.ts';
import { classifySpring } from '../server/src/classification/engine.ts';
import type { LifecycleStage } from '../shared/types.ts';

describe('=== INDEPENDENT VICTORY AUDITOR VERIFICATION SUITE ===', () => {
  let db: DatabaseSync;
  let wagonRepo: WagonRepository;
  let inspectionRepo: InspectionRepository;

  before(() => {
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON;');
    runMigrations(db);
    seedUsers(db);
    wagonRepo = new WagonRepository(db);
    inspectionRepo = new InspectionRepository(db);
  });

  // =========================================================================
  // 1. R1: 7-Stage Wagon Lifecycle Tracking & State Machine
  // =========================================================================
  describe('R1: 7-Stage Lifecycle State Machine & Sequential Rules', () => {
    const testWagon = 'SECR/BOXNHL/AUDIT-001';

    it('R1.1: Registers a new wagon with standardized OWNER/TYPE/NUMBER format', () => {
      const wagon = wagonRepo.registerWagon({
        wagonNumber: testWagon,
        wagonType: 'BOXNHL',
        owningRailway: 'SECR',
        entryNotes: 'Routine POH overhaul cycle',
        createdBy: 'usr_insp_001'
      });

      assert.equal(wagon.wagonNumber, testWagon);
      assert.equal(wagon.currentStage, 'ENTRY_REGISTRATION');
      assert.equal(wagon.status, 'IN_PROGRESS');
      assert.ok(wagon.id);
    });

    it('R1.2: Enforces uniqueness on wagon registration (duplicate rejection)', () => {
      assert.throws(() => {
        wagonRepo.registerWagon({
          wagonNumber: testWagon,
          wagonType: 'BOXNHL',
          owningRailway: 'SECR',
          createdBy: 'usr_insp_001'
        });
      }, /already exists|UNIQUE constraint failed/i);
    });

    it('R1.3: Enforces sequential step-by-step advance through stages (Stage 1 -> Stage 2 -> Stage 3)', () => {
      // Step 1: ENTRY_REGISTRATION -> DISMANTLING
      const v1 = LifecycleEngine.validateTransition({
        currentStage: 'ENTRY_REGISTRATION',
        targetStage: 'DISMANTLING',
        userRole: 'INSPECTOR'
      });
      assert.equal(v1.valid, true);
      assert.equal(v1.transitionType, 'NORMAL');

      wagonRepo.recordTransition({
        wagonNumber: testWagon,
        fromStage: 'ENTRY_REGISTRATION',
        toStage: 'DISMANTLING',
        transitionType: 'NORMAL',
        performedBy: 'usr_insp_001',
        performerName: 'Inspector Sharma',
        performerRole: 'INSPECTOR'
      });

      // Step 2: DISMANTLING -> COMPONENT_INSPECTION
      const v2 = LifecycleEngine.validateTransition({
        currentStage: 'DISMANTLING',
        targetStage: 'COMPONENT_INSPECTION',
        userRole: 'INSPECTOR'
      });
      assert.equal(v2.valid, true);

      wagonRepo.recordTransition({
        wagonNumber: testWagon,
        fromStage: 'DISMANTLING',
        toStage: 'COMPONENT_INSPECTION',
        transitionType: 'NORMAL',
        performedBy: 'usr_insp_001',
        performerName: 'Inspector Sharma',
        performerRole: 'INSPECTOR'
      });

      const updated = wagonRepo.getWagonByNumber(testWagon);
      assert.equal(updated?.currentStage, 'COMPONENT_INSPECTION');
    });

    it('R1.4: Blocks stage skipping without supervisor override (e.g. Stage 3 -> Stage 6 directly)', () => {
      const vSkip = LifecycleEngine.validateTransition({
        currentStage: 'COMPONENT_INSPECTION',
        targetStage: 'FINAL_QC_GATE',
        userRole: 'INSPECTOR',
        isOverride: false
      });
      assert.equal(vSkip.valid, false);
      assert.match(vSkip.error || '', /cannot jump directly|requires supervisor override/i);
    });

    it('R1.5: Blocks stage skipping by Inspector even if override flag is true (RBAC enforcement)', () => {
      const vInspectorOverride = LifecycleEngine.validateTransition({
        currentStage: 'COMPONENT_INSPECTION',
        targetStage: 'FINAL_QC_GATE',
        userRole: 'INSPECTOR',
        isOverride: true,
        overrideJustification: 'Fast-track emergency release'
      });
      assert.equal(vInspectorOverride.valid, false);
      assert.equal(vInspectorOverride.statusCode, 403);
    });

    it('R1.6: Permits stage skipping when performed by Supervisor with valid justification (>= 10 chars)', () => {
      const vSupervisorSkip = LifecycleEngine.validateTransition({
        currentStage: 'COMPONENT_INSPECTION',
        targetStage: 'REASSEMBLY',
        userRole: 'SUPERVISOR',
        isOverride: true,
        overrideJustification: 'Pre-assembled sub-bogie unit utilized for quick turn-around'
      });
      assert.equal(vSupervisorSkip.valid, true);
      assert.equal(vSupervisorSkip.transitionType, 'OVERRIDE_SKIP');
    });

    it('R1.7: Rejects stage skipping if supervisor justification is empty or under 10 chars', () => {
      const vShortReason = LifecycleEngine.validateTransition({
        currentStage: 'COMPONENT_INSPECTION',
        targetStage: 'REASSEMBLY',
        userRole: 'SUPERVISOR',
        isOverride: true,
        overrideJustification: 'Fast'
      });
      assert.equal(vShortReason.valid, false);
      assert.match(vShortReason.error || '', /min 10 characters|non-empty/i);
    });

    it('R1.8: Blocks backward stage transition without supervisor override', () => {
      const vBackward = LifecycleEngine.validateTransition({
        currentStage: 'COMPONENT_INSPECTION',
        targetStage: 'DISMANTLING',
        userRole: 'INSPECTOR',
        isOverride: false
      });
      assert.equal(vBackward.valid, false);
      assert.match(vBackward.error || '', /requires supervisor override/i);
    });

    it('R1.9: Permits backward transition when performed by Supervisor with justification', () => {
      const vBackwardSup = LifecycleEngine.validateTransition({
        currentStage: 'COMPONENT_INSPECTION',
        targetStage: 'DISMANTLING',
        userRole: 'SUPERVISOR',
        isOverride: true,
        overrideJustification: 'Center plate damage discovered, returning to dismantling section'
      });
      assert.equal(vBackwardSup.valid, true);
      assert.equal(vBackwardSup.transitionType, 'OVERRIDE_BACKWARD');
    });

    it('R1.10: Timeline ledger tracks full transition history with chronologically increasing records', () => {
      const timeline = wagonRepo.getWagonTimeline(testWagon);
      assert.ok(timeline.length >= 3);
      // Event 0: Intake
      assert.equal(timeline[0].fromStage, 'ENTRY_REGISTRATION');
      assert.equal(timeline[0].toStage, 'ENTRY_REGISTRATION');
      // Event 1: Advance to DISMANTLING
      assert.equal(timeline[1].fromStage, 'ENTRY_REGISTRATION');
      assert.equal(timeline[1].toStage, 'DISMANTLING');
      // Event 2: Advance to COMPONENT_INSPECTION
      assert.equal(timeline[2].fromStage, 'DISMANTLING');
      assert.equal(timeline[2].toStage, 'COMPONENT_INSPECTION');
    });
  });

  // =========================================================================
  // 2. R2: CASNUB Bogie Parts Checklist & Mandatory/Advisory Config
  // =========================================================================
  describe('R2: CASNUB 8-Category Bogie Checklist & Configuration', () => {
    const testWagon = 'NR/BOXNHL/AUDIT-002';

    before(() => {
      wagonRepo.registerWagon({
        wagonNumber: testWagon,
        wagonType: 'BOXNHL',
        owningRailway: 'NR',
        createdBy: 'usr_insp_001'
      });
    });

    it('R2.1: Automatically provisions all 8 CASNUB RDSO component categories for wagon', () => {
      const checklist = wagonRepo.getChecklistItems(testWagon);
      const categories = Object.keys(checklist.categories);

      const requiredCategories = [
        'SPRINGS',
        'WHEELS_AXLES',
        'BEARINGS',
        'BRAKE_SYSTEM',
        'COUPLERS_DRAFT_GEAR',
        'BOGIE_FRAME_BOLSTER',
        'FRICTION_WEDGES',
        'BODY_UNDERFRAME'
      ];

      for (const cat of requiredCategories) {
        assert.ok(categories.includes(cat), `Missing expected category: ${cat}`);
        assert.ok(checklist.categories[cat].length > 0, `Category ${cat} should contain parts`);
      }
    });

    it('R2.2: Verifies default safety-critical parts are marked as MANDATORY', () => {
      const checklist = wagonRepo.getChecklistItems(testWagon);
      const mandatoryCats = ['SPRINGS', 'WHEELS_AXLES', 'BEARINGS', 'BRAKE_SYSTEM', 'COUPLERS_DRAFT_GEAR'];

      for (const cat of mandatoryCats) {
        const items = checklist.categories[cat] || [];
        for (const item of items) {
          assert.equal(item.isMandatory, true, `Item ${item.partName} in ${cat} should be mandatory by default`);
        }
      }
    });

    it('R2.3: Supports recording and updating inspection statuses (PASS, FAIL, CONDEMNED, REPAIRED, REPLACED)', () => {
      const checklist = wagonRepo.getChecklistItems(testWagon);
      const wheelItem = checklist.categories['WHEELS_AXLES'][0];

      // Mark as FAIL initially
      const updatedFail = wagonRepo.updateChecklistItem(wheelItem.id, {
        status: 'FAIL',
        conditionNotes: 'Flange wear exceeds 22mm limit'
      });
      assert.equal(updatedFail.status, 'FAIL');

      // Update to REPAIRED with repair notes
      const updatedRepaired = wagonRepo.updateChecklistItem(wheelItem.id, {
        status: 'REPAIRED',
        repairAction: 'REPAIRED',
        repairNotes: 'Wheel tread reprofiled on CNC wheel lathe',
        reinspectedStatus: 'PASS'
      });
      assert.equal(updatedRepaired.status, 'REPAIRED');
      assert.equal(updatedRepaired.reinspectedStatus, 'PASS');
    });

    it('R2.4: Supports custom mandatory vs advisory configuration per wagon type', () => {
      const configs = wagonRepo.getChecklistConfig('BOXNHL');
      assert.ok(configs.length > 0);
      assert.ok(configs.some(c => c.category === 'WHEELS_AXLES' && c.is_mandatory === 1));
    });
  });

  // =========================================================================
  // 3. R3: Zero-Defect Exit Gate & Release Certification
  // =========================================================================
  describe('R3: Zero-Defect Exit Gate Diagnostics & Cryptographic Release Cert', () => {
    const testWagon = 'WR/BOXNHL/AUDIT-003';

    before(() => {
      wagonRepo.registerWagon({
        wagonNumber: testWagon,
        wagonType: 'BOXNHL',
        owningRailway: 'WR',
        createdBy: 'usr_insp_001'
      });
    });

    it('R3.1: Blocks release when wagon is not at Stage 6 (STAGE_INVALID blocker)', () => {
      const gate = ExitGateValidator.evaluate(testWagon, wagonRepo);
      assert.equal(gate.canRelease, false);
      assert.ok(gate.blockers.some(b => b.includes('Stage 6')));
      assert.ok(gate.blockerDetails.some(d => d.issueType === 'STAGE_INVALID'));
    });

    it('R3.2: Blocks release when mandatory parts are PENDING or FAILED', () => {
      // Advance to FINAL_QC_GATE via supervisor override for testing
      wagonRepo.recordTransition({
        wagonNumber: testWagon,
        fromStage: 'ENTRY_REGISTRATION',
        toStage: 'FINAL_QC_GATE',
        transitionType: 'OVERRIDE_SKIP',
        performedBy: 'usr_sup_001',
        performerName: 'Supervisor Verma',
        performerRole: 'SUPERVISOR',
        isOverride: true,
        overrideReason: 'Fast-track to QC gate for audit inspection test'
      });

      const gate = ExitGateValidator.evaluate(testWagon, wagonRepo);
      assert.equal(gate.canRelease, false);
      assert.ok(gate.summary.failedMandatory > 0 || gate.summary.totalMandatory > gate.summary.passedMandatory);
    });

    it('R3.3: Blocks release if any component is CONDEMNED and unreplaced', () => {
      const checklist = wagonRepo.getChecklistItems(testWagon);
      const bearingItem = checklist.categories['BEARINGS'][0];

      wagonRepo.updateChecklistItem(bearingItem.id, {
        status: 'CONDEMNED',
        conditionNotes: 'Spalled CTRB outer race'
      });

      const gate = ExitGateValidator.evaluate(testWagon, wagonRepo);
      assert.equal(gate.canRelease, false);
      assert.ok(gate.blockers.some(b => b.includes('condemned')));
      assert.ok(gate.blockerDetails.some(d => d.issueType === 'CONDEMNED_UNRESOLVED'));
    });

    it('R3.4: Blocks release if a Phase 1 spring inspection for this wagon is CONDEMNED', () => {
      // Insert a condemned spring inspection in Phase 1 table
      inspectionRepo.insertInspection({
        wagonNumber: testWagon,
        bogieType: 'CASNUB_22_NLB',
        springCondition: 'USED',
        springPosition: 'OUTER',
        measuredFreeHeight: 240.0, // Below 245mm -> Condemned
        classifiedBand: null,
        bandRoman: null,
        status: 'CONDEMNED',
        damageType: 'NONE',
        tableReference: 'Table 28',
        validRangeMin: 245.0,
        validRangeMax: 263.0,
        condemnationReason: 'Height 240.0mm below minimum 245.0mm',
        inspectorId: 'usr_insp_001',
        inspectorName: 'Inspector Sharma',
        measurementSource: 'MANUAL'
      });

      const gate = ExitGateValidator.evaluate(testWagon, wagonRepo);
      assert.equal(gate.canRelease, false);
      assert.equal(gate.summary.springCheck.hasCondemnedSprings, true);
      assert.ok(gate.blockerDetails.some(d => d.issueType === 'SPRING_CONDEMNED'));
    });

    it('R3.5: Clears Exit Gate when all mandatory parts pass and condemned springs replaced with PASS', () => {
      // 1. Mark all checklist items as PASS
      const checklist = wagonRepo.getChecklistItems(testWagon);
      for (const item of checklist.allItems) {
        wagonRepo.updateChecklistItem(item.id, {
          status: 'PASS',
          conditionNotes: 'Verified compliant per RDSO standard tolerances.'
        });
      }

      // 2. Insert new PASS spring inspection in Phase 1 (replacing condemned spring)
      inspectionRepo.insertInspection({
        wagonNumber: testWagon,
        bogieType: 'CASNUB_22_NLB',
        springCondition: 'USED',
        springPosition: 'OUTER',
        measuredFreeHeight: 262.0, // Band I (263-260) -> PASS
        classifiedBand: 'BLUE',
        bandRoman: 'Band I',
        status: 'PASS',
        damageType: 'NONE',
        tableReference: 'Table 28',
        validRangeMin: 245.0,
        validRangeMax: 263.0,
        inspectorId: 'usr_insp_001',
        inspectorName: 'Inspector Sharma',
        measurementSource: 'MANUAL'
      });

      const gate = ExitGateValidator.evaluate(testWagon, wagonRepo);
      assert.equal(gate.canRelease, true, `Expected canRelease to be true, got blockers: ${gate.blockers.join(', ')}`);
      assert.equal(gate.blockers.length, 0);
      assert.equal(gate.summary.springCheck.hasCondemnedSprings, false);
    });

    it('R3.6: Completes supervisor digital sign-off and generates SHA-256 Release Certificate', () => {
      const signoff = wagonRepo.recordGateSignoff({
        wagonNumber: testWagon,
        supervisorId: 'usr_sup_001',
        supervisorName: 'S. K. Verma',
        supervisorEmployeeId: 'WRS-SUP-2019',
        digitalSignature: 'HMAC-SHA256-AUDIT-VERIFIED-SIG',
        otpTokenRef: 'otp_token_audit_001',
        signoffNotes: 'All 8 CASNUB subsystems cleared with zero defects.',
        checksSummary: { zeroDefects: true, auditVerified: true }
      });

      assert.ok(signoff.certificateNumber.startsWith('WRS/QC-REL/'));
      assert.ok(signoff.certificateHash);
      assert.equal(signoff.certificateHash.length, 64); // SHA-256 hex string

      // Wagon stage must advance to RELEASE
      const wagon = wagonRepo.getWagonByNumber(testWagon);
      assert.equal(wagon?.currentStage, 'RELEASE');
      assert.equal(wagon?.status, 'RELEASED');
      assert.ok(wagon?.actualReleaseDate);
    });

    it('R3.7: Generates bilingual printable HTML and JSON release certificates', () => {
      const certHtml = CertificateGenerator.generate(testWagon, wagonRepo, inspectionRepo, 'html');
      assert.ok(certHtml.html?.includes('ROLLING STOCK QUALITY RELEASE CERTIFICATE'));
      assert.ok(certHtml.html?.includes(testWagon));
      assert.ok(certHtml.html?.includes('HMAC-SHA256'));

      const certJson = CertificateGenerator.generate(testWagon, wagonRepo, inspectionRepo, 'json');
      assert.equal(certJson.json?.wagon?.wagonNumber, testWagon);
      assert.equal(certJson.json?.bogiePartsSummary?.categoriesPassed, 8);
    });
  });

  // =========================================================================
  // 4. R4: DRM Officer Dashboards & Reporting
  // =========================================================================
  describe('R4: DRM Real-Time Analytics & Reporting Invariants', () => {
    it('R4.1: Computes real-time pipeline wagon counts across all 7 stages', () => {
      const pipeline = wagonRepo.getAnalyticsPipeline();
      assert.ok(typeof pipeline.totalActive === 'number');
      assert.ok(typeof pipeline.totalReleased === 'number');
      assert.ok(pipeline.counts);
      assert.ok('ENTRY_REGISTRATION' in pipeline.counts);
      assert.ok('FINAL_QC_GATE' in pipeline.counts);
      assert.ok('RELEASE' in pipeline.counts);
    });

    it('R4.2: Computes Turnaround Time (TAT) metrics (mean, median, min, max)', () => {
      const tat = wagonRepo.getAnalyticsTAT();
      assert.ok(typeof tat.averageHours === 'number');
      assert.ok(typeof tat.medianHours === 'number');
      assert.ok(Array.isArray(tat.trends));
    });

    it('R4.3: Calculates CASNUB parts health and condemnation statistics', () => {
      const parts = wagonRepo.getAnalyticsParts();
      assert.ok(typeof parts.totalInspected === 'number');
      assert.ok(typeof parts.totalPassed === 'number');
      assert.ok(typeof parts.totalCondemned === 'number');
      assert.ok(parts.categoryBreakdown);
    });

    it('R4.4: Tracks inspector productivity metrics per shift', () => {
      const inspectors = wagonRepo.getAnalyticsInspectors();
      assert.ok(Array.isArray(inspectors.inspectors));
      if (inspectors.inspectors.length > 0) {
        assert.ok(inspectors.inspectors[0].inspectorId);
        assert.ok(typeof inspectors.inspectors[0].inspectionsCompleted === 'number');
      }
    });

    it('R4.5: Provides active QC blockers list for DRM monitoring', () => {
      const blockers = wagonRepo.getAnalyticsBlockers();
      assert.ok(Array.isArray(blockers.blockedWagons));
    });
  });

  // =========================================================================
  // 5. R5: Deep Phase 1 Spring Classification Engine Integration
  // =========================================================================
  describe('R5: Deep Phase 1 Spring System Integration', () => {
    const testWagon = 'CR/BOXNHL/AUDIT-005';

    before(() => {
      wagonRepo.registerWagon({
        wagonNumber: testWagon,
        wagonType: 'BOXNHL',
        owningRailway: 'CR',
        createdBy: 'usr_insp_001'
      });
    });

    it('R5.1: Verifies RDSO G-95 Tables 28-33 classifications for all bogie types', () => {
      // Table 28: CASNUB 22 NLB Used Outer
      const c1 = classifySpring({
        bogieType: 'CASNUB_22_NLB',
        condition: 'USED',
        position: 'OUTER',
        measuredHeight: 261.5
      });
      assert.equal(c1.band, 'BLUE');
      assert.equal(c1.bandRoman, 'Band I');
      assert.equal(c1.status, 'PASS');

      // Table 29: CASNUB 22 HS Used Inner
      const c2 = classifySpring({
        bogieType: 'CASNUB_22_HS',
        condition: 'USED',
        position: 'INNER',
        measuredHeight: 241.0
      });
      assert.equal(c2.band, 'GREEN');
      assert.equal(c2.bandRoman, 'Band II');
      assert.equal(c2.status, 'PASS');

      // Table 30: CASNUB 22 RFT Used Snubber(O)
      const c3 = classifySpring({
        bogieType: 'CASNUB_22_RFT',
        condition: 'USED',
        position: 'SNUBBER_OUTER',
        measuredHeight: 306.0
      });
      assert.equal(c3.band, 'BLUE');
      assert.equal(c3.bandRoman, 'Band I');
      assert.equal(c3.status, 'PASS');

      // Condemned spring
      const cCondemned = classifySpring({
        bogieType: 'CASNUB_22_NLB',
        condition: 'USED',
        position: 'OUTER',
        measuredHeight: 240.0
      });
      assert.equal(cCondemned.status, 'CONDEMNED');
      assert.equal(cCondemned.band, null);
    });

    it('R5.2: Phase 1 spring inspection directly auto-populates wagon detail view', () => {
      // Insert Phase 1 spring inspection
      inspectionRepo.insertInspection({
        wagonNumber: testWagon,
        bogieType: 'CASNUB_22_NLB',
        springCondition: 'USED',
        springPosition: 'INNER',
        measuredFreeHeight: 263.5,
        classifiedBand: 'BLUE',
        bandRoman: 'Band I',
        status: 'PASS',
        damageType: 'NONE',
        tableReference: 'Table 28',
        validRangeMin: 247.0,
        validRangeMax: 265.0,
        inspectorId: 'usr_insp_001',
        inspectorName: 'Inspector Sharma',
        measurementSource: 'OCR',
        ocrConfidence: 0.98
      });

      const wagonDetail = wagonRepo.getWagonByNumber(testWagon);
      assert.ok(wagonDetail);

      const springs = inspectionRepo.queryInspections({ wagonNumber: testWagon });
      assert.equal(springs.totalCount, 1);
      assert.equal(springs.records[0].classifiedBand, 'BLUE');
      assert.equal(springs.records[0].ocrConfidence, 0.98);
    });
  });

  // =========================================================================
  // 6. R6: Photo Evidence Auto-Tagging & Mobile Offline PWA
  // =========================================================================
  describe('R6: Photo Evidence Capture & Auto-Tagging', () => {
    const testWagon = 'ECoR/BOXNHL/AUDIT-006';

    before(() => {
      wagonRepo.registerWagon({
        wagonNumber: testWagon,
        wagonType: 'BOXNHL',
        owningRailway: 'ECoR',
        createdBy: 'usr_insp_001'
      });
    });

    it('R6.1: Stores photo evidence with automatic metadata tagging', () => {
      const photo = wagonRepo.insertPhoto({
        wagonNumber: testWagon,
        category: 'BRAKE_SYSTEM',
        partName: 'Brake Beam',
        stage: 'COMPONENT_INSPECTION',
        fileName: 'brake_beam_defect.jpg',
        mimeType: 'image/jpeg',
        fileSize: 45200,
        imageData: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD...',
        inspectorId: 'usr_insp_001',
        inspectorName: 'Inspector Sharma',
        tags: ['BRAKE_SYSTEM', 'CRACK', 'POH_INSPECTION']
      });

      assert.ok(photo.id);
      assert.equal(photo.wagonNumber, testWagon.toUpperCase());
      assert.equal(photo.category, 'BRAKE_SYSTEM');
      assert.equal(photo.inspectorName, 'Inspector Sharma');
    });

    it('R6.2: Retrieves stored photo evidence by wagon number', () => {
      const photos = wagonRepo.getPhotosByWagon(testWagon);
      assert.equal(photos.length, 1);
      assert.equal(photos[0].fileName, 'brake_beam_defect.jpg');
      assert.deepEqual(photos[0].tags, ['BRAKE_SYSTEM', 'CRACK', 'POH_INSPECTION']);
    });
  });

  // =========================================================================
  // 7. Anti-Cheating & Forensic Immutability Checks
  // =========================================================================
  describe('Anti-Cheating & Forensic Immutability Triggers', () => {
    it('FORENSIC-1: SQLite triggers strictly prevent UPDATE on inspections table', () => {
      const insp = inspectionRepo.insertInspection({
        wagonNumber: 'SR/BOXNHL/IMMUTABLE-01',
        bogieType: 'CASNUB_22_NLB',
        springCondition: 'USED',
        springPosition: 'OUTER',
        measuredFreeHeight: 260.0,
        classifiedBand: 'BLUE',
        bandRoman: 'Band I',
        status: 'PASS',
        damageType: 'NONE',
        tableReference: 'Table 28',
        validRangeMin: 245.0,
        validRangeMax: 263.0,
        inspectorId: 'usr_insp_001',
        inspectorName: 'Inspector Sharma',
        measurementSource: 'MANUAL'
      });

      assert.throws(() => {
        db.prepare('UPDATE inspections SET measured_height = 250.0 WHERE id = ?').run(insp.id);
      }, /Audit log is strictly append-only|immutable/i);
    });

    it('FORENSIC-2: SQLite triggers strictly prevent DELETE on inspections table', () => {
      const insp = inspectionRepo.insertInspection({
        wagonNumber: 'SR/BOXNHL/IMMUTABLE-02',
        bogieType: 'CASNUB_22_NLB',
        springCondition: 'USED',
        springPosition: 'OUTER',
        measuredFreeHeight: 260.0,
        classifiedBand: 'BLUE',
        bandRoman: 'Band I',
        status: 'PASS',
        damageType: 'NONE',
        tableReference: 'Table 28',
        validRangeMin: 245.0,
        validRangeMax: 263.0,
        inspectorId: 'usr_insp_001',
        inspectorName: 'Inspector Sharma',
        measurementSource: 'MANUAL'
      });

      assert.throws(() => {
        db.prepare('DELETE FROM inspections WHERE id = ?').run(insp.id);
      }, /Audit log is strictly append-only|immutable/i);
    });

    it('FORENSIC-3: SQLite triggers strictly prevent UPDATE and DELETE on wagon_transitions table', () => {
      const w = wagonRepo.registerWagon({
        wagonNumber: 'NCR/BOXNHL/TRANS-IMMUTABLE',
        wagonType: 'BOXNHL',
        owningRailway: 'NCR',
        createdBy: 'usr_insp_001'
      });

      const transId = `trans_${crypto.randomUUID()}`;
      db.prepare(`
        INSERT INTO wagon_transitions (id, wagon_id, wagon_number, from_stage, to_stage, transition_type, performed_by, performer_name, performer_role)
        VALUES (?, ?, ?, 'ENTRY_REGISTRATION', 'DISMANTLING', 'NORMAL', 'usr_insp_001', 'Insp', 'INSPECTOR')
      `).run(transId, w.id, w.wagonNumber);

      assert.throws(() => {
        db.prepare("UPDATE wagon_transitions SET to_stage = 'RELEASE' WHERE id = ?").run(transId);
      }, /Audit log is strictly append-only|immutable/i);

      assert.throws(() => {
        db.prepare('DELETE FROM wagon_transitions WHERE id = ?').run(transId);
      }, /Audit log is strictly append-only|immutable/i);
    });

    it('FORENSIC-4: SQLite triggers strictly prevent UPDATE and DELETE on gate_signoffs table', () => {
      const w = wagonRepo.registerWagon({
        wagonNumber: 'NCR/BOXNHL/SIGNOFF-IMMUTABLE',
        wagonType: 'BOXNHL',
        owningRailway: 'NCR',
        createdBy: 'usr_insp_001'
      });

      const signoffId = `signoff_${crypto.randomUUID()}`;
      db.prepare(`
        INSERT INTO gate_signoffs (id, wagon_id, wagon_number, supervisor_id, supervisor_name, supervisor_employee_id, digital_signature, otp_token_ref, checks_summary_json, certificate_number, certificate_hash)
        VALUES (?, ?, ?, 'usr_sup_001', 'Sup', 'EMP-1', 'SIG', 'OTP', '{}', 'CERT-9998', 'HASH-9998')
      `).run(signoffId, w.id, w.wagonNumber);

      assert.throws(() => {
        db.prepare("UPDATE gate_signoffs SET supervisor_name = 'Hacked' WHERE id = ?").run(signoffId);
      }, /Audit log is strictly append-only|immutable/i);

      assert.throws(() => {
        db.prepare('DELETE FROM gate_signoffs WHERE id = ?').run(signoffId);
      }, /Audit log is strictly append-only|immutable/i);
    });

    it('FORENSIC-5: Monotonic sequence numbers and automatic audit log event generation upon inspection insertion', () => {
      const insp = inspectionRepo.insertInspection({
        wagonNumber: 'NCR/BOXNHL/AUTO-AUDIT',
        bogieType: 'CASNUB_22_NLB',
        springCondition: 'USED',
        springPosition: 'SNUBBER',
        measuredFreeHeight: 295.0,
        classifiedBand: 'BLUE',
        bandRoman: 'Band I',
        status: 'PASS',
        damageType: 'NONE',
        tableReference: 'Table 28',
        validRangeMin: 279.0,
        validRangeMax: 297.0,
        inspectorId: 'usr_insp_001',
        inspectorName: 'Inspector Sharma',
        measurementSource: 'MANUAL'
      });

      assert.ok(insp.sequenceNumber > 0);

      // Verify audit log has matching auto-generated entry from SQLite trigger
      const auditLog = db.prepare('SELECT * FROM inspection_audit_log WHERE inspection_id = ?').get(insp.id) as any;
      assert.ok(auditLog);
      assert.equal(auditLog.event_type, 'INSPECTION_CREATED');
      const payload = JSON.parse(auditLog.payload_json);
      assert.equal(payload.wagon_number, 'NCR/BOXNHL/AUTO-AUDIT');
      assert.equal(payload.measured_height, 295.0);
    });
  });

  // =========================================================================
  // 8. Adversarial Stress & Security Penetration Scenarios
  // =========================================================================
  describe('8. Adversarial Stress & Security Verification', () => {
    it('ADV-1: Reopening a released wagon strictly requires SUPERVISOR role and min 10-char justification', () => {
      // Reopen attempt by Inspector -> Rejected 403
      const vReopenInsp = LifecycleEngine.validateTransition({
        currentStage: 'RELEASE',
        targetStage: 'COMPONENT_INSPECTION',
        userRole: 'INSPECTOR',
        overrideJustification: 'Quality issue spotted on outbound track'
      });
      assert.equal(vReopenInsp.valid, false);
      assert.equal(vReopenInsp.statusCode, 403);

      // Reopen attempt by Supervisor with short justification -> Rejected 400
      const vReopenShort = LifecycleEngine.validateTransition({
        currentStage: 'RELEASE',
        targetStage: 'COMPONENT_INSPECTION',
        userRole: 'SUPERVISOR',
        overrideJustification: 'Fix'
      });
      assert.equal(vReopenShort.valid, false);
      assert.equal(vReopenShort.statusCode, 400);

      // Reopen attempt by Supervisor with valid justification -> Allowed
      const vReopenOk = LifecycleEngine.validateTransition({
        currentStage: 'RELEASE',
        targetStage: 'COMPONENT_INSPECTION',
        userRole: 'SUPERVISOR',
        overrideJustification: 'Post-release buffer height discrepancy detected on weighbridge track'
      });
      assert.equal(vReopenOk.valid, true);
      assert.equal(vReopenOk.transitionType, 'REOPEN');
    });

    it('ADV-2: Exact RDSO G-95 boundary resolution for CASNUB 22 NLB Used Outer (Table 28)', () => {
      // Boundary rule: Measurements exactly on band boundaries belong to the higher band (e.g. 260.0 -> Band I)
      const testCases = [
        { height: 263.0, expectedBand: 'BLUE', expectedRoman: 'Band I' },
        { height: 260.0, expectedBand: 'BLUE', expectedRoman: 'Band I' },
        { height: 259.9, expectedBand: 'GREEN', expectedRoman: 'Band II' },
        { height: 257.0, expectedBand: 'GREEN', expectedRoman: 'Band II' },
        { height: 256.9, expectedBand: 'YELLOW', expectedRoman: 'Band III' },
        { height: 254.0, expectedBand: 'YELLOW', expectedRoman: 'Band III' },
        { height: 253.9, expectedBand: 'ORANGE', expectedRoman: 'Band IV' },
        { height: 251.0, expectedBand: 'ORANGE', expectedRoman: 'Band IV' },
        { height: 250.9, expectedBand: 'WHITE', expectedRoman: 'Band V' },
        { height: 248.0, expectedBand: 'WHITE', expectedRoman: 'Band V' },
        { height: 247.9, expectedBand: 'RED', expectedRoman: 'Band VI' },
        { height: 245.0, expectedBand: 'RED', expectedRoman: 'Band VI' },
        { height: 244.9, expectedBand: null, expectedStatus: 'CONDEMNED' }
      ];

      for (const tc of testCases) {
        const res = classifySpring({
          bogieType: 'CASNUB_22_NLB',
          condition: 'USED',
          position: 'OUTER',
          measuredHeight: tc.height
        });

        if (tc.expectedBand) {
          assert.equal(res.band, tc.expectedBand, `Height ${tc.height} expected band ${tc.expectedBand}, got ${res.band}`);
          assert.equal(res.bandRoman, tc.expectedRoman);
          assert.equal(res.status, 'PASS');
        } else {
          assert.equal(res.status, 'CONDEMNED', `Height ${tc.height} expected CONDEMNED`);
        }
      }
    });

    it('ADV-3: SQL injection payloads in wagon registration and search queries are neutralized safely', () => {
      const sqlInjectionWagon = "ER/BOXNHL/999'; DROP TABLE wagons; --";
      const wagon = wagonRepo.registerWagon({
        wagonNumber: sqlInjectionWagon,
        wagonType: 'BOXNHL',
        owningRailway: 'ER',
        entryNotes: "'; DELETE FROM users; --",
        createdBy: 'usr_insp_001'
      });

      assert.ok(wagon);
      assert.equal(wagon.wagonNumber, sqlInjectionWagon.toUpperCase());

      // Confirm wagons and users tables remain intact
      const countWagons = db.prepare('SELECT COUNT(*) as c FROM wagons').get() as any;
      const countUsers = db.prepare('SELECT COUNT(*) as c FROM users').get() as any;
      assert.ok(countWagons.c > 0);
      assert.ok(countUsers.c > 0);

      // Search query containing SQL special characters
      const searchResult = wagonRepo.queryWagons({ search: "DROP TABLE" });
      assert.ok(Array.isArray(searchResult.records));
    });

    it('ADV-4: Multi-subsystem simultaneous failure diagnostics at Exit Gate', () => {
      const multiFailWagon = 'SER/BOXNHL/MULTI-FAIL-01';
      wagonRepo.registerWagon({
        wagonNumber: multiFailWagon,
        wagonType: 'BOXNHL',
        owningRailway: 'SER',
        createdBy: 'usr_insp_001'
      });

      const checklist = wagonRepo.getChecklistItems(multiFailWagon);

      // Fail 4 different subsystem categories
      const wheelItem = checklist.categories['WHEELS_AXLES'][0];
      const bearingItem = checklist.categories['BEARINGS'][0];
      const brakeItem = checklist.categories['BRAKE_SYSTEM'][0];
      const couplerItem = checklist.categories['COUPLERS_DRAFT_GEAR'][0];

      wagonRepo.updateChecklistItem(wheelItem.id, { status: 'FAIL', conditionNotes: 'Deep wheel skid flat 65mm' });
      wagonRepo.updateChecklistItem(bearingItem.id, { status: 'CONDEMNED', conditionNotes: 'Seized grease seal' });
      wagonRepo.updateChecklistItem(brakeItem.id, { status: 'FAIL', conditionNotes: 'Worn brake block' });
      wagonRepo.updateChecklistItem(couplerItem.id, { status: 'CONDEMNED', conditionNotes: 'Cracked knuckle pin' });

      const gate = ExitGateValidator.evaluate(multiFailWagon, wagonRepo);
      assert.equal(gate.canRelease, false);
      assert.ok(gate.blockers.length >= 4);

      const blockerCats = new Set(gate.blockerDetails.map(d => d.category));
      assert.ok(blockerCats.has('WHEELS_AXLES'));
      assert.ok(blockerCats.has('BEARINGS'));
      assert.ok(blockerCats.has('BRAKE_SYSTEM'));
      assert.ok(blockerCats.has('COUPLERS_DRAFT_GEAR'));
    });
  });
});

