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
});
