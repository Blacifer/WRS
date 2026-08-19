/**
 * Web Audio API & Smart Acoustic Diagnostic Engine Mock Harness
 * Indian Railways WRS Raipur (Phase 3 - M5 / R3 Smart Acoustic Bearing & Leak Detection)
 *
 * Simulates Web Audio API (AudioContext, AnalyserNode) with spectral power synthesis
 * for high-frequency air brake leaks (>4kHz) and periodic bearing defect harmonics (12-50 Hz).
 */

export type AcousticSignalType = 'AIR_LEAK' | 'BEARING_DEFECT' | 'FRICTION_CHATTER' | 'AMBIENT' | 'SILENCE';

export interface SyntheticSignalConfig {
  type: AcousticSignalType;
  peakDb?: number;
  frequencyHz?: number;
  pulseRateHz?: number;
  harmonicsCount?: number;
}

export interface AcousticDiagnosticResult {
  dominantFrequencyHz: number;
  peakDb: number;
  isAnomalyDetected: boolean;
  anomalyType: 'AIR_LEAK' | 'BEARING_DEFECT' | 'FRICTION_CHATTER' | 'NONE';
  confidence: number;
  recommendedAction: string;
  timestamp: string;
}

export class MockAnalyserNode {
  public fftSize: number = 2048;
  public minDecibels: number = -100;
  public maxDecibels: number = -30;
  public smoothingTimeConstant: number = 0.8;

  private currentSignal: SyntheticSignalConfig = { type: 'AMBIENT', peakDb: -65 };
  private sampleRate: number = 44100;

  constructor(sampleRate: number = 44100) {
    this.sampleRate = sampleRate;
  }

  public get frequencyBinCount(): number {
    return Math.floor(this.fftSize / 2);
  }

  public setSyntheticSignal(type: AcousticSignalType, options: Partial<SyntheticSignalConfig> = {}): void {
    this.currentSignal = {
      type,
      peakDb: options.peakDb ?? (type === 'AIR_LEAK' ? -22 : type === 'BEARING_DEFECT' ? -24 : type === 'FRICTION_CHATTER' ? -26 : -65),
      frequencyHz: options.frequencyHz ?? (type === 'AIR_LEAK' ? 5200 : type === 'BEARING_DEFECT' ? 2400 : type === 'FRICTION_CHATTER' ? 1800 : 400),
      pulseRateHz: options.pulseRateHz ?? (type === 'BEARING_DEFECT' ? 24 : 0),
      harmonicsCount: options.harmonicsCount ?? 3
    };
  }

  public getByteFrequencyData(array: Uint8Array): void {
    const binCount = Math.min(array.length, this.frequencyBinCount);
    const nyquist = this.sampleRate / 2;
    const hzPerBin = nyquist / this.frequencyBinCount;

    for (let i = 0; i < binCount; i++) {
      const binFreq = i * hzPerBin;

      if (this.currentSignal.type === 'SILENCE') {
        array[i] = 0;
      } else if (this.currentSignal.type === 'AMBIENT') {
        // Flat low amplitude workshop background noise (15 - 45 / 255)
        const noise = Math.floor(20 + 15 * Math.sin(i * 0.1) + Math.random() * 8);
        array[i] = Math.min(60, Math.max(0, noise));
      } else if (this.currentSignal.type === 'AIR_LEAK') {
        // High frequency continuous hiss (> 4.0 kHz)
        if (binFreq >= 4000 && binFreq <= 8500) {
          const center = this.currentSignal.frequencyHz || 5500;
          const dist = Math.abs(binFreq - center);
          const gaussian = Math.exp(-Math.pow(dist / 1200, 2));
          const level = Math.floor(210 * gaussian + 30 + Math.random() * 15);
          array[i] = Math.min(255, level);
        } else {
          array[i] = Math.floor(20 + Math.random() * 10);
        }
      } else if (this.currentSignal.type === 'BEARING_DEFECT') {
        // Resonant peak around 2.2 kHz - 3.2 kHz with sideband energy
        const center = this.currentSignal.frequencyHz || 2400;
        const dist = Math.abs(binFreq - center);
        const gaussian = Math.exp(-Math.pow(dist / 400, 2));

        // Harmonic sidebands from pulse rate
        const sideband1 = Math.exp(-Math.pow(Math.abs(binFreq - (center + 120)) / 150, 2));
        const sideband2 = Math.exp(-Math.pow(Math.abs(binFreq - (center - 120)) / 150, 2));

        const level = Math.floor(220 * gaussian + 140 * (sideband1 + sideband2) + 25 + Math.random() * 10);
        array[i] = Math.min(255, level);
      } else if (this.currentSignal.type === 'FRICTION_CHATTER') {
        // Broad mid-range chatter (1.2 kHz - 2.5 kHz)
        if (binFreq >= 1200 && binFreq <= 2800) {
          const level = Math.floor(190 + Math.random() * 45);
          array[i] = Math.min(255, level);
        } else {
          array[i] = Math.floor(25 + Math.random() * 10);
        }
      }
    }
  }

  public getFloatFrequencyData(array: Float32Array): void {
    const uint8Arr = new Uint8Array(array.length);
    this.getByteFrequencyData(uint8Arr);
    for (let i = 0; i < array.length; i++) {
      // Map 0..255 to minDecibels..maxDecibels (-100dB to -30dB)
      const normalized = uint8Arr[i] / 255;
      array[i] = this.minDecibels + normalized * (this.maxDecibels - this.minDecibels);
    }
  }

