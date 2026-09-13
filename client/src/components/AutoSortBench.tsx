/**
 * The sorting bench with the taps taken out
 * Indian Railways WRS Raipur
 *
 * WHAT CHANGES HERE
 * -----------------
 * At seven hundred springs a shift, the tap is the work. On the ordinary
 * bench an inspector taps the kind of spring, taps the band, taps the
 * condition, taps to record. Four taps, seven hundred times.
 *
 * Here the inspector places the spring, and the height arrives — from a
 * caliper that types its reading (a keyboard-wedge caliper does exactly
 * that: digits and Enter, into whatever has focus, which is the box below),
 * or from the strip read by eye and typed. That is the ONE thing a person
 * still does per spring, because the band is not the camera's to decide.
 *
 * Everything else is the camera's, and when it has EARNED it — measured 95%
 * on this shop's own springs, confident about this frame, still agreeing
 * with people lately, and seeing nothing wrong — the record is written with
 * no tap at all. The screen says which bin. The inspector moves the spring.
 * Next.
 *
 * When it has not earned it, or sees a fault, or the height is out of band,
 * it asks — with its answers pre-selected, so agreeing is one tap and
 * correcting is one tap. That is the same bench as before, with the camera
 * having done the reading first.
 *
 * WHAT IT NEVER DOES
 * ------------------
 * It never condemns on its own. A condemnation scraps a part; a person makes
 * that call. It never records a band the camera guessed; there is no such
 * thing. And it never teaches itself its own unconfirmed answers — an
 * auto-committed spring is logged as the camera's decision, excluded from
 * the camera's own agreement score, and sampled blind by a supervisor
 * instead. The rule that decides all of this is one function,
 * shared/vision/autoCommit.ts, and it is the same one the wagon checklist
 * uses.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../services/api.ts';
import {
  VisionBrain,
  decodeEmbedding,
  encodeEmbedding,
  readFrame,
  SUGGESTED_LABELS,
  type BrainHead,
  type Proposal
} from '../services/visionBrain.ts';
import { decideAutoCommit, isFault, type AutoCommitDecision, type LiveAgreement } from '../../../shared/vision/autoCommit.ts';
import { judgeSortedSpring, type SortingBogie } from '../../../shared/classification/springJudgement.ts';
import type { SpringCondition, SpringPosition } from '../../../shared/types.ts';

interface Props {
  lang: 'en' | 'hi';
  batchId: string;
  bogieType: SortingBogie;
  condition: SpringCondition;
  gaugeCode: string | null;
  /**
   * The position the bench is set to. The camera's category must agree with
   * it, or the spring is asked about — a second source, already on the bench,
   * that stops a confidently misnamed spring being recorded against the wrong
   * band table.
   */
  expectedPosition: SpringPosition;
  /** Called after every record, so the page's counters and queue move. */
  onRecorded: (status: 'PASS' | 'CONDEMNED', band: string | null, auto: boolean) => void;
}

const HEADS: BrainHead[] = ['CATEGORY', 'SURFACE', 'DAMAGE'];

/** The camera's category, as the position the record takes. */
function positionFor(label: string | null): SpringPosition | null {
  if (label === 'OUTER' || label === 'INNER' || label === 'SNUBBER') return label;
  return null;
}

/** The camera's damage answer, as the record's damage type. */
function damageFor(surface: string | null, damage: string | null): string | null {
  if (damage && damage !== 'NONE') return damage;
  if (surface && isFault('SURFACE', surface)) return 'CORROSION';
  return null;
}

type Bin = { label: string; tone: 'good' | 'bad' };

