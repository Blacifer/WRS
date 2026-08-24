/**
 * Maintenance Manual Search Tests
 * Indian Railways WRS Raipur
 *
 * The important property under test is that this NEVER invents an answer.
 * Every result must be text that genuinely exists in the indexed source,
 * attributed to the page it came from.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  indexManualText,
  searchManual,
  buildPassages,
  isManualIndexed,
  getManualStats
} from '../src/manual/manualIndex.ts';

// A small stand-in for the manual, using its real structure: form-feed page
// breaks, chapter headings, and clause tables.
const FAKE_MANUAL = [
  `CHAPTER-3 YARD MAINTENANCE

308 A. BRAKE GEAR LIMIT AND CLEARANCES:
                     Description                          Limit
 Brake block condemning limits                            10 mm
 Yard leaving thickness of brake block except BOY wagon   20 mm`,

  `CHAPTER-3 YARD MAINTENANCE

309 D. WEAR LIMIT FOR FRICTION WEDGE BLOCK
Vertical Surface                                  7 mm
Slope Surface                                     3 mm

310 E. CENTRE PIVOT WEAR LIMIT`,

  `CHAPTER-6 BOGIE

(b) Grouping of Springs: (By strip method)
Matching of both, load and snubber springs, is important. It is
recommended that springs having not more than 3 mm free height
variation should be assembled in the same group.`
].join('\f');

describe('Maintenance Manual Search', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    indexManualText(db, FAKE_MANUAL, 'test-manual.pdf');
  });

  it('TC-MAN-01: reports itself as indexed with real counts', () => {
    const stats = getManualStats(db) as any;
    assert.strictEqual(stats.indexed, true);
    assert.ok(stats.passageCount > 0);
    assert.strictEqual(stats.pageCount, 3);
    assert.strictEqual(stats.sourceName, 'test-manual.pdf');
  });

  it('TC-MAN-02: attributes every passage to a page', () => {
    const passages = buildPassages(FAKE_MANUAL);
    assert.ok(passages.length >= 3);
    for (const p of passages) {
      assert.ok(p.page >= 1 && p.page <= 3, `page ${p.page} out of range`);
      assert.ok(p.text.length > 0);
    }
  });

  it('TC-MAN-03: finds the brake block limit and cites its page', () => {
    const { hits } = searchManual(db, 'what is the brake block condemning limit', 3);
    assert.ok(hits.length > 0, 'expected at least one hit');
    assert.ok(hits[0].text.includes('10 mm'), 'the answer must be present in the returned text');
    assert.strictEqual(hits[0].page, 1);
    assert.ok(hits[0].citation.includes('page 1'));
  });

  it('TC-MAN-04: distinguishes the two friction wedge surfaces', () => {
    const { hits } = searchManual(db, 'wear limit friction wedge slope surface', 3);
    assert.ok(hits.length > 0);
    const text = hits[0].text;
    assert.ok(text.includes('Slope Surface'));
    assert.ok(text.includes('3 mm'));
    assert.ok(text.includes('Vertical Surface'));
    assert.ok(text.includes('7 mm'));
  });

  it('TC-MAN-05: finds the spring grouping rule', () => {
    const { hits } = searchManual(db, 'spring free height variation same group', 3);
    assert.ok(hits.length > 0);
    assert.ok(hits[0].text.includes('3 mm free height'));
    assert.strictEqual(hits[0].page, 3);
  });

  it('TC-MAN-06: returns a highlighted excerpt of the match', () => {
    const { hits } = searchManual(db, 'brake block condemning', 1);
    assert.ok(hits[0].snippet.length > 0);
    assert.ok(hits[0].snippet.includes('«'), 'matched terms should be marked for highlighting');
  });

  it('TC-MAN-07: NEVER returns text that is not in the source', () => {
    // The guarantee that makes this safe to consult for a safety limit.
    const queries = [
      'brake block condemning limit',
      'friction wedge wear',
      'spring grouping',
      'centre pivot'
    ];
    for (const q of queries) {
      const { hits } = searchManual(db, q, 5);
      for (const h of hits) {
        assert.ok(
          FAKE_MANUAL.includes(h.text),
          `Returned a passage that does not exist verbatim in the source: "${h.text.slice(0, 60)}"`
        );
      }
    }
  });

  it('TC-MAN-08: a question with no answer returns nothing rather than a guess', () => {
    const { hits } = searchManual(db, 'zzzqqq nonexistent terminology xyzzy', 5);
    assert.strictEqual(hits.length, 0, 'must not fabricate a match');
  });

  it('TC-MAN-09: punctuation in a natural question does not break the query', () => {
    // FTS5 treats much punctuation as syntax; an inspector's phrasing must not
    // produce a query error.
    for (const q of [
      "what's the brake block limit?",
      'friction wedge — slope surface (wear)',
      'spring height: 3mm variation?'
    ]) {
      assert.doesNotThrow(() => searchManual(db, q, 3), `query threw: ${q}`);
    }
  });

  it('TC-MAN-10: an unindexed database says so instead of returning nothing', () => {
    const empty = new DatabaseSync(':memory:');
    assert.strictEqual(isManualIndexed(empty), false);
    assert.throws(
      () => searchManual(empty, 'brake block limit', 3),
      (err: any) => err.name === 'ManualNotIndexed'
    );
  });

  it('TC-MAN-11: re-indexing replaces rather than duplicates', () => {
    const before = (getManualStats(db) as any).passageCount;
    indexManualText(db, FAKE_MANUAL, 'test-manual.pdf');
    const after = (getManualStats(db) as any).passageCount;
    assert.strictEqual(after, before, 're-indexing must not duplicate passages');
  });
});
