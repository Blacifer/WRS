/**
 * Whether this installation is ready to be used
 * Indian Railways WRS Raipur
 *
 * WHY THIS EXISTS
 * ---------------
 * Every item on this panel was already knowable and none of it was anywhere on
 * a screen. Whether the signing secret is still the one published in the source
 * code, whether the API still answers any website, whether an account is still
 * on the demonstration password, whether a backup has ever been taken: each is
 * a line of code to check, and each was answered by asking somebody rather than
 * by looking.
 *
 * WHAT A TICK MEANS
 * -----------------
 * That this server checked, just now, and found it true. Nothing here reports
 * configuration back to itself: the Zapheit row is a live call to the model,
 * the audit row recomputes every hash in the chain, the password row hashes
 * real passwords. A panel that ticked green for a key merely being present
 * would be at its most confident on the deployment that most needs telling.
 *
 * That is also why it is slower than the panels around it, and why it is asked
 * for rather than loaded automatically.
 */

import { useCallback, useState } from 'react';
import { api } from '../services/api.ts';
import { Button } from './ui/index.tsx';
import { CheckCircleIcon, AlertTriangleIcon, RefreshCwIcon } from './Icons.tsx';
import { can } from '../../../shared/auth/permissions.ts';

interface DeploymentReadinessProps {
  lang: 'en' | 'hi';
}

type State = 'PASS' | 'WARN' | 'FAIL';

interface Check {
  id: string;
  label: string;
  state: State;
  detail: string;
}

export const DeploymentReadiness: React.FC<DeploymentReadinessProps> = ({ lang }) => {
  const isHi = lang === 'hi';
  const t = (en: string, hi: string) => (isHi ? hi : en);

  const [checks, setChecks] = useState<Check[] | null>(null);
  const [summary, setSummary] = useState<{ ready: boolean; passed: number; warned: number; failed: number; environment: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);


  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.getSystemReadiness();
      setChecks(res.data.checks || []);
      setSummary({
        ready: res.data.ready,
        passed: res.data.passed,
        warned: res.data.warned,
        failed: res.data.failed,
        environment: res.data.environment
      });
    } catch (err: any) {
      setError(err?.message || t('The check could not be run.', 'जाँच नहीं चल सकी।'));
      /*
       * Cleared rather than left standing. A failed run beside the results of
       * an earlier one is the worst of both — it looks like an answer, and it
       * is describing a moment that has passed.
       */
      setChecks(null);
      setSummary(null);
    } finally {
      setBusy(false);
    }
  }, [isHi]);

  /*
   * The dashboard is open to the DRM, and these checks are not: they describe
   * the machine, not the workshop's work, and the route asks for
   * system.configure. Rendering the button to somebody who can only receive a
   * 403 from it would be offering a control that cannot work.
   *
   * Below every hook, deliberately. An early return above one changes how many
   * hooks run between renders, which React refuses.
   */
  if (!can(api.getUser()?.role, 'system.configure')) return null;

  const mark = (state: State) => {
    if (state === 'PASS') {
      return <CheckCircleIcon size={18} className="text-good-ink shrink-0" aria-label="verified" />;
    }
    return (
      <AlertTriangleIcon
        size={18}
        className={`${state === 'FAIL' ? 'text-bad-ink' : 'text-warn-ink'} shrink-0`}
        aria-label={state === 'FAIL' ? 'not ready' : 'needs attention'}
      />
    );
  };

  return (
    <section className="bg-card border border-line rounded-card p-6 space-y-4" data-testid="deployment-readiness">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-white flex items-center gap-2">
            <span>✅</span> {t('Ready to be used', 'उपयोग के लिए तैयार')}
          </h2>
          <p className="text-xs text-ink-muted mt-1">
            {t(
              'Each item is checked on this machine when you press the button — not read back from a setting.',
              'हर जाँच इसी मशीन पर होती है — किसी सेटिंग से पढ़कर नहीं बताई जाती।'
            )}
          </p>
        </div>
        <Button onClick={run} disabled={busy} variant="primary" data-testid="run-readiness">
          {busy ? <RefreshCwIcon size={16} className="animate-spin" /> : null}
          <span className="ml-1.5">{busy ? t('Checking…', 'जाँच हो रही है…') : t('Check now', 'अभी जाँचें')}</span>
        </Button>
      </div>

      {error && (
        <div className="rounded-control border border-bad-line bg-bad-soft p-4">
          <p className="text-sm font-bold text-bad-ink">{error}</p>
        </div>
      )}

      {summary && (
        <div
          className={`rounded-control border p-4 flex items-center gap-3 ${
            summary.ready
              ? 'border-good-line bg-good-soft'
              : summary.failed > 0
                ? 'border-bad-line bg-bad-soft'
                : 'border-warn-line bg-warn-soft'
          }`}
          data-testid="readiness-summary"
        >
          {summary.ready
            ? <CheckCircleIcon size={22} className="text-good-ink shrink-0" />
            : <AlertTriangleIcon size={22} className={summary.failed > 0 ? 'text-bad-ink shrink-0' : 'text-warn-ink shrink-0'} />}
          <div>
            <p className="text-base font-black text-white">
              {summary.ready
                ? t('Everything checked, everything passed', 'सब जाँचा गया, सब ठीक है')
                : summary.failed > 0
                  ? t(`${summary.failed} thing(s) must be fixed before this is used`, `${summary.failed} चीज़ें ठीक करनी होंगी`)
                  : t(`${summary.warned} thing(s) worth attending to`, `${summary.warned} चीज़ों पर ध्यान दें`)}
            </p>
            <p className="text-[11px] font-mono text-ink-muted mt-0.5">
              {summary.passed} passed · {summary.warned} warned · {summary.failed} failed · {summary.environment}
            </p>
          </div>
        </div>
      )}

      {checks && (
        <ul className="space-y-2">
          {checks.map((c) => (
            <li
              key={c.id}
              className="rounded-control border border-line bg-raised p-3 flex items-start gap-3"
              data-testid={`readiness-${c.id}`}
              data-state={c.state}
            >
              {mark(c.state)}
              <div className="min-w-0">
                <p className="text-sm font-bold text-ink leading-snug">{c.label}</p>
                {/*
                  * The detail is shown always, not folded behind the tick.
                  * A green row that says why it is green is how somebody new
                  * to this installation learns what was checked at all.
                  */}
                <p className="text-[11px] text-ink-muted leading-relaxed mt-0.5">{c.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!checks && !error && !busy && (
        <p className="text-xs text-ink-muted">
          {t(
            'Not checked yet. Nothing is claimed until it has been.',
            'अभी जाँच नहीं हुई। जब तक जाँच न हो, कुछ नहीं कहा जाएगा।'
          )}
        </p>
      )}
    </section>
  );
};

export default DeploymentReadiness;
