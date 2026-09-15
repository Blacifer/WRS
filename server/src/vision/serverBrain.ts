/**
 * The server's own view of whether the camera has earned this one
 * Indian Railways WRS Raipur
 *
 * THE FAULT THIS CLOSES
 * ---------------------
 * shared/vision/autoCommit.ts states six conditions before the camera may
 * write a verdict with no tap. Until this file, every one of them was judged
 * in the browser, by the code that wanted to skip the tap — and the server's
 * whole contribution was to check that the word CAMERA_AUTO was spelled
 * correctly. A tablet whose examples were an hour stale, a tablet with the
 * master switch cached as "on" after a supervisor turned it off, or a request
 * that was not from the app at all, could write a camera decision on any
 * spring. The kill switch was reported by one endpoint and consulted by none.
 *
 * Now a CAMERA_AUTO write must carry the embedding the bench judged and the
 * labels it judged it to be, and the server:
 *
 *   - refuses outright if VISION_AUTO_COMMIT is off;
 *   - rebuilds the camera from the examples IT holds (never the client's);
 *   - re-runs the vote on that embedding, per head, and requires its own
 *     labels to match the ones claimed — a stale or altered client fails here;
 *   - re-scores every head leave-one-out, with sittings and twins hidden;
 *   - reads the live agreement from its own ledger;
 *   - and puts all of that through the same decideAutoCommit() the browser
 *     used. If the server's answer is ASK, the row is not written, and the
 *     reason goes back so the bench can ask the person.
 *
 * The browser still runs the rule, because a person at the bench needs to
 * see why the camera is asking without a round trip. But the browser's
 * answer is a preview. This one is the decision.
 *
 * COST
 * ----
 * Leave-one-out is O(n²) in examples per head. The table is append-only, so
 * the score for a head cannot change until something is taught; it is cached
 * against a cheap version stamp (count + newest rowid) and recomputed only
 * then. A bench sorting seven hundred springs a shift costs one sweep per
 * teaching, not one per spring.
 */

import type { DatabaseSync } from 'node:sqlite';
import { VisionBrainRepository, liveAgreement, isValidEmbedding } from '../db/visionBrainRepository.ts';
import { VisionBrain, decodeEmbedding, type Proposal, type BrainAccuracy } from '../../../shared/vision/knn.ts';
import {
  decideAutoCommit,
  AUTO_AGREEMENT_MIN_SAMPLE,
  type AutoCommitDecision,
  type LiveAgreement
} from '../../../shared/vision/autoCommit.ts';
import { BRAIN_HEADS, type BrainDomain, type BrainHead } from '../../../shared/vision/types.ts';
import { config } from '../config/index.ts';
import { LearningService } from '../learning/learningService.ts';

/** The heads each bench judges by. The same lists the two screens use. */
export const AUTO_HEADS: Record<BrainDomain, readonly BrainHead[]> = {
  SPRING: ['CATEGORY', 'SURFACE', 'DAMAGE'],
  WAGON_PART: ['SURFACE', 'DAMAGE']
};

/** What a CAMERA_AUTO write must carry. */
export interface AutoEvidence {
  /** base64 of the 1280-float embedding the bench judged. */
  embedding: string;
  /** What the bench's camera said, per head. */
  heads: Array<{ head: BrainHead; label: string; confidence: number }>;
}

export interface GateInput {
  domain: BrainDomain;
  /** The raw autoEvidence from the request body, not yet trusted. */
  evidence: unknown;
  /** Springs: did the server's own band verdict pass. Parts: null. */
  measurementPassed: boolean | null;
  /**
   * What the bench is set to, for a naming head. For a spring, the queue's
   * position; for a part, the checklist line's name as a label — applied
   * only once PART_ID has earned ASSIST, as on the screen.
   */
  expected?: Partial<Record<BrainHead, string>>;
}

export type GateResult =
  | {
      ok: true;
      decision: AutoCommitDecision;
      proposals: Partial<Record<BrainHead, Proposal>>;
      accuracy: Partial<Record<BrainHead, BrainAccuracy>>;
    }
  | {
      ok: false;
      status: 400 | 403 | 422;
      code: 'AUTO_EVIDENCE_MISSING' | 'AUTO_COMMIT_OFF' | 'AUTO_COMMIT_REFUSED' | 'AUTO_LABELS_DISAGREE';
      message: string;
      decision?: AutoCommitDecision;
    };

