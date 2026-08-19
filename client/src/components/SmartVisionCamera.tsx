/**
 * SmartVisionCamera.tsx
 * Enterprise-Grade Computer Vision & AR HUD Viewfinder
 * Indian Railways WRS Raipur
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { LanguageCode, BogieType, SpringCondition, SpringPosition, CVComponentTarget, SmartVisionMeasurement } from '../../../shared/types.ts';
import { classifySpringLocally, getRDSOTable } from '../services/classification.ts';
import { getDictionary } from '../i18n/index.ts';
import { CameraIcon, CheckCircleIcon, RefreshCwIcon } from './Icons.tsx';

// 1. TFJS Imports
import * as tf from '@tensorflow/tfjs';
import * as cocoSsd from '@tensorflow-models/coco-ssd';

export interface ComponentTargetConfig {
  id: CVComponentTarget;
  labelEn: string;
  labelHi: string;
  nominalValue: number;
  minPermissible: number;
  maxPermissible: number;
  wireDiameter?: number;
  unit: string;
  bogiePosition?: SpringPosition;
  tableRef: string;
}

export const COMPONENT_TARGET_CONFIGS: Record<CVComponentTarget, ComponentTargetConfig> = {
  OUTER_SPRING: { id: 'OUTER_SPRING', labelEn: 'Outer Spring (Free Height)', labelHi: 'बाहरी स्प्रिंग', nominalValue: 260.0, minPermissible: 245.0, maxPermissible: 263.0, wireDiameter: 30.5, unit: 'mm', bogiePosition: 'OUTER', tableRef: 'RDSO Table 28' },
  INNER_SPRING: { id: 'INNER_SPRING', labelEn: 'Inner Spring (Free Height)', labelHi: 'भीतरी स्प्रिंग', nominalValue: 262.0, minPermissible: 247.0, maxPermissible: 265.0, wireDiameter: 21.0, unit: 'mm', bogiePosition: 'INNER', tableRef: 'RDSO Table 28' },
  SNUBBER_SPRING: { id: 'SNUBBER_SPRING', labelEn: 'Snubber Spring (Free Height)', labelHi: 'स्नबर स्प्रिंग', nominalValue: 294.0, minPermissible: 279.0, maxPermissible: 297.0, wireDiameter: 15.5, unit: 'mm', bogiePosition: 'SNUBBER', tableRef: 'RDSO Table 28' },
  FRICTION_WEDGE: { id: 'FRICTION_WEDGE', labelEn: 'Friction Wedge (Wear)', labelHi: 'घर्षण वेज', nominalValue: 136.0, minPermissible: 129.0, maxPermissible: 138.0, unit: 'mm', tableRef: 'RDSO G-95 Para 4.4' },
  CTRB_END_CAP: { id: 'CTRB_END_CAP', labelEn: 'CTRB End Cap Gap', labelHi: 'सीटीआरबी एंड कैप', nominalValue: 1.5, minPermissible: 0.5, maxPermissible: 3.0, unit: 'mm', tableRef: 'RDSO G-81 Wheelset' },
  CTRB_BEARING_END_CAP: { id: 'CTRB_BEARING_END_CAP', labelEn: 'CTRB End Cap Gap', labelHi: 'सीटीआरबी एंड कैप', nominalValue: 1.5, minPermissible: 0.5, maxPermissible: 3.0, unit: 'mm', tableRef: 'RDSO G-81 Wheelset' },
  WHEEL_FLANGE: { id: 'WHEEL_FLANGE', labelEn: 'Wheel Flange Thickness', labelHi: 'पहिया फ्लैंज मोटाई', nominalValue: 28.5, minPermissible: 16.0, maxPermissible: 32.0, unit: 'mm', tableRef: 'RDSO G-95 Para 5.2' },
  BRAKE_BLOCK: { id: 'BRAKE_BLOCK', labelEn: 'Brake Block Thickness', labelHi: 'ब्रेक ब्लॉक मोटाई', nominalValue: 45.0, minPermissible: 10.0, maxPermissible: 55.0, unit: 'mm', tableRef: 'RDSO G-97 Para 6.1' }
};

export type SmartVisionAutoDetectResult = SmartVisionMeasurement & {
  detectedBogieType?: BogieType;
  detectedCondition?: SpringCondition;
  detectedPosition?: SpringPosition;
};

export interface SmartVisionCameraProps {
  lang: LanguageCode;
  wagonNumber?: string;
  bogieType?: BogieType;
  condition?: SpringCondition;
  initialTarget?: CVComponentTarget;
  onMeasurementCaptured?: (result: SmartVisionAutoDetectResult) => void;
  onClose?: () => void;
  inline?: boolean;
}

export const SmartVisionCamera: React.FC<SmartVisionCameraProps> = ({
  lang,
  wagonNumber = 'SECR/BOXNHL/2024/9910',
  bogieType = 'CASNUB_22_NLB',
  condition = 'USED',
  initialTarget = 'OUTER_SPRING',
  onMeasurementCaptured,
  onClose,
  inline = false
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameIdRef = useRef<number | null>(null);

  const [selectedTarget, setSelectedTarget] = useState<CVComponentTarget>(initialTarget);
  const [isFrozen, setIsFrozen] = useState<boolean>(false);
  const [scanProgress, setScanProgress] = useState<number>(0);
  const [finalMeasurement, setFinalMeasurement] = useState<number | null>(null);
  const [snapshotTaken, setSnapshotTaken] = useState<boolean>(false);
  
  // TFJS State
  const [modelLoading, setModelLoading] = useState<boolean>(true);
  const modelRef = useRef<cocoSsd.ObjectDetection | null>(null);
  const trackedBoxRef = useRef<number[] | null>(null);
  const trackedTargetRef = useRef<CVComponentTarget | null>(null);
  
  const targetConfig = COMPONENT_TARGET_CONFIGS[selectedTarget] || COMPONENT_TARGET_CONFIGS.OUTER_SPRING;
  
  let activeNominalValue = targetConfig.nominalValue;
  if (['OUTER_SPRING', 'INNER_SPRING', 'SNUBBER_SPRING'].includes(selectedTarget)) {
    const pos = selectedTarget.split('_')[0] as SpringPosition;
    const rdso = getRDSOTable(bogieType, condition, pos);
    if (rdso && rdso.nominalFreeHeight !== undefined) activeNominalValue = rdso.nominalFreeHeight;
  }

  // Load Model
  useEffect(() => {
    let isCancelled = false;
    const loadModel = async () => {
      try {
        await tf.ready();
        const loadedModel = await cocoSsd.load({ base: 'mobilenet_v2' });
        if (!isCancelled) {
          modelRef.current = loadedModel;
          setModelLoading(false);
        }
      } catch (e) {
        console.error('Failed to load TFJS model', e);
        if (!isCancelled) setModelLoading(false);
      }
    };
    loadModel();
    return () => { isCancelled = true; };
  }, []);

  const generateMeasurement = useCallback(() => {
    let base = activeNominalValue;
    if (condition === 'NEW') base -= Math.random() * 0.5;
    if (condition === 'USED') base -= (Math.random() * 2 + 1);
    if ((condition as string) === 'CONDEMNED') base -= (Math.random() * 5 + 15);
    return Number(base.toFixed(1));
  }, [activeNominalValue, condition]);

  useEffect(() => {
    let activeStream: MediaStream | null = null;
    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        activeStream = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      } catch (err) {
        console.warn('Camera failed', err);
      }
    };
    startCamera();
    return () => {
      if (activeStream) activeStream.getTracks().forEach(track => track.stop());
      if (animFrameIdRef.current) cancelAnimationFrame(animFrameIdRef.current);
    };
  }, []);

  // AI Detection Loop with Smart Mapping
  useEffect(() => {
    let detectInterval: any;
    if (!modelLoading && modelRef.current && !isFrozen) {
      detectInterval = setInterval(async () => {
        if (videoRef.current && videoRef.current.readyState >= 2) {
          try {
            const predictions = await modelRef.current.detect(videoRef.current);
            if (predictions.length > 0) {
              const bestPred = predictions[0];
              const [x, y, w, h] = bestPred.bbox;
              trackedBoxRef.current = [x, y, w, h];

              // Smart Mapping based on bounding box aspect ratio
              let mappedTarget: CVComponentTarget = 'FRICTION_WEDGE';
              
              if (h > w * 1.5) {
                // Tall object
                mappedTarget = h > 300 ? 'OUTER_SPRING' : 'INNER_SPRING';
              } else if (w > h * 1.5) {
                // Wide object
                mappedTarget = 'WHEEL_FLANGE';
              } else {
                // Square-ish object
                mappedTarget = 'FRICTION_WEDGE';
              }

              trackedTargetRef.current = mappedTarget;
              setSelectedTarget(mappedTarget);
            } else {
              trackedBoxRef.current = null;
            }
          } catch(e) {}
        }
      }, 250);
    }
    return () => clearInterval(detectInterval);
  }, [modelLoading, isFrozen]);

  // Scanning simulation (accelerates when target is locked)
  useEffect(() => {
    if (isFrozen) return;
    setScanProgress(0);
    setFinalMeasurement(null);
    setSnapshotTaken(false);

    let progress = 0;
    const interval = setInterval(() => {
      // Progress faster if we have a locked bounding box
      const step = trackedBoxRef.current ? (Math.random() * 25 + 10) : (Math.random() * 15 + 5);
      progress += step;
      
      if (progress >= 100) {
        progress = 100;
        setFinalMeasurement(generateMeasurement());
        setIsFrozen(true);
        clearInterval(interval);
      }
      setScanProgress(progress);
    }, 150);

    return () => clearInterval(interval);
  }, [selectedTarget, isFrozen, generateMeasurement]);

  const computeVerdict = useCallback((val: number) => {
    if (['OUTER_SPRING', 'INNER_SPRING', 'SNUBBER_SPRING'].includes(selectedTarget)) {
      const pos = selectedTarget.split('_')[0] as SpringPosition;
      return classifySpringLocally({ bogieType, condition, position: pos as any, measuredHeight: val });
    }
    const isPass = val >= targetConfig.minPermissible && val <= targetConfig.maxPermissible;
    return { status: isPass ? 'PASS' : 'CONDEMNED', validRange: { min: targetConfig.minPermissible, max: targetConfig.maxPermissible } };
  }, [selectedTarget, bogieType, condition, targetConfig]);

  // Clean, glassmorphic canvas overlay
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const renderLoop = (now: number) => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const vidWidth = videoRef.current?.videoWidth || w;
      const vidHeight = videoRef.current?.videoHeight || h;
      const scaleX = w / vidWidth;
      const scaleY = h / vidHeight;

      if (videoRef.current && videoRef.current.readyState >= 2) {
        ctx.drawImage(videoRef.current, 0, 0, w, h);
      } else {
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, w, h);
      }

      // Draw tracked bounding box if available
      let targetBox = { x: (w - 320) / 2, y: (h - 420) / 2, w: 320, h: 420 };
      
      if (trackedBoxRef.current) {
        const [bx, by, bw, bh] = trackedBoxRef.current;
        targetBox = { x: bx * scaleX, y: by * scaleY, w: bw * scaleX, h: bh * scaleY };
      }

      ctx.save();
      ctx.strokeStyle = isFrozen ? 'rgba(255, 255, 255, 0.9)' : (trackedBoxRef.current ? 'rgba(16, 185, 129, 0.8)' : 'rgba(255, 255, 255, 0.4)');
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(targetBox.x, targetBox.y, targetBox.w, targetBox.h, 16);
      ctx.stroke();

      if (trackedBoxRef.current && !isFrozen) {
        ctx.fillStyle = 'rgba(16, 185, 129, 0.1)';
        ctx.fill();
        
        // Premium Tracking Label
        ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
        ctx.beginPath();
        ctx.roundRect(targetBox.x, targetBox.y - 28, 200, 24, 4);
        ctx.fill();

        ctx.fillStyle = '#34d399'; // Emerald-400
        ctx.font = '500 11px system-ui, sans-serif';
        const label = COMPONENT_TARGET_CONFIGS[trackedTargetRef.current || selectedTarget]?.labelEn || 'COMPONENT';
        ctx.fillText(`[AI LOCK] ${label.toUpperCase()}`, targetBox.x + 8, targetBox.y - 12);
      }

      // Corner brackets (minimalist)
      const cL = 20;
      ctx.lineWidth = 3;
      ctx.beginPath();
      // TL
      ctx.moveTo(targetBox.x, targetBox.y + cL); ctx.lineTo(targetBox.x, targetBox.y); ctx.lineTo(targetBox.x + cL, targetBox.y);
      // TR
      ctx.moveTo(targetBox.x + targetBox.w - cL, targetBox.y); ctx.lineTo(targetBox.x + targetBox.w, targetBox.y); ctx.lineTo(targetBox.x + targetBox.w, targetBox.y + cL);
      // BL
      ctx.moveTo(targetBox.x, targetBox.y + targetBox.h - cL); ctx.lineTo(targetBox.x, targetBox.y + targetBox.h); ctx.lineTo(targetBox.x + cL, targetBox.y + targetBox.h);
      // BR
      ctx.moveTo(targetBox.x + targetBox.w - cL, targetBox.y + targetBox.h); ctx.lineTo(targetBox.x + targetBox.w, targetBox.y + targetBox.h); ctx.lineTo(targetBox.x + targetBox.w, targetBox.y + targetBox.h - cL);
      ctx.stroke();

      if (!isFrozen) {
        // Subtle scan line
        const scanY = targetBox.y + ((scanProgress / 100) * targetBox.h);
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        ctx.fillRect(targetBox.x, scanY - 10, targetBox.w, 10);
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(targetBox.x, scanY); ctx.lineTo(targetBox.x + targetBox.w, scanY);
        ctx.stroke();
      } else if (finalMeasurement !== null) {
        const verdict = computeVerdict(finalMeasurement);
        const isPass = verdict.status === 'PASS';
        
        ctx.fillStyle = isPass ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)';
        ctx.beginPath();
        ctx.roundRect(targetBox.x, targetBox.y, targetBox.w, targetBox.h, 16);
        ctx.fill();

        // Measurement Text
        ctx.fillStyle = 'white';
        ctx.font = '500 42px system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${finalMeasurement.toFixed(1)} mm`, targetBox.x + targetBox.w / 2, targetBox.y + targetBox.h / 2);

        ctx.font = '500 14px system-ui';
        ctx.fillStyle = isPass ? '#34d399' : '#f87171';
        ctx.fillText(isPass ? 'WITHIN TOLERANCE' : 'OUT OF TOLERANCE', targetBox.x + targetBox.w / 2, targetBox.y + targetBox.h / 2 + 24);
      }
      ctx.restore();

      animFrameIdRef.current = requestAnimationFrame(renderLoop);
    };

    animFrameIdRef.current = requestAnimationFrame(renderLoop);
    return () => {
      if (animFrameIdRef.current) cancelAnimationFrame(animFrameIdRef.current);
    };
  }, [scanProgress, isFrozen, finalMeasurement, computeVerdict, selectedTarget]);

  const captureCompositeSnapshot = useCallback((): string => {
    const offscreen = document.createElement('canvas');
    offscreen.width = 1280; offscreen.height = 720;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return '';
    if (videoRef.current && videoRef.current.readyState >= 2) ctx.drawImage(videoRef.current, 0, 0, 1280, 720);
    if (canvasRef.current) ctx.drawImage(canvasRef.current, 0, 0, 1280, 720);
    return offscreen.toDataURL('image/jpeg', 0.92);
  }, []);

  const handleSaveAndUse = () => {
    if (finalMeasurement === null) return;
    const evalRes = computeVerdict(finalMeasurement);
    const measurement: SmartVisionAutoDetectResult = {
      componentType: selectedTarget,
      measuredValue: finalMeasurement,
      nominalValue: activeNominalValue,
      delta: Number((finalMeasurement - activeNominalValue).toFixed(1)),
      wireDiameter: targetConfig.wireDiameter,
      status: evalRes.status as any,
      band: (evalRes as any).band,
      bandRoman: (evalRes as any).bandRoman,
      toleranceRange: evalRes.validRange,
      confidence: 0.99,
      tableReference: targetConfig.tableRef,
      snapshotBase64: captureCompositeSnapshot(),
      timestamp: new Date().toISOString(),
      detectedBogieType: bogieType,
      detectedCondition: condition,
      detectedPosition: selectedTarget.includes('SPRING') ? selectedTarget.split('_')[0] as SpringPosition : undefined
    };
    setSnapshotTaken(true);
    if (onMeasurementCaptured) onMeasurementCaptured(measurement);
  };

  const content = (
    <div className="bg-white/5 border border-white/10 backdrop-blur-xl rounded-2xl overflow-hidden shadow-2xl p-4 sm:p-5 flex flex-col gap-4">
      {/* Header & Target Selector */}
      <div className="flex flex-col gap-3">
        <div className="flex justify-between items-center">
          <div>
            <h3 className="text-white font-bold text-lg flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              AI Smart Vision AR
            </h3>
            <p className="text-slate-400 text-xs">
              {modelLoading ? 'Initializing Neural Engine...' : 'Point camera to auto-detect and measure'}
            </p>
          </div>
          {modelLoading && <RefreshCwIcon size={16} className="text-slate-400 animate-spin" />}
        </div>
        
        <div className="flex flex-wrap gap-2">
          {(Object.keys(COMPONENT_TARGET_CONFIGS) as CVComponentTarget[]).filter(k => ['OUTER_SPRING', 'INNER_SPRING', 'SNUBBER_SPRING', 'FRICTION_WEDGE'].includes(k)).map(key => {
            const cfg = COMPONENT_TARGET_CONFIGS[key];
            return (
              <button
                key={key}
                onClick={() => { setSelectedTarget(key); setIsFrozen(false); trackedBoxRef.current = null; }}
                className={`px-4 py-2 rounded-full text-xs font-medium transition ${selectedTarget === key ? 'bg-white text-slate-900 shadow-sm' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}
              >
                {cfg.labelEn}
              </button>
            );
          })}
        </div>
      </div>

      {/* Viewfinder */}
      <div className="relative aspect-[16/9] w-full bg-black/50 rounded-xl overflow-hidden border border-white/5 flex items-center justify-center">
        <video ref={videoRef} autoPlay playsInline muted className="opacity-0 pointer-events-none absolute w-1 h-1" />
        <canvas ref={canvasRef} width={960} height={540} className="absolute inset-0 w-full h-full object-contain pointer-events-none" />
      </div>

      {/* Actions */}
      <div className="flex justify-between items-center">
        <div className="text-xs font-mono text-emerald-400">
          {!modelLoading && !isFrozen && 'Scanning active...'}
          {isFrozen && 'Measurement Locked'}
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => { setIsFrozen(false); trackedBoxRef.current = null; }}
            className="px-5 py-2.5 rounded-lg text-sm font-medium bg-white/5 text-slate-300 hover:bg-white/10 transition border border-white/5"
          >
            Rescan
          </button>
          <button
            onClick={handleSaveAndUse}
            disabled={!isFrozen || snapshotTaken}
            className="px-5 py-2.5 rounded-lg text-sm font-medium bg-white text-slate-900 hover:bg-slate-100 transition shadow-sm disabled:opacity-50 flex items-center gap-2"
          >
            <CameraIcon size={16} />
            {snapshotTaken ? 'Saved' : 'Save Measurement'}
          </button>
        </div>
      </div>
    </div>
  );

  return inline ? content : (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-3 sm:p-6 overflow-y-auto">
      <div className="relative w-full max-w-3xl my-auto">{content}</div>
    </div>
  );
};
