/**
 * The camera that learns what this shop's parts look like
 * Indian Railways WRS Raipur
 *
 * WHAT THIS IS
 * ------------
 * A part is photographed, the inspector taps what it is, and the pair is
 * remembered. The next photograph is compared against everything remembered
 * so far, and the closest matches vote. Twenty examples of a class is enough
 * to start being useful; every tap after that makes it better.
 *
 * WHY THIS SHAPE, AND NOT A TRAINED MODEL
 * ---------------------------------------
 * We spent a long time believing nothing could be built until thousands of
 * photographs existed, because we were picturing a network trained overnight.
 * That is one kind of model, not the only one. This is the other kind:
 *
 *   photograph -> MobileNet -> 1280 numbers -> nearest neighbours vote
 *
 * MobileNet is a general vision network trained on everyday objects. We throw
 * away its opinions entirely — it has never seen a CASNUB spring and has no
 * class to put one in — and keep only the 1280-value description it forms one
 * layer before deciding. That description is a good general summary of what an
 * image looks like: two photographs of the same kind of part land near each
 * other in those 1280 numbers, and two photographs of different parts do not.
 *
 * So we never train anything. We remember, and we compare. The consequences
 * are the point:
 *
 *   - It works from the twentieth example, not the two-thousandth.
 *   - A correction takes effect on the very next spring, not next month.
 *   - There is no training run to schedule, no GPU, and nothing to export.
 *   - It runs in the browser on the shop's own laptop, with no internet.
 *   - What it knows is a list of remembered examples, so you can point at any
 *     answer and show which photographs produced it. A trained network cannot
 *     do that, and an inspector defending a condemnation needs it to.
 *
 * WHAT IT IS NOT ALLOWED TO DO
 * ----------------------------
 * It does not decide anything. It proposes, a person confirms or corrects, and
 * the person's answer is what is recorded and what is remembered. It also has
 * to be allowed to say it does not know: an answer given confidently and
 * wrongly, in front of the people who have to trust this, is worse than no
 * answer. Both floors below exist for that reason.
 *
 * BANDS ARE NOT IN HERE, DELIBERATELY
 * -----------------------------------
 * There is no BAND head and there must never be one. The G-95 bands are 2 to
 * 3mm apart on a spring 245 to 290mm tall, and a photograph of a spring on its
 * own carries no scale — a small spring near the lens and a large one further
 * away are the same picture. Looking alike is exactly what this technique
 * measures, so it would be confident and wrong. Bands come from the marked
 * strip or from the caliper, and from nowhere else.
 */

import { cropToTarget, detectFrame, loadDetector, type VisionResult } from './objectDetection.ts';

/** Where the weights live. Served by this app, never a third-party CDN. */
export const EMBEDDER_URL = '/models/mobilenet/model.json';

/**
 * The questions the camera is allowed to answer.
 *
 * Kept separate rather than as one combined label because they are genuinely
 * independent — a rusty outer spring and a clean outer spring are the same
 * category — and because they should be able to fail independently. Category
 * will work long before damage does, and it should not be held back by it.
 */
export type { BrainHead, BrainDomain, BrainVerdict } from '../../../shared/vision/types.ts';
export { BRAIN_HEADS, BRAIN_DOMAINS } from '../../../shared/vision/types.ts';
import type { BrainHead, BrainDomain, BrainVerdict } from '../../../shared/vision/types.ts';
import { BRAIN_HEADS } from '../../../shared/vision/types.ts';

export const HEAD_QUESTION: Record<BrainHead, string> = {
  CATEGORY: 'Which kind of spring is this?',
  SURFACE: 'What is the surface condition?',
  DAMAGE: 'Is there visible damage?',
  PART_ID: 'Which part is this?'
};

/** What the app itself asks for. The shop may teach labels beyond these. */
export const SUGGESTED_LABELS: Record<BrainHead, string[]> = {
  CATEGORY: ['OUTER', 'INNER', 'SNUBBER'],
  SURFACE: ['CLEAN', 'LIGHT_RUST', 'HEAVY_RUST', 'SCALING'],
  DAMAGE: ['NONE', 'CRACK', 'BROKEN_COIL', 'DEFORMATION'],
  PART_ID: []
};

import { l2Normalise } from '../../../shared/vision/knn.ts';

/*
 * The judgement itself — the vote among remembered photographs, the floors
 * below which it declines, and the leave-one-out score — lives in
 * shared/vision/knn.ts, because the server now runs the same arithmetic on the
 * same embedding before it will accept a verdict the camera reached alone.
 * Re-exported here so the components that grew up importing it from this file
 * keep working, and so there is still one place in the client to read.
 */
