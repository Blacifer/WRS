/**
 * Trackside OMRS (Online Monitoring of Rolling Stock) AI Triage Repository
 * Indian Railways WRS Raipur (Phase 3 - M1 / R5)
 */

import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import type {
  OMRSScanRecord,
  OMRSPredictedDefect,
  OMRSTriageSeverity,
  AITriageResult,
  InventoryReservation
} from '../../../shared/types.ts';
import { InventoryRepository } from './inventoryRepository.ts';

export class OMRSRepository {
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  /**
   * Helper to map an omrs_scans SQL row to OMRSScanRecord domain model
   */
  private mapOMRSRow(row: any): OMRSScanRecord {
    let predictedDefects: OMRSPredictedDefect[] = [];
    try {
      if (row.predicted_defects_json) {
        predictedDefects = JSON.parse(row.predicted_defects_json);
      }
    } catch {
      predictedDefects = [];
    }

    return {
      id: row.id,
      wagonNumber: row.wagon_number,
      scanTimestamp: row.scan_timestamp,
      location: row.location || 'Trackside OMRS Sensor Array - Raipur Outer Yard (KM 828/14)',
      trainSpeedKmph: Number(row.train_speed_kmph ?? 65),
      wheelImpactKn: row.wheel_impact_kn !== null && row.wheel_impact_kn !== undefined
        ? Number(row.wheel_impact_kn)
        : null,
      acousticBearingPeakDb: row.acoustic_bearing_peak_db !== null && row.acoustic_bearing_peak_db !== undefined
        ? Number(row.acoustic_bearing_peak_db)
        : null,
      temperatureCelsius: row.temperature_celsius !== null && row.temperature_celsius !== undefined
        ? Number(row.temperature_celsius)
        : null,
      wheelProfileDeviationMm: row.wheel_profile_deviation_mm !== null && row.wheel_profile_deviation_mm !== undefined
        ? Number(row.wheel_profile_deviation_mm)
        : null,
      predictedDefects,
      triageSeverity: row.triage_severity as OMRSTriageSeverity,
      isTriaged: Boolean(row.is_triaged),
      autoReservationTriggered: Boolean(row.auto_reservation_triggered),
      createdAt: row.created_at
    };
  }

  /**
   * Record a trackside OMRS telemetry scan
   */
  public recordScan(data: {
    id?: string;
    wagonNumber: string;
    scanTimestamp?: string;
    location?: string;
    trainSpeedKmph?: number;
    wheelImpactKn?: number | null;
    acousticBearingPeakDb?: number | null;
    temperatureCelsius?: number | null;
    wheelProfileDeviationMm?: number | null;
    predictedDefects?: OMRSPredictedDefect[];
    triageSeverity?: OMRSTriageSeverity;
    isTriaged?: boolean;
    autoReservationTriggered?: boolean;
  }): OMRSScanRecord {
    const id = data.id || `omrs_${crypto.randomUUID()}`;
    const wagonNumber = data.wagonNumber.trim().toUpperCase();
    const scanTimestamp = data.scanTimestamp || new Date().toISOString();
    const location = data.location || 'Trackside OMRS Sensor Array - Raipur Outer Yard (KM 828/14)';
    const trainSpeedKmph = Number(data.trainSpeedKmph ?? 65.0);
    const wheelImpactKn = data.wheelImpactKn !== undefined ? data.wheelImpactKn : null;
    const acousticBearingPeakDb = data.acousticBearingPeakDb !== undefined ? data.acousticBearingPeakDb : null;
    const temperatureCelsius = data.temperatureCelsius !== undefined ? data.temperatureCelsius : null;
    const wheelProfileDeviationMm = data.wheelProfileDeviationMm !== undefined ? data.wheelProfileDeviationMm : null;

    let predictedDefects = data.predictedDefects || [];
    let triageSeverity = data.triageSeverity;

    // If predictedDefects is empty, derive from telemetry thresholds
    if (predictedDefects.length === 0) {
      predictedDefects = this.evaluateTelemetryDefects({
        wheelImpactKn,
        acousticBearingPeakDb,
        temperatureCelsius,
        wheelProfileDeviationMm
      });
    }

    if (!triageSeverity) {
      triageSeverity = this.computeSeverity(predictedDefects, {
        wheelImpactKn,
        acousticBearingPeakDb,
        temperatureCelsius,
        wheelProfileDeviationMm
      });
    }

    const isTriaged = data.isTriaged ? 1 : 0;
    const autoReservationTriggered = data.autoReservationTriggered ? 1 : 0;
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO omrs_scans (
        id, wagon_number, scan_timestamp, location, train_speed_kmph,
        wheel_impact_kn, acoustic_bearing_peak_db, temperature_celsius,
        wheel_profile_deviation_mm, predicted_defects_json, triage_severity,
        is_triaged, auto_reservation_triggered, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      wagonNumber,
      scanTimestamp,
      location,
      trainSpeedKmph,
      wheelImpactKn,
      acousticBearingPeakDb,
      temperatureCelsius,
      wheelProfileDeviationMm,
      JSON.stringify(predictedDefects),
      triageSeverity,
      isTriaged,
      autoReservationTriggered,
      now
    );

    const row = this.db.prepare(`SELECT * FROM omrs_scans WHERE id = ?`).get(id);
    return this.mapOMRSRow(row);
  }

