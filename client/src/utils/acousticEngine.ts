/**
 * Acoustic Diagnostic Engine & Real-Time DSP Audio Analyzer
 * Indian Railways WRS Raipur (Phase 3 - M5 / R3)
 *
 * Implements Web Audio API capture, dual-path FFT/Waveform DSP analysis,
 * synthetic audio generators for offline simulation, and visualizer helpers.
 */

import type { AcousticAnomalyType, AcousticDiagnosticResult } from '../../../shared/types.ts';

export interface EqualizerBand {
  index: number;
  freqLabel: string;
  minFreq: number;
  maxFreq: number;
  level: number; // 0.0 to 1.0
  peakLevel: number; // 0.0 to 1.0
  isAnomalyBand: boolean;
}

export interface AcousticAnalysisFrame {
  timestamp: number;
  dominantFrequencyHz: number;
  peakDb: number;
  anomalyType: AcousticAnomalyType;
  confidence: number;
  crestFactor: number;
  highFreqPowerRatio: number;
  details: string;
  recommendedAction: string;
  bands: EqualizerBand[];
  timeDomainWaveform: Float32Array;
  frequencySpectrum: Float32Array;
  /**
   * Where this frame's audio came from. A diagnosis derived from a synthetic
   * oscillator must never be recordable against a real wagon, and one derived
   * from no signal at all must not be reported as "nominal" — so the frame
   * carries its own provenance rather than leaving callers to assume.
   */
  signalSource: 'MICROPHONE' | 'SYNTHETIC' | 'NO_SIGNAL';
}

export type AcousticFrameCallback = (frame: AcousticAnalysisFrame) => void;

export class AcousticDiagnosticEngine {
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private micStream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private synthSourceNodes: AudioNode[] = [];
  private masterGain: GainNode | null = null;

  private isRunning: boolean = false;
  private animationFrameId: number | null = null;
  private onFrameCallback: AcousticFrameCallback | null = null;

  // DSP buffers
  private fftSize: number = 2048;
  // Explicitly parameterised over ArrayBuffer: the Web Audio getXxxData()
  // methods require a view backed by a real ArrayBuffer, and the default
  // ArrayBufferLike (which admits SharedArrayBuffer) does not satisfy them.
  private freqData: Uint8Array<ArrayBuffer> = new Uint8Array(1024);
  private floatFreqData: Float32Array<ArrayBuffer> = new Float32Array(1024);
  private timeData: Uint8Array<ArrayBuffer> = new Uint8Array(2048);
  private floatTimeData: Float32Array<ArrayBuffer> = new Float32Array(2048);

  // Peak hold array for 32 equalizer bands
  private peakHoldValues: number[] = new Array(32).fill(0);
  private peakHoldDecay: number = 0.015;

  // Temporal smoothing filters
  private hissFrameCounter: number = 0;
  private knockFrameCounter: number = 0;
  private smoothedPeakDb: number = 40.0;
  private currentAnomaly: AcousticAnomalyType = 'NONE';
  private currentConfidence: number = 0.95;

  // Active simulation mode
  private simulatedAnomaly: AcousticAnomalyType | null = null;

  /** False when getUserMedia failed — there is no audio to analyse. */
  private micAvailable: boolean = false;

  constructor() {
    // Expose test harness hook to window
    if (typeof window !== 'undefined') {
      (window as any).__simulateAcousticSignal = (
        type: AcousticAnomalyType,
        dominantFreqHz?: number
      ) => {
        this.injectSimulatedSignal(type, dominantFreqHz);
      };
      (window as any).__acousticEngineInstance = this;
    }
  }

  /**
   * Safe AudioContext initialization upon user gesture
   */
  public async initAudioContext(): Promise<AudioContext> {
    if (!this.audioCtx) {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      this.audioCtx = new AudioCtxClass();
    }

    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }

    if (!this.analyser) {
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = this.fftSize;
      this.analyser.smoothingTimeConstant = 0.8;
      this.analyser.minDecibels = -90;
      this.analyser.maxDecibels = -10;

      this.masterGain = this.audioCtx.createGain();
      this.masterGain.gain.setValueAtTime(0.35, this.audioCtx.currentTime);
      this.masterGain.connect(this.analyser);
    }

