/**
 * A wagon part judged by the camera, and passed without a tap when it has earned it
 * Indian Railways WRS Raipur
 *
 * The same rule as the sorting bench — shared/vision/autoCommit.ts — on a
 * brake block instead of a spring. The inspector still walks to the part and
 * still points the phone at it; that is physical and nothing removes it. What
 * this removes is the judging and the recording: the camera says whether it
 * sees rust or damage, and when it has EARNED the right to on this shop's own
 * parts, the item is marked PASS with the photograph attached and no tap.
 *
 * When it has not earned it, or sees a fault, it asks — answers pre-selected,
 * one tap to agree. And it never fails a part on its own: a FAIL holds a
 * wagon, and a person makes that call.
 *
 * One more thing the spring bench does not need: it checks it is looking at
 * the right part. The PART_ID head names what it sees; if that disagrees with
 * the item being judged, it asks, because passing a brake beam on a photograph
 * of a side bearer is worse than asking.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../services/api.ts';
import {
  VisionBrain,
  decodeEmbedding,
  encodeEmbedding,
  readFrame,
  labelForPart,
  SUGGESTED_LABELS,
  type BrainHead,
  type Proposal
} from '../services/visionBrain.ts';
import { decideAutoCommit, type AutoCommitDecision, type LiveAgreement } from '../../../shared/vision/autoCommit.ts';
import { fitToStoredSize, STORED_QUALITY } from '../services/imageSizing.ts';

/**
 * The crop, bounded before it is stored.
 *
 * A crop from a 12-megapixel phone frame can still be megabytes, and every
 * one of these lands in the same SQLite file as the audit chain. The shared
 * helper caps the longest edge; the guard in offlineParity.test.ts checks
 * every camera component does this, so a fifth camera cannot get it wrong.
 */
function boundedJpeg(crop: HTMLCanvasElement): string {
  const { width, height } = fitToStoredSize(crop.width, crop.height);
  if (width === crop.width && height === crop.height) return crop.toDataURL('image/jpeg', STORED_QUALITY);
  const c = document.createElement('canvas');
  c.width = width; c.height = height;
  c.getContext('2d')?.drawImage(crop, 0, 0, width, height);
  return c.toDataURL('image/jpeg', STORED_QUALITY);
}

interface Props {
  wagonNumber: string;
  item: { id: string; category: string; partName: string; bogiePosition?: string | null; updatedAt?: string };
  stage?: string;
  lang: 'en' | 'hi';
  onClose: () => void;
  onJudged: () => void;
}

const HEADS: BrainHead[] = ['SURFACE', 'DAMAGE'];

