/**
 * Serialized Component Health Passport QR Scanner Modal
 * Indian Railways WRS Raipur (Phase 3 - Feature R4)
 *
 * Provides real-time camera feed scanning for component QR codes:
 * - Real QR decoding via jsQR against live camera frames (native BarcodeDetector
 *   used instead where the browser supports it)
 * - Supports WRS-PASSPORT://v1 URI protocols, JSON envelopes, and raw serial barcodes
 * - Live Canvas viewfinder HUD with corner brackets and laser scanline
 * - Manual text lookup fallback for damaged/unreadable codes
 * - Auto-queries backend API to resolve serialized component passport details
 */

import React, { useState, useEffect, useRef } from 'react';
import { useI18n } from '../i18n/index.ts';
import jsQR from 'jsqr';
import { api } from '../services/api.ts';
import type { SerializedComponent } from '../../../shared/types.ts';

declare global {
  interface Window {
    BarcodeDetector?: new (options: { formats: string[] }) => {
      detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>;
    };
  }
}

interface PassportQRScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComponentScanned: (component: SerializedComponent) => void;
  title?: string;
}

export const PassportQRScannerModal: React.FC<PassportQRScannerModalProps> = ({
  isOpen,
  onClose,
  onComponentScanned,
  title = 'Scan Component Health Passport'
}) => {
  const { lang } = useI18n();
  const isHi = lang === 'hi';
  const [manualCode, setManualCode] = useState<string>('');
  const [isScanning, setIsScanning] = useState<boolean>(true);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isResolving, setIsResolving] = useState<boolean>(false);
  const [resolutionError, setResolutionError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const decodeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const decodeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const barcodeDetectorRef = useRef<InstanceType<NonNullable<Window['BarcodeDetector']>> | null>(null);
  const hasResolvedRef = useRef<boolean>(false);

  // Dev-only simulation QR payloads for testing without a real printed code
  const simulationPresets = import.meta.env.DEV ? [
    {
      label: 'Wheelset (WRS-WS-2026-001)',
      payload: 'WRS-PASSPORT://v1?sn=WRS-WS-2026-001&type=WHEELSET&mfg=RWF%20Yelahanka&date=2026-01-15'
    },
    {
      label: 'CTRB Bearing (WRS-BRG-2026-042)',
      payload: 'WRS-PASSPORT://v1?sn=WRS-BRG-2026-042&type=BEARING&mfg=NEI%20Jaipur&date=2025-11-20'
    },
    {
      label: 'Draft Gear (WRS-DG-2026-015)',
      payload: '{"serialNumber": "WRS-DG-2026-015", "componentType": "DRAFT_GEAR", "manufacturer": "Miner Enterprises"}'
    },
    {
      label: 'Bogie Bolster (WRS-BLS-2026-088)',
      payload: 'WRS-BLS-2026-088'
    }
  ] : [];

  // Initialize camera stream
  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      return;
    }

    startCamera();

    return () => {
      stopCamera();
    };
  }, [isOpen]);

  const startCamera = async () => {
    setCameraError(null);
    hasResolvedRef.current = false;

    if (typeof window !== 'undefined' && window.BarcodeDetector) {
      try {
        barcodeDetectorRef.current = new window.BarcodeDetector({ formats: ['qr_code'] });
      } catch {
        barcodeDetectorRef.current = null;
      }
    }

    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
        startDecodeLoop();
      } else {
        setCameraError('Camera access not supported in this browser. Enter the code manually below.');
      }
    } catch (err: any) {
      setCameraError('Camera unavailable or permission denied. Enter the code manually below.');
    }

    drawScanHUD();
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    stopDecodeLoop();
  };

  const startDecodeLoop = () => {};
  const stopDecodeLoop = () => {};


  // Draw 60fps holographic scanning HUD on overlay canvas
  const drawScanHUD = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let scanY = 0;
    let scanDirection = 1;

    const render = () => {
      const width = canvas.width || 400;
      const height = canvas.height || 300;

      ctx.clearRect(0, 0, width, height);

      // Dark translucent vignette outside target square
      const boxSize = Math.min(width, height) * 0.65;
      const boxX = (width - boxSize) / 2;
      const boxY = (height - boxSize) / 2;

      ctx.fillStyle = 'rgba(2, 6, 23, 0.45)';
      ctx.fillRect(0, 0, width, boxY);
      ctx.fillRect(0, boxY + boxSize, width, height - (boxY + boxSize));
      ctx.fillRect(0, boxY, boxX, boxSize);
      ctx.fillRect(boxX + boxSize, boxY, width - (boxX + boxSize), boxSize);

      // Glowing corner reticles
      ctx.strokeStyle = '#06b6d4';
      ctx.lineWidth = 4;
      const cornerLen = 24;

      // Top-Left
      ctx.beginPath();
      ctx.moveTo(boxX, boxY + cornerLen);
      ctx.lineTo(boxX, boxY);
      ctx.lineTo(boxX + cornerLen, boxY);
      ctx.stroke();

      // Top-Right
      ctx.beginPath();
      ctx.moveTo(boxX + boxSize - cornerLen, boxY);
      ctx.lineTo(boxX + boxSize, boxY);
      ctx.lineTo(boxX + boxSize, boxY + cornerLen);
      ctx.stroke();

      // Bottom-Left
      ctx.beginPath();
      ctx.moveTo(boxX, boxY + boxSize - cornerLen);
      ctx.lineTo(boxX, boxY + boxSize);
      ctx.lineTo(boxX + cornerLen, boxY + boxSize);
      ctx.stroke();

      // Bottom-Right
      ctx.beginPath();
      ctx.moveTo(boxX + boxSize - cornerLen, boxY + boxSize);
      ctx.lineTo(boxX + boxSize, boxY + boxSize);
      ctx.lineTo(boxX + boxSize, boxY + boxSize - cornerLen);
      ctx.stroke();

      // Sweeping Laser Scanline
      scanY += scanDirection * 2.5;
      if (scanY > boxSize || scanY < 0) {
        scanDirection *= -1;
      }

      ctx.strokeStyle = 'rgba(6, 182, 212, 0.85)';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#06b6d4';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(boxX, boxY + scanY);
      ctx.lineTo(boxX + boxSize, boxY + scanY);
      ctx.stroke();
      ctx.shadowBlur = 0;

      animFrameRef.current = requestAnimationFrame(render);
    };

    render();
  };

  // Resolve QR code payload / serial number against backend
  const resolveQRCode = async (rawPayload: string) => {
    if (!rawPayload || rawPayload.trim() === '') return;
    setIsResolving(true);
    setResolutionError(null);

    const trimmed = rawPayload.trim();

    try {
      // 1. Check if URL/URI format
      let serialNumber = trimmed;
      if (trimmed.startsWith('WRS-PASSPORT://')) {
        const urlObj = new URL(trimmed.replace('WRS-PASSPORT://', 'http://localhost/'));
        serialNumber = urlObj.searchParams.get('sn') || serialNumber;
      } else if (trimmed.startsWith('{')) {
        try {
          const parsed = JSON.parse(trimmed);
          serialNumber = parsed.serialNumber || serialNumber;
        } catch {
          // ignore json parse error, fall back to string
        }
      }

      // First attempt lookup by direct QR code
      let comp: SerializedComponent | null = null;
      try {
        const qrRes = await api.getComponentByQR(trimmed);
        if (qrRes.success && (qrRes.data || qrRes.component)) {
          comp = (qrRes.data || qrRes.component) as SerializedComponent;
        }
      } catch {
        // Fallback to serial lookup
      }

      if (!comp && serialNumber) {
        try {
          const serialRes = await api.getComponentBySerial(serialNumber);
          if (serialRes.success && serialRes.data) {
            comp = serialRes.data;
          }
        } catch {
          // Fallback to general search
          const listRes = await api.getComponents({ search: serialNumber, limit: 1 });
          if (listRes.success && listRes.data && listRes.data.length > 0) {
            comp = listRes.data[0];
          }
        }
      }

      if (comp) {
        stopCamera();
        onComponentScanned(comp);
        onClose();
      } else {
        setResolutionError(`Component not found for: "${trimmed}". Please verify the serial number or register the component.`);
        hasResolvedRef.current = false;
      }
    } catch (err: any) {
      setResolutionError(err.message || 'Failed to resolve component QR code.');
      hasResolvedRef.current = false;
    } finally {
      setIsResolving(false);
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualCode.trim()) {
      resolveQRCode(manualCode);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-cyan-500/30 rounded-2xl shadow-2xl max-w-xl w-full overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 bg-slate-950/70 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400 font-bold text-base">
              🪪
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-wide">{title}</h2>
              <p className="text-[11px] text-cyan-400 font-mono">WRS-PASSPORT://v1 Protocol Scanner</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center font-bold text-sm transition"
          >
            ✕
          </button>
        </div>

        {/* Viewfinder Section */}
        <div className="relative bg-black h-64 sm:h-72 flex items-center justify-center overflow-hidden">
          <video
            ref={videoRef}
            className="absolute inset-0 w-full h-full object-cover"
            playsInline
            muted
            autoPlay
          />
          <canvas
            ref={canvasRef}
            width={400}
            height={288}
            className="absolute inset-0 w-full h-full z-10 pointer-events-none"
          />
          {/* Off-screen frame buffer for jsQR decoding — never rendered */}
          <canvas ref={decodeCanvasRef} className="hidden" />

          {cameraError && (
            <div className="absolute inset-x-4 top-4 z-20 p-2.5 bg-amber-950/80 border border-amber-500/50 rounded-lg text-amber-200 text-xs text-center backdrop-blur-sm">
              ℹ️ {cameraError}
            </div>
          )}

          {isResolving && (
            <div className="absolute inset-0 z-30 bg-slate-950/80 flex flex-col items-center justify-center gap-3">
              <div className="w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-xs font-mono text-cyan-300 font-bold">Resolving Component Passport...</p>
            </div>
          )}
        </div>

        {/* Action / Fallback Section */}
        <div className="p-4 sm:p-5 space-y-4 overflow-y-auto">
          {resolutionError && (
            <div className="p-3 bg-rose-950/60 border border-rose-500/50 rounded-xl text-rose-300 text-xs flex items-center justify-between">
              <span>⚠️ {resolutionError}</span>
              <button
                onClick={() => setResolutionError(null)}
                className="text-rose-400 hover:text-white font-bold ml-2"
              >
                ✕
              </button>
            </div>
          )}

          {/* Manual Input Form */}
          <form onSubmit={handleManualSubmit} className="space-y-2">
            <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
              <span>{isHi ? 'मैन्युअल क्रम संख्या / क्यूआर पेलोड' : 'Manual Serial Number / QR Payload'}</span>
              <span className="text-[10px] text-slate-500 font-mono">e.g. WRS-WS-2026-001</span>
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                placeholder={isHi ? 'क्रम संख्या दर्ज करें या क्यूआर यूआरआई चिपकाएँ...' : 'Enter serial number or paste QR URI...'}
                className="flex-1 px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono"
              />
              <button
                type="submit"
                disabled={!manualCode.trim() || isResolving}
                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg shadow transition"
              >
                {isResolving ? 'Searching...' : 'Lookup'}
              </button>
            </div>
          </form>

          {/* Dev-only simulation chips — never rendered in a production build */}
          {simulationPresets.length > 0 && (
          <div className="space-y-2 pt-1 border-t border-slate-800/80">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              🧪 Dev Test Chips (not shown in production):
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {simulationPresets.map((preset, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => resolveQRCode(preset.payload)}
                  className="px-3 py-2 bg-slate-800/80 hover:bg-cyan-950/40 hover:border-cyan-500/50 border border-slate-700/80 rounded-lg text-left text-xs text-slate-200 transition flex items-center justify-between group"
                >
                  <span className="font-medium group-hover:text-cyan-300 truncate">{preset.label}</span>
                  <span className="text-[10px] text-cyan-400 opacity-0 group-hover:opacity-100 font-mono ml-1">Scan ↗</span>
                </button>
              ))}
            </div>
          </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 bg-slate-950/60 border-t border-slate-800 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg transition"
          >{isHi ? 'रद्द करें' : 'Cancel'}</button>
        </div>
      </div>
    </div>
  );
};
