/**
 * The camera's judgement — the part that is arithmetic, not a network
 * Indian Railways WRS Raipur
 *
 * WHY THIS LIVES IN shared/ AND NOT IN THE BROWSER
 * -------------------------------------------------
 * The camera is 1280 numbers from MobileNet and a vote among the nearest
 * remembered photographs. MobileNet has to run in the browser, where the
 * camera is. The vote does not. It is cosine similarity and a count, and it
 * runs anywhere — which means the server can run it too, on the same
 * embedding the bench judged, against the same remembered examples, and
 * reach its own decision before a CAMERA_AUTO row is written.
 *
 * That is the reason for this file. The rule in autoCommit.ts said the camera
 * may decide without a tap once it has earned it, and for a while the only
 * thing checking whether it HAD earned it was the browser that wanted to skip
 * the tap. A client with stale examples, or a modified one, could write
 * CAMERA_AUTO on anything. Now the server re-derives every condition itself
 * from this code, and the client's copy is for showing the person why — not
 * for deciding.
 *
 * One implementation, imported by both, so they cannot drift.
 *
 * WHAT A LEAVE-ONE-OUT SCORE MUST NOT COUNT
 * -----------------------------------------
 * "Hide one photograph, ask the rest, see if they get it right" is honest only
 * if the rest do not contain a copy of the hidden one. Two things make copies:
 *
 *   - Several frames of the same spring, taught in the same sitting. They are
 *     separate rows with near-identical embeddings; hide one and its twin
 *     answers for it. Every teaching therefore carries a CAPTURE GROUP — one
 *     id per physical part per sitting — and evaluate() hides the whole group.
 *
 *   - Rows taught before capture groups existed, or a twin taught in a later
 *     sitting nobody could have grouped. For those, evaluate() also hides any
 *     example that is nearer than TWIN_SIMILARITY to the one being scored,
 *     and reports how many it hid. A held-out twin is visible; a counted one
 *     is a lie on the wall.
 *
 * And a head that mostly declines to answer has not been measured on this
 * shop's parts — it has been measured on the easy half of them. So ASSIST
 * also requires that it answered at least half the time.
 */

import type { BrainHead, BrainDomain, BrainVerdict } from './types.ts';

/** One remembered photograph: what it looked like, and what a person called it. */
export interface BrainExample {
  id: string;
  domain: BrainDomain;
  head: BrainHead;
  /** The person's answer. This is the truth; the camera only ever guesses at it. */
  label: string;
  embedding: Float32Array;
  sourceImageId?: string | null;
  partName?: string | null;
  taughtBy?: string | null;
  createdAt?: string | null;
  /**
   * One id per physical part per sitting, shared by every frame and every
   * head taught from it. Leave-one-out hides the whole group. Null on rows
   * taught before the column existed; those rely on the twin check alone.
   */
  captureGroup?: string | null;
}

/** One of the remembered photographs that produced an answer. */
export interface Neighbour {
  exampleId: string;
  label: string;
  similarity: number;
  sourceImageId?: string | null;
}

export interface Proposal {
  head: BrainHead;
  /** null means "I do not recognise this" — a real answer, not a failure. */
  label: string | null;
  /** Share of the weighted vote held by the winner, 0..1. */
  confidence: number;
  /** Why it said that: the remembered photographs it matched. */
  neighbours: Neighbour[];
  /** Populated when label is null, in words an inspector can act on. */
  reason?: string;
  /** How many examples this head has been taught. */
  taught: number;
}

// ---------------------------------------------------------------------------
// The floors below which it says "I do not know"
//
// Both are needed, and they catch different failures.
//
// SIMILARITY_FLOOR catches the part it has never seen. Ask a brain that knows
// only springs about a brake block and the nearest spring is still the nearest
// *something* — a vote among neighbours alone would answer confidently. So the
// nearest match must actually be near before any vote is counted.
//
// CONFIDENCE_FLOOR catches the genuinely ambiguous frame — a spring half in
// shadow that sits between two classes. The neighbours are close, but they
// disagree, and disagreement is information worth showing rather than
// resolving by majority.
// ---------------------------------------------------------------------------

/** Cosine similarity the nearest remembered photograph must reach. */
export const SIMILARITY_FLOOR = 0.62;

/**
 * Share of the weighted vote the winning label must hold.
 *
 * 0.65 rather than a rounder 0.6, and the reason is arithmetic rather than
 * taste. With five neighbours and two candidate labels the closest possible
 * split is three against two, which is 0.6 exactly — so a floor set at 0.6
 * would reject nothing at all and the check would be decoration. Writing the
 * tests is what surfaced that.
 *
 * At 0.65 the rule becomes one an inspector can state: four of the five
 * nearest photographs must agree. Three against two is a disagreement, and a
 * disagreement is worth showing rather than resolving by majority.
 */
