/**
 * Server Unit & Integration Tests: Computer Vision Measurement Telemetry & RDSO Engine
 * Indian Railways WRS Raipur (Milestone 4 — Direct CV Measurement & AR Simulation)
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createApp } from '../src/app.ts';
import type { ExpressApp } from '../src/framework/index.ts';

async function mockFetch(app: ExpressApp, method: string, path: string, body?: any, headers: Record<string, string> = {}) {
  return app.dispatch({
    method,
    url: path,
    body,
    headers
  });
}

describe('Milestone 4: CV Measurement Telemetry & RDSO Tolerance Verification API', () => {
  let app: ExpressApp;

  beforeEach(() => {
    app = createApp(':memory:');
  });

  // -------------------------------------------------------------------------
  // 1. CASNUB Springs (Tables 28-33)
  // -------------------------------------------------------------------------
  it('TC-CV-01: Valid Outer Spring (NLB, 261.5mm) evaluates to PASS with Band I (Blue)', async () => {
    const res = await mockFetch(app, 'POST', '/api/cv/measure', {
      componentType: 'OUTER_SPRING',
      measuredValue: 261.5,
      wireDiameter: 31.0,
      bogieType: 'CASNUB_22_NLB',
      condition: 'USED'
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.verdict, 'PASS');
    assert.strictEqual(res.body.band, 'BLUE');
    assert.strictEqual(res.body.rdsoTable, 'Table 28');
    assert.strictEqual(res.body.nominalValue, 260.0);
    assert.strictEqual(res.body.delta, 1.5);
    assert.ok(res.body.auditLogId);
    assert.ok(res.body.auditHash);
    assert.strictEqual(res.body.wireDiameterCheck.status, 'PASS');
  });

  it('TC-CV-02: Outer Spring (NLB, 258.4mm) evaluates to PASS with Band II (Green)', async () => {
    const res = await mockFetch(app, 'POST', '/api/cv/measure', {
      componentType: 'OUTER_SPRING',
      measuredValue: 258.4,
      bogieType: 'CASNUB_22_NLB'
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.verdict, 'PASS');
    assert.strictEqual(res.body.band, 'GREEN');
    assert.strictEqual(res.body.delta, -1.6);
  });

  it('TC-CV-03: Under-height Outer Spring (<245.0mm) evaluates to CONDEMNED', async () => {
    const res = await mockFetch(app, 'POST', '/api/cv/measure', {
      componentType: 'OUTER_SPRING',
      measuredValue: 243.0,
      bogieType: 'CASNUB_22_NLB'
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.verdict, 'CONDEMNED');
    assert.ok(res.body.condemnationReason.includes('below minimum permissible limit'));
  });

  it('TC-CV-04: Outer Spring with worn wire diameter (<30.0mm) evaluates to CONDEMNED', async () => {
    const res = await mockFetch(app, 'POST', '/api/cv/measure', {
      componentType: 'OUTER_SPRING',
      measuredValue: 260.0,
      wireDiameter: 29.2,
      bogieType: 'CASNUB_22_NLB'
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.verdict, 'CONDEMNED');
    assert.strictEqual(res.body.wireDiameterCheck.status, 'CONDEMNED');
    assert.ok(res.body.condemnationReason.includes('Wire diameter'));
  });

  it('TC-CV-05: Inner Spring (NLB, 262.0mm) evaluates to PASS with Table 28 Blue band', async () => {
    const res = await mockFetch(app, 'POST', '/api/cv/measure', {
      componentType: 'INNER_SPRING',
      measuredValue: 262.0,
      bogieType: 'CASNUB_22_NLB'
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.verdict, 'PASS');
    assert.strictEqual(res.body.band, 'BLUE');
    assert.strictEqual(res.body.nominalValue, 262.0);
    assert.strictEqual(res.body.delta, 0.0);
  });

  it('TC-CV-06: Inner Spring (NLB, <247.0mm) evaluates to CONDEMNED', async () => {
    const res = await mockFetch(app, 'POST', '/api/cv/measure', {
      componentType: 'INNER_SPRING',
      measuredValue: 244.5,
      bogieType: 'CASNUB_22_NLB'
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.verdict, 'CONDEMNED');
    assert.ok(res.body.condemnationReason.includes('below minimum permissible limit'));
  });

  it('TC-CV-07: Snubber Spring (NLB, 294.0mm) evaluates to PASS with Table 28 Blue band', async () => {
    const res = await mockFetch(app, 'POST', '/api/cv/measure', {
      componentType: 'SNUBBER_SPRING',
      measuredValue: 294.0,
      bogieType: 'CASNUB_22_NLB'
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.verdict, 'PASS');
    assert.strictEqual(res.body.band, 'BLUE');
    assert.strictEqual(res.body.nominalValue, 294.0);
  });

  it('TC-CV-08: Snubber Spring (NLB, <279.0mm) evaluates to CONDEMNED', async () => {
    const res = await mockFetch(app, 'POST', '/api/cv/measure', {
      componentType: 'SNUBBER_SPRING',
      measuredValue: 275.0,
      bogieType: 'CASNUB_22_NLB'
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.verdict, 'CONDEMNED');
  });

  it('TC-CV-09: CASNUB 22 HS Inner Spring evaluates against Table 29 (Nominal 243.0mm)', async () => {
    const res = await mockFetch(app, 'POST', '/api/cv/measure', {
      componentType: 'INNER_SPRING',
      measuredValue: 243.0,
      bogieType: 'CASNUB_22_HS'
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.verdict, 'PASS');
    assert.strictEqual(res.body.band, 'BLUE');
    assert.strictEqual(res.body.nominalValue, 243.0);
    assert.strictEqual(res.body.rdsoTable, 'Table 29');
  });

  it('TC-CV-10: CASNUB 22 RFT Outer Spring evaluates against Table 30 (Nominal 272.0mm)', async () => {
    const res = await mockFetch(app, 'POST', '/api/cv/measure', {
      componentType: 'OUTER_SPRING',
      measuredValue: 272.0,
      bogieType: 'CASNUB_22_RFT'
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.verdict, 'PASS');
    assert.strictEqual(res.body.band, 'BLUE');
    assert.strictEqual(res.body.nominalValue, 272.0);
    assert.strictEqual(res.body.rdsoTable, 'Table 30');
  });

  // -------------------------------------------------------------------------
  // 2. Friction Wedge Evaluation (RDSO G-95 Para 4.4 / G-97)
  // -------------------------------------------------------------------------
  it('TC-CV-11: Friction Wedge vertical wear <= 7.0mm evaluates to PASS', async () => {
    const res = await mockFetch(app, 'POST', '/api/cv/measure', {
      componentType: 'FRICTION_WEDGE',
      measuredValue: 4.5 // 4.5mm wear
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.verdict, 'PASS');
    assert.strictEqual(res.body.delta, 4.5);
    assert.ok(res.body.rdsoTable.includes('G-95'));
  });

  it('TC-CV-12: Friction Wedge vertical wear > 7.0mm evaluates to CONDEMNED', async () => {
    const res = await mockFetch(app, 'POST', '/api/cv/measure', {
      componentType: 'FRICTION_WEDGE',
      measuredValue: 8.2 // 8.2mm wear
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.verdict, 'CONDEMNED');
    assert.ok(res.body.condemnationReason.includes('7.0mm condemning limit'));
  });

  it('TC-CV-13: Friction Wedge height in permissible range [129.0, 138.0mm] evaluates to PASS', async () => {
    const res = await mockFetch(app, 'POST', '/api/cv/measure', {
      componentType: 'FRICTION_WEDGE',
      measuredValue: 134.0 // height measurement
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.verdict, 'PASS');
    assert.strictEqual(res.body.nominalValue, 136.0);
    assert.strictEqual(res.body.delta, -2.0);
  });

  it('TC-CV-14: Friction Wedge height < 129.0mm evaluates to CONDEMNED', async () => {
    const res = await mockFetch(app, 'POST', '/api/cv/measure', {
      componentType: 'FRICTION_WEDGE',
      measuredValue: 126.5
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.verdict, 'CONDEMNED');
    assert.ok(res.body.condemnationReason.includes('below 129.0mm condemning limit'));
  });

  // -------------------------------------------------------------------------
  // 3. CTRB End Cap Evaluation (RDSO G-81)
  // -------------------------------------------------------------------------
  it('TC-CV-15: a component with no approved limit returns a measurement, not a verdict', async () => {
    // CTRB_END_CAP has no sourced gap figure — WMM 2.0 gives a torque and a
    // must-change-screw procedure and no measurable limit, and none is in
    // G-81 either. The spec exists with placeholder numbers, and those numbers
    // must never reach a pass/fail. These three cases previously asserted
    // PASS/CONDEMNED against them, pinning invented limits as if they were
    // RDSO's.
    const res = await mockFetch(app, 'POST', '/api/cv/measure', {
      componentType: 'CTRB_END_CAP',
      measuredValue: 1.8
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.verdict, null, 'no verdict may be given without an approved limit');
    assert.strictEqual(res.body.verdictAvailable, false);
    assert.strictEqual(res.body.measuredValue, 1.8, 'the reading is still recorded');
    assert.strictEqual(res.body.verificationStatus, 'PENDING_SIGNOFF');
  });

  it('TC-CV-16: the same applies to a reading well outside the placeholder range', async () => {
    // Guards the subtler half: not judging must not mean quietly passing
    // everything, nor quietly condemning it.
    const res = await mockFetch(app, 'POST', '/api/cv/measure', {
      componentType: 'CTRB_END_CAP',
      measuredValue: 3.8
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.verdict, null);
    assert.strictEqual(res.body.verdictAvailable, false);
  });

  it('TC-CV-17: the reason there is no verdict is stated, not left blank', async () => {
    // Whoever reads this needs to know it is a missing figure, not a fault in
    // the tool — and what would make the check work.
    const res = await mockFetch(app, 'POST', '/api/cv/measure', {
      componentType: 'CTRB_END_CAP',
      measuredValue: 1.5
    });

    assert.match(res.body.message, /no approved limit/i);
    assert.match(res.body.verificationNote, /sign-off/i);
  });

  // -------------------------------------------------------------------------
  // 4. Other CASNUB Components (Wheel Flange & Brake Block)
  // -------------------------------------------------------------------------
  it('TC-CV-18: Wheel Flange >= 16.0mm evaluates to PASS, < 16.0mm to CONDEMNED', async () => {
    const passRes = await mockFetch(app, 'POST', '/api/cv/measure', {
      componentType: 'WHEEL_FLANGE',
      measuredValue: 24.5
    });
    assert.strictEqual(passRes.status, 200);
    assert.strictEqual(passRes.body.verdict, 'PASS');

    const condemnRes = await mockFetch(app, 'POST', '/api/cv/measure', {
      componentType: 'WHEEL_FLANGE',
      measuredValue: 14.8
    });
    assert.strictEqual(condemnRes.status, 200);
    assert.strictEqual(condemnRes.body.verdict, 'CONDEMNED');
  });

  it('TC-CV-19: Composite Brake Block >= 10.0mm evaluates to PASS, < 10.0mm to CONDEMNED', async () => {
    const passRes = await mockFetch(app, 'POST', '/api/cv/measure', {
      componentType: 'BRAKE_BLOCK',
      measuredValue: 28.0
    });
    assert.strictEqual(passRes.status, 200);
    assert.strictEqual(passRes.body.verdict, 'PASS');

    const condemnRes = await mockFetch(app, 'POST', '/api/cv/measure', {
      componentType: 'BRAKE_BLOCK',
      measuredValue: 7.5
    });
    assert.strictEqual(condemnRes.status, 200);
    assert.strictEqual(condemnRes.body.verdict, 'CONDEMNED');
  });

  // -------------------------------------------------------------------------
  // 5. Validation & Error Handling (400 Bad Request)
  // -------------------------------------------------------------------------
  it('TC-CV-20: Missing componentType returns 400 Bad Request', async () => {
    const res = await mockFetch(app, 'POST', '/api/cv/measure', {
      measuredValue: 260.0
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.success, false);
  });

  it('TC-CV-21: Missing or invalid measuredValue returns 400 Bad Request', async () => {
    const res1 = await mockFetch(app, 'POST', '/api/cv/measure', {
      componentType: 'OUTER_SPRING'
    });
    assert.strictEqual(res1.status, 400);

    const res2 = await mockFetch(app, 'POST', '/api/cv/measure', {
      componentType: 'OUTER_SPRING',
      measuredValue: 'invalid-string' as any
    });
    assert.strictEqual(res2.status, 400);

    const res3 = await mockFetch(app, 'POST', '/api/cv/measure', {
      componentType: 'OUTER_SPRING',
      measuredValue: -15.0
    });
    assert.strictEqual(res3.status, 400);

    const res4 = await mockFetch(app, 'POST', '/api/cv/measure', {
      componentType: 'OUTER_SPRING',
      measuredValue: 5000.0
    });
    assert.strictEqual(res4.status, 400);
  });

  // -------------------------------------------------------------------------
  // 6. Audit Logging, SHA-256 Hashing & Wagon Checklist Integration
  // -------------------------------------------------------------------------
  it('TC-CV-22: Audit log contains immutable SHA-256 hash and measurement metadata', async () => {
    const res = await mockFetch(app, 'POST', '/api/cv/measure', {
      componentType: 'OUTER_SPRING',
      measuredValue: 260.0,
      metadata: {
        confidence: 0.99,
        inspectorId: 'insp_test_01',
        inspectorName: 'S. Sharma'
      }
    });

    assert.strictEqual(res.status, 200);
    assert.ok(res.body.auditLogId.startsWith('audit_cv_'));
    assert.strictEqual(typeof res.body.auditHash, 'string');
    assert.strictEqual(res.body.auditHash.length, 64); // Valid SHA-256 hex string
  });

  it('TC-CV-23: GET /api/cv/tolerances returns master RDSO specifications dictionary', async () => {
    const res = await mockFetch(app, 'GET', '/api/cv/tolerances');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.data.OUTER_SPRING);
    assert.ok(res.body.data.INNER_SPRING);
    assert.ok(res.body.data.SNUBBER_SPRING);
    assert.ok(res.body.data.FRICTION_WEDGE);
    assert.ok(res.body.data.CTRB_END_CAP);
    assert.strictEqual(res.body.data.OUTER_SPRING.nominalValue, 260.0);
    assert.strictEqual(res.body.data.FRICTION_WEDGE.maxPermissibleWear, 7.0);
  });
});
