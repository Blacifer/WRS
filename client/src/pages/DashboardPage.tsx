/**
 * DRM Officer Management Dashboards & Executive Analytics Page (Phase 2 - R4)
 * Indian Railways WRS Raipur
 */

import React, { useEffect, useState } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend
} from 'recharts';
import { api } from '../services/api.ts';
import { COLOR_HEX_MAP } from '../../../shared/classification/tables.ts';
import { useI18n } from '../i18n/index.ts';
import type { InspectionStats } from '../../../shared/types.ts';
import { configuredCoverage } from '../../../shared/knowledge/raipurWorkload.ts';
import { DAILY_PILE } from '../../../shared/sorting/throughput.ts';
import { ShopFloorNow } from '../components/ShopFloorNow.tsx';
import { VisionReadiness } from '../components/VisionReadiness.tsx';
import { ActivityIcon, BanIcon, BarChartIcon, CoilIcon, DownloadIcon, LayersIcon, SearchIcon, TrainIcon, UserIcon } from '../components/Icons.tsx';

/*
 * Band names only. The colours come from COLOR_HEX_MAP.
 *
 * This map carried its own hexes and they had drifted from RDSO's: GREEN was
 * #059669 against #16a34a, YELLOW #eab308 against #ca8a04, ORANGE #f97316
 * against #ea580c. So the same band was drawn in one colour on this chart and
 * another on the badge beside it. There is one published set of these and it
 * lives in shared/classification/tables.ts.
 */
const RDSO_BAND_COLORS: Record<string, { en: string; hi: string }> = {
  BLUE:   { en: 'Blue (Band I)',    hi: 'नीला (बैंड I)' },
  GREEN:  { en: 'Green (Band II)',  hi: 'हरा (बैंड II)' },
  YELLOW: { en: 'Yellow (Band III)', hi: 'पीला (बैंड III)' },
  ORANGE: { en: 'Orange (Band IV)', hi: 'नारंगी (बैंड IV)' },
  WHITE:  { en: 'White (Band V)',   hi: 'सफेद (बैंड V)' },
  RED:    { en: 'Red (Band VI)',    hi: 'लाल (बैंड VI)' }
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-card border border-line p-3 rounded-control text-xs backdrop-blur-md">
        {label && <p className="font-bold text-white mb-1.5">{label}</p>}
        {payload.map((entry: any, index: number) => (
          <p key={`item-${index}`} className="flex items-center gap-2 font-medium" style={{ color: entry.color || entry.stroke || entry.fill }}>
            <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: entry.color || entry.stroke || entry.fill }}></span>
            <span>{entry.name}:</span>
            <span className="font-mono font-bold text-white">{entry.value}</span>
          </p>
        ))}
      </div>
    );
  }
  return null;
};

