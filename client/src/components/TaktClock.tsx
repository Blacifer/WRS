/**
 * The takt clock on the sorting bench — a timed trial against 14.4 s a spring
 * Indian Railways WRS Raipur
 *
 * The CWM's target is 1000 springs in four hours. Before anything is bought
 * for a spring line, a real station on real springs is timed: this panel is
 * that stopwatch. A trial is its own sorting batch (its id starts "trial_"),
 * so the springs are recorded exactly as on any other day — same tables, same
 * verdict, same audit — and the shadow report judges the day against the
 * line's rate ceiling rather than calling a fast trial fake.
 *
 * The arithmetic is shared/line/takt.ts; this only shows it. The large figure
 * is the MEDIAN seconds per spring, not the average: one spring that sticks in
 * the gauge should not hide a station that is otherwise on time, and one lucky
 * second should not flatter one that is not. Stoppages are counted apart.
 */
import React, { useEffect, useState } from 'react';
import { taktReading, TARGET_TAKT_SECONDS, TARGET_SPRINGS, TARGET_HOURS, PAUSE_SECONDS } from '../../../shared/line/takt.ts';

interface Props {
  lang: 'en' | 'hi';
  /** Instants (ms) of the springs recorded since the trial started; null when no trial is running. */
  instants: number[] | null;
  /** The last finished trial's instants, kept on screen after Stop. */
  finished: number[] | null;
  onStart: () => void;
  onStop: () => void;
  /** A queue is still sending; a trial should not start on top of it. */
  busy?: boolean;
}

