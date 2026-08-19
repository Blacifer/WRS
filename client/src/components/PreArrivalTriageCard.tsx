/**
 * Pre-Arrival OMRS Trackside Telemetry & AI Triage Component
 * Indian Railways WRS Raipur (Phase 3 - M1 / R5)
 */

import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api.ts';
import { useI18n } from '../i18n/index.ts';
import type { OMRSScanRecord, AITriageResult } from '../../../shared/types.ts';
import {
  ActivityIcon,
  CpuIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
  RefreshCwIcon,
  PackageIcon
} from './Icons.tsx';

interface PreArrivalTriageCardProps {
  wagonNumber: string;
  onTriageComplete?: (result: AITriageResult) => void;
}

export const PreArrivalTriageCard: React.FC<PreArrivalTriageCardProps> = ({
  wagonNumber,
  onTriageComplete
}) => {
  const { t } = useI18n();

  const [scan, setScan] = useState<OMRSScanRecord | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [triaging, setTriaging] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  const fetchScan = useCallback(async () => {
    if (!wagonNumber) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.getOMRSScanByWagon(wagonNumber);
      if (res.success && res.data) {
        setScan(res.data);
      }
    } catch {
      // 404 is normal for wagons without a pre-arrival scan yet
      setScan(null);
    } finally {
      setLoading(false);
    }
  }, [wagonNumber]);

  useEffect(() => {
    fetchScan();
  }, [fetchScan]);

  const handleRunTriage = async () => {
    if (!wagonNumber) return;
    setTriaging(true);
    setError(null);
    try {
      const res = await api.runAITriage(wagonNumber);
      if (res.success && res.data) {
        setScan(res.data.scan);
        setSuccessBanner(res.data.triageSummary || 'AI Triage completed & parts auto-reserved in Stores Depot.');
        if (onTriageComplete) {
          onTriageComplete(res.data);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to execute OMRS AI triage.');
    } finally {
      setTriaging(false);
    }
  };

  const isCritical = scan?.triageSeverity === 'CRITICAL_TRIAGE';
  const isAdvisory = scan?.triageSeverity === 'ADVISORY';

  return (
    <div className="bg-white/5 border border-white/10 backdrop-blur-md rounded-xl p-5 sm:p-6 shadow-2xl relative overflow-hidden">
      {/* Decorative gradient glow */}
      <div
        className={`absolute -top-12 -right-12 w-48 h-48 rounded-full blur-3xl pointer-events-none opacity-20 ${isCritical ? "bg-rose-500" : isAdvisory ? "bg-amber-500" : "bg-slate-500"}`}
      />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center border shadow-inner ${
              isCritical
                ? 'bg-rose-500/10 border-rose-500/20 text-rose-400'
                : isAdvisory
                ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                : 'bg-slate-500/10 border-slate-500/20 text-slate-300'
            }`}
          >
            <CpuIcon size={22} />
          </div>
          <div>
            <h3 className="text-base sm:text-lg font-black text-white tracking-tight flex items-center gap-2">
              <span>{t('omrs.title', 'Pre-Arrival Trackside OMRS Telemetry & AI Triage')}</span>
              {scan && (
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full font-extrabold uppercase tracking-wider ${
                    isCritical
                      ? 'bg-rose-950 text-rose-300 border border-rose-800 animate-pulse'
                      : isAdvisory
                      ? 'bg-amber-950 text-amber-300 border border-amber-800'
                      : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                  }`}
                >
                  {scan.triageSeverity}
                </span>
              )}
            </h3>
            <p className="text-xs text-slate-400 font-medium">
              {t('omrs.subtitle', 'Acoustic Bearing, WILD Wheel Impact & Hot Axle Pre-Intake Diagnostics')}
            </p>
          </div>
        </div>

        {/* Action Button */}
        <div>
          <button
            onClick={handleRunTriage}
            disabled={triaging}
            className={`min-h-[42px] px-4 py-2 text-xs font-bold rounded-xl shadow flex items-center gap-2 transition-all active:scale-95 ${
              !scan || !scan.isTriaged
                ? 'bg-white text-slate-900 hover:bg-slate-100 shadow-sm border border-transparent'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
            }`}
          >
            {triaging ? (
              <>
                <RefreshCwIcon size={14} className="animate-spin text-slate-500" />
                <span>Running AI Triage & Allocating...</span>
              </>
            ) : (
              <>
                <CpuIcon size={14} className="text-slate-500" />
                <span>{scan?.isTriaged ? 'Re-run AI Triage' : t('omrs.runTriageBtn', 'Run AI Triage & Auto-Reserve')}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Success Notification Banner */}
      {successBanner && (
        <div className="mt-4 p-3.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center gap-3 text-xs text-emerald-200 animate-fadeIn">
          <CheckCircleIcon size={18} className="text-emerald-400 shrink-0" />
          <span className="font-semibold">{successBanner}</span>
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div className="mt-4 p-3.5 bg-rose-500/10 border border-rose-500/20 rounded-xl flex items-center gap-3 text-xs text-rose-200">
          <AlertTriangleIcon size={18} className="text-rose-400 shrink-0" />
          <span className="font-semibold">{error}</span>
        </div>
      )}

      {/* Body */}
      {loading ? (
        <div className="py-8 text-center text-slate-400 text-xs font-medium">
          <RefreshCwIcon size={20} className="animate-spin text-blue-500 mx-auto mb-2" />
          Checking trackside OMRS telemetry array...
        </div>
      ) : !scan ? (
        <div className="py-6 text-center text-slate-400 text-xs">
          <p className="mb-3">{t('omrs.noScanData', 'No trackside OMRS telemetry recorded for this wagon yet.')}</p>
          <button
            onClick={handleRunTriage}
            disabled={triaging}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl shadow inline-flex items-center gap-2"
          >
            <ActivityIcon size={14} />
            <span>Simulate Trackside Scan & Triage</span>
          </button>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {/* Sensor Gauges Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* WILD Impact */}
            <div className="p-3 bg-black/20 border border-white/5 rounded-xl">
              <div className="text-[10px] uppercase font-bold text-slate-400 flex items-center justify-between">
                <span>{t('omrs.wildImpact', 'WILD Wheel Impact')}</span>
                <span className="text-[9px] font-mono text-slate-500">Max: 130 kN</span>
              </div>
              <div className="mt-1 flex items-baseline gap-1.5 font-mono">
                <span
                  className={`text-lg font-black ${
                    (scan.wheelImpactKn ?? 0) > 130
                      ? 'text-rose-400'
                      : (scan.wheelImpactKn ?? 0) > 100
                      ? 'text-amber-400'
                      : 'text-emerald-400'
                  }`}
                >
                  {scan.wheelImpactKn !== null ? `${scan.wheelImpactKn.toFixed(1)}` : 'N/A'}
                </span>
                <span className="text-xs text-slate-500 font-sans">kN</span>
              </div>
            </div>

            {/* ABD Acoustic Peak */}
            <div className="p-3 bg-black/20 border border-white/5 rounded-xl">
              <div className="text-[10px] uppercase font-bold text-slate-400 flex items-center justify-between">
                <span>{t('omrs.abdAcoustic', 'ABD Acoustic Peak')}</span>
                <span className="text-[9px] font-mono text-slate-500">Max: 80 dB</span>
              </div>
              <div className="mt-1 flex items-baseline gap-1.5 font-mono">
                <span
                  className={`text-lg font-black ${
                    (scan.acousticBearingPeakDb ?? 0) > 80
                      ? 'text-rose-400'
                      : (scan.acousticBearingPeakDb ?? 0) > 70
                      ? 'text-amber-400'
                      : 'text-emerald-400'
                  }`}
                >
                  {scan.acousticBearingPeakDb !== null ? `${scan.acousticBearingPeakDb.toFixed(1)}` : 'N/A'}
                </span>
                <span className="text-xs text-slate-500 font-sans">dB</span>
              </div>
            </div>

            {/* HABD Axle Temp */}
            <div className="p-3 bg-black/20 border border-white/5 rounded-xl">
              <div className="text-[10px] uppercase font-bold text-slate-400 flex items-center justify-between">
                <span>{t('omrs.habdTemp', 'HABD Axle Temp')}</span>
                <span className="text-[9px] font-mono text-slate-500">Max: 75 °C</span>
              </div>
              <div className="mt-1 flex items-baseline gap-1.5 font-mono">
                <span
                  className={`text-lg font-black ${
                    (scan.temperatureCelsius ?? 0) > 75
                      ? 'text-rose-400'
                      : (scan.temperatureCelsius ?? 0) > 60
                      ? 'text-amber-400'
                      : 'text-emerald-400'
                  }`}
                >
                  {scan.temperatureCelsius !== null ? `${scan.temperatureCelsius.toFixed(1)}` : 'N/A'}
                </span>
                <span className="text-xs text-slate-500 font-sans">°C</span>
              </div>
            </div>

            {/* Wheel Profile Deviation */}
            <div className="p-3 bg-black/20 border border-white/5 rounded-xl">
              <div className="text-[10px] uppercase font-bold text-slate-400 flex items-center justify-between">
                <span>{t('omrs.profileDeviation', 'Profile Deviation')}</span>
                <span className="text-[9px] font-mono text-slate-500">Max: 5.0 mm</span>
              </div>
              <div className="mt-1 flex items-baseline gap-1.5 font-mono">
                <span
                  className={`text-lg font-black ${
                    (scan.wheelProfileDeviationMm ?? 0) > 5.0
                      ? 'text-rose-400'
                      : (scan.wheelProfileDeviationMm ?? 0) > 3.5
                      ? 'text-amber-400'
                      : 'text-emerald-400'
                  }`}
                >
                  {scan.wheelProfileDeviationMm !== null ? `${scan.wheelProfileDeviationMm.toFixed(1)}` : 'N/A'}
                </span>
                <span className="text-xs text-slate-500 font-sans">mm</span>
              </div>
            </div>
          </div>

          {/* AI Predicted Defects & Auto-Reservations List */}
          {scan.predictedDefects && scan.predictedDefects.length > 0 ? (
            <div className="p-4 bg-slate-950/90 border border-slate-800 rounded-xl space-y-2.5">
              <div className="flex items-center justify-between text-xs font-bold text-slate-300">
                <span className="flex items-center gap-1.5">
                  <CpuIcon size={14} className="text-purple-400" />
                  {t('omrs.predictedDefectsTitle', 'AI Predicted Failing Components & Automatic Stores Reservations')}
                </span>
                <span className="text-[11px] text-purple-400 font-mono">
                  {scan.predictedDefects.length} defect signatures
                </span>
              </div>

              <div className="space-y-2 pt-1">
                {scan.predictedDefects.map((defect, idx) => (
                  <div
                    key={idx}
                    className="p-3 bg-slate-900 border border-slate-800/80 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-2.5">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase ${
                          defect.severity === 'CRITICAL'
                            ? 'bg-rose-950 text-rose-300 border border-rose-800'
                            : 'bg-amber-950 text-amber-300 border border-amber-800'
                        }`}
                      >
                        {defect.severity}
                      </span>
                      <div>
                        <div className="text-xs font-bold text-white leading-tight">
                          {defect.defectType.replace(/_/g, ' ')}
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                          Target: {defect.component}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 self-end sm:self-auto">
                      <div className="text-right">
                        <span className="text-[10px] text-slate-400 font-medium">Confidence: </span>
                        <span className="text-xs font-mono font-bold text-emerald-400">
                          {(defect.confidence * 100).toFixed(0)}%
                        </span>
                      </div>

                      {defect.recommendedPartCode && (
                        <div className="px-2.5 py-1 bg-purple-950/70 border border-purple-800/70 rounded text-[11px] font-mono font-bold text-purple-300 flex items-center gap-1">
                          <PackageIcon size={12} />
                          <span>
                            {defect.recommendedPartCode} (x{defect.quantity})
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="p-3 bg-emerald-950/30 border border-emerald-900/40 rounded-xl flex items-center gap-2 text-xs text-emerald-300 font-semibold">
              <CheckCircleIcon size={16} className="text-emerald-400 shrink-0" />
              <span>Trackside acoustic, thermal, and optical telemetry indicates zero anomalies. Clean pre-arrival bill of health.</span>
            </div>
          )}

          {/* Telemetry Metadata Footer */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-500 font-medium pt-1 border-t border-slate-800/50">
            <span>Location: {scan.location}</span>
            <span>Speed: {scan.trainSpeedKmph} km/h</span>
            <span>Scan Time: {new Date(scan.scanTimestamp).toLocaleString()}</span>
          </div>
        </div>
      )}
    </div>
  );
};
