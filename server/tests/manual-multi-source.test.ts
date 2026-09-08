/**
 * More than one document in the index
 * Indian Railways WRS Raipur
 *
 * WHY THESE EXIST
 * ---------------
 * The index held exactly one document and did not say so. indexManualText
 * DROPped the whole table on every run, so indexing a second document
 * silently destroyed the first — and every passage was cited as "RDSO Wagon
 * Maintenance Manual" whichever document it came from.
 *
 * Both only became visible on the day a second document arrived: an RDSO
 * quality audit check-sheet, which is authoritative, is not the Wagon
 * Maintenance Manual, and describes ROH practice at a DEPOT while this shop
 * does POH. Quoting it to an auditor under the manual's name would be wrong
 * about the document and wrong about the maintenance tier.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { indexManualText, searchManual, citationFor, createManualTables } from '../src/manual/manualIndex.ts';

const MANUAL_TEXT = `
CHAPTER-6 BOGIE
308 E. SPRING FREE HEIGHT
Outer spring nominal free height is 260 mm and the condemning limit is 245 mm.
`;

const AUDIT_TEXT = `
SN Requirements Clause Observation
G Side bearer Nom Cond
Side bearer springs are condemned on the basis of height. It is recommended
springs having variation up to 2 mm in free height are only assembled in the
same bolster.
`;

describe('Holding more than one document', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    createManualTables(db);
  });

  it('TC-MS-01: indexing a second document does not destroy the first', async () => {
    indexManualText(db, MANUAL_TEXT, 'manual.pdf', 'WMM');
    const before = (db.prepare("SELECT COUNT(*) AS c FROM manual_passages WHERE source='WMM'").get() as any).c;
    assert.ok(before > 0, 'the manual should have been indexed');

    indexManualText(db, AUDIT_TEXT, 'audit.pdf', 'ROH_AUDIT');

    const after = (db.prepare("SELECT COUNT(*) AS c FROM manual_passages WHERE source='WMM'").get() as any).c;
    assert.strictEqual(after, before, 'indexing another document must leave the manual alone');
    assert.ok(
      (db.prepare("SELECT COUNT(*) AS c FROM manual_passages WHERE source='ROH_AUDIT'").get() as any).c > 0,
      'and the second document must actually be there'
    );
  });

  it('TC-MS-02: re-indexing one source replaces only that source', async () => {
    indexManualText(db, MANUAL_TEXT, 'manual.pdf', 'WMM');
    indexManualText(db, AUDIT_TEXT, 'audit.pdf', 'ROH_AUDIT');
    const manualBefore = (db.prepare("SELECT COUNT(*) AS c FROM manual_passages WHERE source='WMM'").get() as any).c;

    // The same document again — the ordinary case when a newer revision arrives.
    indexManualText(db, AUDIT_TEXT, 'audit-rev2.pdf', 'ROH_AUDIT');

    assert.strictEqual(
      (db.prepare("SELECT COUNT(*) AS c FROM manual_passages WHERE source='WMM'").get() as any).c,
      manualBefore,
      'the manual must survive a re-index of the audit sheet'
    );
    // And the audit sheet must not have doubled.
    const audit = (db.prepare("SELECT COUNT(*) AS c FROM manual_passages WHERE source='ROH_AUDIT'").get() as any).c;
    const fresh = new DatabaseSync(':memory:');
    createManualTables(fresh);
    indexManualText(fresh, AUDIT_TEXT, 'audit.pdf', 'ROH_AUDIT');
    const expected = (fresh.prepare("SELECT COUNT(*) AS c FROM manual_passages WHERE source='ROH_AUDIT'").get() as any).c;
    assert.strictEqual(audit, expected, 're-indexing must replace, not append');
  });

  it('TC-MS-03: the G-95 tables survive indexing another document', async () => {
    // They are transcribed rather than extracted, so losing them is silent —
    // spring band questions would simply stop returning the table.
    indexManualText(db, MANUAL_TEXT, 'manual.pdf', 'WMM');
    const before = (db.prepare("SELECT COUNT(*) AS c FROM manual_passages WHERE source='G95'").get() as any).c;
    assert.ok(before > 0);

    indexManualText(db, AUDIT_TEXT, 'audit.pdf', 'ROH_AUDIT');
    assert.strictEqual(
      (db.prepare("SELECT COUNT(*) AS c FROM manual_passages WHERE source='G95'").get() as any).c,
      before,
      'the spring tables must not be collateral damage'
    );
  });

  it('TC-MS-04: a passage is cited as the document it came from', async () => {
    indexManualText(db, MANUAL_TEXT, 'manual.pdf', 'WMM');
    indexManualText(db, AUDIT_TEXT, 'audit.pdf', 'ROH_AUDIT');

    const res = searchManual(db, 'side bearer spring free height');
    const auditHit = res.hits.find((h) => h.source === 'ROH_AUDIT');
    assert.ok(auditHit, 'the audit sheet should be searchable');
    assert.doesNotMatch(
      auditHit.citation, /Wagon Maintenance Manual/,
      'the audit check-sheet must never be cited as the manual'
    );
    assert.match(auditHit.citation, /check-sheet/i);
  });

  it('TC-MS-05: the ROH citation says it is depot ROH and this shop does POH', async () => {
    /*
     * The caveat is the point. An inspector quoting a depot ROH clause in a
     * POH workshop should see, in the citation itself, that the tiers differ —
     * this is the shape of the Mark-50 mistake, where an authoritative source
     * described something the shop does not do.
     */
    const c = citationFor('ROH_AUDIT', 8, null, null);
    assert.match(c, /ROH/);
    assert.match(c, /POH/);
  });

  it('TC-MS-06: an unlabelled document is not given the manual’s name', async () => {
    const c = citationFor('SOMETHING_NEW', 3, 'CHAPTER-2', null);
    assert.doesNotMatch(c, /Wagon Maintenance Manual/);
    assert.match(c, /SOMETHING_NEW/);
  });
});
