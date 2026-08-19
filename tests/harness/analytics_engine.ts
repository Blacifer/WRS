/**
 * DRM Officer Analytics & Compliance Reporting Engine
 * Indian Railways WRS Raipur (Phase 2)
 *
 * Computes real-time wagon pipeline, turnaround time (TAT), throughput,
 * parts health statistics, inspector metrics, QC blockers, and CSV/PDF export.
 */

import type {
  WagonRecord,
  ChecklistItem,
  InspectionRecord,
  LifecycleStage,
  CASNUBCategory,
  AnalyticsPipelineResponse,
  AnalyticsTATResponse,
  AnalyticsThroughputResponse,
  AnalyticsPartsResponse,
  AnalyticsInspectorsResponse,
  AnalyticsBlockersResponse
} from '../../shared/types.ts';
import { LIFECYCLE_STAGES, CASNUB_CATEGORIES } from '../../shared/types.ts';
import { ExitGateEngine } from './gate_engine.ts';

export class AnalyticsEngine {
  /**
   * Wagon Pipeline Visualizer
   */
  public static getPipeline(wagons: WagonRecord[]): AnalyticsPipelineResponse {
    const counts: Record<LifecycleStage, number> = {
      ENTRY_REGISTRATION: 0,
      DISMANTLING: 0,
      COMPONENT_INSPECTION: 0,
      REPAIR_REPLACEMENT: 0,
      REASSEMBLY: 0,
      FINAL_QC_GATE: 0,
      RELEASE: 0
    };

    for (const w of wagons) {
      if (counts[w.currentStage] !== undefined) {
        counts[w.currentStage]++;
      }
    }

    const totalReleased = counts.RELEASE;
    const totalActive = wagons.length - totalReleased;

    return {
      counts,
      totalActive,
      totalReleased,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Turnaround Time (TAT) Analytics
   */
  public static getTAT(wagons: WagonRecord[]): AnalyticsTATResponse {
    const completed = wagons.filter(w => w.currentStage === 'RELEASE' && w.releaseDate);

    if (completed.length === 0) {
      return {
        averageHours: 0,
        medianHours: 0,
        minHours: 0,
        maxHours: 0,
        completedWagonsCount: 0,
        trends: []
      };
    }

    const tatHours: number[] = [];
    const dailyMap: Record<string, number[]> = {};

    for (const w of completed) {
      const entryTime = new Date(w.entryDate).getTime();
      const releaseTime = new Date(w.releaseDate!).getTime();
      const hours = Math.max(0.1, Number(((releaseTime - entryTime) / (1000 * 60 * 60)).toFixed(2)));
      tatHours.push(hours);

      const dayKey = w.releaseDate!.slice(0, 10);
      if (!dailyMap[dayKey]) dailyMap[dayKey] = [];
      dailyMap[dayKey].push(hours);
    }

    tatHours.sort((a, b) => a - b);
    const sum = tatHours.reduce((acc, h) => acc + h, 0);
    const avg = Number((sum / tatHours.length).toFixed(2));
    const mid = Math.floor(tatHours.length / 2);
    const median = tatHours.length % 2 !== 0 ? tatHours[mid] : Number(((tatHours[mid - 1] + tatHours[mid]) / 2).toFixed(2));
    const min = tatHours[0];
    const max = tatHours[tatHours.length - 1];

    const trends = Object.entries(dailyMap).map(([period, arr]) => ({
      period,
      avgHours: Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2)),
      count: arr.length
    }));

    return {
      averageHours: avg,
      medianHours: median,
      minHours: min,
      maxHours: max,
      completedWagonsCount: completed.length,
      trends
    };
  }

  /**
   * Throughput Statistics
   */
  public static getThroughput(wagons: WagonRecord[]): AnalyticsThroughputResponse {
    const dailyMap: Record<string, { entered: number; released: number }> = {};

    for (const w of wagons) {
      const entryDay = w.entryDate.slice(0, 10);
      if (!dailyMap[entryDay]) dailyMap[entryDay] = { entered: 0, released: 0 };
      dailyMap[entryDay].entered++;

      if (w.releaseDate) {
        const releaseDay = w.releaseDate.slice(0, 10);
        if (!dailyMap[releaseDay]) dailyMap[releaseDay] = { entered: 0, released: 0 };
        dailyMap[releaseDay].released++;
      }
    }

    const daily = Object.entries(dailyMap).map(([date, counts]) => ({
      date,
      entered: counts.entered,
      released: counts.released
    }));

    return {
      daily,
      weekly: daily,
      monthly: daily
    };
  }