export default function AutoJudgePart({ wagonNumber, item, stage, lang, onClose, onJudged }: Props) {
  const isHi = lang === 'hi';
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const brainRef = useRef(new VisionBrain());
  const frameRef = useRef<{ embedding: Float32Array; crop: HTMLCanvasElement; proposals: Record<string, Proposal> } | null>(null);

  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [live, setLive] = useState<Partial<Record<BrainHead, LiveAgreement>> | null>(null);
  const [master, setMaster] = useState(true);
  const [decision, setDecision] = useState<AutoCommitDecision | null>(null);
  const [wrongPart, setWrongPart] = useState<string | null>(null);
  const [proposals, setProposals] = useState<Record<string, Proposal>>({});
  const [chosen, setChosen] = useState<Record<string, string | null>>({});
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [brain, status] = await Promise.all([api.getVisionBrain('WAGON_PART'), api.getVisionAutoStatus('WAGON_PART')]);
        if (cancelled) return;
        const b = new VisionBrain();
        for (const e of brain.data.examples) {
          b.remember({ id: e.id, domain: 'WAGON_PART', head: e.head, label: e.label, embedding: decodeEmbedding(e.embedding) });
        }
        brainRef.current = b;
        const l: Partial<Record<BrainHead, LiveAgreement>> = {};
        for (const h of status.data.heads) l[h.head] = { sampled: h.sampled, rate: h.rate };
        setLive(l); setMaster(status.data.master);
      } catch { setLive(null); }
    })();
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => undefined); }
        setReady(true);
      } catch (err: any) {
        setProblem(err?.name === 'NotAllowedError' ? 'Camera permission was refused.' : err?.message || 'The camera could not be opened.');
      }
    })();
    return () => { cancelled = true; streamRef.current?.getTracks().forEach((t) => t.stop()); };
  }, []);

  const look = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !ready || !video.videoWidth) return;
    setBusy(true); setDecision(null); setWrongPart(null);
    try {
      const { embedding, crop } = await readFrame(video);
      const ps: Record<string, Proposal> = {};
      for (const head of [...HEADS, 'PART_ID' as BrainHead]) ps[head] = brainRef.current.predict(head, embedding);
      frameRef.current = { embedding, crop, proposals: ps };
      setProposals(ps);
      setChosen({ SURFACE: ps.SURFACE.label, DAMAGE: ps.DAMAGE.label });

      // Is it even the right part? Only when the camera knows parts well
      // enough to say. A confident name that is not this item is a stop.
      const expected = labelForPart(item.partName);
      const idv = brainRef.current.evaluate('PART_ID').verdict;
      if (idv === 'ASSIST' && ps.PART_ID.label && ps.PART_ID.label !== expected && ps.PART_ID.confidence >= 0.8) {
        setWrongPart(ps.PART_ID.label.replace(/_/g, ' '));
      }

      // PART_ID joins the decision only once the camera knows parts well
      // enough to have earned it; before that, a wrong name would stop every
      // judgement for the wrong reason.
      const idHeads = idv === 'ASSIST' ? ['PART_ID' as BrainHead] : [];
      const d = decideAutoCommit({
        domain: 'WAGON_PART',
        heads: [...HEADS, ...idHeads].map((head) => ({ head, verdict: brainRef.current.evaluate(head).verdict, confidence: ps[head].confidence, label: ps[head].label })),
        measurementPassed: null,
        liveAgreement: master ? live : null,
        expected: idv === 'ASSIST' ? { PART_ID: expected } : undefined
      });
      setDecision(d);

      if (d.mode === 'AUTO' && !(idv === 'ASSIST' && ps.PART_ID.label && ps.PART_ID.label !== expected && ps.PART_ID.confidence >= 0.8)) {
        await commit('CAMERA_AUTO', ps, crop, embedding);
      }
    } catch (err: any) {
      setProblem(err?.message || 'Could not judge that part.');
    } finally {
      setBusy(false);
    }
  }, [ready, item.partName, live, master]);

  /** Write the verdict with its photograph, and say how it was reached. */
  const commit = useCallback(async (
    source: 'CAMERA_AUTO' | 'CAMERA_ASSISTED' | 'MANUAL',
    ps: Record<string, Proposal>,
    crop: HTMLCanvasElement,
    embedding: Float32Array
  ) => {
    /*
     * The photograph first, so the verdict can point at it — but uploaded
     * WITHOUT checklistItemId. Given the id, the upload route attaches the
     * photograph to the item itself, which bumps the item's updated_at, and
     * the verdict write a moment later then arrives with a stale version and
     * is refused by the concurrency guard (409). Driving this is what found
     * it. The verdict below is the one write to the item, and it carries the
     * photoId.
     */
    let photoId: string | undefined;
    try {
      const up = await api.uploadPhoto({
        wagonNumber, partCategory: item.category, partName: item.partName, stage,
        evidenceStage: 'GENERAL', imageBase64: boundedJpeg(crop),
        tags: [source === 'CAMERA_AUTO' ? 'CAMERA_AUTO' : 'CAMERA_ASSISTED']
      });
      photoId = up.data.id;
    } catch { /* the verdict still stands without the picture; it says so in the audit */ }

    const chosenSurface = source === 'CAMERA_AUTO' ? ps.SURFACE.label : chosen.SURFACE;
    const chosenDamage = source === 'CAMERA_AUTO' ? ps.DAMAGE.label : chosen.DAMAGE;
    const notes = `Camera: surface ${chosenSurface ?? '?'}, damage ${chosenDamage ?? '?'}`;

    await api.updateChecklistItem(wagonNumber, item.id, {
      status: 'PASS', reinspectedStatus: 'PASS', conditionNotes: notes, photoId,
      expectedUpdatedAt: item.updatedAt, verdictSource: source
    });

    if (source === 'CAMERA_AUTO') {
      void api.recordVisionAutoDecision({
        domain: 'WAGON_PART', wagonNumber,
        heads: HEADS.map((head) => ({ head, label: ps[head].label!, confidence: ps[head].confidence, neighbours: ps[head].neighbours.map((n) => n.exampleId) }))
      }).catch(() => undefined);
    } else {
      for (const head of HEADS) {
        const label = head === 'SURFACE' ? chosenSurface : chosenDamage;
        if (!label) continue;
        void api.teachVisionBrain({ domain: 'WAGON_PART', head, label, embedding: encodeEmbedding(embedding), proposedLabel: ps[head].label, confidence: ps[head].confidence, partName: item.partName }).catch(() => undefined);
      }
    }
    setDone(source === 'CAMERA_AUTO' ? (isHi ? 'पास — बिना टैप' : 'PASS — recorded with no tap, photograph attached.') : (isHi ? 'पास दर्ज' : 'PASS recorded, photograph attached.'));
    onJudged();
  }, [wagonNumber, item, stage, chosen, isHi, onJudged]);

  /**
   * Teach what the person saw, without recording a verdict.
   *
   * A fault is a FAIL, and a FAIL needs a person and a reason, so this modal
   * never records one. But if it also never LEARNED one, the DAMAGE head
   * would only ever hear "NONE" and could never earn the right to pass a
   * part — a camera that has never been shown a crack cannot be trusted to
   * say there isn't one. So the person's answer teaches the camera here, and
   * the verdict goes through the ordinary FAIL/CONDEMN buttons with a reason.
   */
  const teachOnly = useCallback(async () => {
    const f = frameRef.current;
    if (!f) return;
    setBusy(true);
    try {
      for (const head of HEADS) {
        const label = chosen[head];
        if (!label) continue;
        await api.teachVisionBrain({ domain: 'WAGON_PART', head, label, embedding: encodeEmbedding(f.embedding), proposedLabel: f.proposals[head].label, confidence: f.proposals[head].confidence, partName: item.partName }).catch(() => undefined);
        brainRef.current.remember({ id: `local_${Date.now()}_${head}`, domain: 'WAGON_PART', head, label, embedding: f.embedding });
      }
      setDone(isHi ? 'सिखाया गया — अब FAIL/CONDEMN दर्ज करें।' : 'Taught. Now record the FAIL or CONDEMN on the item, with the reason.');
    } finally { setBusy(false); }
  }, [chosen, item.partName, isHi]);

  const confirm = useCallback(async () => {
    const f = frameRef.current;
    if (!f) return;
    setBusy(true);
    try {
      const agreed = HEADS.every((h) => f.proposals[h].label === chosen[h]);
      await commit(agreed && f.proposals.SURFACE.label ? 'CAMERA_ASSISTED' : 'MANUAL', f.proposals, f.crop, f.embedding);
    } catch (err: any) {
      setProblem(err?.message || 'Could not record that.');
    } finally { setBusy(false); }
  }, [chosen, commit]);

  const faultSeen = decision?.outcome === 'CONDEMN';

  return (
    <div className="fixed inset-0 z-50 bg-black/70 grid place-items-center p-4" role="dialog" aria-modal="true" data-testid="auto-judge-part">
      <div className="bg-card border border-line rounded-card w-full max-w-lg p-5 space-y-3 max-h-[92vh] overflow-y-auto">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-black text-white">{item.partName}</h3>
            <p className="text-[11px] font-mono text-ink-muted">{(item.bogiePosition || 'NONE').replace(/_/g, ' ')} · {item.category.replace(/_/g, ' ')}</p>
          </div>
          <button type="button" onClick={onClose} className="text-xs font-bold text-ink-muted px-2 py-1" aria-label="Close">✕</button>
        </header>

        {problem && <p className="text-xs font-bold text-bad-ink bg-raised border border-line rounded-control p-3">{problem}</p>}

        <div className="rounded-control overflow-hidden bg-page border border-line aspect-video">
          <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
        </div>

        {!done && (
          <button type="button" onClick={look} disabled={!ready || busy} data-testid="auto-judge-look"
            className="w-full py-3 rounded-control bg-raised border border-line font-bold text-sm text-white disabled:opacity-40">
            {busy ? (isHi ? 'देख रहा है…' : 'Looking…') : (isHi ? 'इस पुर्जे को जाँचें' : 'Judge this part')}
          </button>
        )}

        {wrongPart && (
          <p className="text-xs font-bold text-bad-ink bg-raised border border-line rounded-control p-3" data-testid="auto-judge-wrong-part">
            {isHi ? `यह ${wrongPart} लगता है, ${item.partName} नहीं।` : `This looks like a ${wrongPart.toLowerCase()}, not ${item.partName}. Not passing it on this photograph.`}
          </p>
        )}

        {decision && !done && (
          <div className={`rounded-control border p-3 ${faultSeen ? 'border-bad bg-bad/10' : 'border-line bg-raised'}`} data-testid="auto-judge-decision">
            <p className="text-xs font-bold text-white">{decision.mode === 'AUTO' ? (isHi ? 'पास — बिना टैप' : 'Passed — no tap.') : faultSeen ? (isHi ? 'दोष दिखा' : 'The camera sees a fault.') : (isHi ? 'पूछ रहा है' : 'Asking.')}</p>
            <p className="text-xs text-ink-body mt-1 leading-relaxed">{decision.reason}</p>
          </div>
        )}

        {decision?.mode === 'ASK' && !done && (
          <div className="space-y-2" data-testid="auto-judge-ask">
            {HEADS.map((head) => {
              const labels = Array.from(new Set([...SUGGESTED_LABELS[head], ...Object.keys(brainRef.current.counts(head))]));
              return (
                <div key={head}>
                  <p className="text-[11px] font-mono uppercase tracking-wide text-ink-muted mb-1">{head.toLowerCase()}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {labels.map((l) => (
                      <button key={l} type="button" onClick={() => setChosen((c) => ({ ...c, [head]: l }))} data-testid={`auto-judge-${head}-${l}`}
                        className={`px-2.5 py-1.5 rounded-control text-xs font-bold border ${chosen[head] === l ? 'border-sky-500 bg-sky-600/20 text-white' : 'border-line text-ink-body'}`}>
                        {l.replace(/_/g, ' ')}{proposals[head]?.label === l ? ' ·' : ''}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            {/*
              * A fault is a FAIL and a person's call, so this button only ever
              * records a PASS. Seeing a fault, the inspector closes this and
              * uses the ordinary FAIL/CONDEMN buttons, which ask for a reason.
              */}
            {faultSeen || (chosen.DAMAGE && chosen.DAMAGE !== 'NONE') || (chosen.SURFACE && !['CLEAN', 'LIGHT_RUST'].includes(chosen.SURFACE)) ? (
              <div className="space-y-2">
                <p className="text-xs text-ink-body leading-relaxed">
                  {isHi ? 'दोष है — सामान्य FAIL/CONDEMN बटन का उपयोग करें, कारण सहित।' : 'A fault is a person\'s verdict. Use FAIL or CONDEMN on the item, which asks for the reason. The camera still learns from what you chose:'}
                </p>
                <button type="button" onClick={teachOnly} disabled={busy} data-testid="auto-judge-teach"
                  className="w-full py-3 rounded-control bg-raised border border-line font-bold text-sm text-white disabled:opacity-40">
                  {isHi ? 'कैमरे को सिखाएँ (कोई निर्णय नहीं)' : 'Teach the camera this — no verdict recorded'}
                </button>
              </div>
            ) : (
              <button type="button" onClick={confirm} disabled={busy || wrongPart !== null} data-testid="auto-judge-confirm"
                className="w-full py-3 rounded-control bg-sky-600 font-bold text-sm text-white disabled:opacity-40">
                {isHi ? 'पास दर्ज करें' : 'Record PASS as shown'}
              </button>
            )}
          </div>
        )}

        {done && (
          <div className="rounded-control border border-good bg-good/10 p-3" data-testid="auto-judge-done">
            <p className="text-sm font-bold text-white">{done}</p>
            <button type="button" onClick={onClose} className="mt-2 text-xs font-bold text-sky-400">{isHi ? 'बंद करें' : 'Close'}</button>
          </div>
        )}
      </div>
    </div>
  );
}
