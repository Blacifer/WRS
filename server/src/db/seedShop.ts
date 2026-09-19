/**
 * Demo seed — the shop floor's own record, thirty days of it
 * Indian Railways WRS Raipur
 *
 * The wagon seed gives the pipeline thirteen wagons. What it did not give was
 * the record the rest of the system is built on: the sorting bench. Without
 * bench rows, the DRM dashboard reads "Not yet known" three times over, the
 * forecast cannot forecast, the standard report has nothing to report, the
 * gauge register has no drift to show and Ask the Records answers "no springs
 * sorted". A demonstration on that database shows a shop that has never
 * sorted a spring — which is the one thing WRS Raipur is not.
 *
 * So this writes what a month of the bench looks like at a modest pace:
 * four inspectors, three spring positions, both CASNUB families, four gauges
 * (one of which reads a millimetre high, so the drift check has something
 * honest to find), condemnations at about the rate the shop's own SSE quoted.
 * Then the rest of one wagon's story: parts off and on, an air-brake test,
 * four assembly frames with their pocket counts, and a week of shadow-run
 * entries. Everything is written through the same code the screens use,
 * except where a date in the past has to be set — the repositories stamp
 * "now", and a month of sorting done in one second is not a month.
 *
 * Deterministic: the same numbers every time the seed runs, so a screenshot
 * taken today matches one taken tomorrow. Nothing here touches production —
 * seedDemoData is the only caller, and it runs only when demo seeding is
 * allowed.
 */

import type { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifySpring } from '../../../shared/classification/engine.ts';
import { getRDSOTable } from '../../../shared/classification/tables.ts';
import type { BogieType, SpringPosition } from '../../../shared/types.ts';
import { buildAssemblyTags } from '../../../shared/assembly/assemblyCapture.ts';
import { GaugeRepository } from './gaugeRepository.ts';
import { PartLedgerRepository, expectedPartsFor } from './partLedgerRepository.ts';
import { PocketCountRepository } from './pocketCountRepository.ts';
import { ShadowRepository } from './shadowRepository.ts';
import { WagonRepository } from './wagonRepository.ts';
import { WheelRepository } from './wheelRepository.ts';
import { indexManualText, indexedSources } from '../manual/manualIndex.ts';

/** A small deterministic generator, so the demo record is the same on every machine. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const INSPECTORS = [
  { id: 'usr_insp_001', name: 'Ramesh Kumar' },
  { id: 'usr_insp_002', name: 'Praveen Singh' },
  { id: 'usr_insp_003', name: 'Amit Sharma' },
  { id: 'usr_insp_004', name: 'Vikram Yadav' }
];

/** Which gauge each position is read on. OSG-02 is the one that reads high. */
const GAUGES: Record<'OUTER' | 'INNER' | 'SNUBBER', string[]> = {
  OUTER: ['OSG-01', 'OSG-02'],
  INNER: ['ISG-01'],
  SNUBBER: ['SSG-02']
};
const GAUGE_BIAS_MM: Record<string, number> = { 'OSG-02': 1.1 };

const iso = (d: Date) => d.toISOString();
const dayAt = (daysAgo: number, hour: number, minute: number) => {
  const d = new Date(); d.setUTCHours(hour - 5, minute - 30, 0, 0); d.setUTCDate(d.getUTCDate() - daysAgo);
  return d;
};