/** One brain per domain, rebuilt only when the table has grown. */
interface Cached {
  version: string;
  brain: VisionBrain;
  accuracy: Map<BrainHead, BrainAccuracy>;
}

/*
 * Keyed by the database handle, not globally: a test that opens a fresh
 * in-memory database with the same row count as the last one must not be
 * handed the last one's camera. The version stamp then only has to notice
 * growth within one database, which the append-only table guarantees.
 */
const cache = new WeakMap<DatabaseSync, Map<BrainDomain, Cached>>();

function brainFor(db: DatabaseSync, domain: BrainDomain): Cached {
  const repo = new VisionBrainRepository(db);
  const version = `${repo.version(domain)}|${config.visionCountSynthetic ? 'syn' : 'real'}`;
  let perDb = cache.get(db);
  if (!perDb) {
    perDb = new Map();
    cache.set(db, perDb);
  }
  const hit = perDb.get(domain);
  if (hit && hit.version === version) return hit;

  const brain = new VisionBrain();
  for (const e of repo.list(domain, { includeSynthetic: config.visionCountSynthetic })) {
    brain.remember({
      id: e.id,
      domain: e.domain,
      head: e.head,
      label: e.label,
      embedding: decodeEmbedding(e.embedding),
      sourceImageId: e.sourceImageId,
      partName: e.partName,
      captureGroup: e.captureGroup
    });
  }
  const fresh: Cached = { version, brain, accuracy: new Map() };
  perDb.set(domain, fresh);
  return fresh;
}

function accuracyFor(c: Cached, head: BrainHead): BrainAccuracy {
  const hit = c.accuracy.get(head);
  if (hit) return hit;
  const a = c.brain.evaluate(head);
  c.accuracy.set(head, a);
  return a;
}

/** The server's measured score per head, for the status endpoint. */
export function serverAccuracy(db: DatabaseSync, domain: BrainDomain): Partial<Record<BrainHead, BrainAccuracy>> {
  const c = brainFor(db, domain);
  const out: Partial<Record<BrainHead, BrainAccuracy>> = {};
  for (const head of BRAIN_HEADS) out[head] = accuracyFor(c, head);
  return out;
}

function parseEvidence(raw: unknown): AutoEvidence | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as any;
  if (!isValidEmbedding(e.embedding)) return null;
  if (!Array.isArray(e.heads) || e.heads.length === 0) return null;
  const heads: AutoEvidence['heads'] = [];
  for (const h of e.heads) {
    if (!BRAIN_HEADS.includes(h?.head)) return null;
    if (typeof h.label !== 'string' || !h.label) return null;
    const confidence = Number(h.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
    heads.push({ head: h.head, label: h.label.trim().toUpperCase().replace(/\s+/g, '_'), confidence });
  }
  return { embedding: e.embedding, heads };
}

/**
 * Decide, on the server's own evidence, whether this CAMERA_AUTO write may
 * happen. Call only when the claimed source is CAMERA_AUTO.
 */