export default function AutoSortBench({ lang, batchId, bogieType, condition, gaugeCode, expectedPosition, onRecorded }: Props) {
  const isHi = lang === 'hi';

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const heightRef = useRef<HTMLInputElement | null>(null);
  const brainRef = useRef(new VisionBrain());
  const frameRef = useRef<{ embedding: Float32Array; proposals: Record<string, Proposal> } | null>(null);

  const [on, setOn] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [height, setHeight] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [live, setLive] = useState<Partial<Record<BrainHead, LiveAgreement>> | null>(null);
  const [master, setMaster] = useState(true);
  const [decision, setDecision] = useState<AutoCommitDecision | null>(null);
  const [proposals, setProposals] = useState<Record<string, Proposal>>({});
  const [chosen, setChosen] = useState<Record<string, string | null>>({});
  const [bin, setBin] = useState<Bin | null>(null);
  const [tally, setTally] = useState({ auto: 0, asked: 0 });

  // -- what it knows, and whether it is currently allowed to decide ---------
  const reload = useCallback(async () => {
    try {
      const [brain, status] = await Promise.all([
        api.getVisionBrain('SPRING'),
        api.getVisionAutoStatus('SPRING')
      ]);
      const b = new VisionBrain();
      for (const e of brain.data.examples) {
        b.remember({
          id: e.id, domain: 'SPRING', head: e.head, label: e.label,
          embedding: decodeEmbedding(e.embedding), sourceImageId: e.sourceImageId
        });
      }
      brainRef.current = b;
      const l: Partial<Record<BrainHead, LiveAgreement>> = {};
      for (const h of status.data.heads) l[h.head] = { sampled: h.sampled, rate: h.rate };
      setLive(l);
      setMaster(status.data.master);
    } catch {
      // Offline. The camera still proposes; it just cannot auto-commit,
      // because condition 3 needs the server's word. That is correct.
      setLive(null);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  // -- the camera -----------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    const stop = () => { streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; setReady(false); };
    if (!on) { stop(); return; }
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => undefined); }
        setReady(true); setProblem(null);
        heightRef.current?.focus();
      } catch (err: any) {
        setProblem(err?.name === 'NotAllowedError' ? 'Camera permission was refused.' : err?.message || 'The camera could not be opened.');
        setReady(false);
      }
    })();
    return () => { cancelled = true; stop(); };
  }, [on]);

  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  // -- one spring -----------------------------------------------------------
  const judge = useCallback(async (h: number) => {
    const video = videoRef.current;
    if (!video || !ready || !video.videoWidth) return;
    setBusy(true); setDecision(null); setBin(null);
    try {
      const { embedding } = await readFrame(video);
      const ps: Record<string, Proposal> = {};
      for (const head of HEADS) ps[head] = brainRef.current.predict(head, embedding);
      frameRef.current = { embedding, proposals: ps };
      setProposals(ps);

      const position = positionFor(ps.CATEGORY.label);
      const damageType = damageFor(ps.SURFACE.label, ps.DAMAGE.label);

      // 5. The instrument's verdict on the height, computed here from the same
      //    tables the server uses, so the bench can decide before the round trip.
      const verdict = position
        ? judgeSortedSpring({ bogieType, condition, position, measuredHeight: h, damageType: null })
        : null;
      const measurementPassed = verdict ? verdict.status === 'PASS' : null;

      const d = decideAutoCommit({
        domain: 'SPRING',
        heads: HEADS.map((head) => ({
          head,
          verdict: brainRef.current.evaluate(head).verdict,
          confidence: ps[head].confidence,
          label: ps[head].label
        })),
        measurementPassed,
        liveAgreement: master ? live : null,
        expected: { CATEGORY: expectedPosition }
      });
      setDecision(d);
      setChosen({ CATEGORY: ps.CATEGORY.label, SURFACE: ps.SURFACE.label, DAMAGE: ps.DAMAGE.label });

      if (d.mode === 'AUTO' && position) {
        // The whole point. No tap.
        const res = await api.recordSortedSpring({
          batchId, bogieType, condition, springPosition: position,
          measuredFreeHeight: h, heightIsApproximate: false,
          damageType: damageType ?? undefined, gaugeCode: gaugeCode || null,
          measurementSource: 'CAMERA_AUTO'
        });
        // On the record as the camera's decision — and NOT a teaching.
        void api.recordVisionAutoDecision({
          domain: 'SPRING', recordId: res.data.id,
          heads: HEADS.map((head) => ({ head, label: ps[head].label!, confidence: ps[head].confidence, neighbours: ps[head].neighbours.map((n) => n.exampleId) }))
        }).catch(() => undefined);
        setBin({ label: `${position} · ${res.data.band ?? 'PASS'}`, tone: 'good' });
        setTally((t) => ({ ...t, auto: t.auto + 1 }));
        onRecorded(res.data.status as 'PASS' | 'CONDEMNED', res.data.band ?? null, true);
        setHeight('');
        heightRef.current?.focus();
      } else {
        setTally((t) => ({ ...t, asked: t.asked + 1 }));
      }
    } catch (err: any) {
      setProblem(err?.message || 'Could not judge that spring.');
    } finally {
      setBusy(false);
    }
  }, [ready, bogieType, condition, batchId, gaugeCode, live, master, expectedPosition, onRecorded]);

  /** The person's answer when asked: record it, and teach every head from it. */
  const confirm = useCallback(async () => {
    const f = frameRef.current;
    if (!f) return;
    const h = Number(height);
    const position = positionFor(chosen.CATEGORY);
    if (!position || !Number.isFinite(h)) return;
    setBusy(true);
    try {
      const damageType = damageFor(chosen.SURFACE, chosen.DAMAGE);
      const agreed = HEADS.every((head) => f.proposals[head].label === chosen[head]);
      const res = await api.recordSortedSpring({
        batchId, bogieType, condition, springPosition: position,
        measuredFreeHeight: h, heightIsApproximate: false,
        damageType: damageType ?? undefined, gaugeCode: gaugeCode || null,
        // Accepted as shown is the camera's reading a person agreed with;
        // anything corrected is the person's own.
        measurementSource: agreed && f.proposals.CATEGORY.label ? 'CAMERA_ASSISTED' : 'MANUAL'
      });
      // Every head learns from the person, proposed-vs-chosen, so agreement is honest.
      for (const head of HEADS) {
        const label = chosen[head];
        if (!label) continue;
        void api.teachVisionBrain({
          domain: 'SPRING', head, label, embedding: encodeEmbedding(f.embedding),
          proposedLabel: f.proposals[head].label, confidence: f.proposals[head].confidence
        }).catch(() => undefined);
        brainRef.current.remember({ id: `local_${Date.now()}_${head}`, domain: 'SPRING', head, label, embedding: f.embedding });
      }
      setBin({ label: res.data.status === 'CONDEMNED' ? (isHi ? 'कंडम' : 'CONDEMNED') : `${position} · ${res.data.band ?? 'PASS'}`, tone: res.data.status === 'CONDEMNED' ? 'bad' : 'good' });
      onRecorded(res.data.status as 'PASS' | 'CONDEMNED', res.data.band ?? null, false);
      setDecision(null); setHeight('');
      heightRef.current?.focus();
    } catch (err: any) {
      setProblem(err?.message || 'Could not record that spring.');
    } finally {
      setBusy(false);
    }
  }, [height, chosen, batchId, bogieType, condition, gaugeCode, isHi, onRecorded]);

  const onHeightKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    const h = Number(height);
    if (!Number.isFinite(h) || h <= 0) return;
    void judge(h);
  };

  const earned = HEADS.map((head) => brainRef.current.evaluate(head));
  const allowed = master && earned.every((e) => e.verdict === 'ASSIST') && HEADS.every((h) => (live?.[h]?.rate ?? 0) >= 0.95);

  return (
    <section className="bg-card border border-line rounded-card p-6 space-y-4" data-testid="auto-sort-bench">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-black text-white">{isHi ? 'स्वचालित छँटाई' : 'Sort with the camera deciding'}</h2>
          <p className="text-xs text-ink-muted mt-1 max-w-xl leading-relaxed">
            {isHi
              ? 'ऊँचाई दें — कैलिपर से या पट्टी से। बाकी कैमरा करता है, जब उसने यह अधिकार अर्जित कर लिया हो।'
              : 'Give it the height — from a caliper that types, or the strip read by eye. When the camera has earned it on this shop\'s own springs, everything else is recorded with no tap. When it has not, or sees a fault, it asks.'}
          </p>
        </div>
        <button type="button" onClick={() => setOn((v) => !v)} data-testid="auto-bench-toggle"
          className={`px-4 py-2 rounded-control font-bold text-sm ${on ? 'bg-bad text-bad-ink' : 'bg-sky-600 text-white'}`}>
          {on ? (isHi ? 'बंद' : 'Stop') : (isHi ? 'शुरू' : 'Start')}
        </button>
      </header>

      {problem && <p className="text-xs font-bold text-bad-ink bg-raised border border-line rounded-control p-3">{problem}</p>}

      {/* Whether it may decide at all today, per head, in one line each. */}
      <div className="rounded-control border border-line bg-raised p-3 text-[11px] font-mono" data-testid="auto-bench-permit">
        <p className={`font-bold ${allowed ? 'text-good-ink' : 'text-ink-muted'}`}>
          {!master
            ? (isHi ? 'सर्वर पर बंद' : 'Auto-commit switched off in the server configuration.')
            : allowed
              ? (isHi ? 'कैमरा तय कर सकता है' : 'The camera may decide: every head at 95%+ and inspectors agreeing.')
              : (isHi ? 'अभी पूछेगा' : 'It will ask on every spring until every head has earned it:')}
        </p>
        {master && !allowed && (
          <ul className="mt-1 space-y-0.5 text-ink-muted">
            {earned.map((e) => (
              <li key={e.head}>
                {e.head.toLowerCase().padEnd(9)} {e.verdict === 'ASSIST' ? '95%+ ✓' : `${e.verdict.replace('_', ' ').toLowerCase()} (${e.answered} scored)`}
                {' · '}
                {live?.[e.head]?.rate == null ? `${live?.[e.head]?.sampled ?? 0}/30 recent` : `${Math.round((live[e.head]!.rate ?? 0) * 100)}% kept`}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <div className="relative rounded-control overflow-hidden bg-page border border-line aspect-video">
            <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
            {!on && <p className="absolute inset-0 grid place-items-center text-xs text-ink-muted">{isHi ? 'कैमरा बंद' : 'Camera is off'}</p>}
          </div>
          <label className="block">
            <span className="text-[11px] font-mono uppercase tracking-wide text-ink-muted">
              {isHi ? 'ऊँचाई (मिमी) — Enter' : 'Free height, mm — then Enter'}
              <span className="ml-2 text-sky-400" data-testid="auto-bench-expecting">
                · {isHi ? 'अपेक्षित' : 'expecting'} {expectedPosition.replace(/_/g, ' ').toLowerCase()}
              </span>
            </span>
            <input
              ref={heightRef}
              type="number" inputMode="decimal" step="0.1"
              value={height}
              onChange={(e) => setHeight(e.target.value)}
              onKeyDown={onHeightKey}
              disabled={!ready || busy}
              data-testid="auto-bench-height"
              placeholder="e.g. 258.4"
              className="mt-1 w-full text-3xl font-black bg-page border border-line rounded-control px-3 py-3 text-white tabular-nums disabled:opacity-40"
            />
            <span className="text-[10.5px] text-ink-muted block mt-1 leading-snug">
              {isHi
                ? 'कीबोर्ड-वेज कैलिपर यहाँ सीधे टाइप करता है।'
                : 'A keyboard-wedge caliper types straight into this box — no typing, no tap. Otherwise read the strip and type it.'}
            </span>
          </label>
        </div>

        <div className="space-y-3">
          {/* The bin — the only thing the inspector needs to see when it auto-commits. */}
          {bin && (
            <div className={`rounded-control border p-4 ${bin.tone === 'good' ? 'border-good bg-good/10' : 'border-bad bg-bad/10'}`} data-testid="auto-bench-bin">
              <p className="text-[11px] font-mono uppercase tracking-wide text-ink-muted">{isHi ? 'रखें' : 'Put it in'}</p>
              <p className="text-3xl font-black text-white leading-none mt-1">{bin.label}</p>
            </div>
          )}

          {/* Why, whichever way it went. */}
          {decision && (
            <div className="rounded-control border border-line bg-raised p-3" data-testid="auto-bench-decision">
              <p className={`text-xs font-bold ${decision.mode === 'AUTO' ? 'text-good-ink' : 'text-white'}`}>
                {decision.mode === 'AUTO' ? (isHi ? 'दर्ज — बिना टैप' : 'Recorded — no tap.') : (isHi ? 'पूछ रहा है' : 'Asking.')}
              </p>
              <p className="text-xs text-ink-body mt-1 leading-relaxed">{decision.reason}</p>
            </div>
          )}

          {/* When it asks: its answers pre-selected, one tap to agree, one to correct. */}
          {decision?.mode === 'ASK' && (
            <div className="space-y-2" data-testid="auto-bench-ask">
              {HEADS.map((head) => {
                const labels = Array.from(new Set([...SUGGESTED_LABELS[head], ...Object.keys(brainRef.current.counts(head))]));
                return (
                  <div key={head}>
                    <p className="text-[11px] font-mono uppercase tracking-wide text-ink-muted mb-1">{head.toLowerCase()}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {labels.map((l) => (
                        <button key={l} type="button" onClick={() => setChosen((c) => ({ ...c, [head]: l }))}
                          data-testid={`auto-bench-${head}-${l}`}
                          className={`px-2.5 py-1.5 rounded-control text-xs font-bold border ${chosen[head] === l ? 'border-sky-500 bg-sky-600/20 text-white' : 'border-line text-ink-body'}`}>
                          {l.replace(/_/g, ' ')}{proposals[head]?.label === l ? ' ·' : ''}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
              <button type="button" onClick={confirm} disabled={busy || !positionFor(chosen.CATEGORY)} data-testid="auto-bench-confirm"
                className="w-full py-3 rounded-control bg-sky-600 font-bold text-sm text-white disabled:opacity-40">
                {isHi ? 'दर्ज करें' : 'Record'}
              </button>
            </div>
          )}

          <p className="text-[11px] font-mono text-ink-muted" data-testid="auto-bench-tally">
            {isHi ? 'इस सत्र में' : 'This session'}: {tally.auto} {isHi ? 'बिना टैप' : 'without a tap'} · {tally.asked} {isHi ? 'पूछे' : 'asked'}
          </p>
        </div>
      </div>
    </section>
  );
}
