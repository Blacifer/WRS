/**
 * Assembly Evidence Capture — tag vocabulary and coverage arithmetic
 * Indian Railways WRS Raipur
 *
 * `wagon_photos` sits behind append-only triggers, so the tag shape these
 * produce is permanent from the first row written. There is no migration for a
 * shape that turns out wrong — only a dataset with two shapes in it that
 * somebody special-cases forever. That is why the shape is pinned here rather
 * than left to the screen that happens to write it.
 *
 * The other thing pinned here is the rule from docs/ASSEMBLY_COMPLETENESS.md
 * that matters most: the expected spring count is never stored on a photograph.
 * It is a property of the wagon designation, it lives in WAGON_SPRING_CONFIGS
 * with two agreeing RDSO sources behind it, and a copy in a tag would be a
 * second source that can drift from the first — BOXN and BOXN M1 share a bogie
 * family and differ by four springs.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ASSEMBLY_EVIDENCE_TAG,
  BOGIE_SIDES,
  assemblyReadiness,
  buildAssemblyTags,
  parseAssemblyTags,
  summariseAssemblyCoverage
} from '../../shared/assembly/assemblyCapture.ts';
import { getWagonSpringConfig, springsPerBogie } from '../../shared/classification/wagonTypes.ts';

describe('Assembly evidence tags', () => {
  it('TC-ASM-01: a capture round-trips through the tags it is stored as', () => {
    const capture = { designation: 'BOXNHL', bogiePosition: 'BOGIE_1' as const, side: 'SIDE_A' as const };
    const parsed = parseAssemblyTags(buildAssemblyTags(capture));
    assert.deepStrictEqual(parsed, capture);
  });

  it('TC-ASM-02: a designation with a space survives, which is why the delimiter is a colon', () => {
    // WAGON_TYPE_BOXN M1 cannot be split back apart. WAGON_TYPE:BOXN M1 can.
    const capture = { designation: 'BOXN M1', bogiePosition: 'BOGIE_2' as const, side: 'SIDE_B' as const };
    const parsed = parseAssemblyTags(buildAssemblyTags(capture));
    assert.strictEqual(parsed?.designation, 'BOXN M1');
  });

  it('TC-ASM-03: the registry spelling is stored, not the caller’s', () => {
    // Otherwise "boxnhl" and "BOXNHL" become two labels in the dataset.
    const tags = buildAssemblyTags({ designation: 'boxnhl', bogiePosition: 'BOGIE_1', side: 'SIDE_A' });
    assert.ok(tags.includes('WAGON_TYPE:BOXNHL'), tags.join(','));
  });

  it('TC-ASM-04: an unknown designation is refused at capture, not stored', () => {
    // The last point at which a bad value can be rejected. After the insert it
    // is permanent, and a row nobody can compute an expected count for.
    assert.throws(
      () => buildAssemblyTags({ designation: 'BOXNQQ', bogiePosition: 'BOGIE_1', side: 'SIDE_A' }),
      /Unknown wagon designation/
    );
  });

  it('TC-ASM-05: an invalid side or bogie is refused', () => {
    assert.throws(
      () => buildAssemblyTags({ designation: 'BOXNHL', bogiePosition: 'BOGIE_3' as any, side: 'SIDE_A' }),
      /Invalid bogiePosition/
    );
    assert.throws(
      () => buildAssemblyTags({ designation: 'BOXNHL', bogiePosition: 'BOGIE_1', side: 'LEFT' as any }),
      /Invalid bogie side/
    );
  });

  it('TC-ASM-06: no spring count is written into the tags', () => {
    // The rule this whole feature rests on. BOXNHL is 14/14/4 per bogie; none
    // of those figures may appear on the photograph, because the registry is
    // the only source allowed to answer "how many should there be".
    const config = getWagonSpringConfig('BOXNHL')!;
    const tags = buildAssemblyTags({ designation: 'BOXNHL', bogiePosition: 'BOGIE_1', side: 'SIDE_A' });
    const joined = tags.join('|');
    for (const n of [config.counts.outer, config.counts.inner, config.counts.snubber, springsPerBogie(config)]) {
      assert.ok(
        !new RegExp(`\\b${n}\\b`).test(joined),
        `tag set leaked the expected count ${n}: ${joined}`
      );
    }
  });

  it('TC-ASM-07: a row carrying the marker but missing a field is not a sample', () => {
    // Counted as unusable by the export rather than parsed into a half-record.
    // Inflating readiness with rows nobody can use would answer the "is a model
    // worth attempting" question wrongly.
    assert.strictEqual(parseAssemblyTags([ASSEMBLY_EVIDENCE_TAG, 'WAGON_TYPE:BOXNHL', 'BOGIE:BOGIE_1']), null);
    assert.strictEqual(parseAssemblyTags([ASSEMBLY_EVIDENCE_TAG]), null);
  });

  it('TC-ASM-08: photographs from other flows are not swept into this set', () => {
    assert.strictEqual(parseAssemblyTags(['DEFECT_EVIDENCE', 'DAMAGE_CRACK']), null);
    assert.strictEqual(parseAssemblyTags([]), null);
    assert.strictEqual(parseAssemblyTags(null), null);
  });

  it('TC-ASM-09: a designation the registry no longer holds is not usable', () => {
    // Hand-built tags, as an old row would be after a registry change.
    const stale = [ASSEMBLY_EVIDENCE_TAG, 'WAGON_TYPE:BOXNQQ', 'BOGIE:BOGIE_1', 'SIDE:SIDE_A'];
    assert.strictEqual(parseAssemblyTags(stale), null);
  });
});

describe('Assembly coverage', () => {
  const cap = (wagonNumber: string, bogiePosition: any, side: any) => ({
    wagonNumber,
    designation: 'BOXNHL',
    bogiePosition,
    side
  });

  it('TC-ASM-10: one side of a bogie is not a covered bogie', () => {
    // No single frame shows every pocket on a CASNUB. A one-sided bogie cannot
    // answer the question the photograph exists to answer, so it must not read
    // as progress.
    const c = summariseAssemblyCoverage([cap('W1', 'BOGIE_1', 'SIDE_A')]);
    assert.strictEqual(c.completeBogies, 0);
    assert.strictEqual(c.partialBogies, 1);
    assert.strictEqual(c.totalPhotos, 1);
  });

  it('TC-ASM-11: both sides make one covered bogie', () => {
    const c = summariseAssemblyCoverage([
      cap('W1', 'BOGIE_1', 'SIDE_A'),
      cap('W1', 'BOGIE_1', 'SIDE_B')
    ]);
    assert.strictEqual(c.completeBogies, 1);
    assert.strictEqual(c.partialBogies, 0);
  });

  it('TC-ASM-12: the same side twice is still one side', () => {
    // Photographing one side twice as fast must not move the readiness figure.
    const c = summariseAssemblyCoverage([
      cap('W1', 'BOGIE_1', 'SIDE_A'),
      cap('W1', 'BOGIE_1', 'SIDE_A')
    ]);
    assert.strictEqual(c.completeBogies, 0);
    assert.strictEqual(c.partialBogies, 1);
    assert.strictEqual(c.totalPhotos, 2, 'the photographs still exist as evidence');
  });

  it('TC-ASM-13: two bogies under one wagon are counted separately', () => {
    const c = summariseAssemblyCoverage([
      cap('W1', 'BOGIE_1', 'SIDE_A'),
      cap('W1', 'BOGIE_1', 'SIDE_B'),
      cap('W1', 'BOGIE_2', 'SIDE_A')
    ]);
    assert.strictEqual(c.completeBogies, 1);
    assert.strictEqual(c.partialBogies, 1);
  });

  it('TC-ASM-14: bogies of different wagons never merge', () => {
    const c = summariseAssemblyCoverage([
      cap('W1', 'BOGIE_1', 'SIDE_A'),
      cap('W2', 'BOGIE_1', 'SIDE_B')
    ]);
    assert.strictEqual(c.completeBogies, 0, 'two wagons, one side each, is no coverage at all');
    assert.strictEqual(c.partialBogies, 2);
  });

  it('TC-ASM-15: photographs are tallied by designation', () => {
    const c = summariseAssemblyCoverage([
      cap('W1', 'BOGIE_1', 'SIDE_A'),
      { wagonNumber: 'W2', designation: 'BOXN', bogiePosition: 'BOGIE_1' as const, side: 'SIDE_A' as const }
    ]);
    assert.deepStrictEqual(c.photosByDesignation, { BOXNHL: 1, BOXN: 1 });
  });

  it('TC-ASM-16: readiness is stated in covered bogies and never claims more than it has', () => {
    assert.match(assemblyReadiness(0), /Still accumulating/);
    assert.match(assemblyReadiness(49), /Still accumulating/);
    assert.match(assemblyReadiness(50), /far too few to train/);
    assert.match(assemblyReadiness(299), /far too few to train/);
    // Even at the top threshold it says "attempt a baseline", not "train a model".
    assert.match(assemblyReadiness(300), /baseline/);
    assert.doesNotMatch(assemblyReadiness(300), /ready to train|train a model/i);
  });

  it('TC-ASM-17: both sides are required, whatever BOGIE_SIDES grows to', () => {
    // If a third camera position is ever added, a two-sided bogie stops being
    // complete and this test says so rather than the figure quietly inflating.
    assert.strictEqual(BOGIE_SIDES.length, 2);
  });
});
