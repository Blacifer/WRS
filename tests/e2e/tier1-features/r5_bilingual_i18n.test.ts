/**
 * Tier 1 Test Suite — Feature R5: Bilingual Interface (Hindi + English)
 * Indian Railways WRS Raipur
 *
 * Verifies complete English and Hindi translations for all UI strings,
 * color bands, inspection statuses, damage types, and bilingual API endpoints.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  I18N_DICTIONARIES,
  getTranslation,
  getLocalizedBandName,
  getLocalizedStatus,
  getLocalizedDamageType
} from '../../harness/i18n_data.ts';
import { TestApp } from '../../harness/test_app.ts';
import type { BandColor, InspectionStatus, DamageType } from '../../../shared/types.ts';

describe('Tier 1 — R5: Bilingual Interface (Hindi + English)', () => {
  const app = new TestApp(':memory:');

  // Test Case 1: English Dictionary Completeness
  it('TC-R5-01: English dictionary contains all required UI sections, labels, and error messages', () => {
    const dictEn = getTranslation('en');
    assert.ok(dictEn.app.title.includes('Spring Classification'));
    assert.ok(dictEn.app.subtitle.includes('Raipur'));
    assert.strictEqual(dictEn.roles.Inspector, 'Inspector');
    assert.strictEqual(dictEn.roles.Supervisor, 'Supervisor');
    assert.strictEqual(dictEn.roles.Admin, 'Admin / DRM Officer');
    assert.ok(dictEn.messages.classificationSuccess);
    assert.ok(dictEn.messages.condemnedAlert);
  });

  // Test Case 2: Hindi Dictionary Completeness
  it('TC-R5-02: Hindi dictionary contains complete authentic Hindi translations for workshop operators', () => {
    const dictHi = getTranslation('hi');
    assert.ok(dictHi.app.title.includes('स्प्रिंग वर्गीकरण'));
    assert.ok(dictHi.app.subtitle.includes('रायपुर'));
    assert.ok(dictHi.roles.Inspector.includes('निरीक्षक'));
    assert.ok(dictHi.roles.Supervisor.includes('पर्यवेक्षक'));
    assert.ok(dictHi.roles.Admin.includes('प्रशासक'));
    assert.ok(dictHi.messages.classificationSuccess.includes('वर्गीकरण'));
    assert.ok(dictHi.messages.condemnedAlert.includes('चेतावनी'));
  });

  // Test Case 3: Band Color Localization across all 6 bands in both languages
  it('TC-R5-03: Band colors are localized accurately in both English and Hindi', () => {
    const bands: BandColor[] = ['BLUE', 'GREEN', 'YELLOW', 'ORANGE', 'WHITE', 'RED'];

    const expectedHindi: Record<BandColor, string> = {
      BLUE: 'नीला',
      GREEN: 'हरा',
      YELLOW: 'पीला',
      ORANGE: 'नारंगी',
      WHITE: 'सफेद',
      RED: 'लाल'
    };

    for (const band of bands) {
      const enName = getLocalizedBandName(band, 'en');
      const hiName = getLocalizedBandName(band, 'hi');

      assert.ok(enName.toLowerCase().includes(band.toLowerCase()), `EN: ${band}`);
      assert.ok(hiName.includes(expectedHindi[band]), `HI: ${band} should contain ${expectedHindi[band]}, got ${hiName}`);
    }
  });

  // Test Case 4: Inspection Status Localization
  it('TC-R5-04: Inspection statuses (PASS / CONDEMNED) are translated accurately in both languages', () => {
    const statuses: InspectionStatus[] = ['PASS', 'CONDEMNED'];

    for (const st of statuses) {
      const enStatus = getLocalizedStatus(st, 'en');
      const hiStatus = getLocalizedStatus(st, 'hi');

      assert.ok(enStatus.length > 0);
      assert.ok(hiStatus.length > 0);
      if (st === 'PASS') {
        assert.ok(hiStatus.includes('उत्तीर्ण'));
      } else {
        assert.ok(hiStatus.includes('अस्वीकृत') || hiStatus.includes('कंडम'));
      }
    }
  });

  // Test Case 5: Damage Type Localization
  it('TC-R5-05: Damage types (CRACK, CORROSION, DEFORMATION) are localized in both languages', () => {
    const damages: DamageType[] = ['NONE', 'CRACK', 'CORROSION', 'DEFORMATION', 'OTHER'];

    const expectedHindiDamages: Record<DamageType, string> = {
      NONE: 'कोई प्रत्यक्ष क्षति नहीं',
      CRACK: 'दरार',
      CORROSION: 'जंग',
      DEFORMATION: 'विकृति',
      OTHER: 'अन्य दोष'
    };

    for (const d of damages) {
      const enDamage = getLocalizedDamageType(d, 'en');
      const hiDamage = getLocalizedDamageType(d, 'hi');

      assert.ok(enDamage.length > 0);
      assert.ok(hiDamage.includes(expectedHindiDamages[d]), `Expected ${expectedHindiDamages[d]} in ${hiDamage}`);
    }
  });

  // Test Case 6: Bilingual API endpoint responds with requested language
  it('TC-R5-06: /api/i18n/:lang API endpoint serves localized dictionary payload', async () => {
    const resEn = await app.get('/api/i18n/en');
    assert.strictEqual(resEn.status, 200);
    assert.strictEqual((resEn.body as typeof I18N_DICTIONARIES.en).roles.Inspector, 'Inspector');

    const resHi = await app.get('/api/i18n/hi');
    assert.strictEqual(resHi.status, 200);
    assert.ok((resHi.body as typeof I18N_DICTIONARIES.hi).roles.Inspector.includes('निरीक्षक'));
  });

});
