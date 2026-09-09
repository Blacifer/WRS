/**
 * Teach the camera
 * Indian Railways WRS Raipur
 *
 * Point it at a spring. It says what it thinks, or says it does not know. The
 * inspector taps the right answer, and it remembers. It is doing something
 * useful by about the twentieth spring and better every day after that.
 *
 * WHY THIS SCREEN EXISTS AT ALL, RATHER THAN A HIDDEN BACKGROUND PROCESS
 * ---------------------------------------------------------------------
 * The claim being made about this application is that it learns. A claim like
 * that is worth nothing said and everything shown, so this screen is built to
 * be watched: what it currently believes, how sure it is, which photographs
 * made it think so, and how often it has been right lately — all visible while
 * it happens, to whoever is standing there.
 *
 * It also has to be able to be wrong in public. There is no smoothing here, no
 * quietly suppressed low score, and a fresh installation says plainly that it
 * knows nothing. A demonstration that only works when it is going well is a
 * demonstration nobody should believe.
 *
 * WHAT IT WILL NOT DO
 * -------------------
 * It never records a verdict. The tap is the record; the camera's opinion is
 * an opinion, and every one of them is stored next to what the person actually
 * chose so the two can be compared later by somebody sceptical.
 *
 * And there is no band here. Bands are 2 to 3mm apart on a spring 245 to 290mm
 * tall and a photograph carries no scale, so this technique — which measures
 * how alike two pictures look — would be confident and wrong. Bands come from
 * the strip or the caliper. See the note in visionBrain.ts.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  VisionBrain,
  BRAIN_HEADS,
  HEAD_QUESTION,
  SUGGESTED_LABELS,
  VERDICT_MEANING,
  USEFUL_PER_LABEL,
  decodeEmbedding,
  encodeEmbedding,
  flushUnsent,
  readUnsent,
  rememberUnsent,
  readFrame,
  type BrainAccuracy,
  type BrainHead,
  type Proposal
} from '../services/visionBrain.ts';
import { api } from '../services/api.ts';

interface Props {
  lang: 'en' | 'hi';
  /** Springs at the sorting bench; wagon parts everywhere else. */
  domain?: 'SPRING' | 'WAGON_PART';
}

/** Only the heads that make sense for a spring on a sorting bench. */
const SPRING_HEADS: BrainHead[] = ['CATEGORY', 'SURFACE', 'DAMAGE'];

/**
 * A 96-pixel JPEG of the crop — roughly 3 KB.
 *
 * Small on purpose. The whole argument for storing embeddings rather than
 * photographs is that a shop's worth of them fits inside the database the
 * weekly backup already carries; a full-size frame per example would undo
 * that. This is just large enough to recognise a spring by eye, which is all
 * it has to be: it exists so an inspector defending a condemnation can be
 * shown the actual pictures that produced the camera's answer.
 */
function thumbnailOf(crop: HTMLCanvasElement): string | null {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 96;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(crop, 0, 0, 96, 96);
    return c.toDataURL('image/jpeg', 0.6);
  } catch {
    // A tainted canvas or no 2d context. The teaching is still worth keeping.
    return null;
  }
}

