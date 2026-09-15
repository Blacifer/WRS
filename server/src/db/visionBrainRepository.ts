/**
 * What the camera has been taught
 * Indian Railways WRS Raipur
 *
 * A thin, deliberately dull store. The intelligence is in the browser, in
 * client/src/services/visionBrain.ts; this is the part that makes it survive a
 * reinstall and be shared between benches.
 *
 * Every row is append-only, guarded at the database rather than here, because
 * these rows are the evidence for why the camera said what it said and a
 * record that can be revised afterwards is not evidence.
 */

import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export type { BrainDomain, BrainHead } from '../../../shared/vision/types.ts';
export { BRAIN_DOMAINS, BRAIN_HEADS } from '../../../shared/vision/types.ts';
import { BRAIN_HEADS, SYNTHETIC_PART_NAME } from '../../../shared/vision/types.ts';
import type { BrainDomain, BrainHead } from '../../../shared/vision/types.ts';

/**
 * 1280 floats, base64 of the raw little-endian bytes.
 *
 * Checked rather than trusted: a wrong-length embedding would not throw, it
 * would silently compare against nothing and quietly make the camera worse.
 * That is the kind of fault that takes months to notice, so it is refused at
 * the door.
 */
export const EMBEDDING_DIMS = 1280;
/** 1280 float32 values is 5120 bytes, which base64 encodes to 6828 characters. */
export const EMBEDDING_BYTES = EMBEDDING_DIMS * 4;
export const EMBEDDING_B64_LEN = Math.ceil(EMBEDDING_BYTES / 3) * 4;

export interface TeachInput {
  domain: BrainDomain;
  head: BrainHead;
  label: string;
  embedding: string;
  sourceImageId?: string | null;
  /** A small JPEG data URL of the crop, so the answer can be shown, not just stated. */
  thumbnail?: string | null;
  partName?: string | null;
  bogiePosition?: string | null;
  proposedLabel?: string | null;
  taughtBy: string;
  /** See migrations.ts: one id per physical part per sitting. */
  captureGroup?: string | null;
}

/** Whether rows a drive taught with drawn parts are to be returned at all. */
export interface ListOptions {
  includeSynthetic?: boolean;
}

export interface StoredExample {
  id: string;
  domain: BrainDomain;
  head: BrainHead;
  label: string;
  embedding: string;
  sourceImageId: string | null;
  thumbnail: string | null;
  partName: string | null;
  bogiePosition: string | null;
  proposedLabel: string | null;
  wasCorrection: boolean;
  taughtBy: string;
  createdAt: string;
  captureGroup: string | null;
  /** part_name is the synthetic mark: a drawn part, not one of the shop's. */
  synthetic: boolean;
}

/**
 * A thumbnail is meant to be about 3 KB. This cap is generous enough for a
 * 128-pixel JPEG and mean enough that a full-size photograph is refused —
 * without it, the storage argument that justifies keeping embeddings rather
 * than images would quietly stop being true.
 */
export const MAX_THUMBNAIL_CHARS = 24000;

export function isValidThumbnail(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    v.length <= MAX_THUMBNAIL_CHARS &&
    /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v)
  );
}

export function isValidEmbedding(b64: unknown): b64 is string {
  if (typeof b64 !== 'string') return false;
  if (b64.length !== EMBEDDING_B64_LEN) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(b64);
}

export class VisionBrainRepository {
  private db: DatabaseSync;

  // Written out rather than as a constructor parameter property: Node runs
  // this project's TypeScript in strip-only mode, which does not support that
  // shorthand. tsc accepts it happily, so the failure appears only when the
  // code is actually executed.
  constructor(db: DatabaseSync) {
    this.db = db;
  }

