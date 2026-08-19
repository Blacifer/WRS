/**
 * Tier 1 Test Suite — Feature R3: Smart Acoustic Bearing & Leak Detection
 * Indian Railways WRS Raipur (Phase 3)
 *
 * Verifies Web Audio API spectral analysis, high-frequency pneumatic leak detection (>4kHz),
 * bearing defect harmonic pulse detection, ambient noise rejection, and Final QC Gate blocker integration.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { TestApp } from '../../harness/test_app.ts';
import { MockAudioContext, MockAnalyserNode, evaluateAcousticSpectrum } from '../../harness/audio_mock.ts';
import type { GateStatusResponse, WagonRecord } from '../../../shared/types.ts';

describe('Tier 1 — Phase 3 Feature R3: Smart Acoustic Bearing & Leak Detection', () => {
  let app: TestApp;
  let inspectorToken: string;
  let supervisorToken: string;
  const testWagonNumber = 'SECR/BOXNHL/77123';

  beforeEach(async () => {
    app = new TestApp(':memory:');

    const inspLogin = await app.post('/api/auth/login', { username: 'inspector1', password: 'password123' });
    inspectorToken = (inspLogin.body as { token: string }).token;

    const supLogin = await app.post('/api/auth/login', { username: 'supervisor1', password: 'password123' });
    supervisorToken = (supLogin.body as { token: string }).token;

    // Register wagon and transition to Stage 6 (FINAL_QC_GATE)
    await app.post(
      '/api/wagons/register',
      {
        wagonNumber: testWagonNumber,
        wagonType: 'BOXNHL',
        owningRailway: 'SECR',
        entryNotes: 'Final QC Acoustic Diagnostics Test'
      },
      { Authorization: `Bearer ${inspectorToken}` }
    );

    await app.post(`/api/wagons/${encodeURIComponent(testWagonNumber)}/transition`, { targetStage: 'DISMANTLING' }, { Authorization: `Bearer ${inspectorToken}` });
    await app.post(`/api/wagons/${encodeURIComponent(testWagonNumber)}/transition`, { targetStage: 'COMPONENT_INSPECTION' }, { Authorization: `Bearer ${inspectorToken}` });
    await app.post(`/api/wagons/${encodeURIComponent(testWagonNumber)}/transition`, { targetStage: 'REPAIR_REPLACEMENT' }, { Authorization: `Bearer ${inspectorToken}` });
    await app.post(`/api/wagons/${encodeURIComponent(testWagonNumber)}/transition`, { targetStage: 'REASSEMBLY' }, { Authorization: `Bearer ${inspectorToken}` });
    await app.post(`/api/wagons/${encodeURIComponent(testWagonNumber)}/transition`, { targetStage: 'FINAL_QC_GATE' }, { Authorization: `Bearer ${inspectorToken}` });
  });

  // TC-P3-ACU-01: Web Audio API FFT & waveform buffer extraction
  it('TC-P3-ACU-01: Web Audio API context initializes 1024-bin FFT spectrum and time-domain oscilloscope', async () => {
    const audioCtx = new MockAudioContext();
    assert.strictEqual(audioCtx.state, 'running');
    assert.strictEqual(audioCtx.sampleRate, 44100);

    const analyser = audioCtx.createAnalyser();
    assert.strictEqual(analyser.fftSize, 2048);
    assert.strictEqual(analyser.frequencyBinCount, 1024);

    const freqData = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(freqData);
    assert.strictEqual(freqData.length, 1024);

    const timeData = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(timeData);
    assert.strictEqual(timeData.length, 2048);
  });

  // TC-P3-ACU-02: Air brake pneumatic leak detection (>4kHz continuous hiss)
  it('TC-P3-ACU-02: High-frequency continuous acoustic signal flags AIR_LEAK with confidence >= 0.90', async () => {
    const analyser = new MockAnalyserNode();
    analyser.setSyntheticSignal('AIR_LEAK', { frequencyHz: 5500, peakDb: -20 });

    const result = evaluateAcousticSpectrum(analyser);

    assert.strictEqual(result.isAnomalyDetected, true);
    assert.strictEqual(result.anomalyType, 'AIR_LEAK');
    assert.ok(result.dominantFrequencyHz >= 4000, `Expected dominant frequency >= 4000Hz, got ${result.dominantFrequencyHz}Hz`);
    assert.ok(result.confidence >= 0.90, `Expected confidence >= 0.90, got ${result.confidence}`);
    assert.ok(result.recommendedAction.includes('pneumatic leak') || result.recommendedAction.includes('brake'));
  });

  // TC-P3-ACU-03: Bearing defect harmonic pulse detection (2.4kHz resonance)
  it('TC-P3-ACU-03: Periodic bearing acoustic resonance flags BEARING_DEFECT with confidence >= 0.88', async () => {
    const analyser = new MockAnalyserNode();
    analyser.setSyntheticSignal('BEARING_DEFECT', { frequencyHz: 2400, pulseRateHz: 24 });

    const result = evaluateAcousticSpectrum(analyser);

    assert.strictEqual(result.isAnomalyDetected, true);
    assert.strictEqual(result.anomalyType, 'BEARING_DEFECT');
    assert.ok(result.dominantFrequencyHz >= 1800 && result.dominantFrequencyHz <= 3500);
    assert.ok(result.confidence >= 0.88);
    assert.ok(result.recommendedAction.includes('CTRB') || result.recommendedAction.includes('Bearing'));
  });

  // TC-P3-ACU-04: Ambient workshop background noise rejection
  it('TC-P3-ACU-04: Ambient workshop background noise returns NONE with zero defect false positives', async () => {
    const analyser = new MockAnalyserNode();
    analyser.setSyntheticSignal('AMBIENT');

    const result = evaluateAcousticSpectrum(analyser);

    assert.strictEqual(result.isAnomalyDetected, false);
    assert.strictEqual(result.anomalyType, 'NONE');
    assert.ok(result.recommendedAction.includes('nominal RDSO baseline'));
  });

  // TC-P3-ACU-05: Stage 6 Final QC Gate blocker integration
  it('TC-P3-ACU-05: Detected acoustic anomaly transitions wagon status to BLOCKED and prevents gate release', async () => {
    // 1. Post acoustic leak diagnostic
    const diagRes = await app.post(
      '/api/acoustic/diagnose',
      {
        wagonNumber: testWagonNumber,
        dominantFrequencyHz: 5400,
        peakDb: -18,
        isAnomalyDetected: true,
        anomalyType: 'AIR_LEAK',
        confidence: 0.96,
        recommendedAction: 'Replace leaking auxiliary reservoir gasket'
      },
      { Authorization: `Bearer ${inspectorToken}` }
    );

    assert.strictEqual(diagRes.status, 200);

    // 2. Verify wagon status transitioned to BLOCKED in database
    const wagon = app.auditDb.getWagonByNumber(testWagonNumber);
    assert.ok(wagon);
    assert.strictEqual(wagon.status, 'BLOCKED');
    assert.ok(wagon.conditionNotes?.includes('AIR_LEAK detected'));

    // 3. Verify gate status reports blocker
    const gateRes = await app.get(`/api/wagons/${encodeURIComponent(testWagonNumber)}/gate/status`, { Authorization: `Bearer ${supervisorToken}` });
    assert.strictEqual(gateRes.status, 200);
    const gateBody = gateRes.body as GateStatusResponse;
    assert.strictEqual(gateBody.canRelease, false);
  });
});
