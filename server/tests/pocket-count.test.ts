/**
 * Pocket occupancy — counting is a label; the expected number is the registry's; a match is silence
 * Indian Railways WRS Raipur
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';
import { getDatabase } from '../src/db/connection.ts';
import { WagonRepository } from '../src/db/wagonRepository.ts';
import { PocketCountRepository } from '../src/db/pocketCountRepository.ts';
import { buildAssemblyTags } from '../../shared/assembly/assemblyCapture.ts';
import { WAGON_SPRING_CONFIGS, getWagonSpringConfig } from '../../shared/classification/wagonTypes.ts';
import {
  comparePocketCount, expectedPerSide, pocketDatasetReadiness, tallyTaps, validateTaps, POCKET_MODEL, POCKET_MODEL_GATE, type PocketTap
} from '../../shared/assembly/pocketCount.ts';
import type { ExpressApp } from '../src/framework/index.ts';

async function call(app: ExpressApp, method: string, path: string, body?: any, headers: Record<string, string> = {}) {
  return app.dispatch({ method, url: path, body, headers });
}
async function signIn(app: ExpressApp, username: string): Promise<string> {
  const res = await call(app, 'POST', '/api/auth/login', { username, password: 'password123' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.token;
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

/** N taps of a kind, spread across the frame. */
const taps = (outer: number, inner: number, snubber: number): PocketTap[] => {
  const out: PocketTap[] = [];
  const add = (n: number, kind: PocketTap['kind'], row: number) => { for (let i = 0; i < n; i++) out.push({ x: (i + 0.5) / Math.max(n, 1), y: row, kind }); };
  add(outer, 'OUTER', 0.3); add(inner, 'INNER', 0.5); add(snubber, 'SNUBBER', 0.7);
  return out;
};

describe('the arithmetic', () => {
  it('TC-PKT-01: every designation in the registry splits evenly across two nests, so expected-per-side is never rounded', () => {
    for (const c of WAGON_SPRING_CONFIGS) {
      const e = expectedPerSide(c);
      assert.equal(e.total * 2, c.counts.outer + c.counts.inner + c.counts.snubber, c.designation);
    }
    // BOXNHL is 14/14/4 per bogie: 7/7/2 per side. BOXN is 12/8/4: 6/4/2.
    assert.deepEqual(expectedPerSide(getWagonSpringConfig('BOXNHL')!), { outer: 7, inner: 7, snubber: 2, total: 16 });
    assert.deepEqual(expectedPerSide(getWagonSpringConfig('BOXN')!), { outer: 6, inner: 4, snubber: 2, total: 12 });
    assert.throws(() => expectedPerSide({ ...getWagonSpringConfig('BOXN')!, counts: { outer: 13, inner: 8, snubber: 4 } }), /odd outer count/);
  });

  it('TC-PKT-02: a matching count produces nothing; short names the kind; over says check the wagon type; short wins over over', () => {
    const e = expectedPerSide(getWagonSpringConfig('BOXNHL')!);
    const where = { bogie: 'BOGIE_1' as const, side: 'SIDE_A' as const };
    const match = comparePocketCount(e, tallyTaps(taps(7, 7, 2)), where);
    assert.equal(match.verdict, 'MATCH'); assert.equal(match.message, '');
    const short = comparePocketCount(e, tallyTaps(taps(6, 7, 2)), where);
    assert.equal(short.verdict, 'SHORT'); assert.deepEqual(short.short, ['OUTER']);
    assert.match(short.message, /6 of 7 outer/); assert.match(short.message, /BOGIE 1 SIDE A/);
    const over = comparePocketCount(e, tallyTaps(taps(8, 7, 2)), where);
    assert.equal(over.verdict, 'OVER'); assert.match(over.message, /check the wagon type/);
    const both = comparePocketCount(e, tallyTaps(taps(5, 8, 2)), where);
    assert.equal(both.verdict, 'SHORT', 'a nest short an outer is short, whatever else was counted');
  });

  it('TC-PKT-03: taps are validated by shape, and there is no field the expected count could arrive in', () => {
    assert.equal(validateTaps([{ x: 0.5, y: 0.5, kind: 'OUTER' }]).ok, true);
    assert.equal(validateTaps([{ x: 1.5, y: 0.5, kind: 'OUTER' }]).ok, false);
    assert.equal(validateTaps([{ x: 0.5, y: 0.5, kind: 'SPRING' }]).ok, false);
    assert.equal(validateTaps('7').ok, false);
    assert.equal(validateTaps(new Array(201).fill({ x: 0.5, y: 0.5, kind: 'OUTER' })).ok, false);
  });

  it('TC-PKT-04: the model is NONE, and the gate needs both covered bogies and agreeing recounts', () => {
    assert.equal(POCKET_MODEL, 'NONE');
    const none = pocketDatasetReadiness({ labelledPhotos: 0, coveredBogies: 0, recounts: 0, agreeing: 0 });
    assert.equal(none.gate.allowed, false); assert.match(none.gate.why, /No model/); assert.equal(none.agreementPct, null);
    const bogiesOnly = pocketDatasetReadiness({ labelledPhotos: 800, coveredBogies: 400, recounts: 10, agreeing: 10 });
    assert.equal(bogiesOnly.gate.allowed, false); assert.match(bogiesOnly.gate.why, /10 of 30 blind recounts/);
    const noisy = pocketDatasetReadiness({ labelledPhotos: 800, coveredBogies: 400, recounts: 40, agreeing: 30 });
    assert.equal(noisy.gate.allowed, false); assert.match(noisy.gate.why, /75% of the time/);
    const ok = pocketDatasetReadiness({ labelledPhotos: 800, coveredBogies: POCKET_MODEL_GATE.minCoveredBogies, recounts: 40, agreeing: 39 });
    assert.equal(ok.gate.allowed, true); assert.match(ok.gate.why, /may only ever raise a question/);
  });
});