export const TaktClock: React.FC<Props> = ({ lang, instants, finished, onStart, onStop, busy }) => {
  const isHi = lang === 'hi';
  const t = (en: string, hi: string) => (isHi ? hi : en);
  const running = instants !== null;
  const shown = running ? instants : finished;
  const reading = shown ? taktReading(shown) : null;

  // Seconds since the last spring, ticking — the one number the person at the bench watches.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [running]);
  const last = running && instants.length ? instants[instants.length - 1] : null;
  const since = last !== null ? (now - last) / 1000 : null;
  const sinceTone = since === null ? 'text-ink-muted' : since <= TARGET_TAKT_SECONDS ? 'text-good-ink' : since <= PAUSE_SECONDS ? 'text-warn-ink' : 'text-ink-faint';

  const verdictTone = reading?.verdict === 'WITHIN' ? 'text-good-ink' : reading?.verdict === 'CLOSE' ? 'text-warn-ink' : reading?.verdict === 'OVER' ? 'text-bad-ink' : 'text-ink-muted';
  const verdictWord = reading?.verdict === 'WITHIN'
    ? t('within the target', 'लक्ष्य के भीतर')
    : reading?.verdict === 'CLOSE'
      ? t('within a fifth of the target', 'लक्ष्य के क़रीब')
      : reading?.verdict === 'OVER'
        ? t('slower than the target', 'लक्ष्य से धीमा')
        : '';

  return (
    <div className="rounded-card border border-line bg-card p-4 space-y-3" data-testid="takt-clock">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-extrabold text-white">{t('Timed trial', 'समयबद्ध परीक्षण')}</h3>
          <p className="text-[11px] text-ink-muted max-w-md">
            {t(
              `The target: ${TARGET_SPRINGS} springs in ${TARGET_HOURS} hours — one every ${TARGET_TAKT_SECONDS.toFixed(1)} seconds. Start, sort as usual, stop. The springs are recorded as on any other day.`,
              `लक्ष्य: ${TARGET_HOURS} घंटे में ${TARGET_SPRINGS} स्प्रिंग — हर ${TARGET_TAKT_SECONDS.toFixed(1)} सेकंड में एक। शुरू करें, सामान्य रूप से छाँटें, रोकें। स्प्रिंग हमेशा की तरह दर्ज होते हैं।`
            )}
          </p>
        </div>
        {running ? (
          <button type="button" onClick={onStop} data-testid="takt-stop"
            className="min-h-[44px] px-4 rounded-control bg-bad text-white text-sm font-bold">
            {t('Stop trial', 'परीक्षण रोकें')}
          </button>
        ) : (
          <button type="button" onClick={onStart} disabled={busy} data-testid="takt-start"
            className="min-h-[44px] px-4 rounded-control bg-accent text-white text-sm font-bold disabled:opacity-40">
            {finished ? t('Start a new trial', 'नया परीक्षण शुरू करें') : t('Start timed trial', 'परीक्षण शुरू करें')}
          </button>
        )}
      </div>

      {shown && reading && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="takt-reading">
          <div className="col-span-2 rounded-control border border-line bg-raised p-3">
            <div className="text-[10px] uppercase tracking-wide text-ink-muted">{t('Seconds per spring (median)', 'प्रति स्प्रिंग सेकंड (माध्यिका)')}</div>
            {reading.canQuote ? (
              <>
                <div className={`text-4xl font-extrabold tabular-nums ${verdictTone}`} data-testid="takt-median">{reading.medianSeconds}</div>
                <div className={`text-xs font-bold ${verdictTone}`}>{verdictWord} · {t('target', 'लक्ष्य')} {TARGET_TAKT_SECONDS.toFixed(1)} s</div>
                <div className="text-[11px] text-ink-faint">{t(`from ${reading.intervals} springs; 90 % took ${reading.p90Seconds} s or less`, `${reading.intervals} स्प्रिंग से; 90 % ने ${reading.p90Seconds} सेकंड या कम लिए`)}</div>
              </>
            ) : (
              <div className="text-sm text-ink-muted py-2">{isHi ? reading.reasonHi : reading.reason}</div>
            )}
          </div>
          <div className="rounded-control border border-line bg-raised p-3">
            <div className="text-[10px] uppercase tracking-wide text-ink-muted">{running ? t('Since the last spring', 'पिछले स्प्रिंग से') : t('Springs timed', 'समय मापे स्प्रिंग')}</div>
            <div className={`text-2xl font-extrabold tabular-nums ${running ? sinceTone : 'text-white'}`} data-testid="takt-since">
              {running ? (since === null ? '—' : `${since.toFixed(0)} s`) : reading.springs}
            </div>
            <div className="text-[11px] text-ink-faint">{running ? t(`${reading.springs} springs so far`, `अब तक ${reading.springs} स्प्रिंग`) : t('in this trial', 'इस परीक्षण में')}</div>
          </div>
          <div className="rounded-control border border-line bg-raised p-3">
            <div className="text-[10px] uppercase tracking-wide text-ink-muted">{t(`${TARGET_SPRINGS} springs would take`, `${TARGET_SPRINGS} स्प्रिंग में लगेंगे`)}</div>
            <div className="text-2xl font-extrabold tabular-nums text-white" data-testid="takt-hours">
              {reading.hoursFor1000 !== null ? `${reading.hoursFor1000} h` : '—'}
            </div>
            <div className="text-[11px] text-ink-faint">
              {reading.springsPerHour !== null ? t(`${reading.springsPerHour} an hour at this pace`, `इस गति से ${reading.springsPerHour} प्रति घंटा`) : t('at this pace', 'इस गति से')}
            </div>
          </div>
          {reading.stoppages > 0 && (
            <div className="col-span-2 sm:col-span-4 text-[11px] text-warn-ink" data-testid="takt-stoppages">
              {t(
                `${reading.stoppages} stoppage${reading.stoppages === 1 ? '' : 's'} longer than ${PAUSE_SECONDS / 60} minutes (${reading.stoppageMinutes} min in all) — counted apart, not in the per-spring figure. A line's speed and its stoppages are different problems.`,
                `${PAUSE_SECONDS / 60} मिनट से लंबे ${reading.stoppages} ठहराव (कुल ${reading.stoppageMinutes} मिनट) — अलग गिने गए, प्रति-स्प्रिंग आँकड़े में नहीं।`
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
