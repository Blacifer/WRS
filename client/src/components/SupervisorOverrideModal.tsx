/**
 * Supervisor Override Dialog with Mandatory Justification & OTP Verification
 * Indian Railways WRS Raipur
 */

import React, { useState, useEffect } from 'react';
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
  // Whether this supervisor has an authenticator. When they do, the code comes
  // from their phone and the server never issues one — a code the server hands
  // you confirms intent but proves possession of nothing.
  const [totpEnrolled, setTotpEnrolled] = useState<boolean | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    api.getTotpStatus()
      .then((r) => setTotpEnrolled(r.data.enrolled))
      .catch(() => setTotpEnrolled(false));
  }, [isOpen]);

  if (!isOpen) return null;

  const handleRequestOtp = async () => {
    setError(null);
    setIsRequestingOtp(true);
    try {
      const res = await api.requestOtp('OVERRIDE');
      setOtpId(res.otpId);
      if (res.devOtpCode) {
        setDevOtpCode(res.devOtpCode);
        // Not auto-filled: see the note beside the code below. Filling it
        // in turned a confirmation into a single click.
      }
    } catch (err: any) {
      setError(err.message || 'Failed to request OTP');
    } finally {
      setIsRequestingOtp(false);
    }
  };

  const handleVerifyOtp = async () => {
    // Enrolled supervisors never request a server code, so there is no otpId —
    // the code is verified straight against their authenticator.
    if (totpEnrolled) {
      if (!otpCode) {
        setError('Enter the code from your authenticator app');
        return;
      }
      setError(null);
      setIsVerifyingOtp(true);
      try {
        const res = await api.verifyTotpForAction('OVERRIDE', otpCode.trim());
        setOtpToken(res.data.otpToken);
      } catch (err: any) {
        setError(err.message || 'That code was not accepted');
      } finally {
        setIsVerifyingOtp(false);
      }
      return;
    }

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
      <div className="bg-card border border-line rounded-card w-full max-w-lg overflow-hidden text-white">
        {/* Modal Header */}
        <div className="px-5 py-4 bg-page border-b border-line flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-control bg-accent-soft border border-accent-line flex items-center justify-center text-accent-ink">
              <ShieldIcon size={18} />
            </div>
            <div>
              <h3 className="font-extrabold text-base sm:text-lg text-white">
                {dict.actions.override}
              </h3>
              <p className="text-xs text-ink-muted">{dict.messages.overrideRequired}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-control hover:bg-raised text-ink-muted hover:text-white flex items-center justify-center text-xl font-bold"
          >
            &times;
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
          {error && (
            <div className="p-3 bg-bad-soft border border-bad-line rounded-control text-bad-ink text-xs font-semibold flex items-center gap-2">
              <AlertTriangleIcon size={16} />
              <span>{error}</span>
            </div>
          )}

          {/* 1. Target Override Band Selection */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-ink-body uppercase tracking-[0.07em]">
              {dict.form.overrideBand}
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {AVAILABLE_BANDS.map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => setSelectedBand(b)}
                  className={`min-h-[48px] px-3 py-2 rounded-control border text-xs font-bold transition-all ${
                    selectedBand === b
                      ? 'bg-accent-soft border-accent-line text-white ring-2 ring-accent-hover'
                      : 'bg-page border-line text-ink-body hover:border-line'
                  }`}
                >
                  {getBandText(b, lang)}
                </button>
              ))}
            </div>
          </div>

          {/* 2. Mandatory Override Technical Justification */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-ink-body uppercase tracking-[0.07em]">
              {dict.form.overrideReason}
            </label>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={dict.form.overrideReasonPlaceholder}
              className="w-full px-3.5 py-2.5 bg-page border border-line focus:border-accent-line focus:ring-1 focus:ring-accent-hover rounded-control text-ink-body text-sm outline-none"
            />
          </div>

          {/* 3. OTP Authentication Section */}
          <div className="p-4 bg-page border border-line rounded-control space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-ink-body flex items-center gap-1.5">
                <KeyIcon size={14} className="text-warn-ink" />
                <span>
                  {totpEnrolled
                    ? (lang === 'hi' ? 'प्रमाणक कोड' : 'Authenticator code')
                    : (lang === 'hi' ? 'पर्यवेक्षक ओटीपी सत्यापन' : 'Supervisor OTP Verification')}
                </span>
              </span>

              {/* An enrolled supervisor already has a code on their phone;
                  there is nothing to request. */}
              {totpEnrolled ? (
                <span className="text-[11px] text-good-ink/80 font-semibold">
                  {lang === 'hi' ? 'ऐप से — नेटवर्क आवश्यक नहीं' : 'From your app — no network needed'}
                </span>
              ) : !otpId ? (
                <button
                  type="button"
                  onClick={handleRequestOtp}
                  disabled={isRequestingOtp}
                  className="min-h-[44px] px-3 py-1.5 bg-warn hover:bg-amber-400 text-slate-950 font-extrabold text-xs rounded-control flex items-center gap-1 transition-all"
                >
                  {isRequestingOtp ? <RefreshCwIcon size={14} className="animate-spin" /> : null}
                  <span>{dict.actions.requestOtp}</span>
                </button>
              ) : (
                <span className="text-xs text-good-ink font-bold flex items-center gap-1">
                  <CheckCircleIcon size={14} />
                  <span>OTP Sent</span>
                </span>
              )}
            </div>

            {(totpEnrolled || otpId) && !otpToken && (
              <div className="space-y-2 pt-1">
                {!totpEnrolled && devOtpCode && (
                  <p className="text-[11px] text-warn-ink/80 bg-warn-soft p-2 rounded border border-warn-line">
                    Workshop Demo OTP Code: <strong className="font-mono text-warn-ink">{devOtpCode}</strong>
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    maxLength={6}
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value)}
                    placeholder="123456"
                    className="flex-1 min-h-[48px] px-3 py-2 bg-card border border-line text-white font-mono text-center text-lg tracking-widest font-extrabold rounded-control focus:border-warn-line outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleVerifyOtp}
                    disabled={isVerifyingOtp || !otpCode}
                    className="min-h-[48px] px-4 py-2 bg-good hover:bg-good text-white font-bold text-xs rounded-control flex items-center gap-1"
                  >
                    {isVerifyingOtp ? <RefreshCwIcon size={14} className="animate-spin" /> : null}
                    <span>{dict.actions.verifyOtp}</span>
                  </button>
                </div>
              </div>
            )}

            {otpToken && (
              <div className="p-2.5 bg-good-soft border border-good-line rounded-control text-good-ink text-xs font-bold flex items-center gap-2">
                <CheckCircleIcon size={16} />
                <span>{isHi ? 'ओटीपी सत्यापित व प्राधिकृत' : 'OTP Verified & Authorized'}</span>
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer Buttons */}
        <div className="px-5 py-4 bg-page border-t border-line flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[48px] px-4 py-2.5 rounded-control border border-line text-ink-body hover:bg-raised font-bold text-sm"
          >
            {dict.actions.cancel}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!otpToken || reason.trim().length < 5}
            className="min-h-[48px] px-6 py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white font-extrabold text-sm rounded-control shadow-md transition-all active:scale-[0.98]"
          >
            {dict.actions.confirmOverride}
          </button>
        </div>
      </div>
    </div>
  );
};