  /**
   * Get latest scan for a wagon
   */
  public getScanByWagon(wagonNumber: string): OMRSScanRecord | null {
    if (!wagonNumber) return null;
    const cleanNumber = wagonNumber.trim().toUpperCase();
    const row = this.db.prepare(`
      SELECT * FROM omrs_scans
      WHERE wagon_number = ?
      ORDER BY scan_timestamp DESC, created_at DESC
      LIMIT 1
    `).get(cleanNumber);

    if (!row) return null;
    return this.mapOMRSRow(row);
  }

  /**
   * Get recent scans across the yard
   */
  public getRecentScans(limit: number = 50): OMRSScanRecord[] {
    const safeLimit = Math.max(1, Math.min(limit, 200));
    const rows = this.db.prepare(`
      SELECT * FROM omrs_scans
      ORDER BY scan_timestamp DESC, created_at DESC
      LIMIT ?
    `).all(safeLimit);

    return rows.map((r: any) => this.mapOMRSRow(r));
  }

  /**
   * Evaluate telemetry signals and generate predicted defects list
   */
  public evaluateTelemetryDefects(telemetry: {
    wheelImpactKn?: number | null;
    acousticBearingPeakDb?: number | null;
    temperatureCelsius?: number | null;
    wheelProfileDeviationMm?: number | null;
  }): OMRSPredictedDefect[] {
    const defects: OMRSPredictedDefect[] = [];

    // 1. Wheel Impact Load Detector (WILD)
    if (telemetry.wheelImpactKn !== null && telemetry.wheelImpactKn !== undefined) {
      if (telemetry.wheelImpactKn > 130) {
        defects.push({
          component: 'WHEELSET_ASSEMBLY',
          defectType: 'WHEEL_FLAT_IMPACT_HIGH',
          severity: 'CRITICAL',
          confidence: 0.95,
          recommendedPartCode: 'PRT-WHL-BOXNHL',
          quantity: 1
        });
      } else if (telemetry.wheelImpactKn > 100) {
        defects.push({
          component: 'WHEELSET_ASSEMBLY',
          defectType: 'WHEEL_TREAD_IRREGULARITY',
          severity: 'ADVISORY',
          confidence: 0.82,
          recommendedPartCode: 'PRT-WHL-BOXNHL',
          quantity: 1
        });
      }
    }

    // 2. Acoustic Bearing Detector (ABD)
    if (telemetry.acousticBearingPeakDb !== null && telemetry.acousticBearingPeakDb !== undefined) {
      if (telemetry.acousticBearingPeakDb > 80) {
        defects.push({
          component: 'CTRB_BEARING',
          defectType: 'CTRB_BEARING_ACOUSTIC_DEFECT',
          severity: 'CRITICAL',
          confidence: 0.96,
          recommendedPartCode: 'PRT-BRG-CTRB',
          quantity: 2
        });
      } else if (telemetry.acousticBearingPeakDb > 70) {
        defects.push({
          component: 'CTRB_BEARING',
          defectType: 'BEARING_VIBRATION_ADVISORY',
          severity: 'ADVISORY',
          confidence: 0.78,
          recommendedPartCode: 'PRT-BRG-CTRB',
          quantity: 1
        });
      }
    }

    // 3. Hot Axle Box Detector (HABD) / Thermal Infrared
    if (telemetry.temperatureCelsius !== null && telemetry.temperatureCelsius !== undefined) {
      if (telemetry.temperatureCelsius > 75) {
        defects.push({
          component: 'BRAKE_BLOCK_AND_AXLE',
          defectType: 'HOT_AXLE_BRAKE_BINDING',
          severity: 'CRITICAL',
          confidence: 0.91,
          recommendedPartCode: 'PRT-BRK-COMP-BLK',
          quantity: 4
        });
      } else if (telemetry.temperatureCelsius > 60) {
        defects.push({
          component: 'BRAKE_BLOCK_AND_AXLE',
          defectType: 'BRAKE_DRAG_WARM_AXLE',
          severity: 'ADVISORY',
          confidence: 0.75,
          recommendedPartCode: 'PRT-BRK-COMP-BLK',
          quantity: 2
        });
      }
    }

    // 4. Optical Wheel Profile & Flange Gauge
    if (telemetry.wheelProfileDeviationMm !== null && telemetry.wheelProfileDeviationMm !== undefined) {
      if (telemetry.wheelProfileDeviationMm > 5.0) {
        defects.push({
          component: 'WHEEL_FLANGE',
          defectType: 'WHEEL_SHARP_FLANGE_CRITICAL',
          severity: 'CRITICAL',
          confidence: 0.92,
          recommendedPartCode: 'PRT-WHL-BOXNHL',
          quantity: 1
        });
      } else if (telemetry.wheelProfileDeviationMm > 3.5) {
        defects.push({
          component: 'WHEEL_FLANGE',
          defectType: 'WHEEL_FLANGE_WEAR_ADVISORY',
          severity: 'ADVISORY',
          confidence: 0.85,
          recommendedPartCode: 'PRT-WHL-BOXNHL',
          quantity: 1
        });
      }
    }

    return defects;
  }

