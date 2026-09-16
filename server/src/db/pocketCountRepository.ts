/**
 * Pocket counts — the labelled dataset, one row per count of one frame
 * Indian Railways WRS Raipur
 *
 * The arithmetic is in shared/assembly/pocketCount.ts. This file is what
 * gets a count into and out of the table, and the two rules the table
 * cannot express on its own:
 *
 *   - The second count of a frame must be by a different person, and it is
 *     blind: the first count is withheld from anyone who could still make
 *     the recount. Agreement between two people who saw each other's marks
 *     is not agreement.
 *   - The expected number is never read from the row. It is derived from
 *     the designation the photograph was tagged with, at read time.
 */

import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { parseAssemblyTags, type BogiePosition, type BogieSide } from '../../../shared/assembly/assemblyCapture.ts';
import {
  comparePocketCount, countsAgree, expectedPerSideFor, pocketDatasetReadiness, tallyTaps,
  type CountKind, type PocketComparison, type PocketCounts, type PocketDatasetReadiness, type PocketTap
} from '../../../shared/assembly/pocketCount.ts';

export interface PocketCountRow {
  id: string;
  photoId: string;
  wagonNumber: string;
  designation: string;
  bogie: BogiePosition;
  side: BogieSide;
  kind: CountKind;
  counted: PocketCounts;
  taps: PocketTap[];
  countedBy: string;
  countedByName: string;
  createdAt: string;
}

/** The frame's tags, or null when the photograph is not an assembly capture. */
export interface FrameIdentity { photoId: string; wagonNumber: string; designation: string; bogie: BogiePosition; side: BogieSide }

export class PocketCountRepository {
  private readonly db: DatabaseSync;
  constructor(db: DatabaseSync) { this.db = db; }

  frameFor(photoId: string): FrameIdentity | null {
    const row = this.db.prepare('SELECT id, wagon_number, tags_json FROM wagon_photos WHERE id = ?').get(photoId) as any;
    if (!row) return null;
    let tags: string[] = [];
    try { tags = JSON.parse(row.tags_json || '[]'); } catch { tags = []; }
    const capture = parseAssemblyTags(tags);
    if (!capture) return null;
    return { photoId: row.id, wagonNumber: row.wagon_number, designation: capture.designation, bogie: capture.bogiePosition, side: capture.side };
  }

  private map(r: any): PocketCountRow {
    let taps: PocketTap[] = [];
    try { taps = JSON.parse(r.taps_json || '[]'); } catch { taps = []; }
    return {
      id: r.id, photoId: r.photo_id, wagonNumber: r.wagon_number, designation: r.designation, bogie: r.bogie, side: r.side, kind: r.kind,
      counted: { outer: r.counted_outer, inner: r.counted_inner, snubber: r.counted_snubber, total: r.counted_outer + r.counted_inner + r.counted_snubber },
      taps, countedBy: r.counted_by, countedByName: r.counted_by_name, createdAt: r.created_at
    };
  }

  countsForPhoto(photoId: string): PocketCountRow[] {
    return (this.db.prepare('SELECT * FROM bogie_pocket_counts WHERE photo_id = ? ORDER BY created_at ASC, rowid ASC').all(photoId) as any[]).map((r) => this.map(r));
  }

  countsForWagon(wagonNumber: string): PocketCountRow[] {
    return (this.db.prepare('SELECT * FROM bogie_pocket_counts WHERE wagon_number = ? ORDER BY created_at ASC, rowid ASC').all(wagonNumber.trim().toUpperCase()) as any[]).map((r) => this.map(r));
  }

  /**
   * What the next count of this frame would be, for this person.
   *
   * FIRST when nobody has counted it. BLIND_RECOUNT when exactly one person
   * has and this is someone else. SAME_PERSON when the only count is theirs.
   * DONE when both counts exist — further counts are still accepted (as
   * BLIND_RECOUNT by anyone who has not counted it), but the frame is
   * covered.
   */
  turnFor(photoId: string, userId: string): { turn: 'FIRST' | 'BLIND_RECOUNT' | 'SAME_PERSON' | 'DONE'; first: PocketCountRow | null; recount: PocketCountRow | null } {
    const counts = this.countsForPhoto(photoId);
    const first = counts.find((c) => c.kind === 'FIRST') ?? null;
    const recount = counts.find((c) => c.kind === 'BLIND_RECOUNT') ?? null;
    if (!first) return { turn: 'FIRST', first, recount };
    if (recount) return { turn: counts.some((c) => c.countedBy === userId) ? 'DONE' : 'BLIND_RECOUNT', first, recount };
    return { turn: first.countedBy === userId ? 'SAME_PERSON' : 'BLIND_RECOUNT', first, recount };
  }

