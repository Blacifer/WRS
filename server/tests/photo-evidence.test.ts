/**
 * Photo Evidence Tests
 * Indian Railways WRS Raipur
 *
 * WRS Raipur asked for before-and-after photographic evidence of repairs.
 * Photos attached to a part but carried no indication of what they showed, so
 * a gallery could not answer "show me this component before you touched it" —
 * which is the only question the evidence exists to answer.
 *
 * Fixing it surfaced something worse. Three separate places conjured a user
 * row when the actor id was unknown, each inserting an account with a password
 * of 'none': wagon registration, stage transitions, and photo upload. The
 * transition one took the role from the caller, so an unrecognised id could
 * materialise as an active SUPERVISOR. Ghost-user creation had been removed
 * from the inspection path once already with a note never to bring it back.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../src/db/migrations.ts';
import { seedUsers } from '../src/db/seed.ts';
import { WagonRepository } from '../src/db/wagonRepository.ts';

describe('Photo Evidence', () => {
  let db: DatabaseSync;
  let repo: WagonRepository;
  const wagon = 'SECR/EVID/1';

  const upload = (stage: any, itemId: string | null = 'item_1') =>
    repo.insertPhoto({
      wagonNumber: wagon,
      checklistItemId: itemId,
      category: 'BRAKE_SYSTEM',
      partName: 'Brake Beam',
      imageData: 'data:image/jpeg;base64,AAAA',
      inspectorId: 'usr_insp_001',
      inspectorName: 'Ramesh Kumar',
      evidenceStage: stage
    });

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    runMigrations(db);
    seedUsers(db);
    repo = new WagonRepository(db);
    repo.registerWagon({ wagonNumber: wagon, wagonType: 'BOXNHL', owningRailway: 'SECR', createdBy: 'usr_insp_001' });
  });

  it('TC-EVD-01: a photo records what it is evidence of', () => {
    const p = upload('BEFORE');
    const row = db.prepare('SELECT evidence_stage FROM wagon_photos WHERE id = ?').get(p.id) as any;
    assert.strictEqual(row.evidence_stage, 'BEFORE');
  });

  it('TC-EVD-02: a repair is only demonstrable with both halves', () => {
    upload('BEFORE');
    let e = repo.getEvidenceForItem('item_1');
    assert.strictEqual(e.hasBeforeAndAfter, false, 'a before alone proves nothing was fixed');

    upload('AFTER');
    e = repo.getEvidenceForItem('item_1');
    assert.strictEqual(e.hasBeforeAndAfter, true);
    assert.strictEqual(e.before.length, 1);
    assert.strictEqual(e.after.length, 1);
  });

  it('TC-EVD-03: two afters do not substitute for a before', () => {
    upload('AFTER');
    upload('AFTER');
    const e = repo.getEvidenceForItem('item_1');
    assert.strictEqual(e.hasBeforeAndAfter, false);
    assert.strictEqual(e.after.length, 2);
  });

  it('TC-EVD-04: defect photos are kept distinct from repair evidence', () => {
    // A condemnation photograph answers a different question than a repair
    // pair, and folding them together would let one stand in for the other.
    upload('DEFECT');
    const e = repo.getEvidenceForItem('item_1');
    assert.strictEqual(e.defect.length, 1);
    assert.strictEqual(e.hasBeforeAndAfter, false);
  });

  it('TC-EVD-05: an invalid stage is rejected by the database', () => {
    assert.throws(
      () =>
        db.prepare(`
          INSERT INTO wagon_photos (id, wagon_number, file_name, mime_type, file_size, image_data, inspector_id, inspector_name, evidence_stage)
          VALUES ('p_bad', ?, 'a.jpg', 'image/jpeg', 4, 'x', 'usr_insp_001', 'R', 'MAYBE')
        `).run(wagon),
      /CHECK constraint failed/
    );
  });

  it('TC-EVD-06: evidence for one item does not leak into another', () => {
    upload('BEFORE', 'item_1');
    upload('AFTER', 'item_2');
    assert.strictEqual(repo.getEvidenceForItem('item_1').hasBeforeAndAfter, false);
    assert.strictEqual(repo.getEvidenceForItem('item_2').before.length, 0);
  });
});

describe('No Ghost Users', () => {
  let db: DatabaseSync;
  let repo: WagonRepository;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    runMigrations(db);
    seedUsers(db);
    repo = new WagonRepository(db);
  });

  const userCount = () => (db.prepare('SELECT COUNT(*) c FROM users').get() as any).c;

  it('TC-GHOST-01: registering a wagon as an unknown user is refused', () => {
    const before = userCount();
    assert.throws(
      () => repo.registerWagon({ wagonNumber: 'X/1', wagonType: 'BOXNHL', owningRailway: 'SECR', createdBy: 'usr_nobody' }),
      /not registered/
    );
    assert.strictEqual(userCount(), before, 'no account may be conjured by trying');
  });

  it('TC-GHOST-02: a stage transition cannot invent a supervisor', () => {
    // The worst of the three: the conjured account took the role the caller
    // claimed, so an unknown id could arrive as an active SUPERVISOR.
    repo.registerWagon({ wagonNumber: 'X/2', wagonType: 'BOXNHL', owningRailway: 'SECR', createdBy: 'usr_insp_001' });
    const before = userCount();

    assert.throws(
      () =>
        repo.recordTransition({
          wagonNumber: 'X/2',
          fromStage: 'ENTRY_REGISTRATION',
          toStage: 'DISMANTLING',
          transitionType: 'NORMAL',
          performedBy: 'usr_intruder',
          performerName: 'Nobody',
          performerRole: 'SUPERVISOR'
        } as any),
      /not registered/
    );
    assert.strictEqual(userCount(), before);
    assert.strictEqual(
      (db.prepare("SELECT COUNT(*) c FROM users WHERE id='usr_intruder'").get() as any).c,
      0
    );
  });

  it('TC-GHOST-03: photo evidence from an unknown uploader is refused', () => {
    repo.registerWagon({ wagonNumber: 'X/3', wagonType: 'BOXNHL', owningRailway: 'SECR', createdBy: 'usr_insp_001' });
    const before = userCount();
    assert.throws(
      () =>
        repo.insertPhoto({
          wagonNumber: 'X/3',
          imageData: 'x',
          inspectorId: 'usr_nobody',
          inspectorName: 'Nobody'
        }),
      /not registered/
    );
    assert.strictEqual(userCount(), before);
  });

  it('TC-GHOST-04: a deactivated user cannot create records', () => {
    db.prepare("UPDATE users SET is_active = 0 WHERE id = 'usr_insp_002'").run();
    assert.throws(
      () => repo.registerWagon({ wagonNumber: 'X/4', wagonType: 'BOXNHL', owningRailway: 'SECR', createdBy: 'usr_insp_002' }),
      /deactivated/
    );
  });

  it('TC-GHOST-05: a missing actor gives a clear refusal, not a database error', () => {
    assert.throws(
      () => repo.registerWagon({ wagonNumber: 'X/5', wagonType: 'BOXNHL', owningRailway: 'SECR' } as any),
      /no user was supplied/
    );
  });
});
