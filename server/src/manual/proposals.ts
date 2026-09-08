/**
 * Checklist lines the manual can propose, for the shop to accept or refuse
 * Indian Railways WRS Raipur
 *
 * WHY THIS EXISTS
 * ---------------
 * The DRM's picture of a wagon is "a hundred and fifty parts, every one seen
 * and spoken for". The manual holds no single list of them: what POH must do
 * is spread across chapters as procedures, plus the must-change tables in
 * Chapter 7 and Appendix-V. The template holds 41 lines built from G-95 and
 * photographs.
 *
 * Nobody may hardcode the gap closed. Fourteen Mark-50 coupler items were
 * once added that way and every wagon's exit gate stayed shut for a week. So
 * this PROPOSES: it extracts the lines the manual states plainly enough to
 * extract, cites the page for each, and the shop's administrator accepts or
 * refuses them one at a time, setting the category and whether they gate.
 * Every accepted line carries "WMM 2.0 p.N" as its source, which is what
 * makes it answerable later.
 *
 * WHAT IS EXTRACTED, AND WHAT IS DELIBERATELY NOT
 * -----------------------------------------------
 * Must-change tables — "SNo  Component  Qty/Wagon" — extract cleanly and
 * mean one unambiguous thing: replace at every POH. Those are offered.
 *
 * Imperative procedure lines ("Check the hoses for cracks") extract noisily
 * — test steps, yard instructions and Chapter 12's supervisory duties all
 * match the same grammar. They are offered only from the overhaul chapters
 * (5, 6, 7) and only from passages that say POH, which on a dry run cut
 * ninety-four candidates to a handful that are genuinely parts checks.
 */

import type { DatabaseSync } from 'node:sqlite';

export interface ChecklistProposal {
  /** Stable across runs, so a screen can remember what was refused. */
  key: string;
  partName: string;
  kind: 'MUST_CHANGE' | 'PROCEDURE';
  /** Quantity per wagon, for must-change rows. */
  qtyPerWagon: number | null;
  /** The category the words suggest — a guess the administrator corrects. */
  suggestedCategory: string;
  page: number;
  chapter: string | null;
  excerpt: string;
  standardReference: string;
  /** True when a line with a similar name already exists on this wagon type. */
  alreadyListed: boolean;
}

const CATEGORY_HINTS: Array<[RegExp, string]> = [
  [/spring/i, 'SPRINGS'],
  [/\b(ctrb|bearing|adapter|grease|seal|end cap|locking plate)\b/i, 'BEARINGS'],
  [/\b(wheel|axle|tread|flange|journal)\b/i, 'WHEELS_AXLES'],
  [/\b(coupler|knuckle|draft|yoke|striker|cbc|lock)\b/i, 'COUPLERS_DRAFT_GEAR'],
  [/\b(side frame|bolster|pivot|side bearer|wedge|liner|spring plank|elastomeric)\b/i, 'BOGIE_FRAME_BOLSTER'],
  [/\b(brake|cylinder|apm|hose|reservoir|valve|clevis|piston|rigging|slack|distributor|angle cock|pipe|o-ring|washer|pin)\b/i, 'BRAKE_SYSTEM'],
  [/\b(door|floor|sole bar|headstock|body|underframe|stencil|paint)\b/i, 'BODY_UNDERFRAME']
];

function guessCategory(name: string): string {
  for (const [re, cat] of CATEGORY_HINTS) if (re.test(name)) return cat;
  return 'GENERAL_WAGON';
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function overhaulChapter(chapter: string | null): boolean {
  return /CHAPTER-?\s*[567]\b/i.test(String(chapter || ''));
}

export function extractChecklistProposals(
  db: DatabaseSync,
  existingPartNames: string[]
): ChecklistProposal[] {
  const existing = existingPartNames.map(norm);
  const listed = (name: string) => {
    const n = norm(name);
    return existing.some((e) => e.includes(n) || n.includes(e));
  };

  const rows = db
    .prepare("SELECT page, chapter, body FROM manual_passages WHERE source = 'WMM' ORDER BY page")
    .all() as Array<{ page: number; chapter: string | null; body: string }>;

  const out: ChecklistProposal[] = [];
  const seen = new Set<string>();

  for (const r of rows) {
    if (!overhaulChapter(r.chapter)) continue;
    const lines = r.body.split('\n');
    const isMustTable = /must change|qty\s*\/\s*wagon|qty per wagon/i.test(r.body);
    const mentionsPoh = /\bPOH\b/.test(r.body);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (isMustTable) {
        const m = line.match(/^\s*(\d{1,3})\s+([A-Za-z][A-Za-z0-9 ;,&()\/.'-]{4,70}?)\s+(\d{1,3})\s*$/);
        if (m) {
          const name = m[2].replace(/\s+/g, ' ').trim();
          const key = `mc:${norm(name)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({
            key, partName: name, kind: 'MUST_CHANGE', qtyPerWagon: Number(m[3]),
            suggestedCategory: guessCategory(name), page: r.page, chapter: r.chapter,
            excerpt: line.trim(),
            standardReference: `WMM 2.0 p.${r.page} — must-change item at POH`,
            alreadyListed: listed(name)
          });
          continue;
        }
      }

      if (mentionsPoh) {
        const c = line.match(/^\s*(?:[a-z]\)|[ivx]+\.|\d{1,2}\.)\s*((?:Check|Replace|Examine|Overhaul|Inspect|Measure|Renew)\b[^.]{8,120})/i);
        if (c) {
          const text = c[1].replace(/\s+/g, ' ').trim();
          const key = `pr:${norm(text).slice(0, 48)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({
            key, partName: text, kind: 'PROCEDURE', qtyPerWagon: null,
            suggestedCategory: guessCategory(text), page: r.page, chapter: r.chapter,
            excerpt: [lines[i - 1], line, lines[i + 1]].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().slice(0, 240),
            standardReference: `WMM 2.0 p.${r.page} — POH schedule`,
            alreadyListed: listed(text)
          });
        }
      }
    }
  }
  return out;
}
