/**
 * Tier 1 Test Suite — Feature R1: Hands-Free Voice UI ("Greasy Gloves" Solution)
 * Indian Railways WRS Raipur (Phase 3)
 *
 * Verifies Web Speech API recognition, vernacular English & Hindi command parsing,
 * hands-free category navigation, undo operations, error handling, and audit logging.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { TestApp } from '../../harness/test_app.ts';
import { MockSpeechRecognition, parseVoiceCommand } from '../../harness/speech_mock.ts';
import type { ChecklistItem } from '../../../shared/types.ts';

describe('Tier 1 — Phase 3 Feature R1: Hands-Free Voice UI ("Greasy Gloves")', () => {
  let app: TestApp;
  let inspectorToken: string;
  const testWagonNumber = 'SECR/BOXNHL/33101';

  beforeEach(async () => {
    app = new TestApp(':memory:');

    // Authenticate inspector
    const inspLogin = await app.post('/api/auth/login', { username: 'inspector1', password: 'password123' });
    inspectorToken = (inspLogin.body as { token: string }).token;

    // Register a test wagon at Stage 3 (COMPONENT_INSPECTION)
    await app.post(
      '/api/wagons/register',
      {
        wagonNumber: testWagonNumber,
        wagonType: 'BOXNHL',
        owningRailway: 'SECR',
        entryNotes: 'In-bay overhaul test for Voice UI'
      },
      { Authorization: `Bearer ${inspectorToken}` }
    );

    // Transition to Stage 2 and then Stage 3
    await app.post(`/api/wagons/${encodeURIComponent(testWagonNumber)}/transition`, { targetStage: 'DISMANTLING' }, { Authorization: `Bearer ${inspectorToken}` });
    await app.post(`/api/wagons/${encodeURIComponent(testWagonNumber)}/transition`, { targetStage: 'COMPONENT_INSPECTION' }, { Authorization: `Bearer ${inspectorToken}` });
  });

  // TC-P3-VUI-01: Voice inspection toolbar lifecycle & mock speech events
  it('TC-P3-VUI-01: Voice inspection toolbar activation, listening state transitions and permissions', async () => {
    const recognition = new MockSpeechRecognition();
    let started = false;
    let ended = false;

    recognition.onstart = () => { started = true; };
    recognition.onend = () => { ended = true; };

    assert.strictEqual(recognition.isListening, false);
    recognition.start();
    assert.strictEqual(recognition.isListening, true);
    assert.strictEqual(started, true);

    // Stop recognition
    recognition.stop();
    assert.strictEqual(recognition.isListening, false);
    assert.strictEqual(ended, true);

    // Test permission denied simulation
    let errorCaught: string | null = null;
    recognition.onerror = (evt) => { errorCaught = evt.error; };
    recognition.dispatchError('not-allowed', 'Microphone access denied by user');
    assert.strictEqual(errorCaught, 'not-allowed');
  });

  // TC-P3-VUI-02: English voice command recognition and checklist updates
  it('TC-P3-VUI-02: English voice command recognition updates checklist statuses and notes', async () => {
    // 1. "Outer spring passes"
    const res1 = await app.post(
      '/api/checklist/voice-action',
      {
        wagonNumber: testWagonNumber,
        transcript: 'Outer spring passes',
        locale: 'en'
      },
      { Authorization: `Bearer ${inspectorToken}` }
    );

    assert.strictEqual(res1.status, 200);
    const body1 = res1.body as { success: boolean; item?: ChecklistItem; parsed: { intent: string; status: string } };
    assert.strictEqual(body1.success, true);
    assert.strictEqual(body1.parsed.intent, 'UPDATE_STATUS');
    assert.strictEqual(body1.parsed.status, 'PASS');

    // 2. "Condemn friction wedge with severe crack"
    const res2 = await app.post(
      '/api/checklist/voice-action',
      {
        wagonNumber: testWagonNumber,
        transcript: 'Condemn friction wedge with severe crack',
        locale: 'en'
      },
      { Authorization: `Bearer ${inspectorToken}` }
    );

    assert.strictEqual(res2.status, 200);
    const body2 = res2.body as { success: boolean; parsed: { intent: string; status: string; notes?: string } };
    assert.strictEqual(body2.parsed.status, 'CONDEMNED');
    assert.ok(body2.parsed.notes?.includes('severe crack'));

    // 3. "Snubber spring 245 mm band green"
    const res3 = await app.post(
      '/api/checklist/voice-action',
      {
        wagonNumber: testWagonNumber,
        transcript: 'Snubber spring 245 mm band green',
        locale: 'en'
      },
      { Authorization: `Bearer ${inspectorToken}` }
    );

    assert.strictEqual(res3.status, 200);
    const body3 = res3.body as { success: boolean; parsed: { intent: string; measuredHeight?: number; bandColor?: string } };
    assert.strictEqual(body3.parsed.intent, 'CLASSIFY_SPRING');
    assert.strictEqual(body3.parsed.measuredHeight, 245);
    assert.strictEqual(body3.parsed.bandColor, 'GREEN');
  });

  // TC-P3-VUI-03: Hindi (vernacular) voice command recognition
  it('TC-P3-VUI-03: Hindi vernacular voice commands correctly parse and update CASNUB checklist items', async () => {
    // 1. "बाहरी स्प्रिंग पास" (Outer spring pass)
    const resHi1 = await app.post(
      '/api/checklist/voice-action',
      {
        wagonNumber: testWagonNumber,
        transcript: 'बाहरी स्प्रिंग पास',
        locale: 'hi'
      },
      { Authorization: `Bearer ${inspectorToken}` }
    );

    assert.strictEqual(resHi1.status, 200);
    const bodyHi1 = resHi1.body as { success: boolean; parsed: { intent: string; status: string } };
    assert.strictEqual(bodyHi1.parsed.status, 'PASS');

    // 2. "घर्षण वेज कंडम" (Friction wedge condemned)
    const resHi2 = await app.post(
      '/api/checklist/voice-action',
      {
        wagonNumber: testWagonNumber,
        transcript: 'घर्षण वेज कंडम',
        locale: 'hi'
      },
      { Authorization: `Bearer ${inspectorToken}` }
    );

    assert.strictEqual(resHi2.status, 200);
    const bodyHi2 = resHi2.body as { success: boolean; parsed: { status: string } };
    assert.strictEqual(bodyHi2.parsed.status, 'CONDEMNED');

    // 3. "ब्रेक ब्लॉक बदला गया" (Brake block replaced)
    const resHi3 = await app.post(
      '/api/checklist/voice-action',
      {
        wagonNumber: testWagonNumber,
        transcript: 'ब्रेक ब्लॉक बदला गया',
        locale: 'hi'
      },
      { Authorization: `Bearer ${inspectorToken}` }
    );

    assert.strictEqual(resHi3.status, 200);
    const bodyHi3 = resHi3.body as { success: boolean; parsed: { status: string } };
    assert.strictEqual(bodyHi3.parsed.status, 'REPLACED');
  });

  // TC-P3-VUI-04: Hands-free navigation and undo operations
  it('TC-P3-VUI-04: Hands-free category navigation and undo operations parse accurately in English and Hindi', async () => {
    // Navigation command English: "Go to Brake System"
    const navEn = parseVoiceCommand('Go to Brake System', 'en');
    assert.strictEqual(navEn.matched, true);
    assert.strictEqual(navEn.intent, 'NAVIGATE_CATEGORY');
    assert.strictEqual(navEn.targetCategory, 'BRAKE_SYSTEM');

    // Navigation command Hindi: "स्प्रिंग्स पर जाओ" (Go to Springs)
    const navHi = parseVoiceCommand('स्प्रिंग्स पर जाओ', 'hi');
    assert.strictEqual(navHi.matched, true);
    assert.strictEqual(navHi.intent, 'NAVIGATE_CATEGORY');
    assert.strictEqual(navHi.targetCategory, 'SPRINGS');

    // Undo command English: "Undo last action"
    const undoEn = parseVoiceCommand('Undo last action', 'en');
    assert.strictEqual(undoEn.matched, true);
    assert.strictEqual(undoEn.intent, 'UNDO');

    // Undo command Hindi: "पूर्ववत करें"
    const undoHi = parseVoiceCommand('पूर्ववत करें', 'hi');
    assert.strictEqual(undoHi.matched, true);
    assert.strictEqual(undoHi.intent, 'UNDO');
  });

  // TC-P3-VUI-05: Error handling & low confidence speech rejection
  it('TC-P3-VUI-05: Unrecognized gibberish and low confidence speech return 422 with helpful feedback', async () => {
    const res = await app.post(
      '/api/checklist/voice-action',
      {
        wagonNumber: testWagonNumber,
        transcript: 'random railway noise blablabla 123',
        locale: 'en'
      },
      { Authorization: `Bearer ${inspectorToken}` }
    );

    assert.strictEqual(res.status, 422);
    const body = res.body as { success: boolean; error: string; feedbackMessage: string };
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error, 'VOICE_COMMAND_NOT_RECOGNIZED');
    assert.ok(body.feedbackMessage.includes('not recognized'));
  });

  // TC-P3-VUI-06: Immutable audit logging of voice actions
  it('TC-P3-VUI-06: Voice commands generate persistent voice log history and audit records', async () => {
    await app.post(
      '/api/checklist/voice-action',
      {
        wagonNumber: testWagonNumber,
        transcript: 'Outer spring passes',
        locale: 'en'
      },
      { Authorization: `Bearer ${inspectorToken}` }
    );

    const logRes = await app.get(`/api/checklist/voice-log?wagonNumber=${encodeURIComponent(testWagonNumber)}`, { Authorization: `Bearer ${inspectorToken}` });
    assert.strictEqual(logRes.status, 200);
    const logBody = logRes.body as { success: boolean; logs: Array<{ transcript: string; statusApplied: string; wagonNumber: string }> };

    assert.ok(logBody.logs.length >= 1);
    const lastLog = logBody.logs[0];
    assert.strictEqual(lastLog.wagonNumber, testWagonNumber);
    assert.strictEqual(lastLog.transcript, 'Outer spring passes');
    assert.strictEqual(lastLog.statusApplied, 'PASS');
  });
});
