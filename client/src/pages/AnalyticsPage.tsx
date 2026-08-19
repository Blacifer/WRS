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
  const [stats, setStats] = useState<InspectionStats | null>(null);
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

  useEffect(() => {
    loadStats();
  }, []);

  const totalInspected = stats?.totalInspections || 0;
  const targetShiftMin = 1800;
  const targetShiftMax = 2000;
  const shiftProgressPercent = Math.min(100, Math.round((totalInspected / targetShiftMin) * 100));

  const isAdmin = user?.role === 'ADMIN' || user?.role === 'Admin' || user?.role === 'SUPERVISOR' || user?.role === 'Supervisor';

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
            onClick={loadStats}
            disabled={isLoading}
            className="min-h-[44px] px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl flex items-center gap-1.5 border border-slate-700"
          >
            <RefreshCwIcon size={16} className={isLoading ? 'animate-spin' : ''} />
            <span>{lang === 'hi' ? 'ताज़ा करें' : 'Refresh'}</span>
          </button>

          {isAdmin && (
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

      {/* 1. Shift Throughput Target Gauge (1,800 - 2,000 / shift) */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-black text-white">{dict.analytics?.shiftThroughput || 'Shift Throughput & Outturn'}</h3>
            <p className="text-xs font-semibold text-slate-400">{dict.analytics?.target || 'Target: 1,800 - 2,000 springs/shift'}</p>
          </div>
          <div className="text-left sm:text-right">
            <span className="font-mono text-2xl sm:text-3xl font-black text-blue-400">
              {totalInspected.toLocaleString()}
            </span>
            <span className="text-xs font-semibold text-slate-400"> / {targetShiftMin.toLocaleString()} springs</span>
          </div>
        </div>

        {/* Progress bar */}
        <div className="space-y-1.5">
          <div className="h-4 bg-slate-950 rounded-full overflow-hidden border border-slate-800 p-0.5">
            <div
              className="h-full bg-gradient-to-r from-blue-600 via-indigo-500 to-emerald-500 rounded-full transition-all duration-500"
              style={{ width: `${Math.max(5, shiftProgressPercent)}%` }}
            ></div>
          </div>
          <div className="flex justify-between text-[11px] font-bold text-slate-400">
            <span>0</span>
            <span>Target: {targetShiftMin} - {targetShiftMax}</span>
            <span>{shiftProgressPercent}% Complete</span>
          </div>
        </div>
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
