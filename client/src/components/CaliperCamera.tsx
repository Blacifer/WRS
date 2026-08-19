/**
 * Caliper Camera Viewfinder, OCR Processor & Manual Fallback Input
 * Indian Railways WRS Raipur
 */

import React, { useState, useRef } from 'react';
import { getDictionary } from '../i18n/index.ts';
import type { LanguageCode } from '../i18n/index.ts';
import { SAMPLE_CALIPER_FIXTURES, processCaliperImage, validateManualMeasurement } from '../services/ocr.ts';
import type { SampleFixture } from '../services/ocr.ts';
import { CameraIcon, UploadIcon, SparklesIcon, AlertTriangleIcon, CheckCircleIcon, RefreshCwIcon } from './Icons.tsx';
import { SmartVisionCamera } from './SmartVisionCamera.tsx';
import type { SmartVisionMeasurement } from '../../../shared/types.ts';

interface CaliperCameraProps {
  lang: LanguageCode;
  measuredHeight: number | null;
  onMeasurementChange: (height: number, source: 'OCR' | 'MANUAL', confidence?: number) => void;
}

export const CaliperCamera: React.FC<CaliperCameraProps> = ({
  lang,
  measuredHeight,
  onMeasurementChange
}) => {
  const dict = getDictionary(lang);
  const [activeMode, setActiveMode] = useState<'smart_vision' | 'camera' | 'samples' | 'manual'>('smart_vision');
  const [manualInputStr, setManualInputStr] = useState<string>(measuredHeight ? String(measuredHeight) : '');
  const [manualError, setManualError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [ocrConfidence, setOcrConfidence] = useState<number | null>(null);
  const [ocrLatencyMs, setOcrLatencyMs] = useState<number | null>(null);
  const [selectedFixture, setSelectedFixture] = useState<SampleFixture | null>(null);
  const [capturedPreviewUrl, setCapturedPreviewUrl] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Handle sample test fixture selection
  const handleSelectSample = async (fixture: SampleFixture) => {
    setSelectedFixture(fixture);
    setIsProcessing(true);
    try {
      // Fetch the fixture SVG content
      const res = await fetch(fixture.svgPath);
      const svgText = await res.text();
      setCapturedPreviewUrl(fixture.svgPath);

      const ocrResult = await processCaliperImage(svgText);
      setOcrConfidence(ocrResult.confidence);
      setOcrLatencyMs(ocrResult.processingTimeMs);
      setManualInputStr(String(ocrResult.measuredHeight));
      setManualError(null);
      onMeasurementChange(ocrResult.measuredHeight, 'OCR', ocrResult.confidence);
    } catch (err) {
      console.error('[CaliperCamera] Failed to read fixture:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle local image file upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    const reader = new FileReader();

    if (file.name.endsWith('.svg') || file.type.includes('svg')) {
      reader.onload = async (event) => {
        const content = event.target?.result as string;
        setCapturedPreviewUrl(content.startsWith('data:') ? content : `data:image/svg+xml;utf8,${encodeURIComponent(content)}`);
        const result = await processCaliperImage(content);
        setOcrConfidence(result.confidence);
        setOcrLatencyMs(result.processingTimeMs);
        setManualInputStr(String(result.measuredHeight));
        setManualError(null);
        onMeasurementChange(result.measuredHeight, 'OCR', result.confidence);
        setIsProcessing(false);
      };
      reader.readAsText(file);
    } else {
      reader.onload = async (event) => {
        const base64 = event.target?.result as string;
        setCapturedPreviewUrl(base64);
        const result = await processCaliperImage(base64);
        setOcrConfidence(result.confidence);
        setOcrLatencyMs(result.processingTimeMs);
        setManualInputStr(String(result.measuredHeight));
        setManualError(null);
        onMeasurementChange(result.measuredHeight, 'OCR', result.confidence);
        setIsProcessing(false);
      };
      reader.readAsDataURL(file);
    }
  };

  // Handle simulated instant camera snap
  const handleCameraSnap = async () => {
    // Pick the primary calibrated reference (260.00mm) if none selected
    const target = selectedFixture || SAMPLE_CALIPER_FIXTURES[0];
    await handleSelectSample(target);
  };

  // Handle manual input typing and blur validation
  const handleManualInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setManualInputStr(val);
    const validation = validateManualMeasurement(val);
    if (!validation.valid) {
      setManualError(validation.error || 'Invalid measurement');
    } else {
      setManualError(null);
      onMeasurementChange(validation.value!, 'MANUAL');
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5 shadow-lg space-y-4">
      {/* Tab Selector: Smart Vision (AR) / Live Camera OCR / Sample Test Calipers / Manual Fallback */}
      <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-950 rounded-lg border border-slate-800">
        <button
          type="button"
          onClick={() => setActiveMode('smart_vision')}
          className={`flex-1 min-h-[48px] px-3 py-2 text-xs sm:text-sm font-bold rounded-md flex items-center justify-center gap-1.5 transition-all ${
            activeMode === 'smart_vision'
              ? 'bg-blue-600 text-white shadow'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <span>🤖</span>
          <span>{dict.actions.smartVision || 'Smart Vision (AR)'}</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveMode('camera')}
          className={`flex-1 min-h-[48px] px-3 py-2 text-xs sm:text-sm font-bold rounded-md flex items-center justify-center gap-1.5 transition-all ${
            activeMode === 'camera'
              ? 'bg-blue-600 text-white shadow'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <CameraIcon size={18} />
          <span>{dict.actions.cameraOcr}</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveMode('samples')}
          className={`flex-1 min-h-[48px] px-3 py-2 text-xs sm:text-sm font-bold rounded-md flex items-center justify-center gap-1.5 transition-all ${
            activeMode === 'samples'
              ? 'bg-blue-600 text-white shadow'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <SparklesIcon size={18} className="text-amber-400" />
          <span>{dict.actions.sampleImages}</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveMode('manual')}
          className={`flex-1 min-h-[48px] px-3 py-2 text-xs sm:text-sm font-bold rounded-md flex items-center justify-center gap-1.5 transition-all ${
            activeMode === 'manual'
              ? 'bg-blue-600 text-white shadow'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <span>{dict.actions.manualEntry}</span>
        </button>
      </div>

      {/* Mode 0: Smart Vision Real-Time Computer Vision & Canvas 2D AR HUD */}
      {activeMode === 'smart_vision' && (
        <SmartVisionCamera
          lang={lang}
          initialTarget="OUTER_SPRING"
          inline={true}
          onMeasurementCaptured={(res: SmartVisionMeasurement) => {
            setManualInputStr(String(res.measuredValue));
            setOcrConfidence(res.confidence);
            onMeasurementChange(res.measuredValue, 'OCR', res.confidence);
          }}
        />
      )}

      {/* Mode 1: Camera Live Viewfinder & Capture Overlay */}
      {activeMode === 'camera' && (
        <div className="space-y-4">
          <div className="relative aspect-[16/9] w-full bg-slate-950 border-2 border-slate-700 rounded-xl overflow-hidden flex flex-col items-center justify-center text-center p-4">
            {capturedPreviewUrl ? (
              <img
                src={capturedPreviewUrl}
                alt="Captured Caliper LCD"
                className="w-full h-full object-contain"
              />
            ) : (
              <div className="space-y-3 z-10">
                <div className="w-16 h-16 rounded-full bg-blue-900/40 border border-blue-500 flex items-center justify-center mx-auto text-blue-400">
                  <CameraIcon size={32} />
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-200">{dict.ocr.title}</p>
                  <p className="text-xs text-slate-400 max-w-xs mx-auto mt-1">
                    {dict.ocr.instruction}
                  </p>
                </div>
              </div>
            )}

            {/* Viewfinder Target Alignment Box Overlay */}
            <div className="absolute inset-x-8 sm:inset-x-20 inset-y-8 sm:inset-y-12 border-2 border-dashed border-blue-400/70 rounded-lg pointer-events-none flex items-center justify-center">
              <span className="text-[11px] font-bold text-blue-300 bg-slate-950/80 px-2 py-0.5 rounded tracking-wide uppercase">
                {dict.ocr.alignGuide}
              </span>
            </div>
          </div>

          {/* Action Buttons: Snap Photo / Upload File (Touch Target >= 48px) */}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={handleCameraSnap}
              disabled={isProcessing}
              className="min-h-[52px] px-4 py-3 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-extrabold rounded-xl flex items-center justify-center gap-2 shadow-md transition-all active:scale-[0.98]"
            >
              {isProcessing ? (
                <RefreshCwIcon size={20} className="animate-spin" />
              ) : (
                <CameraIcon size={20} />
              )}
              <span>{isProcessing ? dict.app.syncing : dict.actions.capture}</span>
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing}
              className="min-h-[52px] px-4 py-3 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-200 font-bold rounded-xl flex items-center justify-center gap-2 border border-slate-700 shadow transition-all active:scale-[0.98]"
            >
              <UploadIcon size={20} />
              <span>{lang === 'hi' ? 'छवि अपलोड करें' : 'Upload Image'}</span>
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept="image/*,.svg,.bmp"
              className="hidden"
            />
          </div>
        </div>
      )}

      {/* Mode 2: Sample Test Calipers Selector */}
      {activeMode === 'samples' && (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-slate-400">{dict.ocr.sampleSelector}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {SAMPLE_CALIPER_FIXTURES.map((fixture) => (
              <button
                key={fixture.id}
                type="button"
                onClick={() => handleSelectSample(fixture)}
                className={`min-h-[52px] p-3 text-left rounded-lg border transition-all flex items-center justify-between ${
                  selectedFixture?.id === fixture.id
                    ? 'bg-blue-900/40 border-blue-500 text-white'
                    : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                }`}
              >
                <div>
                  <div className="text-sm font-extrabold text-blue-400 font-mono">
                    {fixture.expectedValue.toFixed(2)} mm
                  </div>
                  <div className="text-xs text-slate-400">{fixture.description}</div>
                </div>
                <SparklesIcon size={16} className="text-amber-400 shrink-0 ml-2" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Mode 3: Manual Numeric Measurement Fallback */}
      {activeMode === 'manual' && (
        <div className="space-y-3">
          <label className="block text-sm font-bold text-slate-200">
            {dict.form.measuredHeight}
          </label>
          <div className="relative">
            <input
              type="number"
              step="0.01"
              min="100"
              max="500"
              value={manualInputStr}
              onChange={handleManualInputChange}
              placeholder="e.g. 260.00"
              className={`w-full min-h-[52px] px-4 py-3 bg-slate-950 text-white font-mono text-xl font-bold rounded-xl border ${
                manualError ? 'border-rose-500 focus:ring-rose-500' : 'border-slate-700 focus:border-blue-500 focus:ring-2 focus:ring-blue-500'
              } outline-none transition-all`}
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">
              mm
            </span>
          </div>
          {manualError && (
            <p className="text-xs text-rose-400 font-semibold flex items-center gap-1">
              <AlertTriangleIcon size={14} />
              <span>{manualError}</span>
            </p>
          )}
        </div>
      )}

      {/* Active Measurement Value & OCR Metrics Card */}
      {measuredHeight !== null && (
        <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between">
          <div>
            <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold">
              {dict.ocr.detectedReading}
            </span>
            <div className="text-2xl font-black text-emerald-400 font-mono">
              {measuredHeight.toFixed(2)} <span className="text-sm font-normal text-slate-400">mm</span>
            </div>
          </div>

          <div className="flex items-center gap-4 text-right">
            {ocrConfidence !== null && (
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-semibold">
                  {dict.ocr.confidence}
                </span>
                <div className="text-xs font-bold text-slate-200">
                  {Math.round(ocrConfidence * 100)}%
                </div>
              </div>
            )}

            {ocrLatencyMs !== null && (
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-semibold">
                  {dict.ocr.latency}
                </span>
                <div className="text-xs font-bold text-slate-200">
                  {ocrLatencyMs}ms
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