    return this.audioCtx;
  }

  /**
   * Start the analysis loop over a synthetic signal already set up by one of
   * the simulate* presets.
   *
   * The presets used to be followed by startMicrophone(), which begins by
   * calling stopSyntheticGenerator() and clearing simulatedAnomaly — so the
   * simulation was torn down the instant it started and the buttons did
   * nothing at all. This path starts the loop without touching either, so a
   * demonstration actually demonstrates something.
   *
   * micAvailable stays false, which tags every frame SYNTHETIC and keeps the
   * result from being filed as a real defect.
   */
  public startSyntheticAnalysis(onFrame?: AcousticFrameCallback): void {
    if (onFrame) this.onFrameCallback = onFrame;
    this.micAvailable = false;
    this.isRunning = true;
    this.startAnalysisLoop();
  }

  /**
   * Start microphone capture and live real-time analysis
   */
  public async startMicrophone(onFrame?: AcousticFrameCallback): Promise<void> {
    await this.initAudioContext();
    this.stopSyntheticGenerator();
    this.simulatedAnomaly = null;

    if (onFrame) this.onFrameCallback = onFrame;

    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        this.micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
          }
        });

        if (this.audioCtx && this.analyser) {
          this.micSource = this.audioCtx.createMediaStreamSource(this.micStream);
          this.micSource.connect(this.analyser);
        }
      }
      this.micAvailable = !!this.micSource;
    } catch (err) {
      // Previously this warned and carried on analysing nothing, which produced
      // "spectrum nominal, subsystems clear" at 0.95 confidence from an absent
      // microphone — a confident all-clear for a bearing nobody listened to.
      // Failing loudly is the only safe direction here.
      this.micAvailable = false;
      console.warn('Microphone unavailable — acoustic diagnosis cannot run:', err);
    }

    this.isRunning = true;
    this.startAnalysisLoop();
  }

  /**
   * Start 32-Band FFT & Oscilloscope Analysis Loop
   */
  private startAnalysisLoop(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }

    const processLoop = () => {
      if (!this.isRunning) return;

      const frame = this.processCurrentFrame();
      if (this.onFrameCallback) {
        this.onFrameCallback(frame);
      }

      this.animationFrameId = requestAnimationFrame(processLoop);
    };

    this.animationFrameId = requestAnimationFrame(processLoop);
  }

  /**
   * Process a single DSP frame: FFT frequency bins, crest factor, hiss power ratio
   */
  public processCurrentFrame(): AcousticAnalysisFrame {
    const sampleRate = this.audioCtx?.sampleRate || 44100;
    const binWidth = sampleRate / this.fftSize;

    if (this.analyser) {
      this.analyser.getByteFrequencyData(this.freqData);
      this.analyser.getFloatFrequencyData(this.floatFreqData);
      this.analyser.getByteTimeDomainData(this.timeData);
      this.analyser.getFloatTimeDomainData(this.floatTimeData);
    } else {
      /*
       * No analyser means nothing was heard, and that is what gets reported.
       *
       * This used to call generateMockWaveformBuffers(), which drew a
       * spectrum from the answer it already had — a leak was "detected"
       * because the function put energy in the 4.5-8.5 kHz bins on purpose.
       * It produced a convincing picture of a measurement that never
       * happened. The buffers stay empty; signalSource below reports
       * NO_SIGNAL and the screen says nothing was recorded.
       */
      this.freqData.fill(0);
      this.floatFreqData.fill(-140);
      this.timeData.fill(128);
      this.floatTimeData.fill(0);
    }

    // 1. Calculate Peak SPL & Dominant Frequency
    let maxBinIndex = 1;
    let maxBinVal = 0;
    let totalPower = 0;
    let highBandPower = 0;

    const highBandStartBin = Math.floor(4500 / binWidth);
    const highBandEndBin = Math.min(1023, Math.floor(12000 / binWidth));

    for (let i = 1; i < 1024; i++) {
      const val = this.freqData[i];
      const pwr = val * val;
      totalPower += pwr;

      if (val > maxBinVal) {
        maxBinVal = val;
        maxBinIndex = i;
      }

      if (i >= highBandStartBin && i <= highBandEndBin) {
        highBandPower += pwr;
      }
    }

    let dominantFrequencyHz = Math.round(maxBinIndex * binWidth);
    const highFreqPowerRatio = totalPower > 0 ? highBandPower / totalPower : 0;

    // 2. Waveform Crest Factor (Peak / RMS)
    let peakAmplitude = 0;
    let sumSquares = 0;
    for (let i = 0; i < this.floatTimeData.length; i++) {
      const s = Math.abs(this.floatTimeData[i]);
      if (s > peakAmplitude) peakAmplitude = s;
      sumSquares += s * s;
    }
    const rms = Math.sqrt(sumSquares / this.floatTimeData.length) || 1e-6;
    const crestFactor = peakAmplitude / rms;

    // Calculate calibrated decibel level (30 - 110 dB SPL)
    const rawDb = 30 + (maxBinVal / 255) * 75 + (peakAmplitude * 15);
    this.smoothedPeakDb = this.smoothedPeakDb * 0.75 + rawDb * 0.25;
    const peakDb = Math.min(115, Math.max(30, Math.round(this.smoothedPeakDb * 10) / 10));

    // 3. Anomaly Decision Logic (Dual-Path DSP)
    const signalSource: AcousticAnalysisFrame['signalSource'] = this.simulatedAnomaly
      ? 'SYNTHETIC'
      : this.micAvailable
        ? 'MICROPHONE'
        : 'NO_SIGNAL';

    let detectedAnomaly: AcousticAnomalyType = 'NONE';
    let confidence = 0.95;
    let details = 'Acoustic frequency spectrum nominal. Workshop background sound levels within RDSO limits.';
    let recommendedAction = 'No action required. Subsystems clear.';

    if (signalSource === 'NO_SIGNAL') {
      // Say nothing about the bearing, because nothing was heard.
      confidence = 0;
      details = 'No microphone signal — nothing was recorded, so no acoustic assessment can be made.';
      recommendedAction = 'Grant microphone access and run the check again.';
    } else {
      /*
       * One detection path, for whatever is actually in the buffer.
       *
       * A synthetic signal used to skip all of this: pressing Simulate Air
       * Leak set a flag, and the code below simply reported the flag back
       * along with a stored frequency and a fixed confidence. Nothing was
       * measured, so the screen could not tell you anything you had not
       * already told it.
       *
       * The synthetic source is connected to the same analyser node as the
       * microphone, so its spectrum is a real spectrum. It now goes through
       * the same FFT, the same high-band power ratio, the same crest factor
       * and the same thresholds — the frequency shown is measured, the
       * confidence is computed, and if the detector cannot hear a leak tone
       * it is playing itself, that is a finding rather than something hidden
       * behind a flag.
       *
       * The frame stays tagged SYNTHETIC, so a rehearsal still cannot be
       * filed as a defect against a real wagon.
       */
      // Path A: Air leak hiss (>4.5 kHz sustained power ratio > 0.35)
      const isHighFreqHiss = (highFreqPowerRatio > 0.35 && dominantFrequencyHz >= 4500) || (dominantFrequencyHz >= 4800 && maxBinVal > 60);
      if (isHighFreqHiss) {
        this.hissFrameCounter++;
      } else {
        this.hissFrameCounter = Math.max(0, this.hissFrameCounter - 1);
      }

      // Path B: CTRB Bearing Defect (Low/mid periodic impact pulse, carrier 800-2000Hz, crest factor > 3.8)
      const isBearingPulse = crestFactor > 3.8 && dominantFrequencyHz >= 800 && dominantFrequencyHz <= 2200 && maxBinVal > 70;
      if (isBearingPulse) {
        this.knockFrameCounter++;
      } else {
        this.knockFrameCounter = Math.max(0, this.knockFrameCounter - 1);
      }

      if (this.hissFrameCounter >= 5) {
        detectedAnomaly = 'AIR_LEAK';
        confidence = Math.min(0.98, 0.75 + (this.hissFrameCounter * 0.03));
        details = `Continuous high-frequency pneumatic hiss detected at ${dominantFrequencyHz} Hz (>4.5 kHz energy ratio: ${highFreqPowerRatio.toFixed(2)}). Air brake / reservoir leakage flagged.`;
        recommendedAction = 'Inspect air hose coupling, angle cocks, and distributor valve seals for pneumatic leakage.';
      } else if (this.knockFrameCounter >= 4) {
        detectedAnomaly = 'BEARING_DEFECT';
        confidence = Math.min(0.96, 0.78 + (this.knockFrameCounter * 0.03));
        details = `Periodic impact pulses detected at ${dominantFrequencyHz} Hz with elevated crest factor (${crestFactor.toFixed(2)}). CTRB bearing defect flagged.`;
        recommendedAction = 'Perform CTRB bearing rotation check and replace defective cartridge bearing.';
      }
    }

    this.currentAnomaly = detectedAnomaly;
    this.currentConfidence = confidence;

    // 4. Compute 32-Band Equalizer
    const bands = this.compute32EqualizerBands(binWidth, detectedAnomaly);

    return {
      timestamp: Date.now(),
      dominantFrequencyHz,
      peakDb,
      anomalyType: detectedAnomaly,
      confidence,
      crestFactor,
      highFreqPowerRatio,
      details,
      recommendedAction,
      bands,
      timeDomainWaveform: this.floatTimeData,
      frequencySpectrum: this.floatFreqData,
      signalSource
    };
  }

  /**
   * Compute 32 Equalizer Band levels with peak-hold decay and frequency ranges
   */
  public compute32EqualizerBands(binWidth: number, anomalyType: AcousticAnomalyType): EqualizerBand[] {
    const numBands = 32;
    const minF = 20;
    const maxF = 20000;
    const bands: EqualizerBand[] = [];

    for (let b = 0; b < numBands; b++) {
      // Logarithmic center frequencies
      const f1 = minF * Math.pow(maxF / minF, b / numBands);
      const f2 = minF * Math.pow(maxF / minF, (b + 1) / numBands);

      const startBin = Math.max(1, Math.floor(f1 / binWidth));
      const endBin = Math.min(1023, Math.ceil(f2 / binWidth));

      let bandMax = 0;
      let count = 0;
      for (let k = startBin; k <= endBin; k++) {
        bandMax = Math.max(bandMax, this.freqData[k] || 0);
        count++;
      }

      const level = Math.min(1.0, bandMax / 255.0);

      // Peak hold calculation
      if (level >= this.peakHoldValues[b]) {
        this.peakHoldValues[b] = level;
      } else {
        this.peakHoldValues[b] = Math.max(0, this.peakHoldValues[b] - this.peakHoldDecay);
      }

      const isAnomalyBand =
        (anomalyType === 'AIR_LEAK' && f2 >= 4500) ||
        (anomalyType === 'BEARING_DEFECT' && f1 <= 2200 && f2 >= 800);

      let freqLabel = f1 >= 1000 ? `${(f1 / 1000).toFixed(1)}k` : `${Math.round(f1)}`;

      bands.push({
        index: b,
        freqLabel,
        minFreq: Math.round(f1),
        maxFreq: Math.round(f2),
        level,
        peakLevel: this.peakHoldValues[b],
        isAnomalyBand
      });
    }

    return bands;
  }

  // =========================================================================
  // Synthetic Audio Simulation Generators (Offline Demo & Automated Testing)
  // =========================================================================

  /**
   * 1. Air Leak Hiss: White Noise + 6.5 kHz Bandpass (Q=3.0) + 4.5 kHz Highpass
   */
  public async simulateAirLeakHiss(audible: boolean = true): Promise<void> {
    await this.initAudioContext();
    this.stopSyntheticGenerator();
    this.simulatedAnomaly = 'AIR_LEAK';

    if (!this.audioCtx || !this.analyser) return;

    // Create 2-second white noise buffer
    const bufferSize = this.audioCtx.sampleRate * 2;
    const noiseBuffer = this.audioCtx.createBuffer(1, bufferSize, this.audioCtx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    const whiteNoise = this.audioCtx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;
    whiteNoise.loop = true;

    // 6.5 kHz Bandpass filter (Q=3.0)
    const bandpass = this.audioCtx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.setValueAtTime(6500, this.audioCtx.currentTime);
    bandpass.Q.setValueAtTime(3.0, this.audioCtx.currentTime);

    // 4.5 kHz Highpass filter
    const highpass = this.audioCtx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.setValueAtTime(4500, this.audioCtx.currentTime);
    highpass.Q.setValueAtTime(1.0, this.audioCtx.currentTime);

    const gain = this.audioCtx.createGain();
    gain.gain.setValueAtTime(0.4, this.audioCtx.currentTime);

    whiteNoise.connect(bandpass);
    bandpass.connect(highpass);
    highpass.connect(gain);
    gain.connect(this.analyser);

    if (audible) {
      gain.connect(this.audioCtx.destination);
    }

    whiteNoise.start();
    this.synthSourceNodes = [whiteNoise, bandpass, highpass, gain];
    this.isRunning = true;
    this.startAnalysisLoop();
  }

  /**
   * 2. Bearing Knock: 1.2 kHz resonant carrier pulsed with 24 Hz exponential decay envelope
   */
  public async simulateBearingKnock(audible: boolean = true): Promise<void> {
    await this.initAudioContext();
    this.stopSyntheticGenerator();
    this.simulatedAnomaly = 'BEARING_DEFECT';

    if (!this.audioCtx || !this.analyser) return;

    // Carrier Oscillator at 1200 Hz
    const carrier = this.audioCtx.createOscillator();
    carrier.type = 'sine';
    carrier.frequency.setValueAtTime(1200, this.audioCtx.currentTime);

    /*
     * Amplitude modulation, which is what this was meant to be.
     *
     * The base gain was 0 and the 24 Hz sawtooth was connected straight to it.
     * A sawtooth swings between -1 and +1, so the gain swung symmetrically
     * about zero and averaged to nothing: pressing "Simulate Bearing Knock"
     * produced near-silence, the dominant bin fell to the bottom of the
     * spectrum, and the panel reported CLEAR / NOMINAL. Nobody noticed,
     * because the verdict was being read from a flag rather than from the
     * signal — which is precisely what that shortcut was hiding.
     *
     * A base of 0.5 with a depth of 0.5 gives a gain that swings between 0
     * and 1: real amplitude modulation, with the sawtooth's sharp edge giving
     * the impulse character a knocking bearing actually has.
     */
    const modGain = this.audioCtx.createGain();
    modGain.gain.setValueAtTime(0.5, this.audioCtx.currentTime);

    const pulseOsc = this.audioCtx.createOscillator();
    pulseOsc.type = 'sawtooth';
    pulseOsc.frequency.setValueAtTime(24, this.audioCtx.currentTime);

    const pulseDepth = this.audioCtx.createGain();
    pulseDepth.gain.setValueAtTime(0.5, this.audioCtx.currentTime);

    // Filter to add mechanical resonance
    const resFilter = this.audioCtx.createBiquadFilter();
    resFilter.type = 'bandpass';
    resFilter.frequency.setValueAtTime(1200, this.audioCtx.currentTime);
    resFilter.Q.setValueAtTime(8.0, this.audioCtx.currentTime);

    const masterGain = this.audioCtx.createGain();
    masterGain.gain.setValueAtTime(0.5, this.audioCtx.currentTime);

    carrier.connect(modGain);
    pulseOsc.connect(pulseDepth);
    pulseDepth.connect(modGain.gain);
    modGain.connect(resFilter);
    resFilter.connect(masterGain);
    masterGain.connect(this.analyser);

    if (audible) {
      masterGain.connect(this.audioCtx.destination);
    }

    carrier.start();
    pulseOsc.start();
    this.synthSourceNodes = [carrier, pulseOsc, pulseDepth, modGain, resFilter, masterGain];
    this.isRunning = true;
    this.startAnalysisLoop();
  }

  /**
   * 3. Normal Sound: Ambient workshop pink noise with 3.0 kHz lowpass filter
   */
  public async simulateNormalSound(audible: boolean = true): Promise<void> {
    await this.initAudioContext();
    this.stopSyntheticGenerator();
    this.simulatedAnomaly = 'NONE';

    if (!this.audioCtx || !this.analyser) return;

    // Pink noise buffer (Paul Kellet's filter method)
    const bufferSize = this.audioCtx.sampleRate * 2;
    const noiseBuffer = this.audioCtx.createBuffer(1, bufferSize, this.audioCtx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      output[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.06;
      b6 = white * 0.115926;
    }

    const pinkNoise = this.audioCtx.createBufferSource();
    pinkNoise.buffer = noiseBuffer;
    pinkNoise.loop = true;

    // 3.0 kHz Lowpass filter
    const lowpass = this.audioCtx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.setValueAtTime(3000, this.audioCtx.currentTime);
    lowpass.Q.setValueAtTime(0.7, this.audioCtx.currentTime);

    const gain = this.audioCtx.createGain();
    gain.gain.setValueAtTime(0.25, this.audioCtx.currentTime);

    pinkNoise.connect(lowpass);
    lowpass.connect(gain);
    gain.connect(this.analyser);

    if (audible) {
      gain.connect(this.audioCtx.destination);
    }

    pinkNoise.start();
    this.synthSourceNodes = [pinkNoise, lowpass, gain];
    this.isRunning = true;
    this.startAnalysisLoop();
  }

  /**
   * Direct signal injection for automated test harnesses & Playwright
   */
  public injectSimulatedSignal(type: AcousticAnomalyType, dominantFreqHz?: number): AcousticAnalysisFrame {
    this.simulatedAnomaly = type;
    if (type === 'AIR_LEAK') {
      this.simulateAirLeakHiss(false);
    } else if (type === 'BEARING_DEFECT') {
      this.simulateBearingKnock(false);
    } else {
      this.simulateNormalSound(false);
    }

    return this.processCurrentFrame();
  }

  /**
   * Stop synthetic sound generators
   */
  public stopSyntheticGenerator(): void {
    for (const node of this.synthSourceNodes) {
      try {
        if ('stop' in node && typeof (node as any).stop === 'function') {
          (node as any).stop();
        }
        node.disconnect();
      } catch {
        // Safe disposal
      }
    }
    this.synthSourceNodes = [];

    /*
     * A previous check must not colour the next one.
     *
     * The two detectors decide by accumulating frames — five consecutive
     * hiss frames raise an air leak, four knock frames raise a bearing — and
     * those counters were never cleared when the source changed. They only
     * decay by one per frame, so after listening to a genuine leak the count
     * stands in the hundreds and takes as long to unwind as it took to build.
     *
     * On a shop floor that means checking wagon A with a leaking hose and
     * then moving to wagon B, and being shown A's verdict on B. Clearing the
     * counters here makes every check start from nothing, which is what
     * anybody would assume it already did.
     */
    this.resetDetectionCounters();
  }

  /** Forget what the last check heard. */
  private resetDetectionCounters(): void {
    this.hissFrameCounter = 0;
    this.knockFrameCounter = 0;
    this.smoothedPeakDb = 40.0;  // the constructor's resting value, not zero
    this.currentAnomaly = 'NONE';
    this.currentConfidence = 0;
  }

  /**
   * Stop all audio streams & analysis
   */
  public stop(): void {
    this.isRunning = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    this.stopSyntheticGenerator();

    if (this.micStream) {
      this.micStream.getTracks().forEach((track) => track.stop());
      this.micStream = null;
    }

    if (this.micSource) {
      try {
        this.micSource.disconnect();
      } catch {}
      this.micSource = null;
    }

    this.simulatedAnomaly = null;
  }
}

export const acousticEngine = new AcousticDiagnosticEngine();
