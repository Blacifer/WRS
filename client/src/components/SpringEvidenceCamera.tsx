/**
 * A camera that watches the pile and labels what it sees
 * Indian Railways WRS Raipur
 *
 * WHAT THIS DOES NOT DO
 * ---------------------
 * It does not classify a spring. A photograph of a spring on its own carries
 * no scale — a small spring near the lens and a large one further away are
 * the same picture — and the G-95 bands are 2 to 3mm wide on a spring 245 to
 * 290mm tall. Placing one correctly needs better than ±0.4% absolute
 * accuracy, and there is nothing in the frame to measure against. Two or
 * three frames do not fix it: multiple views give shape, not size.
 *
 * The two references that would resolve it are the gauge post and the
 * spring's own wire diameter. This app holds no wire diameters, and inventing
 * one would put a fabricated number under every verdict the camera gave.
 *
 * WHAT IT DOES INSTEAD
 * --------------------
 * It captures the frame at the moment the inspector gives their verdict, and
 * stores the two together. The tap is the label. Ordinary sorting then
 * produces a labelled set from this shop, this lighting and these springs —
 * which is what any future model would have to be scored against before
 * anybody trusted it, and which does not exist today in any form.
 *
 * It pays for itself before that: a photograph attached to a condemnation is
 * evidence, and evidence is the half of this system CRIS asks about.
 *
 * WHY IT COSTS NO EXTRA TAPS
 * --------------------------
 * At ~700 springs a shift, a feature that adds one tap per spring adds 700
 * taps and will be switched off by lunchtime. The preview simply runs while
 * sorting happens; the frame is grabbed when the band is tapped. The
 * inspector's workflow does not change at all.
 */

import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';

export interface SpringEvidenceHandle {
  /** The current frame as a JPEG data URL, or null if the camera is not ready. */
  grab: () => { imageData: string; width: number; height: number } | null;
}

interface Props {
  lang: 'en' | 'hi';
  active: boolean;
  onUnavailable?: (reason: string) => void;
}

export const SpringEvidenceCamera = forwardRef<SpringEvidenceHandle, Props>(
  function SpringEvidenceCamera({ lang, active, onUnavailable }, ref) {
    const isHi = lang === 'hi';
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const [ready, setReady] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);

    useEffect(() => {
      let cancelled = false;

      const stop = () => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setReady(false);
      };

      if (!active) {
        stop();
        return;
      }

      (async () => {
        try {
          if (!navigator.mediaDevices?.getUserMedia) {
            throw new Error(
              isHi
                ? 'यह ब्राउज़र कैमरा नहीं दे सकता।'
                : 'This browser cannot open a camera. Sorting continues normally without it.'
            );
          }
          const stream = await navigator.mediaDevices.getUserMedia({
            // The rear camera is the one pointing at the pile.
            video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
            audio: false
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
          setReady(true);
          setProblem(null);
        } catch (err: any) {
          /*
           * A camera that will not open must never stop the sorting. The
           * message says so explicitly, because an inspector who thinks the
           * work has stopped being recorded goes back to paper.
           */
          const message =
            err?.name === 'NotAllowedError'
              ? isHi
                ? 'कैमरा अनुमति नहीं मिली — छँटाई सामान्य रूप से चलती रहेगी।'
                : 'Camera permission was refused. Sorting carries on normally — only the photographs stop.'
              : err?.message ||
                (isHi ? 'कैमरा नहीं खुला।' : 'The camera could not be opened. Sorting is unaffected.');
          setProblem(message);
          setReady(false);
          onUnavailable?.(message);
        }
      })();

      return () => {
        cancelled = true;
        stop();
      };
    }, [active, isHi, onUnavailable]);

    useImperativeHandle(ref, () => ({
      grab: () => {
        const video = videoRef.current;
        if (!video || !ready || !video.videoWidth) return null;
        try {
          // Downscaled deliberately. 700 full-resolution frames a shift would
          // fill the device and the database; this is large enough to see a
          // spring and a crack on it.
          const targetWidth = 640;
          const scale = targetWidth / video.videoWidth;
          const canvas = document.createElement('canvas');
          canvas.width = targetWidth;
          canvas.height = Math.round(video.videoHeight * scale);
          const ctx = canvas.getContext('2d');
          if (!ctx) return null;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          return {
            imageData: canvas.toDataURL('image/jpeg', 0.7),
            width: canvas.width,
            height: canvas.height
          };
        } catch {
          return null;
        }
      }
    }), [ready]);

    if (!active) return null;

    return (
      <div className="rounded-2xl border border-slate-700 bg-slate-900 overflow-hidden">
        <div className="relative bg-black">
          <video
            ref={videoRef}
            data-testid="spring-evidence-video"
            playsInline
            muted
            className="w-full max-h-[220px] object-cover"
          />
          {ready && (
            <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded-full bg-black/70 text-[11px] font-bold text-emerald-300">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              {isHi ? 'फ़ोटो चालू' : 'Photographing'}
            </div>
          )}
        </div>
        <p className="px-4 py-2.5 text-[11px] text-slate-400 leading-snug">
          {isHi
            ? 'स्प्रिंग को दिखाते रहें और सामान्य रूप से बैंड दबाएँ — फ़ोटो अपने आप उसी बैंड के साथ सुरक्षित हो जाएगी। कैमरा बैंड तय नहीं करता।'
            : 'Keep the spring in view and tap the band as usual — the photo is saved against whatever you tap. The camera does not decide the band.'}
        </p>
        {problem && (
          <p className="px-4 pb-3 text-[11px] text-amber-300">{problem}</p>
        )}
      </div>
    );
  }
);
