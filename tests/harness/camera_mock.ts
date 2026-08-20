/**
 * Camera, MediaDevices & Direct Computer Vision AR HUD Mock Harness
 * Indian Railways WRS Raipur (Phase 3 - M4 / R2 Direct CV Measurement & AR Simulation)
 *
 * Simulates MediaDevices.getUserMedia, Canvas 2D AR caliper overlays,
 * RDSO Table 28-33 tolerance classification, and 1-click snapshot evidence capture.
 */

import { classifySpring } from './classification_engine.ts';
import type { BogieType, SpringPosition, BandColor, InspectionStatus } from '../../shared/types.ts';

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  confidence: number;
}

export interface ARCaliperOverlay {
  dimensionMm: number;
  nominalMm: number;
  deltaMm: number;
  status: InspectionStatus;
  bandColor: BandColor | null;
  toleranceMin: number;
  toleranceMax: number;
  hudBadgeText: string;
  hudBadgeColor: string;
}

export interface NoiseFilterIndicator {
  bbox: [number, number, number, number];
  badgeText: string;
  lineDash: number[];
  borderColor: string;
}

export interface ContextFilterState {
  active: boolean;
  noiseObjectsSuppressed: Array<{ class: string; score: number; bbox: [number, number, number, number] }>;
  targetComponentIsolated: string;
  hudNoiseIndicators: NoiseFilterIndicator[];
  topHudBanner: string;
}

export interface CVDetectionResult {
  boundingBox: BoundingBox;
  arCaliper: ARCaliperOverlay;
  snapshotBase64: string;
  confidence: number;
  timestamp: string;
  contextFilter?: ContextFilterState;
}

export class MockMediaStreamTrack {
  public kind: 'video' | 'audio' = 'video';
  public enabled: boolean = true;
  public readyState: 'live' | 'ended' = 'live';

  public stop(): void {
    this.readyState = 'ended';
  }

  public getSettings(): { width: number; height: number; frameRate: number } {
    return {
      width: 1280,
      height: 720,
      frameRate: 30
    };
  }
}

export class MockMediaStream {
  public active: boolean = true;
  private tracks: MockMediaStreamTrack[] = [new MockMediaStreamTrack()];

  public getTracks(): MockMediaStreamTrack[] {
    return this.tracks;
  }

  public getVideoTracks(): MockMediaStreamTrack[] {
    return this.tracks.filter(t => t.kind === 'video');
  }

  public getAudioTracks(): MockMediaStreamTrack[] {
    return this.tracks.filter(t => t.kind === 'audio');
  }

  public addTrack(track: MockMediaStreamTrack): void {
    this.tracks.push(track);
  }

  public removeTrack(track: MockMediaStreamTrack): void {
    const idx = this.tracks.indexOf(track);
    if (idx >= 0) this.tracks.splice(idx, 1);
  }
}

export class MockMediaDevices {
  public async getUserMedia(constraints?: MediaStreamConstraints): Promise<MockMediaStream> {
    if (constraints && constraints.video === false && constraints.audio === false) {
      throw new Error('OverconstrainedError: At least one stream must be requested');
    }
    return new MockMediaStream();
  }

  public async enumerateDevices(): Promise<Array<{ deviceId: string; kind: string; label: string }>> {
    return [
      { deviceId: 'mock_cam_01', kind: 'videoinput', label: 'Rear AR HD Camera (WRS Bay 3)' },
      { deviceId: 'mock_mic_01', kind: 'audioinput', label: 'Directional Acoustic Array Mic' }
    ];
  }
}

/**
 * Simulates Computer Vision detection of CASNUB springs with dynamic AR calipers,
 * dual-channel context filtering (noise vs target isolation), and RDSO tolerance evaluation.
 */
export function simulateCVDetection(
  componentType: string,
  position: SpringPosition,
  measuredHeight: number,
  bogieType: BogieType = 'CASNUB_22_NLB',
  noiseObjects?: Array<{ class: string; score?: number; bbox?: [number, number, number, number] }>
): CVDetectionResult {
  const isOuter = position === 'OUTER';
  const isSnubber = position === 'SNUBBER' || position === 'SNUBBER_OUTER' || position === 'SNUBBER_INNER';
  const nominalMm = isOuter ? 260 : isSnubber ? 294 : 262;

  // Classify spring using RDSO G-95 Revision-II Tables 28-33
  const classification = classifySpring({
    bogieType,
    condition: 'USED',
    position,
    measuredHeight
  });

  const deltaMm = Number((measuredHeight - nominalMm).toFixed(1));
  const isPass = classification.status === 'PASS';
  const bandColor = classification.band;

  const posLabel = position === 'OUTER' ? 'Outer' : position === 'INNER' ? 'Inner' : 'Snubber';
  const boundingBox: BoundingBox = {
    x: 320,
    y: 140,
    width: 360,
    height: 440,
    label: `${bogieType} ${posLabel} Spring`,
    confidence: 0.94
  };

  const toleranceMin = classification.validRange?.min ?? (isOuter ? 245 : 244);
  const toleranceMax = classification.validRange?.max ?? (isOuter ? 260 : 262);

  const arCaliper: ARCaliperOverlay = {
    dimensionMm: measuredHeight,
    nominalMm,
    deltaMm,
    status: classification.status,
    bandColor,
    toleranceMin,
    toleranceMax,
    hudBadgeText: isPass
      ? `PASS — ${bandColor ?? 'IN-BAND'} (${deltaMm >= 0 ? '+' : ''}${deltaMm}mm)`
      : `CONDEMNED (<${toleranceMin}mm RDSO Limit)`,
    hudBadgeColor: isPass ? '#10B981' : '#EF4444'
  };

  // Build Context Filter State
  const suppressedList = (noiseObjects || []).map(n => ({
    class: n.class,
    score: n.score ?? 0.92,
    bbox: n.bbox ?? [100, 100, 200, 300] as [number, number, number, number]
  }));

  const hudNoiseIndicators: NoiseFilterIndicator[] = suppressedList.map(n => ({
    bbox: n.bbox,
    badgeText: `🚫 FILTERED: ${n.class.toUpperCase()} (IGNORED)`,
    lineDash: [8, 6],
    borderColor: 'rgba(245, 158, 11, 0.85)'
  }));

  const contextFilter: ContextFilterState = {
    active: true,
    noiseObjectsSuppressed: suppressedList,
    targetComponentIsolated: `${bogieType} ${posLabel} Spring`,
    hudNoiseIndicators,
    topHudBanner: suppressedList.length > 0
      ? `🛡️ Context Filter: Active | ${suppressedList.length} Noise Object(s) Suppressed`
      : `🛡️ Context Filter: Active | 0 Noise Objects`
  };

  // Generate synthetic base64 image data URI with embedded JSON watermark
  const watermarkPayload = {
    app: 'WRS_RAIPUR_CV_AR',
    bogieType,
    position,
    measuredHeight,
    status: classification.status,
    bandColor,
    contextFilterActive: true,
    noiseSuppressedCount: suppressedList.length,
    isolatedTarget: `${bogieType} ${posLabel} Spring`,
    timestamp: new Date().toISOString()
  };
  const watermarkBase64 = Buffer.from(JSON.stringify(watermarkPayload)).toString('base64');
  const snapshotBase64 = `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==#meta=${watermarkBase64}`;

  return {
    boundingBox,
    arCaliper,
    snapshotBase64,
    confidence: 0.94,
    timestamp: new Date().toISOString(),
    contextFilter
  };
}