export function seedShopFloor(db: DatabaseSync): void {
  const already = (db.prepare("SELECT COUNT(*) AS n FROM spring_sorting_records WHERE batch_id LIKE 'demo-%'").get() as any).n;
  if (already > 0) { console.log('   ↳ Shop-floor demo record already present; leaving it.'); return; }

  const rand = lcg(20260915);
  const gauges = new GaugeRepository(db);
  const today = new Date().toISOString().slice(0, 10);
  const nextYear = new Date(); nextYear.setFullYear(nextYear.getFullYear() + 1);
  // Demo gauges. SSG-02 is the real one from the migration and is left exactly as transcribed.
  for (const g of [
    { gaugeCode: 'OSG-01', description: 'Outer spring gauge (NLB/HS)', appliesTo: 'OUTER', certificateNumber: 'DEMO/OSG/01' },
    { gaugeCode: 'OSG-02', description: 'Outer spring gauge (NLB/HS), bench 2', appliesTo: 'OUTER', certificateNumber: 'DEMO/OSG/02' },
    { gaugeCode: 'ISG-01', description: 'Inner spring gauge (NLB/HS)', appliesTo: 'INNER', certificateNumber: 'DEMO/ISG/01' }
  ]) {
    if (!gauges.byCode(g.gaugeCode)) {
      gauges.upsert({ ...g, issuedTo: 'SSE/CWM RWSS Raipur SECR', calibratedOn: '2026-07-01', validUpto: nextYear.toISOString().slice(0, 10), notes: 'Demonstration gauge — not a real instrument.' });
    }
  }

  // ------------------------------------------------------------------ bench
  const insertSort = db.prepare(`
    INSERT INTO spring_sorting_records (
      id, batch_id, bogie_type, spring_condition, spring_position, measured_height, height_is_approximate,
      classified_band, band_roman, status, damage_type, condemnation_reason, table_reference,
      inspector_id, inspector_name, sync_id, supersedes, voided, gauge_code, gauge_calibration_state, measurement_source, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, ?, ?, 'MANUAL', ?)
  `);
  const positions: Array<'OUTER' | 'INNER' | 'SNUBBER'> = ['OUTER', 'INNER', 'SNUBBER'];
  let sorted = 0, condemned = 0;
  // A modest month: weekdays only, about two hours of bench a day at the
  // shop's real pace (60-odd springs an hour), well under its 700 a shift.
  // A demo, not a claim — but the pace has to be the shop's, because the
  // "when does today's pile finish" tile divides by it.
  for (let daysAgo = 29; daysAgo >= 0; daysAgo--) {
    const dow = dayAt(daysAgo, 12, 0).getUTCDay();
    if (dow === 0) continue;
    const perDay = daysAgo === 0 ? 120 : 90 + Math.floor(rand() * 40);
    const windowMinutes = daysAgo === 0 ? 80 : 120;
    for (let k = 0; k < perDay; k++) {
      const insp = INSPECTORS[Math.floor(rand() * INSPECTORS.length)];
      const bogieType: BogieType = rand() < 0.65 ? 'CASNUB_22_NLB' : 'CASNUB_22_HS';
      const position = positions[Math.floor(rand() * 10) < 5 ? 0 : Math.floor(rand() * 10) < 8 ? 1 : 2];
      const gaugeList = GAUGES[position];
      const gaugeCode = gaugeList[Math.floor(rand() * gaugeList.length)];
      // Used springs cluster a little below nominal; a tail runs into the condemning limit.
      const table = tableFor(bogieType, position);
      const centre = table.nominal - 2.5;
      const noise = (rand() + rand() + rand() - 1.5) * 4.2; // roughly normal, sd ≈ 2.1
      let h = centre + noise;
      if (rand() < 0.06) h = table.condemnMin - 0.4 - rand() * 3; // the condemned tail
      h += GAUGE_BIAS_MM[gaugeCode] ?? 0;
      h = Math.round(h * 2) / 2;
      const c = classifySpring({ bogieType, condition: 'USED', position: position as SpringPosition, measuredHeight: h });
      const status = c.status === 'CONDEMNED' ? 'CONDEMNED' : 'PASS';
      const at = dayAt(daysAgo, 9, 0);
      at.setUTCMinutes(at.getUTCMinutes() + Math.floor((k * windowMinutes) / perDay));
      insertSort.run(
        `sort_demo_${daysAgo}_${k}`, `demo-${today}-${daysAgo}-${insp.id.slice(-3)}`, bogieType, 'USED', position, h,
        status === 'PASS' ? c.band : null, status === 'PASS' ? c.bandRoman : null, status,
        status === 'CONDEMNED' ? 'NONE' : null, status === 'CONDEMNED' ? `Free height ${h} mm below condemning limit ${table.condemnMin} mm` : null,
        c.tableReference, insp.id, insp.name, gaugeCode, gauges.stateForReading(gaugeCode), iso(at)
      );
      sorted++; if (status === 'CONDEMNED') condemned++;
    }
  }

  // ------------------------------------------------------- one wagon's story
  const wagons = new WagonRepository(db);
  const ledger = new PartLedgerRepository(db);
  const storyWagon = 'CR/BOBRN/50223'; // Reassembly: parts came off, most went back
  const wagonRow = db.prepare('SELECT id, wagon_type FROM wagons WHERE wagon_number = ?').get(storyWagon) as any;
  if (wagonRow) {
    const expected = expectedPartsFor(db, wagonRow.wagon_type).slice(0, 8);
    const fitter = INSPECTORS[1];
    for (const p of expected) {
      ledger.record({ wagonId: wagonRow.id, wagonNumber: storyWagon, category: p.category, partName: p.partName, bogiePosition: p.bogiePosition, event: 'REMOVED', quantity: p.expectedQuantity || 1, stage: 'DISMANTLING', inspectorId: fitter.id, inspectorName: fitter.name });
    }
    for (const p of expected.slice(0, 6)) {
      ledger.record({ wagonId: wagonRow.id, wagonNumber: storyWagon, category: p.category, partName: p.partName, bogiePosition: p.bogiePosition, event: 'REFITTED', quantity: p.expectedQuantity || 1, stage: 'REASSEMBLY', inspectorId: fitter.id, inspectorName: fitter.name });
    }
    const scrapped = expected[6];
    if (scrapped) {
      ledger.record({ wagonId: wagonRow.id, wagonNumber: storyWagon, category: scrapped.category, partName: scrapped.partName, bogiePosition: scrapped.bogiePosition, event: 'SCRAPPED', quantity: scrapped.expectedQuantity || 1, reason: 'Cracked at the root — condemned on inspection, replacement drawn from stores.', stage: 'REPAIR_REPLACEMENT', inspectorId: fitter.id, inspectorName: fitter.name });
      ledger.record({ wagonId: wagonRow.id, wagonNumber: storyWagon, category: scrapped.category, partName: scrapped.partName, bogiePosition: scrapped.bogiePosition, event: 'REPLACED', quantity: scrapped.expectedQuantity || 1, stage: 'REASSEMBLY', inspectorId: fitter.id, inspectorName: fitter.name });
    }
    // The eighth position came off and has not gone back: the ledger's open question.
  }

  // Air-brake tests on the wagons that have reached or passed the gate.
  const passingReadings = [
    { ref: '1', value: 5.0 }, { ref: '2', value: 5.0 }, { ref: '3', value: 0.05 }, { ref: '4.1', value: 24 }, { ref: '4.2', value: 3.8 },
    { ref: '4.3', value: 1.45 }, { ref: '5.1', value: 52 }, { ref: '6', value: 4 }, { ref: '7', observed: true }, { ref: '8.1', value: 22 },
    { ref: '8.2', value: 3.8 }, { ref: '9', value: 85 }, { ref: '10', value: 0.05 }, { ref: '12', observed: true }
  ];
  for (const w of ['SECR/BOXNHL/10492', 'ECOR/BOXNHL/20831', 'SER/BOXNHL/30914']) {
    const row = db.prepare('SELECT wagon_type FROM wagons WHERE wagon_number = ?').get(w) as any;
    if (!row) continue;
    if (db.prepare('SELECT 1 FROM swt_tests WHERE wagon_number = ?').get(w)) continue;
    wagons.recordSwt({ wagonNumber: w, wagonType: row.wagon_type, pipeType: 'SINGLE', loadCondition: 'EMPTY', readings: passingReadings, testedBy: 'usr_insp_003', testerName: 'Amit Sharma', notes: 'Demo record.' });
  }

  // Four assembly frames on the reassembly wagon, counted — one short, one recounted blind.
  const frameWagon = 'WR/BCNHL/40112';
  const frameRow = db.prepare('SELECT wagon_type FROM wagons WHERE wagon_number = ?').get(frameWagon) as any;
  if (frameRow && !db.prepare("SELECT 1 FROM wagon_photos WHERE wagon_number = ? AND tags_json LIKE '%ASSEMBLY_EVIDENCE%'").get(frameWagon)) {
    const jpeg = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'seed-assets', 'bogie-frame.jpg'));
    const imageData = `data:image/jpeg;base64,${jpeg.toString('base64')}`;
    const counts = new PocketCountRepository(db);
    const frames: Array<[('BOGIE_1' | 'BOGIE_2'), ('SIDE_A' | 'SIDE_B'), number, number, number]> = [
      // BCNHL carries 14 outer, 14 inner, 4 snubber per bogie pair: 7 / 7 / 2 a side.
      // Three complete frames; Bogie 2 · Side B one outer short — the one the demo shows.
      ['BOGIE_1', 'SIDE_A', 7, 7, 2], ['BOGIE_1', 'SIDE_B', 7, 7, 2], ['BOGIE_2', 'SIDE_A', 7, 7, 2], ['BOGIE_2', 'SIDE_B', 6, 7, 2]
    ];
    for (const [bogie, side, outer, inner, snubber] of frames) {
      const photo = wagons.insertPhoto({
        wagonNumber: frameWagon, checklistItemId: null, category: 'SPRINGS', partName: `Bogie assembly — ${bogie.replace('_', ' ')} ${side.replace('_', ' ')}`,
        stage: 'REASSEMBLY', fileName: `${frameWagon.replace(/\//g, '_')}_${bogie}_${side}.jpg`, mimeType: 'image/jpeg', fileSize: jpeg.length,
        imageData, inspectorId: 'usr_insp_002', inspectorName: 'Praveen Singh',
        tags: buildAssemblyTags({ designation: frameRow.wagon_type, bogiePosition: bogie, side }), evidenceStage: 'GENERAL'
      });
      const frame = counts.frameFor(photo.id);
      if (!frame) continue;
      const taps = (n: number, kind: 'OUTER' | 'INNER' | 'SNUBBER', y: number) => Array.from({ length: n }, (_, i) => ({ x: (i + 0.5) / Math.max(n, 1), y, kind }));
      const first = [...taps(outer, 'OUTER', 0.3), ...taps(inner, 'INNER', 0.3), ...taps(snubber, 'SNUBBER', 0.7)];
      counts.record(frame, first, { id: 'usr_insp_002', name: 'Praveen Singh' });
      if (bogie === 'BOGIE_1' && side === 'SIDE_A') counts.record(frame, first, { id: 'usr_insp_004', name: 'Vikram Yadav' });
    }
  }

  // A week of the shadow run: three disagreements and one shift summary.
  const shadow = new ShadowRepository(db);
  if (shadow.listDiscrepancies(undefined, true).length === 0) {
    const d = (daysAgo: number) => dayAt(daysAgo, 12, 0).toISOString().slice(0, 10);
    shadow.recordDiscrepancy({ occurredOn: d(4), shift: 'A', inspectorName: 'Ramesh Kumar', wagonNumber: null, location: 'Bench 1, outer', registerSays: 'GREEN', appSays: 'YELLOW', registerVerdict: 'PASS', appVerdict: 'PASS', whoWasRight: 'APP', cause: 'BAND_MISREAD', why: 'Strip read in poor light; the gauge reading was 256.5, which is yellow.', wouldHaveStoppedAWagon: false, reportedBy: 'usr_sup_001' });
    shadow.recordDiscrepancy({ occurredOn: d(3), shift: 'A', inspectorName: 'Vikram Yadav', wagonNumber: 'NR/BOXN/60334', location: 'Bogie 2, snubber', registerSays: 'PASS', appSays: 'CONDEMNED', registerVerdict: 'PASS', appVerdict: 'CONDEMNED', whoWasRight: 'APP', cause: 'CONFIGURATION', why: 'Register used the NLB table for an HS snubber.', wouldHaveStoppedAWagon: true, reportedBy: 'usr_sup_001' });
    shadow.recordDiscrepancy({ occurredOn: d(2), shift: 'B', inspectorName: 'Amit Sharma', wagonNumber: null, location: 'Bench 2, inner', registerSays: 'BLUE', appSays: 'GREEN', registerVerdict: 'PASS', appVerdict: 'PASS', whoWasRight: 'REGISTER', cause: 'DEVICE', why: 'Tablet tap landed on the wrong band; corrected on the bench.', wouldHaveStoppedAWagon: false, reportedBy: 'usr_sup_001' });
    shadow.recordSummary({ summaryDate: d(2), shift: 'B', supervisorId: 'usr_sup_001', registerMinutesOneWagon: 38, appMinutesOneWagon: 31, transcriptionErrorsBoxMissed: 1, whatAppGotWrong: 'One mistap on the band strip, corrected on the bench.', whatAppCaught: 'A snubber judged on the wrong table in the register.', whatSlowed: 'Photographing condemned springs adds a few seconds each.', wouldHaveStoppedAWagon: 'The snubber on NR/BOXN/60334 — the register would have passed it.' });
  }

  // Wheel readings on the QC-gate wagon: eight wheels chalked on the disc,
  // one of them below the last-shop-issue diameter, so the gate has a wheel
  // to hold and the checklist item shows where the figures came from.
  seedWheelReadings(db);

  // The CBC and draft-gear section's wall charts, transcribed from the site
  // visit, so Ask the Manual has something of this shop's own to cite even
  // before the RDSO manual is indexed. Skipped if already present.
  try {
    const have = indexedSources(db).CBC_WALL || 0;
    const chartPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs', 'shop-floor', 'cbc-draft-gear-wall-charts.txt');
    if (!have) indexManualText(db, readFileSync(chartPath, 'utf8'), 'cbc-draft-gear-wall-charts.txt', 'CBC_WALL');
    const wheelPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs', 'shop-floor', 'wheel-limits-irimee.txt');
    if (!(indexedSources(db).WHEEL_LIMITS || 0)) indexManualText(db, readFileSync(wheelPath, 'utf8'), 'wheel-limits-irimee.txt', 'WHEEL_LIMITS');
  } catch { /* the charts are a convenience; the seed is not */ }

  console.log(`   ↳ Shop floor: ${sorted} bench springs over 30 days (${condemned} condemned), parts ledger, air-brake tests, assembly frames with pocket counts, shadow-run entries.`);
}