  /**
   * Compute overall scan triage severity from defects and telemetry
   */
  private computeSeverity(
    defects: OMRSPredictedDefect[],
    telemetry: {
      wheelImpactKn?: number | null;
      acousticBearingPeakDb?: number | null;
      temperatureCelsius?: number | null;
      wheelProfileDeviationMm?: number | null;
    }
  ): OMRSTriageSeverity {
    const hasCriticalDefect = defects.some(d => d.severity === 'CRITICAL');
    const isCriticalTelemetry =
      (telemetry.wheelImpactKn ?? 0) > 130 ||
      (telemetry.acousticBearingPeakDb ?? 0) > 80 ||
      (telemetry.temperatureCelsius ?? 0) > 75 ||
      (telemetry.wheelProfileDeviationMm ?? 0) > 5.0;

    if (hasCriticalDefect || isCriticalTelemetry) {
      return 'CRITICAL_TRIAGE';
    }

    const hasAdvisoryDefect = defects.some(d => d.severity === 'ADVISORY');
    const isAdvisoryTelemetry =
      (telemetry.wheelImpactKn ?? 0) > 100 ||
      (telemetry.acousticBearingPeakDb ?? 0) > 70 ||
      (telemetry.temperatureCelsius ?? 0) > 60 ||
      (telemetry.wheelProfileDeviationMm ?? 0) > 3.5;

    if (hasAdvisoryDefect || isAdvisoryTelemetry) {
      return 'ADVISORY';
    }

    return 'NORMAL';
  }

