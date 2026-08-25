/**
 * Inspect-by-Exception, History Suggestions & Concurrency Guard Tests
 * Indian Railways WRS Raipur
 *
 * The critical assertions here are the ones proving the bulk action cannot
 * be used to erase a safety verdict.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../src/db/migrations.ts';
import { seedUsers } from '../src/db/seed.ts';
import { WagonRepository } from '../src/db/wagonRepository.ts';

describe('Inspect by Exception & Concurrency', () => {
  let db: DatabaseSync;
  let repo: WagonRepository;
  const wagon = 'TEST/EXC/0001';

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    runMigrations(db);
    seedUsers(db);
    repo = new WagonRepository(db);
    repo.registerWagon({ wagonNumber: wagon, wagonType: 'BOXNHL', owningRailway: 'SECR',
      createdBy: 'usr_insp_001'
    });
  });

  // -------------------------------------------------------------------------
  // Bulk clear
  // -------------------------------------------------------------------------
  it('TC-EXC-01: requires a meaningful attestation', () => {
    assert.throws(
      () => repo.bulkClearPendingItems(wagon, { attestation: 'ok', userId: 'usr_sup_001' }),
      (err: any) => err.name === 'ValidationError'
    );
    assert.throws(
      () => repo.bulkClearPendingItems(wagon, { attestation: '', userId: 'usr_sup_001' }),
      (err: any) => err.name === 'ValidationError'
    );
  });

  it('TC-EXC-02: clears pending items and reports the count', () => {
    const before = repo.getChecklistItems(wagon).allItems.filter(
      (i: any) => !i.status || i.status === 'PENDING'
    ).length;
    assert.ok(before > 0, 'a fresh wagon should have pending items');

    const result = repo.bulkClearPendingItems(wagon, {
      attestation: 'Walked both bogies, all remaining items physically verified serviceable',
      userId: 'usr_sup_001'
    });

    assert.ok(result.clearedCount > 0);
    assert.ok(result.skippedCategories.includes('SPRINGS'));
  });

  it('TC-EXC-03: NEVER overwrites an existing CONDEMNED verdict', () => {
    const items = repo.getChecklistItems(wagon).allItems;
    const target = items.find((i: any) => i.category === 'BRAKE_SYSTEM');
    assert.ok(target, 'expected a brake item to exist');

    repo.updateChecklistItem(target.id, { status: 'CONDEMNED', conditionNotes: 'Cracked beam' });

    repo.bulkClearPendingItems(wagon, {
      attestation: 'Bulk clearing the remainder after individual exceptions were logged',
      userId: 'usr_sup_001'
    });

    const after = repo.getChecklistItemById(target.id);
    assert.strictEqual(after.status, 'CONDEMNED', 'a condemned verdict must survive the bulk action');
    assert.strictEqual(after.conditionNotes, 'Cracked beam', 'its notes must be untouched too');
  });

  it('TC-EXC-04: NEVER overwrites an existing FAIL verdict', () => {
    const items = repo.getChecklistItems(wagon).allItems;
    const target = items.find((i: any) => i.category === 'WHEELS_AXLES');
    repo.updateChecklistItem(target.id, { status: 'FAIL' });

    repo.bulkClearPendingItems(wagon, {
      attestation: 'Remainder verified serviceable during walk-round inspection',
      userId: 'usr_sup_001'
    });

    assert.strictEqual(repo.getChecklistItemById(target.id).status, 'FAIL');
  });

  it('TC-EXC-05: never bulk-clears SPRINGS — those need measured band data', () => {
    repo.bulkClearPendingItems(wagon, {
      attestation: 'All non-spring items verified serviceable on the shop floor',
      userId: 'usr_sup_001'
    });

    const springs = repo
      .getChecklistItems(wagon)
      .allItems.filter((i: any) => i.category === 'SPRINGS');

    assert.ok(springs.length > 0);
    for (const s of springs) {
      assert.notStrictEqual(
        s.status,
        'PASS',
        `Spring "${s.partName}" was bulk-passed without a measurement — springs must be measured.`
      );
    }
  });

  it('TC-EXC-06: records the attestation on every cleared item', () => {
    const attestation = 'Joint walk-round with SSE, all remaining items serviceable';
    repo.bulkClearPendingItems(wagon, { attestation, userId: 'usr_sup_001' });

    const cleared = repo
      .getChecklistItems(wagon)
      .allItems.filter((i: any) => i.status === 'PASS' && i.category !== 'SPRINGS');

    assert.ok(cleared.length > 0);
    for (const item of cleared) {
      assert.ok(
        String(item.conditionNotes || '').includes(attestation),
        'each cleared item must carry the attestation for traceability'
      );
    }
  });

  it('TC-EXC-07: writes an audit entry naming the actor and the items', () => {
    repo.bulkClearPendingItems(wagon, {
      attestation: 'Verified all remaining components during final walk-round',
      userId: 'usr_sup_001',
      userRole: 'SUPERVISOR'
    });

    const row = db.prepare(`
      SELECT user_id, payload_json FROM inspection_audit_log
      WHERE event_type = 'CHECKLIST_ITEM_UPDATED'
      ORDER BY rowid DESC LIMIT 1
    `).get() as any;

    assert.ok(row, 'a bulk clear must be audited');
    const payload = JSON.parse(row.payload_json);
    assert.strictEqual(row.user_id, 'usr_sup_001');
    assert.strictEqual(payload.action, 'BULK_CLEAR_BY_EXCEPTION');
    assert.ok(payload.clearedCount > 0);
    assert.ok(Array.isArray(payload.clearedItems));
  });

  // -------------------------------------------------------------------------
  // History suggestions
  // -------------------------------------------------------------------------
  it('TC-EXC-08: stays silent when there is not enough history', () => {
    const { suggestions } = repo.suggestChecklistStatuses(wagon);
    assert.ok(suggestions.length > 0, 'pending items should be listed');
    for (const s of suggestions) {
      assert.strictEqual(s.suggestedStatus, 'PENDING');
      assert.strictEqual(s.confidence, 0);
    }
  });

  it('TC-EXC-09: suggests from history once evidence exists, citing its basis', () => {
    // Build history for one part across several other wagons.
    for (let i = 0; i < 6; i++) {
      const w = `TEST/HIST/${i}`;
      repo.registerWagon({ wagonNumber: w, wagonType: 'BOXNHL', owningRailway: 'SECR',
      createdBy: 'usr_insp_001'
    });
      const item = repo
        .getChecklistItems(w)
        .allItems.find((x: any) => x.partName === 'Brake Beams & Truss Assembly');
      if (item) repo.updateChecklistItem(item.id, { status: 'PASS' });
    }

    const { suggestions } = repo.suggestChecklistStatuses(wagon);
    const s = suggestions.find((x) => x.partName === 'Brake Beams & Truss Assembly');

    assert.ok(s, 'expected a suggestion for the part with history');
    assert.strictEqual(s!.suggestedStatus, 'PASS');
    assert.ok(s!.confidence > 0.5);
    assert.ok(s!.basis.includes('previous inspections'), 'must cite the evidence behind it');
  });

  // -------------------------------------------------------------------------
  // Concurrency
  // -------------------------------------------------------------------------
  it('TC-EXC-10: rejects a stale write instead of silently overwriting', () => {
    const item = repo.getChecklistItems(wagon).allItems[0];
    const original = repo.getChecklistItemById(item.id);

    // Inspector A reads, then Inspector B writes first.
    repo.updateChecklistItem(item.id, { status: 'FAIL', conditionNotes: 'B found a crack' });

    // Inspector A now submits against the version they read.
    assert.throws(
      () =>
        repo.updateChecklistItem(
          item.id,
          { status: 'PASS' },
          { expectedUpdatedAt: original.updatedAt }
        ),
      (err: any) => err.name === 'ConflictError'
    );

    assert.strictEqual(
      repo.getChecklistItemById(item.id).status,
      'FAIL',
      "the earlier writer's verdict must survive"
    );
  });

  it('TC-EXC-11: a write with the current version still succeeds', () => {
    const item = repo.getChecklistItems(wagon).allItems[0];
    const current = repo.getChecklistItemById(item.id);

    const updated = repo.updateChecklistItem(
      item.id,
      { status: 'PASS' },
      { expectedUpdatedAt: current.updatedAt }
    );

    assert.strictEqual(updated.status, 'PASS');
  });

  it('TC-EXC-12: omitting the version keeps the old last-write-wins behaviour', () => {
    // Backwards compatibility: existing callers that do not send a version
    // must keep working rather than breaking on a new required field.
    const item = repo.getChecklistItems(wagon).allItems[0];
    repo.updateChecklistItem(item.id, { status: 'FAIL' });
    const updated = repo.updateChecklistItem(item.id, { status: 'PASS' });
    assert.strictEqual(updated.status, 'PASS');
  });
});
