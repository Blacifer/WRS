/**
 * Exit gate — property-based
 * Indian Railways WRS Raipur
 *
 * WHY GENERATED STATES
 * --------------------
 * The exit gate carries the system's central promise: a wagon does not leave
 * with anything outstanding. Every existing test exercises it with states
 * somebody thought to write down, which means it is tested against the cases
 * we already had in mind — exactly the cases least likely to contain the bug.
 *
 * This drives it with hundreds of randomly generated checklist states and
 * checks one invariant each time:
 *
 *     canRelease === true  ⟹  every mandatory item is genuinely satisfied
 *
 * "Satisfied" is computed here independently, from the rule as written in the
 * manual — PASS, or REPAIRED/REPLACED and re-inspected PASS. It deliberately
 * does not call the gate's own helper, because a test that computes the
 * expected answer with the code under test proves only that the code is
 * consistent with itself.
 *
 * The generator is seeded so any failure can be replayed exactly rather than
 * being a story about a build that once went red.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';
import { generateToken } from '../src/auth/jwt.ts';
import { getDatabase } from '../src/db/connection.ts';
import { WagonRepository } from '../src/db/wagonRepository.ts';
import type { ExpressApp } from '../src/framework/index.ts';

/** Deterministic PRNG (mulberry32) so a red run is reproducible. */
function rng(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STATUSES = ['PENDING', 'PASS', 'FAIL', 'CONDEMNED', 'REPAIRED', 'REPLACED'] as const;
const REINSPECTED = [null, 'PASS', 'FAIL'] as const;

/**
 * The rule, restated from the manual rather than borrowed from the code under
 * test: a mandatory item is satisfied when it passed, or when it was repaired
 * or replaced AND the re-inspection passed.
 */
function isSatisfied(status: string, reinspected: string | null): boolean {
  if (status === 'PASS') return true;
  if ((status === 'REPAIRED' || status === 'REPLACED') && reinspected === 'PASS') return true;
  return false;
}

describe('Exit gate invariants under generated states', () => {
  let app: ExpressApp;
  let repo: WagonRepository;
  let supervisorToken: string;

  before(() => {
    app = createApp(':memory:');
    repo = new WagonRepository(getDatabase());
    supervisorToken = generateToken({
      id: 'usr_sup_001', username: 'supervisor1', role: 'SUPERVISOR', name: 'S. K. Verma'
    } as any);
  });


  /**
   * Satisfies everything the gate demands that is not a checklist item, so the
   * generated checklist state is the only thing varying.
   */
  async function satisfyNonChecklistRules(wagonNumber: string): Promise<void> {
    const enc = encodeURIComponent(wagonNumber);
    const auth = { authorization: `Bearer ${supervisorToken}`, 'content-type': 'application/json' };

    await app.dispatch({
      method: 'POST',
      url: `/api/wagons/${enc}/swt`,
      headers: auth,
      body: {
        pipeType: 'SINGLE',
        loadCondition: 'EMPTY',
        readings: [
          { ref: '1', value: 5.0 }, { ref: '1a', value: 6.0 }, { ref: '2', value: 5.0 },
          { ref: '2a', value: 6.0 }, { ref: '3', value: 0.05 }, { ref: '4.1', value: 24 },
          { ref: '4.2', value: 3.8 }, { ref: '4.3', value: 1.45 }, { ref: '5.1', value: 52 },
          { ref: '6', value: 4 }, { ref: '7', observed: true }, { ref: '8.1', value: 24 },
          { ref: '8.2', value: 3.8 }, { ref: '9', value: 85 }, { ref: '10', value: 0.05 },
          { ref: '12', observed: true }
        ]
      }
    });

    const order = ['ENTRY_REGISTRATION', 'DISMANTLING', 'COMPONENT_INSPECTION',
                   'REPAIR_REPLACEMENT', 'REASSEMBLY', 'FINAL_QC_GATE'];
    for (let i = 0; i < order.length; i++) {
      const current = repo.getWagonByNumber(wagonNumber)?.currentStage;
      if (current === 'FINAL_QC_GATE') break;
      const next = order[order.indexOf(current as string) + 1];
      if (!next) break;
      await app.dispatch({
        method: 'POST',
        url: `/api/wagons/${enc}/transition`,
        headers: auth,
        body: { targetStage: next, notes: 'property test setup' }
      });
    }
  }

  test('a wagon is never releasable with an unsatisfied mandatory item', async () => {
    const random = rng(20260826);
    const db = getDatabase();
    const ITERATIONS = 200;

    const wagonNumber = 'PROP/BOXNHL/00001';
    await app.dispatch({
      method: 'POST',
      url: '/api/wagons/register',
      headers: { authorization: `Bearer ${supervisorToken}`, 'content-type': 'application/json' },
      body: { wagonNumber, wagonType: 'BOXNHL', owningRailway: 'SECR' }
    });

    /*
     * The checklist is not the gate's only rule — it also requires the §720-C
     * air brake test and Stage 6. Without satisfying those, every generated
     * state is blocked for a reason that has nothing to do with what this test
     * is checking, and the releasable branch is never reached.
     *
     * The vacuity assertion at the bottom caught exactly that on the first
     * run: the test passed its invariant 200 times without once exercising it
     * in the direction that matters.
     */
    await satisfyNonChecklistRules(wagonNumber);

    const items = (repo.getChecklistItems(wagonNumber)?.allItems || [])
      .filter((i: any) => i.isMandatory);
    assert.ok(items.length > 10, `setup: expected a real mandatory checklist, got ${items.length}`);

    const update = db.prepare(
      'UPDATE checklist_items SET status = ?, reinspected_status = ? WHERE id = ?'
    );

    let releasableSeen = 0;
    let blockedSeen = 0;

    for (let iter = 0; iter < ITERATIONS; iter++) {
      // Bias towards mostly-satisfied states, or the gate is blocked every
      // single time and the releasable branch never gets exercised at all.
      const nearlyDone = random() < 0.35;

      const expected = new Map<string, boolean>();
      for (const item of items) {
        let status: string;
        let reinspected: string | null;

        if (nearlyDone && random() < 0.93) {
          status = 'PASS';
          reinspected = null;
        } else {
          status = STATUSES[Math.floor(random() * STATUSES.length)];
          reinspected = REINSPECTED[Math.floor(random() * REINSPECTED.length)];
        }

        update.run(status, reinspected, item.id);
        expected.set(item.id, isSatisfied(status, reinspected));
      }

      const allSatisfied = [...expected.values()].every(Boolean);
      const evaluation = repo.evaluateExitGate(wagonNumber);

      if (evaluation.canRelease) {
        releasableSeen++;
        assert.ok(
          allSatisfied,
          `iteration ${iter}: the gate cleared a wagon with an unsatisfied mandatory item. ` +
            `Unsatisfied: ${[...expected.entries()].filter(([, ok]) => !ok).length}`
        );
      } else {
        blockedSeen++;
      }

      // The other direction: an unsatisfied item must always produce at least
      // one blocker. A gate that blocks but cannot say why is not usable by
      // the person who has to fix it.
      if (!allSatisfied) {
        assert.ok(
          evaluation.blockers.length > 0,
          `iteration ${iter}: unsatisfied items produced no blocker text`
        );
      }
    }

    // A run that never generated a releasable state would pass vacuously.
    assert.ok(blockedSeen > 0, 'the generator never produced a blocked state');
    assert.ok(
      releasableSeen > 0,
      'the generator never produced a state the gate would clear, so the ' +
        'invariant was never actually exercised in the direction that matters'
    );
  });

  test('a single condemned mandatory item always blocks, wherever it sits', async () => {
    /*
     * Position-independence. A defect in the last item of the last category
     * must block exactly as surely as one in the first — an off-by-one in the
     * loop, or an early return, would show up as "usually blocks".
     */
    const db = getDatabase();
    const wagonNumber = 'PROP/BOXNHL/00002';
    await app.dispatch({
      method: 'POST',
      url: '/api/wagons/register',
      headers: { authorization: `Bearer ${supervisorToken}`, 'content-type': 'application/json' },
      body: { wagonNumber, wagonType: 'BOXNHL', owningRailway: 'SECR' }
    });

    const items = (repo.getChecklistItems(wagonNumber)?.allItems || [])
      .filter((i: any) => i.isMandatory);

    const pass = db.prepare("UPDATE checklist_items SET status = 'PASS', reinspected_status = NULL WHERE wagon_number = ?");
    const condemn = db.prepare("UPDATE checklist_items SET status = 'CONDEMNED' WHERE id = ?");

    for (const item of items) {
      pass.run(wagonNumber);
      condemn.run(item.id);

      const evaluation = repo.evaluateExitGate(wagonNumber);
      assert.strictEqual(
        evaluation.canRelease,
        false,
        `a condemned "${item.partName}" did not block release`
      );
      assert.ok(
        evaluation.blockers.some((b: string) => b.includes(item.partName)),
        `the blocker list did not name the condemned item "${item.partName}"`
      );
    }
  });
});
