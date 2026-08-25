/**
 * Audit Chain Verification
 * Indian Railways WRS Raipur
 *
 * WHY THIS SCREEN EXISTS
 * ----------------------
 * The system's central claim is that nothing can be quietly changed after the
 * fact. Append-only database triggers enforce that through the application;
 * the SHA-256 chain is what catches a change that went around the application
 * entirely — somebody editing the database file directly.
 *
 * The endpoint that checks this has existed for some time. Nothing in the
 * interface reached it, so the only way to ask the question was a terminal
 * and a hand-minted token. That made the claim true but unverifiable by the
 * people who actually rely on it, which is a strange place for the one
 * feature whose entire purpose is being checkable rather than asserted.
 *
 * WHAT A PASS DOES NOT MEAN
 * -------------------------
 * Stated on the screen, not just here. A verified chain proves no record was
 * altered after it was written. It cannot prove a record was true when it was
 * written — a wrong measurement, honestly entered, hashes exactly as well as
 * a right one. Someone reading a green tick as "the inspections were correct"
 * has read more into it than it says.
 */

import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api.ts';

interface Props {
  lang: 'en' | 'hi';
}

type Verification = Awaited<ReturnType<typeof api.verifyAuditChain>>['data'];

/**
 * What each kind of break actually means for whoever has to investigate.
 * These are distinguished by the server because they point at different
 * causes, and collapsing them into "tampered" would lose that.
 */
const BREAK_MEANING: Record<string, { en: string; hi: string }> = {
  CONTENT_ALTERED: {
    en: 'The row no longer matches its own hash. Its contents were changed after it was written.',
    hi: 'पंक्ति अपने ही हैश से मेल नहीं खाती। लिखे जाने के बाद इसकी सामग्री बदली गई है।'
  },
  BROKEN_LINK: {
    en: 'This row does not follow on from the one before it. A record was most likely deleted or inserted between them.',
    hi: 'यह पंक्ति पिछली पंक्ति से नहीं जुड़ती। संभवतः बीच से कोई रिकॉर्ड हटाया या जोड़ा गया है।'
  },
  GENESIS_MISMATCH: {
    en: 'The chain does not begin where it should. The earliest records may have been removed.',
    hi: 'श्रृंखला सही शुरुआत से नहीं शुरू होती। शुरुआती रिकॉर्ड हटाए जा सकते हैं।'
  },
  UNCHAINED: {
    en: 'The row carries no hash at all, so nothing about it can be attested either way.',
    hi: 'इस पंक्ति में कोई हैश नहीं है, इसलिए इसके बारे में कुछ भी प्रमाणित नहीं किया जा सकता।'
  }
};

