/**
 * Demo Seed Engine Verification Suite
 * Indian Railways WRS Raipur (Phase 1 & Phase 2)
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../src/db/migrations.ts';
import { seedDemoData } from '../src/db/seed.ts';
import { WagonRepository } from '../src/db/wagonRepository.ts';
import { InspectionRepository } from '../src/db/repository.ts';

describe('Rich Demo Seed Data Engine Verification', () => {
  let db: DatabaseSync;
  let wagonRepo: WagonRepository;
  let inspRepo: InspectionRepository;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    runMigrations(db);
    wagonRepo = new WagonRepository(db);
    inspRepo = new InspectionRepository(db);
  });

  it('TC-SEED-01: Successfully seeds 13 wagons across all 7 stages', () => {
    seedDemoData(db);

    const wagons = wagonRepo.queryWagons({ limit: 100 }).records;
    assert.strictEqual(wagons.length, 13, 'Must seed exactly 13 demo wagons');

    const stageCounts: Record<string, number> = {};
    for (const w of wagons) {
      stageCounts[w.currentStage] = (stageCounts[w.currentStage] || 0) + 1;
    }

    assert.strictEqual(stageCounts['RELEASE'], 2, '2 wagons in RELEASE');
    assert.strictEqual(stageCounts['FINAL_QC_GATE'], 1, '1 wagon in FINAL_QC_GATE');
    assert.strictEqual(stageCounts['REASSEMBLY'], 2, '2 wagons in REASSEMBLY');
    assert.strictEqual(stageCounts['REPAIR_REPLACEMENT'], 2, '2 wagons in REPAIR_REPLACEMENT');
    assert.strictEqual(stageCounts['COMPONENT_INSPECTION'], 3, '3 wagons in COMPONENT_INSPECTION');
    assert.strictEqual(stageCounts['DISMANTLING'], 2, '2 wagons in DISMANTLING');
    assert.strictEqual(stageCounts['ENTRY_REGISTRATION'], 1, '1 wagon in ENTRY_REGISTRATION');
  });

  it('TC-SEED-02: Released wagons have valid release certificates, actual_release_date, and realistic TAT', () => {
    seedDemoData(db);

    const releasedWagons = wagonRepo.queryWagons({ stage: 'RELEASE' }).records;
    assert.strictEqual(releasedWagons.length, 2);

    for (const rw of releasedWagons) {
      assert.strictEqual(rw.status, 'RELEASED');
      assert.ok(rw.actualReleaseDate, 'actualReleaseDate must be set');
      assert.ok(rw.entryDate, 'entryDate must be set');

      const entryTime = new Date(rw.entryDate).getTime();
      const releaseTime = new Date(rw.actualReleaseDate).getTime();
      const tatDays = (releaseTime - entryTime) / (1000 * 60 * 60 * 24);

      assert.ok(tatDays >= 5.0 && tatDays <= 7.0, `TAT (${tatDays.toFixed(2)} days) must be in 5-7 days range`);

      const signoff = wagonRepo.getGateSignoff(rw.wagonNumber);
      assert.ok(signoff, `Gate signoff must exist for released wagon ${rw.wagonNumber}`);
      assert.ok(signoff.certificateNumber.startsWith('WRS/QC-REL/'), 'Certificate number must follow standard format');
      assert.ok(signoff.digitalSignature, 'Digital signature must be recorded');
    }
  });

  it('TC-SEED-03: Wagon at FINAL_QC_GATE has active blockers (condemned spring + missing bearing inspection)', () => {
    seedDemoData(db);

    const blockerWagon = wagonRepo.getWagonByNumber('SER/BOXNHL/30914');
    assert.ok(blockerWagon, 'Blocker wagon SER/BOXNHL/30914 must exist');
    assert.strictEqual(blockerWagon.currentStage, 'FINAL_QC_GATE');

    const evaluation = wagonRepo.evaluateExitGate('SER/BOXNHL/30914');
    assert.strictEqual(evaluation.canRelease, false, 'Wagon at FINAL_QC_GATE with active blockers cannot be released');
    assert.ok(evaluation.blockers.length >= 2, 'Must contain at least 2 active blockers');

    const hasCondemnedSpring = evaluation.blockerDetails.some(b => b.issueType === 'SPRING_CONDEMNED' || b.category === 'SPRINGS');
    assert.ok(hasCondemnedSpring, 'Must flag condemned spring as exit gate blocker');

    const hasMissingBearing = evaluation.blockerDetails.some(b => b.issueType === 'MISSING_INSPECTION' && b.category === 'BEARINGS');
    assert.ok(hasMissingBearing, 'Must flag missing bearing inspection as exit gate blocker');
  });

  it('TC-SEED-04: Seeds 35+ spring inspection records covering all 6 RDSO bands and 2 condemned springs', () => {
    seedDemoData(db);

    const springs = inspRepo.queryInspections({ limit: 100 }).records;
    assert.ok(springs.length >= 35, `Must have 35+ spring inspections, found ${springs.length}`);

    const bands = new Set<string>();
    let condemnedCount = 0;
    const bogieTypes = new Set<string>();
    const conditions = new Set<string>();
    const inspectors = new Set<string>();

    for (const sp of springs) {
      if (sp.classifiedBand) {
        bands.add(sp.classifiedBand);
      }
      if (sp.status === 'CONDEMNED') {
        condemnedCount++;
      }
      bogieTypes.add(sp.bogieType);
      conditions.add(sp.condition);
      inspectors.add(sp.inspectorId);
    }

    const requiredBands = ['BLUE', 'GREEN', 'YELLOW', 'ORANGE', 'WHITE', 'RED'];
    for (const rb of requiredBands) {
      assert.ok(bands.has(rb as any), `Band ${rb} must be present in spring seed data`);
    }

    assert.strictEqual(condemnedCount, 2, 'Must have exactly 2 condemned springs');
    assert.ok(bogieTypes.has('CASNUB_22_NLB'), 'CASNUB_22_NLB must be present');
    assert.ok(bogieTypes.has('CASNUB_22_HS'), 'CASNUB_22_HS must be present');
    assert.ok(bogieTypes.has('CASNUB_22_RFT'), 'CASNUB_22_RFT must be present');
    assert.ok(conditions.has('USED'), 'USED condition must be present');
    assert.ok(conditions.has('NEW'), 'NEW condition must be present');
    assert.ok(inspectors.size >= 4, 'Must have at least 4 inspectors');
  });

  it('TC-SEED-05: Checklist items are populated with PASS, REPAIRED, REPLACED, CONDEMNED, PENDING', () => {
    seedDemoData(db);

    const partsAnalytics = wagonRepo.getAnalyticsParts();
    assert.ok(partsAnalytics.totalInspected > 200, 'Must have 200+ checklist items inspected');
    assert.ok(partsAnalytics.totalPassed > 0, 'Must have passed parts');
    assert.ok(partsAnalytics.totalRepaired > 0, 'Must have repaired parts');
    assert.ok(partsAnalytics.totalReplaced > 0, 'Must have replaced parts');
    assert.ok(partsAnalytics.totalCondemned > 0, 'Must have condemned parts');

    const expectedCats = [
      'SPRINGS', 'WHEELS_AXLES', 'BEARINGS', 'BRAKE_SYSTEM',
      'COUPLERS_DRAFT_GEAR', 'BOGIE_FRAME_BOLSTER', 'FRICTION_WEDGES', 'BODY_UNDERFRAME'
    ];
    for (const cat of expectedCats) {
      assert.ok(partsAnalytics.categoryBreakdown[cat], `Category ${cat} must exist in breakdown`);
      assert.ok(partsAnalytics.categoryBreakdown[cat].total > 0, `Category ${cat} must have items`);
    }
  });

  it('TC-SEED-06: Stage transition timeline history is complete for each wagon', () => {
    seedDemoData(db);

    const wagons = wagonRepo.queryWagons({ limit: 100 }).records;
    for (const w of wagons) {
      const timeline = wagonRepo.getWagonTimeline(w.wagonNumber);
      assert.ok(timeline.length >= 1, `Timeline for wagon ${w.wagonNumber} must not be empty`);

      // Ensure chronological ordering
      for (let i = 0; i < timeline.length - 1; i++) {
        const cur = new Date(timeline[i].createdAt).getTime();
        const next = new Date(timeline[i + 1].createdAt).getTime();
        assert.ok(cur <= next, `Transitions for ${w.wagonNumber} must be in ascending chronological order`);
      }
    }
  });

  it('TC-SEED-07: Idempotency - running seedDemoData multiple times creates zero duplicate records', () => {
    seedDemoData(db);
    const countWagons1 = wagonRepo.queryWagons({ limit: 100 }).totalCount;
    const countSprings1 = inspRepo.queryInspections({ limit: 100 }).totalCount;

    // Run a second time
    seedDemoData(db);
    const countWagons2 = wagonRepo.queryWagons({ limit: 100 }).totalCount;
    const countSprings2 = inspRepo.queryInspections({ limit: 100 }).totalCount;

    assert.strictEqual(countWagons2, countWagons1, 'Wagon count must not increase on second run');
    assert.strictEqual(countSprings2, countSprings1, 'Spring inspection count must not increase on second run');

    // Run a third time
    seedDemoData(db);
    const countWagons3 = wagonRepo.queryWagons({ limit: 100 }).totalCount;
    const countSprings3 = inspRepo.queryInspections({ limit: 100 }).totalCount;

    assert.strictEqual(countWagons3, countWagons1, 'Wagon count must not increase on third run');
    assert.strictEqual(countSprings3, countSprings1, 'Spring inspection count must not increase on third run');
  });

  it('TC-SEED-08: Analytics endpoints return rich non-zero metrics', () => {
    seedDemoData(db);

    const pipeline = wagonRepo.getAnalyticsPipeline();
    assert.strictEqual(pipeline.totalActive, 11, 'Total active wagons must be 11');
    assert.strictEqual(pipeline.totalReleased, 2, 'Total released wagons must be 2');

    const tat = wagonRepo.getAnalyticsTAT();
    assert.strictEqual(tat.completedWagonsCount, 2, 'Completed wagons count must be 2');
    assert.ok(tat.averageHours >= 120 && tat.averageHours <= 168, `Average TAT hours (${tat.averageHours}) in 5-7 days range`);
    assert.ok(tat.trends.length > 0, 'TAT trends must have entries');

    const throughput = wagonRepo.getAnalyticsThroughput();
    assert.ok(throughput.daily.length > 0, 'Throughput daily records must be populated');

    const inspectors = wagonRepo.getAnalyticsInspectors();
    assert.strictEqual(inspectors.inspectors.length, 4, 'Must return metrics for 4 inspectors');
    for (const insp of inspectors.inspectors) {
      assert.ok(insp.inspectionsCompleted > 0, `Inspector ${insp.inspectorName} must have completed inspections`);
    }

    const blockers = wagonRepo.getAnalyticsBlockers();
    assert.ok(blockers.blockedWagons.length >= 1, 'Blocked wagons list must contain blocked wagon');
    const hasTargetBlocker = blockers.blockedWagons.some((b: any) => b.wagonNumber === 'SER/BOXNHL/30914');
    assert.ok(hasTargetBlocker, 'SER/BOXNHL/30914 must be present in blocked wagons list');
  });
});
