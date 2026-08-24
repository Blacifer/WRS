/**
 * Supervisor Override Dialog with Mandatory Justification & OTP Verification
 * Indian Railways WRS Raipur
 */

import React, { useState } from 'react';
import type { BandColor } from '../../../shared/types.ts';
import { getDictionary, getBandText } from '../i18n/index.ts';
import type { LanguageCode } from '../i18n/index.ts';
import { api } from '../services/api.ts';
import { ShieldIcon, KeyIcon, AlertTriangleIcon, CheckCircleIcon, RefreshCwIcon } from './Icons.tsx';

interface SupervisorOverrideModalProps {
  isOpen: boolean;
  onClose: () => void;
  lang: LanguageCode;
  originalBand: BandColor | null;
  onApplyOverride: (overrideBand: BandColor, reason: string, otpToken: string) => void;
}

const AVAILABLE_BANDS: BandColor[] = ['BLUE', 'GREEN', 'YELLOW', 'ORANGE', 'WHITE', 'RED'];

export const SupervisorOverrideModal: React.FC<SupervisorOverrideModalProps> = ({
  isOpen,
  onClose,
  lang,
  originalBand,
  onApplyOverride
}) => {
  const isHi = lang === 'hi';
  const dict = getDictionary(lang);
  const [selectedBand, setSelectedBand] = useState<BandColor>('BLUE');
  const [reason, setReason] = useState<string>('');
  const [otpId, setOtpId] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState<string>('');
  const [devOtpCode, setDevOtpCode] = useState<string | null>(null);
  const [isRequestingOtp, setIsRequestingOtp] = useState<boolean>(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState<boolean>(false);
  const [otpToken, setOtpToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleRequestOtp = async () => {
    setError(null);
    setIsRequestingOtp(true);
    try {
      const res = await api.requestOtp('OVERRIDE');
      setOtpId(res.otpId);
      if (res.devOtpCode) {
        setDevOtpCode(res.devOtpCode);
        setOtpCode(res.devOtpCode); // Autofill in development/workshop kiosk mode
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

  const handleConfirm = () => {
    if (!reason || reason.trim().length < 5) {
      setError('Justification reason must be at least 5 characters');
      return;
    }
    if (!otpToken) {
      setError('Supervisor OTP verification is required');
      return;
    }
    onApplyOverride(selectedBand, reason.trim(), otpToken);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-fadeIn">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden text-white">
        {/* Modal Header */}
        <div className="px-5 py-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-purple-900/60 border border-purple-500 flex items-center justify-center text-purple-300">
              <ShieldIcon size={18} />
            </div>
            <div>
              <h3 className="font-extrabold text-base sm:text-lg text-white">
                {dict.actions.override}
              </h3>
              <p className="text-xs text-slate-400">{dict.messages.overrideRequired}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center text-xl font-bold"
          >
            &times;
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
          {error && (
            <div className="p-3 bg-rose-950/80 border border-rose-700 rounded-xl text-rose-200 text-xs font-semibold flex items-center gap-2">
              <AlertTriangleIcon size={16} />
              <span>{error}</span>
            </div>
          )}

          {/* 1. Target Override Band Selection */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider">
              {dict.form.overrideBand}
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {AVAILABLE_BANDS.map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => setSelectedBand(b)}
                  className={`min-h-[48px] px-3 py-2 rounded-lg border text-xs font-bold transition-all ${
                    selectedBand === b
                      ? 'bg-purple-900/60 border-purple-400 text-white ring-2 ring-purple-500'
                      : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  {getBandText(b, lang)}
                </button>
              ))}
            </div>
          </div>

          {/* 2. Mandatory Override Technical Justification */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider">
              {dict.form.overrideReason}
            </label>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={dict.form.overrideReasonPlaceholder}
              className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 rounded-xl text-slate-200 text-sm outline-none"
            />
          </div>

          {/* 3. OTP Authentication Section */}
          <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                <KeyIcon size={14} className="text-amber-400" />
                <span>{lang === 'hi' ? 'पर्यवेक्षक ओटीपी सत्यापन' : 'Supervisor OTP Verification'}</span>
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
                  <span>OTP Sent</span>
                </span>
              )}
            </div>

            {otpId && !otpToken && (
              <div className="space-y-2 pt-1">
                {devOtpCode && (
                  <p className="text-[11px] text-amber-300/80 bg-amber-950/40 p-2 rounded border border-amber-900">
                    Workshop Demo OTP Code: <strong className="font-mono text-amber-200">{devOtpCode}</strong>
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
                <span>{isHi ? 'ओटीपी सत्यापित व प्राधिकृत' : 'OTP Verified & Authorized'}</span>
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer Buttons */}
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
            onClick={handleConfirm}
            disabled={!otpToken || reason.trim().length < 5}
            className="min-h-[48px] px-6 py-2.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-extrabold text-sm rounded-xl shadow-md transition-all active:scale-[0.98]"
          >
            {dict.actions.confirmOverride}
          </button>
        </div>
      </div>
    </div>
  );
};
