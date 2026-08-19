/**
 * Photo Quick-Capture & Canvas Auto-Watermarking Modal
 * Indian Railways WRS Raipur (Phase 2 - R5)
 */

import React, { useState, useRef, useEffect } from 'react';
import { useI18n } from '../i18n/index.ts';
import { api } from '../services/api.ts';
import { offlineDb } from '../services/offlineDb.ts';

interface PhotoCaptureModalProps {
  wagonNumber: string;
  checklistItemId?: string;
  category: string;
  partName: string;
  stage?: string;
  onClose: () => void;
  onUploaded: (photo: any) => void;
}

export const PhotoCaptureModal: React.FC<PhotoCaptureModalProps> = ({
  wagonNumber,
  checklistItemId,
  category,
  partName,
  stage = 'COMPONENT_INSPECTION',
  onClose,
  onUploaded
}) => {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [tags, setTags] = useState<string>('QC, Workshop');

  const user = api.getUser();

  useEffect(() => {
    startCamera();
    return () => {
      stopCamera();
    };
  }, []);

  const startCamera = async () => {
    try {
      setCameraError(null);
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
      });
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
      setIsCameraActive(true);
    } catch (err: any) {
      console.warn('[PhotoCapture] Camera unavailable:', err);
      setCameraError('Camera access unavailable. You can upload an image from storage.');
      setIsCameraActive(false);
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
    }
  };

  const applyWatermarkAndCapture = (sourceImage: HTMLVideoElement | HTMLImageElement) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const width = sourceImage instanceof HTMLVideoElement ? sourceImage.videoWidth || 1280 : sourceImage.width;
    const height = sourceImage instanceof HTMLVideoElement ? sourceImage.videoHeight || 720 : sourceImage.height;

    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Draw base image
    ctx.drawImage(sourceImage, 0, 0, width, height);

    // Draw Watermark Overlay Banner at bottom
    const bannerHeight = Math.max(90, Math.floor(height * 0.12));
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.fillRect(0, height - bannerHeight, width, bannerHeight);

    // Red-Orange Accent stripe
    ctx.fillStyle = '#f97316';
    ctx.fillRect(0, height - bannerHeight, width, 4);

    // Text details
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.max(14, Math.floor(bannerHeight * 0.22))}px monospace`;
    ctx.fillText('INDIAN RAILWAYS — WRS RAIPUR QC EVIDENCE', 16, height - bannerHeight + 24);

    ctx.font = `${Math.max(12, Math.floor(bannerHeight * 0.18))}px sans-serif`;
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(`WAGON: ${wagonNumber}  |  CAT: ${category}  |  PART: ${partName}`, 16, height - bannerHeight + 48);

    const timestampStr = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' IST';
    const inspectorStr = `INSP: ${user?.name || 'Inspector'} (${user?.employeeId || 'WRS-INSP'})`;
    ctx.fillText(`${timestampStr}  |  ${inspectorStr}`, 16, height - bannerHeight + 72);

    const watermarkedData = canvas.toDataURL('image/jpeg', 0.88);
    setCapturedImage(watermarkedData);
    stopCamera();
  };

  const handleCaptureClick = () => {
    if (videoRef.current) {
      applyWatermarkAndCapture(videoRef.current);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        applyWatermarkAndCapture(img);
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleRetake = () => {
    setCapturedImage(null);
    startCamera();
  };

  const handleUpload = async () => {
    if (!capturedImage) return;

    setIsUploading(true);
    const tagList = tags.split(',').map((t) => t.trim()).filter(Boolean);

    try {
      if (navigator.onLine) {
        const res = await api.uploadPhoto({
          wagonNumber,
          checklistItemId,
          partCategory: category,
          partName,
          stage,
          imageBase64: capturedImage,
          tags: tagList
        });
        onUploaded(res.data);
      } else {
        // Save to offline IndexedDB
        await offlineDb.enqueuePhoto({
          wagonNumber,
          category,
          partName,
          stage,
          imageBase64: capturedImage,
          tags: tagList
        });
        onUploaded({
          id: `local_photo_${Date.now()}`,
          wagonNumber,
          category,
          partName,
          stage,
          imageData: capturedImage,
          offline: true
        });
      }
      onClose();
    } catch (err: any) {
      alert(`Upload failed: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex justify-between items-center bg-slate-800/50">
          <div>
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-orange-500"></span>
              {t('photos.takePhoto')} — {wagonNumber}
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {category} • {partName}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-2 rounded-lg hover:bg-slate-800 transition text-lg"
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          {/* Camera View or Captured Preview */}
          <div className="relative rounded-lg overflow-hidden bg-black aspect-video flex items-center justify-center border border-slate-700">
            {capturedImage ? (
              <img src={capturedImage} alt="Watermarked Inspection QC" className="w-full h-full object-contain" />
            ) : isCameraActive ? (
              <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            ) : (
              <div className="p-6 text-center text-slate-400 space-y-3">
                <p className="text-sm">{cameraError || 'Camera inactive'}</p>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-lg font-medium text-sm transition"
                >
                  📁 Select Photo from Storage
                </button>
              </div>
            )}

            {/* Hidden Canvas for Watermark Generation */}
            <canvas ref={canvasRef} className="hidden" />
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleFileUpload}
          />

          {/* Watermark Notice */}
          <div className="text-xs text-slate-400 bg-slate-800/60 p-3 rounded-lg border border-slate-700/60 flex items-start gap-2">
            <span className="text-orange-400 text-base">ℹ️</span>
            <span>{t('photos.watermarkNotice')}</span>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Metadata Tags (comma separated)
            </label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="e.g. CBC, Defect, Wear"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
            />
          </div>
        </div>

        {/* Modal Footer Controls */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-800/40 flex justify-between items-center">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 text-sm font-medium transition"
          >
            {t('actions.cancel')}
          </button>

          <div className="flex gap-3">
            {capturedImage ? (
              <>
                <button
                  type="button"
                  onClick={handleRetake}
                  className="px-4 py-2.5 rounded-lg border border-slate-600 text-white hover:bg-slate-800 text-sm font-medium transition"
                >
                  {t('actions.retake')}
                </button>
                <button
                  type="button"
                  onClick={handleUpload}
                  disabled={isUploading}
                  className="px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold shadow-lg transition flex items-center gap-2"
                >
                  {isUploading ? 'Saving...' : '✓ Confirm & Attach Photo'}
                </button>
              </>
            ) : isCameraActive ? (
              <button
                type="button"
                onClick={handleCaptureClick}
                className="px-6 py-2.5 rounded-lg bg-orange-600 hover:bg-orange-500 text-white text-sm font-bold shadow-lg transition flex items-center gap-2"
              >
                📸 Capture Photo
              </button>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2.5 rounded-lg bg-orange-600 hover:bg-orange-500 text-white text-sm font-bold shadow-lg transition"
              >
                📁 Choose File
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
