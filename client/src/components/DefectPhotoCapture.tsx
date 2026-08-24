/**
 * Mandatory Defect Photo Capture
 * Indian Railways WRS Raipur
 *
 * Every condemnation already records WHY a component failed (crack,
 * corrosion, deformation, under-height). Attaching a photograph turns each
 * one into a labelled example — the defect type is the label, the image is
 * the sample — produced free as a by-product of work inspectors already do.
 *
 * This is the groundwork for automated defect detection. A vision model
 * cannot be built honestly without photographs of real defects from this
 * workshop, and those only accumulate if capture happens at the moment of
 * condemnation rather than as an afterthought.
 *
 * It is also immediate evidence: a condemned component that leaves the shop
 * with no photograph is a claim with nothing behind it.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { DamageType } from '../../../shared/types.ts';
import type { LanguageCode } from '../i18n/index.ts';
import { CameraIcon, RefreshCwIcon, CheckCircleIcon } from './Icons.tsx';

interface DefectPhotoCaptureProps {
  lang: LanguageCode;
  damageType: DamageType;
  /** Called with a base64 data URL once a photo is captured, or null when cleared. */
  onPhotoChange: (imageBase64: string | null) => void;
  imageBase64: string | null;
}

export const DefectPhotoCapture: React.FC<DefectPhotoCaptureProps> = ({
  lang,
  damageType,
  onPhotoChange,
  imageBase64
}) => {
  const isHi = lang === 'hi';
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [isCameraOn, setIsCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setIsCameraOn(false);
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setIsCameraOn(true);
    } catch {
      // No camera, or permission denied. The file fallback keeps the
      // inspector unblocked — never trap someone behind a hardware failure
      // on a mandatory step.
      setCameraError(
        isHi
          ? 'कैमरा उपलब्ध नहीं। कृपया गैलरी से फ़ोटो चुनें।'
          : 'Camera unavailable. Choose a photo from the device instead.'
      );
      setIsCameraOn(false);
    }
  }, [isHi]);

  useEffect(() => stopCamera, [stopCamera]);

  const capture = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) return;

    // Cap the long edge so a full-resolution phone photo does not bloat the
    // request; detail at this size is still ample for defect labelling.
    const MAX_EDGE = 1280;
    const scale = Math.min(1, MAX_EDGE / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    onPhotoChange(canvas.toDataURL('image/jpeg', 0.82));
    stopCamera();
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onPhotoChange(String(reader.result));
    reader.readAsDataURL(file);
  };

  // Captured state
  if (imageBase64) {
    return (
      <div className="rounded-xl border border-emerald-700/60 bg-emerald-950/20 p-3 space-y-2.5">
        <div className="flex items-center gap-2">
          <CheckCircleIcon size={16} className="text-emerald-400 shrink-0" />
          <span className="text-xs font-bold text-emerald-300">
            {isHi ? 'दोष फ़ोटो संलग्न' : 'Defect photo attached'}
          </span>
        </div>
        <img
          src={imageBase64}
          alt={isHi ? 'दोष का प्रमाण' : 'Defect evidence'}
          className="w-full max-h-52 object-contain rounded-lg bg-black"
        />
        <button
          type="button"
          onClick={() => onPhotoChange(null)}
          className="min-h-[44px] w-full px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-bold border border-slate-700 transition flex items-center justify-center gap-2"
        >
          <RefreshCwIcon size={14} />
          {isHi ? 'दोबारा लें' : 'Retake'}
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-rose-800/60 bg-rose-950/20 p-3 space-y-2.5">
      <div>
        <p className="text-xs font-black text-rose-300">
          {isHi ? 'दोष फ़ोटो आवश्यक' : 'Defect photo required'}
        </p>
        <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
          {isHi
            ? 'कंडम पुर्जे का फ़ोटो लें। यह प्रमाण है और भविष्य में स्वचालित दोष पहचान को प्रशिक्षित करता है।'
            : 'Photograph the condemned component. This is the evidence behind the condemnation, and it trains future automatic defect detection.'}
        </p>
      </div>

      {isCameraOn ? (
        <div className="space-y-2">
          <video
            ref={videoRef}
            playsInline
            muted
            className="w-full max-h-56 object-cover rounded-lg bg-black"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={capture}
              className="min-h-[44px] flex-1 px-3 py-2 bg-white text-black rounded-lg text-xs font-black transition"
            >
              {isHi ? 'फ़ोटो लें' : 'Capture'}
            </button>
            <button
              type="button"
              onClick={stopCamera}
              className="min-h-[44px] px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-bold border border-slate-700 transition"
            >
              {isHi ? 'रद्द' : 'Cancel'}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            onClick={startCamera}
            className="min-h-[44px] flex-1 px-3 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-bold transition flex items-center justify-center gap-2"
          >
            <CameraIcon size={15} />
            {isHi ? 'कैमरा खोलें' : 'Open Camera'}
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="min-h-[44px] px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-bold border border-slate-700 transition"
          >
            {isHi ? 'गैलरी से चुनें' : 'Choose File'}
          </button>
        </div>
      )}

      {cameraError && <p className="text-[11px] text-amber-400">{cameraError}</p>}

      <p className="text-[10px] text-slate-500">
        {isHi ? 'दोष प्रकार' : 'Labelled as'}: <span className="font-mono text-slate-400">{damageType}</span>
      </p>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFile}
        className="hidden"
      />
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
};

export default DefectPhotoCapture;
