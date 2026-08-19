/**
 * Tier 1 Test Suite — Feature R3: Zero-Defect Exit Gate & Release Certification
 * Indian Railways WRS Raipur (Phase 2)
 *
 * Verifies Zero-Defect blocker diagnostics, mandatory part failure blocks,
 * supervisor digital sign-off with OTP, and printable PDF release certificate generation.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { TestApp } from '../../harness/test_app.ts';
import type {
  GateStatusResponse,
  ReleaseCertificate,
  WagonRecord,
  ChecklistItem
} from '../../../shared/types.ts';

describe('Tier 1 — R3: Zero-Defect Exit Gate & Release Certification', () => {
  let app: TestApp;
  let inspectorToken: string;
  let supervisorToken: string;
  const wagonNumber = 'SECR/BOXNHL/66001';

  beforeEach(async () => {
    app = new TestApp(':memory:');

    const inspLogin = await app.post('/api/auth/login', { username: 'inspector1', password: 'password123' });
    inspectorToken = (inspLogin.body as { token: string }).token;

    const supLogin = await app.post('/api/auth/login', { username: 'supervisor1', password: 'password123' });
    supervisorToken = (supLogin.body as { token: string }).token;

    // Register wagon and advance to Stage 6 (FINAL_QC_GATE)
    await app.post(
      '/api/wagons/register',
      { wagonNumber, wagonType: 'BOXNHL', owningRailway: 'SECR' },
      { Authorization: `Bearer ${inspectorToken}` }
    );

    const stages = ['DISMANTLING', 'COMPONENT_INSPECTION', 'REPAIR_REPLACEMENT', 'REASSEMBLY', 'FINAL_QC_GATE'] as const;
    for (const s of stages) {
      await app.post(`/api/wagons/${encodeURIComponent(wagonNumber)}/transition`, { targetStage: s }, { Authorization: `Bearer ${inspectorToken}` });
    }
  });

  // Helper to mark all checklist items with a target status
  async function setAllChecklistStatus(status: 'PASS' | 'FAIL' | 'CONDEMNED') {
    const res = await app.get(`/api/wagons/${encodeURIComponent(wagonNumber)}/checklist`, { Authorization: `Bearer ${inspectorToken}` });
    const items = (res.body as { items: ChecklistItem[] }).items;
    for (const item of items) {
      await app.put(
        `/api/wagons/${encodeURIComponent(wagonNumber)}/checklist/items/${item.id}`,
        { status },
        { Authorization: `Bearer ${inspectorToken}` }
      );
    }
  }

  // Test Case 1: Blocker Diagnostics for Failed Mandatory Parts
  it('TC-P2-R3-01: Gate status evaluation reports active blockers when mandatory parts have failed or remain uninspected', async () => {
    // Initial state: parts are FAIL
    const gateRes = await app.get(`/api/wagons/${encodeURIComponent(wagonNumber)}/gate/status`, { Authorization: `Bearer ${inspectorToken}` });
    assert.strictEqual(gateRes.status, 200);
    const gate = gateRes.body as GateStatusResponse;

    assert.strictEqual(gate.canRelease, false);
    assert.ok(gate.blockers.length > 0);
    assert.ok(gate.blockers.some(b => b.includes('Mandatory component failed or uninspected')));
    assert.ok(gate.summary.failedMandatory > 0);
  });

  // Test Case 2: Blocker for Condemned Parts
  it('TC-P2-R3-02: Exit gate evaluator flags unaddressed condemned components as release blockers', async () => {
    await setAllChecklistStatus('PASS');

    // Condemn a critical bearing
    const res = await app.get(`/api/wagons/${encodeURIComponent(wagonNumber)}/checklist`, { Authorization: `Bearer ${inspectorToken}` });
    const items = (res.body as { items: ChecklistItem[] }).items;
    const bearing = items.find(i => i.category === 'BEARINGS')!;

    await app.put(
      `/api/wagons/${encodeURIComponent(wagonNumber)}/checklist/items/${bearing.id}`,
      { status: 'CONDEMNED', repairNotes: 'Damaged cone race' },
      { Authorization: `Bearer ${inspectorToken}` }
    );

    const gateRes = await app.get(`/api/wagons/${encodeURIComponent(wagonNumber)}/gate/status`, { Authorization: `Bearer ${inspectorToken}` });
    const gate = gateRes.body as GateStatusResponse;

    assert.strictEqual(gate.canRelease, false);
    assert.ok(gate.blockers.some(b => b.includes('Unresolved condemned component') && b.includes('BEARINGS')));
    assert.strictEqual(gate.summary.totalCondemned, 1);
  });

  // Test Case 3: Exit Gate Clearance when Zero Defects
  it('TC-P2-R3-03: Exit gate clears when all mandatory items pass/repaired/replaced and zero condemned remain', async () => {
    await setAllChecklistStatus('PASS');

    const gateRes = await app.get(`/api/wagons/${encodeURIComponent(wagonNumber)}/gate/status`, { Authorization: `Bearer ${inspectorToken}` });
    const gate = gateRes.body as GateStatusResponse;

    assert.strictEqual(gate.summary.failedMandatory, 0);
    assert.strictEqual(gate.summary.totalCondemned, 0);
    // Only pending item is supervisor digital signoff
    assert.strictEqual(gate.blockers.length, 1);
    assert.ok(gate.blockers[0].includes('Supervisor digital sign-off is pending'));
  });

  // Test Case 4: Supervisor Digital Sign-off Transitions Wagon to RELEASE
  it('TC-P2-R3-04: Supervisor digital sign-off with OTP transitions wagon to Stage 7 (RELEASE) and generates certificate', async () => {
    await setAllChecklistStatus('PASS');

    // 1. Request OTP for sign-off
    const otpReq = await app.post('/api/auth/request-otp', { action: 'OVERRIDE' }, { Authorization: `Bearer ${supervisorToken}` });
    const { otpId, codeForTest } = otpReq.body as { otpId: string; codeForTest: string };

    // 2. Verify OTP
    const verifyRes = await app.post('/api/auth/verify-otp', { otpId, otpCode: codeForTest }, { Authorization: `Bearer ${supervisorToken}` });
    const { otpToken } = verifyRes.body as { otpToken: string };

    // 3. Perform digital sign-off
    const signoffRes = await app.post(
      `/api/wagons/${encodeURIComponent(wagonNumber)}/gate/signoff`,
      {
        supervisorId: 'supervisor1',
        digitalSignature: 'SHA256:a8f4c2e89d31b0e4f1a2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4',
        otpToken,
        notes: 'Final QC Gate passed. 100% Zero Defect clearance verified per RDSO G-95.'
      },
      { Authorization: `Bearer ${supervisorToken}` }
    );

    assert.strictEqual(signoffRes.status, 200);
    const body = signoffRes.body as { success: boolean; certificate: ReleaseCertificate; wagon: WagonRecord };

    assert.strictEqual(body.success, true);
    assert.strictEqual(body.wagon.currentStage, 'RELEASE');
    assert.strictEqual(body.wagon.isReleased, true);
    assert.ok(body.certificate.certificateNumber.startsWith('WRS-RC-'));
    assert.ok(body.certificate.qrVerificationCode.includes(wagonNumber));
    assert.ok(body.certificate.pdfBase64);
  });

  // Test Case 5: Rejects Sign-off if Active Blockers Exist
  it('TC-P2-R3-05: System rejects sign-off attempt if active blockers exist (returns 422 Unprocessable Entity)', async () => {
    // Keep parts as FAIL
    const signoffRes = await app.post(
      `/api/wagons/${encodeURIComponent(wagonNumber)}/gate/signoff`,
      {
        supervisorId: 'supervisor1',
        digitalSignature: 'SHA256:invalid-premature-signoff',
        notes: 'Trying to sign off early'
      },
      { Authorization: `Bearer ${supervisorToken}` }
    );

    assert.strictEqual(signoffRes.status, 422);
    const err = signoffRes.body as { error: string; blockers: string[] };
    assert.ok(err.error.includes('Exit Gate validation failed') || err.error.includes('checks failed'));
    assert.ok(err.blockers.length > 0);
  });

  // Test Case 6: Release Certificate Retrieval Endpoint
  it('TC-P2-R3-06: Release certificate endpoint produces printable PDF and HTML certificate payloads', async () => {
    await setAllChecklistStatus('PASS');

    // Sign off wagon
    await app.post(
      `/api/wagons/${encodeURIComponent(wagonNumber)}/gate/signoff`,
      {
        supervisorId: 'supervisor1',
        digitalSignature: 'SIG-VERIFIED-HASH-2026',
        notes: 'Cleared'
      },
      { Authorization: `Bearer ${supervisorToken}` }
    );

    // 1. JSON format
    const jsonCertRes = await app.get(`/api/wagons/${encodeURIComponent(wagonNumber)}/certificate`, { Authorization: `Bearer ${inspectorToken}` });
    assert.strictEqual(jsonCertRes.status, 200);
    const cert = jsonCertRes.body as ReleaseCertificate;
    assert.strictEqual(cert.wagonNumber, wagonNumber);
    assert.strictEqual(cert.owningRailway, 'SECR');
    assert.ok(cert.certificateNumber.startsWith('WRS-RC-'));

    // 2. HTML format
    const htmlCertRes = await app.get(`/api/wagons/${encodeURIComponent(wagonNumber)}/certificate?format=html`, { Authorization: `Bearer ${inspectorToken}` });
    assert.strictEqual(htmlCertRes.status, 200);
    assert.strictEqual(htmlCertRes.headers['content-type'], 'text/html');
    assert.ok((htmlCertRes.body as string).includes('INDIAN RAILWAYS — WAGON REPAIR SHOP (WRS) RAIPUR'));
    assert.ok((htmlCertRes.body as string).includes('CERTIFIED FIT FOR RUNNING'));
  });

});
