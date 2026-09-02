/**
 * Workshop Shift Throughput & Quality Analytics Page
 * Indian Railways WRS Raipur
 */

import React, { useState, useEffect } from 'react';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend
} from 'recharts';
import type { InspectionStats, User } from '../../../shared/types.ts';
import { getDictionary } from '../i18n/index.ts';
import type { LanguageCode } from '../i18n/index.ts';
import { api } from '../services/api.ts';
import { AdminExportModal } from '../components/AdminExportModal.tsx';
import { BarChartIcon, DownloadIcon, AlertTriangleIcon, CheckCircleIcon, RefreshCwIcon, ShieldIcon } from '../components/Icons.tsx';
import { can } from '../../../shared/auth/permissions.ts';

interface AnalyticsPageProps {
  lang: LanguageCode;
  user: User | null;
}

const BAND_COLORS: Record<string, { en: string; hi: string; color: string; hex: string; bg: string }> = {
  BLUE: { en: 'Blue (Band I)', hi: 'नीला बैंड (बैंड I)', color: 'text-blue-400', hex: '#2563eb', bg: 'bg-blue-600' },
  GREEN: { en: 'Green (Band II)', hi: 'हरा बैंड (बैंड II)', color: 'text-emerald-400', hex: '#059669', bg: 'bg-emerald-600' },
  YELLOW: { en: 'Yellow (Band III)', hi: 'पीला बैंड (बैंड III)', color: 'text-yellow-400', hex: '#eab308', bg: 'bg-yellow-500' },
  ORANGE: { en: 'Orange (Band IV)', hi: 'नारंगी बैंड (बैंड IV)', color: 'text-orange-400', hex: '#f97316', bg: 'bg-orange-500' },
  WHITE: { en: 'White (Band V)', hi: 'सफेद बैंड (बैंड V)', color: 'text-slate-200', hex: '#e2e8f0', bg: 'bg-slate-300' },
  RED: { en: 'Red (Band VI)', hi: 'लाल बैंड (बैंड VI)', color: 'text-red-400', hex: '#dc2626', bg: 'bg-red-600' }
};

const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0];
    return (
      <div className="bg-slate-900/95 border border-slate-700 p-3 rounded-xl shadow-2xl text-xs backdrop-blur-md">
        <p className="flex items-center gap-2 font-medium" style={{ color: data.payload.fill || data.color }}>
          <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: data.payload.fill || data.color }}></span>
          <span className="font-bold text-white">{data.name}:</span>
          <span className="font-mono font-bold text-white">{data.value}</span>
        </p>
      </div>
    );
  }
  return null;
};

