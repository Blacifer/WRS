/**
 * Parts in, parts out
 * Indian Railways WRS Raipur
 *
 * WHAT THIS ANSWERS
 * -----------------
 * The DRM's second ask was about what happens after a wagon leaves: that
 * nobody should be able to say a part was missing, or went back rusted, and
 * find no answer on the record.
 *
 * A checklist cannot answer that. It proves every named line was looked at; it
 * says nothing about whether the four friction wedges that came off are the
 * four that went back on. This does: one entry per thing that happened, with
 * the person and the time against it, and the difference named at the gate.
 *
 * WHY IT SUGGESTS RATHER THAN JUST REPORTS
 * ----------------------------------------
 * "One friction wedge outstanding" sends a fitter back to the office. "One
 * outstanding; stores holds 12 in bin B-14; WMM 2.0 §309B covers this part"
 * does not. Every figure in that sentence is read from a record — the ledger,
 * the stores level, the shop's own cited standard — and nothing in it is
 * generated.
 *
 * WHY AN EMPTY LEDGER SAYS SO LOUDLY
 * ----------------------------------
 * The dangerous failure here is a wagon with nothing recorded reading as
 * "nothing missing". Silence is not balance, and the screen says which it is
 * looking at.
 */

import { useCallback, useEffect, useState } from 'react';
import { api, type PartLedgerEntry, type PartReconciliation } from '../services/api.ts';

interface Props {
  wagonNumber: string;
  /** The stage the wagon is in — decides which action is offered first. */
  stage?: string;
  lang: 'en' | 'hi';
  canRecord: boolean;
}

type PartEvent = 'REMOVED' | 'REFITTED' | 'REPLACED' | 'SCRAPPED' | 'NOT_FITTED';

const EVENT_LABEL: Record<PartEvent, string> = {
  REMOVED: 'Came off',
  REFITTED: 'Went back on',
  REPLACED: 'Replaced with new',
  SCRAPPED: 'Scrapped',
  NOT_FITTED: 'Not being refitted'
};

/** These two are decisions, not observations, so each one needs a reason. */
const NEEDS_REASON: PartEvent[] = ['SCRAPPED', 'NOT_FITTED'];

const CATEGORIES = [
  'SPRINGS',
  'FRICTION_WEDGES',
  'BOGIE_FRAME_BOLSTER',
  'WHEELS_AXLES',
  'BEARINGS',
  'BRAKE_SYSTEM',
  'COUPLERS_DRAFT_GEAR',
  'BODY_UNDERFRAME'
];

const POSITIONS = ['BOGIE_1', 'BOGIE_2', 'UNDERFRAME', 'BODY', 'NONE'];

