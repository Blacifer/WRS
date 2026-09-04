/**
 * CaliperCamera — Real Caliper OCR & Manual Measurement Tool
 * Indian Railways WRS Raipur
 *
 * Honest workflow:
 * 1. Inspector opens camera → frames caliper LCD display
 * 2. Takes photo → Tesseract.js reads the digits (real OCR)
 * 3. If OCR succeeds → measurement auto-fills → classification runs
 * 4. If OCR fails → inspector enters reading manually
 * 5. No fake AR boxes, no fake AI, no synthetic samples
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { getDictionary } from '../i18n/index.ts';
import type { LanguageCode } from '../i18n/index.ts';
import { processCaliperImage, validateManualMeasurement, CV_COMPONENT_RANGES, DEFAULT_CALIPER_RANGE } from '../services/ocr.ts';
import type { MeasurementRange } from '../services/ocr.ts';
import { AlertTriangleIcon, CaliperIcon, CameraIcon, CheckCircleIcon, KeyIcon, RefreshCwIcon, UploadIcon } from './Icons.tsx';
import { playActionTap, playPassChime, playCondemnedBuzz } from '../utils/audioFeedback.ts';
import type { BogieType, SpringCondition, CVComponentTarget } from '../../../shared/types.ts';
import { tunable, loadTunables } from '../services/tunables.ts';

interface CaliperCameraProps {
  lang: LanguageCode;
  measuredHeight: number | null;
  onMeasurementChange: (height: number, source: 'OCR' | 'MANUAL', confidence?: number) => void;
  wagonNumber?: string;
  bogieType?: BogieType;
  condition?: SpringCondition;
  initialTarget?: CVComponentTarget;
  onClose?: () => void;
  /**
   * Which input mode opens first.
   *
   * Springs at WRS Raipur are measured with a manual gauge, not a digital
   * caliper — there is no LCD to photograph. Opening the camera for them
   * costs an extra tap on every spring (~900/day) and triggers a pointless
   * camera-permission prompt. Callers measuring springs should pass
   * 'manual'. Components that genuinely use a digital caliper can keep the
   * camera default.
   */
  defaultMode?: 'camera' | 'manual';
  /**
   * Hides the camera entirely. The OCR reads digits off a measuring
   * instrument's DIGITAL DISPLAY — it cannot tell anything from a photograph
   * of the component itself. Springs at Raipur are gauged by hand with no
   * display to read, so offering a camera there invites the reasonable but
   * wrong assumption that photographing a spring will identify or measure it.
   */
  hideCamera?: boolean;
}

