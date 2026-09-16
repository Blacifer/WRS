/**
 * The gauge register, and the calibration dates the labels leave blank
 * Indian Railways WRS Raipur
 *
 * The shop's snubber gauge, SSG-02, carries a calibration label whose
 * "Calibrated on" and "Calibration valid upto" fields are both empty. That is
 * not a software problem, but it becomes one the moment the system records
 * thousands of verdicts without being able to say which instrument produced
 * them or whether anybody had checked it.
 *
 * So this screen does two things and refuses to do a third. It shows what the
 * register knows, and it lets an administrator record a calibration once one
 * has actually been done. It will not invent a date to make the row look
 * complete — an unrecorded calibration stays unrecorded, and the count of
 * work resting on unverified instruments is shown plainly rather than being
 * something you would have to go and calculate.
 */

import React, { useEffect, useState } from 'react';
import { api } from '../services/api.ts';
import type { LanguageCode } from '../i18n/index.ts';
import { ShieldIcon, RefreshCwIcon } from './Icons.tsx';

interface Gauge {
  gaugeCode: string;
  description: string;
  appliesTo: string | null;
  certificateNumber: string | null;
  issuedTo: string | null;
  calibratedOn: string | null;
  validUpto: string | null;
  calibrationState: 'VALID' | 'EXPIRED' | 'UNRECORDED' | 'NO_GAUGE_NAMED';
  calibrationSummary: string;
}

const STATE_STYLE: Record<string, string> = {
  VALID: 'bg-good-soft text-good-ink border-good-line',
  EXPIRED: 'bg-bad-soft text-bad-ink border-bad-line',
  UNRECORDED: 'bg-warn-soft text-warn-ink border-warn-line',
  NO_GAUGE_NAMED: 'bg-slate-500/15 text-ink-body border-line-strong'
};

const STATE_WORD: Record<string, string> = {
  VALID: 'In calibration',
  EXPIRED: 'Lapsed',
  UNRECORDED: 'Not recorded',
  NO_GAUGE_NAMED: 'Unknown'
};