export const CONFIDENCE_FLOOR = 0.65;

/** Neighbours consulted. Odd, and small, because early on there are few. */
export const K = 5;

/**
 * Below this it will not answer at all.
 *
 * Two labels because one label can only ever say that one label, which is not
 * recognition. Eight examples because a vote among fewer is noise wearing a
 * percentage.
 */
export const MIN_EXAMPLES = 8;
export const MIN_LABELS = 2;

/** Where a head stops being a demonstration and starts being useful. */
export const USEFUL_PER_LABEL = 20;

/**
 * Nearer than this to the example being scored, and it is treated as another
 * frame of the same part and hidden from the leave-one-out pool.
 *
 * Two different springs of one kind, photographed on the same bench, sit
 * somewhere around 0.8 to 0.9 in MobileNet's 1280 numbers. Two frames of the
 * same spring a second apart sit above 0.98. The gap is wide enough that this
 * catches the twin without hiding the genuinely similar neighbour that a fair
 * test should be allowed to find.
 */
export const TWIN_SIMILARITY = 0.98;

/**
 * The share of its own examples a head must be willing to answer for its
 * accuracy to count as earned. Below this, a 95% is 95% of the easy ones.
 */
export const MIN_ANSWER_RATE = 0.5;

// ---------------------------------------------------------------------------
// Vector arithmetic
// ---------------------------------------------------------------------------

export function l2Normalise(v: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  const norm = Math.sqrt(sum);
  if (norm === 0) return new Float32Array(v.length);
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}

/** Both vectors are unit length, so the dot product IS the cosine. */
export function similarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return -1;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

// ---------------------------------------------------------------------------
// Storage form
//
// We keep the 1280 numbers and throw the photograph away — for the brain, at
// least; the photograph itself is already kept as evidence elsewhere and under
// its own append-only rules. An embedding is about 5 KB, so three thousand of
// them is 15 MB, which fits inside the database the weekly backup already
// carries off this machine. What the camera has learned therefore survives the
// machine being formatted, and is shared by every bench rather than each one
// starting from nothing.
//
// atob/btoa are globals in every browser and in Node 16+, so this runs on
// both sides unchanged.
// ---------------------------------------------------------------------------