export const CaliperCamera: React.FC<CaliperCameraProps> = ({
  lang,
  measuredHeight,
  onMeasurementChange,
  onClose,
  initialTarget,
  defaultMode = 'camera',
  hideCamera = false
}) => {
  const dict = getDictionary(lang);
  const isHi = lang === 'hi';
  const measurementRange: MeasurementRange = (initialTarget && CV_COMPONENT_RANGES[initialTarget]) || DEFAULT_CALIPER_RANGE;

  // State
  const [activeMode, setActiveMode] = useState<'camera' | 'manual'>(hideCamera ? 'manual' : defaultMode);
  const [isProcessing, setIsProcessing] = useState(false);
  const [ocrConfidence, setOcrConfidence] = useState<number | null>(null);
  const [ocrLatencyMs, setOcrLatencyMs] = useState<number | null>(null);
  const [ocrRawText, setOcrRawText] = useState<string | null>(null);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [capturedPreviewUrl, setCapturedPreviewUrl] = useState<string | null>(null);
  const [manualInputStr, setManualInputStr] = useState(measuredHeight ? String(measuredHeight) : '');
  const [manualError, setManualError] = useState<string | null>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Start camera stream
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment', // rear camera for tablets
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setIsCameraActive(true);
    } catch (err) {
      console.warn('Camera not available:', err);
      // Browsers refuse getUserMedia outside a secure context, so a plain-HTTP
      // LAN address silently has no camera. Saying so beats "not available",
      // which reads like a broken feature rather than a known limitation.
      const insecure = typeof window !== 'undefined' && !window.isSecureContext;
      setOcrError(
        insecure
          ? (isHi
              ? 'इस पते पर कैमरा उपलब्ध नहीं है (HTTPS आवश्यक)। छवि अपलोड करें या माप स्वयं दर्ज करें।'
              : 'The camera is blocked on this address because it is not HTTPS. Upload an image instead, or type the measurement.')
          : (isHi
              ? 'कैमरा उपलब्ध नहीं है। कृपया छवि अपलोड करें या मैनुअल इनपुट का उपयोग करें।'
              : 'Camera not available. Please upload an image or use manual input.')
      );
    }
  }, [isHi]);

  // Stop camera stream
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setIsCameraActive(false);
  }, []);

  // Start camera when entering camera mode
  // Approved thresholds are fetched once when the camera opens.
  useEffect(() => {
    loadTunables();
  }, []);

  useEffect(() => {
    if (activeMode === 'camera') {
      startCamera();
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [activeMode, startCamera, stopCamera]);

  // Capture photo from live video feed
  const handleCapture = async () => {
    if (!videoRef.current || !canvasRef.current) return;

    playActionTap();
    setIsProcessing(true);
    setOcrError(null);
    setOcrRawText(null);

    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);

    const dataUrl = canvas.toDataURL('image/png');
    setCapturedPreviewUrl(dataUrl);

    await runOCR(dataUrl);
  };

  // Handle file upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    playActionTap();
    setIsProcessing(true);
    setOcrError(null);
    setOcrRawText(null);

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      setCapturedPreviewUrl(dataUrl);
      await runOCR(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  // Core OCR function — runs Tesseract.js on the image
  const runOCR = async (dataUrl: string) => {
    try {
      const result = await processCaliperImage(dataUrl, measurementRange);

      setOcrConfidence(result.confidence);
      setOcrLatencyMs(result.processingTimeMs);
      setOcrRawText(result.rawText || null);

      // The threshold is the approved, tuned value rather than a constant.
      // This was hardcoded to 0.5 — the same number as the parameter's shipped
      // default — so the learning loop could propose a change, a supervisor
      // could approve it, and this line would carry on ignoring it.
      if (result.measuredHeight > 0 && result.confidence >= tunable('ocr.manual_confirm_threshold')) {
        // OCR succeeded — auto-fill the measurement
        setManualInputStr(result.measuredHeight.toFixed(2));
        onMeasurementChange(result.measuredHeight, 'OCR', result.confidence);
        playPassChime();
      } else {
        // OCR failed — prompt manual entry
        setOcrError(isHi
          ? `OCR पढ़ नहीं सका (विश्वास: ${Math.round((result.confidence || 0) * 100)}%)। कृपया नीचे मैनुअल रीडिंग दर्ज करें।`
          : `OCR could not read the display (confidence: ${Math.round((result.confidence || 0) * 100)}%). Please enter the reading manually below.`);
        playCondemnedBuzz();
      }
    } catch (err) {
      console.error('OCR error:', err);
      setOcrError(isHi
        ? 'OCR प्रोसेसिंग विफल। कृपया मैनुअल रीडिंग दर्ज करें।'
        : 'OCR processing failed. Please enter the reading manually.');
    } finally {
      setIsProcessing(false);
    }
  };

  // Reset for new capture
  const handleRetake = () => {
    playActionTap();
    setCapturedPreviewUrl(null);
    setOcrConfidence(null);
    setOcrLatencyMs(null);
    setOcrRawText(null);
    setOcrError(null);
    setManualInputStr('');
  };

  // Manual input handler
  const handleManualInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setManualInputStr(val);
    const validation = validateManualMeasurement(val, measurementRange);
    if (!validation.valid) {
      setManualError(validation.error || 'Invalid measurement');
    } else {
      setManualError(null);
      onMeasurementChange(validation.value!, 'MANUAL');
    }
  };

  return (
    <div className="bg-card border border-line rounded-control p-4 sm:p-5 space-y-4">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-white font-extrabold text-base sm:text-lg flex items-center gap-2">
            <CaliperIcon size={17} />
            {isHi ? 'माप दर्ज करें' : 'Record Measurement'}
          </h3>
          <p className="text-ink-muted text-xs mt-0.5">
            {hideCamera
              ? (isHi
                  ? 'गेज से पढ़ी गई मुक्त ऊंचाई दर्ज करें।'
                  : 'Type the free height you read from the gauge.')
              : (isHi
                  ? 'डिजिटल डिस्प्ले वाले उपकरण के लिए कैमरा OCR उपलब्ध है, अन्यथा माप स्वयं दर्ज करें।'
                  : 'Type the reading from your gauge. Camera OCR is available for instruments with a digital display.')}
          </p>
        </div>
        {onClose && (
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-raised hover:bg-selected text-ink-body hover:text-white flex items-center justify-center font-bold text-sm">✕</button>
        )}
      </div>

      {/* Mode Selector: Camera OCR / Manual. Suppressed where the instrument
          has no digital display — see hideCamera. */}
      <div className={`items-center gap-1.5 p-1 bg-page rounded-control border border-line ${hideCamera ? 'hidden' : 'flex'}`}>
        <button
          type="button"
          onClick={() => setActiveMode('camera')}
          className={`flex-1 min-h-[44px] px-3 py-2 text-sm font-bold rounded-md flex items-center justify-center gap-1.5 transition-all ${
            activeMode === 'camera'
              ? 'bg-accent text-white shadow'
              : 'text-ink-muted hover:text-ink-body hover:bg-card'
          }`}
        >
          <CameraIcon size={18} />
          <span>{isHi ? 'कैमरा OCR' : 'Camera OCR'}</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveMode('manual')}
          className={`flex-1 min-h-[44px] px-3 py-2 text-sm font-bold rounded-md flex items-center justify-center gap-1.5 transition-all ${
            activeMode === 'manual'
              ? 'bg-accent text-white shadow'
              : 'text-ink-muted hover:text-ink-body hover:bg-card'
          }`}
        >
          <KeyIcon size={16} />
          <span>{isHi ? 'मैनुअल इनपुट' : 'Manual Input'}</span>
        </button>
      </div>

      {/* Camera OCR Mode */}
      {activeMode === 'camera' && (
        <div className="space-y-4">
          {/* Live Viewfinder or Captured Preview */}
          <div className="relative aspect-[16/9] w-full bg-black rounded-control overflow-hidden border-2 border-line">
            {capturedPreviewUrl ? (
              <img
                src={capturedPreviewUrl}
                alt="Captured caliper"
                className="w-full h-full object-contain"
              />
            ) : (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
                {/* Alignment guide — dashed box to help frame the LCD */}
                <div className="absolute inset-x-8 sm:inset-x-20 inset-y-6 sm:inset-y-10 border-2 border-dashed border-accent-line rounded-control pointer-events-none flex items-center justify-center">
                  <span className="text-[11px] font-bold text-accent-ink bg-black/70 px-2 py-0.5 rounded tracking-wide">
                    {isHi ? 'कैलिपर LCD यहाँ रखें' : 'Align caliper LCD here'}
                  </span>
                </div>
              </>
            )}

            {/* Processing overlay */}
            {isProcessing && (
              <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-3">
                <RefreshCwIcon size={32} className="text-accent-ink animate-spin" />
                <p className="text-sm font-bold text-white">
                  {isHi ? 'Tesseract OCR चल रहा है...' : 'Running Tesseract OCR...'}
                </p>
              </div>
            )}
          </div>

          {/* Hidden canvas for capture */}
          <canvas ref={canvasRef} className="hidden" />

          {/* Action buttons */}
          <div className="grid grid-cols-2 gap-3">
            {capturedPreviewUrl ? (
              <>
                <button
                  type="button"
                  onClick={handleRetake}
                  className="min-h-[52px] px-4 py-3 bg-raised hover:bg-selected active:bg-card text-ink-body font-bold rounded-control flex items-center justify-center gap-2 border border-line transition-all active:scale-[0.98]"
                >
                  <RefreshCwIcon size={20} />
                  <span>{isHi ? 'दोबारा लें' : 'Retake'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="min-h-[52px] px-4 py-3 bg-raised hover:bg-selected active:bg-card text-ink-body font-bold rounded-control flex items-center justify-center gap-2 border border-line transition-all active:scale-[0.98]"
                >
                  <UploadIcon size={15} />
                  <span>{isHi ? 'फ़ाइल अपलोड' : 'Upload File'}</span>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleCapture}
                  disabled={isProcessing || !isCameraActive}
                  className="min-h-[52px] px-4 py-3 bg-accent hover:bg-accent active:bg-accent text-white font-extrabold rounded-control flex items-center justify-center gap-2 shadow-md transition-all active:scale-[0.98] disabled:opacity-40"
                >
                  <CameraIcon size={20} />
                  <span>{isHi ? 'फोटो लें' : 'Take Photo'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isProcessing}
                  className="min-h-[52px] px-4 py-3 bg-raised hover:bg-selected active:bg-card text-ink-body font-bold rounded-control flex items-center justify-center gap-2 border border-line transition-all active:scale-[0.98]"
                >
                  <UploadIcon size={15} />
                  <span>{isHi ? 'फ़ाइल अपलोड' : 'Upload File'}</span>
                </button>
              </>
            )}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept="image/*"
              capture="environment"
              className="hidden"
            />
          </div>

          {/* OCR Result or Error */}
          {ocrError && (
            <div className="p-3 bg-warn-soft border border-warn-line rounded-control flex items-start gap-2">
              <AlertTriangleIcon size={18} className="text-warn-ink shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold text-warn-ink">{ocrError}</p>
                {ocrRawText && (
                  <p className="text-xs text-ink-muted mt-1 font-mono">
                    {isHi ? 'कच्चा OCR टेक्स्ट' : 'Raw OCR text'}: "{ocrRawText}"
                  </p>
                )}
                {/* Show manual input inline when OCR fails */}
                <div className="mt-3 space-y-2">
                  <label className="text-xs font-bold text-ink-body">
                    {isHi ? 'मैनुअल रीडिंग दर्ज करें (mm):' : 'Enter reading manually (mm):'}
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      step="0.01"
                      min={measurementRange.min}
                      max={measurementRange.max}
                      value={manualInputStr}
                      onChange={handleManualInputChange}
                      placeholder={`e.g. ${measurementRange.min.toFixed(2)}`}
                      className="flex-1 min-h-[44px] px-3 py-2 bg-page text-white font-mono text-lg font-bold rounded-control border border-line outline-none"
                    />
                    <span className="text-ink-muted font-bold text-sm self-center">mm</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Manual Entry Mode */}
      {activeMode === 'manual' && (
        <div className="space-y-3">
          <label className="block text-sm font-bold text-ink-body">
            {dict.form.measuredHeight}
          </label>
          <div className="relative">
            <input
              type="number"
              step="0.01"
              min={measurementRange.min}
              max={measurementRange.max}
              value={manualInputStr}
              onChange={handleManualInputChange}
              placeholder={`e.g. ${measurementRange.min.toFixed(2)}`}
              className={`w-full min-h-[52px] px-4 py-3 bg-page text-white font-mono text-xl font-bold rounded-control border ${
                manualError ? 'border-bad-line focus:ring-rose-500' : 'border-line focus:border-accent-line focus:ring-2 focus:ring-blue-500'
              } outline-none transition-all`}
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-ink-muted font-bold text-sm">mm</span>
          </div>
          {manualError && (
            <p className="text-xs text-bad-ink font-semibold flex items-center gap-1">
              <AlertTriangleIcon size={14} />
              <span>{manualError}</span>
            </p>
          )}
          <p className="text-xs text-ink-faint">
            {isHi
              ? 'कृपया अपने डिजिटल कैलिपर से वास्तविक रीडिंग दर्ज करें।'
              : 'Enter the free height in mm as read from the gauge.'}
          </p>
        </div>
      )}

      {/* Active Measurement Result Card */}
      {measuredHeight !== null && (
        <div className="p-3 bg-good-soft border border-good-line rounded-control flex items-center justify-between">
          <div>
            <span className="text-xs text-ink-muted uppercase tracking-[0.07em] font-semibold">
              {dict.ocr.detectedReading}
            </span>
            <div className="text-2xl font-extrabold text-good-ink font-mono">
              {measuredHeight.toFixed(2)} <span className="text-sm font-normal text-ink-muted">mm</span>
            </div>
          </div>
          <div className="flex items-center gap-4 text-right">
            {ocrConfidence !== null && (
              <div>
                <span className="text-[10px] text-ink-muted uppercase font-semibold">
                  {isHi ? 'OCR विश्वास' : 'OCR Confidence'}
                </span>
                <div className="text-xs font-bold text-ink-body">
                  {Math.round(ocrConfidence * 100)}%
                </div>
              </div>
            )}
            {ocrLatencyMs !== null && (
              <div>
                <span className="text-[10px] text-ink-muted uppercase font-semibold">
                  {isHi ? 'विलंब' : 'Latency'}
                </span>
                <div className="text-xs font-bold text-ink-body">
                  {ocrLatencyMs}ms
                </div>
              </div>
            )}
            <CheckCircleIcon size={24} className="text-good-ink" />
          </div>
        </div>
      )}
    </div>
  );
};