  /**
   * CASNUB Bogie Parts Health & Condemnation Statistics
   */
  public static getPartsStats(items: ChecklistItem[]): AnalyticsPartsResponse {
    const categoryBreakdown: Record<CASNUBCategory, {
      total: number;
      pass: number;
      fail: number;
      condemned: number;
      repaired: number;
      replaced: number;
    }> = {
      SPRINGS: { total: 0, pass: 0, fail: 0, condemned: 0, repaired: 0, replaced: 0 },
      WHEELS_AXLES: { total: 0, pass: 0, fail: 0, condemned: 0, repaired: 0, replaced: 0 },
      BEARINGS: { total: 0, pass: 0, fail: 0, condemned: 0, repaired: 0, replaced: 0 },
      BRAKE_SYSTEM: { total: 0, pass: 0, fail: 0, condemned: 0, repaired: 0, replaced: 0 },
      COUPLERS_DRAFT_GEAR: { total: 0, pass: 0, fail: 0, condemned: 0, repaired: 0, replaced: 0 },
      BOGIE_FRAME_BOLSTER: { total: 0, pass: 0, fail: 0, condemned: 0, repaired: 0, replaced: 0 },
      FRICTION_WEDGES: { total: 0, pass: 0, fail: 0, condemned: 0, repaired: 0, replaced: 0 },
      BODY_UNDERFRAME: { total: 0, pass: 0, fail: 0, condemned: 0, repaired: 0, replaced: 0 }
    };

    let totalPass = 0;
    let totalFail = 0;
    let totalCondemned = 0;
    let totalRepaired = 0;
    let totalReplaced = 0;

    for (const item of items) {
      const cat = categoryBreakdown[item.category];
      if (cat) {
        cat.total++;
        if (item.status === 'PASS') { cat.pass++; totalPass++; }
        else if (item.status === 'FAIL') { cat.fail++; totalFail++; }
        else if (item.status === 'CONDEMNED') { cat.condemned++; totalCondemned++; }
        else if (item.status === 'REPAIRED') { cat.repaired++; totalRepaired++; }
        else if (item.status === 'REPLACED') { cat.replaced++; totalReplaced++; }
      }
    }

    return {
      totalInspected: items.length,
      totalPassed: totalPass,
      totalFailed: totalFail,
      totalCondemned: totalCondemned,
      totalRepaired: totalRepaired,
      totalReplaced: totalReplaced,
      categoryBreakdown
    };
  }

  /**
   * Inspector Productivity Metrics
   */
  public static getInspectorMetrics(items: ChecklistItem[]): AnalyticsInspectorsResponse {
    const map: Record<string, {
      inspectorId: string;
      inspectorName: string;
      inspectionsCompleted: number;
      partsPassed: number;
      partsFailed: number;
      partsCondemned: number;
    }> = {};

    for (const item of items) {
      const id = item.inspectedBy || 'UNKNOWN';
      const name = item.inspectedByName || id;

      if (!map[id]) {
        map[id] = {
          inspectorId: id,
          inspectorName: name,
          inspectionsCompleted: 0,
          partsPassed: 0,
          partsFailed: 0,
          partsCondemned: 0
        };
      }

      map[id].inspectionsCompleted++;
      if (item.status === 'PASS' || item.status === 'REPAIRED' || item.status === 'REPLACED') {
        map[id].partsPassed++;
      } else if (item.status === 'FAIL') {
        map[id].partsFailed++;
      } else if (item.status === 'CONDEMNED') {
        map[id].partsCondemned++;
      }
    }

    return {
      inspectors: Object.values(map)
    };
  }

  /**
   * Active QC Blockers
   */
  public static getBlockers(
    wagons: WagonRecord[],
    allChecklistItems: ChecklistItem[],
    allSprings: InspectionRecord[]
  ): AnalyticsBlockersResponse {
    const blockedWagons: AnalyticsBlockersResponse['blockedWagons'] = [];

    const activeWagons = wagons.filter(w => w.currentStage !== 'RELEASE');

    for (const w of activeWagons) {
      const wItems = allChecklistItems.filter(i => i.wagonNumber === w.wagonNumber);
      const wSprings = allSprings.filter(s => s.wagonNumber === w.wagonNumber);
      const gateRes = ExitGateEngine.evaluateGateStatus(w, wItems, wSprings, false);

      if (gateRes.blockers.length > 0) {
        blockedWagons.push({
          wagonNumber: w.wagonNumber,
          wagonType: w.wagonType,
          currentStage: w.currentStage,
          blockers: gateRes.blockers,
          entryDate: w.entryDate
        });
      }
    }

    return { blockedWagons };
  }

  /**
   * Export Compliance Audit Data (CSV format)
   */
  public static exportComplianceCSV(wagons: WagonRecord[], items: ChecklistItem[]): string {
    const headers = [
      'WagonNumber', 'WagonType', 'OwningRailway', 'CurrentStage', 'EntryDate',
      'ReleaseDate', 'TotalItems', 'PassedItems', 'CondemnedItems', 'RepairedItems'
    ];

    const lines = [headers.join(',')];

    for (const w of wagons) {
      const wItems = items.filter(i => i.wagonNumber === w.wagonNumber);
      const passed = wItems.filter(i => i.status === 'PASS').length;
      const condemned = wItems.filter(i => i.status === 'CONDEMNED').length;
      const repaired = wItems.filter(i => i.status === 'REPAIRED' || i.status === 'REPLACED').length;

      lines.push([
        `"${w.wagonNumber}"`,
        `"${w.wagonType}"`,
        `"${w.owningRailway}"`,
        `"${w.currentStage}"`,
        `"${w.entryDate}"`,
        `"${w.releaseDate || ''}"`,
        wItems.length,
        passed,
        condemned,
        repaired
      ].join(','));
    }

    return lines.join('\n');
  }
}