export {
  VisionBrain,
  l2Normalise,
  similarity,
  encodeEmbedding,
  decodeEmbedding,
  gradeAccuracy,
  labelForPart,
  newCaptureGroup,
  SIMILARITY_FLOOR,
  CONFIDENCE_FLOOR,
  K,
  MIN_EXAMPLES,
  MIN_LABELS,
  USEFUL_PER_LABEL,
  TWIN_SIMILARITY,
  MIN_ANSWER_RATE,
  VERDICT_MEANING
} from '../../../shared/vision/knn.ts';
export type { BrainExample, Neighbour, Proposal, BrainAccuracy, HoldOut } from '../../../shared/vision/knn.ts';

// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------

type Embedder = {
  infer: (input: HTMLCanvasElement | HTMLImageElement | HTMLVideoElement, embedding?: boolean) => any;
};

let embedderPromise: Promise<Embedder> | null = null;

/**
 * Load the feature extractor, once per session.
 *
 * Dynamically imported so that the 13 MB of this feature never lands on an
 * inspector who only sorts by hand.
 */
export function loadEmbedder(): Promise<Embedder> {
  if (!embedderPromise) {
    embedderPromise = (async () => {
      const [, mobilenet] = await Promise.all([
        import('@tensorflow/tfjs'),
        import('@tensorflow-models/mobilenet')
      ]);
      return (await mobilenet.load({
        version: 2,
        alpha: 1.0,
        modelUrl: EMBEDDER_URL
      })) as unknown as Embedder;
    })().catch((err) => {
      // Allow a retry rather than caching the failure for the whole session;
      // the usual cause is the first fetch of the weights being interrupted.
      embedderPromise = null;
      throw err;
    });
  }
  return embedderPromise;
}

export function isEmbedderLoaded(): boolean {
  return embedderPromise !== null;
}

/**
 * Turn an image into the 1280 numbers that describe it.
 *
 * The result is scaled to unit length, which means comparing two of them is a
 * single multiply-and-add rather than a distance calculation, and — more
 * usefully — that a brightly lit photograph and a dim one of the same part
 * compare as the same shape rather than as different magnitudes. A shed is not
 * evenly lit and this matters more here than it would in a laboratory.
 */
export async function embed(
  input: HTMLCanvasElement | HTMLImageElement | HTMLVideoElement
): Promise<Float32Array> {
  const model = await loadEmbedder();
  const tensor = model.infer(input, true);
  try {
    const raw = (await tensor.data()) as Float32Array;
    return l2Normalise(raw);
  } finally {
    tensor.dispose?.();
  }
}

// ---------------------------------------------------------------------------
// From a camera frame to a proposal
// ---------------------------------------------------------------------------

export interface FrameReading {
  embedding: Float32Array;
  /** The crop actually looked at, so it can be stored alongside the answer. */
  crop: HTMLCanvasElement;
  vision: VisionResult | null;
  /** Which way the crop was made, so the screen can say so rather than imply. */
  strategy: CropStrategy;
}

/**
 * Cut the part out of the shed before looking at it.
 *
 * This is the step that makes the whole approach work in a real workshop
 * rather than on a bench in good light. A raw frame is mostly floor, pallet,
 * hi-vis jacket and whatever else was behind the part, and those things change
 * between one photograph and the next while the part does not. Compared whole,
 * two photographs of the same spring on different days can easily look less
 * alike than two different springs on the same pallet.
 *
 * `cropToTarget` already removes the people and the clutter COCO-SSD knows how
 * to name, and returns what is left. Reusing it here costs nothing — the
 * detector is already loaded for the sorting bench — and it is why twenty
 * examples is enough instead of two hundred.
 */
/**
 * Whether this machine can afford the clutter detector — decided by timing the
 * one thing that has to run anyway.
 *
 * THE MISTAKE THIS REPLACES, BECAUSE IT IS AN EASY ONE TO MAKE AGAIN
 * The first version of this timed the DETECTOR and dropped it if it was slow.
 * That does not work, and driving it in a browser is what showed why: putting
 * a timeout around a load does not stop the load. On a machine with no usable
 * GPU, COCO-SSD took 233 seconds to come up, and after the 8-second timeout
 * fired it was still churning in the background on the same single thread the
 * embedder now needed. The camera did not fall back gracefully; it went
 * quiet, because the fallback was competing with the thing it replaced.
 *
 * So nothing optional is ever started until the machine has been measured on
 * something compulsory. The embedding has to run for every frame regardless,
 * so the first frame uses a plain centre crop and times that. The detector
 * costs roughly twice an embedding, so an embedding inside the budget below
 * means the pair will land near a second, and anything slower means the
 * detector would never have been affordable and is simply never loaded.
 *
 * The result: the first frame is always fast, and a slow machine never
 * downloads or starts 18 MB it cannot use.
 */
