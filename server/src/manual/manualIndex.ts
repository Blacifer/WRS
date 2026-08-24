/**
 * RDSO Wagon Maintenance Manual — Searchable Index
 * Indian Railways WRS Raipur
 *
 * Turns the 658-page manual into something an inspector can actually ask a
 * question of, on the shop floor, in seconds.
 *
 * WHY RETRIEVAL AND NOT A LANGUAGE MODEL
 * --------------------------------------
 * This answers questions about safety limits. A model that paraphrases
 * "the wear limit is around 7mm" is worse than useless here — it is
 * dangerous, and it cannot be audited. This returns the manual's own words,
 * verbatim, with the page it came from, and never invents a number.
 *
 * It also runs entirely inside the existing SQLite database using FTS5 with
 * BM25 ranking: no API key, no per-query cost, no network. That matters on a
 * shop floor with patchy connectivity, and it means the feature keeps working
 * when the internet does not.
 */

import fs from 'node:fs';
import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

/** Roughly one screenful of context — big enough to hold a table, small enough to read. */
const MAX_CHUNK_CHARS = 800;
/** Overlap so an answer split across a boundary is still findable from either side. */
const CHUNK_OVERLAP_CHARS = 160;

export interface ManualPassage {
  id: string;
  page: number;
  chapter: string | null;
  heading: string | null;
  text: string;
}

export interface ManualSearchHit {
  page: number;
  chapter: string | null;
  heading: string | null;
  /** The matching excerpt, with the matched terms marked by «». */
  snippet: string;
  /** The full passage, for reading around the answer. */
  text: string;
  /** Lower is a better match (BM25 convention); exposed for transparency. */
  score: number;
  citation: string;
}

export function createManualTables(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS manual_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  // contentless=0 so the passage text is stored and returned verbatim.
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS manual_passages USING fts5(
      passage_id UNINDEXED,
      page UNINDEXED,
      chapter,
      heading,
      body
    );
  `);
}

/** True when an index has already been built into this database. */
export function isManualIndexed(db: DatabaseSync): boolean {
  try {
    const row = db.prepare("SELECT value FROM manual_meta WHERE key = 'passage_count'").get() as any;
    return !!row && Number(row.value) > 0;
  } catch {
    return false;
  }
}

export function getManualStats(db: DatabaseSync): Record<string, unknown> {
  try {
    const rows = db.prepare('SELECT key, value FROM manual_meta').all() as any[];
    const meta: Record<string, string> = {};
    for (const r of rows) meta[r.key] = r.value;
    return {
      indexed: isManualIndexed(db),
      passageCount: Number(meta.passage_count || 0),
      pageCount: Number(meta.page_count || 0),
      sourceName: meta.source_name || null,
      indexedAt: meta.indexed_at || null
    };
  } catch {
    return { indexed: false, passageCount: 0, pageCount: 0 };
  }
}

/**
 * Splits the extracted manual text into overlapping, page-attributed passages.
 *
 * Page numbers come from the form feeds pdftotext emits, which makes every
 * answer citable back to a physical page an inspector or the DRM can open.
 */
export function buildPassages(rawText: string): ManualPassage[] {
  const pages = rawText.split('\f');
  const passages: ManualPassage[] = [];

  let currentChapter: string | null = null;

  pages.forEach((pageText, pageIdx) => {
    const pageNumber = pageIdx + 1;
    const lines = pageText.split('\n');

    // Track the most recent chapter heading so a hit can say where it sits.
    for (const line of lines) {
      const m = line.match(/^\s*(CHAPTER[\s-]*\d+[^\n]{0,80})/i);
      if (m) currentChapter = m[1].trim().replace(/\s+/g, ' ');
    }

    const cleaned = lines
      .map((l) => l.replace(/\s+$/g, ''))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    if (cleaned.length < 60) return; // skip near-empty pages

    // A lettered or numbered heading near the top gives the passage a label.
    const headingMatch = cleaned.match(
      /^(?:\s*)((?:[a-z]\)|\d{3}[A-Z]?\.?|[A-Z][A-Z \-&,/()]{6,60})[^\n]{0,80})/m
    );
    const heading = headingMatch ? headingMatch[1].trim().replace(/\s+/g, ' ') : null;

    if (cleaned.length <= MAX_CHUNK_CHARS) {
      passages.push({
        id: `mp_${pageNumber}_0`,
        page: pageNumber,
        chapter: currentChapter,
        heading,
        text: cleaned
      });
      return;
    }

    let start = 0;
    let chunkIdx = 0;
    while (start < cleaned.length) {
      let end = Math.min(start + MAX_CHUNK_CHARS, cleaned.length);

      // Prefer to break on a blank line so tables and paragraphs stay intact.
      if (end < cleaned.length) {
        const breakAt = cleaned.lastIndexOf('\n\n', end);
        if (breakAt > start + MAX_CHUNK_CHARS * 0.5) end = breakAt;
      }

      const slice = cleaned.slice(start, end).trim();
      if (slice.length >= 60) {
        passages.push({
          id: `mp_${pageNumber}_${chunkIdx}`,
          page: pageNumber,
          chapter: currentChapter,
          heading,
          text: slice
        });
        chunkIdx++;
      }

      if (end >= cleaned.length) break;
      start = Math.max(end - CHUNK_OVERLAP_CHARS, start + 1);
    }
  });

  return passages;
}

/** Builds (or rebuilds) the index from already-extracted manual text. */
export function indexManualText(
  db: DatabaseSync,
  rawText: string,
  sourceName: string
): { passageCount: number; pageCount: number } {
  createManualTables(db);

  db.exec('DELETE FROM manual_passages;');
  db.exec('DELETE FROM manual_meta;');

  const passages = buildPassages(rawText);
  const insert = db.prepare(`
    INSERT INTO manual_passages (passage_id, page, chapter, heading, body)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const p of passages) {
    insert.run(p.id, p.page, p.chapter, p.heading, p.text);
  }

  const pageCount = rawText.split('\f').length;
  const metaStmt = db.prepare('INSERT OR REPLACE INTO manual_meta (key, value) VALUES (?, ?)');
  metaStmt.run('passage_count', String(passages.length));
  metaStmt.run('page_count', String(pageCount));
  metaStmt.run('source_name', sourceName);
  metaStmt.run('indexed_at', new Date().toISOString());
  metaStmt.run('source_sha256', crypto.createHash('sha256').update(rawText).digest('hex').slice(0, 16));

  return { passageCount: passages.length, pageCount };
}