export function PartsLedger({ wagonNumber, stage, lang, canRecord }: Props) {
  const isHi = lang === 'hi';

  const [recon, setRecon] = useState<PartReconciliation | null>(null);
  const [entries, setEntries] = useState<PartLedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // Dismantling is when things come off; everything after it is when they go
  // back. Defaulting to the likely action saves a tap on every part.
  const [event, setEvent] = useState<PartEvent>(stage === 'DISMANTLING' ? 'REMOVED' : 'REFITTED');
  const [category, setCategory] = useState(CATEGORIES[1]);
  const [partName, setPartName] = useState('');
  const [bogiePosition, setBogiePosition] = useState(POSITIONS[0]);
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    try {
      const [r, l] = await Promise.all([
        api.getPartReconciliation(wagonNumber),
        api.getPartLedger(wagonNumber)
      ]);
      setRecon(r.data);
      setEntries(l.data.entries);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Could not read the parts ledger.');
    } finally {
      setLoading(false);
    }
  }, [wagonNumber]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = useCallback(async () => {
    if (!partName.trim()) return;
    setSaving(true);
    try {
      await api.recordPartEvent(wagonNumber, {
        category,
        partName: partName.trim(),
        bogiePosition,
        event,
        quantity,
        reason: reason.trim() || null
      });
      setPartName('');
      setReason('');
      setQuantity(1);
      setError(null);
      await load();
    } catch (err: any) {
      setError(err?.message || 'Could not record that.');
    } finally {
      setSaving(false);
    }
  }, [wagonNumber, category, partName, bogiePosition, event, quantity, reason, load]);

  const needsReason = NEEDS_REASON.includes(event);
  const nothingRecorded = !!recon && recon.parts.length === 0;

  return (
    <section className="space-y-4" data-testid="parts-ledger">
      <header>
        <h2 className="text-xl font-black text-white">
          {isHi ? 'पुर्जे — निकले और लगे' : 'Parts in, parts out'}
        </h2>
        <p className="text-xs text-ink-muted mt-1 max-w-2xl leading-relaxed">
          {isHi
            ? 'हर पुर्जा जो निकला और जो वापस लगा, नाम और समय के साथ।'
            : 'Everything recorded coming off during dismantling, and going back on during reassembly, with the person and the time against each. This is what answers "was anything missing" months after the wagon has gone.'}
        </p>
      </header>

      {error && (
        <p className="text-xs font-bold text-bad-ink bg-raised border border-line rounded-control p-3">
          {error}
        </p>
      )}

      {/* The balance — or the honest statement that there is none. */}
      <div
        className={`rounded-control border p-4 ${
          nothingRecorded
            ? 'border-warn bg-warn/10'
            : recon?.balanced
            ? 'border-good bg-good/10'
            : 'border-bad bg-bad/10'
        }`}
        data-testid="parts-reconciliation"
      >
        {loading ? (
          <p className="text-sm text-ink-muted">{isHi ? 'लोड हो रहा है…' : 'Loading…'}</p>
        ) : (
          <>
            <p className="text-sm font-bold text-white leading-relaxed">{recon?.summary}</p>
            {recon && recon.parts.length > 0 && (
              <p className="text-[11px] font-mono text-ink-muted mt-2">
                {recon.totalRemoved} off · {recon.totalBack} back on ·{' '}
                {recon.parts.length} position{recon.parts.length === 1 ? '' : 's'} tracked
              </p>
            )}
          </>
        )}
      </div>

      {/* Anything outstanding, with what to do about it. */}
      {recon && (recon.outstandingParts.length > 0 || recon.unaccountedParts.length > 0) && (
        <div className="space-y-2" data-testid="parts-outstanding">
          {[...recon.outstandingParts, ...recon.unaccountedParts].map((p) => (
            <div key={p.partKey} className="rounded-control border border-line bg-raised p-3">
              <p className="text-sm font-bold text-white">
                {p.partName}{' '}
                <span className="font-mono text-xs text-ink-muted">
                  {p.bogiePosition.replace(/_/g, ' ')}
                </span>
              </p>
              {p.suggestion && (
                <p className="text-xs text-ink-body mt-1 leading-relaxed">{p.suggestion}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Recording one event. */}
      {canRecord && (
        <div className="rounded-control border border-line bg-card p-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(EVENT_LABEL) as PartEvent[]).map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setEvent(e)}
                data-testid={`part-event-${e}`}
                className={`px-3 py-1.5 rounded-control text-xs font-bold border ${
                  e === event ? 'bg-sky-600 text-white border-sky-600' : 'border-line text-ink-body'
                }`}
              >
                {EVENT_LABEL[e]}
              </button>
            ))}
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs font-bold text-ink-muted">
              {isHi ? 'श्रेणी' : 'Category'}
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="mt-1 w-full bg-page border border-line rounded-control px-2 py-2 text-sm text-white"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-xs font-bold text-ink-muted">
              {isHi ? 'स्थान' : 'Position'}
              <select
                value={bogiePosition}
                onChange={(e) => setBogiePosition(e.target.value)}
                className="mt-1 w-full bg-page border border-line rounded-control px-2 py-2 text-sm text-white"
              >
                {POSITIONS.map((p) => (
                  <option key={p} value={p}>
                    {p.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-xs font-bold text-ink-muted sm:col-span-2">
              {isHi ? 'पुर्जे का नाम' : 'Part'}
              <input
                value={partName}
                onChange={(e) => setPartName(e.target.value)}
                data-testid="part-name-input"
                placeholder={isHi ? 'जैसे Friction Wedge' : 'e.g. Friction Wedge'}
                className="mt-1 w-full bg-page border border-line rounded-control px-2 py-2 text-sm text-white"
              />
            </label>

            <label className="text-xs font-bold text-ink-muted">
              {isHi ? 'संख्या' : 'How many'}
              <input
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
                data-testid="part-quantity-input"
                className="mt-1 w-full bg-page border border-line rounded-control px-2 py-2 text-sm text-white"
              />
            </label>
          </div>

          {/*
           * A part that is not going back needs a decision recorded against it.
           * Without this the only way to balance a wagon is to write something
           * untrue, and a ledger people must lie in is worse than no ledger.
           */}
          {needsReason && (
            <label className="block text-xs font-bold text-ink-muted">
              {isHi ? 'कारण (आवश्यक)' : 'Why is it not going back on? (required)'}
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                data-testid="part-reason-input"
                placeholder={
                  isHi ? 'जैसे condemned, indent IND-2291' : 'e.g. Condemned; replacement on indent IND-2291'
                }
                className="mt-1 w-full bg-page border border-line rounded-control px-2 py-2 text-sm text-white"
              />
            </label>
          )}

          <button
            type="button"
            disabled={saving || !partName.trim() || (needsReason && !reason.trim())}
            onClick={submit}
            data-testid="part-record-submit"
            className="w-full py-2.5 rounded-control bg-sky-600 text-white font-bold text-sm disabled:opacity-40"
          >
            {saving
              ? isHi
                ? 'दर्ज हो रहा है…'
                : 'Recording…'
              : isHi
              ? 'दर्ज करें'
              : `Record: ${EVENT_LABEL[event]}`}
          </button>
        </div>
      )}

      {/* The events themselves, because the balance is only as good as they are. */}
      <div>
        <button
          type="button"
          onClick={() => setShowHistory((v) => !v)}
          data-testid="parts-history-toggle"
          className="text-xs font-bold text-sky-400"
        >
          {showHistory
            ? isHi
              ? 'इतिहास छिपाएँ'
              : 'Hide every entry'
            : isHi
            ? `हर प्रविष्टि देखें (${entries.length})`
            : `Show every entry (${entries.length})`}
        </button>

        {showHistory && (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-xs" data-testid="parts-history">
              <thead>
                <tr className="text-ink-muted text-left">
                  <th className="py-1 pr-3">{isHi ? 'कब' : 'When'}</th>
                  <th className="py-1 pr-3">{isHi ? 'क्या' : 'What'}</th>
                  <th className="py-1 pr-3">{isHi ? 'पुर्जा' : 'Part'}</th>
                  <th className="py-1 pr-3">{isHi ? 'संख्या' : 'Qty'}</th>
                  <th className="py-1 pr-3">{isHi ? 'चरण' : 'Stage'}</th>
                  <th className="py-1 pr-3">{isHi ? 'किसने' : 'By'}</th>
                  <th className="py-1">{isHi ? 'कारण' : 'Reason'}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-t border-line">
                    <td className="py-1 pr-3 font-mono text-ink-muted">{e.createdAt.slice(0, 16).replace('T', ' ')}</td>
                    <td className="py-1 pr-3 font-bold text-white">{EVENT_LABEL[e.event]}</td>
                    <td className="py-1 pr-3">
                      {e.partName}{' '}
                      <span className="text-ink-muted">{e.bogiePosition.replace(/_/g, ' ')}</span>
                    </td>
                    <td className="py-1 pr-3 font-mono">{e.quantity}</td>
                    <td className="py-1 pr-3 text-ink-muted">{e.stage.replace(/_/g, ' ')}</td>
                    <td className="py-1 pr-3">{e.inspectorName}</td>
                    <td className="py-1 text-ink-muted">{e.reason || '—'}</td>
                  </tr>
                ))}
                {entries.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-3 text-center text-ink-muted">
                      {isHi ? 'अभी कुछ दर्ज नहीं।' : 'Nothing recorded yet.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