  public getByteTimeDomainData(array: Uint8Array): void {
    const len = array.length;
    for (let i = 0; i < len; i++) {
      if (this.currentSignal.type === 'SILENCE') {
        array[i] = 128;
      } else if (this.currentSignal.type === 'AMBIENT') {
        array[i] = Math.floor(128 + (Math.random() - 0.5) * 16);
      } else if (this.currentSignal.type === 'AIR_LEAK') {
        // High frequency noise oscillation
        array[i] = Math.floor(128 + Math.sin(i * 0.8) * 45 + (Math.random() - 0.5) * 20);
      } else if (this.currentSignal.type === 'BEARING_DEFECT') {
        // Periodic impulses
        const pulse = Math.sin(i * 0.05) > 0.8 ? 90 : 0;
        array[i] = Math.floor(128 + pulse * Math.sin(i * 0.4) + (Math.random() - 0.5) * 10);
      } else {
        array[i] = Math.floor(128 + Math.sin(i * 0.2) * 50);
      }
    }
  }

  public getFloatTimeDomainData(array: Float32Array): void {
    const uint8Arr = new Uint8Array(array.length);
    this.getByteTimeDomainData(uint8Arr);
    for (let i = 0; i < array.length; i++) {
      array[i] = (uint8Arr[i] - 128) / 128;
    }
  }
}

export class MockAudioContext {
  public state: 'suspended' | 'running' | 'closed' = 'running';
  public sampleRate: number = 44100;
  public currentTime: number = 0;

  public createAnalyser(): MockAnalyserNode {
    return new MockAnalyserNode(this.sampleRate);
  }

  public createMediaStreamSource(_stream: unknown): { connect: (node: unknown) => void } {
    return {
      connect: (_node: unknown) => {}
    };
  }

  public async resume(): Promise<void> {
    this.state = 'running';
  }

  public async suspend(): Promise<void> {
    this.state = 'suspended';
  }

  public async close(): Promise<void> {
    this.state = 'closed';
  }
}

/**
 * High-performance FFT spectral analysis engine for railway acoustic diagnostics
 */
export function evaluateAcousticSpectrum(analyser: MockAnalyserNode): AcousticDiagnosticResult {
  const binCount = analyser.frequencyBinCount;
  const freqData = new Uint8Array(binCount);
  analyser.getByteFrequencyData(freqData);

  const sampleRate = 44100;
  const hzPerBin = (sampleRate / 2) / binCount;

  let maxMagnitude = 0;
  let dominantBin = 0;

  // Energy accumulators
  let lowEnergy = 0;      // 20 - 1000 Hz
  let midEnergy = 0;      // 1000 - 3500 Hz (Bearing anomaly zone)
  let highEnergy = 0;     // 4000 - 9000 Hz (Air leak zone)
  let totalEnergy = 0;

  for (let i = 0; i < binCount; i++) {
    const val = freqData[i];
    const freq = i * hzPerBin;
    totalEnergy += val;

    if (val > maxMagnitude) {
      maxMagnitude = val;
      dominantBin = i;
    }

    if (freq <= 1000) lowEnergy += val;
    else if (freq >= 1500 && freq <= 3500) midEnergy += val;
    else if (freq >= 4000 && freq <= 9000) highEnergy += val;
  }

  const dominantFrequencyHz = Math.round(dominantBin * hzPerBin);
  // Decibel conversion
  const peakDb = Math.round(-100 + (maxMagnitude / 255) * 70);
  const timestamp = new Date().toISOString();

  // 1. Check for Air Leak Anomaly: Dominant frequency > 4000 Hz with high spectral peak (> 160 / -35 dB)
  if (dominantFrequencyHz >= 4000 && maxMagnitude >= 150 && highEnergy > totalEnergy * 0.4) {
    return {
      dominantFrequencyHz,
      peakDb,
      isAnomalyDetected: true,
      anomalyType: 'AIR_LEAK',
      confidence: Math.min(0.99, Number((0.85 + (maxMagnitude / 255) * 0.14).toFixed(2))),
      recommendedAction: 'Inspect air brake train pipe joints, angle cocks, and distributor valve seals for pneumatic leak',
      timestamp
    };
  }

  // 2. Check for Bearing Defect Anomaly: Strong harmonic resonance in 1.8 - 3.5 kHz zone
  if (dominantFrequencyHz >= 1800 && dominantFrequencyHz <= 3500 && maxMagnitude >= 120) {
    return {
      dominantFrequencyHz,
      peakDb,
      isAnomalyDetected: true,
      anomalyType: 'BEARING_DEFECT',
      confidence: Math.min(0.98, Number((0.82 + (maxMagnitude / 255) * 0.15).toFixed(2))),
      recommendedAction: 'Inspect CTRB (Cartridge Tapered Roller Bearing) for spalling, cage fracture, or grease degradation',
      timestamp
    };
  }


  // 3. Check for Friction Chatter
  if (dominantFrequencyHz >= 1200 && dominantFrequencyHz < 1800 && maxMagnitude >= 170) {
    return {
      dominantFrequencyHz,
      peakDb,
      isAnomalyDetected: true,
      anomalyType: 'FRICTION_CHATTER',
      confidence: 0.88,
      recommendedAction: 'Inspect friction wedge pocket liners and column wear plates for excessive clearance',
      timestamp
    };
  }

  // 4. Normal / Ambient
  return {
    dominantFrequencyHz,
    peakDb,
    isAnomalyDetected: false,
    anomalyType: 'NONE',
    confidence: 0.95,
    recommendedAction: 'Acoustic levels within nominal RDSO baseline parameters. No anomalies detected.',
    timestamp
  };
}
