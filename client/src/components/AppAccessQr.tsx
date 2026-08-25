/**
 * App access QR — a poster for the workshop wall
 * Indian Railways WRS Raipur
 *
 * WHY THIS EXISTS
 * ---------------
 * The app is reached at whatever address the workshop server happens to be on
 * — an IP like https://192.168.1.47:3000, or a tunnel URL. Asking an inspector
 * to type that on a tablet, correctly, at the start of every shift, is a small
 * daily friction that adds up to people not using the system.
 *
 * This prints a QR of the address currently in use. Stick it on the wall by
 * the bay; a tablet camera opens the app.
 *
 * The address is taken from the browser rather than configured, so it is by
 * definition the one that works: whoever generates the poster is already
 * looking at a page served from it.
 */

import { useState } from 'react';
import { QrCode } from './QrCode.tsx';

interface Props {
  lang: 'en' | 'hi';
}

export function AppAccessQr({ lang }: Props) {
  const isHi = lang === 'hi';
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const [copied, setCopied] = useState(false);

  const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(origin);
  const isInsecure = origin.startsWith('http://') && !isLocalhost;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(origin);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked; the address is on screen to read anyway */
    }
  };

  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-900 p-5 space-y-4 print:border-black print:bg-white">
      <div>
        <h3 className="text-base font-extrabold text-white print:text-black">
          {isHi ? 'ऐप खोलने का क्यूआर कोड' : 'Open-the-app QR code'}
        </h3>
        <p className="text-xs text-slate-400 mt-0.5 print:text-black">
          {isHi
            ? 'छापकर बे के पास दीवार पर लगाएँ — टैबलेट से स्कैन करने पर ऐप खुल जाएगा'
            : 'Print this and put it on the wall by the bay. Scanning it on a tablet opens the app.'}
        </p>
      </div>

      <div className="flex flex-col items-center gap-3 py-2">
        {origin ? (
          <>
            <QrCode
              value={origin}
              size={220}
              // Printed, stuck to a wall, and going to get dirty — the higher
              // error correction is worth the denser code here.
              level="H"
              title={`Opens ${origin}`}
            />
            <p className="font-mono text-xs text-slate-300 break-all text-center print:text-black">{origin}</p>
          </>
        ) : (
          <p className="text-xs text-slate-500">{isHi ? 'पता उपलब्ध नहीं' : 'Address unavailable'}</p>
        )}
      </div>

      {isLocalhost && (
        <p className="text-[11px] text-amber-300 bg-amber-950/40 border border-amber-800 rounded-lg px-3 py-2 print:hidden">
          {isHi
            ? 'यह पता केवल इसी मशीन पर काम करता है। टैबलेट के लिए पोस्टर बनाने हेतु सर्वर के नेटवर्क पते से ऐप खोलें।'
            : 'This address only works on this machine. To make a poster for the tablets, open the app using the server’s network address first — the QR always shows the address you are currently on.'}
        </p>
      )}

      {isInsecure && (
        <p className="text-[11px] text-amber-300 bg-amber-950/40 border border-amber-800 rounded-lg px-3 py-2 print:hidden">
          {isHi
            ? 'यह पता http है — कैमरा, माइक और स्कैनर केवल https पर काम करते हैं।'
            : 'This is an http address. Camera, microphone and QR scanning only work over https, so a poster pointing here would open an app with those features dead.'}
        </p>
      )}

      <div className="flex gap-2 print:hidden">
        <button
          onClick={copy}
          className="px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 text-xs font-bold hover:bg-slate-800"
        >
          {copied ? (isHi ? 'कॉपी हो गया' : 'Copied') : (isHi ? 'पता कॉपी करें' : 'Copy address')}
        </button>
        <button
          onClick={() => window.print()}
          className="px-3 py-1.5 rounded-lg bg-white text-black text-xs font-extrabold"
        >
          {isHi ? 'छापें' : 'Print'}
        </button>
      </div>
    </div>
  );
}
