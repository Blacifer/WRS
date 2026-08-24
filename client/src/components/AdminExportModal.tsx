/**
 * Admin Audit Trail Export Modal with DRM / Admin OTP Security
 * Indian Railways WRS Raipur
 */

import React, { useState } from 'react';
import { getDictionary } from '../i18n/index.ts';
import type { LanguageCode } from '../i18n/index.ts';
import { api } from '../services/api.ts';
import { DownloadIcon, KeyIcon, AlertTriangleIcon, CheckCircleIcon, RefreshCwIcon, ShieldIcon } from './Icons.tsx';

interface AdminExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  lang: LanguageCode;
}

export const AdminExportModal: React.FC<AdminExportModalProps> = ({
  isOpen,
  onClose,
  lang
}) => {
  const isHi = lang === 'hi';
  const dict = getDictionary(lang);
  const [format, setFormat] = useState<'csv' | 'json'>('csv');
  const [otpId, setOtpId] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState<string>('');
  const [devOtpCode, setDevOtpCode] = useState<string | null>(null);
  const [isRequestingOtp, setIsRequestingOtp] = useState<boolean>(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState<boolean>(false);
  const [otpToken, setOtpToken] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleRequestOtp = async () => {
    setError(null);
    setIsRequestingOtp(true);
    try {
      const res = await api.requestOtp('EXPORT');
      setOtpId(res.otpId);
      if (res.devOtpCode) {
        setDevOtpCode(res.devOtpCode);
        setOtpCode(res.devOtpCode);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to request OTP');
    } finally {
      setIsRequestingOtp(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otpId || !otpCode) {
      setError('Please enter OTP code');
      return;
    }
    setError(null);
    setIsVerifyingOtp(true);
    try {
      const res = await api.verifyOtp(otpId, otpCode);
      if (res.otpToken) {
        setOtpToken(res.otpToken);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to verify OTP');
    } finally {
      setIsVerifyingOtp(false);
    }
  };

  const handleDownload = async () => {
    if (!otpToken) {
      setError(dict.messages.exportOtpRequired);
      return;
    }
    setError(null);
    setIsExporting(true);
    try {
      const result = await api.exportInspections(format, otpToken);
      if (typeof result === 'string') {
        const blob = new Blob([result], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `wrs_inspections_export_${Date.now()}.csv`;
        link.click();
        URL.revokeObjectURL(url);
      } else {
        const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `wrs_inspections_export_${Date.now()}.json`;
        link.click();
        URL.revokeObjectURL(url);
      }
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to download export');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-fadeIn">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden text-white">
        {/* Header */}
        <div className="px-5 py-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-900/60 border border-blue-500 flex items-center justify-center text-blue-300">
              <ShieldIcon size={18} />
            </div>
            <div>
              <h3 className="font-extrabold text-base sm:text-lg text-white">
                {dict.actions.exportData}
              </h3>
              <p className="text-xs text-slate-400">RDSO G-95 Regulatory Audit Export</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center text-xl font-bold"
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {error && (
            <div className="p-3 bg-rose-950/80 border border-rose-700 rounded-xl text-rose-200 text-xs font-semibold flex items-center gap-2">
              <AlertTriangleIcon size={16} />
              <span>{error}</span>
            </div>
          )}

          {/* Format selection */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider">
              {lang === 'hi' ? 'निर्यात प्रारूप (Export Format)' : 'Export Format'}
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setFormat('csv')}
                className={`min-h-[48px] px-4 py-2.5 rounded-xl border font-bold text-sm transition-all flex items-center justify-center gap-2 ${
                  format === 'csv'
                    ? 'bg-blue-600 border-blue-400 text-white'
                    : 'bg-slate-950 border-slate-800 text-slate-300'
                }`}
              >
                <span>{dict.actions.exportCsv}</span>
              </button>

              <button
                type="button"
                onClick={() => setFormat('json')}
                className={`min-h-[48px] px-4 py-2.5 rounded-xl border font-bold text-sm transition-all flex items-center justify-center gap-2 ${
                  format === 'json'
                    ? 'bg-blue-600 border-blue-400 text-white'
                    : 'bg-slate-950 border-slate-800 text-slate-300'
                }`}
              >
                <span>{dict.actions.exportJson}</span>
              </button>
            </div>
          </div>

          {/* OTP Section */}
          <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                <KeyIcon size={14} className="text-amber-400" />
                <span>{lang === 'hi' ? 'व्यवस्थापक ओटीपी प्रमाणीकरण' : 'Admin OTP Verification'}</span>
              </span>

              {!otpId ? (
                <button
                  type="button"
                  onClick={handleRequestOtp}
                  disabled={isRequestingOtp}
                  className="min-h-[44px] px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs rounded-lg flex items-center gap-1 transition-all"
                >
                  {isRequestingOtp ? <RefreshCwIcon size={14} className="animate-spin" /> : null}
                  <span>{dict.actions.requestOtp}</span>
                </button>
              ) : (
                <span className="text-xs text-emerald-400 font-bold flex items-center gap-1">
                  <CheckCircleIcon size={14} />
                  <span>OTP Generated</span>
                </span>
              )}
            </div>

            {otpId && !otpToken && (
              <div className="space-y-2 pt-1">
                {devOtpCode && (
                  <p className="text-[11px] text-amber-300/80 bg-amber-950/40 p-2 rounded border border-amber-900">
                    Workshop Demo Admin OTP: <strong className="font-mono text-amber-200">{devOtpCode}</strong>
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    maxLength={6}
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value)}
                    placeholder="123456"
                    className="flex-1 min-h-[48px] px-3 py-2 bg-slate-900 border border-slate-700 text-white font-mono text-center text-lg tracking-widest font-black rounded-lg focus:border-amber-400 outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleVerifyOtp}
                    disabled={isVerifyingOtp || !otpCode}
                    className="min-h-[48px] px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-lg flex items-center gap-1"
                  >
                    {isVerifyingOtp ? <RefreshCwIcon size={14} className="animate-spin" /> : null}
                    <span>{dict.actions.verifyOtp}</span>
                  </button>
                </div>
              </div>
            )}

            {otpToken && (
              <div className="p-2.5 bg-emerald-950/60 border border-emerald-700 rounded-lg text-emerald-300 text-xs font-bold flex items-center gap-2">
                <CheckCircleIcon size={16} />
                <span>{isHi ? 'प्रशासक प्राधिकरण सत्यापित' : 'Admin Authorization Verified'}</span>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 bg-slate-950 border-t border-slate-800 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[48px] px-4 py-2.5 rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800 font-bold text-sm"
          >
            {dict.actions.cancel}
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={!otpToken || isExporting}
            className="min-h-[48px] px-6 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-extrabold text-sm rounded-xl shadow-md flex items-center gap-2 transition-all active:scale-[0.98]"
          >
            {isExporting ? <RefreshCwIcon size={18} className="animate-spin" /> : <DownloadIcon size={18} />}
            <span>{dict.actions.exportData}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
