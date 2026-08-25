/**
 * Spring -> Checklist Auto-Link Tests
 * Indian Railways WRS Raipur
 *
 * Regression cover for a safety defect: a single OUTER spring measurement
 * was matched to BOTH bogies' checklist items, so measuring one spring marked
 * two as verified and the exit gate would clear a bogie whose springs had
 * never been measured.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../src/db/migrations.ts';
import { seedUsers } from '../src/db/seed.ts';
import { WagonRepository } from '../src/db/wagonRepository.ts';
import { InspectionRepository } from '../src/db/repository.ts';

describe('Spring to Checklist Auto-Link', () => {
  let db: DatabaseSync;
  let wagonRepo: WagonRepository;
  let inspectionRepo: InspectionRepository;
  const wagon = 'TEST/LINK/0001';

  const measure = (position: string, bogiePosition: string | null, height: number, status = 'PASS') =>
    inspectionRepo.insertInspection({
      wagonNumber: wagon,
      bogieType: 'CASNUB_22_NLB',
      condition: 'USED',
      springPosition: position as any,
      bogiePosition: bogiePosition as any,
      measuredFreeHeight: height,
      classifiedBand: status === 'PASS' ? 'BLUE' : null,
      bandRoman: status === 'PASS' ? 'Band I' : null,
      status: status as any,
      tableReference: 'Table 28',
      valid_range_min: 245,
      valid_range_max: 263,
      inspectorId: 'usr_insp_001'
    });

  const springItems = () =>
    wagonRepo
      .getChecklistItems(wagon)
      .allItems.filter((i: any) => i.category === 'SPRINGS')
      .reduce((acc: Record<string, string>, i: any) => {
        acc[i.partName] = i.status;
        return acc;
      }, {});

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    runMigrations(db);
    seedUsers(db);
    wagonRepo = new WagonRepository(db);
    inspectionRepo = new InspectionRepository(db);
    wagonRepo.registerWagon({ wagonNumber: wagon, wagonType: 'BOXNHL', owningRailway: 'SECR',
      createdBy: 'usr_insp_001'
    });
  });

  it('TC-LINK-01: measuring Bogie 1 does NOT mark Bogie 2 as verified', () => {
    measure('OUTER', 'BOGIE_1', 260);
    const items = springItems();

    assert.strictEqual(items['Outer Spring (Bogie 1)'], 'PASS');
    assert.strictEqual(
      items['Outer Spring (Bogie 2)'],
      'PENDING',
      'Measuring one bogie must never clear the other — that would release an unmeasured bogie.'
    );
  });

  it('TC-LINK-02: measuring both bogies clears both', () => {
    measure('OUTER', 'BOGIE_1', 260);
    measure('OUTER', 'BOGIE_2', 258);
    const items = springItems();

    assert.strictEqual(items['Outer Spring (Bogie 1)'], 'PASS');
    assert.strictEqual(items['Outer Spring (Bogie 2)'], 'PASS');
  });

  it('TC-LINK-03: the link is persisted, not just a display-time overlay', () => {
    measure('INNER', 'BOGIE_2', 262);

    // The link is reconciled lazily, on read — which is how every real caller
    // reaches it (checklist view, exit gate, certificate all go through
    // getChecklistItems). What matters is that the reconciliation is then
    // WRITTEN, so anything querying the table afterwards sees the same truth.
    wagonRepo.getChecklistItems(wagon);

    const row = db.prepare(`
      SELECT status, phase1_inspection_id FROM checklist_items
      WHERE wagon_number = ? AND part_name = 'Inner Spring (Bogie 2)'
    `).get(wagon) as any;

    assert.strictEqual(row.status, 'PASS', 'status must be written to the database');
    assert.ok(row.phase1_inspection_id, 'the originating inspection must be recorded on the item');
  });

  it('TC-LINK-04: a condemned spring propagates as CONDEMNED to its own bogie only', () => {
    measure('SNUBBER', 'BOGIE_1', 240, 'CONDEMNED');
    const items = springItems();

    assert.strictEqual(items['Snubber Spring (Bogie 1)'], 'CONDEMNED');
    assert.strictEqual(items['Snubber Spring (Bogie 2)'], 'PENDING');
  });

  it('TC-LINK-05: positions do not bleed into each other', () => {
    measure('OUTER', 'BOGIE_1', 260);
    const items = springItems();

    assert.strictEqual(items['Inner Spring (Bogie 1)'], 'PENDING');
    assert.strictEqual(items['Snubber Spring (Bogie 1)'], 'PENDING');
  });

  it('TC-LINK-06: legacy rows without a bogie do not clear a bogie-specific item', () => {
    // Rows created before bogie_position existed genuinely do not know which
    // bogie they came from, and must not be guessed into clearing one.
    measure('OUTER', null, 260);
    const items = springItems();

    assert.strictEqual(
      items['Outer Spring (Bogie 1)'],
      'PENDING',
      'An inspection of unknown bogie must not satisfy a bogie-specific item.'
    );
    assert.strictEqual(items['Outer Spring (Bogie 2)'], 'PENDING');
  });

  it('TC-LINK-07: the exit gate reflects the corrected linkage', () => {
    measure('OUTER', 'BOGIE_1', 260);
    measure('INNER', 'BOGIE_1', 262);
    measure('SNUBBER', 'BOGIE_1', 294);

    const gate = wagonRepo.evaluateExitGate(wagon);
    const springBlockers = gate.blockers.filter((b: string) => b.includes('Spring'));

    // Bogie 2's three springs are still unmeasured and must still block.
    assert.ok(
      springBlockers.some((b: string) => b.includes('Bogie 2')),
      'Bogie 2 springs must still block release when only Bogie 1 was measured'
    );
    assert.ok(
      !springBlockers.some((b: string) => b.includes('Bogie 1')),
      'Bogie 1 springs should no longer block once measured'
    );
  });

  it('TC-LINK-08: auto-linked items record the measurement that cleared them', () => {
    measure('OUTER', 'BOGIE_1', 259.5);

    const item = wagonRepo
      .getChecklistItems(wagon)
      .allItems.find((i: any) => i.partName === 'Outer Spring (Bogie 1)');

    assert.ok(
      String(item.conditionNotes || '').includes('259.5'),
      'the clearing measurement should be visible on the checklist item'
    );
  });
});
