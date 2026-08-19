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
import type { ExpressApp } from '../src/framework/index.ts';

describe('Phase 3 M1: Release Certificate Serialized Component Manifest (R4)', () => {
  let app: ExpressApp;
  let wagonRepo: WagonRepository;
  let inspectionRepo: InspectionRepository;
  let componentRepo: ComponentRepository;
  const testWagon = 'SECR/BOXNHL/10492';

  before(() => {
    app = createApp(':memory:');
    const db = getDatabase();
    wagonRepo = new WagonRepository(db);
    inspectionRepo = new InspectionRepository(db);
    componentRepo = new ComponentRepository(db);

    // Register and release wagon
    const w1 = wagonRepo.registerWagon({
      wagonNumber: testWagon,
      wagonType: 'BOXNHL',
      owningRailway: 'SECR'
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
      owningRailway: 'ECOR'
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
      url: `/api/wagons/${encodeURIComponent(testWagon)}/certificate?format=json`
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.data.componentManifest);
    assert.strictEqual(res.body.data.componentManifest.totalSerializedComponents, 3);
  });

  it('TC-CERT-MANIFEST-05: GET /api/wagons/:wagonNumber/certificate returns HTML with Section 3 manifest', async () => {
    const res = await app.dispatch({
      method: 'GET',
      url: `/api/wagons/${encodeURIComponent(testWagon)}/certificate?format=html`
    });

    assert.strictEqual(res.status, 200);
    assert.ok(typeof res.body === 'string');
    assert.ok(res.body.includes('3. Serialized Component Health Passport Manifest (RDSO R4 Serialization)'));
    assert.ok(res.body.includes('WHL-RWF-2023-8841'));
  });
});