export function AuditVerificationPage({ lang }: Props) {
  const isHi = lang === 'hi';

  const [result, setResult] = useState<Verification | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const verify = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.verifyAuditChain();
      setResult(res.data);
    } catch (e: any) {
      // A failed check is not a passed check. Say so plainly rather than
      // leaving the last good result on screen looking current.
      setResult(null);
      setError(
        e?.message ||
          (isHi
            ? 'जाँच पूरी नहीं हो सकी। यह "सब ठीक है" नहीं है — दोबारा कोशिश करें।'
            : 'The check could not be completed. That is not the same as passing — try again.')
      );
    } finally {
      setBusy(false);
    }
  }, [isHi]);

  useEffect(() => {
    verify();
  }, [verify]);

  const broken = result && !result.verified;

  return (
    <div className="max-w-3xl mx-auto space-y-4 p-4">
      <div className="rounded-2xl border border-slate-700 bg-slate-900 p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-extrabold text-white">
              {isHi ? 'ऑडिट श्रृंखला जाँच' : 'Audit Chain Verification'}
            </h2>
            <p className="text-xs text-slate-400 mt-1 max-w-lg">
              {isHi
                ? 'हर रिकॉर्ड का हैश दोबारा गिना जाता है, यह देखने के लिए कि लिखे जाने के बाद कुछ बदला तो नहीं।'
                : 'Every record’s hash is recomputed, to check that nothing was altered after it was written.'}
            </p>
          </div>
          <button
            onClick={verify}
            disabled={busy}
            className="px-4 min-h-[40px] rounded-lg bg-white text-black text-sm font-extrabold disabled:opacity-40 shrink-0"
          >
            {busy ? (isHi ? 'जाँच जारी…' : 'Checking…') : (isHi ? 'दोबारा जाँचें' : 'Check again')}
          </button>
        </div>

        {error && (
          <div className="rounded-lg border border-amber-800 bg-amber-950/30 px-4 py-3">
            <p className="text-sm font-semibold text-amber-200">{error}</p>
          </div>
        )}

        {busy && !result && (
          <p className="text-sm text-slate-400">
            {isHi ? 'श्रृंखला पढ़ी जा रही है…' : 'Walking the chain…'}
          </p>
        )}

        {result && (
          <>
            <div
              className={`rounded-xl border px-4 py-4 ${
                broken
                  ? 'border-red-700 bg-red-950/40'
                  : 'border-emerald-700 bg-emerald-950/30'
              }`}
            >
              <p className={`text-lg font-extrabold ${broken ? 'text-red-200' : 'text-emerald-200'}`}>
                {broken
                  ? (isHi ? '⛔ श्रृंखला टूटी हुई है' : '⛔ The chain is broken')
                  : (isHi ? '✅ श्रृंखला अटूट है' : '✅ The chain is unbroken')}
              </p>
              <p className="text-sm text-slate-300 mt-1.5">
                {isHi
                  ? `${result.entriesChecked} प्रविष्टियाँ जाँची गईं${
                      broken ? ` — ${result.breaksFound} में गड़बड़ी` : ''
                    }`
                  : result.summary}
              </p>
              <p className="text-[11px] text-slate-500 mt-2">
                {isHi ? 'जाँच का समय: ' : 'Checked at '}
                {new Date(result.checkedAt).toLocaleString(isHi ? 'hi-IN' : 'en-IN')}
              </p>
            </div>

            {broken && result.firstBrokenAt && (
              <div className="rounded-xl border border-red-800 bg-slate-950 p-4 space-y-3">
                <p className="text-xs font-bold uppercase tracking-wide text-red-300">
                  {isHi ? 'पहली गड़बड़ी यहाँ' : 'The chain first stops adding up here'}
                </p>

                <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1.5 text-sm">
                  <dt className="text-slate-500">{isHi ? 'रिकॉर्ड' : 'Record'}</dt>
                  <dd className="text-white font-mono text-xs break-all">{result.firstBrokenAt.id}</dd>

                  <dt className="text-slate-500">{isHi ? 'घटना' : 'Event'}</dt>
                  <dd className="text-white">{result.firstBrokenAt.eventType}</dd>

                  <dt className="text-slate-500">{isHi ? 'लिखा गया' : 'Written'}</dt>
                  <dd className="text-white">
                    {new Date(result.firstBrokenAt.createdAt).toLocaleString(isHi ? 'hi-IN' : 'en-IN')}
                  </dd>

                  <dt className="text-slate-500">{isHi ? 'प्रकार' : 'Kind'}</dt>
                  <dd className="text-white font-mono text-xs">{result.firstBrokenAt.reason}</dd>
                </dl>

                <p className="text-sm text-red-100 bg-red-950/50 rounded-lg px-3 py-2.5">
                  {BREAK_MEANING[result.firstBrokenAt.reason]
                    ? (isHi
                        ? BREAK_MEANING[result.firstBrokenAt.reason].hi
                        : BREAK_MEANING[result.firstBrokenAt.reason].en)
                    : result.firstBrokenAt.detail}
                </p>

                <p className="text-xs text-slate-400 leading-relaxed">
                  {isHi
                    ? 'यह अपने आप ठीक नहीं होगा। इस समय के बाद के रिकॉर्ड पर भरोसा करने से पहले बैकअप से मिलान करें और वरिष्ठ अधिकारी को सूचित करें।'
                    : 'This does not repair itself. Before relying on records from this point onward, compare against a backup and report it — a break means the database file was modified outside the application, which the application cannot undo or explain.'}
                </p>
              </div>
            )}

            {/* The limit of what a pass proves. A supervisor reading a green
                tick as "the inspections were correct" has read too much into
                it, and this is the only place that says so. */}
            {!broken && (
              <p className="text-xs text-slate-400 leading-relaxed border-t border-slate-800 pt-3">
                {isHi
                  ? 'इसका अर्थ है कि लिखे जाने के बाद कोई रिकॉर्ड बदला नहीं गया। इसका अर्थ यह नहीं है कि हर माप सही था — गलत माप भी उतनी ही सफाई से दर्ज होता है।'
                  : 'This means no record was altered after it was written. It does not mean every measurement was correct — a wrong reading, honestly entered, hashes exactly as well as a right one.'}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
