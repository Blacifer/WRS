/**
 * Tier 5 Adversarial Suite — Phase 2 Lifecycle State Machine, Exit Gate & DB Immutability Attacks
 * Indian Railways WRS Raipur (Phase 2 Wagon QC & Spring Inspection System)
 *
 * Empirical verification of:
 * 1. Lifecycle State Machine Attacks: stage skipping, short/empty justifications, backward transitions, direct Stage 7 bypass, reopen.
 * 2. Exit Gate Blocker Stress Testing: pending/failed/condemned components, uncertified repairs, Phase 1 spring condemned, invalid signatures & OTPs.
 * 3. Database Invariant & Immutability Attacks: direct SQLite UPDATE and DELETE statements against wagon_transitions, gate_signoffs, inspections, audit log.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TestApp } from '../../harness/test_app.ts';
import { LifecycleEngine } from '../../../server/src/lifecycle/engine.ts';
import { WagonRepository } from '../../../server/src/db/wagonRepository.ts';
import { ExitGateValidator } from '../../../server/src/gate/validator.ts';
import type { ChecklistItem, LifecycleStage } from '../../../shared/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../..');

describe('Tier 5 Adversarial — Phase 2 Lifecycle State Machine, Exit Gate & DB Immutability', () => {
  let app: TestApp;
  let inspectorToken: string;
  let supervisorToken: string;
  let adminToken: string;

  beforeEach(async () => {
    app = new TestApp(':memory:');

    const inspLogin = await app.post('/api/auth/login', { username: 'inspector1', password: 'password123' });
    inspectorToken = (inspLogin.body as { token: string }).token;

    const supLogin = await app.post('/api/auth/login', { username: 'supervisor1', password: 'password123' });
    supervisorToken = (supLogin.body as { token: string }).token;

    const adminLogin = await app.post('/api/auth/login', { username: 'admin1', password: 'password123' });
    adminToken = (adminLogin.body as { token: string }).token;
  });

  // =========================================================================
  // SECTION 1: Lifecycle State Machine Attacks
  // =========================================================================

  it('TC-ADV-LIFECYCLE-01: Exhaustive non-sequential forward skip matrix without supervisor role is 100% blocked', async () => {
    const w = 'SECR/BOXNHL/SKIP-MAT-01';
    await app.post('/api/wagons/register', { wagonNumber: w, wagonType: 'BOXNHL', owningRailway: 'SECR' }, { Authorization: `Bearer ${inspectorToken}` });

    const stages: LifecycleStage[] = [
      'ENTRY_REGISTRATION',
      'DISMANTLING',
      'COMPONENT_INSPECTION',
      'REPAIR_REPLACEMENT',
      'REASSEMBLY',
      'FINAL_QC_GATE',
      'RELEASE'
    ];

    let attackAttempts = 0;
    let blockedAttempts = 0;

    // Test every skip combination S_i -> S_{i+k} (k > 1) as Inspector
    for (let fromIdx = 0; fromIdx < stages.length; fromIdx++) {
      for (let toIdx = fromIdx + 2; toIdx < stages.length; toIdx++) {
        attackAttempts++;
        const targetStage = stages[toIdx];

        // 1. Direct API test on TestApp
        const res = await app.post(
          `/api/wagons/${encodeURIComponent(w)}/transition`,
          { targetStage, notes: 'Adversarial jump attempt' },
          { Authorization: `Bearer ${inspectorToken}` }
        );

        if (res.status === 400 || res.status === 403 || res.status === 422) {
          blockedAttempts++;
        }

        // 2. Direct Server LifecycleEngine validation
        const serverValidation = LifecycleEngine.validateTransition({
          currentStage: stages[fromIdx],
          targetStage,
          userRole: 'INSPECTOR',
          isOverride: false
        });
        assert.strictEqual(serverValidation.valid, false, `Inspector skip ${stages[fromIdx]} -> ${targetStage} must be invalid`);
      }
    }

    assert.ok(attackAttempts > 0);
    assert.strictEqual(blockedAttempts, attackAttempts, `All ${attackAttempts} skip attempts must be rejected`);
  });

  it('TC-ADV-LIFECYCLE-02: Supervisor override skip with missing, empty, whitespace, or short justifications is rejected', async () => {
    const w = 'NR/BOXNHL/SHORT-JUST-01';
    await app.post('/api/wagons/register', { wagonNumber: w, wagonType: 'BOXNHL', owningRailway: 'NR' }, { Authorization: `Bearer ${inspectorToken}` });

    const emptyAndWhitespaceJustifications = ['', '   ', '\t\n  ', 'ok', 'skip'];

    for (const just of emptyAndWhitespaceJustifications) {
      const res = await app.post(
        `/api/wagons/${encodeURIComponent(w)}/transition`,
        { targetStage: 'REPAIR_REPLACEMENT', supervisorOverride: true, overrideJustification: just },
        { Authorization: `Bearer ${supervisorToken}` }
      );
      assert.strictEqual(res.status, 400, `Justification "${just}" should return 400 Bad Request`);
    }

    // Direct Server LifecycleEngine checks for strict 10-char requirement
    const sub10CharStrings = ['urgent', 'fasttrack', '123456789', 'bypass!'];
    for (const just of sub10CharStrings) {
      const engineRes = LifecycleEngine.validateTransition({
        currentStage: 'ENTRY_REGISTRATION',
        targetStage: 'REPAIR_REPLACEMENT',
        userRole: 'SUPERVISOR',
        isOverride: true,
        overrideJustification: just
      });
      assert.strictEqual(engineRes.valid, false, `LifecycleEngine must reject short justification "${just}"`);
      assert.strictEqual(engineRes.statusCode, 400);
      assert.ok(engineRes.error?.includes('min 10 characters'));
    }
  });

  it('TC-ADV-LIFECYCLE-03: Stage skipping with invalid, forged, or expired OTP action token is rejected', async () => {
    const w = 'WR/BCNHL/OTP-SKIP-01';
    await app.post('/api/wagons/register', { wagonNumber: w, wagonType: 'BCNHL', owningRailway: 'WR' }, { Authorization: `Bearer ${inspectorToken}` });

    const invalidTokens = [
      'FORGED_OTP_TOKEN_999999',
      'expired_token_xyz',
      'action_token_export_only',
      'null',
      '000000'
    ];

    for (const token of invalidTokens) {
      const res = await app.post(
        `/api/wagons/${encodeURIComponent(w)}/transition`,
        {
          targetStage: 'REASSEMBLY',
          supervisorOverride: true,
          overrideJustification: 'Legitimate reason but fraudulent OTP token provided',
          otpToken: token
        },
        { Authorization: `Bearer ${supervisorToken}` }
      );
      assert.ok(res.status === 401 || res.status === 403, `Invalid token "${token}" must return 401/403 (got ${res.status})`);
    }
  });

  it('TC-ADV-LIFECYCLE-04: Exhaustive backward transition matrix without supervisor role or with empty justification is 100% blocked', async () => {
    const w = 'CR/BOBRN/BACK-MAT-01';
    await app.post('/api/wagons/register', { wagonNumber: w, wagonType: 'BOBRN', owningRailway: 'CR' }, { Authorization: `Bearer ${inspectorToken}` });

    const stages: LifecycleStage[] = [
      'ENTRY_REGISTRATION',
      'DISMANTLING',
      'COMPONENT_INSPECTION',
      'REPAIR_REPLACEMENT',
      'REASSEMBLY',
      'FINAL_QC_GATE'
    ];

    // Advance wagon to Stage 6 sequentially
    for (let i = 1; i < stages.length; i++) {
      await app.post(`/api/wagons/${encodeURIComponent(w)}/transition`, { targetStage: stages[i] }, { Authorization: `Bearer ${inspectorToken}` });
    }

    // 1. Inspector attempting every backward jump
    for (let fromIdx = stages.length - 1; fromIdx > 0; fromIdx--) {
      for (let toIdx = fromIdx - 1; toIdx >= 0; toIdx--) {
        const fromStage = stages[fromIdx];
        const toStage = stages[toIdx];

        // Inspector attempt without override
        const inspRes = await app.post(
          `/api/wagons/${encodeURIComponent(w)}/transition`,
          { targetStage: toStage },
          { Authorization: `Bearer ${inspectorToken}` }
        );
        assert.ok(inspRes.status === 400 || inspRes.status === 403, `Inspector backward ${fromStage} -> ${toStage} must be rejected`);

        // Server LifecycleEngine check for Inspector
        const engineInsp = LifecycleEngine.validateTransition({
          currentStage: fromStage,
          targetStage: toStage,
          userRole: 'INSPECTOR',
          isOverride: false
        });
        assert.strictEqual(engineInsp.valid, false);

        // Supervisor attempt with empty justification
        const supEmpty = await app.post(
          `/api/wagons/${encodeURIComponent(w)}/transition`,
          { targetStage: toStage, supervisorOverride: true, overrideJustification: '   ' },
          { Authorization: `Bearer ${supervisorToken}` }
        );
        assert.strictEqual(supEmpty.status, 400, `Supervisor backward with empty justification must return 400`);

        // Server LifecycleEngine check for Supervisor short justification
        const engineSupShort = LifecycleEngine.validateTransition({
          currentStage: fromStage,
          targetStage: toStage,
          userRole: 'SUPERVISOR',
          isOverride: true,
          overrideJustification: 'rework'
        });
        assert.strictEqual(engineSupShort.valid, false);
      }
    }
  });

  it('TC-ADV-LIFECYCLE-05: Direct transition to Stage 7 (RELEASE) bypassing Exit Gate sign-off is rejected', async () => {
    const w = 'SECR/BOXNHL/DIR-REL-01';
    await app.post('/api/wagons/register', { wagonNumber: w, wagonType: 'BOXNHL', owningRailway: 'SECR' }, { Authorization: `Bearer ${inspectorToken}` });

    // Advance to Stage 6
    const forwardStages = ['DISMANTLING', 'COMPONENT_INSPECTION', 'REPAIR_REPLACEMENT', 'REASSEMBLY', 'FINAL_QC_GATE'] as const;
    for (const s of forwardStages) {
      await app.post(`/api/wagons/${encodeURIComponent(w)}/transition`, { targetStage: s }, { Authorization: `Bearer ${inspectorToken}` });
    }

    // 1. Inspector attempting transition to RELEASE
    const inspDirect = await app.post(
      `/api/wagons/${encodeURIComponent(w)}/transition`,
      { targetStage: 'RELEASE', notes: 'Direct transition bypass' },
      { Authorization: `Bearer ${inspectorToken}` }
    );
    assert.strictEqual(inspDirect.status, 422, 'Direct transition to RELEASE without signoff must return 422');

    // 2. Inspector attempting override to RELEASE
    const inspOverride = await app.post(
      `/api/wagons/${encodeURIComponent(w)}/transition`,
      { targetStage: 'RELEASE', supervisorOverride: true, overrideJustification: 'Trying override as inspector' },
      { Authorization: `Bearer ${inspectorToken}` }
    );
    assert.ok(inspOverride.status === 403 || inspOverride.status === 400 || inspOverride.status === 422);

    // 3. Supervisor attempting direct transition without override
    const supNoOverride = await app.post(
      `/api/wagons/${encodeURIComponent(w)}/transition`,
      { targetStage: 'RELEASE', notes: 'Normal advance attempt' },
      { Authorization: `Bearer ${supervisorToken}` }
    );
    assert.strictEqual(supNoOverride.status, 422, 'Supervisor without override flag must be rejected with 422');

    // 4. Server LifecycleEngine check
    const engineRes = LifecycleEngine.validateTransition({
      currentStage: 'FINAL_QC_GATE',
      targetStage: 'RELEASE',
      userRole: 'INSPECTOR',
      isOverride: false
    });
    assert.strictEqual(engineRes.valid, false);
    assert.strictEqual(engineRes.statusCode, 422);
    assert.ok(engineRes.error?.includes('Exit Gate Digital Sign-off endpoint'));
  });

  it('TC-ADV-LIFECYCLE-06: Malformed, non-existent, and SQL injection target stage strings are rejected with 400', async () => {
    const w = 'SECR/BOXNHL/MALFORM-01';
    await app.post('/api/wagons/register', { wagonNumber: w, wagonType: 'BOXNHL', owningRailway: 'SECR' }, { Authorization: `Bearer ${inspectorToken}` });

    const adversarialStages = [
      'NON_EXISTENT_STAGE',
      'STAGE_8',
      'RELEASE_FINAL',
      'DISMANTLE',
      'ENTRY_REG',
      "' OR '1'='1",
      "'; DROP TABLE wagons; --",
      '<script>alert(1)</script>',
      '',
      '   '
    ];

    for (const badStage of adversarialStages) {
      const res = await app.post(
        `/api/wagons/${encodeURIComponent(w)}/transition`,
        { targetStage: badStage },
        { Authorization: `Bearer ${supervisorToken}` }
      );
      assert.strictEqual(res.status, 400, `Target stage "${badStage}" must be rejected with 400`);

      const engineCheck = LifecycleEngine.validateTransition({
        currentStage: 'ENTRY_REGISTRATION',
        targetStage: badStage as any,
        userRole: 'SUPERVISOR'
      });
      assert.strictEqual(engineCheck.valid, false);
      assert.strictEqual(engineCheck.statusCode, 400);
    }
  });

  it('TC-ADV-LIFECYCLE-07: Unauthenticated and forged JWT transition requests return 401 Unauthorized', async () => {
    const w = 'SECR/BOXNHL/UNAUTH-01';
    await app.post('/api/wagons/register', { wagonNumber: w, wagonType: 'BOXNHL', owningRailway: 'SECR' }, { Authorization: `Bearer ${inspectorToken}` });

    // Missing token
    const noAuth = await app.post(`/api/wagons/${encodeURIComponent(w)}/transition`, { targetStage: 'DISMANTLING' });
    assert.strictEqual(noAuth.status, 401);

    // Forged token
    const forgedAuth = await app.post(
      `/api/wagons/${encodeURIComponent(w)}/transition`,
      { targetStage: 'DISMANTLING' },
      { Authorization: 'Bearer forged.jwt.token.signature' }
    );
    assert.strictEqual(forgedAuth.status, 401);
  });

  // =========================================================================
  // SECTION 2: Exit Gate Blocker Stress Testing
  // =========================================================================

  it('TC-ADV-GATE-01: Premature sign-off on wagons at Stage 1 through Stage 5 is rejected with 422 and blocker details', async () => {
    const stagesBeforeFinalQC: LifecycleStage[] = [
      'ENTRY_REGISTRATION',
      'DISMANTLING',
      'COMPONENT_INSPECTION',
      'REPAIR_REPLACEMENT',
      'REASSEMBLY'
    ];

    for (let idx = 0; idx < stagesBeforeFinalQC.length; idx++) {
      const stage = stagesBeforeFinalQC[idx];
      const w = `NR/BOXNHL/PREMATURE-${idx}`;
      await app.post('/api/wagons/register', { wagonNumber: w, wagonType: 'BOXNHL', owningRailway: 'NR' }, { Authorization: `Bearer ${inspectorToken}` });

      // Advance up to current stage
      for (let s = 1; s <= idx; s++) {
        await app.post(`/api/wagons/${encodeURIComponent(w)}/transition`, { targetStage: stagesBeforeFinalQC[s] }, { Authorization: `Bearer ${inspectorToken}` });
      }

      // Check gate status
      const gateStatus = await app.get(`/api/wagons/${encodeURIComponent(w)}/gate/status`, { Authorization: `Bearer ${supervisorToken}` });
      const body = gateStatus.body as { canRelease: boolean; blockers: string[] };
      assert.strictEqual(body.canRelease, false, `Wagon at ${stage} must NOT be release-eligible`);
      assert.ok(body.blockers.length > 0, `Blockers must be present for premature stage ${stage}`);

      // Attempt sign-off
      const signoffRes = await app.post(
        `/api/wagons/${encodeURIComponent(w)}/gate/signoff`,
        { supervisorId: 'supervisor1', digitalSignature: 'SIG-PREMATURE-TEST' },
        { Authorization: `Bearer ${supervisorToken}` }
      );
      assert.strictEqual(signoffRes.status, 422, `Signoff at ${stage} must return 422`);
    }

    // Direct Server ExitGateValidator check for Stage Prerequisite blocker
    const rawDb = new DatabaseSync(':memory:');
    const schemaSql = fs.readFileSync(path.join(PROJECT_ROOT, 'server/src/db/schema.sql'), 'utf-8');
    rawDb.exec(schemaSql);
    const wagonRepo = new WagonRepository(rawDb);
    wagonRepo.registerWagon({ wagonNumber: 'CR/BOXNHL/STAGE-CHK-01', wagonType: 'BOXNHL', owningRailway: 'CR' });

    const serverGateEval = ExitGateValidator.evaluate('CR/BOXNHL/STAGE-CHK-01', wagonRepo);
    assert.strictEqual(serverGateEval.canRelease, false);
    assert.ok(serverGateEval.blockers.some(b => b.includes('must reach Stage 6') || b.includes('ENTRY_REGISTRATION')));
    assert.ok(serverGateEval.blockerDetails.some(d => d.issueType === 'STAGE_INVALID'));
  });

  it('TC-ADV-GATE-02: Exit gate sign-off is blocked by PENDING mandatory items across all 8 RDSO categories', async () => {
    const w = 'SECR/BOXNHL/PENDING-TEST';
    await app.post('/api/wagons/register', { wagonNumber: w, wagonType: 'BOXNHL', owningRailway: 'SECR' }, { Authorization: `Bearer ${inspectorToken}` });

    // Advance to Stage 6
    const forwardStages = ['DISMANTLING', 'COMPONENT_INSPECTION', 'REPAIR_REPLACEMENT', 'REASSEMBLY', 'FINAL_QC_GATE'] as const;
    for (const s of forwardStages) {
      await app.post(`/api/wagons/${encodeURIComponent(w)}/transition`, { targetStage: s }, { Authorization: `Bearer ${inspectorToken}` });
    }

    const chkRes = await app.get(`/api/wagons/${encodeURIComponent(w)}/checklist`, { Authorization: `Bearer ${inspectorToken}` });
    const items = (chkRes.body as { items: ChecklistItem[] }).items;
    assert.ok(items.length >= 8, 'Default checklist must have items across categories');

    // Pass all EXCEPT 1 mandatory item in BRAKE_SYSTEM
    let skippedOne = false;
    for (const item of items) {
      if (item.category === 'BRAKE_SYSTEM' && !skippedOne) {
        skippedOne = true;
        continue; // leave as PENDING
      }
      await app.put(`/api/wagons/${encodeURIComponent(w)}/checklist/items/${item.id}`, { status: 'PASS' }, { Authorization: `Bearer ${inspectorToken}` });
    }

    // Gate Status must be blocked
    const gateRes = await app.get(`/api/wagons/${encodeURIComponent(w)}/gate/status`, { Authorization: `Bearer ${supervisorToken}` });
    const gateData = gateRes.body as { canRelease: boolean; blockers: string[] };
    assert.strictEqual(gateData.canRelease, false);
    assert.ok(gateData.blockers.some(b => b.includes('BRAKE_SYSTEM') || b.includes('uninspected') || b.includes('failed')));

    // Sign-off attempt must return 422
    const signoffRes = await app.post(
      `/api/wagons/${encodeURIComponent(w)}/gate/signoff`,
      { supervisorId: 'supervisor1', digitalSignature: 'SIG-PENDING-FAIL' },
      { Authorization: `Bearer ${supervisorToken}` }
    );
    assert.strictEqual(signoffRes.status, 422);
  });

  it('TC-ADV-GATE-03: Exit gate sign-off is blocked by FAILED mandatory parts', async () => {
    const w = 'SECR/BOXNHL/FAIL-PART-01';
    await app.post('/api/wagons/register', { wagonNumber: w, wagonType: 'BOXNHL', owningRailway: 'SECR' }, { Authorization: `Bearer ${inspectorToken}` });

    const forwardStages = ['DISMANTLING', 'COMPONENT_INSPECTION', 'REPAIR_REPLACEMENT', 'REASSEMBLY', 'FINAL_QC_GATE'] as const;
    for (const s of forwardStages) {
      await app.post(`/api/wagons/${encodeURIComponent(w)}/transition`, { targetStage: s }, { Authorization: `Bearer ${inspectorToken}` });
    }

    const chkRes = await app.get(`/api/wagons/${encodeURIComponent(w)}/checklist`, { Authorization: `Bearer ${inspectorToken}` });
    const items = (chkRes.body as { items: ChecklistItem[] }).items;

    // Set 1 item to FAIL and rest to PASS
    for (let i = 0; i < items.length; i++) {
      const status = i === 0 ? 'FAIL' : 'PASS';
      await app.put(`/api/wagons/${encodeURIComponent(w)}/checklist/items/${items[i].id}`, { status }, { Authorization: `Bearer ${inspectorToken}` });
    }

    const signoffRes = await app.post(
      `/api/wagons/${encodeURIComponent(w)}/gate/signoff`,
      { supervisorId: 'supervisor1', digitalSignature: 'SIG-FAIL-TEST' },
      { Authorization: `Bearer ${supervisorToken}` }
    );
    assert.strictEqual(signoffRes.status, 422);
    const body = signoffRes.body as { blockers: string[] };
    assert.ok(body.blockers.some(b => b.includes('failed') || b.includes('FAIL') || b.includes('Mandatory')));
  });

  it('TC-ADV-GATE-04: Exit gate sign-off is blocked by CONDEMNED components (both mandatory and advisory)', async () => {
    const w = 'ER/BOXNHL/CONDEMN-01';
    await app.post('/api/wagons/register', { wagonNumber: w, wagonType: 'BOXNHL', owningRailway: 'ER' }, { Authorization: `Bearer ${inspectorToken}` });

    const forwardStages = ['DISMANTLING', 'COMPONENT_INSPECTION', 'REPAIR_REPLACEMENT', 'REASSEMBLY', 'FINAL_QC_GATE'] as const;
    for (const s of forwardStages) {
      await app.post(`/api/wagons/${encodeURIComponent(w)}/transition`, { targetStage: s }, { Authorization: `Bearer ${inspectorToken}` });
    }

    const chkRes = await app.get(`/api/wagons/${encodeURIComponent(w)}/checklist`, { Authorization: `Bearer ${inspectorToken}` });
    const items = (chkRes.body as { items: ChecklistItem[] }).items;

    for (let i = 0; i < items.length; i++) {
      const status = i === 0 ? 'CONDEMNED' : 'PASS';
      await app.put(`/api/wagons/${encodeURIComponent(w)}/checklist/items/${items[i].id}`, { status }, { Authorization: `Bearer ${inspectorToken}` });
    }

    const gateRes = await app.get(`/api/wagons/${encodeURIComponent(w)}/gate/status`, { Authorization: `Bearer ${supervisorToken}` });
    assert.strictEqual((gateRes.body as { canRelease: boolean }).canRelease, false);

    const signoffRes = await app.post(
      `/api/wagons/${encodeURIComponent(w)}/gate/signoff`,
      { supervisorId: 'supervisor1', digitalSignature: 'SIG-CONDEMN-TEST' },
      { Authorization: `Bearer ${supervisorToken}` }
    );
    assert.strictEqual(signoffRes.status, 422);
  });

  it('TC-ADV-GATE-05: Server WagonRepository Exit Gate blocks components with REPAIRED/REPLACED status lacking re-inspection PASS', () => {
    const rawDb = new DatabaseSync(':memory:');
    const schemaSql = fs.readFileSync(path.join(PROJECT_ROOT, 'server/src/db/schema.sql'), 'utf-8');
    rawDb.exec(schemaSql);
    const wagonRepo = new WagonRepository(rawDb);

    const wagon = wagonRepo.registerWagon({ wagonNumber: 'SECR/BOXNHL/REPAIR-01', wagonType: 'BOXNHL', owningRailway: 'SECR' });
    wagonRepo.recordTransition({
      wagonNumber: 'SECR/BOXNHL/REPAIR-01',
      fromStage: 'ENTRY_REGISTRATION',
      toStage: 'FINAL_QC_GATE',
      transitionType: 'OVERRIDE_SKIP',
      performedBy: 'usr_sup_001',
      performerName: 'Supervisor',
      performerRole: 'SUPERVISOR',
      isOverride: true,
      overrideReason: 'Fast-track to final gate for test'
    });

    const checklistData = wagonRepo.getChecklistItems('SECR/BOXNHL/REPAIR-01');
    const items = checklistData.allItems;

    // Set item 0 as REPAIRED without reinspected_status
    wagonRepo.updateChecklistItem(items[0].id, {
      status: 'REPAIRED',
      repairAction: 'REPAIRED',
      repairNotes: 'Welded component'
    });

    // Set remaining items as PASS
    for (let i = 1; i < items.length; i++) {
      wagonRepo.updateChecklistItem(items[i].id, { status: 'PASS' });
    }

    const evaluation = wagonRepo.evaluateExitGate('SECR/BOXNHL/REPAIR-01');
    assert.strictEqual(evaluation.canRelease, false);
    assert.ok(evaluation.blockerDetails.some(d => d.issueType === 'REINSPECTION_REQUIRED'));
    assert.ok(evaluation.blockers.some(b => b.includes('requires re-inspection sign-off')));
  });

  it('TC-ADV-GATE-06: Exit gate blocks wagons having CONDEMNED Phase 1 spring classification records', async () => {
    const w = 'SECR/BOXNHL/SPRING-COND-01';
    await app.post('/api/wagons/register', { wagonNumber: w, wagonType: 'BOXNHL', owningRailway: 'SECR' }, { Authorization: `Bearer ${inspectorToken}` });

    // Advance to Stage 6
    const forwardStages = ['DISMANTLING', 'COMPONENT_INSPECTION', 'REPAIR_REPLACEMENT', 'REASSEMBLY', 'FINAL_QC_GATE'] as const;
    for (const s of forwardStages) {
      await app.post(`/api/wagons/${encodeURIComponent(w)}/transition`, { targetStage: s }, { Authorization: `Bearer ${inspectorToken}` });
    }

    // Pass all general checklist items
    const chkRes = await app.get(`/api/wagons/${encodeURIComponent(w)}/checklist`, { Authorization: `Bearer ${inspectorToken}` });
    const items = (chkRes.body as { items: ChecklistItem[] }).items;
    for (const item of items) {
      await app.put(`/api/wagons/${encodeURIComponent(w)}/checklist/items/${item.id}`, { status: 'PASS' }, { Authorization: `Bearer ${inspectorToken}` });
    }

    // Log a Phase 1 CONDEMNED spring for this wagon (CASNUB_22_NLB Outer Used height 240.0mm -> CONDEMNED below 245mm)
    const springRes = await app.post(
      '/api/inspections',
      {
        wagonNumber: w,
        bogieType: 'CASNUB_22_NLB',
        springPosition: 'OUTER',
        condition: 'USED',
        measuredFreeHeight: 240.0
      },
      { Authorization: `Bearer ${inspectorToken}` }
    );
    assert.strictEqual(springRes.status, 201);
    assert.strictEqual((springRes.body as { status: string }).status, 'CONDEMNED');

    // Exit Gate status must detect the condemned spring
    const gateRes = await app.get(`/api/wagons/${encodeURIComponent(w)}/gate/status`, { Authorization: `Bearer ${supervisorToken}` });
    const gateData = gateRes.body as { canRelease: boolean; blockers: string[]; summary: any };
    assert.strictEqual(gateData.canRelease, false);
    assert.ok(gateData.blockers.some(b => b.includes('condemned') || b.includes('CONDEMNED') || b.includes('SPRINGS')));

    // Attempt signoff -> Must be rejected with 422
    const signoffRes = await app.post(
      `/api/wagons/${encodeURIComponent(w)}/gate/signoff`,
      { supervisorId: 'supervisor1', digitalSignature: 'SIG-SPRING-FAIL' },
      { Authorization: `Bearer ${supervisorToken}` }
    );
    assert.strictEqual(signoffRes.status, 422);

    // Also verify on Server WagonRepository / ExitGateValidator
    const rawDb = new DatabaseSync(':memory:');
    const schemaSql = fs.readFileSync(path.join(PROJECT_ROOT, 'server/src/db/schema.sql'), 'utf-8');
    rawDb.exec(schemaSql);
    const wagonRepo = new WagonRepository(rawDb);

    wagonRepo.registerWagon({ wagonNumber: 'SECR/BOXNHL/RAW-SPRING-01', wagonType: 'BOXNHL', owningRailway: 'SECR' });
    wagonRepo.recordTransition({
      wagonNumber: 'SECR/BOXNHL/RAW-SPRING-01',
      fromStage: 'ENTRY_REGISTRATION',
      toStage: 'FINAL_QC_GATE',
      transitionType: 'OVERRIDE_SKIP',
      performedBy: 'usr_sup_001',
      performerName: 'Supervisor',
      performerRole: 'SUPERVISOR',
      isOverride: true,
      overrideReason: 'Override to final gate'
    });

    // Pass all checklist items
    const rawChecklist = wagonRepo.getChecklistItems('SECR/BOXNHL/RAW-SPRING-01');
    for (const item of rawChecklist.allItems) {
      wagonRepo.updateChecklistItem(item.id, { status: 'PASS' });
    }

    // Insert CONDEMNED inspection into inspections table
    rawDb.prepare(`
      INSERT INTO inspections (
        id, sequence_number, wagon_number, bogie_type, spring_condition, spring_position,
        measured_height, classified_band, status, table_reference, valid_range_min, valid_range_max,
        inspector_id, inspector_name
      ) VALUES (
        'insp_raw_cond_1', 1, 'SECR/BOXNHL/RAW-SPRING-01', 'CASNUB_22_NLB', 'USED', 'OUTER',
        240.0, NULL, 'CONDEMNED', 'Table 28', 245.0, 260.0, 'usr_sup_001', 'Inspector'
      )
    `).run();

    const serverEval = wagonRepo.evaluateExitGate('SECR/BOXNHL/RAW-SPRING-01');
    assert.strictEqual(serverEval.canRelease, false);
    assert.ok(serverEval.blockerDetails.some(d => d.issueType === 'SPRING_CONDEMNED'));
    assert.ok(serverEval.blockers.some(b => b.includes('Condemned spring in Bogie')));
  });

  it('TC-ADV-GATE-07: Non-supervisor role (Inspector) attempting Exit Gate sign-off is rejected with 403 Forbidden', async () => {
    const w = 'SECR/BOXNHL/INSP-SIGNOFF';
    await app.post('/api/wagons/register', { wagonNumber: w, wagonType: 'BOXNHL', owningRailway: 'SECR' }, { Authorization: `Bearer ${inspectorToken}` });

    const signoffRes = await app.post(
      `/api/wagons/${encodeURIComponent(w)}/gate/signoff`,
      { supervisorId: 'inspector1', digitalSignature: 'SIG-INSPECTOR-FORGERY' },
      { Authorization: `Bearer ${inspectorToken}` }
    );
    assert.strictEqual(signoffRes.status, 403, 'Inspector must NOT be permitted to sign off release');
  });

  it('TC-ADV-GATE-08: Missing or empty digital signature and invalid OTP tokens in sign-off are rejected', async () => {
    const w = 'SECR/BOXNHL/SIG-VAL-01';
    await app.post('/api/wagons/register', { wagonNumber: w, wagonType: 'BOXNHL', owningRailway: 'SECR' }, { Authorization: `Bearer ${inspectorToken}` });

    // 1. Empty digital signature
    const emptySig = await app.post(
      `/api/wagons/${encodeURIComponent(w)}/gate/signoff`,
      { supervisorId: 'supervisor1', digitalSignature: '   ' },
      { Authorization: `Bearer ${supervisorToken}` }
    );
    assert.strictEqual(emptySig.status, 400);

    // 2. Missing digital signature
    const noSig = await app.post(
      `/api/wagons/${encodeURIComponent(w)}/gate/signoff`,
      { supervisorId: 'supervisor1' },
      { Authorization: `Bearer ${supervisorToken}` }
    );
    assert.strictEqual(noSig.status, 400);

    // 3. Invalid OTP token
    const badOtp = await app.post(
      `/api/wagons/${encodeURIComponent(w)}/gate/signoff`,
      { supervisorId: 'supervisor1', digitalSignature: 'SIG-VALID', otpToken: 'INVALID_OR_EXPIRED_TOKEN' },
      { Authorization: `Bearer ${supervisorToken}` }
    );
    assert.ok(badOtp.status === 401 || badOtp.status === 403 || badOtp.status === 422);
  });

  // =========================================================================
  // SECTION 3: Database Invariant & Immutability Attacks
  // =========================================================================

  it('TC-ADV-DB-01: Direct SQLite UPDATE and DELETE attacks on lifecycle_transitions in TestApp AuditDatabase are blocked by triggers', async () => {
    const w = 'SECR/BOXNHL/IMMUT-01';
    await app.post('/api/wagons/register', { wagonNumber: w, wagonType: 'BOXNHL', owningRailway: 'SECR' }, { Authorization: `Bearer ${inspectorToken}` });

    const trans = app.auditDb.getTransitions(w);
    assert.ok(trans.length > 0);
    const transId = trans[0].id;

    // 1. Direct UPDATE on lifecycle_transitions
    assert.throws(() => {
      app.auditDb.attemptDirectTransitionUpdate(transId);
    }, /strictly append-only/);

    // 2. Direct DELETE on lifecycle_transitions
    assert.throws(() => {
      app.auditDb.attemptDirectTransitionDelete(transId);
    }, /strictly append-only/);
  });

  it('TC-ADV-DB-02: Direct SQLite raw UPDATE and DELETE attacks on gate_signoffs and release_certificates are blocked by triggers', async () => {
    const w = 'SECR/BOXNHL/IMMUT-02';
    await app.post('/api/wagons/register', { wagonNumber: w, wagonType: 'BOXNHL', owningRailway: 'SECR' }, { Authorization: `Bearer ${inspectorToken}` });

    // Advance to Stage 6
    const forwardStages = ['DISMANTLING', 'COMPONENT_INSPECTION', 'REPAIR_REPLACEMENT', 'REASSEMBLY', 'FINAL_QC_GATE'] as const;
    for (const s of forwardStages) {
      await app.post(`/api/wagons/${encodeURIComponent(w)}/transition`, { targetStage: s }, { Authorization: `Bearer ${inspectorToken}` });
    }

    // Pass all items
    const chkRes = await app.get(`/api/wagons/${encodeURIComponent(w)}/checklist`, { Authorization: `Bearer ${inspectorToken}` });
    const items = (chkRes.body as { items: ChecklistItem[] }).items;
    for (const item of items) {
      await app.put(`/api/wagons/${encodeURIComponent(w)}/checklist/items/${item.id}`, { status: 'PASS' }, { Authorization: `Bearer ${inspectorToken}` });
    }

    // Sign off
    const signoffRes = await app.post(
      `/api/wagons/${encodeURIComponent(w)}/gate/signoff`,
      { supervisorId: 'supervisor1', digitalSignature: 'HMAC-SHA256-GENUINE-SIG' },
      { Authorization: `Bearer ${supervisorToken}` }
    );
    assert.strictEqual(signoffRes.status, 200);

    const internalDb = (app.auditDb as any).db as DatabaseSync;

    // Verify Direct SQL UPDATE on gate_signoffs throws
    assert.throws(() => {
      internalDb.prepare('UPDATE gate_signoffs SET digital_signature = ? WHERE wagon_number = ?').run('HACKED', w);
    }, /immutable/);

    // Verify Direct SQL DELETE on gate_signoffs throws
    assert.throws(() => {
      internalDb.prepare('DELETE FROM gate_signoffs WHERE wagon_number = ?').run(w);
    }, /immutable/);

    // Verify Direct SQL UPDATE on release_certificates throws
    assert.throws(() => {
      internalDb.prepare('UPDATE release_certificates SET digital_signature = ? WHERE wagon_number = ?').run('HACKED', w);
    }, /immutable/);

    // Verify Direct SQL DELETE on release_certificates throws
    assert.throws(() => {
      internalDb.prepare('DELETE FROM release_certificates WHERE wagon_number = ?').run(w);
    }, /immutable/);
  });

  it('TC-ADV-DB-03: Direct SQLite raw UPDATE and DELETE attacks on Phase 1 inspections are blocked by triggers', async () => {
    const record = app.auditDb.logInspection({
      inspectorId: 'inspector1',
      inspectorName: 'Inspector 1',
      wagonNumber: 'SECR/BOXNHL/IMMUT-03',
      bogieType: 'CASNUB_22_NLB',
      springPosition: 'OUTER',
      condition: 'USED',
      measuredFreeHeight: 255.0,
      classifiedBand: 'YELLOW',
      status: 'PASS',
      tableReference: 'Table 28'
    });

    const internalDb = (app.auditDb as any).db as DatabaseSync;

    // 1. Direct UPDATE on inspections
    assert.throws(() => {
      internalDb.prepare('UPDATE inspections SET measured_free_height = 260.0 WHERE id = ?').run(record.id);
    }, /strictly append-only/);

    // 2. Direct DELETE on inspections
    assert.throws(() => {
      internalDb.prepare('DELETE FROM inspections WHERE id = ?').run(record.id);
    }, /strictly append-only/);
  });

  it('TC-ADV-DB-04: Standalone Production Schema (server/src/db/schema.sql) rigorously aborts all UPDATE & DELETE queries on wagon_transitions, gate_signoffs, inspections, and audit log', () => {
    // Instantiate raw in-memory SQLite database from server/src/db/schema.sql
    const rawDb = new DatabaseSync(':memory:');
    const schemaSql = fs.readFileSync(path.join(PROJECT_ROOT, 'server/src/db/schema.sql'), 'utf-8');
    rawDb.exec(schemaSql);

    // 1. Seed test user
    rawDb.prepare(`
      INSERT INTO users (id, username, password_hash, role, full_name, employee_id, is_active)
      VALUES ('usr_test_1', 'tester1', 'hash', 'SUPERVISOR', 'Test Supervisor', 'EMP-100', 1)
    `).run();

    // 2. Seed test wagon
    rawDb.prepare(`
      INSERT INTO wagons (id, wagon_number, wagon_type, owning_railway, current_stage, status, created_by)
      VALUES ('wagon_test_1', 'SECR/BOXNHL/RAW-01', 'BOXNHL', 'SECR', 'ENTRY_REGISTRATION', 'IN_PROGRESS', 'usr_test_1')
    `).run();

    // 3. Seed wagon transition
    rawDb.prepare(`
      INSERT INTO wagon_transitions (
        id, wagon_id, wagon_number, from_stage, to_stage, transition_type,
        performed_by, performer_name, performer_role
      ) VALUES (
        'trans_test_1', 'wagon_test_1', 'SECR/BOXNHL/RAW-01', 'ENTRY_REGISTRATION', 'DISMANTLING', 'NORMAL',
        'usr_test_1', 'Test Supervisor', 'SUPERVISOR'
      )
    `).run();

    // 4. Seed gate signoff
    rawDb.prepare(`
      INSERT INTO gate_signoffs (
        id, wagon_id, wagon_number, supervisor_id, supervisor_name, supervisor_employee_id,
        digital_signature, otp_token_ref, checks_summary_json, certificate_number, certificate_hash
      ) VALUES (
        'signoff_test_1', 'wagon_test_1', 'SECR/BOXNHL/RAW-01', 'usr_test_1', 'Test Supervisor', 'EMP-100',
        'HMAC-SIG-TEST', 'otp_123', '{}', 'WRS/QC-REL/2026/08/TEST01', 'abcdef1234567890'
      )
    `).run();

    // 5. Seed inspection
    rawDb.prepare(`
      INSERT INTO inspections (
        id, sequence_number, wagon_number, bogie_type, spring_condition, spring_position,
        measured_height, classified_band, status, table_reference, valid_range_min, valid_range_max,
        inspector_id, inspector_name
      ) VALUES (
        'insp_test_1', 1, 'SECR/BOXNHL/RAW-01', 'CASNUB_22_NLB', 'USED', 'OUTER',
        255.0, 'YELLOW', 'PASS', 'Table 28', 245.0, 260.0, 'usr_test_1', 'Test Supervisor'
      )
    `).run();

    // -----------------------------------------------------------------------
    // ATTACK 1: UPDATE on wagon_transitions
    // -----------------------------------------------------------------------
    assert.throws(() => {
      rawDb.prepare(`UPDATE wagon_transitions SET from_stage = 'REPAIR_REPLACEMENT' WHERE id = 'trans_test_1'`).run();
    }, (err: any) => {
      return err.message.includes('Audit log is strictly append-only') && err.message.includes('Wagon transition');
    }, 'Trigger trg_prevent_wagon_transitions_update must abort UPDATE');

    // -----------------------------------------------------------------------
    // ATTACK 2: DELETE on wagon_transitions
    // -----------------------------------------------------------------------
    assert.throws(() => {
      rawDb.prepare(`DELETE FROM wagon_transitions WHERE id = 'trans_test_1'`).run();
    }, (err: any) => {
      return err.message.includes('Audit log is strictly append-only') && err.message.includes('Wagon transition');
    }, 'Trigger trg_prevent_wagon_transitions_delete must abort DELETE');

    // -----------------------------------------------------------------------
    // ATTACK 3: UPDATE on gate_signoffs
    // -----------------------------------------------------------------------
    assert.throws(() => {
      rawDb.prepare(`UPDATE gate_signoffs SET digital_signature = 'TAMPERED_SIG' WHERE id = 'signoff_test_1'`).run();
    }, (err: any) => {
      return err.message.includes('Audit log is strictly append-only') && err.message.includes('Gate sign-off');
    }, 'Trigger trg_prevent_gate_signoffs_update must abort UPDATE');

    // -----------------------------------------------------------------------
    // ATTACK 4: DELETE on gate_signoffs
    // -----------------------------------------------------------------------
    assert.throws(() => {
      rawDb.prepare(`DELETE FROM gate_signoffs WHERE id = 'signoff_test_1'`).run();
    }, (err: any) => {
      return err.message.includes('Audit log is strictly append-only') && err.message.includes('Gate sign-off');
    }, 'Trigger trg_prevent_gate_signoffs_delete must abort DELETE');

    // -----------------------------------------------------------------------
    // ATTACK 5: UPDATE on inspections
    // -----------------------------------------------------------------------
    assert.throws(() => {
      rawDb.prepare(`UPDATE inspections SET status = 'CONDEMNED' WHERE id = 'insp_test_1'`).run();
    }, (err: any) => {
      return err.message.includes('Audit log is strictly append-only') && err.message.includes('Inspection records are immutable');
    }, 'Trigger trg_prevent_inspections_update must abort UPDATE');

    // -----------------------------------------------------------------------
    // ATTACK 6: DELETE on inspections
    // -----------------------------------------------------------------------
    assert.throws(() => {
      rawDb.prepare(`DELETE FROM inspections WHERE id = 'insp_test_1'`).run();
    }, (err: any) => {
      return err.message.includes('Audit log is strictly append-only') && err.message.includes('Inspection records are immutable');
    }, 'Trigger trg_prevent_inspections_delete must abort DELETE');

    // -----------------------------------------------------------------------
    // ATTACK 7: UPDATE on inspection_audit_log
    // -----------------------------------------------------------------------
    assert.throws(() => {
      rawDb.prepare(`UPDATE inspection_audit_log SET user_role = 'ADMIN'`).run();
    }, (err: any) => {
      return err.message.includes('Audit log is strictly append-only') && err.message.includes('Audit log entries are immutable');
    }, 'Trigger trg_prevent_audit_log_update must abort UPDATE');

    // -----------------------------------------------------------------------
    // ATTACK 8: DELETE on inspection_audit_log
    // -----------------------------------------------------------------------
    assert.throws(() => {
      rawDb.prepare(`DELETE FROM inspection_audit_log`).run();
    }, (err: any) => {
      return err.message.includes('Audit log is strictly append-only') && err.message.includes('Audit log entries are immutable');
    }, 'Trigger trg_prevent_audit_log_delete must abort DELETE');

    // -----------------------------------------------------------------------
    // VERIFY DATA UNTOUCHED AFTER FAILED ATTACKS
    // -----------------------------------------------------------------------
    const transRow = rawDb.prepare(`SELECT from_stage FROM wagon_transitions WHERE id = 'trans_test_1'`).get() as any;
    assert.strictEqual(transRow.from_stage, 'ENTRY_REGISTRATION', 'Data must remain completely unmodified');

    const signoffRow = rawDb.prepare(`SELECT digital_signature FROM gate_signoffs WHERE id = 'signoff_test_1'`).get() as any;
    assert.strictEqual(signoffRow.digital_signature, 'HMAC-SIG-TEST', 'Signoff must remain unmodified');

    const inspRow = rawDb.prepare(`SELECT status FROM inspections WHERE id = 'insp_test_1'`).get() as any;
    assert.strictEqual(inspRow.status, 'PASS', 'Inspection must remain unmodified');
  });
});
