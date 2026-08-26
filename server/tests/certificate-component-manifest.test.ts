/**
 * Official RDSO Release Certificate Component Manifest Integration Tests (Phase 3 - M1 / R4)
 * Indian Railways WRS Raipur
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';
import { getDatabase } from '../src/db/connection.ts';
import { WagonRepository } from '../src/db/wagonRepository.ts';
import { InspectionRepository } from '../src/db/repository.ts';
import { ComponentRepository } from '../src/db/componentRepository.ts';
import { CertificateGenerator } from '../src/reports/certificate.ts';
import { generateToken } from '../src/auth/jwt.ts';
import type { ExpressApp } from '../src/framework/index.ts';

describe('Phase 3 M1: Release Certificate Serialized Component Manifest (R4)', () => {
  let app: ExpressApp;
  let wagonRepo: WagonRepository;
  let inspectionRepo: InspectionRepository;
  let componentRepo: ComponentRepository;
  let supervisorToken: string;
  const testWagon = 'SECR/BOXNHL/10492';
  const unsignedWagon = 'SECR/BOXNHL/99777';

  before(() => {
    app = createApp(':memory:');

    // The certificate endpoint requires an authenticated user — a release
    // certificate is a formal safety attestation, not public data.
    supervisorToken = generateToken({
      id: 'usr_sup_001',
      username: 'supervisor1',
      role: 'SUPERVISOR',
      name: 'S. K. Verma',
      employeeId: 'WRS-SUP-2019'
    });
    const db = getDatabase();
    wagonRepo = new WagonRepository(db);
    inspectionRepo = new InspectionRepository(db);
    componentRepo = new ComponentRepository(db);

    // Register and release wagon
    const w1 = wagonRepo.registerWagon({
      wagonNumber: testWagon,
      wagonType: 'BOXNHL',
      owningRailway: 'SECR',
      createdBy: 'usr_insp_001'
    });

    // Create supervisor and signoff row
    db.prepare(`
      INSERT INTO gate_signoffs (
        id, wagon_id, wagon_number, supervisor_id, supervisor_name, supervisor_employee_id,
        digital_signature, otp_token_ref, checks_summary_json, certificate_number, certificate_hash, signed_at
      ) VALUES (
        'sgn_test_01', ?, ?, 'usr_sup_001', 'S. K. Verma', 'WRS-SUP-2019',
        'HMAC-SHA256-TEST-SIG', 'otp_123', '{}', 'WRS/QC-REL/2026/08/TEST01', 'hash1234567890abcdef', '2026-08-17T12:00:00.000Z'
      )
    `).run(w1.id, testWagon);

    // Register and assign serialized components
    componentRepo.registerComponent({
      serialNumber: 'WHL-RWF-2023-8841',
      componentType: 'WHEELSET',
      category: 'WHEELS_AXLES',
      partName: 'CASNUB Wheelset Assembly 1000mm',
      manufacturer: 'Rail Wheel Factory Yelahanka'
    });
    componentRepo.assignComponent('WHL-RWF-2023-8841', testWagon, 'BOGIE_1');

    componentRepo.registerComponent({
      serialNumber: 'BRG-SKF-2023-9941',
      componentType: 'BEARING',
      category: 'BEARINGS',
      partName: 'Class E (6"x11") CTRB Cartridge Bearing',
      manufacturer: 'SKF India'
    });
    componentRepo.assignComponent('BRG-SKF-2023-9941', testWagon, 'BOGIE_1');

    componentRepo.registerComponent({
      serialNumber: 'DGF-CW-2022-3810',
      componentType: 'DRAFT_GEAR',
      category: 'COUPLERS_DRAFT_GEAR',
      partName: 'Mark-50 Friction Draft Gear',
      manufacturer: 'Cardwell Westinghouse'
    });
    componentRepo.assignComponent('DGF-CW-2022-3810', testWagon, 'BODY');
  });

  // -------------------------------------------------------------------------
  // 1. JSON Release Certificate with Component Manifest
  // -------------------------------------------------------------------------
  it('TC-CERT-MANIFEST-01: CertificateGenerator returns structured componentManifest in JSON format', () => {
    const cert = CertificateGenerator.generate(
      testWagon,
      wagonRepo,
      inspectionRepo,
      componentRepo,
      'json'
    );

    assert.ok(cert.json);
    const json = cert.json as any;
    assert.strictEqual(json.wagon.wagonNumber, testWagon);
    assert.ok(json.componentManifest);
    assert.strictEqual(json.componentManifest.totalSerializedComponents, 3);
    assert.strictEqual(json.componentManifest.components.length, 3);

    const wheelset = json.componentManifest.components.find((c: any) => c.serialNumber === 'WHL-RWF-2023-8841');
    assert.ok(wheelset);
    assert.strictEqual(wheelset.componentType, 'WHEELSET');
    assert.strictEqual(wheelset.bogiePosition, 'BOGIE_1');
    assert.strictEqual(wheelset.healthStatus, 'EXCELLENT');
    assert.strictEqual(wheelset.status, 'IN_SERVICE');
    assert.ok(wheelset.qrCode.includes('WHL-RWF-2023-8841'));
  });

  // -------------------------------------------------------------------------
  // 2. HTML Release Certificate with Section 3 Manifest
  // -------------------------------------------------------------------------

  it('TC-CERT-QR-01: the certificate carries a real QR code, not a placeholder', () => {
    /*
     * The certificate used to build a full verification payload — issuer,
     * certificate number, wagon, timestamp, hash prefix — and then discard it
     * to render a styled box reading "QR VERIFIED / Scan for Authenticity".
     *
     * That is a false claim printed on the one document that says a named
     * supervisor released a particular wagon. Anyone who tried to scan it
     * would find nothing there, and would reasonably conclude the whole
     * certificate was decorative.
     *
     * The QR now genuinely encodes the payload and has been verified to
     * decode from a rendered image. This pins the two things checkable
     * without a camera: something was drawn, and the old lie is gone.
     */
    const cert = CertificateGenerator.generate(
      testWagon,
      wagonRepo,
      inspectionRepo,
      componentRepo,
      'html'
    );
    const html = cert.html as string;

    assert.ok(
      html.includes('<svg'),
      'the certificate must contain a drawn QR code'
    );
    assert.ok(
      !html.includes('QR VERIFIED'),
      'the placeholder text must not come back'
    );
    assert.ok(
      !html.includes('qr-code-placeholder'),
      'the placeholder element must not come back'
    );

    // The generator emits one <path> whose subpaths are the dark modules, so
    // the move commands count them. A QR of this payload runs to hundreds; a
    // couple would mean something drew a box rather than a code.
    const modules = (html.match(/M\d/g) || []).length;
    assert.ok(
      modules > 100,
      `expected a QR made of many modules, counted ${modules}`
    );
  });

  it('TC-CERT-QR-02: the QR payload identifies the certificate it is printed on', () => {
    // A QR that scans but names the wrong wagon is worse than none: it would
    // authenticate one vehicle's release against another's paperwork.
    const cert = CertificateGenerator.generate(
      testWagon,
      wagonRepo,
      inspectionRepo,
      componentRepo,
      'json'
    ) as any;

    const payload = cert.json?.qrData;
    assert.ok(payload, 'the certificate must expose its QR payload');
    assert.ok(payload.includes('INDIAN_RAILWAYS'), 'payload must name the issuer');
    // generate() takes the wagon number as a string, and normalises it with
    // trim().toUpperCase() before use, so compare against the same form the
    // certificate itself was built from.
    assert.ok(
      payload.includes(testWagon.trim().toUpperCase()),
      'payload must name the wagon the certificate is for'
    );
  });

  it('TC-CERT-MANIFEST-02: CertificateGenerator renders Section 3 Manifest table in printable HTML', () => {
    const cert = CertificateGenerator.generate(
      testWagon,
      wagonRepo,
      inspectionRepo,
      componentRepo,
      'html'
    );

    assert.ok(cert.html);
    const html = cert.html as string;

    // Check Section 3 Header
    assert.ok(html.includes('3. Serialized Component Health Passport Manifest (RDSO R4 Serialization)'));

    // Check serialized components in table
    assert.ok(html.includes('WHL-RWF-2023-8841'));
    assert.ok(html.includes('BRG-SKF-2023-9941'));
    assert.ok(html.includes('DGF-CW-2022-3810'));
    assert.ok(html.includes('Rail Wheel Factory Yelahanka'));
    assert.ok(html.includes('SKF India'));
    assert.ok(html.includes('Cardwell Westinghouse'));
    assert.ok(html.includes('EXCELLENT'));
  });

  // -------------------------------------------------------------------------
  // 3. Fallback Rendering for Wagon Without Components
  // -------------------------------------------------------------------------
  it('TC-CERT-MANIFEST-03: Renders graceful fallback for wagons without mounted components', () => {
    const emptyWagon = 'ECOR/BOXNHL/20831';
    const w2 = wagonRepo.registerWagon({
      wagonNumber: emptyWagon,
      wagonType: 'BOXNHL',
      owningRailway: 'ECOR',
      createdBy: 'usr_insp_001'
    });
    const db = getDatabase();
    db.prepare(`
      INSERT INTO gate_signoffs (
        id, wagon_id, wagon_number, supervisor_id, supervisor_name, supervisor_employee_id,
        digital_signature, otp_token_ref, checks_summary_json, certificate_number, certificate_hash, signed_at
      ) VALUES (
        'sgn_test_02', ?, ?, 'usr_sup_001', 'S. K. Verma', 'WRS-SUP-2019',
        'HMAC-SHA256-TEST-SIG', 'otp_123', '{}', 'WRS/QC-REL/2026/08/TEST02', 'hash9876543210fedcba', '2026-08-17T12:00:00.000Z'
      )
    `).run(w2.id, emptyWagon);

    const cert = CertificateGenerator.generate(emptyWagon, wagonRepo, inspectionRepo, 'html');
    assert.ok(cert.html);
    assert.ok(cert.html.includes('3. Serialized Component Health Passport Manifest (RDSO R4 Serialization)'));
    assert.ok(cert.html.includes('All high-value serialized components'));
  });

  // -------------------------------------------------------------------------
  // 4. REST API Endpoint Integration
  // -------------------------------------------------------------------------
  it('TC-CERT-MANIFEST-04: GET /api/wagons/:wagonNumber/certificate?format=json returns component manifest', async () => {
    const res = await app.dispatch({
      method: 'GET',
      url: `/api/wagons/${encodeURIComponent(testWagon)}/certificate?format=json`,
      headers: { authorization: `Bearer ${supervisorToken}` }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.data.componentManifest);
    assert.strictEqual(res.body.data.componentManifest.totalSerializedComponents, 3);
  });

  it('TC-CERT-MANIFEST-05: GET /api/wagons/:wagonNumber/certificate returns HTML with Section 3 manifest', async () => {
    const res = await app.dispatch({
      method: 'GET',
      url: `/api/wagons/${encodeURIComponent(testWagon)}/certificate?format=html`,
      headers: { authorization: `Bearer ${supervisorToken}` }
    });

    assert.strictEqual(res.status, 200);
    assert.ok(typeof res.body === 'string');
    assert.ok(res.body.includes('3. Serialized Component Health Passport Manifest (RDSO R4 Serialization)'));
    assert.ok(res.body.includes('WHL-RWF-2023-8841'));
  });

  // -------------------------------------------------------------------------
  // 5. Release-authorisation guards
  //
  // Regression cover for a defect where this endpoint issued a full
  // "100% PASSED" release certificate for ANY wagon, at any lifecycle stage,
  // to any unauthenticated caller — including wagons the exit gate was
  // actively blocking.
  // -------------------------------------------------------------------------
  it('TC-CERT-GUARD-01: certificate endpoint rejects unauthenticated callers', async () => {
    const res = await app.dispatch({
      method: 'GET',
      url: `/api/wagons/${encodeURIComponent(testWagon)}/certificate`
    });

    assert.strictEqual(res.status, 401);
  });

  it('TC-CERT-GUARD-02: refuses to issue a release certificate for a wagon with no gate sign-off', async () => {
    wagonRepo.registerWagon({
      wagonNumber: unsignedWagon,
      wagonType: 'BOXNHL',
      owningRailway: 'SECR',
      createdBy: 'usr_insp_001'
    });

    const res = await app.dispatch({
      method: 'GET',
      url: `/api/wagons/${encodeURIComponent(unsignedWagon)}/certificate`,
      headers: { authorization: `Bearer ${supervisorToken}` }
    });

    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.error, 'CERTIFICATE_NOT_AUTHORIZED');
  });

  it('TC-CERT-GUARD-03: provisional preview is watermarked and never claims release', async () => {
    const res = await app.dispatch({
      method: 'GET',
      url: `/api/wagons/${encodeURIComponent(unsignedWagon)}/certificate?provisional=true`,
      headers: { authorization: `Bearer ${supervisorToken}` }
    });

    assert.strictEqual(res.status, 200);
    const html = res.body as string;
    assert.ok(html.includes('NOT A RELEASE CERTIFICATE'), 'must be marked as not a release certificate');
    assert.ok(html.includes('provisional-watermark'), 'must carry the provisional watermark');
    assert.ok(!html.includes('100% PASSED'), 'must not contain hardcoded pass claims');
    assert.ok(!html.includes('S. K. Verma'), 'must not attribute an unsigned document to a real supervisor');
  });

  it('TC-CERT-GUARD-04: category matrix reflects real checklist state, not hardcoded passes', async () => {
    const res = await app.dispatch({
      method: 'GET',
      url: `/api/wagons/${encodeURIComponent(unsignedWagon)}/certificate?provisional=true`,
      headers: { authorization: `Bearer ${supervisorToken}` }
    });

    const html = res.body as string;
    // A freshly registered wagon has an untouched checklist, so every category
    // must report NOT CLEARED rather than a clean bill of health.
    assert.ok(html.includes('not inspected'), 'uninspected items must be reported as such');
    assert.ok(html.includes('status-fail'), 'uncleared categories must render as failures');
  });
});
