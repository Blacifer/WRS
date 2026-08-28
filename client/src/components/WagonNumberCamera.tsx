/**
 * Reading the wagon number off the wagon
 * Indian Railways WRS Raipur
 *
 * The one piece of computer vision in this system that is honest. A painted
 * wagon number is high-contrast text, and reading text needs no scale
 * reference — which is exactly why measuring a spring from a photograph is
 * impossible and this is not.
 *
 * It offers a reading; it never enters one. A wagon number wrong by a single
 * digit attaches an entire overhaul to a different vehicle and would be found
 * months later, so the reading lands in the field for a person to look at
 * before they proceed, and a poor read says so instead of guessing.
 */

import { useState, useRef, useEffect } from 'react';
import { readWagonNumber } from '../services/wagonNumberOcr.ts';
import type { WagonNumberResult } from '../services/wagonNumberOcr.ts';

interface Props {
  lang: 'en' | 'hi';
  onRead: (wagonNumber: string) => void;
  onClose: () => void;
}

export function WagonNumberCamera({ lang, onRead, onClose }: Props) {
  const isHi = lang === 'hi';
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<WagonNumberResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          // The rear camera on a tablet, and enough resolution for stencilled
          // digits at arm's length.
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } }
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setReady(true);
      } catch {
        setError(
          isHi
            ? 'कैमरा नहीं खुला — नंबर हाथ से दर्ज करें। (कैमरा केवल https पर काम करता है।)'
            : 'The camera would not open, so type the number instead. Note that the camera only works over https.'
        );
      }
    })();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [isHi]);

  const capture = async () => {
    const video = videoRef.current;
    if (!video) return;

    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d')?.drawImage(video, 0, 0);
      setResult(await readWagonNumber(canvas));
    } catch (e: any) {
      setError(e?.message || 'Could not read that photograph');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 overflow-hidden">
        <div className="p-4 border-b border-slate-800 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-extrabold text-white">
              {isHi ? 'वैगन नंबर पढ़ें' : 'Read the wagon number'}
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {isHi
                ? 'वैगन पर लिखे नंबर पर कैमरा रखें — पढ़ा गया नंबर आप जाँच सकेंगे'
                : 'Point at the number painted on the wagon. You will see the reading before it is used.'}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-lg leading-none">✕</button>
        </div>

        <div className="bg-black aspect-video relative">
          <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
          {/* A guide the width of a stencilled number, so people frame it
              close enough for the digits to resolve. */}
          {ready && !result && (
            <div className="absolute inset-x-8 top-1/2 -translate-y-1/2 h-20 border-2 border-amber-400/70 rounded" />
          )}
        </div>

        <div className="p-4 space-y-3">
          {error && (
            <p className="text-xs font-semibold text-red-300 bg-red-950/40 border border-red-800 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          {result && !result.ok && (
            <div className="rounded-lg border border-amber-800 bg-amber-950/30 px-3 py-2.5 space-y-2">
              <p className="text-xs text-amber-200">{result.reason}</p>
              {result.alternatives.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[11px] text-amber-300/80">
                    {isHi ? 'यह पढ़ा गया, पर भरोसे लायक नहीं:' : 'It read these, but not confidently enough to offer:'}
                  </p>
                  {result.alternatives.slice(0, 3).map((a) => (
                    <button
                      key={a.text}
                      onClick={() => onRead(a.text)}
                      className="block w-full text-left font-mono text-sm text-white bg-slate-800 hover:bg-slate-700 rounded px-2.5 py-1.5"
                    >
                      {a.text}
                      <span className="text-[11px] text-slate-400 ml-2">
                        {a.matchesStandardFormat
                          ? (isHi ? '11 अंक' : '11 digits')
                          : (isHi ? 'मानक लंबाई नहीं' : 'not a standard length')}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {result?.ok && result.candidate && (
            <div className="rounded-lg border border-emerald-700 bg-emerald-950/30 px-3 py-3 space-y-2">
              <p className="text-[11px] text-emerald-300/80">
                {isHi ? 'पढ़ा गया — जाँच लें' : 'Read this — check it against the wagon'}
              </p>
              <p className="font-mono text-2xl text-white tracking-wider">{result.candidate.text}</p>
              <p className="text-[11px] text-slate-400">
                {(result.candidate.confidence * 100).toFixed(0)}%
                {' · '}
                {result.candidate.matchesStandardFormat
                  ? (isHi ? '11 अंक, मानक' : 'eleven digits, as expected')
                  : (isHi ? 'मानक 11 अंक नहीं — ध्यान दें' : 'not the standard eleven digits — check carefully')}
              </p>

              {/* The check digit is stronger evidence than the recogniser's own
                  confidence, so it is said plainly rather than buried in a
                  percentage. A wagon type derived from the digits also tells
                  the reader the number was understood, not just transcribed. */}
              {result.candidate.checkDigitValid ? (
                <p className="text-[11px] text-emerald-300">
                  {isHi ? '✓ चेक अंक सही' : '✓ Check digit valid'}
                  {result.candidate.impliedType
                    ? ` · ${isHi ? 'वैगन प्रकार' : 'reads as'} ${result.candidate.impliedType}`
                    : ''}
                </p>
              ) : (
                <p className="text-[11px] text-amber-300">
                  {isHi
                    ? '⚠ चेक अंक मेल नहीं खाता — वैगन पर मिलान करें'
                    : '⚠ Check digit does not match — compare against the wagon before using this'}
                </p>
              )}
              <button
                onClick={() => onRead(result.candidate!.text)}
                className="w-full min-h-[44px] rounded-lg bg-white text-black text-sm font-extrabold"
              >
                {isHi ? 'यही नंबर है' : 'Use this number'}
              </button>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={capture}
              disabled={!ready || busy}
              className="flex-1 min-h-[48px] rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-sm disabled:opacity-40"
            >
              {busy
                ? (isHi ? 'पढ़ रहे हैं…' : 'Reading…')
                : result
                  ? (isHi ? 'फिर से पढ़ें' : 'Read again')
                  : (isHi ? 'पढ़ें' : 'Read')}
            </button>
            <button
              onClick={onClose}
              className="px-4 rounded-lg border border-slate-700 text-slate-300 text-xs font-bold hover:bg-slate-800"
            >
              {isHi ? 'हाथ से लिखें' : 'Type it instead'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