function tableFor(bogieType: BogieType, position: 'OUTER' | 'INNER' | 'SNUBBER'): { nominal: number; condemnMin: number } {
  const t = getRDSOTable(bogieType, 'USED', position);
  if (!t) throw new Error(`No RDSO table for ${bogieType} USED ${position}`);
  // Not every table publishes a nominal; the top of Band I is close enough for a demo distribution's centre.
  const nominal = typeof t.nominalFreeHeight === 'number' ? t.nominalFreeHeight : Math.max(...t.bands.map((b) => b.maxHeight)) - 2;
  return { nominal, condemnMin: t.condemningMinHeight };
}

function seedWheelReadings(db: DatabaseSync): void {
  const wheels = new WheelRepository(db);
  const wagon = 'SER/BOXNHL/30914'; // at the final gate
  if (!db.prepare('SELECT 1 FROM wagons WHERE wagon_number = ?').get(wagon)) return;
  if (wheels.history(wagon).length > 0) return;
  // The chalk from the floor: a worn but matched set (wagon spread 20.5 mm,
  // inside the 25), with the axle-3 pair at 917.5 / 917.8 — legal on the
  // line, below the 919 mm last-shop-issue diameter, so it may not leave a
  // POH. The gate holds the wagon for that pair and nothing else.
  const readings: Array<[1 | 2 | 3 | 4, 'L' | 'R', number, number]> = [
    [1, 'L', 938.0, 27.5], [1, 'R', 938.0, 27.0], [2, 'L', 936.5, 26.5], [2, 'R', 936.5, 27.5],
    [3, 'L', 917.5, 24.0], [3, 'R', 917.8, 23.5], [4, 'L', 921.0, 25.0], [4, 'R', 921.0, 25.5]
  ];
  for (const [axle, side, d, flange] of readings) {
    wheels.record({ wagonNumber: wagon, axle, side, reading: { treadDiameterMm: d, flangeThicknessMm: flange }, instrument: 'WDG-1', inspectorId: 'usr_insp_003', inspectorName: 'Amit Sharma' });
  }
}
