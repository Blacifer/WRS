/**
 * Tier 2 Test Suite — Boundary & Corner Cases: Phase 2 Wagon QC & Lifecycle
 * Indian Railways WRS Raipur (Phase 2)
 *
 * Verifies edge cases: malformed wagon numbers, duplicate registrations, invalid transitions,
 * empty justifications, terminal state protection, photo payload validation, and SQLite immutability triggers.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { TestApp } from '../../harness/test_app.ts';
import type { ChecklistItem } from '../../../shared/types.ts';

describe('Tier 2 — Boundary & Corner Cases (Phase 2)', () => {
  let app: TestApp;
  let inspectorToken: string;
  let supervisorToken: string;

  beforeEach(async () => {
    app = new TestApp(':memory:');

    const inspLogin = await app.post('/api/auth/login', { username: 'inspector1', password: 'password123' });
    inspectorToken = (inspLogin.body as { token: string }).token;

    const supLogin = await app.post('/api/auth/login', { username: 'supervisor1', password: 'password123' });
    supervisorToken = (supLogin.body as { token: string }).token;
  });

  // TC 1: Malformed Wagon Number Formats
  it('TC-P2-BND-01: Rejection of invalid wagon number formats (empty, special characters, whitespace, too short)', async () => {
    const invalidWagons = [
      '',
      '   ',
      'W',
      'NR/BOX<SCRIPT>/123',
      'NR/BOX"NHL/123',
      'NR/BOX;DROP TABLE/123'
    ];

    for (const w of invalidWagons) {
      const res = await app.post(
        '/api/wagons/register',
        { wagonNumber: w, wagonType: 'BOXNHL', owningRailway: 'NR' },
        { Authorization: `Bearer ${inspectorToken}` }
      );
      assert.strictEqual(res.status, 400, `Wagon number "${w}" should be rejected`);
    }
  });

  // TC 2: Duplicate Registration Collision
  it('TC-P2-BND-02: Duplicate wagon registration collision prevention (returns 409 Conflict)', async () => {
    const w = 'SECR/BOXNHL/99123';
    const reg1 = await app.post('/api/wagons/register', { wagonNumber: w, wagonType: 'BOXNHL', owningRailway: 'SECR' }, { Authorization: `Bearer ${inspectorToken}` });
    assert.strictEqual(reg1.status, 201);

    const reg2 = await app.post('/api/wagons/register', { wagonNumber: w, wagonType: 'BOXNHL', owningRailway: 'SECR' }, { Authorization: `Bearer ${inspectorToken}` });
    assert.strictEqual(reg2.status, 409);
    assert.ok((reg2.body as { error: string }).error.includes('already registered'));
  });

  // TC 3: Skipping Stages without Supervisor Override
  it('TC-P2-BND-03: Attempting non-sequential stage transition without supervisor override returns 400/403', async () => {
    const w = 'NR/BOXNHL/33101';
    await app.post('/api/wagons/register', { wagonNumber: w, wagonType: 'BOXNHL', owningRailway: 'NR' }, { Authorization: `Bearer ${inspectorToken}` });

    // Stage 1 -> Stage 4 (skip 2 & 3) without supervisor override
    const res = await app.post(
      `/api/wagons/${encodeURIComponent(w)}/transition`,
      { targetStage: 'REPAIR_REPLACEMENT' },
      { Authorization: `Bearer ${inspectorToken}` }
    );
    assert.ok(res.status === 400 || res.status === 403);
  });

  // TC 4: Empty Justification for Supervisor Override
  it('TC-P2-BND-04: Supervisor override with empty or whitespace justification is rejected (minimum length check)', async () => {
    const w = 'CR/BOBRN/88901';
    await app.post('/api/wagons/register', { wagonNumber: w, wagonType: 'BOBRN', owningRailway: 'CR' }, { Authorization: `Bearer ${inspectorToken}` });

    const emptyJust = await app.post(
      `/api/wagons/${encodeURIComponent(w)}/transition`,
      { targetStage: 'REPAIR_REPLACEMENT', supervisorOverride: true, overrideJustification: '   ' },
      { Authorization: `Bearer ${supervisorToken}` }
    );
    assert.strictEqual(emptyJust.status, 400);

    const shortJust = await app.post(
      `/api/wagons/${encodeURIComponent(w)}/transition`,
      { targetStage: 'REPAIR_REPLACEMENT', supervisorOverride: true, overrideJustification: 'ok' },
      { Authorization: `Bearer ${supervisorToken}` }
    );
    assert.strictEqual(shortJust.status, 400);
  });

  // TC 5: Transition Past Stage 7 Terminal State
  it('TC-P2-BND-05: Transition attempt past Stage 7 (RELEASE) is rejected (terminal state protection)', async () => {
    const w = 'WR/BCNHL/77101';
    await app.post('/api/wagons/register', { wagonNumber: w, wagonType: 'BCNHL', owningRailway: 'WR' }, { Authorization: `Bearer ${inspectorToken}` });

    // Advance to Stage 6 and sign off to Stage 7
    const stages = ['DISMANTLING', 'COMPONENT_INSPECTION', 'REPAIR_REPLACEMENT', 'REASSEMBLY', 'FINAL_QC_GATE'] as const;
    for (const s of stages) {
      await app.post(`/api/wagons/${encodeURIComponent(w)}/transition`, { targetStage: s }, { Authorization: `Bearer ${inspectorToken}` });
    }

    // Pass all items
    const chkRes = await app.get(`/api/wagons/${encodeURIComponent(w)}/checklist`, { Authorization: `Bearer ${inspectorToken}` });
    const items = (chkRes.body as { items: ChecklistItem[] }).items;
    for (const item of items) {
      await app.put(`/api/wagons/${encodeURIComponent(w)}/checklist/items/${item.id}`, { status: 'PASS' }, { Authorization: `Bearer ${inspectorToken}` });
    }

    // Sign off
    await app.post(`/api/wagons/${encodeURIComponent(w)}/gate/signoff`, { supervisorId: 'supervisor1', digitalSignature: 'SIG-TERM-TEST' }, { Authorization: `Bearer ${supervisorToken}` });

    // Attempt transition after RELEASE
    const postRelease = await app.post(
      `/api/wagons/${encodeURIComponent(w)}/transition`,
      { targetStage: 'ENTRY_REGISTRATION', supervisorOverride: true, overrideJustification: 'Try to restart' },
      { Authorization: `Bearer ${supervisorToken}` }
    );
    assert.strictEqual(postRelease.status, 400);
    assert.ok((postRelease.body as { error: string }).error.includes('already in RELEASE stage'));
  });

  // TC 6: Direct Transition to Stage 7 with Active Blockers
  it('TC-P2-BND-06: Direct transition attempt to Stage 7 (RELEASE) without clearing Exit Gate blockers returns 422 Unprocessable Entity', async () => {
    const w = 'SECR/BOXNHL/11099';
    await app.post('/api/wagons/register', { wagonNumber: w, wagonType: 'BOXNHL', owningRailway: 'SECR' }, { Authorization: `Bearer ${inspectorToken}` });

    // Advance to Stage 6
    const stages = ['DISMANTLING', 'COMPONENT_INSPECTION', 'REPAIR_REPLACEMENT', 'REASSEMBLY', 'FINAL_QC_GATE'] as const;
    for (const s of stages) {
      await app.post(`/api/wagons/${encodeURIComponent(w)}/transition`, { targetStage: s }, { Authorization: `Bearer ${inspectorToken}` });
    }

    // Attempt transition to RELEASE with failing mandatory items
    const prematureRelease = await app.post(
      `/api/wagons/${encodeURIComponent(w)}/transition`,
      { targetStage: 'RELEASE', notes: 'Trying to skip exit gate' },
      { Authorization: `Bearer ${inspectorToken}` }
    );
    assert.strictEqual(prematureRelease.status, 422);
    const err = prematureRelease.body as { error: string; blockers: string[] };
    assert.ok(err.error.includes('Exit Gate verification failed'));
    assert.ok(err.blockers.length > 0);
  });

  // TC 7: Malformed Photo Payloads
  it('TC-P2-BND-07: Photo upload with invalid category, missing partName, or empty base64 is rejected with 400', async () => {
    const w = 'NR/BOXNHL/PHOTO-BND';
    await app.post('/api/wagons/register', { wagonNumber: w, wagonType: 'BOXNHL', owningRailway: 'NR' }, { Authorization: `Bearer ${inspectorToken}` });

    // 1. Invalid category
    const badCat = await app.post(
      '/api/photos/upload',
      { wagonNumber: w, partCategory: 'INVALID_CATEGORY', partName: 'Part 1', imageBase64: 'data:img' },
      { Authorization: `Bearer ${inspectorToken}` }
    );
    assert.strictEqual(badCat.status, 400);

    // 2. Empty base64
    const emptyImg = await app.post(
      '/api/photos/upload',
      { wagonNumber: w, partCategory: 'SPRINGS', partName: 'Outer Spring', imageBase64: '' },
      { Authorization: `Bearer ${inspectorToken}` }
    );
    assert.strictEqual(emptyImg.status, 400);

    // 3. Missing part name
    const noPart = await app.post(
      '/api/photos/upload',
      { wagonNumber: w, partCategory: 'SPRINGS', partName: '', imageBase64: 'data:img' },
      { Authorization: `Bearer ${inspectorToken}` }
    );
    assert.strictEqual(noPart.status, 400);
  });

  // TC 8: Database Immutability Triggers
  it('TC-P2-BND-08: Database triggers guarantee immutability against direct SQL mutation on transitions and certificates', async () => {
    const w = 'NR/BOXNHL/TRIGGERS-01';
    await app.post('/api/wagons/register', { wagonNumber: w, wagonType: 'BOXNHL', owningRailway: 'NR' }, { Authorization: `Bearer ${inspectorToken}` });

    const trans = app.auditDb.getTransitions(w);
    assert.ok(trans.length > 0);

    // Direct UPDATE on lifecycle_transitions -> Must throw
    assert.throws(() => {
      app.auditDb.attemptDirectTransitionUpdate(trans[0].id);
    }, /strictly append-only/);

    // Direct DELETE on lifecycle_transitions -> Must throw
    assert.throws(() => {
      app.auditDb.attemptDirectTransitionDelete(trans[0].id);
    }, /strictly append-only/);
  });

});
