/**
 * Suggested checklist statuses, drawn from this shop's own history
 * Indian Railways WRS Raipur
 *
 * WHY THIS EXISTS
 * ---------------
 * Fifty-two mandatory items per wagon, most of which come back the same way
 * almost every time. Typing PASS fifty times is the kind of work that gets
 * done carelessly precisely because it is repetitive — which is the opposite
 * of what a quality checklist is for.
 *
 * This proposes an answer for each item from what the shop actually recorded
 * on that part before, so an inspector confirms rather than enters.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * Nothing applies itself. Every suggestion is a proposal with its evidence
 * attached, and a person accepts it. A checklist that fills itself in is not a
 * checklist — it is a formality, and the entire value of this system is that
 * it refuses to be one.
 *
 * A part with fewer than five previous inspections gets no suggestion at all,
 * and says so. Guessing from two data points is how a system teaches people to
 * stop reading it.
 */

import { useState } from 'react';
import { api } from '../services/api.ts';

interface Suggestion {
  itemId: string;
  category: string;
  partName: string;
  suggestedStatus: string;
  confidence: number;
  basis: string;
}

interface Props {
  wagonNumber: string;
  lang: 'en' | 'hi';
  /** Applies one suggestion; the caller owns the actual checklist write. */
  onApply: (itemId: string, status: string) => Promise<void>;
  onApplied?: () => void;
}

export function ChecklistSuggestions({ wagonNumber, lang, onApply, onApplied }: Props) {
  const isHi = lang === 'hi';

  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.getChecklistSuggestions(wagonNumber);
      setSuggestions(res.data.suggestions || []);
    } catch (e: any) {
      setError(e?.message || (isHi ? 'सुझाव नहीं मिल सके' : 'Could not fetch suggestions'));
    } finally {
      setBusy(false);
    }
  };

  const apply = async (s: Suggestion) => {
    setApplying(s.itemId);
    try {
      await onApply(s.itemId, s.suggestedStatus);
      setSuggestions((prev) => (prev || []).filter((x) => x.itemId !== s.itemId));
      onApplied?.();
    } catch (e: any) {
      setError(e?.message || 'Could not apply that suggestion');
    } finally {
      setApplying(null);
    }
  };

  // Items with real evidence behind them, and items without — kept apart,
  // because mixing them would let a guess borrow the credibility of a finding.
  const evidenced = (suggestions || []).filter((s) => s.confidence > 0);
  const unevidenced = (suggestions || []).filter((s) => s.confidence === 0);

  return (
    <div className="rounded-control border border-line bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h4 className="text-sm font-extrabold text-white">
            {isHi ? 'इतिहास से सुझाव' : 'Suggestions from history'}
          </h4>
          <p className="text-[11px] text-ink-muted mt-0.5 max-w-xl">
            {isHi
              ? 'इसी शॉप में इस पुर्ज़े पर पहले दर्ज किए गए निर्णयों से — कोई सुझाव स्वयं लागू नहीं होता।'
              : 'Drawn from what this shop recorded on the same part before. Nothing applies itself — each one shows its evidence and waits for you.'}
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={busy}
          className="px-3 py-1.5 rounded-control border border-accent-line text-accent-ink hover:bg-accent-soft disabled:opacity-40 text-xs font-bold whitespace-nowrap"
        >
          {busy
            ? (isHi ? 'देख रहे हैं…' : 'Checking…')
            : (isHi ? 'सुझाव देखें' : 'Suggest from history')}
        </button>
      </div>

      {error && (
        <p className="text-xs font-semibold text-bad-ink bg-bad-soft border border-bad-line rounded-control px-3 py-2">
          {error}
        </p>
      )}

      {suggestions && suggestions.length === 0 && (
        <p className="text-xs text-ink-faint">
          {isHi ? 'कोई शेष पुर्ज़ा नहीं — सब दर्ज हो चुके हैं।' : 'Nothing pending — every item has been recorded.'}
        </p>
      )}

      {evidenced.length > 0 && (
        <div className="space-y-1.5">
          {evidenced.map((s) => (
            <div
              key={s.itemId}
              className="flex items-start justify-between gap-3 rounded-control border border-line bg-raised px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-sm text-white truncate">{s.partName}</p>
                <p className="text-[11px] text-ink-muted">
                  {s.basis}
                  <span className="text-ink-faint"> · {(s.confidence * 100).toFixed(0)}%</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => apply(s)}
                disabled={applying === s.itemId}
                className="shrink-0 px-2.5 py-1 rounded border border-good-line text-good-ink hover:bg-good-soft disabled:opacity-40 text-[11px] font-bold"
              >
                {applying === s.itemId ? '…' : `${isHi ? 'लागू करें' : 'Accept'} ${s.suggestedStatus}`}
              </button>
            </div>
          ))}
        </div>
      )}

      {unevidenced.length > 0 && (
        <p className="text-[11px] text-ink-faint border-t border-line pt-2">
          {isHi
            ? `${unevidenced.length} पुर्ज़ों के लिए पर्याप्त इतिहास नहीं — इन्हें हाथ से दर्ज करें।`
            : `${unevidenced.length} item${unevidenced.length === 1 ? '' : 's'} have too little history to suggest from, and are left for you to judge.`}
        </p>
      )}
    </div>
  );
}
