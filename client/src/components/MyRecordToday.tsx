/**
 * My record today — what I have logged, so I can be sure
 * Indian Railways WRS Raipur
 *
 * The bench showed a session total and the last band. The first person to
 * use it on a phone asked the obvious question: "where can I see what I have
 * logged?" A person who can read their own record trusts it and stops
 * keeping a tally on paper beside the tablet. This shows the day's own
 * springs — newest first, with the band colour, the height, the gauge, the
 * time — and the counts by band above them. Own records only; it asks the
 * server, so it is what was actually saved, not what the tablet remembers.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api.ts';
import type { MySortingToday } from '../services/api.ts';
import { COLOR_HEX_MAP } from '../../../shared/classification/tables.ts';

const BAND_HI: Record<string, string> = { BLUE: 'नीला', GREEN: 'हरा', YELLOW: 'पीला', ORANGE: 'नारंगी', WHITE: 'सफ़ेद', RED: 'लाल' };
const POS_HI: Record<string, string> = { OUTER: 'बाहरी', INNER: 'भीतरी', SNUBBER: 'स्नबर', SNUBBER_OUTER: 'स्नबर बाहरी', SNUBBER_INNER: 'स्नबर भीतरी' };

interface Props {
  lang: 'en' | 'hi';
  /** Compact: the tallies and the last few, for the bench. Full: the whole day, for the home screen. */
  compact?: boolean;
  /** Bump to reload (e.g. after a tap on the strip). */
  refreshKey?: number;
}

const time = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

export const MyRecordToday: React.FC<Props> = ({ lang, compact = false, refreshKey = 0 }) => {
  const isHi = lang === 'hi';
  const t = (en: string, hi: string) => (isHi ? hi : en);
  const [data, setData] = useState<MySortingToday | null>(null);
  const [open, setOpen] = useState(!compact);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    api.getMySortingToday().then((r) => { setData(r.data); setError(false); }).catch(() => setError(true));
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);

  if (error) {
    return (
      <div className="rounded-card border border-line bg-card p-4 text-xs text-ink-muted" data-testid="my-record-offline">
        {t('Your record for today will show when the tablet next reaches the server.', 'सर्वर से जुड़ने पर आज का आपका रिकॉर्ड यहाँ दिखेगा।')}
      </div>
    );
  }
  if (!data) return null;

  const bands = ['BLUE', 'GREEN', 'YELLOW', 'ORANGE', 'WHITE', 'RED'].filter((b) => data.byBand[b]);
  const shown = compact && !open ? data.records.slice(0, 5) : data.records;

  return (
    <div className="rounded-card border border-line bg-card p-4 space-y-3" data-testid="my-record-today">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-extrabold text-white">{t('Your record today', 'आज आपका रिकॉर्ड')}</h3>
          <p className="text-[11px] text-ink-muted">
            {data.total === 0
              ? t('Nothing logged yet today.', 'आज अभी तक कुछ दर्ज नहीं।')
              : t(`${data.total} springs — ${data.passed} passed, ${data.condemned} condemned${data.lastAt ? `, last at ${time(data.lastAt)}` : ''}.`,
                  `${data.total} स्प्रिंग — ${data.passed} पास, ${data.condemned} कंडम${data.lastAt ? `, अंतिम ${time(data.lastAt)} बजे` : ''}।`)}
          </p>
        </div>
        {compact && data.records.length > 5 && (
          <button type="button" onClick={() => setOpen(!open)} className="min-h-[36px] px-3 rounded-control border border-line text-xs font-bold text-ink-body" data-testid="my-record-toggle">
            {open ? t('Show fewer', 'कम दिखाएँ') : t(`Show all ${data.records.length}`, `सभी ${data.records.length} दिखाएँ`)}
          </button>
        )}
      </div>

      {bands.length > 0 && (
        <div className="flex flex-wrap gap-1.5" data-testid="my-record-bands">
          {bands.map((b) => (
            <span key={b} className={`px-2 py-0.5 rounded-control text-[11px] font-bold ${b === 'WHITE' ? 'text-slate-900' : 'text-white'}`} style={{ backgroundColor: COLOR_HEX_MAP[b as keyof typeof COLOR_HEX_MAP] }}>
              {isHi ? BAND_HI[b] : b} · {data.byBand[b]}
            </span>
          ))}
          {data.condemned > 0 && <span className="px-2 py-0.5 rounded-control text-[11px] font-bold bg-bad-soft text-bad-ink border border-bad-line">{t('Condemned', 'कंडम')} · {data.condemned}</span>}
        </div>
      )}

      {shown.length > 0 && (
        <ul className="divide-y divide-line/60 text-xs" data-testid="my-record-list">
          {shown.map((r) => (
            <li key={r.id} className="py-1.5 flex items-center gap-2">
              <span className="w-12 shrink-0 font-mono text-ink-faint tabular-nums">{time(r.createdAt)}</span>
              <span className="w-3 h-3 rounded-full shrink-0 border border-white/20" style={{ backgroundColor: r.classifiedBand ? COLOR_HEX_MAP[r.classifiedBand as keyof typeof COLOR_HEX_MAP] : '#dc2626' }} aria-hidden="true" />
              <span className="font-bold text-ink-body w-16 shrink-0">{r.status === 'CONDEMNED' ? t('Condemned', 'कंडम') : (isHi ? BAND_HI[r.classifiedBand || ''] || r.classifiedBand : r.classifiedBand)}</span>
              <span className="text-ink-muted flex-1 min-w-0 truncate">
                {r.measuredFreeHeight ? <b className="text-ink-body tabular-nums">{r.heightIsApproximate ? '≈' : ''}{r.measuredFreeHeight} mm</b> : null}
                {r.measuredFreeHeight ? ' · ' : ''}{isHi ? POS_HI[r.springPosition] || r.springPosition : r.springPosition.toLowerCase()} · {r.bogieType.replace(/^CASNUB_/, '').replace(/_/g, ' ')}
                {r.gaugeCode ? ` · ${r.gaugeCode}` : ''}
                {r.assignedWagonNumber ? ` · ${r.assignedWagonNumber}` : ''}
                {r.status === 'CONDEMNED' && r.condemnationReason ? ` — ${r.condemnationReason}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default MyRecordToday;
