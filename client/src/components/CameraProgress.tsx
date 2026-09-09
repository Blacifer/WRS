/**
 * Is the camera actually getting better?
 * Indian Railways WRS Raipur
 *
 * The obvious chart to draw here would be the number of photographs the camera
 * has been taught, and it would be the wrong one. That number only ever goes
 * up. It rises just as steeply for a camera that has learned nothing, and a
 * rising line labelled "examples" invites exactly the conclusion it does not
 * support.
 *
 * So this shows agreement instead: of the answers the camera offered, how many
 * the inspector kept — week by week. That can fall. It falling is useful
 * information (new spring types, a different bench, a new inspector labelling
 * differently), and a camera that is not improving produces a flat line here,
 * which is the honest thing to put in front of somebody deciding whether to
 * trust it.
 *
 * Weeks where the camera stayed silent contribute nothing, because silence is
 * neither agreement nor disagreement. Counting them as agreement would let a
 * camera that never answers look perfect.
 */

import { useEffect, useState } from 'react';
import { api } from '../services/api.ts';

interface Props {
  lang: 'en' | 'hi';
}

type Week = { week: string; taught: number; proposed: number; corrections: number; agreementRate: number | null };

export function CameraProgress({ lang }: Props) {
  const isHi = lang === 'hi';
  const [weeks, setWeeks] = useState<Week[] | null>(null);
  const [summary, setSummary] = useState('');
  const [counts, setCounts] = useState<Record<string, Record<string, number>>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getVisionBrainProgress('SPRING');
        if (cancelled) return;
        setWeeks(res.data.weeks);
        setSummary(res.data.summary);
        setCounts(res.data.counts);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Could not read the camera progress.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const scored = (weeks || []).filter((w) => w.agreementRate !== null);
  const totalTaught = Object.values(counts).reduce(
    (sum, byLabel) => sum + Object.values(byLabel).reduce((a, b) => a + b, 0),
    0
  );

  return (
    <section className="bg-card border border-line rounded-card p-6 space-y-3" data-testid="camera-progress">
      <header>
        <h2 className="text-xl font-black text-white">
          {isHi ? 'कैमरा — प्रगति' : 'The camera — is it improving?'}
        </h2>
        <p className="text-xs text-ink-muted mt-1 leading-relaxed max-w-2xl">
          {isHi
            ? 'यह उदाहरणों की संख्या नहीं है। यह वह हिस्सा है जो निरीक्षक ने रखा।'
            : 'Not the number of photographs it has been shown — that only ever rises. This is the share of the camera’s own answers the inspector kept, week by week. It is allowed to fall.'}
        </p>
      </header>

      {error && <p className="text-xs font-bold text-bad-ink">{error}</p>}

      {weeks === null && !error && (
        <p className="text-sm text-ink-muted">{isHi ? 'लोड हो रहा है…' : 'Loading…'}</p>
      )}

      {weeks !== null && totalTaught === 0 && (
        <p className="text-sm text-ink-body leading-relaxed">
          {isHi
            ? 'कैमरे को अभी कुछ नहीं सिखाया गया है।'
            : 'The camera has not been taught anything yet. Open Spring Sorting, start the camera, and tap the right answer a few times — this fills in from the first week it is used.'}
        </p>
      )}

      {scored.length > 0 && (
        <div className="space-y-1.5" data-testid="camera-progress-weeks">
          {scored.map((w) => {
            const pct = Math.round((w.agreementRate ?? 0) * 100);
            return (
              <div key={w.week} className="flex items-center gap-3">
                <span className="font-mono text-[11px] text-ink-muted w-20 shrink-0">{w.week}</span>
                <div className="h-2.5 bg-page rounded-full overflow-hidden flex-1">
                  <div className="h-full bg-sky-500" style={{ width: `${pct}%` }} />
                </div>
                <span className="font-mono text-xs font-bold text-white tabular-nums w-12 text-right">
                  {pct}%
                </span>
                <span className="font-mono text-[11px] text-ink-muted w-28 shrink-0">
                  {w.proposed - w.corrections}/{w.proposed}{' '}
                  {isHi ? 'रखे' : 'kept'}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {summary && (
        <p className="text-xs font-bold text-ink-body pt-1 leading-relaxed" data-testid="camera-progress-summary">
          {summary}
        </p>
      )}

      {totalTaught > 0 && (
        <p className="text-[11px] font-mono text-ink-muted">
          {isHi ? 'कुल सिखाए गए: ' : 'Taught so far: '}
          {totalTaught.toLocaleString()}{' '}
          {isHi ? 'तस्वीरें' : 'photographs'}
          {' — '}
          {isHi
            ? 'यह संख्या सुधार का प्रमाण नहीं है।'
            : 'a count, not evidence of improvement. The bars above are that.'}
        </p>
      )}
    </section>
  );
}