export const EMBED_BUDGET_MS = 450;

export type CropStrategy = 'DETECTOR' | 'CENTRE';

/**
 * Session state, not a preference.
 *
 * null  — not measured yet; this frame decides.
 * false — measured and too slow. The detector is never loaded.
 * true  — measured and affordable.
 */
let detectorViable: boolean | null = null;

/** For tests, and for a machine that has been given a better browser since. */
export function resetDetectorViability(): void {
  detectorViable = null;
}

export function detectorIsBeingUsed(): boolean | null {
  return detectorViable;
}

/**
 * Cut the part out of the shed before looking at it.
 *
 * This is the step that makes the whole approach work in a real workshop
 * rather than on a bench in good light. A raw frame is mostly floor, pallet,
 * hi-vis jacket and whatever else was behind the part, and those things change
 * between one photograph and the next while the part does not. Compared whole,
 * two photographs of the same spring on different days can easily look less
 * alike than two different springs on the same pallet.
 *
 * `cropToTarget` removes the people and the clutter COCO-SSD knows how to
 * name. When the machine can afford it, that is used. When it cannot, a centre
 * crop stands in, on the reasonable assumption that the part being asked about
 * is the thing being held up to the lens — and the screen says which of the
 * two it did, rather than implying the better one.
 */
export async function readFrame(
  input: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement,
  width?: number,
  height?: number
): Promise<FrameReading> {
  // cropToTarget draws from a video or a canvas, so an image is flattened
  // first rather than special-cased inside it.
  const frame: HTMLVideoElement | HTMLCanvasElement =
    input instanceof HTMLImageElement ? toCanvas(input) : input;

  const w = width ?? naturalWidth(frame);
  const h = height ?? naturalHeight(frame);

  let vision: VisionResult | null = null;
  let crop: HTMLCanvasElement | null = null;
  let strategy: CropStrategy = 'CENTRE';

  // Only on a machine already shown to be quick enough, and never on the
  // first frame — that one is what does the showing.
  if (detectorViable === true) {
    try {
      const model = await loadDetector();
      vision = await detectFrame(model, frame, w, h);
      crop = cropToTarget(frame, vision.targetRegion, w, h);
      strategy = 'DETECTOR';
    } catch {
      // Weights missing, or the detector threw. Not worth showing: the camera
      // still works, slightly less well.
      detectorViable = false;
      vision = null;
      crop = null;
    }
  }

  if (!crop) crop = centreCrop(frame, w, h);

  const started = performance.now();
  const embedding = await embed(crop);
  const embedMs = performance.now() - started;

  /*
   * The measurement, taken once, on the frame that had to be embedded anyway.
   * Warm-up is included deliberately: the first frame is the one an inspector
   * actually waits through, so judging the machine on a warmed-up figure would
   * flatter it exactly where it matters least.
   */
  if (detectorViable === null) detectorViable = embedMs <= EMBED_BUDGET_MS;

  return { embedding, crop, vision, strategy };
}

/**
 * The middle of the frame, on the assumption the part is what is being held up.
 *
 * Deliberately not the whole frame. Most of a shed photograph is floor, and
 * including it would let the backdrop dominate the comparison — which is the
 * one failure this whole step exists to prevent.
 */
export function centreCrop(
  frame: HTMLVideoElement | HTMLCanvasElement,
  w: number,
  h: number,
  fraction = 0.72
): HTMLCanvasElement {
  const side = Math.max(1, Math.round(Math.min(w, h) * fraction));
  const sx = Math.max(0, Math.round((w - side) / 2));
  const sy = Math.max(0, Math.round((h - side) / 2));
  const c = document.createElement('canvas');
  c.width = side;
  c.height = side;
  c.getContext('2d')?.drawImage(frame as any, sx, sy, side, side, 0, 0, side, side);
  return c;
}

function naturalWidth(el: HTMLVideoElement | HTMLCanvasElement): number {
  return (el as HTMLVideoElement).videoWidth || (el as HTMLCanvasElement).width || 224;
}

function naturalHeight(el: HTMLVideoElement | HTMLCanvasElement): number {
  return (el as HTMLVideoElement).videoHeight || (el as HTMLCanvasElement).height || 224;
}

function toCanvas(input: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement): HTMLCanvasElement {
  if (input instanceof HTMLCanvasElement) return input;
  const c = document.createElement('canvas');
  c.width = (input as any).videoWidth || (input as any).naturalWidth || (input as any).width || 224;
  c.height = (input as any).videoHeight || (input as any).naturalHeight || (input as any).height || 224;
  c.getContext('2d')?.drawImage(input as any, 0, 0, c.width, c.height);
  return c;
}