export const DashboardPage: React.FC = () => {
  const { t, lang } = useI18n();
  const isHi = lang === 'hi';

  /*
   * Coverage against the shop's own out-turn return, as a range.
   *
   * A range rather than a figure because one line of that return reads
   * "BRN/BFKN/BFNS" and is not broken down — two of those three are covered
   * and one is not. A midpoint would be a number the data does not support
   * presented as one that does, which is the habit this panel replaced.
   */
  const coverage = configuredCoverage();
  const springCoverage = {
    bandedLow: coverage.banded.lowPercent,
    bandedHigh: coverage.banded.highPercent
  };

  /** What was actually sorted today. Nothing is shown if nothing was. */
  const [today, setToday] = useState<{ total: number } | null>(null);
  useEffect(() => {
    api.getSortingThroughput()
      .then((r) => setToday({ total: r.data.total }))
      // A missing count is left blank rather than guessed at.
      .catch(() => setToday(null));
  }, []);
  const [pipeline, setPipeline] = useState<any>(null);
  const [tat, setTat] = useState<any>(null);
  const [throughput, setThroughput] = useState<any>(null);
  const [parts, setParts] = useState<any>(null);
  const [springStats, setSpringStats] = useState<InspectionStats | null>(null);
  const [inspectors, setInspectors] = useState<any[]>([]);
  const [blockers, setBlockers] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    loadAllAnalytics();
  }, []);

  const loadAllAnalytics = async () => {
    try {
      setLoading(true);
      const [pipeRes, tatRes, tpRes, partsRes, inspRes, blockRes, statsRes] = await Promise.all([
        api.getAnalyticsPipeline(),
        api.getAnalyticsTAT(),
        api.getAnalyticsThroughput(),
        api.getAnalyticsParts(),
        api.getAnalyticsInspectors(),
        api.getAnalyticsBlockers(),
        api.getInspectionStats().catch(() => null)
      ]);

      setPipeline(pipeRes.data);
      setTat(tatRes.data);
      setThroughput(tpRes.data);
      setParts(partsRes.data);
      setInspectors(inspRes.data.inspectors || []);
      setBlockers(blockRes.data.blockedWagons || []);
      if (statsRes) {
        setSpringStats(statsRes);
      }
    } catch (err) {
      console.error('Failed loading analytics:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleExportCsv = async () => {
    try {
      const csv = await api.exportAnalytics('csv');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'WRS_Raipur_QC_Audit_Export.csv');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err: any) {
      alert(`Export failed: ${err.message}`);
    }
  };

  const handleExportPdf = async () => {
    try {
      const html = await api.exportAnalytics('pdf');
      const printWin = window.open('', '_blank');
      if (printWin) {
        printWin.document.write(html);
        printWin.document.close();
        printWin.focus();
        printWin.print();
      }
    } catch (err: any) {
      alert(`Export failed: ${err.message}`);
    }
  };

  if (loading && !pipeline) {
    return (
      <div className="text-center py-20 bg-card rounded-card border border-line text-ink-muted">
        <div className="w-8 h-8 border-2 border-accent-line border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
        <p className="text-sm">Loading DRM Officer analytics dashboard...</p>
      </div>
    );
  }

  // Prepare chart datasets
  const tatTrendData = (tat?.trends || []).map((tr: any) => ({
    period: tr.period.length > 5 ? tr.period.slice(5) : tr.period,
    fullDate: tr.period,
    [t('charts.avgTatHours')]: tr.avgHours,
    count: tr.count
  }));

  const enteredLabel = t('charts.entered');
  const releasedLabel = t('charts.released');
  const throughputChartData = (throughput?.daily || []).map((d: any) => ({
    date: d.date.length > 5 ? d.date.slice(5) : d.date,
    fullDate: d.date,
    [enteredLabel]: d.entered,
    [releasedLabel]: d.released
  }));

  const partsChartData = [
    { name: t('charts.passed'), value: parts?.totalPassed || 0, color: '#10b981' },
    { name: t('charts.condemned'), value: parts?.totalCondemned || 0, color: '#f43f5e' },
    { name: t('charts.repaired'), value: parts?.totalRepaired || 0, color: '#3b82f6' },
    { name: t('charts.replaced'), value: parts?.totalReplaced || 0, color: '#8b5cf6' }
  ].filter(item => item.value > 0);

  const springBandData = Object.entries(RDSO_BAND_COLORS).map(([bandKey, cfg]) => ({
    name: lang === 'hi' ? cfg.hi : cfg.en,
    value: springStats?.bandDistribution?.[bandKey as keyof typeof springStats.bandDistribution] || 0,
    color: COLOR_HEX_MAP[bandKey as keyof typeof COLOR_HEX_MAP] || '#71717a',
    bandKey
  })).filter(item => item.value > 0);

  return (
    <div className="space-y-8">
      {/*
        * Placed above the charts on purpose. The figures below it are true and
        * each needs interpreting; this states the decision each one implies,
        * which is what a divisional officer opens the screen for.
        */}
      <ShopFloorNow lang={lang} />

      {/*
        * The DRM asked for a camera that identifies a spring and its damage.
        * This says, from the shop's own counts, how far off that is and what
        * moves it — rather than leaving the answer to a conversation.
        */}
      <VisionReadiness lang={lang} />

      {/* Top Banner & Export Actions */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-card p-6 rounded-card border border-line">
        <div>
          <h2 className="text-xl font-extrabold tracking-[-0.025em] text-ink flex items-center gap-2.5">
            <BarChartIcon size={20} className="text-accent-ink" />
            {t('dashboard.title')}
          </h2>
          <p className="text-xs text-ink-muted mt-1">
            Real-Time Workshop Outturn, Turnaround Times & CASNUB Quality Compliance
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleExportCsv}
            className="px-4 py-2.5 bg-raised hover:bg-selected text-ink-body border border-line-strong rounded-control text-xs font-bold transition-colors flex items-center gap-2 min-h-[48px]"
          >
            <DownloadIcon size={16} />
            {t('actions.exportCsv')}
          </button>
          <button
            onClick={handleExportPdf}
            className="px-5 py-2.5 bg-accent hover:bg-accent-hover border border-accent-hover text-white rounded-control text-xs font-bold transition-colors flex items-center gap-2 min-h-[48px]"
          >
            <DownloadIcon size={16} />
            {t('actions.exportPdf')}
          </button>
        </div>
      </div>

      {/*
        WHAT THIS PANEL USED TO SAY
        ---------------------------
        "+122% Throughput Gain", "2.2x Speed Acceleration", "99.8% RDSO G-95
        Compliance", "Manual: 900 springs/day → With AI: 2,000+ springs/day",
        and a Predictive AI Insight announcing a 22% rise in condemnations for
        CASNUB 22 HS springs in the SECR zone.

        Not one of those was measured. They were hardcoded strings, on the
        first screen the DRM opens, on the screen named after them. There is
        no AI classifying springs, no predictive model, and nobody has timed
        the manual process — and the shop's own SSE puts the daily pile at
        700, not the 900 that figure was computed against.

        The real numbers sitting underneath them made it worse, not better: a
        genuine turnaround time beside an invented throughput gain lends the
        invention its credibility. And the first question a DRM asks about
        "+122%" is where it came from, which has no answer.

        What replaces it is what the system can actually show, with its
        source. It is a smaller claim and it survives being asked about.
      */}
      <div className="bg-card border border-line rounded-card p-6 space-y-4">
        <div>
          <span className="text-[10px] font-extrabold uppercase tracking-[0.07em] text-accent-ink bg-accent-soft border border-accent-line px-2.5 py-1 rounded-md">
            {isHi ? 'यह प्रणाली क्या करती है' : 'What this system does'}
          </span>
          <h3 className="text-lg font-extrabold text-white mt-2">
            {isHi
              ? 'मापा गया — अनुमान नहीं'
              : 'Measured, not estimated'}
          </h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-page border border-line rounded-control p-4">
            <p className="text-2xl font-extrabold text-white tabular-nums">
              {springCoverage.bandedLow}–{springCoverage.bandedHigh}%
            </p>
            <p className="text-xs font-bold text-ink-body mt-1">
              {isHi ? 'वैगनों के स्प्रिंग बैंड में वर्गीकृत' : 'of the year’s wagons can have springs banded'}
            </p>
            <p className="text-[11px] text-ink-faint mt-1.5 leading-snug">
              {isHi
                ? 'शॉप के 2025-26 आउटटर्न के आधार पर। एक श्रेणी का विभाजन अज्ञात है, इसलिए यह एक सीमा है।'
                : 'Against the shop’s own 2025–26 out-turn. A range because one reported line covers three wagon types and is not broken down.'}
            </p>
          </div>

          <div className="bg-page border border-line rounded-control p-4">
            <p className="text-2xl font-extrabold text-white tabular-nums">
              {(today?.total ?? 0).toLocaleString()}
            </p>
            <p className="text-xs font-bold text-ink-body mt-1">
              {isHi ? 'आज दर्ज स्प्रिंग' : 'springs recorded today'}
            </p>
            <p className="text-[11px] text-ink-faint mt-1.5 leading-snug">
              {isHi
                ? `शॉप का लक्ष्य लगभग ${DAILY_PILE} प्रतिदिन है (SSE, 27 अगस्त 2026)।`
                : `The shop sorts about ${DAILY_PILE} a day — the figure its own SSE gave on 27 August 2026.`}
            </p>
          </div>

          <div className="bg-page border border-line rounded-control p-4">
            <p className="text-2xl font-extrabold text-white tabular-nums">
              {(pipeline?.totalActive ?? 0) + (pipeline?.totalReleased ?? 0)}
            </p>
            <p className="text-xs font-bold text-ink-body mt-1">
              {isHi ? 'वैगन इस रिकॉर्ड में' : 'wagons in this record'}
            </p>
            <p className="text-[11px] text-ink-faint mt-1.5 leading-snug">
              {isHi
                ? 'हर निर्णय अपने आरडीएसओ खंड का हवाला देता है, और कोई भी रिकॉर्ड लिखे जाने के बाद बदला नहीं जा सकता।'
                : 'Every verdict cites the RDSO clause it came from, and no record can be altered after it is written.'}
            </p>
          </div>
        </div>

        <p className="text-[11px] text-ink-faint leading-relaxed border-t border-line pt-3">
          {isHi
            ? 'यह प्रणाली स्प्रिंग नहीं मापती — वह अभी भी गेज से होता है। यह लिपिकीय कार्य हटाती है: बैंड देखना, कागज़ पर लिखना, पाली के अंत में गिनती, और यह हिसाब कि ढेर से कितने पूरे नेस्ट बन सकते हैं।'
            : 'The system does not measure a spring — that is still done with the gauge. What it removes is the clerical half: looking the band up, writing it down, tallying at the end of a shift, and working out how many complete matched nests the pile can supply, which was never done by hand at all.'}
        </p>
      </div>

      {/* KPI Overview Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-card border border-line rounded-card p-5 space-y-1">
          <p className="text-xs font-semibold text-ink-muted">{t('dashboard.activeInShop')}</p>
          <p className="text-2xl font-extrabold text-accent-ink">{pipeline?.totalActive || 0}</p>
          <p className="text-[11px] text-ink-faint">Across 6 active stages</p>
        </div>

        <div className="bg-card border border-line rounded-card p-5 space-y-1">
          <p className="text-xs font-semibold text-ink-muted">{t('dashboard.releasedThisMonth')}</p>
          <p className="text-2xl font-extrabold text-good-ink">{pipeline?.totalReleased || 0}</p>
          <p className="text-[11px] text-ink-faint">Mainline certified</p>
        </div>

        <div className="bg-card border border-line rounded-card p-5 space-y-1">
          <p className="text-xs font-semibold text-ink-muted">{t('dashboard.meanTat')}</p>
          <p className="text-2xl font-extrabold text-accent-ink">{tat?.averageHours || 0}h</p>
          <p className="text-[11px] text-ink-faint">Average overhaul time</p>
        </div>

        <div className="bg-card border border-line rounded-card p-5 space-y-1">
          <p className="text-xs font-semibold text-ink-muted">{t('dashboard.medianTat')}</p>
          <p className="text-2xl font-extrabold text-accent-ink">{tat?.medianHours || 0}h</p>
          <p className="text-[11px] text-ink-faint">50th percentile</p>
        </div>

        <div className="bg-card border border-line rounded-card p-5 space-y-1">
          <p className="text-xs font-semibold text-ink-muted">{t('dashboard.p90Tat')}</p>
          <p className="text-2xl font-extrabold text-warn-ink">{tat?.p90Hours || 0}h</p>
          <p className="text-[11px] text-ink-faint">90th percentile TAT</p>
        </div>
      </div>

      {/* Interactive Charts Section 1: TAT Trend & Daily Throughput */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* TAT Trend Area/Line Chart */}
        <div className="bg-card border border-line rounded-card p-6 space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <ActivityIcon size={17} className="text-accent-ink" /> {t('charts.tatTrend')}
            </h3>
            <span className="text-xs font-semibold text-ink-muted bg-raised px-2.5 py-1 rounded-control">
              {tat?.completedWagonsCount || 0} wagons
            </span>
          </div>

          <div className="w-full h-64">
            {tatTrendData.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={tatTrendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="tatGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#38bdf8" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="period" stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                  <YAxis stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 11 }} unit="h" />
                  <Tooltip content={<CustomTooltip />} />
                  <Area
                    type="monotone"
                    dataKey={t('charts.avgTatHours')}
                    stroke="#38bdf8"
                    strokeWidth={2.5}
                    fillOpacity={1}
                    fill="url(#tatGradient)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-ink-faint">{isHi ? 'कोई पूर्ण वैगन टर्नअराउंड प्रवृत्ति डेटा दर्ज नहीं' : 'No completed wagon turnaround trend data recorded'}</div>
            )}
          </div>
        </div>

        {/* Daily Throughput Bar Chart */}
        <div className="bg-card border border-line rounded-card p-6 space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-base font-bold text-ink flex items-center gap-2">
              <BarChartIcon size={17} className="text-accent-ink" />
              {t('charts.dailyThroughput')}
            </h3>
            <span className="text-xs font-semibold text-ink-muted bg-raised px-2.5 py-1 rounded-control">
              {t('charts.days30')}
            </span>
          </div>

          <div className="w-full h-64">
            {throughputChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={throughputChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="date" stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                  <YAxis stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: '11px', color: '#cbd5e1' }} />
                  {/*
                    A validated two-series pair, not the status palette.
                    "Released" was drawn in #10b981 — the colour this interface
                    reserves for a serviceable verdict — which is how a chart
                    series ends up looking like a judgement. Blue and teal
                    separate by ΔE 21 for normal vision and 21 under
                    protanopia, and the legend names both.
                  */}
                  <Bar dataKey={enteredLabel} fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey={releasedLabel} fill="#14b8a6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-ink-faint">{isHi ? 'कोई दैनिक उत्पादन डेटा दर्ज नहीं' : 'No daily throughput data recorded'}</div>
            )}
          </div>
        </div>
      </div>

      {/* Interactive Charts Section 2: CASNUB Parts Donut & Spring Band Pie */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* CASNUB Parts Distribution Donut Chart */}
        <div className="bg-card border border-line rounded-card p-6 space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <LayersIcon size={17} className="text-accent-ink" /> {t('charts.partsDistribution')}
            </h3>
            <span className="text-xs font-semibold text-ink-muted bg-raised px-2.5 py-1 rounded-control">
              {parts?.totalInspected || 0} {t('charts.totalInspected')}
            </span>
          </div>

          <div className="w-full h-64">
            {partsChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={partsChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={4}
                    dataKey="value"
                  >
                    {partsChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} stroke="#0f172a" strokeWidth={2} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: '11px', color: '#cbd5e1' }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-ink-faint">{isHi ? 'कोई पुर्जा निरीक्षण डेटा उपलब्ध नहीं' : 'No parts inspection data available'}</div>
            )}
          </div>
        </div>

        {/* Spring Band Distribution Chart */}
        <div className="bg-card border border-line rounded-card p-6 space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <CoilIcon size={17} className="text-accent-ink" /> {t('charts.springBands')}
            </h3>
            <span className="text-xs font-semibold text-ink-muted bg-raised px-2.5 py-1 rounded-control">
              {springStats?.totalInspections || 0} {t('charts.totalInspected')}
            </span>
          </div>

          <div className="w-full h-64">
            {springBandData.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={springBandData}
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={80}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {springBandData.map((entry, index) => (
                      <Cell key={`band-cell-${index}`} fill={entry.color} stroke="#0f172a" strokeWidth={2} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: '11px', color: '#cbd5e1' }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-ink-faint">{isHi ? 'कोई स्प्रिंग बैंड वर्गीकरण डेटा दर्ज नहीं' : 'No spring band classification data recorded'}</div>
            )}
          </div>
        </div>
      </div>

      {/* 7-Stage Pipeline Load Breakdown */}
      <div className="bg-card border border-line rounded-card p-6 space-y-6">
        <h3 className="text-base font-bold text-white flex items-center gap-2">
          <TrainIcon size={17} className="text-accent-ink" /> {t('dashboard.pipelineTitle')}
        </h3>

        <div className="space-y-3">
          {Object.entries(pipeline?.counts || {}).map(([stage, count]: any) => {
            const pct = pipeline?.totalActive ? Math.round((count / (pipeline.totalActive + pipeline.totalReleased || 1)) * 100) : 0;
            const isReleased = stage === 'RELEASE';
            const isQCGate = stage === 'FINAL_QC_GATE';

            return (
              <div key={stage} className="space-y-1">
                <div className="flex justify-between text-xs font-semibold text-ink-body">
                  <span>{t(`lifecycle.stages.${stage}` as any) || stage}</span>
                  <span>
                    {count} Wagons ({pct}%)
                  </span>
                </div>
                <div className="w-full h-3 bg-raised rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all ${
                      isReleased ? 'bg-good' : isQCGate ? 'bg-warn' : 'bg-accent'
                    }`}
                    style={{ width: `${Math.max(4, pct)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Two Columns: Parts Defect Breakdown & Inspectors Productivity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* CASNUB Parts Defect Pareto */}
        <div className="bg-card border border-line rounded-card p-6 space-y-4">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <SearchIcon size={17} className="text-accent-ink" /> {t('dashboard.partsTitle')}
          </h3>
          <p className="text-xs text-ink-muted">Total inspected: {parts?.totalInspected || 0} items</p>

          <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
            {Object.entries(parts?.categoryBreakdown || {}).map(([cat, stat]: any) => {
              return (
                <div
                  key={cat}
                  className="p-3 bg-raised border border-line rounded-control space-y-1.5"
                >
                  <div className="flex justify-between items-center text-xs font-bold text-white">
                    <span>{t(`checklist.categories.${cat}` as any) || cat}</span>
                    <span className="text-bad-ink">{stat.condemned} Condemned</span>
                  </div>

                  <div className="flex justify-between text-[11px] text-ink-muted">
                    <span className="text-good-ink">{stat.passed || stat.pass || 0} Passed</span>
                    <span className="text-accent-ink">{stat.repaired || 0} Repaired</span>
                    <span className="text-accent-ink">{stat.replaced || 0} Replaced</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Inspector Productivity Table */}
        <div className="bg-card border border-line rounded-card p-6 space-y-4">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <UserIcon size={17} className="text-accent-ink" /> {t('dashboard.inspectorsTitle')}
          </h3>

          <div className="divide-y divide-line/80 max-h-80 overflow-y-auto pr-1">
            {inspectors.map((insp, idx) => (
              <div key={`${insp.inspectorId}-${idx}`} className="py-3 flex justify-between items-center">
                <div>
                  <h5 className="text-xs font-bold text-white">{insp.inspectorName}</h5>
                  <p className="text-[11px] text-ink-muted">ID: {insp.inspectorId}</p>
                </div>
                <div className="text-right">
                  <span className="text-sm font-extrabold text-accent-ink">{insp.itemsInspected}</span>
                  <p className="text-[10px] text-ink-faint">{isHi ? 'जाँचे गए घटक' : 'Components Checked'}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Active QC Blockers Diagnostics List */}
      {blockers.length > 0 && (
        <div className="bg-card border border-line rounded-card p-6 space-y-4">
          <h3 className="text-base font-bold text-bad-ink flex items-center gap-2">
            <BanIcon size={17} className="text-bad-ink" /> {t('dashboard.blockersTitle')} ({blockers.length} Wagons)
          </h3>

          <div className="space-y-3">
            {blockers.map((b) => (
              <div
                key={b.wagonNumber}
                className="p-4 bg-bad-soft border border-bad-line rounded-control space-y-2"
              >
                <div className="flex justify-between items-center">
                  <h4 className="text-xs font-extrabold text-white">{b.wagonNumber}</h4>
                  <span className="text-[10px] font-bold text-bad-ink bg-bad-soft px-2 py-0.5 rounded">
                    {b.currentStage}
                  </span>
                </div>
                <ul className="text-xs text-bad-ink/90 space-y-1 list-disc list-inside">
                  {b.blockers.map((blk: string, idx: number) => (
                    <li key={idx}>{blk}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {/*
        * Who did what, on the officer's own screen.
        *
        * Asked for directly: everything logged with the date and, where the
        * deployment can tell honestly, the address — from inspector through
        * supervisor — readable from the DRM's and the administrator's
        * dashboards. The full ledger with its filters lives under History &
        * Logs; this is the last twenty-five actions without leaving the page.
        */}
      <GaugeExposurePanel />
      <RecentActivityPanel />
    </div>
  );
};

/**
 * How much of the signed work rests on an instrument nobody has verified.
 *
 * The register lives on the administrator's screen because recording a
 * calibration is an administrator's act. But the question it answers — can
 * these verdicts be defended — is the officer's question, and asking it should
 * not require opening a settings page. Silent when everything is in order,
 * because a row saying "nothing wrong" every day is a row people stop reading.
 */
const GaugeExposurePanel: React.FC = () => {
  const [exposure, setExposure] = React.useState<{ total: number; summary: string } | null>(null);

  React.useEffect(() => {
    let live = true;
    api.getGaugeExposure()
      .then(r => { if (live) setExposure(r.data); })
      .catch(() => { /* an oversight panel must not break the dashboard */ });
    return () => { live = false; };
  }, []);

  if (!exposure || exposure.total === 0) return null;

  return (
    <div
      className="rounded-card border border-warn-line bg-warn-soft p-5"
      data-testid="dashboard-gauge-exposure"
    >
      <h3 className="text-sm font-extrabold text-warn-ink mb-1">Measurements on unverified instruments</h3>
      <p className="text-xs text-amber-100/80">{exposure.summary}</p>
      <p className="text-[11px] text-ink-muted mt-2">
        A reading is only worth its gauge&rsquo;s calibration record. Recording a calibration
        does not change readings already taken — they keep the state they had.
      </p>
    </div>
  );
};

/**
 * The most recent actions, compact.
 *
 * Deliberately not a second implementation of the ledger — it renders the
 * same ActivityLog rows the History screen does, capped, with a line pointing
 * at the full view for anything more than a glance.
 */
const RecentActivityPanel: React.FC = () => {
  const [entries, setEntries] = React.useState<any[]>([]);
  const [total, setTotal] = React.useState(0);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    api.getActivityLog({ limit: 25 })
      .then(res => { if (live) { setEntries(res.data.entries); setTotal(res.data.total); } })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);

  if (failed) return null;

  return (
    <div className="bg-card border border-line rounded-card p-5" data-testid="dashboard-activity">
      <div className="flex items-baseline justify-between mb-1">
        <h3 className="text-sm font-extrabold text-white">Who did what</h3>
        <span className="text-[11px] text-ink-faint tabular-nums">
          {total} actions recorded in all
        </span>
      </div>
      <p className="text-[11px] text-ink-faint mb-4">
        The last 25 actions across the workshop. Open History &amp; Logs to search the whole record.
      </p>

      <div className="divide-y divide-line">
        {entries.length === 0 && (
          <p className="text-xs text-ink-faint py-3">Nothing recorded yet.</p>
        )}
        {entries.map(e => (
          <div key={e.id} className="py-2.5 flex flex-col sm:flex-row sm:items-baseline gap-x-3 gap-y-0.5">
            <span className="text-xs font-bold text-ink-body min-w-[10rem]">
              {ACTIVITY_LABEL[e.eventType] || e.eventType}
            </span>
            <span className="text-xs text-ink-muted flex-1 truncate">
              {e.detail?.wagonNumber || e.detail?.partName || e.detail?.username || ''}
            </span>
            <span className="text-[11px] text-ink-faint whitespace-nowrap">
              {e.actorName}
            </span>
            <span className="text-[11px] text-ink-faint tabular-nums whitespace-nowrap">
              {new Date(e.occurredAt).toLocaleString('en-IN', {
                day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true
              })}
              {e.ipAddress ? ` · ${e.ipAddress}` : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

/* Kept short here on purpose — the full wording lives in ActivityLog. */
const ACTIVITY_LABEL: Record<string, string> = {
  AUTH_LOGIN: 'Signed in',
  INSPECTION_CREATED: 'Spring measured',
  WAGON_REGISTERED: 'Wagon registered',
  WAGON_STAGE_TRANSITION: 'Wagon moved stage',
  CHECKLIST_ITEM_INSPECTED: 'Checklist item',
  CHECKLIST_ITEM_UPDATED: 'Checklist changed',
  GATE_SIGNOFF_COMPLETED: 'Released at gate',
  SUPERVISOR_OVERRIDE_RECORDED: 'Supervisor override',
  CERTIFICATE_GENERATED: 'Certificate issued',
  BATCH_EXPORTED: 'Records exported',
  PHOTO_UPLOADED: 'Photograph taken',
  OTP_VERIFIED: 'One-time code accepted',
  SECURITY_ALERT: 'Security alert'
};