export function encodeEmbedding(v: Float32Array): string {
  const bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function decodeEmbedding(b64: string): Float32Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

// ---------------------------------------------------------------------------
// The brain
// ---------------------------------------------------------------------------

/** What predict() may be told to leave out, so a score is not self-graded. */
export interface HoldOut {
  /** The example being scored. */
  id: string;
  /** Its capture group, if it has one: every frame of the same sitting goes too. */
  captureGroup?: string | null;
  /** Its embedding, so a near-identical frame can be hidden even if ungrouped. */
  embedding?: Float32Array;
  /** Already-decided ids to hide, when the caller has worked them out once. */
  ids?: Set<string>;
}

export class VisionBrain {
  private byHead = new Map<BrainHead, BrainExample[]>();

  constructor(examples: BrainExample[] = []) {
    for (const e of examples) this.remember(e);
  }

  /** Add one remembered photograph. Takes effect on the very next frame. */
  remember(example: BrainExample): void {
    const list = this.byHead.get(example.head) || [];
    list.push(example);
    this.byHead.set(example.head, list);
  }

  examples(head: BrainHead): BrainExample[] {
    return this.byHead.get(head) || [];
  }

  /** How many of each label this head has been taught. */
  counts(head: BrainHead): Record<string, number> {
    const out: Record<string, number> = {};
    for (const e of this.examples(head)) out[e.label] = (out[e.label] || 0) + 1;
    return out;
  }

  /**
   * The honest readiness figure: the thinnest class, not the total.
   *
   * A head holding two thousand outer springs and eleven snubbers has seen
   * two thousand and eleven photographs and has not really seen a snubber.
   * Reporting the total would flatter it.
   */
  thinnestClass(head: BrainHead): { label: string; count: number } | null {
    const counts = this.counts(head);
    const entries = Object.entries(counts);
    if (entries.length === 0) return null;
    entries.sort((a, b) => a[1] - b[1]);
    return { label: entries[0][0], count: entries[0][1] };
  }

  /**
   * Ask what this looks like.
   *
   * Excluding an example is what makes an honest score possible: leave one
   * out, ask about it, and see whether the rest of the brain gets it right.
   * Scoring a brain on photographs it has memorised measures nothing — and
   * scoring it on a photograph whose twin is still in the pool measures the
   * same nothing, which is why the hold-out is a group and a distance, not
   * just an id. A plain string is accepted for the id-only case.
   */
  predict(head: BrainHead, query: Float32Array, holdOut?: string | HoldOut): Proposal {
    const ho: HoldOut | null = typeof holdOut === 'string' ? { id: holdOut } : holdOut ?? null;
    const all = this.examples(head).filter((e) => !this.isHeldOut(e, ho));
    const labels = new Set(all.map((e) => e.label));
    const base = { head, neighbours: [] as Neighbour[], taught: all.length };

    if (all.length < MIN_EXAMPLES || labels.size < MIN_LABELS) {
      return {
        ...base,
        label: null,
        confidence: 0,
        reason:
          labels.size < MIN_LABELS
            ? `Only ${labels.size} kind${labels.size === 1 ? '' : 's'} taught so far — it needs at least ${MIN_LABELS} to tell anything apart.`
            : `${all.length} of ${MIN_EXAMPLES} examples taught. Keep going.`
      };
    }

    const scored = all
      .map((e) => ({
        exampleId: e.id,
        label: e.label,
        similarity: similarity(e.embedding, query),
        sourceImageId: e.sourceImageId ?? null
      }))
      .sort((a, b) => b.similarity - a.similarity);

    const neighbours = scored.slice(0, Math.min(K, scored.length));

    if (neighbours[0].similarity < SIMILARITY_FLOOR) {
      return {
        ...base,
        label: null,
        confidence: 0,
        neighbours,
        reason:
          'This does not look like anything it has been shown. Tap the right answer and it will know next time.'
      };
    }

    // Nearer neighbours count for more. Weighting by similarity rather than
    // counting heads stops five distant examples of a common class from
    // outvoting one near-identical example of a rare one — which is the whole
    // failure mode of a plain vote on an unbalanced set, and the set here is
    // always unbalanced because a shop sees far more outer springs.
    const votes = new Map<string, number>();
    let total = 0;
    for (const n of neighbours) {
      const w = Math.max(0, n.similarity);
      votes.set(n.label, (votes.get(n.label) || 0) + w);
      total += w;
    }

    let best = '';
    let bestWeight = -1;
    for (const [label, w] of votes) {
      if (w > bestWeight) {
        best = label;
        bestWeight = w;
      }
    }

    const confidence = total > 0 ? bestWeight / total : 0;

    if (confidence < CONFIDENCE_FLOOR) {
      return {
        ...base,
        label: null,
        confidence,
        neighbours,
        reason: `The closest matches disagree (${[...votes.keys()].join(' / ')}). Worth a second look.`
      };
    }

    return { ...base, label: best, confidence, neighbours };
  }

  private isHeldOut(e: BrainExample, ho: HoldOut | null): boolean {
    if (!ho) return false;
    if (e.id === ho.id) return true;
    if (ho.ids) return ho.ids.has(e.id);
    if (ho.captureGroup && e.captureGroup === ho.captureGroup) return true;
    if (ho.embedding && similarity(e.embedding, ho.embedding) >= TWIN_SIMILARITY) return true;
    return false;
  }

  /**
   * Everything that must be hidden when scoring one example: itself, its
   * sitting, and any twin. Worked out once here so evaluate() pays for the
   * similarity sweep a single time per example rather than twice.
   */
  holdOutFor(head: BrainHead, e: BrainExample): { ids: Set<string>; twins: number } {
    const ids = new Set<string>([e.id]);
    let twins = 0;
    for (const other of this.examples(head)) {
      if (other.id === e.id) continue;
      if (e.captureGroup && other.captureGroup === e.captureGroup) {
        ids.add(other.id);
        continue;
      }
      if (similarity(other.embedding, e.embedding) >= TWIN_SIMILARITY) {
        ids.add(other.id);
        twins++;
      }
    }
    return { ids, twins };
  }

  /**
   * Score the brain against itself, honestly.
   *
   * Leave-one-out: for every remembered photograph, hide it — and its sitting,
   * and its twins — ask the rest what it is, and compare. Every photograph is
   * a test case and none of them is one the answer was taken from. This is the
   * number that goes on the wall, and it is allowed to be disappointing.
   *
   * Abstentions are counted separately rather than as failures. A camera that
   * says "I do not know" on a bad frame is behaving correctly, and folding
   * that into the error rate would push us towards a brain that guesses. But
   * they are not ignored either: a head that abstains on most of its own
   * examples has not earned ASSIST, however well it does on the rest.
   */
  evaluate(head: BrainHead): BrainAccuracy {
    const all = this.examples(head);
    let correct = 0;
    let wrong = 0;
    let abstained = 0;
    let twinsHeldOut = 0;
    const confusion: Record<string, Record<string, number>> = {};

    for (const e of all) {
      const { ids, twins } = this.holdOutFor(head, e);
      twinsHeldOut += twins;
      const p = this.predict(head, e.embedding, { id: e.id, ids });
      if (p.label === null) {
        abstained++;
        continue;
      }
      confusion[e.label] = confusion[e.label] || {};
      confusion[e.label][p.label] = (confusion[e.label][p.label] || 0) + 1;
      if (p.label === e.label) correct++;
      else wrong++;
    }

    const answered = correct + wrong;
    const accuracy = answered > 0 ? correct / answered : 0;
    const answerRate = all.length > 0 ? answered / all.length : 0;
    return {
      head,
      taught: all.length,
      answered,
      abstained,
      correct,
      wrong,
      /** Of the ones it was willing to answer, how many it got right. */
      accuracy,
      /** How often it was willing to answer at all. */
      answerRate,
      twinsHeldOut,
      confusion,
      thinnest: this.thinnestClass(head),
      verdict: gradeAccuracy(answered, accuracy, answerRate)
    };
  }
}

export interface BrainAccuracy {
  head: BrainHead;
  taught: number;
  answered: number;
  abstained: number;
  correct: number;
  wrong: number;
  accuracy: number;
  answerRate: number;
  /**
   * Examples hidden from another example's test because they were nearer than
   * TWIN_SIMILARITY and not already in its capture group. Zero on a set that
   * was grouped properly; a large number is a sign the same part was taught
   * over and over, and the score would have been flattered without this.
   */
  twinsHeldOut: number;
  confusion: Record<string, Record<string, number>>;
  thinnest: { label: string; count: number } | null;
  verdict: BrainVerdict;
}

/**
 * The thresholds, fixed here in advance and in code.
 *
 * They are the same three used for the blind spring read, deliberately: a
 * threshold chosen after seeing the result is not a threshold, and using the
 * shop's existing numbers means nobody has to be talked into a new set.
 *
 * The answer rate is the one addition, and it only ever demotes: a head that
 * is 95% right on the third of its examples it was willing to answer is
 * FLAG_ONLY, not ASSIST, because two-thirds of this shop's parts have not
 * been scored at all. Callers with no abstention concept pass nothing and
 * are graded on accuracy alone, as before.
 */
export function gradeAccuracy(answered: number, accuracy: number, answerRate = 1): BrainVerdict {
  if (answered < 30) return 'INSUFFICIENT';
  if (accuracy >= 0.95) return answerRate >= MIN_ANSWER_RATE ? 'ASSIST' : 'FLAG_ONLY';
  if (accuracy >= 0.8) return 'FLAG_ONLY';
  return 'STOP';
}

export const VERDICT_MEANING: Record<BrainVerdict, string> = {
  INSUFFICIENT: 'Too few examples to score it yet. It will not be trusted until it has been.',
  ASSIST: 'Accurate enough to pre-select an answer for the inspector to confirm.',
  FLAG_ONLY: 'Not accurate enough to propose an answer — or not willing to answer often enough for its accuracy to mean much. It may only say "this looks unlike the others".',
  STOP: 'Measured as unreliable on this shop\'s photographs. It proposes nothing, and we say so.'
};

/**
 * A fresh capture-group id: one per physical part per sitting.
 *
 * crypto.randomUUID exists in Node and in any secure browser context, which
 * is every context the camera can open in. The fallback is for the one it
 * cannot — so that the absence of a UUID is never the reason a bench dies.
 */
export function newCaptureGroup(): string {
  const c = (globalThis as any).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `cg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * A part name as a label the brain will accept.
 *
 * "Axle Box Adapter Crown Lug Wear (Max 4.0mm)" cannot be a label as written —
 * the server allows only letters, digits, underscore and hyphen, because a
 * label is a join key and punctuation makes two spellings of one part into two
 * classes. This is the single place that rule is applied on the way in, so the
 * camera and the ledger cannot disagree about what a part is called — and now
 * the server applies it too, when it checks that an auto-passed part is the
 * part the checklist line names.
 */
export function labelForPart(partName: string): string {
  return partName
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}
