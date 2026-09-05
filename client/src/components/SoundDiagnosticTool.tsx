/**
 * Sound Diagnostic Tool Component — Smart Acoustic Bearing & Leak Detection (R3)
 * Indian Railways WRS Raipur (Phase 3 - M5)
 *
 * Features:
 * - Real-time Dual Visualizer (32-band FFT Spectrum Equalizer + Glowing Oscilloscope Canvas)
 * - Decibel SPL Gauge & Digital Peak Frequency indicator
 * - Live Anomaly Status Banner (Nominal / Air Leak / CTRB Bearing Defect)
 * - Synthetic Signal Simulation Presets (Air Leak Hiss, Bearing Knock, Ambient Pink Noise)
 * - One-Click "Log Defect to Exit Gate Blockers" integrating with CASNUB checklist & gate rules
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useI18n } from '../i18n/index.ts';
import { acousticEngine, AcousticAnalysisFrame, EqualizerBand } from '../utils/acousticEngine.ts';
import { api } from '../services/api.ts';
import type { AcousticAnomalyType, CASNUBCategory } from '../../../shared/types.ts';
import { tunable, loadTunables } from '../services/tunables.ts';
import { ActivityIcon, AlertTriangleIcon } from './Icons.tsx';

interface SoundDiagnosticToolProps {
  wagonNumber: string;
  onDefectLogged?: () => void;
  className?: string;
}

export const SoundDiagnosticTool: React.FC<SoundDiagnosticToolProps> = ({
  wagonNumber,
  onDefectLogged,
  className = ''
}) => {
  const { t, lang } = useI18n();
  const isHi = lang === 'hi';

  // Engine state
  const [isActive, setIsActive] = useState<boolean>(false);
  const [mode, setMode] = useState<'MIC' | 'SIM_LEAK' | 'SIM_BEARING' | 'SIM_NORMAL' | 'IDLE'>('IDLE');
  /*
   * Silent by default.
   *
   * The simulations exist to give the analyser a spectrum to work on, not to
   * play a noise out loud. Starting audible meant a supervisor opening this
   * tab filled the room with a synthetic air-leak hiss and — with no stop
   * control anywhere — had no way to end it but to leave the page.
   */
  const [isAudible, setIsAudible] = useState<boolean>(false);

  // Live DSP metrics
  const [dominantFreq, setDominantFreq] = useState<number>(0);
  const [peakDb, setPeakDb] = useState<number>(30);
  const [anomalyType, setAnomalyType] = useState<AcousticAnomalyType>('NONE');
  // Where the current reading's audio came from. A synthetic training signal
  // or a dead microphone must never be filed against a real wagon.
  const [signalSource, setSignalSource] = useState<AcousticAnalysisFrame['signalSource']>('NO_SIGNAL');
  // True when something was detected but was too marginal to raise.
  const [belowThreshold, setBelowThreshold] = useState<boolean>(false);
  const [confidence, setConfidence] = useState<number>(0.95);
  const [crestFactor, setCrestFactor] = useState<number>(1.5);
  const [highFreqRatio, setHighFreqRatio] = useState<number>(0.05);
  const [details, setDetails] = useState<string>('');
  const [recommendedAction, setRecommendedAction] = useState<string>('');

  // Target defect assignment
  const [targetCategory, setTargetCategory] = useState<CASNUBCategory>('BRAKE_SYSTEM');
  const [targetPartName, setTargetPartName] = useState<string>('Air Hose & Angle Cocks');

  // Logging status
  const [isLogging, setIsLogging] = useState<boolean>(false);
  const [logSuccessMessage, setLogSuccessMessage] = useState<string | null>(null);
  const [logErrorMessage, setLogErrorMessage] = useState<string | null>(null);

  // Canvas refs
  const eqCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const oscCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const specCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Current frame data cache for rendering
  const currentBandsRef = useRef<EqualizerBand[]>([]);
  const currentWaveformRef = useRef<Float32Array | null>(null);

  // Update target category & part automatically based on anomaly
  useEffect(() => {
    if (anomalyType === 'AIR_LEAK') {
      setTargetCategory('BRAKE_SYSTEM');
      setTargetPartName('Air Hose & Angle Cocks');
    } else if (anomalyType === 'BEARING_DEFECT') {
      setTargetCategory('BEARINGS');
      setTargetPartName('CTRB Cartridge Bearing Rotation');
    }
  }, [anomalyType]);

  // Frame processing callback from acoustic engine
  const handleFrame = useCallback((frame: AcousticAnalysisFrame) => {
    setDominantFreq(frame.dominantFrequencyHz);
    setPeakDb(frame.peakDb);
    // An anomaly below the approved confidence threshold is not surfaced as a
    // finding. There was no gate here at all: every detection was presented
    // with equal weight regardless of how marginal it was, and the tunable
    // meant to control it tuned nothing. Below the threshold the reading is
    // still shown live — the inspector can see the spectrum — it simply does
    // not become a defect they are invited to file.
    const meetsThreshold = frame.confidence >= tunable('acoustic.alert_threshold');
    setAnomalyType(meetsThreshold ? frame.anomalyType : 'NONE');
    setBelowThreshold(!meetsThreshold && frame.anomalyType !== 'NONE');
    setSignalSource(frame.signalSource);
    setConfidence(frame.confidence);
    setCrestFactor(Math.round(frame.crestFactor * 10) / 10);
    setHighFreqRatio(Math.round(frame.highFreqPowerRatio * 100) / 100);
    setDetails(frame.details);
    setRecommendedAction(frame.recommendedAction);

    currentBandsRef.current = frame.bands;
    currentWaveformRef.current = frame.timeDomainWaveform;

    renderVisualizers(frame);
  }, []);

  // Visualizer Drawing Routine
  const renderVisualizers = (frame: AcousticAnalysisFrame) => {
    // 1. Render 32-Band Equalizer Canvas
    const eqCanvas = eqCanvasRef.current;
    if (eqCanvas) {
      const ctx = eqCanvas.getContext('2d');
      if (ctx) {
        const width = eqCanvas.width;
        const height = eqCanvas.height;
        ctx.clearRect(0, 0, width, height);

        // Dark background grid
        ctx.fillStyle = '#090d16';
        ctx.fillRect(0, 0, width, height);

        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 1;
        for (let y = height * 0.25; y < height; y += height * 0.25) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(width, y);
          ctx.stroke();
        }

        const bands = frame.bands;
        const numBands = bands.length;
        const barWidth = (width / numBands) - 3;

        for (let i = 0; i < numBands; i++) {
          const band = bands[i];
          const x = i * (barWidth + 3) + 2;
          const barHeight = Math.max(3, band.level * (height - 20));
          const y = height - barHeight;

          // Color gradient based on anomaly status and frequency
          let gradient = ctx.createLinearGradient(0, height, 0, 0);
          if (frame.anomalyType === 'AIR_LEAK' && band.isAnomalyBand) {
            gradient.addColorStop(0, '#d97706'); // Amber-600
            gradient.addColorStop(1, '#f59e0b'); // Amber-500
          } else if (frame.anomalyType === 'BEARING_DEFECT' && band.isAnomalyBand) {
            gradient.addColorStop(0, '#e11d48'); // Rose-600
            gradient.addColorStop(1, '#fb7185'); // Rose-400
          } else {
            gradient.addColorStop(0, '#0284c7'); // Sky-600
            gradient.addColorStop(0.7, '#06b6d4'); // Cyan-500
            gradient.addColorStop(1, '#38bdf8'); // Sky-400
          }

          ctx.fillStyle = gradient;
          ctx.beginPath();
          ctx.roundRect(x, y, barWidth, barHeight, [2, 2, 0, 0]);
          ctx.fill();

          // Peak Hold Cap
          const peakY = height - Math.max(4, band.peakLevel * (height - 20));
          ctx.fillStyle = band.isAnomalyBand
            ? (frame.anomalyType === 'BEARING_DEFECT' ? '#fda4af' : '#fef08a')
            : '#ffffff';
          ctx.fillRect(x, peakY - 2, barWidth, 2);
        }
      }
    }

    // 2. Render Real-Time Glowing Neon Oscilloscope Waveform Canvas
    const oscCanvas = oscCanvasRef.current;
    if (oscCanvas && frame.timeDomainWaveform) {
      const ctx = oscCanvas.getContext('2d');
      if (ctx) {
        const width = oscCanvas.width;
        const height = oscCanvas.height;
        ctx.clearRect(0, 0, width, height);

        ctx.fillStyle = '#090d16';
        ctx.fillRect(0, 0, width, height);

        // Center line
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();

        // Glowing Waveform
        const wave = frame.timeDomainWaveform;
        const sliceWidth = width / wave.length;

        let strokeColor = '#38bdf8'; // Cyan/Sky
        let shadowColor = '#0284c7';
        if (frame.anomalyType === 'AIR_LEAK') {
          strokeColor = '#fbbf24'; // Glowing Amber
          shadowColor = '#f59e0b';
        } else if (frame.anomalyType === 'BEARING_DEFECT') {
          strokeColor = '#f43f5e'; // Glowing Rose / Crimson
          shadowColor = '#e11d48';
        }

        ctx.shadowColor = shadowColor;
        ctx.shadowBlur = 10;
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 2.5;

        ctx.beginPath();
        let x = 0;
        for (let i = 0; i < wave.length; i += 2) {
          const v = wave[i];
          const y = (height / 2) + v * (height * 0.42);
          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
          x += sliceWidth * 2;
        }
        ctx.stroke();
        ctx.shadowBlur = 0; // reset
      }
    }

    // 3. Render Scrolling Waterfall Spectrogram
    const specCanvas = specCanvasRef.current;
    if (specCanvas && frame.frequencySpectrum) {
      const ctx = specCanvas.getContext('2d');
      if (ctx) {
        const width = specCanvas.width;
        const height = specCanvas.height;
        
        // Shift existing image left by 2 pixels to create scrolling effect
        const imageData = ctx.getImageData(2, 0, width - 2, height);
        ctx.putImageData(imageData, 0, 0);

        // Draw new column of frequency data on the right edge
        const spectrum = frame.frequencySpectrum;
        const binCount = spectrum.length / 2; // only draw bottom half (up to 11kHz) to save space
        const sliceHeight = height / binCount;

        for (let i = 0; i < binCount; i++) {
          const db = spectrum[i];
          // Map -90dB to -10dB into 0..1
          const intensity = Math.max(0, Math.min(1, (db + 90) / 80));
          
          let r = 0, g = 0, b = 0;
          if (frame.anomalyType === 'AIR_LEAK') {
            // Amber heatmap
            r = Math.floor(intensity * 255);
            g = Math.floor(intensity * 160);
            b = Math.floor(intensity * 20);
          } else if (frame.anomalyType === 'BEARING_DEFECT') {
            // Rose heatmap
            r = Math.floor(intensity * 255);
            g = Math.floor(intensity * 40);
            b = Math.floor(intensity * 100);
          } else {
            // Cyan/Blue heatmap
            r = Math.floor(intensity * 10);
            g = Math.floor(intensity * 180);
            b = Math.floor(intensity * 255);
          }
          
          ctx.fillStyle = `rgb(${r},${g},${b})`;
          // Draw bottom to top (low freq at bottom)
          const y = height - ((i + 1) * sliceHeight);
          ctx.fillRect(width - 2, y, 2, sliceHeight + 1);
        }
      }
    }
  };

  // Preset Handlers
  const handleStartMic = async () => {
    setLogSuccessMessage(null);
    setLogErrorMessage(null);
    setMode('MIC');
    setIsActive(true);
    await acousticEngine.startMicrophone(handleFrame);
  };

  const handleSimulateAirLeak = async () => {
    setLogSuccessMessage(null);
    setLogErrorMessage(null);
    setMode('SIM_LEAK');
    setIsActive(true);
    await acousticEngine.simulateAirLeakHiss(isAudible);
    // Not startMicrophone — that would clear the simulation it was just given.
    acousticEngine.startSyntheticAnalysis(handleFrame);
  };

  const handleSimulateBearingKnock = async () => {
    setLogSuccessMessage(null);
    setLogErrorMessage(null);
    setMode('SIM_BEARING');
    setIsActive(true);
    await acousticEngine.simulateBearingKnock(isAudible);
    // Not startMicrophone — that would clear the simulation it was just given.
    acousticEngine.startSyntheticAnalysis(handleFrame);
  };

  const handleSimulateNormal = async () => {
    setLogSuccessMessage(null);
    setLogErrorMessage(null);
    setMode('SIM_NORMAL');
    setIsActive(true);
    await acousticEngine.simulateNormalSound(isAudible);
    // Not startMicrophone — that would clear the simulation it was just given.
    acousticEngine.startSyntheticAnalysis(handleFrame);
  };

  const handleStop = () => {
    acousticEngine.stop();
    setIsActive(false);
    setMode('IDLE');
    setDominantFreq(0);
    setPeakDb(30);
    setAnomalyType('NONE');
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      acousticEngine.stop();
    };
  }, []);

  useEffect(() => {
    loadTunables();
  }, []);

  // Log Defect to Exit Gate Blockers
  /*
    Shown when something was heard but was too marginal to raise. Silently
    discarding a detection would be worse than not having the gate: the
    inspector would have no way to tell "nothing there" from "something there,
    below the bar".
  */
  const handleLogDefect = async () => {
    if (anomalyType === 'NONE') return;

    // A simulated bearing knock used to be loggable as a real defect against a
    // real wagon — it raised a genuine exit-gate blocker and was stored
    // indistinguishably from a microphone reading. The simulation presets are
    // for training and demonstration; they are not evidence about this wagon.
    if (signalSource !== 'MICROPHONE') {
      setLogErrorMessage(
        signalSource === 'SYNTHETIC'
          ? 'This is a simulated training signal, not a recording of this wagon. Run the microphone check to log a real defect.'
          : 'No microphone signal was captured, so there is nothing to log. Grant microphone access and run the check again.'
      );
      return;
    }

    setIsLogging(true);
    setLogSuccessMessage(null);
    setLogErrorMessage(null);

    try {
      const res = await api.logAcousticDiagnostic({
        wagonNumber,
        dominantFrequencyHz: dominantFreq,
        peakDb: peakDb,
        anomalyType: anomalyType,
        targetCategory,
        targetPartName,
        details,
        confidence
      });

      if (res.success) {
        setLogSuccessMessage(
          t('acoustic.defectLoggedSuccess') ||
          `Defect successfully logged against ${targetPartName}! Active exit gate blockers updated.`
        );
        if (onDefectLogged) {
          onDefectLogged();
        }
      }
    } catch (err: any) {
      setLogErrorMessage(err.message || 'Failed to log acoustic defect to backend.');
    } finally {
      setIsLogging(false);
    }
  };

  return (
    <div className={`bg-white/5 border border-white/10 rounded-control p-6 backdrop-blur-md space-y-6 ${className}`}>
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-4 border-b border-line">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-2xl"></span>
            <h3 className="text-lg font-extrabold text-white tracking-wide">
              {t('acoustic.title')}
            </h3>
            {/* Was "Web Audio DSP" — the name of the browser API this happens
                to use, which tells a supervisor nothing about what the panel
                does or whether to trust it. Named for the method instead. */}
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-accent-soft text-accent-ink border border-accent-line uppercase">
              {isHi ? 'ध्वनि विश्लेषण' : 'Listens for a sound'}
            </span>
          </div>
          <p className="text-xs text-ink-muted mt-1">
            {t('acoustic.subtitle')} — Wagon: <span className="font-mono text-white font-bold">{wagonNumber}</span>
          </p>
        </div>

        {/* Audio Output Mute / Audible Toggle */}
        
      </div>

      {/*
        Stopping.
        handleStop was written and never wired to anything, so once the
        microphone or a simulation started there was no way to end it short of
        navigating away. Shown only while something is actually running, so it
        is never a dead control.
      */}
      {isActive && (
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <button
            data-testid="acoustic-stop"
            onClick={handleStop}
            className="min-h-[48px] px-5 rounded-control bg-bad-soft border-2 border-bad-line text-bad-ink text-sm font-extrabold hover:bg-bad-soft transition"
          >
            ■ {isHi ? 'सुनना बंद करें' : 'Stop listening'}
          </button>
          <label className="flex items-center gap-2 text-xs text-ink-muted cursor-pointer">
            <input
              type="checkbox"
              checked={isAudible}
              onChange={(e) => setIsAudible(e.target.checked)}
              className="w-4 h-4 accent-cyan-500"
            />
            {isHi ? 'नमूना ध्वनि सुनाएँ' : 'Play the sample out loud'}
          </label>
        </div>
      )}

      {/* Control Buttons / Presets */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <button
          onClick={handleStartMic}
          className={`px-4 py-3 rounded-control text-xs font-bold border transition duration-150 flex flex-col items-center justify-center gap-1 min-h-[54px] ${
            mode === 'MIC'
              ? 'bg-accent border-accent-line text-white '
              : 'bg-raised border-line text-ink-body hover:bg-selected hover:text-white'
          }`}
        >
          <span>{t('acoustic.simMic')}</span>
        </button>

        <button
          onClick={handleSimulateAirLeak}
          className={`px-4 py-3 rounded-control text-xs font-bold border transition duration-150 flex flex-col items-center justify-center gap-1 min-h-[54px] ${
            mode === 'SIM_LEAK'
              ? 'bg-warn border-warn-line text-white shadow-amber-600/30'
              : 'bg-raised border-line text-ink-body hover:bg-selected hover:text-white'
          }`}
        >
          <span className="text-base"></span>
          <span>{t('acoustic.simAirLeak')}</span>
        </button>

        <button
          onClick={handleSimulateBearingKnock}
          className={`px-4 py-3 rounded-control text-xs font-bold border transition duration-150 flex flex-col items-center justify-center gap-1 min-h-[54px] ${
            mode === 'SIM_BEARING'
              ? 'bg-bad border-bad-line text-white shadow-rose-600/30'
              : 'bg-raised border-line text-ink-body hover:bg-selected hover:text-white'
          }`}
        >
          <span>{t('acoustic.simBearingKnock')}</span>
        </button>

        <button
          onClick={handleSimulateNormal}
          className={`px-4 py-3 rounded-control text-xs font-bold border transition duration-150 flex flex-col items-center justify-center gap-1 min-h-[54px] ${
            mode === 'SIM_NORMAL'
              ? 'bg-good border-good-line text-white shadow-emerald-600/30'
              : 'bg-raised border-line text-ink-body hover:bg-selected hover:text-white'
          }`}
        >
          <span className="text-base"></span>
          <span>{t('acoustic.simNormalSound')}</span>
        </button>
      </div>

      {/* Live Metrics Header Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-page p-4 rounded-control border border-line">
        <div>
          <p className="text-[11px] font-semibold text-ink-muted">{t('acoustic.dominantFreq')}</p>
          <p className="text-xl font-extrabold font-mono text-accent-ink mt-0.5">
            {dominantFreq > 0 ? `${dominantFreq.toLocaleString()} Hz` : '—'}
          </p>
        </div>

        <div>
          <p className="text-[11px] font-semibold text-ink-muted">{t('acoustic.splGauge')}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <p className={`text-xl font-extrabold font-mono ${
              peakDb >= 85 ? 'text-bad-ink' : peakDb >= 65 ? 'text-warn-ink' : 'text-good-ink'
            }`}>
              {peakDb.toFixed(1)} dB
            </p>
            <div className="flex-1 bg-raised h-2 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-100 ${
                  peakDb >= 85 ? 'bg-bad' : peakDb >= 65 ? 'bg-warn' : 'bg-good'
                }`}
                style={{ width: `${Math.min(100, Math.max(0, ((peakDb - 30) / 80) * 100))}%` }}
              ></div>
            </div>
          </div>
        </div>

        <div>
          <p className="text-[11px] font-semibold text-ink-muted">{t('acoustic.crestFactor')}</p>
          <p className={`text-xl font-extrabold font-mono mt-0.5 ${
            crestFactor >= 3.8 ? 'text-bad-ink font-bold' : 'text-ink-body'
          }`}>
            {crestFactor.toFixed(1)} {crestFactor >= 3.8 && <AlertTriangleIcon size={13} className="inline align-[-2px] text-warn-ink" />}
          </p>
        </div>

        <div>
          <p className="text-[11px] font-semibold text-ink-muted">{t('acoustic.highFreqRatio')}</p>
          <p className={`text-xl font-extrabold font-mono mt-0.5 ${
            highFreqRatio >= 0.35 ? 'text-warn-ink font-bold' : 'text-ink-body'
          }`}>
            {(highFreqRatio * 100).toFixed(0)}% {highFreqRatio >= 0.35 && <AlertTriangleIcon size={13} className="inline align-[-2px] text-warn-ink" />}
          </p>
        </div>
      </div>

      {/* Dual Visualizer Canvases */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Visualizer 1: 32-Band FFT Equalizer */}
        <div className="bg-page border border-line rounded-control p-4 space-y-2">
          <div className="flex justify-between items-center text-xs text-ink-muted font-bold">
            <span className="flex items-center gap-1.5 text-ink-body">
              <span></span> {t('acoustic.equalizerTitle')}
            </span>
            <span className="font-mono text-[10px] text-ink-faint">20 Hz - 20 kHz (32 Bands)</span>
          </div>
          <canvas
            ref={eqCanvasRef}
            width={480}
            height={160}
            className="w-full h-40 rounded-control bg-[#090d16] border border-slate-850"
          />
        </div>

        {/* Visualizer 2: Real-Time Glowing Neon Oscilloscope */}
        <div className="bg-page border border-line rounded-control p-4 space-y-2">
          <div className="flex justify-between items-center text-xs text-ink-muted font-bold">
            <span className="flex items-center gap-1.5 text-ink-body">
              <ActivityIcon size={16} /> {t('acoustic.oscilloscopeTitle')}
            </span>
            <span className="font-mono text-[10px] text-ink-faint">2048-pt Time Domain</span>
          </div>
          <canvas
            ref={oscCanvasRef}
            width={480}
            height={160}
            className="w-full h-40 rounded-control bg-[#090d16] border border-slate-850"
          />
        </div>
      </div>

      {/* Visualizer 3: Scrolling Waterfall Spectrogram (Heatmap) */}
      <div className="bg-page border border-line rounded-control p-4 space-y-2">
        <div className="flex justify-between items-center text-xs text-ink-muted font-bold">
          <span className="flex items-center gap-1.5 text-ink-body">
            <ActivityIcon size={16} />{isHi ? 'वॉटरफ़ॉल स्पेक्ट्रोग्राम (लाइव हीटमैप)' : 'Waterfall Spectrogram (Live Heatmap)'}</span>
          <span className="font-mono text-[10px] text-ink-faint">{isHi ? 'आवृत्ति बनाम समय' : 'Frequency vs Time'}</span>
        </div>
        <canvas
          ref={specCanvasRef}
          width={960}
          height={160}
          className="w-full h-40 rounded-control bg-[#090d16] border border-slate-850"
        />
      </div>

      {/* Anomaly Status Banner */}
      <div
        className={`p-4 rounded-control border transition-all duration-200 space-y-2 ${
          anomalyType === 'AIR_LEAK'
            ? 'bg-warn-soft border-warn-line'
            : anomalyType === 'BEARING_DEFECT'
            ? 'bg-bad-soft border-bad-line'
            : 'bg-raised border-line'
        }`}
      >
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">
              {anomalyType === 'AIR_LEAK' ? '' : anomalyType === 'BEARING_DEFECT' ? '' : ''}
            </span>
            <div>
              <h4
                className={`text-sm font-extrabold tracking-wide ${
                  anomalyType === 'AIR_LEAK'
                    ? 'text-warn-ink'
                    : anomalyType === 'BEARING_DEFECT'
                    ? 'text-bad-ink'
                    : 'text-good-ink'
                }`}
              >
                {anomalyType === 'AIR_LEAK'
                  ? t('acoustic.statusAirLeak')
                  : anomalyType === 'BEARING_DEFECT'
                  ? t('acoustic.statusBearingDefect')
                  : t('acoustic.statusNominal')}
              </h4>
              <p className="text-xs text-ink-body mt-0.5">{details}</p>

              {/*
                * What "nothing detected" is worth, said next to it.
                *
                * This screen used to read "CLEAR / NOMINAL — Zero Acoustic
                * Anomalies", which is a clean bill of health the tool has no
                * way to issue: it listens for two things against two fixed
                * thresholds, and everything else it cannot hear looks exactly
                * like a healthy bogie. Measured against its own bearing test
                * signal the knock detector does not fire at all, so that
                * caveat is stated rather than left for someone to discover.
                */}
              {anomalyType === 'NONE' && signalSource !== 'NO_SIGNAL' && (
                <>
                  <p className="text-[11px] text-ink-muted mt-1.5" data-testid="nominal-note">
                    {t('acoustic.statusNominalNote')}
                  </p>
                  <p className="text-[11px] text-warn-ink/90 mt-1 font-semibold" data-testid="bearing-caveat">
                    {t('acoustic.bearingUnvalidated')}
                  </p>
                </>
              )}

              {/*
                * Say on the verdict itself that a rehearsal is a rehearsal.
                *
                * A simulated signal has never been loggable as a real defect —
                * that guard is real — but it only spoke up at the moment
                * someone tried to log one. Until then the screen showed a
                * confident verdict, a frequency and a percentage with nothing
                * to distinguish it from a measurement, and the question came
                * back exactly as you would expect: "is that real information
                * or is it totally fake?" It should not take an attempted
                * write to find out.
                *
                * The number beside it is not measured either: a simulation
                * reports the frequency it was told to play, not one found in
                * the signal.
                */}
              {signalSource === 'SYNTHETIC' && (
                <p
                  className="text-[11px] text-warn-ink/90 mt-1.5 font-semibold"
                  data-testid="synthetic-warning"
                >
                  {isHi
                    ? 'यह एक अभ्यास संकेत है, इस वैगन की रिकॉर्डिंग नहीं। दिखाई गई आवृत्ति वही है जो बजाई गई — मापी नहीं गई।'
                    : 'This is a rehearsal signal, not a recording of this wagon. The frequency shown is the one being played, not one measured from it.'}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto">
            <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-card text-ink-body border border-line">
              {/*
                * A percentage belongs to a detection, not to its absence.
                * "Nothing detected — Confidence: 95%" reads as ninety-five
                * per cent sure the bogie is sound, which is a claim about
                * everything the tool cannot hear. The figure is how strongly
                * a detection fired, so it is shown only when one did.
                */}
              {anomalyType === 'NONE'
                ? 'No detection'
                : `Confidence: ${(confidence * 100).toFixed(0)}%`}
              {belowThreshold && (
                <span className="block text-[11px] text-warn-ink font-semibold mt-1">
                  {isHi
                    ? `संकेत मिला पर सीमा (${(tunable('acoustic.alert_threshold') * 100).toFixed(0)}%) से नीचे — दोष के रूप में दर्ज नहीं`
                    : `Something was detected but sits below the ${(tunable('acoustic.alert_threshold') * 100).toFixed(0)}% alert threshold, so it is not raised as a defect.`}
                </span>
              )}
            </span>
          </div>
        </div>

        {anomalyType !== 'NONE' && (
          <div className="pt-2 border-t border-line text-xs flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <p className="text-ink-body">
              <strong className="text-white">Action:</strong> {recommendedAction}
            </p>

            <button
              onClick={handleLogDefect}
              disabled={isLogging}
              className={`px-5 py-2.5 rounded-control text-xs font-extrabold transition flex items-center gap-2 min-h-[44px] shrink-0 ${
                anomalyType === 'BEARING_DEFECT'
                  ? 'bg-bad hover:bg-bad text-white shadow-rose-600/30 animate-pulse'
                  : 'bg-warn hover:bg-warn text-white shadow-amber-600/30'
              }`}
            >
              <span></span>
              <span>{isLogging ? t('acoustic.loggingDefect') : t('acoustic.logDefectBtn')}</span>
            </button>
          </div>
        )}
      </div>

      {/* Success / Error Messages */}
      {logSuccessMessage && (
        <div className="p-4 bg-good-soft border border-good-line rounded-control text-xs text-good-ink flex items-center gap-2">
          <span></span>
          <span>{logSuccessMessage}</span>
        </div>
      )}

      {logErrorMessage && (
        <div className="p-4 bg-bad-soft border border-bad-line rounded-control text-xs text-bad-ink flex items-center gap-2">
          <span>{logErrorMessage}</span>
        </div>
      )}

      {/* Target Subsystem & Part Mapping Drawer */}
      {anomalyType !== 'NONE' && (
        <div className="bg-page p-4 rounded-control border border-line space-y-3">
          <div className="flex justify-between items-center">
            <h5 className="text-xs font-bold text-ink-body flex items-center gap-1.5">
              <span></span> {t('acoustic.targetComponent')}
            </h5>
            <span className="text-[10px] text-ink-faint">{t('acoustic.defectLoggedNotice')}</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div>
              <label className="block text-[11px] text-ink-muted font-semibold mb-1">
                {t('acoustic.targetCategory')}
              </label>
              <select
                value={targetCategory}
                onChange={(e) => setTargetCategory(e.target.value as CASNUBCategory)}
                className="w-full bg-raised border border-line rounded-control px-3 py-2 text-xs text-white focus:outline-none focus:border-accent-line"
              >
                <option value="BRAKE_SYSTEM">4. Brake System & Rigging</option>
                <option value="BEARINGS">3. Bearings (CTRB & Adapters)</option>
                <option value="WHEELS_AXLES">2. Wheels & Axles</option>
                <option value="SPRINGS">1. Springs (Outer, Inner, Snubber)</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] text-ink-muted font-semibold mb-1">{isHi ? 'घटक का नाम' : 'Component Name'}</label>
              <input
                type="text"
                value={targetPartName}
                onChange={(e) => setTargetPartName(e.target.value)}
                className="w-full bg-raised border border-line rounded-control px-3 py-2 text-xs text-white focus:outline-none focus:border-accent-line"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