/** Convenience for the CLI: index straight from an extracted .txt file. */
export function indexManualFromFile(db: DatabaseSync, filePath: string) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return indexManualText(db, raw, filePath.split('/').pop() || 'manual.txt');
}

/**
 * FTS5 MATCH treats a lot of punctuation as syntax, so a natural question
 * typed by an inspector would otherwise throw a syntax error. Each word is
 * quoted and OR-ed, which also means a partially-matching question still
 * returns its best passages rather than nothing.
 */
function extractTerms(question: string): string[] {
  const STOPWORDS = new Set([
    'what', 'is', 'the', 'a', 'an', 'of', 'for', 'to', 'in', 'on', 'and', 'or',
    'how', 'much', 'many', 'do', 'does', 'i', 'we', 'my', 'it', 'its', 'be',
    'are', 'was', 'were', 'can', 'should', 'when', 'which', 'that', 'this'
  ]);

  const terms = question
    .toLowerCase()
    .replace(/[^a-z0-9\s.\-]/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^[.\-]+|[.\-]+$/g, ''))
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));

  return terms.map((t) => t.replace(/"/g, ''));
}

/**
 * Progressively looser queries, tried in order until one returns hits.
 * Requiring every term first gives a precise answer when the inspector's
 * wording matches the manual's; the OR fallback means an imperfectly worded
 * question still gets the best available passages instead of nothing.
 */
function toMatchQueries(question: string): string[] {
  const terms = extractTerms(question);
  if (terms.length === 0) return [];
  const quoted = terms.map((t) => `"${t}"`);

  const queries: string[] = [];
  if (quoted.length > 1) {
    queries.push(quoted.join(' AND '));
    queries.push(`NEAR(${quoted.join(' ')}, 30)`);
  }
  queries.push(quoted.join(' OR '));
  return queries;
}

export function searchManual(
  db: DatabaseSync,
  question: string,
  limit = 5
): { query: string; hits: ManualSearchHit[] } {
  if (!isManualIndexed(db)) {
    const err: any = new Error(
      'The maintenance manual has not been indexed on this server yet. Run "npm run index-manual".'
    );
    err.name = 'ManualNotIndexed';
    throw err;
  }

  const queries = toMatchQueries(question);
  if (queries.length === 0) return { query: question, hits: [] };

  // snippet() returns the part of the passage that actually matched, so the
  // answer is not buried in the middle of a wall of text. Column 4 is `body`.
  const stmt = db.prepare(`
    SELECT page, chapter, heading, body,
           snippet(manual_passages, 4, '«', '»', ' … ', 40) AS excerpt,
           bm25(manual_passages) AS score
    FROM manual_passages
    WHERE manual_passages MATCH ?
    ORDER BY score
    LIMIT ?
  `);

  let rows: any[] = [];
  for (const q of queries) {
    try {
      rows = stmt.all(q, Math.min(limit, 20)) as any[];
    } catch {
      continue; // malformed for FTS5 syntax — fall through to the looser tier
    }
    if (rows.length > 0) break;
  }

  return {
    query: question,
    hits: rows.map((r) => ({
      page: Number(r.page),
      chapter: r.chapter || null,
      heading: r.heading || null,
      snippet: String(r.excerpt || '').replace(/\s+/g, ' ').trim(),
      text: r.body,
      score: Number(r.score),
      citation: `RDSO Wagon Maintenance Manual, page ${r.page}${r.chapter ? ` — ${r.chapter}` : ''}`
    }))
  };
}
