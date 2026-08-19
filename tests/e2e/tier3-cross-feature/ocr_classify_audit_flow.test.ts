/**
 * Tier 3 Test Suite — Cross-Feature Integration: OCR -> Classify -> Audit Log Flow
 * Indian Railways WRS Raipur
 *
 * End-to-end pairwise workflow:
 * 1. Digital caliper LCD image capture & OCR reading
 * 2. Automated RDSO G-95 spring classification
 * 3. Immutable audit trail logging with metadata
 * 4. Query & verification of created record
 * 5. Tamper attempt rejection (immutability check)
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TestApp } from '../../harness/test_app.ts';
import type { InspectionRecord, CaliperOCRResult } from '../../../shared/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, '../../fixtures');

describe('Tier 3 — OCR -> Classify -> Audit Log -> Immutability Flow', () => {
  let app: TestApp;
  let inspectorToken: string;

  beforeEach(async () => {
    app = new TestApp(':memory:');
    const loginRes = await app.post('/api/auth/login', { username: 'inspector1', password: 'password123' });
    inspectorToken = (loginRes.body as { token: string }).token;
  });

  it('TC-XF-01: Executes complete seamless flow from Caliper Image OCR to Immutable Audit Log', async () => {
    // Step 1: Ingest caliper image via OCR
    const svgPath = path.join(FIXTURES_DIR, 'caliper_260_00.svg');
    const svgContent = fs.readFileSync(svgPath, 'utf-8');

    const ocrRes = await app.post('/api/ocr/read-caliper', { imageText: svgContent }, { Authorization: `Bearer ${inspectorToken}` });
    assert.strictEqual(ocrRes.status, 200);
    const ocrData = ocrRes.body as CaliperOCRResult;
    assert.strictEqual(ocrData.measuredHeight, 260.00);
    assert.ok(ocrData.confidence >= 0.9);

    // Step 2: Classify height
    const classRes = await app.post('/api/classification/classify', {
      bogieType: 'CASNUB_22_NLB',
      condition: 'USED',
      position: 'OUTER',
      measuredHeight: ocrData.measuredHeight
    });
    assert.strictEqual(classRes.status, 200);
    const classData = classRes.body as { band: string; bandRoman: string; status: string; tableReference: string };
    assert.strictEqual(classData.status, 'PASS');
    assert.strictEqual(classData.band, 'BLUE');
    assert.strictEqual(classData.bandRoman, 'Band I');
    assert.strictEqual(classData.tableReference, 'Table 28');

    // Step 3: Log inspection record
    const logRes = await app.post(
      '/api/inspections',
      {
        wagonNumber: 'SE-BOXN-778899',
        bogieType: 'CASNUB_22_NLB',
        springPosition: 'OUTER',
        condition: 'USED',
        measuredFreeHeight: ocrData.measuredHeight,
        damageType: 'NONE'
      },
      { Authorization: `Bearer ${inspectorToken}` }
    );
    assert.strictEqual(logRes.status, 201);
    const savedRecord = logRes.body as InspectionRecord;
    assert.ok(savedRecord.id);
    assert.strictEqual(savedRecord.sequenceNumber, 1);
    assert.strictEqual(savedRecord.wagonNumber, 'SE-BOXN-778899');
    assert.strictEqual(savedRecord.measuredFreeHeight, 260.00);
    assert.strictEqual(savedRecord.classifiedBand, 'BLUE');
    assert.strictEqual(savedRecord.status, 'PASS');

    // Step 4: Query & verify record in audit log
    const queryRes = await app.get(`/api/inspections?wagonNumber=SE-BOXN-778899`, { Authorization: `Bearer ${inspectorToken}` });
    assert.strictEqual(queryRes.status, 200);
    const queryBody = queryRes.body as { records: InspectionRecord[]; total: number };
    assert.strictEqual(queryBody.total, 1);
    assert.strictEqual(queryBody.records[0].id, savedRecord.id);

    // Step 5: Verification of immutability (attempting to alter or delete fails)
    const updateAttempt = await app.put(`/api/inspections/${savedRecord.id}`, { measuredFreeHeight: 255.0 }, { Authorization: `Bearer ${inspectorToken}` });
    assert.strictEqual(updateAttempt.status, 405);

    const deleteAttempt = await app.delete(`/api/inspections/${savedRecord.id}`, { Authorization: `Bearer ${inspectorToken}` });
    assert.strictEqual(deleteAttempt.status, 405);
  });

});