describe('the record', () => {
  let app: ExpressApp; let insp1: string; let insp2: string; let sup: string;
  const wagon = 'SECR/BOXNHL/50101';
  const upload = async (token: string, bogie: 'BOGIE_1' | 'BOGIE_2', side: 'SIDE_A' | 'SIDE_B', w = wagon, designation = 'BOXNHL') => {
    const r = await call(app, 'POST', '/api/photos/upload', {
      wagonNumber: w, category: 'SPRINGS', partName: `Bogie assembly — ${bogie} ${side}`, stage: 'REASSEMBLY',
      imageBase64: 'data:image/jpeg;base64,' + 'A'.repeat(64), tags: buildAssemblyTags({ designation, bogiePosition: bogie, side }), evidenceStage: 'GENERAL'
    }, auth(token));
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.data.id as string;
  };

  beforeEach(async () => {
    app = createApp(':memory:');
    insp1 = await signIn(app, 'inspector1');
    insp2 = await signIn(app, 'inspector2');
    sup = await signIn(app, 'supervisor1');
    await call(app, 'POST', '/api/wagons/register', { wagonNumber: wagon, wagonType: 'BOXNHL', owningRailway: 'SECR' }, auth(sup));
  });

  it('TC-PKT-10: a first count is stored as taps, compared against the registry, and a match is not a verified flag', async () => {
    const photoId = await upload(insp1, 'BOGIE_1', 'SIDE_A');
    const before = await call(app, 'GET', `/api/photos/${photoId}/pocket-counts`, undefined, auth(insp1));
    assert.equal(before.body.data.turn, 'FIRST');
    assert.equal(before.body.data.expected, null, 'the expected figure is not shown to someone about to count');
    const r = await call(app, 'POST', `/api/photos/${photoId}/pocket-count`, { taps: taps(7, 7, 2) }, auth(insp1));
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.data.row.kind, 'FIRST');
    assert.deepEqual(r.body.data.row.counted, { outer: 7, inner: 7, snubber: 2, total: 16 });
    assert.equal(r.body.data.comparison.verdict, 'MATCH');
    assert.equal(r.body.data.comparison.message, '');
    assert.ok(!('verified' in r.body.data), 'no verified flag exists to be read as evidence');
    const gate = new WagonRepository(getDatabase()).evaluateExitGate(wagon);
    assert.ok(!gate.advisoryDetails.some((a) => a.id.startsWith('pockets_')), 'a matching count produces nothing at the gate');
  });

  it('TC-PKT-11: the expected count cannot be sent, and a photograph that is not an assembly frame cannot be counted', async () => {
    const photoId = await upload(insp1, 'BOGIE_1', 'SIDE_A');
    const r = await call(app, 'POST', `/api/photos/${photoId}/pocket-count`, { taps: taps(7, 7, 2), expected: { outer: 7, inner: 7, snubber: 2 } }, auth(insp1));
    assert.equal(r.status, 400); assert.equal(r.body.error, 'EXPECTED_NOT_ACCEPTED');
    const plain = await call(app, 'POST', '/api/photos/upload', { wagonNumber: wagon, partName: 'Brake Block', imageBase64: 'data:image/jpeg;base64,' + 'A'.repeat(64) }, auth(insp1));
    const r2 = await call(app, 'POST', `/api/photos/${plain.body.data.id}/pocket-count`, { taps: taps(7, 7, 2) }, auth(insp1));
    assert.equal(r2.status, 404); assert.equal(r2.body.error, 'NOT_AN_ASSEMBLY_FRAME');
    const r3 = await call(app, 'POST', `/api/photos/${photoId}/pocket-count`, { taps: 'sixteen' }, auth(insp1));
    assert.equal(r3.status, 400); assert.equal(r3.body.error, 'INVALID_TAPS');
  });

  it('TC-PKT-12: a short count reaches the exit gate as an advisory the supervisor must acknowledge by name', async () => {
    const photoId = await upload(insp1, 'BOGIE_2', 'SIDE_B');
    const r = await call(app, 'POST', `/api/photos/${photoId}/pocket-count`, { taps: taps(7, 6, 2) }, auth(insp1));
    assert.equal(r.body.data.comparison.verdict, 'SHORT');
    const gate = new WagonRepository(getDatabase()).evaluateExitGate(wagon);
    const adv = gate.advisoryDetails.find((a) => a.id === 'pockets_short_bogie_2_side_b');
    assert.ok(adv, JSON.stringify(gate.advisoryDetails.map((a) => a.id)));
    assert.equal(adv!.issueType, 'POCKETS_SHORT'); assert.equal(adv!.severity, 'ADVISORY');
    // Before a recount the advisory names the frame and says a count fell short —
    // but not by how much. The gate evaluation is returned to every signed-in
    // role, and the figure would hand the blind recounter the first count.
    assert.match(adv!.description, /fell short/);
    assert.doesNotMatch(adv!.description, /\d+ of \d+/, 'no figures before the recount');
    const wagonRead = await call(app, 'GET', `/api/wagons/${encodeURIComponent(wagon)}`, undefined, auth(insp2));
    assert.ok(!JSON.stringify(wagonRead.body).includes('6 of 7'), 'the wagon read shows the potential recounter no figures');
    await call(app, 'POST', `/api/photos/${photoId}/pocket-count`, { taps: taps(7, 7, 2) }, auth(insp2));
    const after = new WagonRepository(getDatabase()).evaluateExitGate(wagon).advisoryDetails.find((a) => a.id === 'pockets_short_bogie_2_side_b');
    assert.match(after!.description, /6 of 7 inner/, 'the figures arrive with the recount');
    assert.ok(!gate.blockerDetails.some((b) => b.id.startsWith('pockets_') || b.issueType.startsWith('POCKET')), 'never a blocker');
  });

  it('TC-PKT-13: the recount is by a different person and blind; agreement and disagreement are both recorded', async () => {
    const photoId = await upload(insp1, 'BOGIE_1', 'SIDE_B');
    await call(app, 'POST', `/api/photos/${photoId}/pocket-count`, { taps: taps(7, 7, 2) }, auth(insp1));
    const again = await call(app, 'POST', `/api/photos/${photoId}/pocket-count`, { taps: taps(7, 7, 2) }, auth(insp1));
    assert.equal(again.status, 409, 'the same person cannot recount');
    const peek = await call(app, 'GET', `/api/photos/${photoId}/pocket-counts`, undefined, auth(insp2));
    assert.equal(peek.body.data.turn, 'BLIND_RECOUNT');
    assert.equal(peek.body.data.first.counted, undefined, 'the first count is withheld from the recounter');
    assert.equal(peek.body.data.expected, null);
    const list = await call(app, 'GET', `/api/photos/pocket-counts?wagonNumber=${encodeURIComponent(wagon)}`, undefined, auth(insp2));
    assert.equal(list.body.data[0].blind, true); assert.equal(list.body.data[0].first.counted, undefined);
    const supList = await call(app, 'GET', `/api/photos/pocket-counts?wagonNumber=${encodeURIComponent(wagon)}`, undefined, auth(sup));
    assert.equal(supList.body.data[0].blind, false, 'the person who releases the wagon sees the count; they are not a recounter');

    const rc = await call(app, 'POST', `/api/photos/${photoId}/pocket-count`, { taps: taps(7, 6, 2) }, auth(insp2));
    assert.equal(rc.status, 201); assert.equal(rc.body.data.row.kind, 'BLIND_RECOUNT'); assert.equal(rc.body.data.agreesWithFirst, false);
    const after = await call(app, 'GET', `/api/photos/${photoId}/pocket-counts`, undefined, auth(insp2));
    assert.equal(after.body.data.turn, 'DONE'); assert.equal(after.body.data.agree, false);
    assert.deepEqual(after.body.data.first.counted, { outer: 7, inner: 7, snubber: 2, total: 16 }, 'once counted, both counts are visible');
    const gate = new WagonRepository(getDatabase()).evaluateExitGate(wagon);
    assert.ok(gate.advisoryDetails.some((a) => a.issueType === 'POCKET_COUNT_DISAGREES'));
    assert.ok(gate.advisoryDetails.some((a) => a.issueType === 'POCKETS_SHORT'), 'the short recount is also raised');
  });

  it('TC-PKT-14: a count is append-only', async () => {
    const photoId = await upload(insp1, 'BOGIE_1', 'SIDE_A');
    await call(app, 'POST', `/api/photos/${photoId}/pocket-count`, { taps: taps(7, 7, 2) }, auth(insp1));
    const db = getDatabase();
    assert.throws(() => db.prepare('UPDATE bogie_pocket_counts SET counted_outer = 99').run(), /cannot be rewritten/);
    assert.throws(() => db.prepare('DELETE FROM bogie_pocket_counts').run(), /cannot be deleted/);
  });

  it('TC-PKT-15: the dataset counts covered bogies and agreement, and reads for the DRM, not the inspector', async () => {
    const a = await upload(insp1, 'BOGIE_1', 'SIDE_A'); const b = await upload(insp1, 'BOGIE_1', 'SIDE_B'); const c = await upload(insp1, 'BOGIE_2', 'SIDE_A');
    for (const id of [a, b, c]) await call(app, 'POST', `/api/photos/${id}/pocket-count`, { taps: taps(7, 7, 2) }, auth(insp1));
    await call(app, 'POST', `/api/photos/${a}/pocket-count`, { taps: taps(7, 7, 2) }, auth(insp2));
    await call(app, 'POST', `/api/photos/${b}/pocket-count`, { taps: taps(6, 7, 2) }, auth(insp2));
    const drm = await signIn(app, 'drm1');
    const r = await call(app, 'GET', '/api/photos/dataset/pocket-counts', undefined, auth(drm));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.data.labelledPhotos, 3);
    assert.equal(r.body.data.coveredBogies, 1, 'bogie 1 has both sides; bogie 2 one');
    assert.equal(r.body.data.recounts, 2); assert.equal(r.body.data.agreeing, 1); assert.equal(r.body.data.agreementPct, 50);
    assert.equal(r.body.data.model, 'NONE'); assert.equal(r.body.data.gate.allowed, false);
    assert.deepEqual(r.body.data.byDesignation, { BOXNHL: 3 });
    const denied = await call(app, 'GET', '/api/photos/dataset/pocket-counts', undefined, auth(insp1));
    assert.equal(denied.status, 403);
    // The repository agrees with the route — same arithmetic, no HTTP.
    assert.equal(new PocketCountRepository(getDatabase()).readiness().coveredBogies, 1);
  });
});
