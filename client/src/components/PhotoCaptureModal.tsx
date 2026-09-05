/**
 * Photo Quick-Capture & Canvas Auto-Watermarking Modal
 * Indian Railways WRS Raipur (Phase 2 - R5)
 */

import React, { useState, useRef, useEffect } from 'react';
import { useI18n } from '../i18n/index.ts';
import { api } from '../services/api.ts';
import { offlineDb } from '../services/offlineDb.ts';
import { AlertTriangleIcon, CameraIcon, UploadIcon } from './Icons.tsx';

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
        /*
         * `ideal`, not a bare value. A bare facingMode is a HARD constraint:
         * on a device with no rear camera — any laptop, which is what the
         * shop's officer reviewed this on — getUserMedia throws
         * OverconstrainedError and the camera dies entirely, leaving only the
         * upload button. That is exactly the "could upload a photo but not
         * take one" this was reported as.
         *
         * With `ideal` the browser prefers the rear camera on a tablet and
         * falls back to whatever exists elsewhere.
         */
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-card backdrop-blur-sm p-4">
      <div className="bg-card border border-line rounded-control w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-line flex justify-between items-center bg-raised">
          <div>
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-accent"></span>
              {t('photos.takePhoto')} — {wagonNumber}
            </h3>
            <p className="text-xs text-ink-muted mt-0.5">
              {category} • {partName}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-ink-muted hover:text-white p-2 rounded-control hover:bg-raised transition text-lg"
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          {/* Camera View or Captured Preview */}
          <div className="relative rounded-control overflow-hidden bg-black aspect-video flex items-center justify-center border border-line">
            {capturedImage ? (
              <img src={capturedImage} alt="Watermarked Inspection QC" className="w-full h-full object-contain" />
            ) : isCameraActive ? (
              <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            ) : (
              <div className="p-6 text-center text-ink-muted space-y-3">
                <p className="text-sm">{cameraError || 'Camera inactive'}</p>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-control font-medium text-sm transition"
                >
                  <UploadIcon size={15} className="inline align-[-2px] mr-1.5" />Select Photo from Storage
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
          <div className="text-xs text-ink-muted bg-raised p-3 rounded-control border border-line flex items-start gap-2">
            <span className="text-warn-ink shrink-0"><AlertTriangleIcon size={16} /></span>
            <span>{t('photos.watermarkNotice')}</span>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-xs font-semibold text-ink-body mb-1">
              Metadata Tags (comma separated)
            </label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="e.g. CBC, Defect, Wear"
              className="w-full bg-raised border border-line rounded-control px-3 py-2 text-sm text-white focus:outline-none focus:border-accent-line"
            />
          </div>
        </div>

        {/* Modal Footer Controls */}
        <div className="px-6 py-4 border-t border-line bg-raised flex justify-between items-center">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-control border border-line text-ink-body hover:bg-raised text-sm font-medium transition"
          >
            {t('actions.cancel')}
          </button>

          <div className="flex gap-3">
            {capturedImage ? (
              <>
                <button
                  type="button"
                  onClick={handleRetake}
                  className="px-4 py-2.5 rounded-control border border-line-strong text-white hover:bg-raised text-sm font-medium transition"
                >
                  {t('actions.retake')}
                </button>
                <button
                  type="button"
                  onClick={handleUpload}
                  disabled={isUploading}
                  className="px-5 py-2.5 rounded-control bg-good hover:bg-good text-white text-sm font-bold transition flex items-center gap-2"
                >
                  {isUploading ? 'Saving...' : '✓ Confirm & Attach Photo'}
                </button>
              </>
            ) : isCameraActive ? (
              <button
                type="button"
                onClick={handleCaptureClick}
                className="px-6 py-2.5 rounded-control bg-accent hover:bg-accent-hover text-white text-sm font-bold transition flex items-center gap-2"
              >
                <CameraIcon size={16} className="inline align-[-2px] mr-1.5" />Capture Photo
              </button>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2.5 rounded-control bg-accent hover:bg-accent-hover text-white text-sm font-bold transition"
              >
                <UploadIcon size={16} className="inline align-[-2px] mr-1.5" />Choose File
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
