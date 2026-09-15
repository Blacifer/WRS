/**
 * The shop that measures the standard — the panel
 * Indian Railways WRS Raipur
 *
 * What this shop's springs look like against RDSO's bands, from the bench's
 * own readings: where each kind sits, how it spreads, how much lands in each
 * band, how much is condemned, and how many readings crowd a band edge.
 * Every line carries its n; a kind under thirty readings shows its count and
 * nothing else. See shared/analysis/standardReport.ts for what is and is
 * not computed.
 */

import React, { useEffect, useState } from 'react';
import { api } from '../services/api.ts';
import type { StandardReport as Report, StandardLine } from '../../../shared/analysis/standardReport.ts';
import { MIN_N } from '../../../shared/analysis/standardReport.ts';

const BAND_HEX: Record<string, string> = { BLUE: '#2563eb', GREEN: '#16a34a', YELLOW: '#ca8a04', ORANGE: '#ea580c', WHITE: '#e2e8f0', RED: '#dc2626' };

export const StandardReport: React.FC<{ lang: 'en' | 'hi' }> = ({ lang }) => {
  const isHi = lang === 'hi';
  const t = (en: string, hi: string) => (isHi ? hi : en);
  const [report, setReport] = useState<(Report & { days: number }) | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getStandardReport(365).then((r) => { if (!cancelled) setReport(r.data); }).catch(() => { if (!cancelled) setReport(null); });
    return () => { cancelled = true; };
  }, []);
  if (!report) return null;

  const label = (l: StandardLine) => `${l.bogieType.replace('CASNUB_22_', '')} ${l.condition.toLowerCase()} ${l.position.toLowerCase()}`;

  return (
    <div className="bg-card border border-line rounded-card p-5 space-y-4" data-testid="standard-report">
      <div>
        <h3 className="text-base font-bold text-white">{t('What this shop\'s springs look like, against the standard', 'इस दुकान की स्प्रिंग, मानक के सामने')}</h3>
        <p className="text-[12px] text-ink-muted mt-1">
          {t(`${report.readings} measured bench readings in the last ${report.days} days. Nothing fitted or smoothed: a centre is a median, a spread is the 10th to 90th percentile, and a kind is reported from ${MIN_N} readings.`,
             `पिछले ${report.days} दिनों में ${report.readings} मापी गई बेंच रीडिंग। कुछ भी फ़िट या स्मूद नहीं किया गया।`)}
        </p>
      </div>
      {report.lines.length === 0 && <p className="text-xs text-ink-muted">{t('No measured bench readings yet.', 'अभी कोई मापी गई बेंच रीडिंग नहीं।')}</p>}
      <div className="space-y-2">
        {report.lines.map((l) => {
          const key = `${l.bogieType}|${l.condition}|${l.position}`;
          return (
            <div key={key} className="border border-line rounded-control p-3 text-xs">
              <button type="button" onClick={() => setOpen(open === key ? null : key)} className="w-full text-left flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-bold text-white">{label(l)} <span className="text-ink-faint font-normal">· {l.table || t('no G-95 table', 'कोई G-95 तालिका नहीं')}</span></span>
                {l.reportable ? (
                  <span className="tabular-nums text-ink-body">
                    n={l.n} · {t('median', 'मध्यमान')} {l.medianMm} mm · p10–p90 {l.p10Mm}–{l.p90Mm} · {t('condemned', 'कंडम')} {l.condemnedPct}% · {t('on an edge', 'किनारे पर')} {l.onEdge.pct}%
                  </span>
                ) : (
                  <span className="text-ink-faint">{t(`${l.n} readings — too few to report (needs ${MIN_N})`, `${l.n} रीडिंग — रिपोर्ट के लिए कम (${MIN_N} चाहिए)`)}</span>
                )}
              </button>
              {open === key && l.reportable && (
                <div className="mt-3 space-y-3">
                  {l.limits && (
                    <p className="text-[11px] text-ink-muted">
                      {t('RDSO', 'RDSO')}: {l.limits.nominal !== null ? `${t('nominal', 'नाममात्र')} ${l.limits.nominal} mm · ` : ''}{t('condemn below', 'नीचे कंडम')} {l.limits.condemnMin} mm, {t('above', 'ऊपर')} {l.limits.condemnMax} mm.
                      {l.belowNominalPassPct !== null && ` ${t(`${l.belowNominalPassPct}% of passing springs are below nominal.`, `${l.belowNominalPassPct}% पास स्प्रिंग नाममात्र से नीचे हैं।`)}`}
                      {l.onEdge.busiestBoundaryMm !== null && ` ${t(`Busiest edge: ${l.onEdge.busiestBoundaryMm} mm (${l.onEdge.busiestN} readings within 0.5 mm).`, `सबसे व्यस्त किनारा: ${l.onEdge.busiestBoundaryMm} mm (${l.onEdge.busiestN})।`)}`}
                    </p>
                  )}
                  {/* The histogram, as bars, with band spans beneath. */}
                  <div>
                    <div className="flex items-end gap-px h-16" data-testid="standard-histogram">
                      {l.histogram.map((b) => {
                        const max = Math.max(...l.histogram.map((x) => x.n), 1);
                        const band = l.bands.find((bd) => b.fromMm >= bd.minMm && b.fromMm < bd.maxMm);
                        return <div key={b.fromMm} title={`${b.fromMm}–${b.fromMm + 0.5} mm: ${b.n}`} style={{ height: `${(b.n / max) * 100}%`, backgroundColor: band ? BAND_HEX[band.band] || '#888' : '#7f1d1d' }} className="flex-1 min-w-[2px] rounded-t-sm opacity-90" />;
                      })}
                    </div>
                    <div className="flex justify-between text-[10px] text-ink-faint tabular-nums mt-0.5">
                      <span>{l.histogram[0]?.fromMm} mm</span><span>{(l.histogram[l.histogram.length - 1]?.fromMm ?? 0) + 0.5} mm</span>
                    </div>
                  </div>
                  <table className="w-full text-[11px]">
                    <thead><tr className="text-ink-muted"><th className="text-left py-1">{t('Band', 'बैंड')}</th><th className="text-right py-1">mm</th><th className="text-right py-1">n</th><th className="text-right py-1">%</th></tr></thead>
                    <tbody>
                      {l.bands.map((b) => (
                        <tr key={b.band} className="border-t border-line/60">
                          <td className="py-1"><span className="inline-block w-2.5 h-2.5 rounded-sm mr-1.5 align-middle" style={{ backgroundColor: BAND_HEX[b.band] || '#888' }} />{b.roman} · {b.band}</td>
                          <td className="py-1 text-right tabular-nums">{b.minMm}–{b.maxMm}</td>
                          <td className="py-1 text-right tabular-nums">{b.n}</td>
                          <td className="py-1 text-right tabular-nums">{b.pct ?? '—'}</td>
                        </tr>
                      ))}
                      <tr className="border-t border-line/60"><td className="py-1 text-ink-muted">{t('Condemned (out of range or damaged)', 'कंडम')}</td><td /><td className="py-1 text-right tabular-nums">{l.condemned}</td><td className="py-1 text-right tabular-nums">{l.condemnedPct}</td></tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <ul className="text-[10.5px] text-ink-faint list-disc pl-4 space-y-0.5">
        {report.notes.map((n) => <li key={n}>{n}</li>)}
      </ul>
    </div>
  );
};