  /**
   * Remember one labelled photograph.
   *
   * `wasCorrection` is derived here rather than taken from the caller, so that
   * a client cannot report its own accuracy. It is the difference between what
   * the camera offered and what the person actually chose, and nothing else.
   */
  teach(input: TeachInput): StoredExample {
    const id = `vex_${randomUUID()}`;
    const wasCorrection =
      input.proposedLabel != null && input.proposedLabel !== input.label ? 1 : 0;

    this.db
      .prepare(
        `INSERT INTO vision_examples
           (id, domain, head, label, embedding, source_image_id, thumbnail,
            part_name, bogie_position, proposed_label, was_correction, taught_by,
            capture_group)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.domain,
        input.head,
        input.label,
        input.embedding,
        input.sourceImageId ?? null,
        input.thumbnail ?? null,
        input.partName ?? null,
        input.bogiePosition ?? null,
        input.proposedLabel ?? null,
        wasCorrection,
        input.taughtBy,
        input.captureGroup ?? null
      );

    return this.get(id)!;
  }

  get(id: string): StoredExample | null {
    const row = this.db.prepare('SELECT * FROM vision_examples WHERE id = ?').get(id) as any;
    return row ? this.map(row) : null;
  }

  /**
   * Everything the camera knows, for one domain.
   *
   * Returned whole rather than paged: the client rebuilds its comparison list
   * from this on load, and a partial list is a camera that has quietly
   * forgotten things. At 5 KB an example, ten thousand examples is 50 MB —
   * beyond what a shop will reach in years, and `limit` exists so that if it
   * ever does, the failure is a stated cap rather than a stalled bench.
   */
  list(domain: BrainDomain, opts: ListOptions = {}, limit = 20000): StoredExample[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM vision_examples WHERE domain = ?
         ${opts.includeSynthetic ? '' : 'AND COALESCE(part_name, \'\') <> ?'}
         ORDER BY created_at ASC, rowid ASC LIMIT ?`
      )
      .all(...(opts.includeSynthetic ? [domain, limit] : [domain, SYNTHETIC_PART_NAME, limit])) as any[];
    return rows.map((r) => this.map(r));
  }

  /**
   * Something cheap that changes whenever the list above would: the table is
   * append-only, so a count and the newest rowid together are a version.
   * The server-side brain uses this to know when to reload.
   */
  version(domain: BrainDomain): string {
    const r = this.db
      .prepare('SELECT COUNT(*) AS n, COALESCE(MAX(rowid), 0) AS top FROM vision_examples WHERE domain = ?')
      .get(domain) as any;
    return `${r.n}:${r.top}`;
  }

  /**
   * How many of each label, per head — the thinnest class is what matters.
   *
   * A head holding two thousand outer springs and eleven snubbers has not
   * really seen a snubber, and a total would hide that.
   */
  counts(domain: BrainDomain, opts: ListOptions = {}): Record<string, Record<string, number>> {
    const rows = this.db
      .prepare(
        `SELECT head, label, COUNT(*) AS c FROM vision_examples
         WHERE domain = ? ${opts.includeSynthetic ? '' : 'AND COALESCE(part_name, \'\') <> ?'}
         GROUP BY head, label`
      )
      .all(...(opts.includeSynthetic ? [domain] : [domain, SYNTHETIC_PART_NAME])) as any[];
    const out: Record<string, Record<string, number>> = {};
    for (const r of rows) {
      out[r.head] = out[r.head] || {};
      out[r.head][r.label] = Number(r.c);
    }
    return out;
  }

  /**
   * How the corrections have trended.
   *
   * The single most useful number in the system for answering "is it actually
   * learning": the share of teachings that were corrections, week by week. If
   * the camera is improving this falls. If it is not, this is flat, and a flat
   * line is the honest thing to show rather than a rising example count, which
   * only ever goes up.
   */
  correctionTrend(domain: BrainDomain, head?: BrainHead): Array<{
    week: string;
    taught: number;
    proposed: number;
    corrections: number;
    agreementRate: number | null;
  }> {
    const rows = this.db
      .prepare(
        `SELECT strftime('%Y-W%W', created_at) AS week,
                COUNT(*) AS taught,
                SUM(CASE WHEN proposed_label IS NOT NULL THEN 1 ELSE 0 END) AS proposed,
                SUM(was_correction) AS corrections
         FROM vision_examples
         WHERE domain = ?${head ? ' AND head = ?' : ''}
         GROUP BY week ORDER BY week ASC`
      )
      .all(...(head ? [domain, head] : [domain])) as any[];

    return rows.map((r) => {
      const proposed = Number(r.proposed);
      const corrections = Number(r.corrections);
      return {
        week: String(r.week),
        taught: Number(r.taught),
        proposed,
        corrections,
        // Only over the ones it actually offered an answer for. Teachings
        // where it stayed silent say nothing about whether it was right.
        agreementRate: proposed > 0 ? (proposed - corrections) / proposed : null
      };
    });
  }

