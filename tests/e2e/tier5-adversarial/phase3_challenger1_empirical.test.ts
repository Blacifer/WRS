/**
 * Tier 5 Adversarial Suite — Phase 3 Challenger 1 Empirical Test & Edge Case Harness
 * Indian Railways WRS Raipur (Phase 3: The Holy Grail)
 *
 * Empirical verification of:
 * 1. QR scanner decoding malformed/corrupted QR strings vs valid URI/JSON formats.
 * 2. Component reassignment rules (condemned parts, cross-wagon transfer provenance, redundant unassignments).
 * 3. Voice command parser with rapid spoken phrases, low confidence noise, and Hinglish dictation.
 * 4. Acoustic frequency boundaries (normal ambient noise vs pneumatic leak >4kHz vs bearing defect harmonics).
 * 5. OMRS sensor threshold breaches and automated Stores Depot reservations.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { TestApp } from '../../harness/test_app.ts';
import { encodeComponentQR, decodeComponentQR, MockQRDetector } from '../../harness/qr_mock.ts';
import { MockSpeechRecognition } from '../../harness/speech_mock.ts';
import { MockAnalyserNode, MockAudioContext } from '../../harness/audio_mock.ts';
import { parseVoiceCommand, normalizeTranscript, detectLanguage, convertDevanagariDigits } from '../../../client/src/utils/voiceCommandParser.ts';
import { AcousticDiagnosticEngine } from '../../../client/src/utils/acousticEngine.ts';
import { ComponentRepository, calculateHealthStatus } from '../../../server/src/db/componentRepository.ts';
import { OMRSRepository } from '../../../server/src/db/omrsRepository.ts';
import { InventoryRepository } from '../../../server/src/db/inventoryRepository.ts';
import { WagonRepository } from '../../../server/src/db/wagonRepository.ts';
import { runMigrations } from '../../../server/src/db/migrations.ts';
import type {
  SerializedComponent,
  ComponentHistoryEvent,
  ChecklistItem,
  AcousticAnomalyType,
  StoresPart,
  InventoryReservation
} from '../../../shared/types.ts';

describe('Tier 5 Adversarial — Phase 3 Challenger 1 Empirical & Boundary Sweeps', () => {
  let app: TestApp;
  let inspectorToken: string;
  let supervisorToken: string;
  let adminToken: string;

  // Authoritative server database instances for pure repository tests
  let serverDb: DatabaseSync;
  let compRepo: ComponentRepository;
  let omrsRepo: OMRSRepository;
  let invRepo: InventoryRepository;
  let wagonRepo: WagonRepository;

  const wagon1 = 'SECR/BOXNHL/77001';
  const wagon2 = 'SECR/BOXNHL/77002';
  const wagon3 = 'SECR/BOXNHL/77003';

  beforeEach(async () => {
    app = new TestApp(':memory:');

    // Initialize authoritative server SQLite database with full migration schema
    serverDb = new DatabaseSync(':memory:');
    runMigrations(serverDb);

    compRepo = new ComponentRepository(serverDb);
    omrsRepo = new OMRSRepository(serverDb);
    invRepo = new InventoryRepository(serverDb);
    wagonRepo = new WagonRepository(serverDb);

    // Authenticate users on TestApp
    const inspLogin = await app.post('/api/auth/login', { username: 'inspector1', password: 'password123' });
    inspectorToken = (inspLogin.body as { token: string }).token;

    const supLogin = await app.post('/api/auth/login', { username: 'supervisor1', password: 'password123' });
    supervisorToken = (supLogin.body as { token: string }).token;

    const adminLogin = await app.post('/api/auth/login', { username: 'admin1', password: 'password123' });
    adminToken = (adminLogin.body as { token: string }).token;

    // Register test wagons on both TestApp and serverDb
    for (const w of [wagon1, wagon2, wagon3]) {
      await app.post(
        '/api/wagons/register',
        { wagonNumber: w, wagonType: 'BOXNHL', owningRailway: 'SECR' },
        { Authorization: `Bearer ${inspectorToken}` }
      );
      wagonRepo.registerWagon({
        wagonNumber: w,
        wagonType: 'BOXNHL',
        owningRailway: 'SECR',
        createdBy: 'usr_insp_001'
      });
    }
  });

  // =========================================================================
  // SECTION 1: QR SCANNER DECODING MALFORMED/CORRUPTED VS VALID PROTOCOLS
  // =========================================================================
  describe('1. Empirical QR Scanner Decoding: Corrupted vs Valid Protocols', () => {
    const detector = new MockQRDetector();

    it('CHAL1-QR-01: Correctly decodes valid URI, JSON, and Raw Barcode formats', async () => {
      // 1. Valid URI format
      const uri = 'WRS-PASSPORT://v1?sn=WRS-WS-2026-001&type=WHEELSET&mfg=RWF%20Yelahanka&date=2026-01-15';
      const decodedUri = decodeComponentQR(uri);
      assert.strictEqual(decodedUri.serialNumber, 'WRS-WS-2026-001');
      assert.strictEqual(decodedUri.componentType, 'WHEELSET');
      assert.strictEqual(decodedUri.manufacturer, 'RWF Yelahanka');

      // 2. Valid JSON format
      const json = JSON.stringify({
        serialNumber: 'WRS-DG-2026-015',
        componentType: 'DRAFT_GEAR',
        manufacturer: 'Miner Enterprises',
        manufacturingDate: '2025-11-20'
      });
      const decodedJson = decodeComponentQR(json);
      assert.strictEqual(decodedJson.serialNumber, 'WRS-DG-2026-015');
      assert.strictEqual(decodedJson.componentType, 'DRAFT_GEAR');
      assert.strictEqual(decodedJson.manufacturer, 'Miner Enterprises');

      // 3. Valid Raw Barcode format
      const raw = 'WRS-BLS-2026-088';
      const decodedRaw = decodeComponentQR(raw);
      assert.strictEqual(decodedRaw.serialNumber, 'WRS-BLS-2026-088');
    });

    it('CHAL1-QR-02: Rejects corrupted URIs with missing required fields', () => {
      const corruptedUris = [
        'WRS-PASSPORT://v1', // No query parameters
        'WRS-PASSPORT://v1?mfg=RWF', // Missing sn and type
        'WRS-PASSPORT://v1?sn=&type=WHEELSET', // Empty sn
        'WRS-PASSPORT://v1?sn=WRS-WS-123&type=' // Empty type
      ];

      for (const badUri of corruptedUris) {
        assert.throws(
          () => decodeComponentQR(badUri),
          /MALFORMED_QR/,
          `Expected MALFORMED_QR error for: ${badUri}`
        );
      }
    });

    it('CHAL1-QR-03: Rejects malformed JSON with syntax errors, empty serials, or missing keys', () => {
      const corruptedJsons = [
        '{', // Truncated
        '{"serialNumber": "WRS-WS-123"', // Missing closing brace
        '{"serialNumber": ""}', // Empty serial
        '{"serialNumber": null, "componentType": "BEARING"}', // Null serial
        '{"type": "WHEELSET"}' // Missing serial
      ];

      for (const badJson of corruptedJsons) {
        assert.throws(
          () => decodeComponentQR(badJson),
          /MALFORMED_QR/,
          `Expected MALFORMED_QR error for bad JSON: ${badJson}`
        );
      }
    });

    it('CHAL1-QR-04: Resolves registered component via /api/components/scan-qr and handles 404 for unregistered', async () => {
      // Register component
      await app.post(
        '/api/components/register',
        {
          serialNumber: 'WRS-CTRB-9988',
          componentType: 'BEARING',
          category: 'BEARINGS',
          partName: 'NEI CTRB Bearing',
          manufacturer: 'NEI Jaipur'
        },
        { Authorization: `Bearer ${inspectorToken}` }
      );

      // Scan QR with URI format
      const scanUri = 'WRS-PASSPORT://v1?sn=WRS-CTRB-9988&type=BEARING&mfg=NEI%20Jaipur';
      const scanRes = await app.post(
        '/api/components/scan-qr',
        { qrPayload: scanUri },
        { Authorization: `Bearer ${inspectorToken}` }
      );
      assert.strictEqual(scanRes.status, 200);
      assert.strictEqual((scanRes.body as any).component.serialNumber, 'WRS-CTRB-9988');

      // Scan unregistered component
      const unregUri = 'WRS-PASSPORT://v1?sn=WRS-UNKNOWN-0000&type=BEARING&mfg=UNKNOWN';
      const unregRes = await app.post(
        '/api/components/scan-qr',
        { qrPayload: unregUri },
        { Authorization: `Bearer ${inspectorToken}` }
      );
      assert.strictEqual(unregRes.status, 404);
      assert.strictEqual((unregRes.body as any).success, false);
      assert.ok((unregRes.body as any).error.includes('COMPONENT_NOT_FOUND'));
    });
  });

  // =========================================================================
  // SECTION 2: COMPONENT REASSIGNMENT RULES & PROVENANCE TRACKING
  // =========================================================================
  describe('2. Empirical Component Reassignment & State Machine Rules', () => {
    it('CHAL1-COMP-01: Health score degradation matrix, CONDEMNED transition, and overhaul restoration', () => {
      // 1. Register component via ComponentRepository on serverDb
      const comp = compRepo.registerComponent({
        serialNumber: 'WRS-BRG-HEALTH-01',
        componentType: 'BEARING',
        category: 'BEARINGS',
        partName: 'Class E CTRB Bearing',
        manufacturer: 'NEI Jaipur',
        healthScore: 100
      });
      assert.strictEqual(comp.healthScore, 100);
      assert.strictEqual(comp.healthStatus, 'EXCELLENT');

      // 2. Degrade health score to 50 (ATTENTION_REQUIRED)
      const updated1 = compRepo.updateHealthScore('WRS-BRG-HEALTH-01', 50, 'Spalling observed on raceway');
      assert.strictEqual(updated1.healthScore, 50);
      assert.strictEqual(updated1.healthStatus, 'ATTENTION_REQUIRED');

      // 3. Degrade health score to 0 -> status automatically transitions to CONDEMNED
      const updated2 = compRepo.updateHealthScore('WRS-BRG-HEALTH-01', 0, 'Severe cage fracture and roller seizure');
      assert.strictEqual(updated2.healthScore, 0);
      assert.strictEqual(updated2.healthStatus, 'CRITICAL');
      assert.strictEqual(updated2.status, 'CONDEMNED');

      // 4. Overhaul (POH) restoration restores health to 100% and status to RECONDITIONED
      const recond = compRepo.recordOverhaul('WRS-BRG-HEALTH-01', '2026-08-17', undefined, 100, 'Complete overhaul and new roller set');
      assert.strictEqual(recond.status, 'RECONDITIONED');
      assert.strictEqual(recond.healthScore, 100);
      assert.strictEqual(recond.healthStatus, 'EXCELLENT');
      assert.strictEqual(recond.overhaulCount, 1);
    });

    it('CHAL1-COMP-02: Direct reassignment of in-service part from Wagon 1 to Wagon 2 updates provenance', async () => {
      // 1. Register Wheelset
      await app.post(
        '/api/components/register',
        {
          serialNumber: 'WRS-WS-XFER-99',
          componentType: 'WHEELSET',
          category: 'WHEELS_AXLES',
          partName: 'CASNUB Wheelset 1000mm',
          manufacturer: 'RWF Yelahanka'
        },
        { Authorization: `Bearer ${inspectorToken}` }
      );

      // 2. Assign to Wagon 1 (BOGIE_1)
      const assign1 = await app.post(
        '/api/components/WRS-WS-XFER-99/assign',
        { wagonNumber: wagon1, bogiePosition: 'BOGIE_1', stage: 'REASSEMBLY' },
        { Authorization: `Bearer ${inspectorToken}` }
      );
      assert.strictEqual(assign1.status, 200);

      // Verify Wagon 1 manifest includes it
      const w1Comps = await app.get(`/api/components?wagonNumber=${encodeURIComponent(wagon1)}`, { Authorization: `Bearer ${inspectorToken}` });
      const comps1 = (w1Comps.body as any).components || (w1Comps.body as any).data;
      assert.strictEqual(comps1.length, 1);
      assert.strictEqual(comps1[0].serialNumber, 'WRS-WS-XFER-99');

      // 3. Directly reassign to Wagon 2 (BOGIE_2)
      const assign2 = await app.post(
        '/api/components/WRS-WS-XFER-99/assign',
        { wagonNumber: wagon2, bogiePosition: 'BOGIE_2', stage: 'REPAIR_REPLACEMENT', notes: 'Transferred during emergency wheelset swap' },
        { Authorization: `Bearer ${inspectorToken}` }
      );
      assert.strictEqual(assign2.status, 200);

      // 4. Verify Wagon 1 manifest is now empty for this part, and Wagon 2 manifest has it
      const w1CompsAfter = await app.get(`/api/components?wagonNumber=${encodeURIComponent(wagon1)}`, { Authorization: `Bearer ${inspectorToken}` });
      const comps1After = (w1CompsAfter.body as any).components || (w1CompsAfter.body as any).data;
      assert.strictEqual(comps1After.length, 0);

      const w2CompsAfter = await app.get(`/api/components?wagonNumber=${encodeURIComponent(wagon2)}`, { Authorization: `Bearer ${inspectorToken}` });
      const comps2After = (w2CompsAfter.body as any).components || (w2CompsAfter.body as any).data;
      assert.strictEqual(comps2After.length, 1);
      assert.strictEqual(comps2After[0].serialNumber, 'WRS-WS-XFER-99');
      assert.strictEqual(comps2After[0].currentBogiePosition, 'BOGIE_2');

      // 5. Verify history trail
      const histRes = await app.get('/api/components/WRS-WS-XFER-99/history', { Authorization: `Bearer ${inspectorToken}` });
      const events = (histRes.body as any).history || (histRes.body as any).data;
      assert.ok(events.length >= 3);
      assert.strictEqual(events[0].eventType, 'MANUFACTURED');
      assert.strictEqual(events[1].eventType, 'ASSIGNED_TO_WAGON');
      assert.strictEqual(events[1].wagonNumber, wagon1);
    });

    it('CHAL1-COMP-03: Redundant unassignments on already unassigned component remain stable', async () => {
      // Register component
      await app.post(
        '/api/components/register',
        {
          serialNumber: 'WRS-DG-UNASSIGN-01',
          componentType: 'DRAFT_GEAR',
          category: 'COUPLERS_DRAFT_GEAR',
          partName: 'Mark-50 Draft Gear'
        },
        { Authorization: `Bearer ${inspectorToken}` }
      );

      // First unassign (already in stores)
      const res1 = await app.post(
        '/api/components/WRS-DG-UNASSIGN-01/unassign',
        { reason: 'Routine audit check' },
        { Authorization: `Bearer ${inspectorToken}` }
      );
      assert.strictEqual(res1.status, 200);
      assert.strictEqual((res1.body as any).component.status, 'AVAILABLE_IN_STORES');
      assert.strictEqual((res1.body as any).component.currentWagonNumber, null);

      // Second unassign (redundant)
      const res2 = await app.post(
        '/api/components/WRS-DG-UNASSIGN-01/unassign',
        { reason: 'Duplicate call test' },
        { Authorization: `Bearer ${inspectorToken}` }
      );
      assert.strictEqual(res2.status, 200);
      assert.strictEqual((res2.body as any).component.status, 'AVAILABLE_IN_STORES');
    });
  });

  // =========================================================================
  // SECTION 3: VOICE COMMAND PARSER (RAPID, NOISE, HINGLISH DICTATION)
  // =========================================================================
  describe('3. Empirical Voice Command Parser & Hinglish Robustness', () => {
    it('CHAL1-VOICE-01: Parses Hinglish colloquial dictation phrases accurately', () => {
      // 1. "Bahar ka spring pass hai"
      const res1 = parseVoiceCommand('Bahar ka spring pass hai');
      assert.strictEqual(res1.matched, true);
      assert.strictEqual(res1.intent, 'UPDATE_STATUS');
      assert.strictEqual(res1.status, 'PASS');
      assert.strictEqual(res1.targetCategory, 'SPRINGS');
      assert.strictEqual(res1.targetPartName, 'Outer Spring');

      // 2. "Andar ka spring badal diya"
      const res2 = parseVoiceCommand('Andar ka spring badal diya');
      assert.strictEqual(res2.matched, true);
      assert.strictEqual(res2.intent, 'UPDATE_STATUS');
      assert.strictEqual(res2.status, 'REPLACED');
      assert.strictEqual(res2.targetCategory, 'SPRINGS');
      assert.strictEqual(res2.targetPartName, 'Inner Spring');

      // 3. "Snubber coil toota hua hai"
      const res3 = parseVoiceCommand('Snubber coil toota hua hai');
      assert.strictEqual(res3.matched, true);
      assert.strictEqual(res3.intent, 'UPDATE_STATUS');
      assert.strictEqual(res3.status, 'CONDEMNED');
      assert.strictEqual(res3.targetCategory, 'SPRINGS');
      assert.strictEqual(res3.targetPartName, 'Snubber Spring');
      assert.ok(res3.defectNotes?.includes('Broken / chipped component'));

      // 4. "Friction wedge kharab hai"
      const res4 = parseVoiceCommand('Friction wedge kharab hai');
      assert.strictEqual(res4.matched, true);
      assert.strictEqual(res4.intent, 'UPDATE_STATUS');
      assert.strictEqual(res4.status, 'CONDEMNED');
      assert.strictEqual(res4.targetCategory, 'FRICTION_WEDGES');

      // 5. "Piche lo" / "Wapas lo" (Undo)
      const res5 = parseVoiceCommand('Piche lo');
      assert.strictEqual(res5.matched, true);
      assert.strictEqual(res5.intent, 'UNDO');
      assert.strictEqual(res5.actionType, 'UNDO');

      const res6 = parseVoiceCommand('Wapas lo');
      assert.strictEqual(res6.matched, true);
      assert.strictEqual(res6.intent, 'UNDO');
    });

    it('CHAL1-VOICE-02: Handles height measurements and bogie parameter dictation', () => {
      // Western digits: "height 260.5 mm"
      const res1 = parseVoiceCommand('height 260.5 mm');
      assert.strictEqual(res1.matched, true);
      assert.strictEqual(res1.intent, 'CLASSIFY_SPRING');
      assert.strictEqual((res1 as any).springParams.measuredHeight, 260.5);

      // Devanagari digits integer height: "ऊंचाई २६० मिमी"
      const res2 = parseVoiceCommand('ऊंचाई २६० मिमी');
      assert.strictEqual(res2.matched, true);
      assert.strictEqual(res2.intent, 'CLASSIFY_SPRING');
      assert.strictEqual((res2 as any).springParams.measuredHeight, 260);

      // Bogie selection: "nlb bogie"
      const res3 = parseVoiceCommand('nlb bogie');
      assert.strictEqual(res3.matched, true);
      assert.strictEqual(res3.intent, 'CLASSIFY_SPRING');
      assert.strictEqual((res3 as any).springParams.bogieType, 'CASNUB_22_NLB');
    });

    it('CHAL1-VOICE-03: Rejects ambient noise, unrecognized words, and empty inputs gracefully', () => {
      const noisyInputs = [
        '',
        '   ',
        'random workshop background chatter bang 1234',
        'testing one two three four',
        'ha ha ha noisy room'
      ];

      for (const noise of noisyInputs) {
        const res = parseVoiceCommand(noise);
        assert.strictEqual(res.intent, 'UNKNOWN', `Expected UNKNOWN intent for noise: "${noise}"`);
        assert.ok(res.confidence <= 0.65);
      }
    });
  });

  // =========================================================================
  // SECTION 4: ACOUSTIC FREQUENCY BOUNDARIES & DSP ANALYSIS
  // =========================================================================
  describe('4. Empirical Acoustic Frequency Boundaries (Ambient vs Leak >4kHz vs Bearing Defect)', () => {
    it('CHAL1-ACOUSTIC-01: Frequency & DSP thresholds distinguish Ambient vs Leak vs Bearing Defect', () => {
      // 1. Baseline Ambient Workshop Noise: Low frequency, low dB
      const mockAnalyser = new MockAnalyserNode(44100);
      mockAnalyser.setSyntheticSignal('AMBIENT');
      const freqData = new Uint8Array(1024);
      mockAnalyser.getByteFrequencyData(freqData);

      // Verify ambient energy is low across all bands (< 65/255)
      let maxAmbient = 0;
      for (let i = 0; i < 1024; i++) {
        if (freqData[i] > maxAmbient) maxAmbient = freqData[i];
      }
      assert.ok(maxAmbient <= 65, `Expected ambient noise <= 65, got ${maxAmbient}`);

      // 2. High Frequency Pneumatic Air Leak (>4.5 kHz)
      mockAnalyser.setSyntheticSignal('AIR_LEAK', { frequencyHz: 5500, peakDb: -20 });
      mockAnalyser.getByteFrequencyData(freqData);

      const binWidth = 22050 / 1024;
      let highBandEnergy = 0;
      let totalEnergy = 0;
      for (let i = 0; i < 1024; i++) {
        const f = i * binWidth;
        const pwr = freqData[i] * freqData[i];
        totalEnergy += pwr;
        if (f >= 4500 && f <= 8500) highBandEnergy += pwr;
      }
      const ratio = highBandEnergy / totalEnergy;
      assert.ok(ratio > 0.35, `Expected highFreqPowerRatio > 0.35 for AIR_LEAK, got ${ratio.toFixed(2)}`);

      // 3. Periodic Bearing Defect Harmonic Pulse (2400 Hz resonant peak)
      mockAnalyser.setSyntheticSignal('BEARING_DEFECT', { frequencyHz: 2400, peakDb: -22 });
      mockAnalyser.getByteFrequencyData(freqData);

      let maxBinIdx = 0;
      let maxVal = 0;
      for (let i = 0; i < 1024; i++) {
        if (freqData[i] > maxVal) {
          maxVal = freqData[i];
          maxBinIdx = i;
        }
      }
      const dominantFreq = maxBinIdx * binWidth;
      assert.ok(dominantFreq >= 2000 && dominantFreq <= 2800, `Expected dominant frequency ~2400 Hz for bearing defect, got ${dominantFreq}`);
    });

    it('CHAL1-ACOUSTIC-02: Acoustic diagnostic records anomaly and persists in repository', () => {
      // Record acoustic diagnostic via WagonRepository directly on serverDb
      const result = wagonRepo.recordAcousticDiagnostic({
        wagonNumber: wagon1,
        dominantFrequencyHz: 5200,
        peakDb: 78.5,
        anomalyType: 'AIR_LEAK',
        confidence: 0.96,
        details: 'High-frequency pneumatic air leak detected in train brake pipe'
      });

      assert.strictEqual(result.diagnosticResult.anomalyType, 'AIR_LEAK');
      assert.strictEqual(result.gateBlocked, true);
      assert.ok(result.blockers.some(b => b.includes('Air Hose') || b.includes('FAIL') || b.includes('BRAKE_SYSTEM')));

      // Query acoustic diagnostic history
      const history = wagonRepo.getAcousticDiagnostics(wagon1);
      assert.strictEqual(history.length, 1);
      assert.strictEqual(history[0].anomalyType, 'AIR_LEAK');
      assert.strictEqual(history[0].dominantFrequencyHz, 5200);
    });
  });

  // =========================================================================
  // SECTION 5: OMRS SENSOR THRESHOLD BREACHES & STORES AUTO-RESERVATION
  // =========================================================================
  describe('5. Empirical OMRS Sensor Threshold Sweeps & Stores Depot Reservation', () => {
    it('CHAL1-OMRS-01: Evaluates exact BVA threshold boundaries across WILD, ABD, HABD, and Flange sensors', () => {
      // Boundary 1: WILD (<=100 normal, 101-130 advisory, >130 critical)
      const normalWild = omrsRepo.evaluateTelemetryDefects({ wheelImpactKn: 99 });
      assert.strictEqual(normalWild.length, 0);

      const advWild = omrsRepo.evaluateTelemetryDefects({ wheelImpactKn: 105 });
      assert.strictEqual(advWild.length, 1);
      assert.strictEqual(advWild[0].severity, 'ADVISORY');
      assert.strictEqual(advWild[0].recommendedPartCode, 'PRT-WHL-BOXNHL');

      const critWild = omrsRepo.evaluateTelemetryDefects({ wheelImpactKn: 135 });
      assert.strictEqual(critWild.length, 1);
      assert.strictEqual(critWild[0].severity, 'CRITICAL');
      assert.strictEqual(critWild[0].recommendedPartCode, 'PRT-WHL-BOXNHL');

      // Boundary 2: ABD (<=70 normal, 71-80 advisory, >80 critical)
      const normalAbd = omrsRepo.evaluateTelemetryDefects({ acousticBearingPeakDb: 68 });
      assert.strictEqual(normalAbd.length, 0);

      const advAbd = omrsRepo.evaluateTelemetryDefects({ acousticBearingPeakDb: 75 });
      assert.strictEqual(advAbd.length, 1);
      assert.strictEqual(advAbd[0].severity, 'ADVISORY');
      assert.strictEqual(advAbd[0].recommendedPartCode, 'PRT-BRG-CTRB');

      const critAbd = omrsRepo.evaluateTelemetryDefects({ acousticBearingPeakDb: 85 });
      assert.strictEqual(critAbd.length, 1);
      assert.strictEqual(critAbd[0].severity, 'CRITICAL');
      assert.strictEqual(critAbd[0].quantity, 2);

      // Boundary 3: HABD (<=60 normal, 61-75 advisory, >75 critical)
      const normalHabd = omrsRepo.evaluateTelemetryDefects({ temperatureCelsius: 58 });
      assert.strictEqual(normalHabd.length, 0);

      const advHabd = omrsRepo.evaluateTelemetryDefects({ temperatureCelsius: 68 });
      assert.strictEqual(advHabd.length, 1);
      assert.strictEqual(advHabd[0].quantity, 2);

      const critHabd = omrsRepo.evaluateTelemetryDefects({ temperatureCelsius: 82 });
      assert.strictEqual(critHabd.length, 1);
      assert.strictEqual(critHabd[0].quantity, 4);

      // Boundary 4: Flange Deviation (<=3.5 normal, 3.6-5.0 advisory, >5.0 critical)
      const normalFlange = omrsRepo.evaluateTelemetryDefects({ wheelProfileDeviationMm: 3.2 });
      assert.strictEqual(normalFlange.length, 0);

      const advFlange = omrsRepo.evaluateTelemetryDefects({ wheelProfileDeviationMm: 4.0 });
      assert.strictEqual(advFlange.length, 1);
      assert.strictEqual(advFlange[0].severity, 'ADVISORY');

      const critFlange = omrsRepo.evaluateTelemetryDefects({ wheelProfileDeviationMm: 5.8 });
      assert.strictEqual(critFlange.length, 1);
      assert.strictEqual(critFlange[0].severity, 'CRITICAL');
    });

    it('CHAL1-OMRS-02: End-to-end AI triage triggers auto-reservations and stores part issuance decrements stock', () => {
      // Seed stores inventory part for OMRS on serverDb
      serverDb.prepare(`
        INSERT OR REPLACE INTO stores_inventory (
          id, part_code, part_name, category, unit_of_measure,
          stock_quantity, reserved_quantity, reorder_threshold,
          unit_cost_inr, bin_location, supplier_name, updated_at
        ) VALUES (
          'seed_whl_01', 'PRT-WHL-BOXNHL', 'CASNUB Wheelset 1000mm', 'WHEELS_AXLES', 'NOS',
          25, 0, 5, 85000, 'BAY-W-01', 'RWF Yelahanka', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        ),
        (
          'seed_brg_01', 'PRT-BRG-CTRB', 'CTRB Bearing Class E', 'BEARINGS', 'NOS',
          40, 0, 10, 18500, 'BAY-B-01', 'NEI Jaipur', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        )
      `).run();

      const initialWhl = invRepo.getPartByCode('PRT-WHL-BOXNHL')!;
      assert.strictEqual(initialWhl.stockQuantity, 25);
      assert.strictEqual(initialWhl.reservedQuantity, 0);

      // Record critical OMRS scan for Wagon 3
      omrsRepo.recordScan({
        wagonNumber: wagon3,
        trainSpeedKmph: 72.0,
        wheelImpactKn: 145.0, // Critical -> reserves 1 PRT-WHL-BOXNHL
        acousticBearingPeakDb: 84.0, // Critical -> reserves 2 PRT-BRG-CTRB
        temperatureCelsius: 55.0,
        wheelProfileDeviationMm: 2.1
      });

      // Execute AI Triage
      const triageResult = omrsRepo.runAITriage(wagon3, invRepo);
      assert.strictEqual(triageResult.scan.triageSeverity, 'CRITICAL_TRIAGE');
      assert.ok(triageResult.reservations.length >= 2);

      // Verify reserved quantity incremented in stores
      const whlAfterTriage = invRepo.getPartByCode('PRT-WHL-BOXNHL')!;
      assert.strictEqual(whlAfterTriage.reservedQuantity, 1);
      assert.strictEqual(whlAfterTriage.availableQuantity, 24);

      // Issue reservation to the floor
      const whlReservation = triageResult.reservations.find(r => r.partCode === 'PRT-WHL-BOXNHL')!;
      const issueResult = invRepo.issuePart(whlReservation.id);
      assert.strictEqual(issueResult.reservation.status, 'ISSUED_TO_FLOOR');
      assert.strictEqual(issueResult.part.stockQuantity, 24);
      assert.strictEqual(issueResult.part.reservedQuantity, 0);

      // Duplicate issuance attempt on already issued reservation throws error
      assert.throws(
        () => invRepo.issuePart(whlReservation.id),
        /already been issued/
      );
    });
  });
});