export function judgeAutoCommit(db: DatabaseSync, input: GateInput): GateResult {
  if (!config.visionAutoCommit) {
    return {
      ok: false,
      status: 403,
      code: 'AUTO_COMMIT_OFF',
      message: 'The camera may not decide without a tap: switched off in the server configuration (VISION_AUTO_COMMIT=off). Ask the person.'
    };
  }

  const evidence = parseEvidence(input.evidence);
  if (!evidence) {
    return {
      ok: false,
      status: 400,
      code: 'AUTO_EVIDENCE_MISSING',
      message: 'A CAMERA_AUTO verdict must carry autoEvidence: the embedding the bench judged and the label and confidence per head. Without it the server cannot check that the camera earned this one.'
    };
  }

  const c = brainFor(db, input.domain);
  const query = decodeEmbedding(evidence.embedding);

  // Which heads take part. PART_ID joins a wagon-part decision only once it
  // has earned ASSIST — the same rule the screen applies, for the same
  // reason: before that, a wrong name would stop every judgement for the
  // wrong reason.
  const heads: BrainHead[] = [...AUTO_HEADS[input.domain]];
  if (input.domain === 'WAGON_PART' && accuracyFor(c, 'PART_ID').verdict === 'ASSIST') heads.push('PART_ID');

  const proposals: Partial<Record<BrainHead, Proposal>> = {};
  const accuracy: Partial<Record<BrainHead, BrainAccuracy>> = {};
  for (const head of heads) {
    proposals[head] = c.brain.predict(head, query);
    accuracy[head] = accuracyFor(c, head);
  }

  // The client's labels must be the server's labels. Not "close": the same.
  // Two copies of the same arithmetic on the same examples give the same
  // answer; a different answer means the client's examples are not these,
  // or the client is not the app.
  for (const head of heads) {
    const claimed = evidence.heads.find((h) => h.head === head);
    const mine = proposals[head]!;
    if (!claimed) {
      return {
        ok: false,
        status: 422,
        code: 'AUTO_LABELS_DISAGREE',
        message: `The bench sent no answer for ${head.toLowerCase()}, which the server judges by. Ask the person.`
      };
    }
    if (mine.label !== claimed.label) {
      return {
        ok: false,
        status: 422,
        code: 'AUTO_LABELS_DISAGREE',
        message:
          mine.label === null
            ? `The server's camera does not recognise this (${head.toLowerCase()}); the bench said ${claimed.label}. The bench may be out of date — reload it, and ask the person.`
            : `The server's camera says ${mine.label} for ${head.toLowerCase()}; the bench said ${claimed.label}. The bench may be out of date — reload it, and ask the person.`
      };
    }
  }

  const live = liveAgreement(db, input.domain, 200, AUTO_AGREEMENT_MIN_SAMPLE);
  const liveIn: Partial<Record<BrainHead, LiveAgreement>> = {};
  for (const head of heads) liveIn[head] = { sampled: live[head].sampled, rate: live[head].rate };

  // Only the expectations for heads that took part. A PART_ID expectation on
  // a part whose PART_ID head has not earned ASSIST would stop it for the
  // wrong reason, exactly as the screen avoids.
  const expected: Partial<Record<BrainHead, string>> = {};
  for (const head of heads) {
    const want = input.expected?.[head];
    if (want) expected[head] = want;
  }

  const decision = decideAutoCommit({
    domain: input.domain,
    heads: heads.map((head) => ({
      head,
      verdict: accuracy[head]!.verdict,
      confidence: proposals[head]!.confidence,
      label: proposals[head]!.label
    })),
    measurementPassed: input.measurementPassed,
    liveAgreement: liveIn,
    expected: Object.keys(expected).length > 0 ? expected : undefined
  });

  if (decision.mode !== 'AUTO') {
    return {
      ok: false,
      status: 422,
      code: 'AUTO_COMMIT_REFUSED',
      message: decision.reason,
      decision
    };
  }

  return { ok: true, decision, proposals, accuracy };
}

/**
 * The camera decided and nobody confirmed: put it on the record, with its
 * confidence and neighbours, in the same request as the verdict so the two
 * cannot disagree. Logged with auto: true so it is EXCLUDED from the live
 * agreement — the camera agreeing with itself is not evidence — and it is
 * deliberately not a teaching.
 */
export function recordAutoDecision(
  db: DatabaseSync,
  domain: BrainDomain,
  gate: Extract<GateResult, { ok: true }>,
  ctx: { recordId?: string | null; wagonNumber?: string | null; userId: string; userRole: string | null }
): void {
  const ls = new LearningService(db);
  for (const head of Object.keys(gate.proposals) as BrainHead[]) {
    const p = gate.proposals[head]!;
    if (!p.label) continue;
    try {
      ls.recordOutcome({
        subsystem: domain === 'SPRING' ? 'SPRING_VISION' : 'PART_VISION',
        machineOutput: { head, label: p.label },
        machineConfidence: p.confidence,
        humanOutput: null,
        wasCorrected: false,
        context: {
          auto: true,
          judgedBy: 'SERVER',
          recordId: ctx.recordId ?? null,
          wagonNumber: ctx.wagonNumber ?? null,
          neighbours: p.neighbours.slice(0, 5).map((n) => n.exampleId),
          accuracy: gate.accuracy[head]?.accuracy ?? null,
          answerRate: gate.accuracy[head]?.answerRate ?? null
        },
        userId: ctx.userId,
        userRole: ctx.userRole
      });
    } catch {
      // The verdict is already written and is what matters on the floor.
    }
  }
}
