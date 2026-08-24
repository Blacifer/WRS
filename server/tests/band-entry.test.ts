/**
 * Band-First Entry Tests
 * Indian Railways WRS Raipur
 *
 * The DRM described the real workflow: a strip — a stick — that tells the
 * inspector directly which band a spring falls in. RDSO calls it "Grouping of
 * Springs (By strip method)".
 *
 * The app previously asked for a three-digit height and re-derived the band
 * the inspector had already read. These tests pin the direct path, and pin the
 * property that makes it safe: recording a band must reach the same safety
 * verdict as measuring a height inside that band.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../src/db/migrations.ts';
import { seedUsers } from '../src/db/seed.ts';
import { InspectionRepository } from '../src/db/repository.ts';
import { getBandOptions, recordByBand, recordAsCondemned } from '../../shared/classification/bandEntry.ts';
import { getReplacementGuidance, validateSpringNests } from '../../shared/classification/nestGrouping.ts';
import { classifySpring } from '../../shared/classification/engine.ts';
import { RDSO_TABLES } from '../../shared/classification/tables.ts';

describe('Band-First Spring Entry', () => {
  it('TC-BND-01: offers exactly the bands printed on the strip', () => {
    const opts = getBandOptions('CASNUB_22_NLB', 'USED', 'OUTER');
    assert.strictEqual(opts.length, 6, 'used springs have six bands');
    assert.deepStrictEqual(
      opts.map((o) => o.band),
      ['BLUE', 'GREEN', 'YELLOW', 'ORANGE', 'WHITE', 'RED']
    );
    // Highest free height first, matching the printed table order.
    assert.strictEqual(opts[0].maxHeight, 263);
    assert.strictEqual(opts[5].minHeight, 245);
  });

  it('TC-BND-02: new springs offer their three bands, not six', () => {
    const opts = getBandOptions('CASNUB_22_NLB', 'NEW', 'OUTER');
    assert.strictEqual(opts.length, 3);
  });

  it('TC-BND-03: every band maps to its RDSO window exactly', () => {
    for (const table of Object.values(RDSO_TABLES) as any[]) {
      const opts = getBandOptions(table.bogieType, table.condition, table.position);
      assert.strictEqual(opts.length, table.bands.length, `${table.tableNumber} ${table.position}`);
      opts.forEach((o, i) => {
        assert.strictEqual(o.minHeight, table.bands[i].minHeight);
        assert.strictEqual(o.maxHeight, table.bands[i].maxHeight);
      });
    }
  });

  it('TC-BND-04: a band reaches the same verdict as a height inside it', () => {
    // The property that makes band-first safe: no safety decision changes.
    for (const table of Object.values(RDSO_TABLES) as any[]) {
      for (const band of table.bands) {
        const viaBand = recordByBand(table.bogieType, table.condition, table.position, band.band)!;
        const viaHeight = classifySpring({
          bogieType: table.bogieType,
          condition: table.condition,
          position: table.position,
          measuredHeight: viaBand.measuredFreeHeight
        });

        assert.strictEqual(viaBand.band, viaHeight.band, `${table.tableNumber} ${band.band}: band differs`);
        assert.strictEqual(viaBand.status, viaHeight.status, `${table.tableNumber} ${band.band}: status differs`);
        assert.strictEqual(viaBand.bandRoman, viaHeight.bandRoman);
      }
    }
  });

  it('TC-BND-05: the stored height sits inside the band it represents', () => {
    for (const table of Object.values(RDSO_TABLES) as any[]) {
      for (const band of table.bands) {
        const r = recordByBand(table.bogieType, table.condition, table.position, band.band)!;
        assert.ok(
          r.measuredFreeHeight >= band.minHeight && r.measuredFreeHeight <= band.maxHeight,
          `${table.tableNumber} ${band.band}: ${r.measuredFreeHeight} outside ${band.minHeight}-${band.maxHeight}`
        );
      }
    }
  });

  it('TC-BND-06: a band-recorded height is always marked approximate', () => {
    // It is a representative value, not something anyone measured. Storing it
    // without saying so would overstate the precision of the record.
    const r = recordByBand('CASNUB_22_NLB', 'USED', 'OUTER', 'GREEN')!;
    assert.strictEqual(r.heightIsApproximate, true);
  });

  it('TC-BND-07: off the strip condemns, below the condemning limit', () => {
    const r = recordAsCondemned('CASNUB_22_NLB', 'USED', 'OUTER', 'BELOW')!;
    assert.strictEqual(r.status, 'CONDEMNED');
    assert.ok(r.measuredFreeHeight < 245, 'must fall outside the serviceable range');
    assert.ok(/below the lowest band/i.test(r.condemnationReason));

    // And it must actually classify as condemned, not merely be labelled so.
    const verdict = classifySpring({
      bogieType: 'CASNUB_22_NLB',
      condition: 'USED',
      position: 'OUTER',
      measuredHeight: r.measuredFreeHeight
    });
    assert.strictEqual(verdict.status, 'CONDEMNED');
  });

  it('TC-BND-08: an over-height spring condemns too', () => {
    const r = recordAsCondemned('CASNUB_22_NLB', 'USED', 'OUTER', 'ABOVE')!;
    assert.ok(r.measuredFreeHeight > 263);
    const verdict = classifySpring({
      bogieType: 'CASNUB_22_NLB',
      condition: 'USED',
      position: 'OUTER',
      measuredHeight: r.measuredFreeHeight
    });
    assert.strictEqual(verdict.status, 'CONDEMNED');
  });

  it('TC-BND-09: a band entry persists with its approximate flag intact', () => {
    const db = new DatabaseSync(':memory:');
    runMigrations(db);
    seedUsers(db);
    const repo = new InspectionRepository(db);

    const r = recordByBand('CASNUB_22_NLB', 'USED', 'OUTER', 'GREEN')!;
    repo.insertInspection({
      wagonNumber: 'TEST/BAND/1',
      bogieType: 'CASNUB_22_NLB',
      condition: 'USED',
      springPosition: 'OUTER',
      bogiePosition: 'BOGIE_1',
      nestIndex: 1,
      measuredFreeHeight: r.measuredFreeHeight,
      heightIsApproximate: true,
      classifiedBand: r.band,
      bandRoman: r.bandRoman,
      status: r.status,
      tableReference: r.tableReference,
      valid_range_min: 245,
      valid_range_max: 263,
      inspectorId: 'usr_insp_001'
    } as any);

    const row = db.prepare(
      'SELECT classified_band, height_is_approximate FROM inspections WHERE wagon_number = ?'
    ).get('TEST/BAND/1') as any;

    assert.strictEqual(row.classified_band, 'GREEN');
    assert.strictEqual(row.height_is_approximate, 1, 'the record must not imply a measured value');
  });

  it('TC-BND-10: a measured height is NOT flagged approximate', () => {
    const db = new DatabaseSync(':memory:');
    runMigrations(db);
    seedUsers(db);
    const repo = new InspectionRepository(db);

    repo.insertInspection({
      wagonNumber: 'TEST/BAND/2',
      bogieType: 'CASNUB_22_NLB',
      condition: 'USED',
      springPosition: 'OUTER',
      bogiePosition: 'BOGIE_1',
      nestIndex: 1,
      measuredFreeHeight: 258.5,
      classifiedBand: 'GREEN',
      bandRoman: 'Band II',
      status: 'PASS',
      tableReference: 'Table 28',
      valid_range_min: 245,
      valid_range_max: 263,
      inspectorId: 'usr_insp_001'
    } as any);

    const row = db.prepare(
      'SELECT height_is_approximate FROM inspections WHERE wagon_number = ?'
    ).get('TEST/BAND/2') as any;
    assert.strictEqual(row.height_is_approximate, 0);
  });
});

describe('Replacement Guidance for Band-Recorded Nests', () => {
  // GREEN spans 257-260 on Table 28, so its midpoint is 258.5.
  const greenRange = { min: 257, max: 260 };
  const bandRange = (b: string) => (b === 'GREEN' ? greenRange : b === 'BLUE' ? { min: 260, max: 263 } : null);
  const bandLookup = (h: number) => (h >= 257 && h < 260 ? 'GREEN' : h >= 260 ? 'BLUE' : 'YELLOW');

  const strip = (band: string, n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `s${band}${i}`,
      springPosition: 'OUTER' as const,
      condition: 'USED' as const,
      measuredFreeHeight: recordByBand('CASNUB_22_NLB', 'USED', 'OUTER', band as any)!.measuredFreeHeight,
      classifiedBand: band,
      heightIsApproximate: true,
      status: 'PASS'
    }));

  it('TC-BND-11: a band-recorded nest is given its band, not a computed window', () => {
    // The defect this pins: eleven GREEN springs all store 258.5, and the
    // +/-3 mm arithmetic turns that into 255.5-261.5 — a window that admits
    // YELLOW and BLUE springs and breaks the very nest it claims to protect.
    const g = getReplacementGuidance(
      [...strip('GREEN', 11), { ...strip('GREEN', 1)[0], id: 'bad', status: 'CONDEMNED' }],
      bandLookup,
      bandRange
    );

    assert.strictEqual(g.targetBand, 'GREEN');
    assert.deepStrictEqual(g.targetRange, greenRange, 'the window must be the GREEN band itself');
    assert.ok(/Fit a spring from the GREEN band/.test(g.message));
  });

  it('TC-BND-12: the quoted window never admits a spring from a neighbouring band', () => {
    const g = getReplacementGuidance(strip('GREEN', 11), bandLookup, bandRange);
    const { min, max } = g.targetRange!;
    assert.strictEqual(bandLookup(min), 'GREEN', `${min} mm is not a GREEN spring`);
    assert.strictEqual(
      bandLookup(Number((max - 0.1).toFixed(1))),
      'GREEN',
      'the top of the window must still be GREEN'
    );
    // And specifically not the value the old arithmetic produced.
    assert.ok(min > 255.5, 'must not reach down into YELLOW');
  });

  it('TC-BND-13: a nest already spread across bands is sent back to be re-grouped', () => {
    const g = getReplacementGuidance(
      [...strip('GREEN', 6), ...strip('BLUE', 5)],
      bandLookup,
      bandRange
    );
    assert.strictEqual(g.targetRange, null, 'no single replacement fixes a two-band nest');
    assert.ok(/Re-group the whole nest/i.test(g.message));
    assert.ok(/GREEN/.test(g.message) && /BLUE/.test(g.message), 'should name the bands found');
  });

  it('TC-BND-14: a band without a known range is named, never given an invented window', () => {
    const g = getReplacementGuidance(strip('GREEN', 11), bandLookup, () => null);
    assert.strictEqual(g.targetBand, 'GREEN');
    assert.strictEqual(g.targetRange, null, 'must not fabricate a numeric window');
    assert.ok(/GREEN band/.test(g.message));
    assert.ok(!/mm/.test(g.message.split('band')[1] || ''), 'no numbers after the band name');
  });

  it('TC-BND-15: measured nests keep the precise arithmetic window', () => {
    // The band rule must not coarsen genuine measurements.
    const measured = [258, 259, 260].map((h, i) => ({
      id: `m${i}`,
      springPosition: 'OUTER' as const,
      condition: 'USED' as const,
      measuredFreeHeight: h,
      status: 'PASS'
    }));
    const g = getReplacementGuidance(measured, bandLookup, bandRange);
    assert.deepStrictEqual(g.targetRange, { min: 257, max: 261 }, 'arithmetic window, not the band');
  });

  it('TC-BND-16: one approximate spring is enough to disable the arithmetic', () => {
    // Mixing a strip reading into a measured nest makes the arithmetic unsound
    // for the whole nest, because one of its inputs is not a real number.
    const mixed = [
      { id: 'm1', springPosition: 'OUTER' as const, condition: 'USED' as const, measuredFreeHeight: 259, status: 'PASS' },
      ...strip('GREEN', 1)
    ];
    const g = getReplacementGuidance(mixed, bandLookup, bandRange);
    assert.deepStrictEqual(g.targetRange, greenRange);
    assert.strictEqual(g.targetBand, 'GREEN');
  });

  it('TC-BND-17: an empty nest still refuses to invent a band', () => {
    const g = getReplacementGuidance(
      [{ ...strip('GREEN', 1)[0], status: 'CONDEMNED' }],
      bandLookup,
      bandRange
    );
    assert.strictEqual(g.targetRange, null);
    assert.strictEqual(g.targetBand, null);
    assert.ok(
      /has not been recorded|has been measured yet/i.test(g.message),
      `expected a "group not established" message, got: ${g.message}`
    );
  });
});

describe('Nest Grouping for Band-Recorded Springs', () => {
  const mk = (band: string, i: number, bogie = 'BOGIE_1', approx = true) => ({
    id: `${bogie}-${band}-${i}`,
    springPosition: 'OUTER' as const,
    bogiePosition: bogie,
    condition: 'USED' as const,
    measuredFreeHeight: recordByBand('CASNUB_22_NLB', 'USED', 'OUTER', band as any)!.measuredFreeHeight,
    classifiedBand: band,
    heightIsApproximate: approx,
    status: 'PASS'
  });
  const nest = (band: string, n: number, bogie = 'BOGIE_1') =>
    Array.from({ length: n }, (_, i) => mk(band, i, bogie));

  it('TC-NST-01: a nest mixing two bands is flagged', () => {
    // The height rule alone cannot see this. Adjacent band midpoints are
    // exactly 3.00 mm apart, and the limit is "more than 3 mm" — so six GREEN
    // and six BLUE springs computed a 3.00 mm spread and passed, while the
    // real springs could be 257 and 263: 6 mm apart.
    const r = validateSpringNests([...nest('GREEN', 6), ...nest('BLUE', 6)]);

    assert.strictEqual(r.isValid, false, 'a two-band nest must not pass');
    assert.ok(r.violations.some((v) => v.type === 'BAND_MIXED'));
    const v = r.violations.find((v) => v.type === 'BAND_MIXED')!;
    assert.deepStrictEqual(v.bandsFound!.sort(), ['BLUE', 'GREEN']);
    assert.strictEqual(v.springIds.length, 12);
  });

  it('TC-NST-02: the height rule alone would have missed it', () => {
    // Pins the exact gap, so nobody later "simplifies" the band check away.
    const springs = [...nest('GREEN', 6), ...nest('BLUE', 6)];
    const heights = springs.map((s) => s.measuredFreeHeight);
    const spread = Math.max(...heights) - Math.min(...heights);
    assert.strictEqual(spread, 3, 'midpoints are exactly 3 mm apart');
    assert.ok(!(spread > 3), 'which does not exceed the limit — hence the band rule');
  });

  it('TC-NST-03: a single-band nest passes', () => {
    const r = validateSpringNests(nest('GREEN', 12));
    assert.strictEqual(r.isValid, true);
    assert.strictEqual(r.groups[0].springCount, 12);
  });

  it('TC-NST-04: two bogies may carry different bands', () => {
    // A nest lives on one bogie. Bogie 1 all GREEN and bogie 2 all BLUE is
    // entirely correct — they are never assembled together. Grouping wagon-wide
    // would raise a false blocker on a perfectly good wagon.
    const r = validateSpringNests([...nest('GREEN', 12, 'BOGIE_1'), ...nest('BLUE', 12, 'BOGIE_2')]);

    assert.strictEqual(r.isValid, true, 'separate bogies are separate groups');
    assert.strictEqual(r.groups.length, 2);
    assert.deepStrictEqual(
      r.groups.map((g) => g.groupKey).sort(),
      ['BOGIE_1 OUTER', 'BOGIE_2 OUTER']
    );
  });

  it('TC-NST-05: mixing bands within one bogie is still caught when the other is clean', () => {
    const r = validateSpringNests([
      ...nest('GREEN', 6, 'BOGIE_1'),
      ...nest('BLUE', 6, 'BOGIE_1'),
      ...nest('GREEN', 12, 'BOGIE_2')
    ]);
    const mixed = r.violations.filter((v) => v.type === 'BAND_MIXED');
    assert.strictEqual(mixed.length, 1, 'only bogie 1 is at fault');
    assert.strictEqual(mixed[0].groupKey, 'BOGIE_1 OUTER');
  });

  it('TC-NST-06: measured springs either side of a band boundary are not failed', () => {
    // 259.5 (GREEN) and 260.5 (BLUE) are 1 mm apart and genuinely matched.
    // The band rule applies to strip readings, where the real height is
    // unknown — it must not second-guess a real measurement.
    const r = validateSpringNests([
      { id: 'a', springPosition: 'OUTER', bogiePosition: 'BOGIE_1', condition: 'USED', measuredFreeHeight: 259.5, classifiedBand: 'GREEN', status: 'PASS' },
      { id: 'b', springPosition: 'OUTER', bogiePosition: 'BOGIE_1', condition: 'USED', measuredFreeHeight: 260.5, classifiedBand: 'BLUE', status: 'PASS' }
    ]);
    assert.strictEqual(r.isValid, true, 'a 1 mm spread is a matched pair');
  });

  it('TC-NST-07: legacy rows without a bogie still group, wagon-wide', () => {
    const legacy = nest('GREEN', 4).map((s) => ({ ...s, bogiePosition: null }));
    const r = validateSpringNests(legacy);
    assert.strictEqual(r.groups.length, 1);
    assert.strictEqual(r.groups[0].groupKey, 'OUTER', 'falls back to position alone');
  });

  it('TC-NST-08: a condemned spring never drags its nest into a band violation', () => {
    // It is already blocked on its own, and will be replaced.
    const r = validateSpringNests([
      ...nest('GREEN', 11),
      { ...mk('RED', 99), status: 'CONDEMNED' }
    ]);
    assert.ok(!r.violations.some((v) => v.type === 'BAND_MIXED'), 'the condemned spring is excluded');
  });
});
