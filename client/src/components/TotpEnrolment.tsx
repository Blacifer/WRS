/**
 * Authenticator enrolment
 * Indian Railways WRS Raipur
 *
 * Sets up a real second factor for the actions that need one — release
 * sign-off, band overrides, data export and account changes.
 *
 * Until now the server generated a code and returned it in its own response,
 * because no SMS gateway is integrated. That is an audited confirmation step
 * but not a second factor: whoever asked for the code received it. Here the
 * code is generated on the supervisor's own phone, from a secret shared once
 * by QR scan and never sent again.
 *
 * The manual-entry key is shown alongside the QR deliberately. Workshop
 * tablets and older phones do not always read a code off a screen reliably,
 * and an enrolment that can only happen with a working camera is one that
 * fails on the day someone's camera is greasy.
 */

import { useState, useEffect } from 'react';
import { api } from '../services/api.ts';
import { QrCode } from './QrCode.tsx';

interface Props {
  lang: 'en' | 'hi';
  onClose: () => void;
}

export function TotpEnrolment({ lang, onClose }: Props) {
  const isHi = lang === 'hi';

  const [enrolled, setEnrolled] = useState<boolean | null>(null);
  const [offer, setOffer] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    api.getTotpStatus()
      .then((r) => setEnrolled(r.data.enrolled))
      .catch(() => setEnrolled(false));
  }, []);

  const begin = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.beginTotpEnrolment();
      setOffer(r.data);
    } catch (e: any) {
      setError(e?.message || (isHi ? 'शुरू नहीं हो सका' : 'Could not start enrolment'));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.confirmTotpEnrolment(code.trim());
      setDone(true);
      setEnrolled(true);
      setOffer(null);
    } catch (e: any) {
      setError(e?.message || (isHi ? 'कोड मेल नहीं खाया' : 'That code did not match'));
    } finally {
      setBusy(false);
    }
  };

  /** Grouped into fours so it can be read aloud and typed without losing place. */
  const grouped = (s: string) => s.replace(/(.{4})/g, '$1 ').trim();

  return (
    <div className="max-w-xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-white">
            {isHi ? 'प्रमाणक ऐप सेटअप' : 'Authenticator setup'}
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {isHi
              ? 'विमुक्ति हस्ताक्षर, ओवरराइड और खाता परिवर्तन के लिए दूसरा प्रमाण'
              : 'A second factor for release sign-off, overrides and account changes'}
          </p>
        </div>
        <button onClick={onClose} className="px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 text-xs font-bold hover:bg-slate-800">
          {isHi ? 'बंद करें' : 'Close'}
        </button>
      </div>

      {enrolled === true && !offer && (
        <div className="rounded-xl border border-emerald-800 bg-emerald-950/40 p-4 space-y-3">
          <p className="text-sm font-bold text-emerald-300">
            {isHi ? '✓ प्रमाणक पहले से सेट है' : '✓ An authenticator is already set up'}
          </p>
          <p className="text-xs text-emerald-200/80">
            {isHi
              ? 'नया फ़ोन सेट करने पर पुराना काम करना बंद कर देगा।'
              : 'Setting up a new phone replaces the old one, which stops working immediately.'}
          </p>
          <button
            onClick={begin}
            disabled={busy}
            className="px-4 py-2 rounded-lg border border-emerald-700 text-emerald-200 text-xs font-bold hover:bg-emerald-900/40 disabled:opacity-40"
          >
            {isHi ? 'नया फ़ोन सेट करें' : 'Set up a new phone'}
          </button>
        </div>
      )}

      {enrolled === false && !offer && !done && (
        <div className="rounded-xl border border-amber-800 bg-amber-950/30 p-4 space-y-3">
          <p className="text-sm font-bold text-amber-200">
            {isHi ? 'अभी कोई प्रमाणक सेट नहीं है' : 'No authenticator is set up yet'}
          </p>
          <p className="text-xs text-amber-200/80">
            {isHi
              ? 'आपको एक प्रमाणक ऐप चाहिए — Google Authenticator, Microsoft Authenticator या कोई अन्य। इसे इंटरनेट की आवश्यकता नहीं होती।'
              : 'You will need an authenticator app — Google Authenticator, Microsoft Authenticator, or any other. It works without internet, which matters on the shop floor.'}
          </p>
          <button
            onClick={begin}
            disabled={busy}
            className="px-4 py-2 rounded-lg bg-white text-black text-xs font-extrabold disabled:opacity-40"
          >
            {isHi ? 'सेटअप शुरू करें' : 'Start setup'}
          </button>
        </div>
      )}

      {offer && (
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-5 space-y-4">
          <div>
            <p className="text-sm font-bold text-white mb-1">
              {isHi ? '1. इस कोड को अपने ऐप से स्कैन करें' : '1. Scan this with your authenticator app'}
            </p>
            <div className="flex justify-center py-3">
              <QrCode value={offer.uri} size={200} level="M" title="Authenticator enrolment code" />
            </div>
          </div>

          <div className="border-t border-slate-800 pt-3">
            <p className="text-xs font-bold text-slate-300 mb-1">
              {isHi ? 'कैमरा काम न करे तो यह कुंजी टाइप करें' : 'If the camera will not read it, type this key instead'}
            </p>
            <p className="font-mono text-sm text-amber-300 tracking-wider break-all select-all">
              {grouped(offer.secret)}
            </p>
          </div>

          <div className="border-t border-slate-800 pt-3 space-y-2">
            <p className="text-sm font-bold text-white">
              {isHi ? '2. ऐप में दिख रहा 6-अंकीय कोड दर्ज करें' : '2. Enter the 6-digit code your app now shows'}
            </p>
            <p className="text-[11px] text-slate-400">
              {isHi
                ? 'यह पुष्टि करता है कि फ़ोन और सर्वर एक ही कोड पर सहमत हैं — नहीं तो खराबी विमुक्ति के समय पता चलती।'
                : 'This confirms the phone and the server agree. Without it, a bad setup would only be discovered at a release gate.'}
            </p>
            <div className="flex gap-2">
              <input
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                className="w-32 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-lg text-white tracking-[0.3em] font-mono text-center"
              />
              <button
                onClick={confirm}
                disabled={busy || code.length !== 6}
                className="px-5 py-2 rounded-lg bg-white text-black text-xs font-extrabold disabled:opacity-40"
              >
                {isHi ? 'पुष्टि करें' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {done && (
        <div className="rounded-xl border border-emerald-700 bg-emerald-950/50 p-4">
          <p className="text-sm font-black text-emerald-300">
            {isHi ? '✓ प्रमाणक सेट हो गया' : '✓ Authenticator enrolled'}
          </p>
          <p className="text-xs text-emerald-200/80 mt-1">
            {isHi
              ? 'अब विमुक्ति हस्ताक्षर के समय अपने ऐप का कोड दर्ज करें। फ़ोन खो जाने पर व्यवस्थापक इसे रीसेट कर सकता है।'
              : 'Use the code from your app when signing off a release. If you lose the phone, an administrator can reset this for you.'}
          </p>
        </div>
      )}

      {error && (
        <p className="text-xs font-semibold text-red-300 bg-red-950/40 border border-red-800 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
    </div>
  );
}
