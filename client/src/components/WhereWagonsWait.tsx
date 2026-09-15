/**
 * Where wagons wait, and which one will miss its date
 * Indian Railways WRS Raipur
 *
 * Two questions the DRM asks that entry-to-release turnaround cannot answer:
 * which stage is holding the wagons, and which wagon will not make its date.
 * The first is a median per stage with how many intervals it rests on; the
 * second is arithmetic — the medians of what is left, less what the wagon
 * has already spent where it is — shown step by step so it can be checked
 * against the board. Nothing here is predicted. Where the shop has not
 * completed a stage often enough to have a median, the wagon is listed as
 * not computable, with the stage named, rather than given a date.
 */

import React, { useEffect, useState } from 'react';
import { api } from '../services/api.ts';
import type { DwellReport, ReleaseProjection } from '../../../shared/analysis/stageDwell.ts';
import { MIN_INTERVALS } from '../../../shared/analysis/stageDwell.ts';

const STAGE_LABEL: Record<string, [string, string]> = {
  ENTRY_REGISTRATION: ['Entry', 'प्रवेश'],
  DISMANTLING: ['Dismantling', 'खोलना'],
  COMPONENT_INSPECTION: ['Inspection', 'निरीक्षण'],
  REPAIR_REPLACEMENT: ['Repair', 'मरम्मत'],
  REASSEMBLY: ['Reassembly', 'पुनः संयोजन'],
  FINAL_QC_GATE: ['Exit gate', 'निकास द्वार'],
  RELEASE: ['Release', 'रिलीज़']
};

const days = (h: number) => (Math.abs(h) >= 48 ? `${(h / 24).toFixed(1)} d` : `${Math.round(h)} h`);
const dateOnly = (iso: string | null) => (iso ? iso.slice(0, 10) : '—');