export const AnalyticsPage: React.FC<AnalyticsPageProps> = ({ lang, user }) => {
  const dict = getDictionary(lang);
  const isHi = lang === 'hi';
  const [stats, setStats] = useState<InspectionStats | null>(null);

  /*
   * The sorting operation, which is the one this screen is named after.
   *
   * This page read /api/inspections/stats alone. That table holds the
   * one-spring-at-a-time and batch flows — forty-one records here — and does
   * not contain a single sorted spring, of which there are ninety-four. The
   * shop sorts roughly nine hundred a day through Spring Sorting, so a screen
   * called Spring Analytics was reporting on everything except the work.
   *
   * stockByBand, nestCapacity and dailyThroughput have existed in the sorting
   * repository, and been served at /api/sorting/stock and
   * /api/sorting/throughput, the whole time. Nothing asked them.
   */
  type Day = {
    date: string; total: number; passed: number; condemned: number;
    firstAt: string | null; lastAt: string | null;
  };
  /*
   * Seven days rather than one. A single day's figure is zero every morning
   * before the shift starts and says nothing about whether the floor is
   * keeping up — which is the question the number is there to answer.
   */
  const [days, setDays] = useState<Day[]>([]);
  const [sortingStock, setSortingStock] = useState<any[]>([]);
  const [gaugeExposure, setGaugeExposure] = useState<{ total: number; summary: string } | null>(null);
  /*
   * What Stores should expect to issue. Held as whatever the server returned,
   * including its refusal to quote — a spring type without enough
   * condemnations behind it is reported as such rather than given a number.
   */
  const [forecast, setForecast] = useState<any>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isExportModalOpen, setIsExportModalOpen] = useState<boolean>(false);

  const loadStats = async () => {
    setIsLoading(true);
    try {
      const data = await api.getInspectionStats();
      setStats(data);
    } catch (err) {
      console.warn('[Analytics] Failed to fetch stats:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const loadSorting = async () => {
    try {
      const dates = Array.from({ length: 7 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - i);
        return d.toISOString().slice(0, 10);
      });
      const [dayResults, stock, exposure, demand] = await Promise.all([
        Promise.all(dates.map(d => api.getSortingThroughput(d).then(r => r.data).catch(() => null))),
        api.getSortingStock('CASNUB_22_NLB', 'USED'),
        api.getGaugeExposure(),
        // A supervisor reaching this page does not hold analytics.read, so a
        // 403 here is expected rather than exceptional. Swallowed to null.
        api.getConsumptionForecast(14).then(r => r.data).catch(() => null)
      ]);
      setDays(dayResults.filter(Boolean).reverse() as Day[]);
      setSortingStock(stock.data.stock || []);
      setGaugeExposure(exposure.data);
      setForecast(demand);
    } catch {
      // A quiet failure here must not take the rest of the page with it.
    }
  };

  useEffect(() => {
    loadSorting();
  }, []);

  useEffect(() => {
    loadStats();
  }, []);

  const totalInspected = stats?.totalInspections || 0;

  // Gates the audit-trail export button. Asked as a capability rather than a
  // list of role spellings, so the DRM — whose whole job is oversight —
  // gets it too, and so adding a role does not mean hunting for comparisons.
  const canExport = can(user?.role, 'certificate.export');

  const bandChartData = Object.entries(BAND_COLORS).map(([bandKey, cfg]) => ({
    name: lang === 'hi' ? cfg.hi : cfg.en,
    value: stats?.bandDistribution?.[bandKey as keyof typeof stats.bandDistribution] || 0,
    color: cfg.hex,
    bandKey
  })).filter(item => item.value > 0);

  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-6 py-6 space-y-6 pb-20 text-white">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-white flex items-center gap-2">
            <BarChartIcon size={24} className="text-blue-400" />
            <span>{dict.nav.analytics}</span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-400">
            {lang === 'hi' ? 'डब्लूआरएस रायपुर शिफ्ट उत्पादकता एवं गुणवत्ता आंकड़े' : 'WRS Raipur Bogie Section Shift Throughput & Quality Metrics'}
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            onClick={() => { loadStats(); loadSorting(); }}
            disabled={isLoading}
            className="min-h-[44px] px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl flex items-center gap-1.5 border border-slate-700"
          >
            <RefreshCwIcon size={16} className={isLoading ? 'animate-spin' : ''} />
            <span>{lang === 'hi' ? 'ताज़ा करें' : 'Refresh'}</span>
          </button>

          {canExport && (
            <button
              onClick={() => setIsExportModalOpen(true)}
              className="min-h-[44px] px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-extrabold text-xs rounded-xl shadow flex items-center gap-2"
            >
              <DownloadIcon size={16} />
              <span>{dict.actions.exportData}</span>
            </button>
          )}
        </div>
      </div>

      {/*
        * The sorting floor. Placed first because it is the larger operation by
        * an order of magnitude and the one the DRM asked for by name — roughly
        * nine hundred springs a day against forty-one records in the table this
        * page used to read from exclusively.
        */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4" data-testid="sorting-analytics">
        <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-1">
          <h2 className="text-base font-black text-white">
            {isHi ? 'स्प्रिंग सॉर्टिंग' : 'Spring sorting'}
          </h2>
          <span className="text-[11px] text-slate-500">
            {days.length > 0
              ? (isHi
                  ? `${days[0].date} से ${days[days.length - 1].date}`
                  : `${days[0].date} to ${days[days.length - 1].date}`)
              : (isHi ? 'पिछले 7 दिन' : 'the last 7 days')}
          </span>
        </div>

        {(() => {
          const today = days[days.length - 1];
          const week = days.reduce((a, d) => a + d.total, 0);
          const weekCondemned = days.reduce((a, d) => a + d.condemned, 0);
          const busiest = days.reduce((a, d) => (d.total > (a?.total ?? -1) ? d : a), null as Day | null);
          /*
           * Rate is measured from the first and last spring of the busiest
           * day, not assumed from a shift length. A figure derived from a
           * shift nobody timed is the kind of number this system exists to
           * stop producing.
           */
          const rate = busiest && busiest.firstAt && busiest.lastAt && busiest.total > 1
            ? (() => {
                const mins = (new Date(busiest.lastAt).getTime() - new Date(busiest.firstAt).getTime()) / 60000;
                return mins > 0 ? Math.round(busiest.total / (mins / 60)) : null;
              })()
            : null;

          return (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-slate-950/60 border border-slate-700 rounded-xl p-3">
                  <p className="text-2xl font-black text-white tabular-nums" data-testid="sorted-today">
                    {today?.total ?? 0}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">{isHi ? 'आज सॉर्ट की गईं' : 'sorted today'}</p>
                </div>
                <div className="bg-slate-950/60 border border-slate-700 rounded-xl p-3">
                  <p className="text-2xl font-black text-white tabular-nums" data-testid="sorted-week">{week}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">{isHi ? 'पिछले 7 दिनों में' : 'over the last 7 days'}</p>
                </div>
                <div className="bg-slate-950/60 border border-slate-700 rounded-xl p-3">
                  <p className="text-2xl font-black text-red-300 tabular-nums">{weekCondemned}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {isHi ? 'कंडम' : 'condemned'}
                    {week > 0 && <span className="text-slate-500"> · {((weekCondemned / week) * 100).toFixed(1)}%</span>}
                  </p>
                </div>
                <div className="bg-slate-950/60 border border-slate-700 rounded-xl p-3">
                  <p className="text-2xl font-black text-blue-300 tabular-nums">{rate ?? '—'}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {rate
                      ? (isHi ? 'प्रति घंटा — मापी गई' : 'per hour, measured')
                      : (isHi ? 'दर के लिए पर्याप्त डेटा नहीं' : 'not enough yet for a rate')}
                  </p>
                </div>
              </div>

              {/* Seven days at a glance. Bars rather than a chart library:
                  the shape is the whole message and it has to read on a tablet. */}
              {days.length > 0 && (
                <div className="flex items-end gap-1.5 h-16" data-testid="sorting-trend">
                  {days.map(d => {
                    const max = Math.max(1, ...days.map(x => x.total));
                    const h = Math.round((d.total / max) * 100);
                    const isToday = d === today;
                    return (
                      <div key={d.date} className="flex-1 flex flex-col items-center justify-end h-full gap-1">
                        <span className="text-[10px] text-slate-500 tabular-nums">{d.total || ''}</span>
                        <div
                          className={`w-full rounded-t ${isToday ? 'bg-blue-500' : 'bg-slate-700'}`}
                          style={{ height: `${Math.max(d.total > 0 ? 6 : 2, h)}%` }}
                          title={`${d.date}: ${d.total} sorted, ${d.condemned} condemned`}
                        />
                        <span className="text-[9px] text-slate-600">{d.date.slice(8)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          );
        })()}

        {/*
          * What is actually on the floor right now, by band.
          *
          * Distinct from the throughput figures above, which say how much work
          * was done. This says what the pile can supply — the question asked
          * when somebody needs to band a wagon this afternoon.
          */}
        {sortingStock.length > 0 && (
          <div data-testid="sorting-stock">
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">
              {isHi ? 'फ़र्श पर उपलब्ध स्टॉक, बैंड अनुसार' : 'Serviceable stock on the floor, by band'}
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-500 text-left">
                    <th className="py-1.5 pr-3 font-semibold">{isHi ? 'स्थिति' : 'Position'}</th>
                    <th className="py-1.5 pr-3 font-semibold">{isHi ? 'बैंड' : 'Band'}</th>
                    <th className="py-1.5 font-semibold text-right">{isHi ? 'संख्या' : 'Count'}</th>
                  </tr>
                </thead>
                <tbody>
                  {sortingStock.slice(0, 14).map((row: any, i: number) => (
                    <tr key={i} className="border-t border-slate-800">
                      <td className="py-1.5 pr-3 text-slate-300">{row.springPosition || '—'}</td>
                      <td className="py-1.5 pr-3">
                        <span className="inline-flex items-center gap-1.5 text-slate-200">
                          <span
                            className="w-2.5 h-2.5 rounded-full inline-block border border-slate-600"
                            style={{ backgroundColor: BAND_COLORS[row.band]?.hex || '#64748b' }}
                          />
                          {row.band || '—'}
                        </span>
                      </td>
                      <td className="py-1.5 text-right text-white font-bold tabular-nums">{row.count ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/*
          * What Stores should expect to issue.
          *
          * Shown with its own basis on every line, because an order quantity
          * nobody can interrogate is one nobody should act on. Types with too
          * thin a record are named as withheld rather than omitted — a missing
          * row reads as no demand, which is the opposite of what it means.
          */}
        {forecast && (
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 mb-6">
            <h3 className="text-sm font-bold text-white uppercase tracking-wide mb-1">
              Expected spring replacements — next {forecast.periodDays} working days
            </h3>
            <p className="text-[12px] text-slate-400 mb-3">{forecast.summary}</p>

            {forecast.lines.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="text-slate-400 text-left border-b border-slate-800">
                      <th className="py-1.5 pr-3 font-semibold">Spring</th>
                      <th className="py-1.5 pr-3 font-semibold text-right">Handled</th>
                      <th className="py-1.5 pr-3 font-semibold text-right">Condemned</th>
                      <th className="py-1.5 pr-3 font-semibold text-right">Order</th>
                      <th className="py-1.5 font-semibold text-right">From</th>
                    </tr>
                  </thead>
                  <tbody>
                    {forecast.lines.map((l: any) => (
                      <tr key={`${l.bogieType}-${l.springPosition}`} className="border-b border-slate-800/60">
                        <td className="py-1.5 pr-3 text-slate-200">
                          {l.bogieType.replace('CASNUB_22_', '')} {l.springPosition.toLowerCase()}
                        </td>
                        <td className="py-1.5 pr-3 text-right text-slate-300 tabular-nums">{l.springsHandled}</td>
                        <td className="py-1.5 pr-3 text-right text-slate-300 tabular-nums">{l.condemnationRatePct}%</td>
                        <td className="py-1.5 pr-3 text-right text-white font-bold tabular-nums">{l.expectedReplacements}</td>
                        <td className="py-1.5 text-right text-slate-500 tabular-nums">{l.basis}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {forecast.notForecast.length > 0 && (
              <p className="text-[11px] text-slate-500 mt-3 leading-relaxed">
                Not forecast yet: {forecast.notForecast
                  .map((n: any) => `${n.bogieType.replace('CASNUB_22_', '')} ${n.springPosition.toLowerCase()} (${n.condemned})`)
                  .join(', ')}. A rate needs 30 condemnations behind it before an order quantity is offered.
              </p>
            )}
          </div>
        )}

        {gaugeExposure && gaugeExposure.total > 0 && (
          <p className="text-[11px] text-amber-300/90 bg-amber-950/30 border border-amber-800/50 rounded-lg px-3 py-2 font-semibold">
            {gaugeExposure.summary}
          </p>
        )}
      </div>

      {/*
        * The day against the shop's own figure.
        *
        * This panel read "Target: 1,800 - 2,000 springs/shift" and showed the
        * floor at 2% of it. That pair of numbers came from the ROI block that
        * was deleted from the DRM dashboard two sessions ago — "Manual: 900
        * springs/day → With AI: 2,000+" — a claim about an AI that classifies
        * nothing. It survived here, so the same invention was still being
        * shown to the DRM, now dressed as his shop missing a target.
        *
        * The figure used instead is the one the shop gave: about 700 a day,
        * from its own SSE on 27 August 2026, and it is labelled as theirs
        * rather than presented as a standard. The count is sorted springs,
        * which is the work — the old one counted the inspections table, which
        * does not contain a single sorted spring.
        */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
        {(() => {
          const today = days[days.length - 1];
          const sortedToday = today?.total ?? 0;
          const shopFigure = 700;
          const pct = Math.min(100, Math.round((sortedToday / shopFigure) * 100));
          return (
            <>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h3 className="text-base font-black text-white">
                    {isHi ? 'आज का काम' : "Today's sorting against the shop's own figure"}
                  </h3>
                  <p className="text-xs text-slate-400">
                    {isHi
                      ? 'लगभग 700 प्रतिदिन — यह आंकड़ा शॉप के अपने SSE ने 27 अगस्त 2026 को दिया।'
                      : 'About 700 a day — the figure the shop\u2019s own SSE gave on 27 August 2026. Not a target set by this system.'}
                  </p>
                </div>
                <div className="text-left sm:text-right">
                  <span className="font-mono text-2xl sm:text-3xl font-black text-blue-400 tabular-nums">
                    {sortedToday.toLocaleString()}
                  </span>
                  <span className="text-xs font-semibold text-slate-400"> / ~{shopFigure} {isHi ? '' : 'springs'}</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="h-4 bg-slate-950 rounded-full overflow-hidden border border-slate-800 p-0.5">
                  <div
                    className="h-full bg-gradient-to-r from-blue-600 to-emerald-500 rounded-full transition-all duration-500"
                    style={{ width: `${sortedToday === 0 ? 0 : Math.max(2, pct)}%` }}
                  />
                </div>
                <div className="flex justify-between text-[11px] font-bold text-slate-400">
                  <span>0</span>
                  <span className="text-slate-500 font-normal">
                    {sortedToday === 0
                      ? (isHi ? 'आज अभी कुछ दर्ज नहीं हुआ' : 'nothing recorded yet today')
                      : `${pct}% ${isHi ? 'का' : 'of a typical day'}`}
                  </span>
                  <span>~{shopFigure}</span>
                </div>
              </div>
            </>
          );
        })()}
      </div>

      {/* 2. Top Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Passed Count */}
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-emerald-950/80 border border-emerald-700 flex items-center justify-center text-emerald-400">
            <CheckCircleIcon size={24} />
          </div>
          <div>
            <span className="text-xs text-slate-400 font-semibold uppercase">{dict.analytics?.passed || 'Passed'}</span>
            <div className="text-xl sm:text-2xl font-black text-emerald-400 font-mono">
              {(stats?.totalPassed || 0).toLocaleString()}
            </div>
          </div>
        </div>

        {/* Condemned Count */}
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-rose-950/80 border border-rose-700 flex items-center justify-center text-rose-400">
            <AlertTriangleIcon size={24} />
          </div>
          <div>
            <span className="text-xs text-slate-400 font-semibold uppercase">{dict.analytics?.condemned || 'Condemned'}</span>
            <div className="text-xl sm:text-2xl font-black text-rose-400 font-mono">
              {(stats?.totalCondemned || 0).toLocaleString()}
            </div>
          </div>
        </div>

        {/* Condemnation Rate */}
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-amber-950/80 border border-amber-700 flex items-center justify-center text-amber-400">
            <ShieldIcon size={24} />
          </div>
          <div>
            <span className="text-xs text-slate-400 font-semibold uppercase">{dict.analytics?.condemnRate || 'Condemnation Rate'}</span>
            <div className="text-xl sm:text-2xl font-black text-amber-400 font-mono">
              {((stats?.condemnationRatePercentage || 0)).toFixed(1)}%
            </div>
          </div>
        </div>
      </div>

      {/* 3. RDSO Band Color Distribution with Interactive Chart */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-6">
        <h3 className="text-base font-black text-white flex items-center gap-2">
          <span>🎨</span> {dict.analytics?.bandDistribution || 'RDSO Color Band Distribution'}
        </h3>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-center">
          {/* Interactive Recharts Donut */}
          <div className="w-full h-64 bg-slate-950/40 rounded-xl p-3 border border-slate-800/80">
            {bandChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={bandChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={85}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {bandChartData.map((entry, index) => (
                      <Cell key={`analytics-band-${index}`} fill={entry.color} stroke="#0f172a" strokeWidth={2} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: '11px', color: '#cbd5e1' }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-slate-500">
                {lang === 'hi' ? 'कोई स्प्रिंग डेटा उपलब्ध नहीं' : 'No spring band distribution data available'}
              </div>
            )}
          </div>

          {/* Breakdown Progress Bars */}
          <div className="space-y-3">
            {Object.entries(BAND_COLORS).map(([bandKey, cfg]) => {
              const count = stats?.bandDistribution?.[bandKey as keyof typeof stats.bandDistribution] || 0;
              const pct = totalInspected > 0 ? Math.round((count / totalInspected) * 100) : 0;
              const label = lang === 'hi' ? cfg.hi : cfg.en;

              return (
                <div key={bandKey} className="space-y-1">
                  <div className="flex justify-between text-xs font-bold">
                    <span className={cfg.color}>{label}</span>
                    <span className="font-mono text-slate-300">{count} ({pct}%)</span>
                  </div>
                  <div className="h-2.5 bg-slate-950 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${cfg.bg} transition-all`}
                      style={{ width: `${Math.max(count > 0 ? 3 : 0, pct)}%` }}
                    ></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Admin Export Modal */}
      <AdminExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        lang={lang}
      />
    </div>
  );
};
