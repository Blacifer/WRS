/**
 * Changing your own password
 * Indian Railways WRS Raipur
 *
 * WHY THIS EXISTS
 * ---------------
 * Until now there was no way for anybody to change a password. Accounts were
 * created with a generated one and kept it for life, and the only response to
 * a password that had been seen — read over a shoulder at the bench, written
 * on a slip that went missing — was to deactivate the account and make a new
 * one under a second username. That leaves the same person with two names in
 * the audit trail, which is the one thing this system exists not to do.
 *
 * WHY IT IS IN THE HEADER
 * -----------------------
 * The same reason authenticator enrolment was moved here. Anything that
 * belongs to a person rather than to the workshop has to be reachable by that
 * person, and an inspector cannot open the User Accounts screen. Putting this
 * on the admin screen would mean only administrators could change their own
 * password, which is exactly backwards: the accounts most likely to be
 * shoulder-surfed are the ones used on a shared bench tablet all day.
 *
 * WHY IT ASKS FOR THE CURRENT PASSWORD
 * ------------------------------------
 * A tablet left unlocked on the bench carries a valid session. Without the
 * current password, whoever picked it up could set a new one and lock the real
 * owner out of their own name permanently. Knowing the current password is the
 * proof that this is the account holder and not the next person along.
 */

import { useState } from 'react';
import { api } from '../services/api.ts';
import { Button, Note, inputClass } from './ui/index.tsx';

interface ChangeOwnPasswordProps {
  lang: 'en' | 'hi';
  onClose: () => void;
}

export const ChangeOwnPassword: React.FC<ChangeOwnPasswordProps> = ({ lang, onClose }) => {
  const isHi = lang === 'hi';
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  /*
   * Checked here as well as on the server. Not because the client can be
   * trusted with it — it cannot, which is why the server checks too — but
   * because a mistyped confirmation should be caught before it becomes a
   * failed request the person has to interpret.
   */
  const tooShort = next.length > 0 && next.length < 8;
  const mismatch = confirm.length > 0 && next !== confirm;
  const canSubmit = !busy && current.length > 0 && next.length >= 8 && next === confirm;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await api.changeOwnPassword(current, next);
      setDone(true);
    } catch (err: any) {
      setError(err?.message || (isHi ? 'पासवर्ड बदला नहीं जा सका।' : 'The password could not be changed.'));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="rounded-card border border-good-line bg-card p-5 space-y-3" data-testid="password-changed">
        <h3 className="text-sm font-black text-good-ink">
          {isHi ? 'पासवर्ड बदल गया' : 'Password changed'}
        </h3>
        <p className="text-xs text-ink-body leading-relaxed">
          {isHi
            ? 'अगली बार साइन इन करते समय नया पासवर्ड लगेगा। यह सत्र चालू रहेगा।'
            : 'The new password is needed the next time you sign in. This session stays open.'}
        </p>
        <Button variant="primary" onClick={onClose}>{isHi ? 'ठीक है' : 'Done'}</Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-card border border-line bg-card p-5 space-y-4" data-testid="change-password">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-black text-ink">{isHi ? 'अपना पासवर्ड बदलें' : 'Change your password'}</h3>
          <p className="text-xs text-ink-muted mt-0.5">
            {isHi
              ? 'कम से कम 8 अक्षर। यह केवल आपके खाते पर लागू होता है।'
              : 'At least 8 characters. This changes your account only.'}
          </p>
        </div>
        <button type="button" onClick={onClose} className="text-ink-muted hover:text-ink text-sm" aria-label="Close">✕</button>
      </div>

      <label className="block">
        <span className="text-[11px] font-bold uppercase tracking-wide text-ink-muted">
          {isHi ? 'मौजूदा पासवर्ड' : 'Current password'}
        </span>
        <input
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          className={inputClass}
          data-testid="current-password"
        />
      </label>

      <label className="block">
        <span className="text-[11px] font-bold uppercase tracking-wide text-ink-muted">
          {isHi ? 'नया पासवर्ड' : 'New password'}
        </span>
        <input
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          className={inputClass}
          data-testid="new-password"
        />
      </label>

      <label className="block">
        <span className="text-[11px] font-bold uppercase tracking-wide text-ink-muted">
          {isHi ? 'नया पासवर्ड दोबारा' : 'New password again'}
        </span>
        <input
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className={inputClass}
          data-testid="confirm-password"
        />
      </label>

      {tooShort && (
        <Note tone="warn">{isHi ? 'कम से कम 8 अक्षर चाहिए।' : 'At least 8 characters.'}</Note>
      )}
      {mismatch && (
        <Note tone="warn">{isHi ? 'दोनों नए पासवर्ड एक जैसे नहीं हैं।' : 'The two new passwords do not match.'}</Note>
      )}
      {error && <Note tone="bad">{error}</Note>}

      <Button type="submit" variant="primary" block disabled={!canSubmit}>
        {busy ? (isHi ? 'बदला जा रहा है…' : 'Changing…') : (isHi ? 'पासवर्ड बदलें' : 'Change password')}
      </Button>
    </form>
  );
};

export default ChangeOwnPassword;
