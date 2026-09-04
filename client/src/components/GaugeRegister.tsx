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
  const [exposure, setExposure] = useState<{ total: number; summary: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [calibratedOn, setCalibratedOn] = useState('');
  const [validUpto, setValidUpto] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = async () => {
    try {
      const [g, e] = await Promise.all([api.getGauges(), api.getGaugeExposure()]);
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
      <p className="text-[11px] text-ink-faint mb-4">
        {isHi
          ? 'हर रीडिंग किस उपकरण से ली गई और उस समय उसका अंशांकन क्या था।'
          : 'Which instrument took each reading, and what its calibration was worth at the time.'}
      </p>

      {exposure && exposure.total > 0 && (
        <p
          className="text-[11px] text-warn-ink/90 bg-warn-soft border border-warn-line rounded-control px-3 py-2 mb-4 font-semibold"
          data-testid="gauge-exposure"
        >
          {exposure.summary}
        </p>
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

      <p className="text-[10px] text-ink-faint mt-3 leading-relaxed">
        {isHi
          ? 'पहले दर्ज की गई रीडिंग वैसी ही रहती हैं जैसी उस समय थीं — बाद में अंशांकन दर्ज करने से पुरानी रीडिंग सत्यापित नहीं हो जातीं।'
          : 'Readings already taken keep the calibration state they had at the time. Recording a calibration now does not make earlier readings retrospectively verified.'}
      </p>
    </div>
  );
};
