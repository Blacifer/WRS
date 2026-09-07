/**
 * Which of the two bogies did they mean
 * Indian Railways WRS Raipur
 *
 * WHY THIS EXISTS
 * ---------------
 * A CASNUB wagon has two bogies carrying parts with identical names. The
 * resolver matched a spoken part name against the whole checklist and returned
 * the first hit, ignoring the bogie entirely — so "the second inner on bogie
 * two looks cracked" recorded FAIL against the inner spring on BOGIE 1.
 *
 * Found by driving it in a browser rather than by any test: the screen said
 * "Recorded against Inner Spring (Bogie 1)" for a sentence that named bogie
 * two. Nothing failed, nothing was logged as an error, and the record was
 * simply about the wrong component — which is worse than no record, because it
 * is silently plausible.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { resolveVoiceTarget } from '../src/voice/action.ts';

const items = [
  { id: 'b1_inner', partName: 'Inner Spring', category: 'SPRINGS', bogiePosition: 'BOGIE_1' },
  { id: 'b2_inner', partName: 'Inner Spring', category: 'SPRINGS', bogiePosition: 'BOGIE_2' },
  { id: 'b1_wedge', partName: 'Friction Wedge', category: 'FRICTION_WEDGES', bogiePosition: 'BOGIE_1' },
  { id: 'b2_wedge', partName: 'Friction Wedge', category: 'FRICTION_WEDGES', bogiePosition: 'BOGIE_2' }
];

const base = { wagonNumber: 'X', status: 'FAIL' as const, transcript: 't' };

describe('Resolving which part a spoken verdict is about', () => {
  it('TC-VTR-01: a named bogie decides between two parts with the same name', () => {
    const hit = resolveVoiceTarget(items, { ...base, itemName: 'Inner Spring', bogiePosition: 'BOGIE_2' });
    assert.strictEqual(hit?.id, 'b2_inner', 'the bogie the speaker named must win');
  });

  it('TC-VTR-02: the other bogie resolves to the other part', () => {
    // Both directions, so a test cannot pass by the ordering it started with.
    const hit = resolveVoiceTarget(items, { ...base, itemName: 'Inner Spring', bogiePosition: 'BOGIE_1' });
    assert.strictEqual(hit?.id, 'b1_inner');
  });

  it('TC-VTR-03: with no bogie named, the previous behaviour stands', () => {
    const hit = resolveVoiceTarget(items, { ...base, itemName: 'Inner Spring' });
    assert.strictEqual(hit?.id, 'b1_inner', 'first match, as before');
  });

  it('TC-VTR-04: a part that is not on the named bogie resolves to nothing', () => {
    /*
     * Deliberately not a fallback to the other bogie. Recording a verdict
     * against a part the speaker did not describe is the fault this fixes, and
     * quietly moving it one bogie over would reintroduce it.
     */
    const onlyBogie1 = items.filter((i) => i.bogiePosition === 'BOGIE_1');
    const hit = resolveVoiceTarget(onlyBogie1, { ...base, itemName: 'Inner Spring', bogiePosition: 'BOGIE_2' });
    assert.strictEqual(hit, null, 'no part on that bogie means no verdict');
  });

  it('TC-VTR-05: an explicit item id still wins over everything', () => {
    // The ordinary online path sends the id, and it must not be second-guessed.
    const hit = resolveVoiceTarget(items, { ...base, itemId: 'b2_wedge', itemName: 'Inner Spring', bogiePosition: 'BOGIE_1' });
    assert.strictEqual(hit?.id, 'b2_wedge');
  });

  it('TC-VTR-06: falling back to a category also respects the bogie', () => {
    const hit = resolveVoiceTarget(items, { ...base, category: 'FRICTION_WEDGES', bogiePosition: 'BOGIE_2' });
    assert.strictEqual(hit?.id, 'b2_wedge');
  });
});
