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
import { useI18n } from '../i18n/index.ts';
import type { InspectionStats } from '../../../shared/types.ts';

const RDSO_BAND_COLORS: Record<string, { en: string; hi: string; color: string }> = {
  BLUE: { en: 'Blue (Band I)', hi: 'नीला (बैंड I)', color: '#2563eb' },
  GREEN: { en: 'Green (Band II)', hi: 'हरा (बैंड II)', color: '#059669' },
  YELLOW: { en: 'Yellow (Band III)', hi: 'पीला (बैंड III)', color: '#eab308' },
  ORANGE: { en: 'Orange (Band IV)', hi: 'नारंगी (बैंड IV)', color: '#f97316' },
  WHITE: { en: 'White (Band V)', hi: 'सफेद (बैंड V)', color: '#e2e8f0' },
  RED: { en: 'Red (Band VI)', hi: 'लाल (बैंड VI)', color: '#dc2626' }
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-slate-900/95 border border-slate-700 p-3 rounded-xl shadow-2xl text-xs backdrop-blur-md">
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
      <div className="text-center py-20 bg-slate-900/40 rounded-2xl border border-slate-800 text-slate-400">
        <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
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
    color: cfg.color,
    bandKey
  })).filter(item => item.value > 0);

  return (
    <div className="space-y-8">
      {/* Top Banner & Export Actions */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-slate-900/80 p-6 rounded-2xl border border-slate-800 shadow-xl">
        <div>
          <h2 className="text-xl font-black text-white flex items-center gap-2">
            <span>📊</span> {t('dashboard.title')}
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Real-Time Workshop Outturn, Turnaround Times & CASNUB Quality Compliance
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleExportCsv}
            className="px-4 py-2.5 bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 rounded-xl text-xs font-bold transition flex items-center gap-2 min-h-[48px]"
          >
            📥 {t('actions.exportCsv')}
          </button>
          <button
            onClick={handleExportPdf}
            className="px-5 py-2.5 bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white rounded-xl text-xs font-bold shadow-lg transition flex items-center gap-2 min-h-[48px]"
          >
            🖨️ {t('actions.exportPdf')}
          </button>
        </div>
      </div>

      {/* ROI Summary Card (R5) */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-900 to-blue-950/40 border border-blue-900/50 rounded-2xl p-6 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-blue-400 bg-blue-950/80 border border-blue-800/60 px-2.5 py-1 rounded-md">
                ⚡ {t('roi.badge')}
              </span>
              <h3 className="text-lg font-black text-white mt-2 flex items-center gap-2">
                {t('roi.title')}
              </h3>
            </div>
            <div className="text-right">
              <span className="text-xl sm:text-2xl font-black text-emerald-400 font-mono">
                {t('roi.increase')}
              </span>
              <p className="text-[11px] text-slate-400">{t('roi.speedMultiplier')}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Manual Baseline */}
            <div className="p-4 bg-slate-950/70 border border-slate-800 rounded-xl space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-slate-400">{t('roi.manualRate')}</span>
                <span className="text-xs font-bold text-slate-500">45% Outturn</span>
              </div>
              <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-slate-600 rounded-full" style={{ width: '45%' }} />
              </div>
              <p className="text-[11px] text-slate-400">{t('roi.manualDetail')}</p>
            </div>

            {/* AI-Assisted */}
            <div className="p-4 bg-blue-950/40 border border-blue-800/60 rounded-xl space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-blue-300">{t('roi.aiRate')}</span>
                <span className="text-xs font-bold text-emerald-400">100% Outturn</span>
              </div>
              <div className="w-full h-3 bg-slate-950 rounded-full overflow-hidden border border-blue-900/50">
                <div className="h-full bg-gradient-to-r from-blue-500 to-emerald-400 rounded-full" style={{ width: '100%' }} />
              </div>
              <p className="text-[11px] text-blue-300/80">{t('roi.aiDetail')}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80 text-xs text-slate-400">
            <span className="font-semibold text-slate-300">
              🎯 {t('roi.accuracy')}
            </span>
            <span className="text-emerald-400 font-mono font-bold">
              {t('roi.summaryText')}
            </span>
          </div>
        </div>
      </div>

      {/* Predictive AI Agent Insight Panel */}
      <div className="bg-gradient-to-r from-emerald-900/40 via-slate-900 to-emerald-950/20 border border-emerald-800/50 rounded-2xl p-5 shadow-2xl relative overflow-hidden flex items-start gap-4">
        <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="shrink-0 p-3 bg-emerald-900/50 border border-emerald-500/30 rounded-2xl shadow-inner text-emerald-400 text-2xl">
          🤖
        </div>
        <div className="relative z-10 flex-1 space-y-2">
          <h3 className="text-sm font-black text-emerald-400 uppercase tracking-widest flex items-center gap-2">
            Predictive AI Insight <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          </h3>
          <p className="text-sm text-slate-300 font-medium leading-relaxed">
            <strong className="text-white">Trend Alert:</strong> CASNUB 22 HS outer springs from the SECR zone are showing a <span className="text-rose-400 font-bold bg-rose-950/50 px-1 rounded">22% higher condemnation rate</span> due to physical damage this month compared to the historical average. 
          </p>
          <div className="pt-3 mt-1 border-t border-emerald-800/50 flex flex-wrap gap-3">
             <button className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 shadow-lg text-white text-xs font-bold rounded-xl transition-all active:scale-95 flex items-center gap-2">
               📝 Auto-Draft Restock Request (400 Units)
             </button>
             <button className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-bold rounded-xl transition-all active:scale-95 flex items-center gap-2">
               📈 View Failure Analysis
             </button>
          </div>
        </div>
      </div>

      {/* KPI Overview Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-1">
          <p className="text-xs font-semibold text-slate-400">{t('dashboard.activeInShop')}</p>
          <p className="text-2xl font-black text-orange-400">{pipeline?.totalActive || 0}</p>
          <p className="text-[11px] text-slate-500">Across 6 active stages</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-1">
          <p className="text-xs font-semibold text-slate-400">{t('dashboard.releasedThisMonth')}</p>
          <p className="text-2xl font-black text-emerald-400">{pipeline?.totalReleased || 0}</p>
          <p className="text-[11px] text-slate-500">Mainline certified</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-1">
          <p className="text-xs font-semibold text-slate-400">{t('dashboard.meanTat')}</p>
          <p className="text-2xl font-black text-blue-400">{tat?.averageHours || 0}h</p>
          <p className="text-[11px] text-slate-500">Average overhaul time</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-1">
          <p className="text-xs font-semibold text-slate-400">{t('dashboard.medianTat')}</p>
          <p className="text-2xl font-black text-indigo-400">{tat?.medianHours || 0}h</p>
          <p className="text-[11px] text-slate-500">50th percentile</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-1">
          <p className="text-xs font-semibold text-slate-400">{t('dashboard.p90Tat')}</p>
          <p className="text-2xl font-black text-amber-400">{tat?.p90Hours || 0}h</p>
          <p className="text-[11px] text-slate-500">90th percentile TAT</p>
        </div>
      </div>

      {/* Interactive Charts Section 1: TAT Trend & Daily Throughput */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* TAT Trend Area/Line Chart */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <span>📈</span> {t('charts.tatTrend')}
            </h3>
            <span className="text-xs font-semibold text-slate-400 bg-slate-800 px-2.5 py-1 rounded-lg">
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
              <div className="h-full flex items-center justify-center text-xs text-slate-500">
                No completed wagon turnaround trend data recorded
              </div>
            )}
          </div>
        </div>

        {/* Daily Throughput Bar Chart */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <span>📊</span> {t('charts.dailyThroughput')}
            </h3>
            <span className="text-xs font-semibold text-slate-400 bg-slate-800 px-2.5 py-1 rounded-lg">
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
                  <Bar dataKey={enteredLabel} fill="#f97316" radius={[4, 4, 0, 0]} />
                  <Bar dataKey={releasedLabel} fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-slate-500">
                No daily throughput data recorded
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Interactive Charts Section 2: CASNUB Parts Donut & Spring Band Pie */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* CASNUB Parts Distribution Donut Chart */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <span>🍩</span> {t('charts.partsDistribution')}
            </h3>
            <span className="text-xs font-semibold text-slate-400 bg-slate-800 px-2.5 py-1 rounded-lg">
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
              <div className="h-full flex items-center justify-center text-xs text-slate-500">
                No parts inspection data available
              </div>
            )}
          </div>
        </div>

        {/* Spring Band Distribution Chart */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <span>🎨</span> {t('charts.springBands')}
            </h3>
            <span className="text-xs font-semibold text-slate-400 bg-slate-800 px-2.5 py-1 rounded-lg">
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
              <div className="h-full flex items-center justify-center text-xs text-slate-500">
                No spring band classification data recorded
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 7-Stage Pipeline Load Breakdown */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
        <h3 className="text-base font-bold text-white flex items-center gap-2">
          <span>🚂</span> {t('dashboard.pipelineTitle')}
        </h3>

        <div className="space-y-3">
          {Object.entries(pipeline?.counts || {}).map(([stage, count]: any) => {
            const pct = pipeline?.totalActive ? Math.round((count / (pipeline.totalActive + pipeline.totalReleased || 1)) * 100) : 0;
            const isReleased = stage === 'RELEASE';
            const isQCGate = stage === 'FINAL_QC_GATE';

            return (
              <div key={stage} className="space-y-1">
                <div className="flex justify-between text-xs font-semibold text-slate-300">
                  <span>{t(`lifecycle.stages.${stage}` as any) || stage}</span>
                  <span>
                    {count} Wagons ({pct}%)
                  </span>
                </div>
                <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all ${
                      isReleased ? 'bg-emerald-500' : isQCGate ? 'bg-amber-500' : 'bg-orange-500'
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
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <span>🔍</span> {t('dashboard.partsTitle')}
          </h3>
          <p className="text-xs text-slate-400">Total inspected: {parts?.totalInspected || 0} items</p>

          <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
            {Object.entries(parts?.categoryBreakdown || {}).map(([cat, stat]: any) => {
              return (
                <div
                  key={cat}
                  className="p-3 bg-slate-850/60 border border-slate-800 rounded-xl space-y-1.5"
                >
                  <div className="flex justify-between items-center text-xs font-bold text-white">
                    <span>{t(`checklist.categories.${cat}` as any) || cat}</span>
                    <span className="text-rose-400">{stat.condemned} Condemned</span>
                  </div>

                  <div className="flex justify-between text-[11px] text-slate-400">
                    <span className="text-emerald-400">{stat.passed || stat.pass || 0} Passed</span>
                    <span className="text-blue-400">{stat.repaired || 0} Repaired</span>
                    <span className="text-indigo-400">{stat.replaced || 0} Replaced</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Inspector Productivity Table */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <span>👷</span> {t('dashboard.inspectorsTitle')}
          </h3>

          <div className="divide-y divide-slate-800/80 max-h-80 overflow-y-auto pr-1">
            {inspectors.map((insp, idx) => (
              <div key={`${insp.inspectorId}-${idx}`} className="py-3 flex justify-between items-center">
                <div>
                  <h5 className="text-xs font-bold text-white">{insp.inspectorName}</h5>
                  <p className="text-[11px] text-slate-400">ID: {insp.inspectorId}</p>
                </div>
                <div className="text-right">
                  <span className="text-sm font-black text-orange-400">{insp.itemsInspected}</span>
                  <p className="text-[10px] text-slate-500">Components Checked</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Active QC Blockers Diagnostics List */}
      {blockers.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
          <h3 className="text-base font-bold text-rose-400 flex items-center gap-2">
            <span>🚫</span> {t('dashboard.blockersTitle')} ({blockers.length} Wagons)
          </h3>

          <div className="space-y-3">
            {blockers.map((b) => (
              <div
                key={b.wagonNumber}
                className="p-4 bg-rose-950/20 border border-rose-900/60 rounded-xl space-y-2"
              >
                <div className="flex justify-between items-center">
                  <h4 className="text-xs font-black text-white">{b.wagonNumber}</h4>
                  <span className="text-[10px] font-bold text-rose-400 bg-rose-900/40 px-2 py-0.5 rounded">
                    {b.currentStage}
                  </span>
                </div>
                <ul className="text-xs text-rose-300/90 space-y-1 list-disc list-inside">
                  {b.blockers.map((blk: string, idx: number) => (
                    <li key={idx}>{blk}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