// ---------------------------------------------------------------------------
// Teachings that could not be sent
//
// The bench must never stop for the network, so a failed send cannot be an
// error the inspector has to deal with. But swallowing it would quietly lose
// the tap — and a tap is the only thing in this feature a person actually did.
//
// So an unsent teaching is written to this browser's own storage and sent on
// the next load. This is deliberately smaller than the IndexedDB queue that
// carries inspections and photographs: those are records of work and must
// survive anything, whereas a lost teaching costs the camera one example out
// of thousands. It is the same reasoning that queue applies, at the scale this
// actually warrants.
// ---------------------------------------------------------------------------

const UNSENT_PREFIX = 'wrs.vision.unsent.';

/**
 * How many unsent teachings are kept.
 *
 * Sized against the browser's storage, not chosen for roundness. One embedding
 * is 1280 float32 values, which is 6,828 characters of base64 — so 200 of them
 * with their labels is about 1.4 MB, comfortably inside the ~5 MB a browser
 * gives an origin. Five hundred would be 3.4 MB and would sit close enough to
 * the ceiling that a tablet left offline over a long weekend could start
 * losing writes silently, which is the one failure this whole mechanism exists
 * to prevent.
 */
export const MAX_UNSENT = 200;

export interface UnsentTeaching {
  domain: BrainDomain;
  head: BrainHead;
  label: string;
  embedding: string;
  proposedLabel: string | null;
  confidence: number | null;
  /** Absent on anything queued before sittings were recorded. */
  captureGroup?: string | null;
  at: string;
}

/**
 * One key per teaching, rather than one array under one key.
 *
 * Writing to an array means reading it, parsing 1.4 MB, pushing, and
 * re-serialising all of it — on every single spring. That is quadratic, and
 * measurably so: the test that fills the backlog was timing out, which is what
 * turned this from a tidy detail into a real one. A separate key is a constant
 * cost per tap, which is what a bench doing seven hundred a shift needs.
 *
 * The sequence number in the key is what preserves order; localStorage itself
 * makes no promise about the order keys come back in.
 */
function unsentKeys(): string[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(UNSENT_PREFIX)) keys.push(k);
    }
  } catch {
    return [];
  }
  return keys.sort((a, b) => Number(a.slice(UNSENT_PREFIX.length)) - Number(b.slice(UNSENT_PREFIX.length)));
}

export function readUnsent(): UnsentTeaching[] {
  const out: UnsentTeaching[] = [];
  for (const k of unsentKeys()) {
    try {
      const raw = localStorage.getItem(k);
      if (raw) out.push(JSON.parse(raw));
    } catch {
      // A corrupted entry helps nobody and cannot be repaired. Drop it rather
      // than letting one bad value stop the whole backlog from draining.
      try {
        localStorage.removeItem(k);
      } catch {
        /* nothing further to try */
      }
    }
  }
  return out;
}

export function rememberUnsent(t: UnsentTeaching): void {
  try {
    const keys = unsentKeys();
    // Oldest out first. A recent teaching is worth more than a stale one, and
    // the alternative is refusing to record anything once full.
    for (const k of keys.slice(0, Math.max(0, keys.length - (MAX_UNSENT - 1)))) {
      localStorage.removeItem(k);
    }
    const next = keys.length ? Number(keys[keys.length - 1].slice(UNSENT_PREFIX.length)) + 1 : 1;
    localStorage.setItem(`${UNSENT_PREFIX}${next}`, JSON.stringify(t));
  } catch {
    /*
     * Quota exceeded, private browsing, or storage disabled. Nothing sensible
     * to do: the inspector's tap is already in the visible record on screen,
     * and this backlog is a convenience on top of that rather than the record
     * itself.
     */
  }
}

export function clearUnsent(keep: UnsentTeaching[] = []): void {
  try {
    for (const k of unsentKeys()) localStorage.removeItem(k);
    for (const t of keep) rememberUnsent(t);
  } catch {
    /* as above */
  }
}

export async function flushUnsent(
  send: (t: UnsentTeaching) => Promise<void>
): Promise<{ sent: number; kept: number }> {
  const all = readUnsent();
  if (all.length === 0) return { sent: 0, kept: 0 };

  const kept: UnsentTeaching[] = [];
  let sent = 0;
  for (const t of all) {
    try {
      await send(t);
      sent++;
    } catch (err: any) {
      const status = Number(err?.status ?? err?.statusCode ?? 0);
      const refused = status >= 400 && status < 500;
      if (!refused) kept.push(t);
    }
  }
  clearUnsent(kept);
  return { sent, kept: kept.length };
}