  record(frame: FrameIdentity, taps: PocketTap[], by: { id: string; name: string }): { row: PocketCountRow; comparison: PocketComparison; agreesWithFirst: boolean | null } {
    const { turn, first } = this.turnFor(frame.photoId, by.id);
    // DONE is only returned to someone who already counted this frame.
    if (turn === 'SAME_PERSON' || turn === 'DONE') {
      throw Object.assign(new Error('You have already counted this frame. The recount must be by a different person, and blind.'), { code: 'SAME_PERSON' });
    }
    const kind: CountKind = turn === 'FIRST' ? 'FIRST' : 'BLIND_RECOUNT';
    const counted = tallyTaps(taps);
    const expected = expectedPerSideFor(frame.designation);
    if (!expected) throw Object.assign(new Error(`The registry does not hold ${frame.designation}; no expected count can be derived.`), { code: 'UNKNOWN_DESIGNATION' });
    const id = `pc_${randomUUID()}`;
    this.db.prepare(`
      INSERT INTO bogie_pocket_counts (id, photo_id, wagon_number, designation, bogie, side, kind, counted_outer, counted_inner, counted_snubber, taps_json, counted_by, counted_by_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, frame.photoId, frame.wagonNumber, frame.designation, frame.bogie, frame.side, kind, counted.outer, counted.inner, counted.snubber, JSON.stringify(taps), by.id, by.name);
    const row = this.countsForPhoto(frame.photoId).find((c) => c.id === id)!;
    const comparison = comparePocketCount(expected, counted, { bogie: frame.bogie, side: frame.side });
    return { row, comparison, agreesWithFirst: kind === 'BLIND_RECOUNT' && first ? countsAgree(first.counted, counted) : null };
  }

  /**
   * The frames of one wagon with what their counts say, for the sign-off
   * screen. Expected is derived here, from the designation on the frame.
   */
  wagonSummary(wagonNumber: string): Array<{ photoId: string; bogie: BogiePosition; side: BogieSide; designation: string; first: PocketCountRow | null; recount: PocketCountRow | null; comparison: PocketComparison | null; recountComparison: PocketComparison | null; agree: boolean | null }> {
    const byPhoto = new Map<string, PocketCountRow[]>();
    for (const c of this.countsForWagon(wagonNumber)) { const arr = byPhoto.get(c.photoId); if (arr) arr.push(c); else byPhoto.set(c.photoId, [c]); }
    const out: ReturnType<PocketCountRepository['wagonSummary']> = [];
    for (const [photoId, counts] of byPhoto) {
      const first = counts.find((c) => c.kind === 'FIRST') ?? null;
      const recount = counts.find((c) => c.kind === 'BLIND_RECOUNT') ?? null;
      const any = first ?? recount!;
      const expected = expectedPerSideFor(any.designation);
      const where = { bogie: any.bogie, side: any.side };
      out.push({
        photoId, bogie: any.bogie, side: any.side, designation: any.designation, first, recount,
        comparison: first && expected ? comparePocketCount(expected, first.counted, where) : null,
        recountComparison: recount && expected ? comparePocketCount(expected, recount.counted, where) : null,
        agree: first && recount ? countsAgree(first.counted, recount.counted) : null
      });
    }
    return out.sort((a, b) => `${a.bogie}${a.side}`.localeCompare(`${b.bogie}${b.side}`));
  }

  /** The dataset: how many labelled frames, covered bogies, and how often two people agree. */
  readiness(): PocketDatasetReadiness & { byDesignation: Record<string, number> } {
    const rows = this.db.prepare('SELECT * FROM bogie_pocket_counts ORDER BY created_at ASC, rowid ASC').all() as any[];
    const firsts = new Map<string, PocketCountRow>();
    const recounts = new Map<string, PocketCountRow>();
    for (const r of rows.map((x) => this.map(x))) {
      if (r.kind === 'FIRST' && !firsts.has(r.photoId)) firsts.set(r.photoId, r);
      if (r.kind === 'BLIND_RECOUNT' && !recounts.has(r.photoId)) recounts.set(r.photoId, r);
    }
    const sidesByBogie = new Map<string, Set<string>>();
    const byDesignation: Record<string, number> = {};
    for (const f of firsts.values()) {
      const key = `${f.wagonNumber}::${f.bogie}`;
      const sides = sidesByBogie.get(key); if (sides) sides.add(f.side); else sidesByBogie.set(key, new Set([f.side]));
      byDesignation[f.designation] = (byDesignation[f.designation] || 0) + 1;
    }
    let coveredBogies = 0;
    for (const s of sidesByBogie.values()) if (s.has('SIDE_A') && s.has('SIDE_B')) coveredBogies++;
    let agreeing = 0;
    for (const [photoId, rc] of recounts) { const f = firsts.get(photoId); if (f && countsAgree(f.counted, rc.counted)) agreeing++; }
    return { ...pocketDatasetReadiness({ labelledPhotos: firsts.size, coveredBogies, recounts: recounts.size, agreeing }), byDesignation };
  }
}