  /**
   * Execute AI Triage for a wagon:
   * 1. Fetches or generates OMRS scan telemetry
   * 2. Evaluates defect prediction engine
   * 3. Triggers auto-reservations against Stores Depot Inventory
   * 4. Updates scan record state to is_triaged = 1, auto_reservation_triggered = 1
   * 5. Returns scan, created reservations, and summary.
   */
  public runAITriage(
    wagonNumber: string,
    inventoryRepo?: InventoryRepository
  ): AITriageResult {
    const cleanNumber = wagonNumber.trim().toUpperCase();
    let scan = this.getScanByWagon(cleanNumber);

    // If no existing scan found, create a simulated baseline scan
    if (!scan) {
      scan = this.recordScan({
        wagonNumber: cleanNumber,
        trainSpeedKmph: 68.5,
        wheelImpactKn: 138.2, // Will trigger WILD critical triage
        acousticBearingPeakDb: 84.5, // Will trigger ABD critical triage
        temperatureCelsius: 64.0, // Advisory
        wheelProfileDeviationMm: 4.2
      });
    }

    // Evaluate defects if not already populated
    let defects = scan.predictedDefects;
    if (defects.length === 0) {
      defects = this.evaluateTelemetryDefects({
        wheelImpactKn: scan.wheelImpactKn,
        acousticBearingPeakDb: scan.acousticBearingPeakDb,
        temperatureCelsius: scan.temperatureCelsius,
        wheelProfileDeviationMm: scan.wheelProfileDeviationMm
      });
    }

    const severity = this.computeSeverity(defects, {
      wheelImpactKn: scan.wheelImpactKn,
      acousticBearingPeakDb: scan.acousticBearingPeakDb,
      temperatureCelsius: scan.temperatureCelsius,
      wheelProfileDeviationMm: scan.wheelProfileDeviationMm
    });

    const repo = inventoryRepo || new InventoryRepository(this.db);
    const reservations: InventoryReservation[] = [];

    // Trigger auto-reservations for all predicted defects
    for (const defect of defects) {
      if (defect.recommendedPartCode) {
        try {
          const res = repo.reservePart({
            wagonNumber: cleanNumber,
            partCode: defect.recommendedPartCode,
            quantity: defect.quantity || 1,
            source: 'OMRS_AI_TRIAGE',
            predictedDefect: defect.defectType,
            confidenceScore: defect.confidence
          });
          reservations.push(res);
        } catch (err: any) {
          // If part not found or duplicate in stores, log warning and continue
          console.warn(`[OMRS AI Triage] Could not reserve part ${defect.recommendedPartCode}:`, err?.message);
        }
      }
    }

    // Update scan status
    this.db.prepare(`
      UPDATE omrs_scans
      SET is_triaged = 1,
          auto_reservation_triggered = 1,
          triage_severity = ?,
          predicted_defects_json = ?
      WHERE id = ?
    `).run(
      severity,
      JSON.stringify(defects),
      scan.id
    );

    // Audit log entry
    try {
      this.db.prepare(`
        INSERT INTO inspection_audit_log (
          id, inspection_id, event_type, user_id, user_role, ip_address, payload_json, created_at
        ) VALUES (?, NULL, 'OMRS_TRIAGE_RUN', 'system_omrs', 'SYSTEM', '127.0.0.1', ?, ?)
      `).run(
        `audit_${crypto.randomUUID()}`,
        JSON.stringify({
          scanId: scan.id,
          wagonNumber: cleanNumber,
          triageSeverity: severity,
          defectsCount: defects.length,
          reservationsCount: reservations.length
        }),
        new Date().toISOString()
      );
    } catch {
      // ignore
    }

    const updatedScan = this.getScanByWagon(cleanNumber)!;
    const criticalCount = defects.filter(d => d.severity === 'CRITICAL').length;
    const advisoryCount = defects.filter(d => d.severity === 'ADVISORY').length;

    const triageSummary = `OMRS AI Triage completed for ${cleanNumber}. Status: ${severity}. Detected ${criticalCount} Critical & ${advisoryCount} Advisory anomalies. Created ${reservations.length} automated inventory reservations.`;

    return {
      scan: updatedScan,
      reservations,
      triageSummary
    };
  }
}