export const GaugeRegister: React.FC<{ lang: LanguageCode }> = ({ lang }) => {
  const isHi = lang === 'hi';
  const [gauges, setGauges] = useState<Gauge[]>([]);
  const [exposure, setExposure] = useState<{ total: number; summary: string; summaryHi?: string } | null>(null);
  const [drift, setDrift] = useState<{ flagged: any[]; lines: any[]; summary: string; summaryHi?: string; readings: number } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [calibratedOn, setCalibratedOn] = useState('');
  const [validUpto, setValidUpto] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  // Adding an instrument. INSTALL §6 tells the shop to "enter the instruments
  // actually on the bench"; this register could only amend the one it shipped
  // with. Found on the production first-day drill.
  const [adding, setAdding] = useState(false);
  const [newGauge, setNewGauge] = useState({ gaugeCode: '', description: '', appliesTo: 'OUTER', certificateNumber: '', issuedTo: '', calibratedOn: '', validUpto: '' });

  const load = async () => {
    try {
      const [g, e, d] = await Promise.all([api.getGauges(), api.getGaugeExposure(), api.getGaugeDrift().catch(() => null)]);
      if (d) setDrift(d.data);
      setGauges(g.data.gauges as Gauge[]);
      setExposure(e.data);
    } catch (err: any) {
      setError(err?.message || 'The gauge register could not be read.');
    }
  };

  useEffect(() => { load(); }, []);

  const beginEdit = (g: Gauge) => {
    setEditing(g.gaugeCode);
    setCalibratedOn(g.calibratedOn || '');
    setValidUpto(g.validUpto || '');
    setError(null);
    setSaved(null);
  };

  const save = async (g: Gauge) => {
    setBusy(true);
    setError(null);
    try {
      await api.saveGauge(g.gaugeCode, {
        description: g.description,
        appliesTo: g.appliesTo,
        certificateNumber: g.certificateNumber,
        issuedTo: g.issuedTo,
        // Empty stays empty. Recording a blank is honest; inventing one is not.
        calibratedOn: calibratedOn || null,
        validUpto: validUpto || null
      });
      setEditing(null);
      setSaved(g.gaugeCode);
      await load();
    } catch (err: any) {
      setError(err?.message || 'That calibration could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const addGauge = async () => {
    setBusy(true);
    setError(null);
    try {
      const code = newGauge.gaugeCode.trim().toUpperCase();
      await api.saveGauge(code, {
        description: newGauge.description.trim(),
        appliesTo: newGauge.appliesTo,
        certificateNumber: newGauge.certificateNumber.trim() || null,
        issuedTo: newGauge.issuedTo.trim() || null,
        calibratedOn: newGauge.calibratedOn || null,
        validUpto: newGauge.validUpto || null
      });
      setAdding(false);
      setSaved(code);
      setNewGauge({ gaugeCode: '', description: '', appliesTo: 'OUTER', certificateNumber: '', issuedTo: '', calibratedOn: '', validUpto: '' });
      await load();
    } catch (err: any) {
      setError(err?.message || 'That gauge could not be added.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-card border border-line bg-card p-5" data-testid="gauge-register">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h3 className="text-sm font-extrabold text-white flex items-center gap-2">
          <ShieldIcon size={16} className="text-warn-ink" />
          {isHi ? 'गेज रजिस्टर' : 'Gauge register'}
        </h3>
        <button
          onClick={load}
          className="text-ink-muted hover:text-ink-body p-1.5 rounded-control hover:bg-raised"
          title={isHi ? 'रिफ़्रेश' : 'Refresh'}
        >
          <RefreshCwIcon size={14} />
        </button>
      </div>
      <p className="text-[11px] text-ink-faint mb-2">
        {isHi
          ? 'हर रीडिंग किस उपकरण से ली गई और उस समय उसका अंशांकन क्या था।'
          : 'Which instrument took each reading, and what its calibration was worth at the time.'}
      </p>
      {/*
        * Where these codes come from, said once, here.
        *
        * There is no national list of spring gauge codes to look up. WMM p.191
        * keeps spring height gauges in the spring section and records that "as
        * of now, only local colour coding is in practice in zonal Railways" —
        * so the instruments and their markings belong to this workshop. That
        * is worth stating on the screen that asks for them, because the
        * natural assumption is that a standard exists somewhere and somebody
        * simply has not found it.
        */}
      <p className="text-[11px] text-ink-muted mb-4 leading-snug">
        {isHi
          ? 'ये कोड इसी कारख़ाने के हैं। WMM पृ.191 के अनुसार रंग-कोडिंग अभी स्थानीय स्तर पर ही होती है — कोई राष्ट्रीय सूची नहीं है। बेंच पर जो उपकरण असल में हैं, वही दर्ज करें।'
          : 'These codes are this shop’s own. WMM p.191 records that only local colour coding is in practice across zonal railways, so there is no national list to copy — enter the instruments actually on the bench. Each spring position needs its own: outer, inner and snubber are different strips.'}
      </p>

      {exposure && exposure.total > 0 && (
        <p
          className="text-[11px] text-warn-ink/90 bg-warn-soft border border-warn-line rounded-control px-3 py-2 mb-4 font-semibold"
          data-testid="gauge-exposure"
        >
          {isHi ? (exposure.summaryHi || exposure.summary) : exposure.summary}
        </p>
      )}

      {/*
        * A gauge that reads high, seen in the distribution it leaves behind.
        * Advisory — the answer is the master gauge, not this panel. Shown
        * whenever there is anything to compare, so a clean result is also
        * visible rather than an absence.
        */}
      {drift && drift.readings > 0 && (
        <div
          className={`text-[11px] rounded-control px-3 py-2 mb-4 border ${drift.flagged.length > 0 ? 'text-warn-ink/90 bg-warn-soft border-warn-line' : 'text-ink-muted bg-raised border-line'}`}
          data-testid="gauge-drift"
        >
          <p className="font-semibold">{isHi ? (drift.summaryHi || drift.summary) : drift.summary}</p>
          {drift.flagged.map((l) => (
            <p key={`${l.gaugeCode}-${l.kind}`} className="mt-1">
              <span className="font-bold">{l.gaugeCode}</span> · {l.kind.replace(/CASNUB_22_/, '').replace(/\|/g, ' ').toLowerCase()} — {isHi ? (l.noteHi || l.note) : l.note}
            </p>
          ))}
        </div>
      )}

      {error && (
        <p className="text-[11px] text-bad-ink bg-bad-soft border border-bad-line rounded-control px-3 py-2 mb-3">
          {error}
        </p>
      )}

      <div className="space-y-2">
        {gauges.length === 0 && (
          <p className="text-xs text-ink-faint">{isHi ? 'रजिस्टर खाली है।' : 'The register is empty.'}</p>
        )}

        {gauges.map(g => (
          <div key={g.gaugeCode} className="border border-line rounded-control p-3 bg-page">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="font-mono text-xs font-bold text-white">{g.gaugeCode}</span>
              <span className="text-xs text-ink-body flex-1">{g.description}</span>
              <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border ${STATE_STYLE[g.calibrationState]}`}>
                {STATE_WORD[g.calibrationState]}
              </span>
            </div>

            <div className="text-[11px] text-ink-faint flex flex-wrap gap-x-3">
              {g.certificateNumber && <span>Cert {g.certificateNumber}</span>}
              {g.issuedTo && <span>{g.issuedTo}</span>}
              {g.appliesTo && <span>for {g.appliesTo.toLowerCase()} springs</span>}
            </div>

            {editing === g.gaugeCode ? (
              <div className="mt-2.5 flex flex-col sm:flex-row gap-2 sm:items-end">
                <label className="text-[11px] text-ink-muted flex-1">
                  {isHi ? 'अंशांकन तिथि' : 'Calibrated on'}
                  <input
                    type="date"
                    value={calibratedOn}
                    onChange={e => setCalibratedOn(e.target.value)}
                    className="mt-1 w-full bg-card border border-line-strong rounded-control px-2 py-1.5 text-xs text-white"
                    data-testid="gauge-calibrated-on"
                  />
                </label>
                <label className="text-[11px] text-ink-muted flex-1">
                  {isHi ? 'मान्य तिथि तक' : 'Valid up to'}
                  <input
                    type="date"
                    value={validUpto}
                    onChange={e => setValidUpto(e.target.value)}
                    className="mt-1 w-full bg-card border border-line-strong rounded-control px-2 py-1.5 text-xs text-white"
                    data-testid="gauge-valid-upto"
                  />
                </label>
                <div className="flex gap-2">
                  <button
                    disabled={busy}
                    onClick={() => save(g)}
                    className="px-3 py-1.5 rounded-control bg-good hover:bg-good text-white text-xs font-bold disabled:opacity-50"
                    data-testid="gauge-save"
                  >
                    {isHi ? 'सहेजें' : 'Save'}
                  </button>
                  <button
                    onClick={() => setEditing(null)}
                    className="px-3 py-1.5 rounded-control bg-raised hover:bg-selected text-ink-body text-xs font-bold"
                  >
                    {isHi ? 'रद्द' : 'Cancel'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="text-[11px] text-ink-muted">{g.calibrationSummary}</span>
                <button
                  onClick={() => beginEdit(g)}
                  className="text-[11px] font-bold text-warn-ink hover:text-warn-ink whitespace-nowrap"
                  data-testid="gauge-edit"
                >
                  {g.calibrationState === 'UNRECORDED'
                    ? (isHi ? 'अंशांकन दर्ज करें' : 'Record calibration')
                    : (isHi ? 'बदलें' : 'Amend')}
                </button>
              </div>
            )}

            {saved === g.gaugeCode && (
              <p className="text-[11px] text-good-ink mt-1.5 font-semibold">
                {isHi ? 'सहेजा गया।' : 'Saved. Readings from now on will carry this.'}
              </p>
            )}
          </div>
        ))}
      </div>

      {!adding ? (
        <button type="button" onClick={() => { setAdding(true); setError(null); setSaved(null); }}
          className="mt-3 min-h-[40px] px-4 rounded-control border border-accent-line bg-accent-soft text-accent-ink text-xs font-bold" data-testid="gauge-add">
          {isHi ? 'एक गेज जोड़ें' : 'Add a gauge'}
        </button>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); void addGauge(); }} className="mt-3 rounded-control border border-line bg-raised p-3 space-y-2" data-testid="gauge-add-form">
          <p className="text-[11px] text-ink-muted">
            {isHi ? 'बेंच पर रखा असली उपकरण। कोड इसी शॉप का है; हर स्प्रिंग स्थिति (बाहरी, भीतरी, स्नबर) को अपना गेज चाहिए।' : 'The real instrument on the bench. The code is this shop\'s own; each spring position (outer, inner, snubber) needs its own gauge.'}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input required value={newGauge.gaugeCode} onChange={(e) => setNewGauge({ ...newGauge, gaugeCode: e.target.value })} placeholder={isHi ? 'गेज कोड, जैसे OSG-01' : 'Gauge code, e.g. OSG-01'} data-testid="gauge-new-code"
              className="min-h-[40px] px-3 bg-card border border-line rounded-control text-sm text-white" />
            <select value={newGauge.appliesTo} onChange={(e) => setNewGauge({ ...newGauge, appliesTo: e.target.value })} data-testid="gauge-new-applies" className="min-h-[40px] px-3 bg-card border border-line rounded-control text-sm text-white">
              <option value="OUTER">{isHi ? 'बाहरी स्प्रिंग' : 'Outer springs'}</option>
              <option value="INNER">{isHi ? 'भीतरी स्प्रिंग' : 'Inner springs'}</option>
              <option value="SNUBBER">{isHi ? 'स्नबर स्प्रिंग' : 'Snubber springs'}</option>
              <option value="ALL">{isHi ? 'सभी स्थितियाँ' : 'All positions'}</option>
            </select>
            <input required value={newGauge.description} onChange={(e) => setNewGauge({ ...newGauge, description: e.target.value })} placeholder={isHi ? 'विवरण, जैसे Outer spring gauge (NLB/HS)' : 'Description, e.g. Outer spring gauge (NLB/HS)'} data-testid="gauge-new-description"
              className="sm:col-span-2 min-h-[40px] px-3 bg-card border border-line rounded-control text-sm text-white" />
            <input value={newGauge.certificateNumber} onChange={(e) => setNewGauge({ ...newGauge, certificateNumber: e.target.value })} placeholder={isHi ? 'प्रमाणपत्र संख्या (लेबल से)' : 'Certificate number (from the label)'} data-testid="gauge-new-certificate"
              className="min-h-[40px] px-3 bg-card border border-line rounded-control text-sm text-white" />
            <input value={newGauge.issuedTo} onChange={(e) => setNewGauge({ ...newGauge, issuedTo: e.target.value })} placeholder={isHi ? 'किसे जारी' : 'Issued to'}
              className="min-h-[40px] px-3 bg-card border border-line rounded-control text-sm text-white" />
            <label className="text-[11px] text-ink-muted flex flex-col gap-1">{isHi ? 'अंशांकन तिथि' : 'Calibrated on'}
              <input type="date" value={newGauge.calibratedOn} onChange={(e) => setNewGauge({ ...newGauge, calibratedOn: e.target.value })} data-testid="gauge-new-calibrated" className="min-h-[40px] px-3 bg-card border border-line rounded-control text-sm text-white" /></label>
            <label className="text-[11px] text-ink-muted flex flex-col gap-1">{isHi ? 'वैध तक' : 'Valid until'}
              <input type="date" value={newGauge.validUpto} onChange={(e) => setNewGauge({ ...newGauge, validUpto: e.target.value })} data-testid="gauge-new-valid" className="min-h-[40px] px-3 bg-card border border-line rounded-control text-sm text-white" /></label>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={busy || !newGauge.gaugeCode.trim() || !newGauge.description.trim()} className="min-h-[40px] px-4 rounded-control bg-accent text-white text-xs font-bold disabled:opacity-50" data-testid="gauge-add-save">{isHi ? 'गेज सहेजें' : 'Save gauge'}</button>
            <button type="button" onClick={() => setAdding(false)} className="min-h-[40px] px-4 rounded-control border border-line text-xs font-bold text-ink-body">{isHi ? 'रद्द करें' : 'Cancel'}</button>
          </div>
        </form>
      )}

      <p className="text-[10px] text-ink-faint mt-3 leading-relaxed">
        {isHi
          ? 'पहले दर्ज की गई रीडिंग वैसी ही रहती हैं जैसी उस समय थीं — बाद में अंशांकन दर्ज करने से पुरानी रीडिंग सत्यापित नहीं हो जातीं।'
          : 'Readings already taken keep the calibration state they had at the time. Recording a calibration now does not make earlier readings retrospectively verified.'}
      </p>
    </div>
  );
};
