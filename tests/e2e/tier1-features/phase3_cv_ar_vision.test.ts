/**
 * Tier 1 Test Suite — Feature R2: Direct Computer Vision Measurement & AR Simulation
 * Indian Railways WRS Raipur (Phase 3)
 *
 * Verifies MediaDevices webcam capture stream, bounding box detection, AR calipers,
 * RDSO Tables 28-33 tolerance classification, and 1-click snapshot evidence capture.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { TestApp } from '../../harness/test_app.ts';
import { MockMediaDevices, simulateCVDetection } from '../../harness/camera_mock.ts';
import type { CVDetectionResult } from '../../harness/camera_mock.ts';

describe('Tier 1 — Phase 3 Feature R2: Direct Computer Vision & AR Vision', () => {
  let app: TestApp;
  let inspectorToken: string;
  const testWagonNumber = 'SECR/BOXNHL/44202';

  beforeEach(async () => {
    app = new TestApp(':memory:');

    const inspLogin = await app.post('/api/auth/login', { username: 'inspector1', password: 'password123' });
    inspectorToken = (inspLogin.body as { token: string }).token;

    // Register wagon
    await app.post(
      '/api/wagons/register',
      {
        wagonNumber: testWagonNumber,
        wagonType: 'BOXNHL',
        owningRailway: 'SECR',
        entryNotes: 'CV AR Vision Inspection Bay'
      },
      { Authorization: `Bearer ${inspectorToken}` }
    );
  });

  // TC-P3-CV-01: MediaDevices stream initialization and camera discovery
  it('TC-P3-CV-01: MediaDevices stream initializes 1280x720 video feed with 30fps track settings', async () => {
    const mediaDevices = new MockMediaDevices();
    const stream = await mediaDevices.getUserMedia({ video: true });

    assert.ok(stream);
    assert.strictEqual(stream.active, true);
    const videoTracks = stream.getVideoTracks();
    assert.strictEqual(videoTracks.length, 1);

    const settings = videoTracks[0].getSettings();
    assert.strictEqual(settings.width, 1280);
    assert.strictEqual(settings.height, 720);
    assert.strictEqual(settings.frameRate, 30);

    const devices = await mediaDevices.enumerateDevices();
    assert.ok(devices.length >= 1);
    assert.ok(devices.some(d => d.kind === 'videoinput'));
  });

  // TC-P3-CV-02: Real-time component bounding box detection and dynamic caliper placement
  it('TC-P3-CV-02: Real-time component detection produces bounded coordinates and high confidence', async () => {
    const cvResult: CVDetectionResult = simulateCVDetection('Outer Spring', 'OUTER', 259.0, 'CASNUB_22_NLB');

    assert.ok(cvResult.boundingBox);
    assert.ok(cvResult.boundingBox.x > 0);
    assert.ok(cvResult.boundingBox.y > 0);
    assert.ok(cvResult.boundingBox.width > 0);
    assert.ok(cvResult.boundingBox.height > 0);
    assert.ok(cvResult.confidence >= 0.90);
    assert.ok(cvResult.boundingBox.label.includes('Outer Spring'));
  });

  // TC-P3-CV-03: RDSO Tables 28-33 tolerance classification
  it('TC-P3-CV-03: RDSO Table 28 tolerance evaluation flags nominal height as PASS and worn coil as CONDEMNED', async () => {
    // 1. Nominal / PASS Spring (260.0 mm)
    const passResult = simulateCVDetection('Outer Spring', 'OUTER', 260.0, 'CASNUB_22_NLB');
    assert.strictEqual(passResult.arCaliper.status, 'PASS');
    assert.strictEqual(passResult.arCaliper.dimensionMm, 260.0);
    assert.strictEqual(passResult.arCaliper.nominalMm, 260.0);
    assert.strictEqual(passResult.arCaliper.deltaMm, 0.0);
    assert.strictEqual(passResult.arCaliper.bandColor, 'BLUE');

    // 2. Condemned Spring (241.0 mm, below 245 mm condemnation limit)
    const condResult = simulateCVDetection('Outer Spring', 'OUTER', 241.0, 'CASNUB_22_NLB');
    assert.strictEqual(condResult.arCaliper.status, 'CONDEMNED');
    assert.strictEqual(condResult.arCaliper.dimensionMm, 241.0);
    assert.ok(condResult.arCaliper.deltaMm < 0);
    assert.strictEqual(condResult.arCaliper.toleranceMin, 245);
  });

  // TC-P3-CV-04: AR HUD visual badge rendering and color coding
  it('TC-P3-CV-04: AR HUD overlay renders green badge for in-tolerance and red badge for out-of-tolerance', async () => {
    const passResult = simulateCVDetection('Outer Spring', 'OUTER', 258.5, 'CASNUB_22_NLB');
    assert.strictEqual(passResult.arCaliper.status, 'PASS');
    assert.strictEqual(passResult.arCaliper.hudBadgeColor, '#10B981'); // Emerald green
    assert.ok(passResult.arCaliper.hudBadgeText.includes('PASS'));

    const condResult = simulateCVDetection('Outer Spring', 'OUTER', 240.0, 'CASNUB_22_NLB');
    assert.strictEqual(condResult.arCaliper.status, 'CONDEMNED');
    assert.strictEqual(condResult.arCaliper.hudBadgeColor, '#EF4444'); // Railway red
    assert.ok(condResult.arCaliper.hudBadgeText.includes('CONDEMNED'));
  });

  // TC-P3-CV-05: 1-Click AR snapshot evidence capture & REST API logging
  it('TC-P3-CV-05: 1-Click snapshot sends measurement and watermark evidence to /api/cv/measure', async () => {
    const res = await app.post(
      '/api/cv/measure',
      {
        wagonNumber: testWagonNumber,
        componentType: 'Outer Spring',
        position: 'OUTER',
        measuredHeight: 258.0,
        bogieType: 'CASNUB_22_NLB'
      },
      { Authorization: `Bearer ${inspectorToken}` }
    );

    assert.strictEqual(res.status, 200);
    const body = res.body as { success: boolean; measurement: CVDetectionResult };
    assert.strictEqual(body.success, true);
    assert.ok(body.measurement.snapshotBase64.startsWith('data:image/png;base64,'));
    assert.strictEqual(body.measurement.arCaliper.dimensionMm, 258.0);
    assert.strictEqual(body.measurement.arCaliper.status, 'PASS');

    // Verify measurement is saved in audit db
    const measurements = app.auditDb.getCVMeasurements(testWagonNumber);
    assert.ok(measurements.length >= 1);
    assert.strictEqual(measurements[0].measuredHeight, 258.0);
    assert.strictEqual(measurements[0].status, 'PASS');
  });

  // TC-P3-CV-06: Dual-Channel Context Filter suppresses background human/tool noise and renders dashed amber HUD badges
  it('TC-P3-CV-06: Dual-Channel Context Filter suppresses background human/tool noise and renders dashed amber HUD badges', async () => {
    const noiseCandidates = [
      { class: 'person', score: 0.95, bbox: [50, 60, 180, 420] as [number, number, number, number] },
      { class: 'tool', score: 0.89, bbox: [240, 300, 80, 60] as [number, number, number, number] }
    ];

    const cvResult = simulateCVDetection('Outer Spring', 'OUTER', 260.0, 'CASNUB_22_NLB', noiseCandidates);

    assert.ok(cvResult.contextFilter);
    assert.strictEqual(cvResult.contextFilter.active, true);
    assert.strictEqual(cvResult.contextFilter.noiseObjectsSuppressed.length, 2);
    assert.strictEqual(cvResult.contextFilter.noiseObjectsSuppressed[0].class, 'person');
    assert.strictEqual(cvResult.contextFilter.noiseObjectsSuppressed[1].class, 'tool');

    // Verify HUD noise indicators have dashed amber line and filter badge
    assert.strictEqual(cvResult.contextFilter.hudNoiseIndicators.length, 2);
    const personIndicator = cvResult.contextFilter.hudNoiseIndicators[0];
    assert.ok(personIndicator.badgeText.includes('FILTERED: PERSON (IGNORED)'));
    assert.deepStrictEqual(personIndicator.lineDash, [8, 6]);
    assert.ok(personIndicator.borderColor.includes('245, 158, 11'));

    // Verify HUD top banner
    assert.ok(cvResult.contextFilter.topHudBanner.includes('Context Filter: Active'));
    assert.ok(cvResult.contextFilter.topHudBanner.includes('2 Noise Object(s) Suppressed'));
  });

  // TC-P3-CV-07: Context Filter strictly isolates target component and discards human/tool noise from audit telemetry
  it('TC-P3-CV-07: Context Filter strictly isolates target component and discards human/tool noise from audit telemetry', async () => {
    const noiseCandidates = [
      { class: 'person', score: 0.97, bbox: [40, 50, 200, 480] as [number, number, number, number] },
      { class: 'cell phone', score: 0.92, bbox: [120, 200, 40, 80] as [number, number, number, number] }
    ];

    const cvResult = simulateCVDetection('Outer Spring', 'OUTER', 259.0, 'CASNUB_22_NLB', noiseCandidates);

    // Bounding box must lock onto the railway component, NOT the human or phone
    assert.ok(cvResult.boundingBox.label.includes('CASNUB_22_NLB Outer Spring'));
    assert.strictEqual(cvResult.arCaliper.dimensionMm, 259.0);
    assert.strictEqual(cvResult.arCaliper.status, 'PASS');

    // Watermark metadata in the composite snapshot must certify target isolation
    const metaMatch = cvResult.snapshotBase64.match(/#meta=(.+)$/);
    assert.ok(metaMatch);
    const decodedMeta = JSON.parse(Buffer.from(metaMatch[1], 'base64').toString('utf8'));
    assert.strictEqual(decodedMeta.contextFilterActive, true);
    assert.strictEqual(decodedMeta.noiseSuppressedCount, 2);
    assert.ok(decodedMeta.isolatedTarget.includes('Outer Spring'));
  });

  // TC-P3-CV-08: POST /api/cv/measure records context filter metadata with suppressed noise count
  it('TC-P3-CV-08: POST /api/cv/measure records context filter metadata with suppressed noise count', async () => {
    const res = await app.post(
      '/api/cv/measure',
      {
        wagonNumber: testWagonNumber,
        componentType: 'OUTER_SPRING',
        measuredValue: 260.0,
        bogieType: 'CASNUB_22_NLB',
        condition: 'USED',
        metadata: {
          contextFilterActive: true,
          noiseObjectsFilteredCount: 3,
          noiseCategoriesFiltered: ['person', 'chair', 'backpack'],
          targetComponentIsolated: 'OUTER_SPRING',
          inspectorName: 'QC Inspector 1'
        }
      },
      { Authorization: `Bearer ${inspectorToken}` }
    );

    assert.strictEqual(res.status, 200);
    const body = res.body as {
      success: boolean;
      verdict: string;
      componentType: string;
      measuredValue: number;
      metadata?: {
        contextFilterActive?: boolean;
        noiseObjectsFilteredCount?: number;
        noiseCategoriesFiltered?: string[];
        targetComponentIsolated?: string;
      };
    };

    assert.strictEqual(body.success, true);
    assert.strictEqual(body.verdict, 'PASS');
    assert.strictEqual(body.componentType, 'OUTER_SPRING');
    assert.strictEqual(body.measuredValue, 260.0);
    assert.ok(body.metadata);
    assert.strictEqual(body.metadata.contextFilterActive, true);
    assert.strictEqual(body.metadata.noiseObjectsFilteredCount, 3);
    assert.deepStrictEqual(body.metadata.noiseCategoriesFiltered, ['person', 'chair', 'backpack']);
    assert.strictEqual(body.metadata.targetComponentIsolated, 'OUTER_SPRING');
  });
});