export default function TeachTheCamera({ lang, domain = 'SPRING' }: Props) {
  const isHi = lang === 'hi';
  const heads = domain === 'SPRING' ? SPRING_HEADS : (BRAIN_HEADS as BrainHead[]);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const brainRef = useRef(new VisionBrain());
  const lastRef = useRef<{
    embedding: Float32Array;
    proposals: Record<string, Proposal>;
    /** A small JPEG of the crop, kept so an answer can be shown, not just stated. */
    thumbnail: string | null;
  } | null>(null);

  const [on, setOn] = useState(false);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [head, setHead] = useState<BrainHead>(heads[0]);
  const [proposals, setProposals] = useState<Record<string, Proposal>>({});
  const [accuracy, setAccuracy] = useState<Record<string, BrainAccuracy>>({});
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [justTaught, setJustTaught] = useState<string | null>(null);
  const [shot, setShot] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<'DETECTOR' | 'CENTRE' | null>(null);
  const [unsent, setUnsent] = useState(0);
  const [readMs, setReadMs] = useState<number | null>(null);

  const refreshStats = useCallback(() => {
    const acc: Record<string, BrainAccuracy> = {};
    const cnt: Record<string, number> = {};
    for (const h of heads) {
      acc[h] = brainRef.current.evaluate(h);
      cnt[h] = brainRef.current.examples(h).length;
    }
    setAccuracy(acc);
    setCounts(cnt);
  }, [heads]);

  // -- what it already knows, from the server -------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        /*
         * Anything taught while the network was away goes first, so the
         * examples that come back below already include it and the counts on
         * screen are not briefly wrong.
         */
        await flushUnsent((t) =>
          api
            .teachVisionBrain({
              domain: t.domain,
              head: t.head,
              label: t.label,
              embedding: t.embedding,
              proposedLabel: t.proposedLabel,
              confidence: t.confidence
            })
            .then(() => undefined)
        );

        const res = await api.getVisionBrain(domain);
        if (cancelled) return;
        const brain = new VisionBrain();
        for (const e of res.data.examples) {
          brain.remember({
            id: e.id,
            domain,
            head: e.head,
            label: e.label,
            embedding: decodeEmbedding(e.embedding),
            sourceImageId: e.sourceImageId,
            partName: e.partName,
            taughtBy: e.taughtBy,
            createdAt: e.createdAt
          });
        }
        brainRef.current = brain;
        refreshStats();
      } catch {
        /*
         * Offline, or the server is unreachable. The camera still works and
         * still teaches — the examples go up when the queue drains. Silence
         * rather than an error, because this is the ordinary case in a shed.
         */
      } finally {
        if (!cancelled) {
          setUnsent(readUnsent().length);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [domain, refreshStats]);

  // -- the camera -----------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    const stop = () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setReady(false);
    };
    if (!on) {
      stop();
      return;
    }
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error(
            isHi ? 'यह ब्राउज़र कैमरा नहीं दे सकता।' : 'This browser cannot open a camera.'
          );
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
          audio: false
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setReady(true);
        setProblem(null);
      } catch (err: any) {
        setProblem(
          err?.name === 'NotAllowedError'
            ? isHi
              ? 'कैमरा अनुमति नहीं मिली।'
              : 'Camera permission was refused. Everything else carries on normally.'
            : err?.message || 'The camera could not be opened.'
        );
        setReady(false);
      }
    })();
    return () => {
      cancelled = true;
      stop();
    };
  }, [on, isHi]);

  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  /** Look at what is in front of the lens, and say what it thinks. */
  const look = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !ready || !video.videoWidth) return;
    setBusy(true);
    setJustTaught(null);
    try {
      const started = performance.now();
      const { embedding, crop, strategy: used } = await readFrame(video);
      setReadMs(Math.round(performance.now() - started));
      setStrategy(used);
      const next: Record<string, Proposal> = {};
      for (const h of heads) next[h] = brainRef.current.predict(h, embedding);
      lastRef.current = { embedding, proposals: next, thumbnail: thumbnailOf(crop) };
      setProposals(next);
      setShot(crop.toDataURL('image/jpeg', 0.7));
    } catch (err: any) {
      setProblem(err?.message || 'Could not read the frame.');
    } finally {
      setBusy(false);
    }
  }, [ready, heads]);

  /**
   * The inspector's answer — which is the record, and the lesson.
   *
   * Remembered locally first so the next spring benefits immediately even if
   * the server is unreachable, then sent. A failed send loses one example, not
   * the tap, and never blocks the bench.
   */
  const teach = useCallback(
    async (label: string) => {
      const last = lastRef.current;
      if (!last) return;
      const proposed = last.proposals[head]?.label ?? null;
      const confidence = last.proposals[head]?.confidence ?? null;

      const localId = `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      brainRef.current.remember({
        id: localId,
        domain,
        head,
        label,
        embedding: last.embedding
      });
      refreshStats();
      setJustTaught(
        proposed && proposed !== label
          ? isHi
            ? `सुधारा गया: ${proposed} → ${label}`
            : `Corrected: it said ${proposed}, you said ${label}. It will weigh this one heavily.`
          : isHi
          ? `सीखा: ${label}`
          : `Learned: ${label}. That takes effect on the very next spring.`
      );

      try {
        await api.teachVisionBrain({
          domain,
          head,
          label,
          embedding: encodeEmbedding(last.embedding),
          thumbnail: last.thumbnail,
          proposedLabel: proposed,
          confidence
        });
      } catch {
        /*
         * The bench does not stop for the network — but the tap is the only
         * thing here a person actually did, so it is kept and sent on the next
         * load rather than quietly lost.
         */
        rememberUnsent({
          domain,
          head,
          label,
          embedding: encodeEmbedding(last.embedding),
          proposedLabel: proposed,
          confidence,
          at: new Date().toISOString()
        });
        setUnsent(readUnsent().length);
      }

      // Immediately re-judge the same frame, so the effect of the correction
      // is visible rather than asserted.
      const next: Record<string, Proposal> = {};
      for (const h of heads) next[h] = brainRef.current.predict(h, last.embedding);
      lastRef.current = { ...last, proposals: next };
      setProposals(next);
    },
    [head, domain, heads, isHi, refreshStats]
  );

  const acc = accuracy[head];
  const labelsSeen = Object.keys(brainRef.current.counts(head));
  const labels = Array.from(new Set([...SUGGESTED_LABELS[head], ...labelsSeen]));
  const p = proposals[head];
  const thinnest = brainRef.current.thinnestClass(head);

  return (
    <section className="bg-card border border-line rounded-card p-6 space-y-4" data-testid="teach-the-camera">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-black text-white">
            {isHi ? 'कैमरे को सिखाएँ' : 'Teach the camera'}
          </h2>
          <p className="text-xs text-ink-muted mt-1 max-w-xl leading-relaxed">
            {isHi
              ? 'कैमरा दिखाएँ, सही उत्तर दबाएँ। यह याद रखता है और अगली स्प्रिंग पर बेहतर होता है।'
              : 'Show it a spring and tap the right answer. It remembers, and the next spring is judged against everything it has been shown. It runs on this machine with no internet, and it never records a verdict — your tap does.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOn((v) => !v)}
          data-testid="teach-camera-toggle"
          className={`px-4 py-2 rounded-control font-bold text-sm ${
            on ? 'bg-bad text-bad-ink' : 'bg-sky-600 text-white'
          }`}
        >
          {on ? (isHi ? 'कैमरा बंद' : 'Stop camera') : isHi ? 'कैमरा चालू' : 'Start camera'}
        </button>
      </header>

      {problem && (
        <p className="text-xs font-bold text-bad-ink bg-raised border border-line rounded-control p-3">
          {problem}
        </p>
      )}

      {/* Which question is being taught right now. */}
      <div className="flex gap-2 flex-wrap">
        {heads.map((h) => (
          <button
            key={h}
            type="button"
            onClick={() => setHead(h)}
            data-testid={`teach-head-${h}`}
            className={`px-3 py-1.5 rounded-control text-xs font-bold border ${
              h === head ? 'bg-sky-600 text-white border-sky-600' : 'border-line text-ink-body'
            }`}
          >
            {HEAD_QUESTION[h]}
            <span className="ml-2 font-mono opacity-70">{counts[h] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <div className="relative rounded-control overflow-hidden bg-page border border-line aspect-video">
            <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
            {!on && (
              <p className="absolute inset-0 grid place-items-center text-xs text-ink-muted">
                {isHi ? 'कैमरा बंद है' : 'Camera is off'}
              </p>
            )}
          </div>
          <button
            type="button"
            disabled={!ready || busy}
            onClick={look}
            data-testid="teach-camera-look"
            className="w-full py-3 rounded-control bg-raised border border-line font-bold text-sm text-white disabled:opacity-40"
          >
            {busy
              ? isHi
                ? 'देख रहा है…'
                : 'Looking…'
              : isHi
              ? 'यह क्या है?'
              : 'What is this?'}
          </button>
          {shot && (
            <figure className="space-y-1">
              <img src={shot} alt="" className="rounded-control border border-line w-full" />
              <figcaption className="text-[11px] text-ink-muted leading-snug">
                {isHi
                  ? 'यही हिस्सा देखा गया।'
                  : strategy === 'DETECTOR'
                  ? 'What it actually looked at. People and clutter were found and cut away first — that is why twenty examples is enough instead of two hundred.'
                  : 'What it actually looked at — the middle of the frame. This machine was too slow to run the clutter detector at the bench, so hold the part up against a plain background where you can.'}
                {readMs !== null && (
                  <span className="font-mono"> · {readMs} ms</span>
                )}
              </figcaption>
            </figure>
          )}
        </div>

        <div className="space-y-3">
          {/* What it thinks, including when that is nothing. */}
          <div className="rounded-control border border-line bg-raised p-4 min-h-[104px]">
            {!p ? (
              <p className="text-sm text-ink-muted">
                {isHi ? 'अभी कुछ नहीं देखा।' : 'Nothing looked at yet.'}
              </p>
            ) : p.label ? (
              <>
                <p className="text-[11px] font-mono uppercase tracking-wide text-ink-muted">
                  {isHi ? 'इसे लगता है' : 'It thinks'}
                </p>
                <p className="text-3xl font-black text-white leading-none mt-1" data-testid="teach-proposal">
                  {p.label}
                </p>
                <p className="text-xs text-ink-body mt-2">
                  {isHi ? 'निश्चितता' : 'Confidence'}{' '}
                  <span className="font-mono font-bold">{Math.round(p.confidence * 100)}%</span>
                  {' · '}
                  {isHi
                    ? `${p.neighbours.length} मिलती-जुलती तस्वीरों से`
                    : `from ${p.neighbours.length} similar photographs it was shown`}
                </p>
              </>
            ) : (
              <>
                <p className="text-lg font-black text-white" data-testid="teach-proposal">
                  {isHi ? 'पता नहीं' : 'I do not know'}
                </p>
                <p className="text-xs text-ink-body mt-1 leading-relaxed">{p.reason}</p>
              </>
            )}
          </div>

          {/* The answer. This is what gets recorded and what gets learned. */}
          <div>
            <p className="text-[11px] font-mono uppercase tracking-wide text-ink-muted mb-1.5">
              {isHi ? 'सही उत्तर दबाएँ' : 'Tap the right answer'}
            </p>
            <div className="flex flex-wrap gap-2">
              {labels.map((l) => (
                <button
                  key={l}
                  type="button"
                  disabled={!lastRef.current}
                  onClick={() => teach(l)}
                  data-testid={`teach-label-${l}`}
                  className={`px-3 py-2 rounded-control text-sm font-bold border disabled:opacity-30 ${
                    p?.label === l
                      ? 'border-sky-500 bg-sky-600/20 text-white'
                      : 'border-line text-ink-body'
                  }`}
                >
                  {l.replace(/_/g, ' ')}
                  <span className="ml-2 font-mono text-[11px] opacity-60">
                    {brainRef.current.counts(head)[l] ?? 0}
                  </span>
                </button>
              ))}
            </div>
            {unsent > 0 && (
              <p className="text-[11px] text-ink-muted mt-2" data-testid="teach-unsent">
                {isHi
                  ? `${unsent} अभी तक भेजे नहीं गए।`
                  : `${unsent} taught while the network was away. They are kept here and sent when it comes back — nothing has been lost.`}
              </p>
            )}
            {justTaught && (
              <p className="text-xs font-bold text-good-ink mt-2" data-testid="teach-feedback">
                {justTaught}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* How well it is doing, scored against photographs it was not taught from. */}
      <div className="rounded-control border border-line bg-raised p-4 space-y-1.5" data-testid="teach-accuracy">
        {loading ? (
          <p className="text-sm text-ink-muted">{isHi ? 'लोड हो रहा है…' : 'Loading what it knows…'}</p>
        ) : !acc || acc.taught === 0 ? (
          <>
            <p className="text-sm font-bold text-white">
              {isHi ? 'यह अभी कुछ नहीं जानता।' : 'It knows nothing yet.'}
            </p>
            <p className="text-xs text-ink-body leading-relaxed">
              {isHi
                ? `हर श्रेणी की लगभग ${USEFUL_PER_LABEL} तस्वीरें इसे उपयोगी बनाती हैं।`
                : `About ${USEFUL_PER_LABEL} photographs of each kind is where it starts being useful. Nothing is pre-loaded and nothing is assumed — everything below is what this shop has shown it.`}
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-bold text-white">
              {acc.answered === 0
                ? isHi
                  ? 'अभी अंक देना जल्दी है।'
                  : 'Too early to score it.'
                : isHi
                ? `${acc.correct}/${acc.answered} सही (${Math.round(acc.accuracy * 100)}%)`
                : `${acc.correct} of ${acc.answered} right — ${Math.round(acc.accuracy * 100)}%`}
            </p>
            <p className="text-xs text-ink-body leading-relaxed">
              {isHi
                ? 'हर तस्वीर को छिपाकर बाकी से पूछा गया।'
                : 'Scored by hiding each photograph in turn and asking the rest what it was, so nothing is graded against itself.'}
              {acc.abstained > 0 &&
                (isHi
                  ? ` ${acc.abstained} पर इसने कहा कि पता नहीं।`
                  : ` It said "I do not know" on ${acc.abstained}, which is counted apart from being wrong.`)}
            </p>
            <p className="text-xs font-bold text-ink-body pt-1">{VERDICT_MEANING[acc.verdict]}</p>
            {thinnest && (
              <p className="text-[11px] font-mono text-ink-muted pt-1">
                {isHi ? 'सबसे कम: ' : 'Thinnest class: '}
                {thinnest.label} × {thinnest.count}
                {thinnest.count < USEFUL_PER_LABEL &&
                  (isHi
                    ? ` (${USEFUL_PER_LABEL} तक ले जाएँ)`
                    : ` — take this one to ${USEFUL_PER_LABEL}; the total is not the number that matters.`)}
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
