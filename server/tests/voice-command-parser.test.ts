/**
 * Unit Tests for Bilingual Voice Command Parser (Milestone 3)
 * Indian Railways WRS Raipur (RDSO G-95 & CASNUB Bogie Inspection)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  parseVoiceCommand,
  detectLanguage,
  normalizeTranscript,
  convertDevanagariDigits
} from '../../client/src/utils/voiceCommandParser.ts';

describe('Voice Command Parser Unit Tests', () => {
  describe('1. Normalization & Language Detection', () => {
    it('detects English, Hindi, and Mixed language scripts accurately', () => {
      assert.strictEqual(detectLanguage('Outer spring passes'), 'en');
      assert.strictEqual(detectLanguage('आउटर स्प्रिंग पास'), 'hi');
      assert.strictEqual(detectLanguage('CTRB bearing कंडम'), 'mixed');
    });

    it('normalizes transcripts stripping punctuation and extra whitespace while preserving decimals', () => {
      assert.strictEqual(
        normalizeTranscript('  Outer Spring (Bogie 1),  FIT!!  '),
        'outer spring bogie 1 fit'
      );
      assert.strictEqual(
        normalizeTranscript('Friction wedge: CONDEMNED - deep crack!!'),
        'friction wedge condemned deep crack'
      );
      assert.strictEqual(
        normalizeTranscript('Height is 260.50 mm (tolerance +/- 2.0 mm)'),
        'height is 260.50 mm tolerance 2.0 mm'
      );
    });

    it('converts Devanagari numerals to Western digits', () => {
      assert.strictEqual(convertDevanagariDigits('ऊंचाई २६०.५ मिमी'), 'ऊंचाई 260.5 मिमी');
      assert.strictEqual(convertDevanagariDigits('१२३४५'), '12345');
    });
  });

  describe('2. English Spoken Commands Parsing', () => {
    it('parses "Outer spring passes" -> UPDATE_STATUS PASS for SPRINGS', () => {
      const result = parseVoiceCommand('Outer spring passes');
      assert.strictEqual(result.matched, true);
      assert.strictEqual(result.actionType, 'UPDATE_STATUS');
      assert.strictEqual(result.targetPartName, 'Outer Spring');
      assert.strictEqual(result.targetCategory, 'SPRINGS');
      assert.strictEqual(result.status, 'PASS');
    });

    it('parses "Outer spring 1 fit" -> UPDATE_STATUS PASS for Outer Spring (Bogie 1)', () => {
      const result = parseVoiceCommand('Outer spring 1 fit');
      assert.strictEqual(result.matched, true);
      assert.strictEqual(result.actionType, 'UPDATE_STATUS');
      assert.strictEqual(result.targetPartName, 'Outer Spring (Bogie 1)');
      assert.strictEqual(result.status, 'PASS');
    });

    it('parses "Outer spring 2 fit" -> UPDATE_STATUS PASS for Outer Spring (Bogie 2)', () => {
      const result = parseVoiceCommand('Outer spring 2 fit');
      assert.strictEqual(result.matched, true);
      assert.strictEqual(result.actionType, 'UPDATE_STATUS');
      assert.strictEqual(result.targetPartName, 'Outer Spring (Bogie 2)');
      assert.strictEqual(result.status, 'PASS');
    });

    it('parses "Condemn friction wedge" -> UPDATE_STATUS CONDEMNED for FRICTION_WEDGES', () => {
      const result = parseVoiceCommand('Condemn friction wedge');
      assert.strictEqual(result.matched, true);
      assert.strictEqual(result.actionType, 'UPDATE_STATUS');
      assert.strictEqual(result.targetPartName, 'Wedge Main Slope Surface');
      assert.strictEqual(result.targetCategory, 'FRICTION_WEDGES');
      assert.strictEqual(result.status, 'CONDEMNED');
    });

    it('parses "CTRB bearing replaced with new" -> UPDATE_STATUS REPLACED for BEARINGS', () => {
      const result = parseVoiceCommand('CTRB bearing replaced with new');
      assert.strictEqual(result.matched, true);
      assert.strictEqual(result.actionType, 'UPDATE_STATUS');
      assert.strictEqual(result.targetPartName, 'CTRB Cartridge Bearing Rotation');
      assert.strictEqual(result.targetCategory, 'BEARINGS');
      assert.strictEqual(result.status, 'REPLACED');
    });

    it('parses "Brake beam repaired and tested" -> UPDATE_STATUS REPAIRED for BRAKE_SYSTEM', () => {
      const result = parseVoiceCommand('Brake beam repaired and tested');
      assert.strictEqual(result.matched, true);
      assert.strictEqual(result.actionType, 'UPDATE_STATUS');
      assert.strictEqual(result.targetPartName, 'Brake Beams & Truss Assembly');
      assert.strictEqual(result.targetCategory, 'BRAKE_SYSTEM');
      assert.strictEqual(result.status, 'REPAIRED');
    });

    it('parses "CBC knuckle nose wear condemn" -> UPDATE_STATUS CONDEMNED for COUPLERS_DRAFT_GEAR', () => {
      const result = parseVoiceCommand('CBC knuckle nose wear condemn');
      assert.strictEqual(result.matched, true);
      assert.strictEqual(result.actionType, 'UPDATE_STATUS');
      assert.strictEqual(result.targetPartName, 'CBC Knuckle Nose Wear');
      assert.strictEqual(result.targetCategory, 'COUPLERS_DRAFT_GEAR');
      assert.strictEqual(result.status, 'CONDEMNED');
    });

    it('parses "Elastomeric pad fit" -> UPDATE_STATUS PASS for Constant Contact Side Bearers', () => {
      const result = parseVoiceCommand('Elastomeric pad fit');
      assert.strictEqual(result.matched, true);
      assert.strictEqual(result.actionType, 'UPDATE_STATUS');
      assert.strictEqual(result.targetPartName, 'Constant Contact Side Bearers');
      assert.strictEqual(result.targetCategory, 'BOGIE_FRAME_BOLSTER');
      assert.strictEqual(result.status, 'PASS');
    });

    it('parses "Center sill sole bar camber ok" -> UPDATE_STATUS PASS for BODY_UNDERFRAME', () => {
      const result = parseVoiceCommand('Center sill sole bar camber ok');
      assert.strictEqual(result.matched, true);
      assert.strictEqual(result.actionType, 'UPDATE_STATUS');
      assert.strictEqual(result.targetPartName, 'Center Sill & Sole Bar Camber');
      assert.strictEqual(result.targetCategory, 'BODY_UNDERFRAME');
      assert.strictEqual(result.status, 'PASS');
    });
  });

  describe('3. Devanagari Hindi & Hinglish Commands Parsing', () => {
    it('parses Devanagari "आउटर स्प्रिंग पास" -> UPDATE_STATUS PASS', () => {
      const result = parseVoiceCommand('आउटर स्प्रिंग पास');
      assert.strictEqual(result.matched, true);
      assert.strictEqual(result.actionType, 'UPDATE_STATUS');
      assert.strictEqual(result.targetPartName, 'Outer Spring');
      assert.strictEqual(result.status, 'PASS');
    });

    it('parses Devanagari "पहला आउटर स्प्रिंग पास" -> UPDATE_STATUS PASS for Bogie 1', () => {
      const result = parseVoiceCommand('पहला आउटर स्प्रिंग पास');
      assert.strictEqual(result.matched, true);
      assert.strictEqual(result.actionType, 'UPDATE_STATUS');
      assert.strictEqual(result.targetPartName, 'Outer Spring (Bogie 1)');
      assert.strictEqual(result.status, 'PASS');
    });

    it('parses Devanagari "घर्षण वेज कंडम" -> UPDATE_STATUS CONDEMNED', () => {
      const result = parseVoiceCommand('घर्षण वेज कंडम');
      assert.strictEqual(result.matched, true);
      assert.strictEqual(result.actionType, 'UPDATE_STATUS');
      assert.strictEqual(result.targetPartName, 'Wedge Main Slope Surface');
      assert.strictEqual(result.status, 'CONDEMNED');
    });

    it('parses Devanagari "सीटीआरबी बेयरिंग नया लगाया" -> UPDATE_STATUS REPLACED', () => {
      const result = parseVoiceCommand('सीटीआरबी बेयरिंग नया लगाया');
      assert.strictEqual(result.matched, true);
      assert.strictEqual(result.actionType, 'UPDATE_STATUS');
      assert.strictEqual(result.targetPartName, 'CTRB Cartridge Bearing Rotation');
      assert.strictEqual(result.status, 'REPLACED');
    });

    it('parses Hinglish "outer spring 1 theek hai" -> UPDATE_STATUS PASS', () => {
      const result = parseVoiceCommand('outer spring 1 theek hai');
      assert.strictEqual(result.matched, true);
      assert.strictEqual(result.actionType, 'UPDATE_STATUS');
      assert.strictEqual(result.targetPartName, 'Outer Spring (Bogie 1)');
      assert.strictEqual(result.status, 'PASS');
    });

    it('parses Hinglish "snubber spring kharab hai badal diya" -> UPDATE_STATUS REPLACED', () => {
      const result = parseVoiceCommand('snubber spring badal diya');
      assert.strictEqual(result.matched, true);
      assert.strictEqual(result.actionType, 'UPDATE_STATUS');
      assert.strictEqual(result.targetPartName, 'Snubber Spring');
      assert.strictEqual(result.status, 'REPLACED');
    });

    it('parses Hinglish "brake beam repair kiya" -> UPDATE_STATUS REPAIRED', () => {
      const result = parseVoiceCommand('brake beam repair kiya');
      assert.strictEqual(result.matched, true);
      assert.strictEqual(result.actionType, 'UPDATE_STATUS');
      assert.strictEqual(result.targetPartName, 'Brake Beams & Truss Assembly');
      assert.strictEqual(result.status, 'REPAIRED');
    });

    it('parses Hinglish "axle box adapter sahi hai" -> UPDATE_STATUS PASS', () => {
      const result = parseVoiceCommand('axle box adapter sahi hai');
      assert.strictEqual(result.matched, true);
      assert.strictEqual(result.actionType, 'UPDATE_STATUS');
      assert.strictEqual(result.targetPartName, 'Axle Box Adapter Crown Wear');
      assert.strictEqual(result.status, 'PASS');
    });
  });

  describe('4. Defect Notes Extraction', () => {
    it('extracts deep crack defect notes from "Friction wedge condemn deep crack on vertical face"', () => {
      const result = parseVoiceCommand('Friction wedge condemn deep crack on vertical face');
      assert.strictEqual(result.matched, true);
      assert.strictEqual(result.status, 'CONDEMNED');
      assert.ok(result.defectNotes?.includes('Deep crack'));
    });

    it('extracts broken coil notes from "Outer spring scrap broken coil"', () => {
      const result = parseVoiceCommand('Outer spring scrap broken coil');
      assert.strictEqual(result.matched, true);
      assert.strictEqual(result.status, 'CONDEMNED');
      assert.ok(result.defectNotes?.includes('crack') || result.defectNotes?.includes('Broken'));
    });

    it('extracts air leak notes from "Air hose defective air leakage detected"', () => {
      const result = parseVoiceCommand('Air hose defective air leakage detected');
      assert.strictEqual(result.matched, true);
      assert.strictEqual(result.status, 'FAIL');
      assert.ok(result.defectNotes?.includes('Air pressure or grease leakage'));
    });

    it('extracts severe corrosion notes from "Side frame column liners condemn heavy corrosion"', () => {
      const result = parseVoiceCommand('Side frame column liners condemn heavy corrosion');
      assert.strictEqual(result.matched, true);
      assert.strictEqual(result.status, 'CONDEMNED');
      assert.ok(result.defectNotes?.includes('corrosion'));
    });
  });

  describe('5. Category Navigation & Undo Commands', () => {
    it('parses "Show bearings" -> SWITCH_CATEGORY BEARINGS', () => {
      const result = parseVoiceCommand('Show bearings');
      assert.strictEqual(result.matched, true);
      assert.strictEqual(result.actionType, 'SWITCH_CATEGORY');
      assert.strictEqual(result.categoryToSwitch, 'BEARINGS');
    });

    it('parses "Open brake system" -> SWITCH_CATEGORY BRAKE_SYSTEM', () => {
      const result = parseVoiceCommand('Open brake system');
      assert.strictEqual(result.matched, true);
      assert.strictEqual(result.actionType, 'SWITCH_CATEGORY');
      assert.strictEqual(result.categoryToSwitch, 'BRAKE_SYSTEM');
    });

    it('parses Devanagari "स्प्रिंग्स खोलो" -> SWITCH_CATEGORY SPRINGS', () => {
      const result = parseVoiceCommand('स्प्रिंग्स खोलो');
      assert.strictEqual(result.matched, true);
      assert.strictEqual(result.actionType, 'SWITCH_CATEGORY');
      assert.strictEqual(result.categoryToSwitch, 'SPRINGS');
    });

    it('parses "Undo" -> UNDO intent', () => {
      const result = parseVoiceCommand('Undo');
      assert.strictEqual(result.matched, true);
      assert.strictEqual(result.actionType, 'UNDO');
    });

    it('parses Hinglish "piche lo" -> UNDO intent', () => {
      const result = parseVoiceCommand('piche lo');
      assert.strictEqual(result.matched, true);
      assert.strictEqual(result.actionType, 'UNDO');
    });

    it('parses Devanagari "वापस लो" -> UNDO intent', () => {
      const result = parseVoiceCommand('वापस लो');
      assert.strictEqual(result.matched, true);
      assert.strictEqual(result.actionType, 'UNDO');
    });
  });

  describe('6. Stage 3 Spring Inspection Commands', () => {
    it('parses "Height 260.5 mm" -> CLASSIFY_SPRING with measuredHeight 260.5', () => {
      const result = parseVoiceCommand('Height 260.5 mm');
      assert.strictEqual(result.matched, true);
      assert.strictEqual(result.actionType, 'CLASSIFY_SPRING');
      assert.strictEqual(result.springParams?.measuredHeight, 260.5);
    });

    it('parses "CASNUB 22 NLB" -> CLASSIFY_SPRING with bogieType CASNUB_22_NLB', () => {
      const result = parseVoiceCommand('CASNUB 22 NLB');
      assert.strictEqual(result.matched, true);
      assert.strictEqual(result.actionType, 'CLASSIFY_SPRING');
      assert.strictEqual(result.springParams?.bogieType, 'CASNUB_22_NLB');
    });

    it('parses "Save inspection" -> CLASSIFY_SPRING with isSaveCommand true', () => {
      const result = parseVoiceCommand('Save inspection');
      assert.strictEqual(result.matched, true);
      assert.strictEqual(result.actionType, 'CLASSIFY_SPRING');
      assert.strictEqual(result.springParams?.isSaveCommand, true);
    });
  });

  describe('7. Available Checklist Items Matcher', () => {
    it('resolves targetItemId from active checklist items list', () => {
      const mockItems: any[] = [
        { id: 'chk_101', partName: 'Outer Spring (Bogie 1)', category: 'SPRINGS' },
        { id: 'chk_102', partName: 'Inner Spring (Bogie 1)', category: 'SPRINGS' },
        { id: 'chk_103', partName: 'Wedge Main Slope Surface', category: 'FRICTION_WEDGES' }
      ];

      const result = parseVoiceCommand('Outer spring 1 passes', 'SPRINGS', mockItems);
      assert.strictEqual(result.matched, true);
      assert.strictEqual(result.targetItemId, 'chk_101');
      assert.strictEqual(result.status, 'PASS');
    });
  });

  describe('8. Unknown & Edge Cases', () => {
    it('handles empty string gracefully', () => {
      const result = parseVoiceCommand('');
      assert.strictEqual(result.matched, false);
      assert.strictEqual(result.actionType, 'UNKNOWN');
    });

    it('handles random unrecognized speech', () => {
      const result = parseVoiceCommand('random hello world test phrase');
      assert.strictEqual(result.matched, false);
      assert.strictEqual(result.actionType, 'UNKNOWN');
    });
  });
});
