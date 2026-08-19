/**
 * Tier 3 Test Suite — Cross-Feature Integration: Bilingual Data Workflow
 * Indian Railways WRS Raipur
 *
 * Verifies that inspections logged via Hindi UI mode maintain canonical storage
 * and map accurately when retrieved and presented in both Hindi and English views.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { TestApp } from '../../harness/test_app.ts';
import { getLocalizedBandName, getLocalizedStatus, getLocalizedDamageType } from '../../harness/i18n_data.ts';
import type { InspectionRecord } from '../../../shared/types.ts';

describe('Tier 3 — Bilingual Audit & UI Flow', () => {
  let app: TestApp;
  let inspectorToken: string;

  beforeEach(async () => {
    app = new TestApp(':memory:');
    const loginRes = await app.post('/api/auth/login', { username: 'inspector1', password: 'password123' });
    inspectorToken = (loginRes.body as { token: string }).token;
  });

  it('TC-XF-04: Inspection logged with Hindi UI values preserves canonical database fields and formats properly in both locales', async () => {
    // Inspector working in Hindi UI logs inspection
    const inspRes = await app.post(
      '/api/inspections',
      {
        wagonNumber: 'SE-BOXN-HINDI-01',
        bogieType: 'CASNUB_22_NLB',
        springPosition: 'OUTER',
        condition: 'USED',
        measuredFreeHeight: 260.0, // Band I (Blue)
        damageType: 'NONE',
        damageNotes: 'सामान्य आवधिक निरीक्षण (General POH Inspection)'
      },
      { Authorization: `Bearer ${inspectorToken}` }
    );

    assert.strictEqual(inspRes.status, 201);
    const record = inspRes.body as InspectionRecord;

    // Verify canonical storage
    assert.strictEqual(record.classifiedBand, 'BLUE');
    assert.strictEqual(record.status, 'PASS');

    // Verify Hindi Presentation mapping
    const hindiBand = getLocalizedBandName(record.classifiedBand!, 'hi');
    const hindiStatus = getLocalizedStatus(record.status, 'hi');
    const hindiDamage = getLocalizedDamageType(record.damageType, 'hi');

    assert.ok(hindiBand.includes('नीला'));
    assert.ok(hindiStatus.includes('उत्तीर्ण'));
    assert.ok(hindiDamage.includes('कोई प्रत्यक्ष क्षति नहीं'));

    // Verify English Presentation mapping
    const englishBand = getLocalizedBandName(record.classifiedBand!, 'en');
    const englishStatus = getLocalizedStatus(record.status, 'en');

    assert.ok(englishBand.includes('Blue'));
    assert.ok(englishStatus.includes('PASS'));
  });

});