  private map(r: any): StoredExample {
    return {
      id: r.id,
      domain: r.domain,
      head: r.head,
      label: r.label,
      embedding: r.embedding,
      sourceImageId: r.source_image_id ?? null,
      thumbnail: r.thumbnail ?? null,
      partName: r.part_name ?? null,
      bogiePosition: r.bogie_position ?? null,
      proposedLabel: r.proposed_label ?? null,
      wasCorrection: Number(r.was_correction) === 1,
      taughtBy: r.taught_by,
      createdAt: r.created_at,
      captureGroup: r.capture_group ?? null,
      synthetic: r.part_name === SYNTHETIC_PART_NAME
    };
  }
}

// ---------------------------------------------------------------------------
// Is it still agreeing with people? — the input to the self-switch-off
// ---------------------------------------------------------------------------

export interface HeadAgreement {
  head: BrainHead;
  /** Proposals in the window. Only proposals: silence is neither right nor wrong. */
  sampled: number;
  kept: number;
  /** Share the person kept, or null below the minimum sample. */
  rate: number | null;
  /** The newest proposal in the window, so a stale window is visible. */
  newestAt: string | null;
}

/**
 * Per head, over the most recent proposals, how many the inspector kept.
 *
 * Read from the learning ledger rather than from vision_examples: the ledger
 * holds every proposal the camera made whether or not it was then taught,
 * which is the population that matters. It is the third condition in
 * shared/vision/autoCommit.ts — a head that was good last month and is not
 * this month switches itself off here rather than waiting to be caught.
 *
 * A window of recent events rather than a date range, so a bench that sorted
 * two thousand springs last week and none this week is judged on the two
 * thousand, not on an empty seven days.
 */
export function liveAgreement(
  db: DatabaseSync,
  domain: BrainDomain,
  window = 200,
  minSample = 30
): Record<BrainHead, HeadAgreement> {
  const subsystem = domain === 'SPRING' ? 'SPRING_VISION' : 'PART_VISION';
  const rows = db
    .prepare(
      `SELECT machine_output_json, was_corrected, created_at
       FROM machine_learning_events
       WHERE subsystem = ?
         -- An auto-committed verdict is the camera agreeing with itself, and
         -- counting it would let the rate float on its own decisions. Only a
         -- proposal a PERSON answered says anything about whether the camera
         -- is right. The auto rows are checked another way: a supervisor's
         -- blind sample of CAMERA_AUTO records.
         AND COALESCE(json_extract(context_json, '$.auto'), 0) = 0
       ORDER BY created_at DESC, rowid DESC
       LIMIT ?`
    )
    .all(subsystem, window * BRAIN_HEADS.length) as any[];

  const out = {} as Record<BrainHead, HeadAgreement>;
  for (const head of BRAIN_HEADS) out[head] = { head, sampled: 0, kept: 0, rate: null, newestAt: null };

  for (const r of rows) {
    let head: BrainHead | null = null;
    try {
      const h = JSON.parse(r.machine_output_json || '{}')?.head;
      head = BRAIN_HEADS.includes(h) ? (h as BrainHead) : null;
    } catch {
      continue;
    }
    if (!head) continue;
    const a = out[head];
    if (a.sampled >= window) continue;
    a.sampled++;
    if (Number(r.was_corrected) === 0) a.kept++;
    if (!a.newestAt) a.newestAt = String(r.created_at);
  }

  for (const head of BRAIN_HEADS) {
    const a = out[head];
    a.rate = a.sampled >= minSample ? a.kept / a.sampled : null;
  }
  return out;
}
