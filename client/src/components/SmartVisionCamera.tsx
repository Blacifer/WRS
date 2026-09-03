/**
 * Smart Vision camera — recognises what is in shot, and keeps it out
 * Indian Railways WRS Raipur
 *
 * Satisfies the Smart Vision requirement: the camera must show that it
 * recognises a person or background clutter and actively excludes them, so a
 * captured frame records the component and not whoever is holding it.
 *
 * Every label drawn on this overlay is something the model actually reported.
 * There is no "SPRING 98%" box, because COCO-SSD has no spring class and
 * drawing one would be a fabrication that the first chair pointed at would
 * expose. The component area is labelled "target region" — what is left once
 * recognised things are removed — and the panel says so in as many words.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  loadDetector,
  detectFrame,
  cropToTarget,
  type VisionResult,
  type Detection
} from '../services/objectDetection.ts';

interface SmartVisionCameraProps {
  lang: 'en' | 'hi';
  /** Receives the cropped capture — people and clutter already removed. */
  onCapture?: (dataUrl: string, result: VisionResult) => void;
  onClose?: () => void;
}

type LoadState = 'IDLE' | 'LOADING' | 'READY' | 'FAILED';

const ROLE_STYLE: Record<Detection['role'], { box: string; chip: string }> = {
  PERSON: { box: '#f87171', chip: 'bg-red-950/70 text-red-200 border-red-800' },
  BACKGROUND: { box: '#fbbf24', chip: 'bg-amber-950/70 text-amber-200 border-amber-800' },
  OTHER: { box: '#a3a3a3', chip: 'bg-slate-800/70 text-slate-300 border-slate-600' }
};