export const WhereWagonsWait: React.FC<{ lang: 'en' | 'hi' }> = ({ lang }) => {
  const isHi = lang === 'hi';
  const t = (en: string, hi: string) => (isHi ? hi : en);
  const [report, setReport] = useState<DwellReport | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getAnalyticsDwell()
      .then((res) => { if (!cancelled) setReport(res.data); })
      .catch(() => { if (!cancelled) setReport(null); });
    return () => { cancelled = true; };
  }, []);

  if (!report) return null;

  const stage = (s: string) => (STAGE_LABEL[s] ? STAGE_LABEL[s][isHi ? 1 : 0] : s);
  const willMiss = report.projections.filter((p) => p.willMiss === true);
  const notComputable = report.projections.filter((p) => !p.projectedReleaseDate);
  const noDate = report.projections.filter((p) => p.projectedReleaseDate && !p.targetReleaseDate);

  return (
    <section className="bg-card border border-line rounded-card p-6 space-y-5" data-testid="where-wagons-wait">
      <div>
        <h2 className="text-xl font-black text-white flex items-center gap-2">
          <span>⏳</span> {t('Where wagons wait', 'वैगन कहाँ रुकते हैं')}
        </h2>
        <p className="text-xs text-ink-muted mt-1">
          {report.bottleneck
            ? t(
                `${stage(report.bottleneck.stage)} holds a wagon longest — a median of ${days(report.bottleneck.medianHours)}, from ${report.bottleneck.n} completed wagons.`,
                `${stage(report.bottleneck.stage)} में वैगन सबसे लंबे समय तक रुकता है — मध्यमान ${days(report.bottleneck.medianHours)}, ${report.bottleneck.n} पूर्ण वैगनों से।`
              )
            : t(
                `No stage has ${MIN_INTERVALS} completed wagons yet, so no median is quoted. This fills in as wagons move.`,
                `अभी किसी चरण में ${MIN_INTERVALS} पूर्ण वैगन नहीं हैं, इसलिए कोई मध्यमान नहीं दिया गया।`
              )}
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-ink-muted text-[10px] uppercase tracking-wide">
              <th className="text-left py-1.5">{t('Stage', 'चरण')}</th>
              <th className="text-right py-1.5">{t('Median', 'मध्यमान')}</th>
              <th className="text-right py-1.5">p90</th>
              <th className="text-right py-1.5">{t('From', 'आधार')}</th>
              <th className="text-right py-1.5">{t('In it now', 'अभी इसमें')}</th>
              <th className="text-right py-1.5">{t('Longest now', 'सबसे लंबा')}</th>
            </tr>
          </thead>
          <tbody>
            {report.byStage.map((s) => (
              <tr key={s.stage} className={`border-t border-line ${report.bottleneck?.stage === s.stage ? 'bg-warn-soft' : ''}`}>
                <td className="py-1.5 pr-3 font-bold text-white">{stage(s.stage)}</td>
                <td className="py-1.5 text-right tabular-nums text-ink-body">{s.medianHours === null ? '—' : days(s.medianHours)}</td>
                <td className="py-1.5 text-right tabular-nums text-ink-body">{s.p90Hours === null ? '—' : days(s.p90Hours)}</td>
                <td className="py-1.5 text-right tabular-nums text-ink-faint">{s.n}{s.n < MIN_INTERVALS ? ` / ${MIN_INTERVALS}` : ''}</td>
                <td className="py-1.5 text-right tabular-nums text-ink-body">{s.inStageNow}</td>
                <td className="py-1.5 text-right tabular-nums text-ink-body">{s.longestNowHours === null ? '—' : days(s.longestNowHours)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h3 className="text-sm font-black text-white">
          {t('The wagon that will miss its date', 'वह वैगन जो अपनी तिथि चूक जाएगा')}
        </h3>
        <p className="text-[11px] text-ink-muted mt-0.5">
          {t(
            `Computed, not predicted: the median of each remaining stage for wagons of this type (or the shop, where the type is too few), less what it has already spent where it is. ${report.summary.willMiss} will miss, ${report.summary.onTime} on time, ${report.summary.noTargetDate} with no date set, ${report.summary.notComputable} not computable.`,
            `गणना की गई, अनुमानित नहीं। ${report.summary.willMiss} देर से, ${report.summary.onTime} समय पर, ${report.summary.noTargetDate} बिना तिथि, ${report.summary.notComputable} गणना संभव नहीं।`
          )}
        </p>
        {willMiss.length === 0 ? (
          <p className="text-xs text-ink-muted mt-2">
            {report.summary.onTime > 0
              ? t('No wagon with a date is computed to miss it.', 'तिथि वाला कोई वैगन देर से नहीं निकलेगा।')
              : t('Nothing to compute against yet — set a due-out date when registering a wagon, and let a few wagons complete each stage.', 'अभी गणना के लिए कुछ नहीं — वैगन दर्ज करते समय रिलीज़ तिथि दें।')}
          </p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {willMiss.map((p) => (
              <Projection key={p.wagonNumber} p={p} open={open === p.wagonNumber} onToggle={() => setOpen(open === p.wagonNumber ? null : p.wagonNumber)} isHi={isHi} stage={stage} />
            ))}
          </ul>
        )}
        {(notComputable.length > 0 || noDate.length > 0) && (
          <p className="text-[11px] text-ink-faint mt-2">
            {notComputable.length > 0 && t(`Not computable: ${notComputable.map((p) => p.wagonNumber).join(', ')} — ${notComputable[0].reason} `, `गणना संभव नहीं: ${notComputable.map((p) => p.wagonNumber).join(', ')} `)}
            {noDate.length > 0 && t(`No date set: ${noDate.map((p) => p.wagonNumber).join(', ')}.`, `तिथि नहीं: ${noDate.map((p) => p.wagonNumber).join(', ')}।`)}
          </p>
        )}
      </div>
    </section>
  );
};

const Projection: React.FC<{ p: ReleaseProjection; open: boolean; onToggle: () => void; isHi: boolean; stage: (s: string) => string }> = ({ p, open, onToggle, isHi, stage }) => (
  <li className="rounded-control border border-warn-line bg-warn-soft p-2.5 text-xs" data-testid="will-miss">
    <button type="button" onClick={onToggle} className="w-full text-left flex items-center justify-between gap-3">
      <span>
        <span className="font-black text-white">{p.wagonNumber}</span>
        <span className="text-ink-muted"> · {p.wagonType} · {stage(p.currentStage)}</span>
      </span>
      <span className="tabular-nums text-warn-ink font-bold shrink-0">
        {isHi ? 'देर' : 'late by'} {days(p.hoursLate!)} · {isHi ? 'निर्धारित' : 'due'} {dateOnly(p.targetReleaseDate)} → {dateOnly(p.projectedReleaseDate)}
      </span>
    </button>
    {open && (
      <table className="mt-2 w-full text-[11px]">
        <tbody>
          {p.steps.map((s) => (
            <tr key={s.stage} className="border-t border-line/60">
              <td className="py-1 pr-2 text-ink-body">{stage(s.stage)}</td>
              <td className="py-1 text-right tabular-nums text-ink-body">
                {s.medianHours === null ? '—' : days(s.medianHours)}
                {s.elapsedHours !== undefined && ` − ${days(s.elapsedHours)} ${isHi ? 'बीत चुका' : 'spent'}`}
              </td>
              <td className="py-1 pl-2 text-right text-ink-faint">
                {s.basis ? `${s.basis.n} ${s.basis.scope === 'TYPE' ? p.wagonType : (isHi ? 'सभी प्रकार' : 'all types')}` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </li>
);
