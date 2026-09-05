/**
 * Confirmation for actions that need a second factor
 * Indian Railways WRS Raipur
 *
 * WHY THIS EXISTS
 * ---------------
 * Three kinds of action require an action token: releasing a wagon, overriding
 * a classification, exporting records, and changing accounts. Each had — or
 * needed — its own copy of the request/verify dance, and the copies drifted:
 * release sign-off got the authenticator wired in, account changes got the
 * server-side requirement without any way for the interface to satisfy it, and
 * overrides still used the inline code.
 *
 * That drift is the actual bug. One component, used everywhere a token is
 * needed, is how the paths stop diverging.
 *
 * It resolves the factor automatically: an enrolled user is asked for the code
 * on their phone; anyone else falls back to the server-issued code, with the
 * difference stated rather than hidden. A code the server hands you confirms
 * intent; it does not prove possession of anything.
 */

import { useState, useEffect } from 'react';
import { api } from '../services/api.ts';

type Action = 'OVERRIDE' | 'EXPORT' | 'USER_MGMT';

interface Props {
  action: Action;
  /** Shown so the person knows what they are confirming. */
  title: string;
  description?: string;
  lang: 'en' | 'hi';
  onConfirmed: (otpToken: string) => void | Promise<void>;
  onCancel: () => void;
}

export function ActionConfirm({ action, title, description, lang, onConfirmed, onCancel }: Props) {
  const isHi = lang === 'hi';

  const [enrolled, setEnrolled] = useState<boolean | null>(null);
  const [otpId, setOtpId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  /*
   * The code as shown, kept apart from what the person has typed.
   *
   * They used to be the same value: requesting a code filled the box with it,
   * so confirming took one click and confirmed nothing. Holding them
   * separately means the code can be displayed and still has to be entered.
   */
  const [shownCode, setShownCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getTotpStatus()
      .then((r) => setEnrolled(r.data.enrolled))
      .catch(() => setEnrolled(false));
  }, []);

  /** Enrolled path: the code comes from the user's own device. */
  const confirmWithAuthenticator = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.verifyTotpForAction(action, code.trim());
      await onConfirmed(res.data.otpToken);
    } catch (e: any) {
      setError(e?.message || (isHi ? 'कोड स्वीकार नहीं हुआ' : 'That code was not accepted'));
    } finally {
      setBusy(false);
    }
  };

  /** Fallback: the server issues a code to whoever asked for it. */
  const requestInlineCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.requestOtp(action);
      setOtpId(res.otpId);
      // Deliberately NOT pre-filled. The code is shown; typing it is the
      // whole of what this step asks for, and auto-filling reduced it to one
      // click that confirmed nothing.
      if (res.devOtpCode) setShownCode(res.devOtpCode);
    } catch (e: any) {
      setError(e?.message || 'Could not request a code');
    } finally {
      setBusy(false);
    }
  };

  const confirmWithInlineCode = async () => {
    if (!otpId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.verifyOtp(otpId, code.trim());
      if (!res.otpToken) {
        setError(isHi ? 'कोड स्वीकार नहीं हुआ' : 'That code was not accepted');
        return;
      }
      await onConfirmed(res.otpToken);
    } catch (e: any) {
      setError(e?.message || 'Could not verify the code');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-card border border-line bg-card">
        <div className="p-5 border-b border-line">
          <h3 className="text-base font-extrabold text-white">{title}</h3>
          {description && <p className="text-xs text-ink-muted mt-1">{description}</p>}
        </div>

        <div className="p-5 space-y-3">
          {enrolled === null && (
            <p className="text-xs text-ink-faint">{isHi ? 'जाँच रहे हैं…' : 'Checking…'}</p>
          )}

          {enrolled === true && (
            <>
              <label className="block text-xs font-semibold text-ink-body">
                {isHi ? 'प्रमाणक ऐप का कोड' : 'Code from your authenticator app'}
              </label>
              {shownCode && (
                <p className="text-xs text-warn-ink bg-warn-soft border border-warn-line rounded-control px-3 py-2 mb-2 leading-snug">
                  Confirmation code: <strong className="font-mono tracking-widest text-warn-ink">{shownCode}</strong>
                  <span className="block text-warn-ink/80 mt-1">
                    Type it below. It is shown here rather than sent anywhere — this is a
                    deliberate second step on a consequential action, not a second factor.
                  </span>
                </p>
              )}
              <input
                inputMode="numeric"
                maxLength={6}
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                className="w-full bg-raised border border-line rounded-control px-3 py-2 text-lg font-mono tracking-[0.3em] text-center text-white"
              />
              <p className="text-[11px] text-good-ink/80">
                {isHi ? 'इंटरनेट की आवश्यकता नहीं' : 'Works without a network'}
              </p>
            </>
          )}

          {enrolled === false && (
            <>
              <label className="block text-xs font-semibold text-ink-body">
                {isHi ? '6-अंकीय कोड' : '6-digit code'}
              </label>
              <div className="flex gap-2">
                <input
                  inputMode="numeric"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  disabled={!otpId}
                  placeholder={otpId ? '000000' : (isHi ? 'पहले कोड भेजें' : 'Request a code first')}
                  className="flex-1 bg-raised border border-line rounded-control px-3 py-2 text-sm text-white disabled:opacity-50"
                />
                {!otpId && (
                  <button
                    type="button"
                    onClick={requestInlineCode}
                    disabled={busy}
                    className="px-3 py-2 rounded-control border border-good-line text-good-ink text-xs font-bold disabled:opacity-40 whitespace-nowrap"
                  >
                    {isHi ? 'कोड भेजें' : 'Request code'}
                  </button>
                )}
              </div>
              <p className="text-[11px] text-warn-ink/90">
                {isHi
                  ? 'कोई प्रमाणक सेट नहीं — यह कोड सर्वर देता है, इसलिए यह दूसरा प्रमाण नहीं है।'
                  : 'No authenticator set up. This code is issued by the server, so it confirms intent but is not a second factor.'}
              </p>
            </>
          )}

          {error && (
            <p className="text-xs font-semibold text-bad-ink bg-bad-soft border border-bad-line rounded-control px-3 py-2">
              {error}
            </p>
          )}
        </div>

        <div className="p-5 border-t border-line flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-control border border-line text-ink-body text-xs font-bold hover:bg-raised"
          >
            {isHi ? 'रद्द करें' : 'Cancel'}
          </button>
          <button
            type="button"
            onClick={enrolled ? confirmWithAuthenticator : confirmWithInlineCode}
            disabled={busy || code.trim().length !== 6 || (enrolled === false && !otpId)}
            className="px-5 py-2 rounded-control bg-white text-black text-xs font-extrabold disabled:opacity-40"
          >
            {busy ? '…' : (isHi ? 'पुष्टि करें' : 'Confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