export const SmartVisionCamera: React.FC<SmartVisionCameraProps> = ({ lang, onCapture, onClose }) => {
  const isHi = lang === 'hi';
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const runningRef = useRef(false);

  const [loadState, setLoadState] = useState<LoadState>('IDLE');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VisionResult | null>(null);

  // ---------------------------------------------------------------------
  // Camera
  // ---------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setError(isHi ? 'इस ब्राउज़र में कैमरा उपलब्ध नहीं है।' : 'No camera is available in this browser.');
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
      } catch {
        if (!cancelled) {
          setError(
            isHi
              ? 'कैमरा नहीं खुला। ब्राउज़र में अनुमति दें — HTTPS आवश्यक है।'
              : 'The camera did not open. Allow access in the browser — this needs HTTPS.'
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      runningRef.current = false;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [isHi]);

  // ---------------------------------------------------------------------
  // Detection loop
  // ---------------------------------------------------------------------
  const draw = useCallback((res: VisionResult, w: number, h: number) => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, w, h);

    // What survives, drawn first so the exclusions sit on top of it.
    if (res.targetRegion) {
      const r = res.targetRegion;
      ctx.strokeStyle = '#34d399';
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 6]);
      ctx.strokeRect(r.x, r.y, r.width, r.height);
      ctx.setLineDash([]);
      ctx.fillStyle = '#34d399';
      ctx.font = 'bold 15px system-ui, sans-serif';
      ctx.fillText(isHi ? 'लक्ष्य क्षेत्र — यही रिकॉर्ड होगा' : 'TARGET REGION — this is what gets recorded', r.x + 8, r.y + 22);
    }

    for (const d of res.detections) {
      const [x, y, bw, bh] = d.bbox;
      const style = ROLE_STYLE[d.role];
      ctx.strokeStyle = style.box;
      ctx.lineWidth = 3;
      ctx.strokeRect(x, y, bw, bh);

      const label = `${d.className.toUpperCase()} ${(d.score * 100).toFixed(0)}% — ${isHi ? 'बाहर रखा गया' : 'EXCLUDED'}`;
      ctx.font = 'bold 14px system-ui, sans-serif';
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = style.box;
      ctx.fillRect(x, Math.max(0, y - 22), tw + 12, 22);
      ctx.fillStyle = '#0b0f14';
      ctx.fillText(label, x + 6, Math.max(14, y - 6));
    }
  }, [isHi]);

  const start = useCallback(async () => {
    setLoadState('LOADING');
    setError(null);
    try {
      const model = await loadDetector();
      setLoadState('READY');
      runningRef.current = true;

      const tick = async () => {
        if (!runningRef.current) return;
        const video = videoRef.current;
        if (video && video.readyState >= 2 && video.videoWidth > 0) {
          try {
            const res = await detectFrame(model, video, video.videoWidth, video.videoHeight);
            setResult(res);
            draw(res, video.videoWidth, video.videoHeight);
          } catch {
            // One bad frame must not end the session.
          }
        }
        if (runningRef.current) rafRef.current = requestAnimationFrame(() => void tick());
      };
      void tick();
    } catch {
      setLoadState('FAILED');
      setError(
        isHi
          ? 'पहचान मॉडल लोड नहीं हुआ। पहली बार लगभग 19 MB डाउनलोड होता है।'
          : 'The detection model did not load. It is about 19 MB on first use and is then cached.'
      );
    }
  }, [draw, isHi]);

  const capture = useCallback(() => {
    const video = videoRef.current;
    if (!video || !result) return;
    const canvas = cropToTarget(video, result.targetRegion, video.videoWidth, video.videoHeight);
    onCapture?.(canvas.toDataURL('image/jpeg', 0.9), result);
  }, [onCapture, result]);

  const blocked = result !== null && result.targetRegion === null;

  return (
    <div className="space-y-3">
      <div className="relative bg-black rounded-xl overflow-hidden border border-slate-700">
        <video ref={videoRef} playsInline muted className="w-full block" />
        <canvas
          ref={overlayRef}
          className="absolute inset-0 w-full h-full pointer-events-none"
        />

        {loadState !== 'READY' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70 p-6 text-center">
            <div className="space-y-3">
              <p className="text-slate-200 text-sm">
                {loadState === 'LOADING'
                  ? (isHi ? 'पहचान मॉडल लोड हो रहा है… (~19 MB, केवल पहली बार)' : 'Loading the detection model… (~19 MB, first time only)')
                  : (isHi ? 'यह कैमरा व्यक्ति और पृष्ठभूमि को पहचानकर बाहर रखता है।' : 'This camera recognises people and background clutter and keeps them out of the capture.')}
              </p>
              {loadState !== 'LOADING' && (
                <button
                  onClick={() => void start()}
                  className="min-h-[44px] px-5 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-xl font-bold"
                >
                  {isHi ? 'स्मार्ट विज़न शुरू करें' : 'Start Smart Vision'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-200">{error}</div>
      )}

      {/* The requirement's visible demonstration: what was recognised, and that it was excluded. */}
      {loadState === 'READY' && (
        <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-3 space-y-2">
          <div className="flex items-center justify-between text-xs font-mono text-slate-400">
            <span>{isHi ? 'पहचान' : 'DETECTION'}</span>
            <span>{result ? `${result.inferenceMs} ms` : '—'}</span>
          </div>

          <div className="flex flex-wrap gap-2">
            {result && result.detections.length === 0 && (
              <span className="text-xs text-slate-400">
                {isHi ? 'कुछ भी पहचाना नहीं गया — पूरा फ़्रेम रिकॉर्ड होगा।' : 'Nothing recognised — the whole frame will be recorded.'}
              </span>
            )}
            {result?.detections.map((d, i) => (
              <span
                key={`${d.className}-${i}`}
                className={`text-[11px] font-mono px-2 py-1 rounded border ${ROLE_STYLE[d.role].chip}`}
              >
                {d.className} {(d.score * 100).toFixed(0)}% · {isHi ? 'बाहर' : 'excluded'}
              </span>
            ))}
          </div>

          {result && (
            <p className="text-xs text-slate-400">
              {isHi
                ? `${result.personCount} व्यक्ति, ${result.backgroundCount} पृष्ठभूमि वस्तुएँ बाहर रखी गईं।`
                : `${result.personCount} person(s) and ${result.backgroundCount} background object(s) excluded from the capture.`}
            </p>
          )}

          {blocked && (
            <div className="rounded-lg border border-amber-800 bg-amber-950/40 px-3 py-2 text-sm text-amber-200">
              {isHi
                ? 'फ़्रेम में व्यक्ति बहुत बड़ा है — घटक दिखाई नहीं दे रहा। कृपया हट जाएँ और दोबारा लें।'
                : 'A person fills too much of the frame for the component to be photographed. Step aside and try again.'}
            </div>
          )}

          {/*
            * Stated on screen rather than buried in a document. The customer
            * and the inspector should both know exactly what the model does
            * and does not recognise.
            */}
          <p className="text-[11px] text-slate-500 leading-relaxed border-t border-slate-800 pt-2">
            {isHi
              ? 'यह मॉडल व्यक्ति और सामान्य वस्तुओं को पहचानता है। यह स्प्रिंग या उसका बैंड नहीं पहचानता — बैंड पट्टी से तय होता है।'
              : 'This model recognises people and everyday objects. It does not identify the spring or its band — the band is decided by the strip, and free height by the gauge.'}
          </p>
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={capture}
          disabled={loadState !== 'READY' || !result || blocked}
          className="flex-1 min-h-[48px] px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-xl font-bold"
        >
          {isHi ? 'लक्ष्य क्षेत्र कैप्चर करें' : 'Capture target region'}
        </button>
        {onClose && (
          <button
            onClick={onClose}
            className="min-h-[48px] px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl font-bold border border-slate-700"
          >
            {isHi ? 'बंद करें' : 'Close'}
          </button>
        )}
      </div>
    </div>
  );
};

export default SmartVisionCamera;
