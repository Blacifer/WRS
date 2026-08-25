/**
 * Single Wagon Test (air brake) — the §720-C proforma
 * Indian Railways WRS Raipur
 *
 * WMM 2.0 §720 requires this test after POH and after any change of
 * distributor valve. It is currently a paper proforma: sixteen rows, each with
 * a published limit, filled in against a test rig and signed.
 *
 * This is that sheet. It deliberately mirrors the printed layout — same row
 * numbers, same order, same wording — because the inspector works down the rig
 * procedure in that sequence, and a form that reorders it for screen tidiness
 * would make them lose their place.
 *
 * The specified limit is shown against every row so the tester can see whether
 * a reading is in range as they write it, but the verdict is the server's:
 * nothing here decides pass or fail.
 */

import { useState, useMemo, useEffect } from 'react';
import { api } from '../services/api.ts';
import { checksFor, PISTON_STROKE_MM } from '../../../shared/classification/swtSpec.ts';
import type { PipeType, LoadCondition } from '../../../shared/classification/swtSpec.ts';

interface Props {
  wagonNumber: string;
  wagonType: string;
  lang: 'en' | 'hi';
  onRecorded?: () => void;
  onClose: () => void;
}

export function SingleWagonTestForm({ wagonNumber, wagonType, lang, onRecorded, onClose }: Props) {
  const isHi = lang === 'hi';

  const [pipeType, setPipeType] = useState<PipeType>('SINGLE');
  const [loadCondition, setLoadCondition] = useState<LoadCondition>('EMPTY');
  const [values, setValues] = useState<Record<string, string>>({});
  const [observed, setObserved] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState('');
  const [result, setResult] = useState<any>(null);
  const [latest, setLatest] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checks = useMemo(() => checksFor(pipeType), [pipeType]);

  const strokeSpec = PISTON_STROKE_MM[wagonType?.toUpperCase?.().trim()];
  const strokeRange = strokeSpec
    ? loadCondition === 'EMPTY' ? strokeSpec.empty : strokeSpec.loaded
    : null;

  useEffect(() => {
    api.getSwt(wagonNumber).then((r) => setLatest(r.data.latest)).catch(() => {});
  }, [wagonNumber]);

  const specifiedFor = (c: any): string => {
    if (c.observational) return c.expected;
    if (c.ref === '9') {
      return strokeRange
        ? `${strokeRange[0]}–${strokeRange[1]} mm`
        : (isHi ? 'इस वैगन हेतु सीमा प्रकाशित नहीं' : 'no published limit for this wagon');
    }
    if (c.min !== undefined && c.max !== undefined) return `${c.min}–${c.max} ${c.unit}`;
    if (c.max !== undefined) return `max ${c.max} ${c.unit}`;
    if (c.min !== undefined) return `min ${c.min} ${c.unit}`;
    return '—';
  };

  /** Purely advisory colouring so a bad reading is obvious as it is typed. */
  const looksOutOfRange = (c: any): boolean => {
    if (c.observational) return false;
    const raw = values[c.ref];
    if (raw === undefined || raw === '') return false;
    const v = Number(raw);
    if (!Number.isFinite(v)) return true;
    const min = c.ref === '9' ? strokeRange?.[0] : c.min;
    const max = c.ref === '9' ? strokeRange?.[1] : c.max;
    if (min !== undefined && v < min) return true;
    if (max !== undefined && v > max) return true;
    return false;
  };

  const unanswered = checks.filter((c) =>
    c.observational ? observed[c.ref] === undefined : !values[c.ref]
  );

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const readings = checks.map((c) =>
        c.observational
          ? { ref: c.ref, observed: observed[c.ref] === true }
          : { ref: c.ref, value: values[c.ref] === '' || values[c.ref] === undefined ? null : Number(values[c.ref]) }
      );
      const res = await api.recordSwt(wagonNumber, { wagonType, pipeType, loadCondition, readings, notes });
      setResult(res.data);
      setLatest(res.data);
      onRecorded?.();
    } catch (e: any) {
      setError(e?.message || (isHi ? 'परीक्षण दर्ज नहीं हो सका' : 'Could not record the test'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-extrabold text-white">
            {isHi ? 'एकल वैगन परीक्षण (वायु ब्रेक)' : 'Single Wagon Test (air brake)'}
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            {isHi
              ? 'WMM 2.0 §720-C प्रपत्र — POH के बाद अनिवार्य'
              : 'WMM 2.0 §720-C proforma — required after POH'}
          </p>
        </div>
        <button onClick={onClose} className="px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 text-xs font-bold hover:bg-slate-800">
          {isHi ? 'बंद करें' : 'Close'}
        </button>
      </div>

      {latest && !result && (
        <div className={`rounded-lg border px-3 py-2 text-xs ${latest.passed ? 'border-emerald-800 bg-emerald-950/40 text-emerald-200' : 'border-red-800 bg-red-950/40 text-red-200'}`}>
          {isHi ? 'पिछला परीक्षण' : 'Last test'}: <b>{latest.passed ? (isHi ? 'उत्तीर्ण' : 'PASSED') : (isHi ? 'अनुत्तीर्ण' : 'DID NOT PASS')}</b>
          {' · '}{latest.pipe_type} · {latest.load_condition} · {new Date(latest.created_at).toLocaleString()}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-1">
            {isHi ? 'पाइप व्यवस्था' : 'Pipe configuration'}
          </span>
          <select
            value={pipeType}
            onChange={(e) => setPipeType(e.target.value as PipeType)}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
          >
            <option value="SINGLE">{isHi ? 'सिंगल पाइप' : 'Single pipe'}</option>
            <option value="TWIN">{isHi ? 'ट्विन पाइप' : 'Twin pipe'}</option>
          </select>
        </label>
        <label className="block">
          <span className="block text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-1">
            {isHi ? 'भार स्थिति' : 'Load condition'}
          </span>
          <select
            value={loadCondition}
            onChange={(e) => setLoadCondition(e.target.value as LoadCondition)}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
          >
            <option value="EMPTY">{isHi ? 'खाली' : 'Empty'}</option>
            <option value="LOADED">{isHi ? 'लदा हुआ' : 'Loaded'}</option>
          </select>
        </label>
      </div>

      {!strokeRange && (
        <p className="text-[11px] text-amber-300 bg-amber-950/40 border border-amber-800 rounded-lg px-3 py-2">
          {isHi
            ? `${wagonType} हेतु §308B में पिस्टन स्ट्रोक सीमा प्रकाशित नहीं — मान दर्ज होगा, निर्णय नहीं।`
            : `No piston stroke limit is published for ${wagonType} in §308B. The reading will be recorded but not judged, and the test cannot report a pass until a limit exists.`}
        </p>
      )}

      {/* The proforma, in printed order */}
      <div className="overflow-x-auto rounded-lg border border-slate-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-800/70 text-slate-300">
              <th className="text-left px-2 py-2 font-bold w-12">#</th>
              <th className="text-left px-2 py-2 font-bold">{isHi ? 'जाँच' : 'Check'}</th>
              <th className="text-left px-2 py-2 font-bold w-40">{isHi ? 'निर्दिष्ट' : 'Specified'}</th>
              <th className="text-left px-2 py-2 font-bold w-36">{isHi ? 'पठन' : 'Reading'}</th>
            </tr>
          </thead>
          <tbody>
            {checks.map((c) => (
              <tr key={c.ref} className="border-t border-slate-800 align-top">
                <td className="px-2 py-2 font-mono text-xs text-slate-400">{c.ref}</td>
                <td className="px-2 py-2 text-slate-200">{isHi ? c.labelHi : c.label}</td>
                <td className="px-2 py-2 text-xs text-slate-400 tabular-nums">{specifiedFor(c)}</td>
                <td className="px-2 py-2">
                  {c.observational ? (
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => setObserved((p) => ({ ...p, [c.ref]: true }))}
                        className={`px-2.5 py-1 rounded text-xs font-bold border ${observed[c.ref] === true ? 'bg-emerald-600 border-emerald-500 text-white' : 'border-slate-700 text-slate-300'}`}
                      >
                        {isHi ? 'हाँ' : 'As specified'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setObserved((p) => ({ ...p, [c.ref]: false }))}
                        className={`px-2.5 py-1 rounded text-xs font-bold border ${observed[c.ref] === false ? 'bg-red-600 border-red-500 text-white' : 'border-slate-700 text-slate-300'}`}
                      >
                        {isHi ? 'नहीं' : 'Not'}
                      </button>
                    </div>
                  ) : (
                    <input
                      type="number"
                      step="0.01"
                      inputMode="decimal"
                      value={values[c.ref] ?? ''}
                      onChange={(e) => setValues((p) => ({ ...p, [c.ref]: e.target.value }))}
                      className={`w-28 bg-slate-800 border rounded px-2 py-1 text-sm text-white tabular-nums ${
                        looksOutOfRange(c) ? 'border-red-500' : 'border-slate-700'
                      }`}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <label className="block">
        <span className="block text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-1">
          {isHi ? 'टिप्पणी' : 'Notes'}
        </span>
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
        />
      </label>

      {unanswered.length > 0 && (
        <p className="text-[11px] text-slate-400">
          {isHi
            ? `${unanswered.length} पंक्ति शेष — प्रपत्र की हर पंक्ति भरी जानी चाहिए (${unanswered.map((c) => c.ref).join(', ')})`
            : `${unanswered.length} row${unanswered.length === 1 ? '' : 's'} still blank — the proforma requires every row answered (${unanswered.map((c) => c.ref).join(', ')})`}
        </p>
      )}

      {error && (
        <p className="text-xs font-semibold text-red-300 bg-red-950/40 border border-red-800 rounded-lg px-3 py-2">{error}</p>
      )}

      {result && (
        <div className={`rounded-lg border px-3 py-3 space-y-1 ${result.passed ? 'border-emerald-700 bg-emerald-950/40' : 'border-red-700 bg-red-950/40'}`}>
          <p className={`text-sm font-black ${result.passed ? 'text-emerald-300' : 'text-red-300'}`}>
            {result.passed
              ? (isHi ? 'परीक्षण उत्तीर्ण' : 'Test passed')
              : (isHi ? 'परीक्षण उत्तीर्ण नहीं' : 'Test did not pass')}
          </p>
          {result.failedRefs?.length > 0 && (
            <p className="text-xs text-red-200">
              {isHi ? 'सीमा से बाहर' : 'Outside limit'}: {result.failedRefs.join(', ')}
            </p>
          )}
          {result.missingRefs?.length > 0 && (
            <p className="text-xs text-amber-200">
              {isHi ? 'दर्ज नहीं' : 'Not recorded'}: {result.missingRefs.join(', ')}
            </p>
          )}
          {result.unjudgedRefs?.length > 0 && (
            <p className="text-xs text-amber-200">
              {isHi ? 'सीमा प्रकाशित नहीं' : 'No published limit'}: {result.unjudgedRefs.join(', ')}
            </p>
          )}
        </div>
      )}

      <button
        onClick={submit}
        disabled={busy}
        className="w-full min-h-[48px] rounded-xl bg-white text-black font-extrabold text-sm disabled:opacity-40 active:scale-95 transition-transform"
      >
        {busy
          ? (isHi ? 'दर्ज हो रहा है…' : 'Recording…')
          : (isHi ? 'परीक्षण दर्ज करें' : 'Record test')}
      </button>
    </div>
  );
}
