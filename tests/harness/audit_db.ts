/**
 * Immutable Append-Only Audit Logging & Storage Engine
 * Indian Railways WRS Raipur (RDSO G-95 & Phase 2 Wagon QC)
 *
 * Implements SQLite database with strict BEFORE UPDATE and BEFORE DELETE triggers,
 * sequential indexing, multi-criteria filtering, 7-stage wagon lifecycle, and audit reporting.
 */

import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import type {
  InspectionRecord,
  InspectionFilter,
  InspectionStats,
  BandColor,
  BogieType,
  SpringCondition,
  DamageType,
  WagonRecord,
  LifecycleStage,
  LifecycleTransition,
  WagonRegisterRequest,
  ChecklistItem,
  ChecklistConfigEntry,
  GateSignoffRequest,
  ReleaseCertificate,
  UserRole,
  StoresPart,
  InventoryReservation,
  OMRSScanRecord,
  OMRSPredictedDefect,
  OMRSTriageSeverity,
  InventoryStats,
  AITriageResult,
  ReservationSource,
  ReservationStatus,
  CASNUBCategory,
  SerializedComponent,
  ComponentHistoryEvent,
  SerializedComponentType,
  ComponentStatus,
  ComponentHealthStatus,
  ComponentEventType
} from '../../shared/types.ts';


export class AuditDatabase {
  private db: DatabaseSync;

  constructor(dbPath: string = ':memory:') {
    this.db = new DatabaseSync(dbPath);
    this.initializeSchema();
  }

  private initializeSchema(): void {
    // 1. Create inspections table (Phase 1)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS inspections (
        id TEXT PRIMARY KEY,
        sequence_number INTEGER NOT NULL UNIQUE,
        timestamp TEXT NOT NULL,
        inspector_id TEXT NOT NULL,
        inspector_name TEXT,
        wagon_number TEXT NOT NULL,
        bogie_type TEXT NOT NULL,
        spring_position TEXT NOT NULL,
        condition TEXT NOT NULL,
        measured_free_height REAL NOT NULL,
        classified_band TEXT,
        band_roman TEXT,
        status TEXT NOT NULL,
        damage_type TEXT NOT NULL DEFAULT 'NONE',
        damage_notes TEXT,
        is_overridden INTEGER NOT NULL DEFAULT 0,
        original_band TEXT,
        override_band TEXT,
        override_reason TEXT,
        supervisor_id TEXT,
        supervisor_name TEXT,
        table_reference TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'SYNCED',
        local_created_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_inspections_wagon ON inspections(wagon_number);
      CREATE INDEX IF NOT EXISTS idx_inspections_timestamp ON inspections(timestamp);
      CREATE INDEX IF NOT EXISTS idx_inspections_inspector ON inspections(inspector_id);
      CREATE INDEX IF NOT EXISTS idx_inspections_band ON inspections(classified_band);
      CREATE INDEX IF NOT EXISTS idx_inspections_status ON inspections(status);
    `);

    // 2. Strict append-only triggers: prevent UPDATE and DELETE on inspections
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS prevent_inspection_update
      BEFORE UPDATE ON inspections
      BEGIN
        SELECT RAISE(ABORT, 'Audit log is strictly append-only. UPDATE operations are forbidden.');
      END;

      CREATE TRIGGER IF NOT EXISTS prevent_inspection_delete
      BEFORE DELETE ON inspections
      BEGIN
        SELECT RAISE(ABORT, 'Audit log is strictly append-only. DELETE operations are forbidden.');
      END;
    `);

    // 3. Phase 2 Tables: Wagons & 7-Stage Lifecycle
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS wagons (
        id TEXT PRIMARY KEY,
        wagon_number TEXT NOT NULL UNIQUE,
        wagon_type TEXT NOT NULL,
        owning_railway TEXT NOT NULL,
        current_stage TEXT NOT NULL DEFAULT 'ENTRY_REGISTRATION',
        entry_date TEXT NOT NULL,
        release_date TEXT,
        condition_notes TEXT,
        is_released INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_wagons_stage ON wagons(current_stage);
      CREATE INDEX IF NOT EXISTS idx_wagons_type ON wagons(wagon_type);
      CREATE INDEX IF NOT EXISTS idx_wagons_railway ON wagons(owning_railway);

      CREATE TABLE IF NOT EXISTS lifecycle_transitions (
        id TEXT PRIMARY KEY,
        sequence_number INTEGER NOT NULL UNIQUE,
        wagon_number TEXT NOT NULL,
        from_stage TEXT NOT NULL,
        to_stage TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        user_id TEXT NOT NULL,
        user_name TEXT,
        user_role TEXT NOT NULL,
        notes TEXT,
        is_override INTEGER NOT NULL DEFAULT 0,
        override_justification TEXT,
        otp_token TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_transitions_wagon ON lifecycle_transitions(wagon_number);
      CREATE INDEX IF NOT EXISTS idx_transitions_timestamp ON lifecycle_transitions(timestamp);

      CREATE TRIGGER IF NOT EXISTS prevent_transition_update
      BEFORE UPDATE ON lifecycle_transitions
      BEGIN
        SELECT RAISE(ABORT, 'Lifecycle transition audit log is strictly append-only. UPDATE operations are forbidden.');
      END;

      CREATE TRIGGER IF NOT EXISTS prevent_transition_delete
      BEFORE DELETE ON lifecycle_transitions
      BEGIN
        SELECT RAISE(ABORT, 'Lifecycle transition audit log is strictly append-only. DELETE operations are forbidden.');
      END;
    `);

    // 4. Phase 2 Tables: Checklist Items & Configs
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS checklist_items (
        id TEXT PRIMARY KEY,
        wagon_number TEXT NOT NULL,
        category TEXT NOT NULL,
        part_name TEXT NOT NULL,
        status TEXT NOT NULL,
        criticality TEXT NOT NULL,
        condition_notes TEXT,
        repair_action TEXT,
        repair_notes TEXT,
        photo_id TEXT,
        inspected_by TEXT,
        inspected_by_name TEXT,
        inspected_at TEXT,
        updated_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_checklist_wagon ON checklist_items(wagon_number);
      CREATE INDEX IF NOT EXISTS idx_checklist_category ON checklist_items(category);

      CREATE TABLE IF NOT EXISTS checklist_configs (
        id TEXT PRIMARY KEY,
        wagon_type TEXT NOT NULL,
        category TEXT NOT NULL,
        part_name TEXT NOT NULL,
        criticality TEXT NOT NULL,
        UNIQUE(wagon_type, category, part_name)
      );
    `);

    // 5. Phase 2 Tables: Gate Signoffs & Release Certificates
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS gate_signoffs (
        id TEXT PRIMARY KEY,
        wagon_number TEXT NOT NULL UNIQUE,
        supervisor_id TEXT NOT NULL,
        supervisor_name TEXT NOT NULL,
        digital_signature TEXT NOT NULL,
        signoff_date TEXT NOT NULL,
        notes TEXT
      );

      CREATE TRIGGER IF NOT EXISTS prevent_signoff_update
      BEFORE UPDATE ON gate_signoffs
      BEGIN
        SELECT RAISE(ABORT, 'Gate signoff record is immutable. UPDATE operations are forbidden.');
      END;

      CREATE TRIGGER IF NOT EXISTS prevent_signoff_delete
      BEFORE DELETE ON gate_signoffs
      BEGIN
        SELECT RAISE(ABORT, 'Gate signoff record is immutable. DELETE operations are forbidden.');
      END;

      CREATE TABLE IF NOT EXISTS release_certificates (
        certificate_number TEXT PRIMARY KEY,
        wagon_number TEXT NOT NULL UNIQUE,
        wagon_type TEXT NOT NULL,
        owning_railway TEXT NOT NULL,
        entry_date TEXT NOT NULL,
        release_date TEXT NOT NULL,
        supervisor_id TEXT NOT NULL,
        supervisor_name TEXT NOT NULL,
        digital_signature TEXT NOT NULL,
        checklist_summary TEXT NOT NULL,
        spring_summary TEXT NOT NULL,
        qr_code TEXT NOT NULL,
        pdf_base64 TEXT,
        html TEXT,
        generated_at TEXT NOT NULL
      );

      CREATE TRIGGER IF NOT EXISTS prevent_cert_update
      BEFORE UPDATE ON release_certificates
      BEGIN
        SELECT RAISE(ABORT, 'Release certificate is immutable. UPDATE operations are forbidden.');
      END;

      CREATE TRIGGER IF NOT EXISTS prevent_cert_delete
      BEFORE DELETE ON release_certificates
      BEGIN
        SELECT RAISE(ABORT, 'Release certificate is immutable. DELETE operations are forbidden.');
      END;
    `);

    // 6. Sequence tracker table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sequence_tracker (
        name TEXT PRIMARY KEY,
        last_val INTEGER NOT NULL
      );
      INSERT OR IGNORE INTO sequence_tracker (name, last_val) VALUES ('inspection_seq', 0);
      INSERT OR IGNORE INTO sequence_tracker (name, last_val) VALUES ('transition_seq', 0);
    `);

    // 7. Phase 3 Tables: Stores Inventory, Reservations & OMRS
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS stores_inventory (
        id TEXT PRIMARY KEY,
        part_code TEXT NOT NULL UNIQUE,
        part_name TEXT NOT NULL,
        category TEXT NOT NULL,
        unit_of_measure TEXT NOT NULL DEFAULT 'NOS',
        stock_quantity INTEGER NOT NULL DEFAULT 0,
        reserved_quantity INTEGER NOT NULL DEFAULT 0,
        reorder_threshold INTEGER NOT NULL DEFAULT 10,
        unit_cost_inr REAL NOT NULL DEFAULT 0.0,
        bin_location TEXT NOT NULL,
        supplier_name TEXT DEFAULT 'RWF Yelahanka / Stores Depot',
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_inventory_part_code ON stores_inventory(part_code);
      CREATE INDEX IF NOT EXISTS idx_inventory_category ON stores_inventory(category);

      CREATE TABLE IF NOT EXISTS inventory_reservations (
        id TEXT PRIMARY KEY,
        wagon_number TEXT NOT NULL,
        part_code TEXT NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 1,
        source TEXT NOT NULL,
        predicted_defect TEXT,
        confidence_score REAL,
        status TEXT NOT NULL DEFAULT 'RESERVED',
        allocated_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_reservations_wagon ON inventory_reservations(wagon_number);
      CREATE INDEX IF NOT EXISTS idx_reservations_status ON inventory_reservations(status);

      CREATE TABLE IF NOT EXISTS omrs_scans (
        id TEXT PRIMARY KEY,
        wagon_number TEXT NOT NULL,
        scan_timestamp TEXT NOT NULL,
        location TEXT NOT NULL DEFAULT 'Trackside OMRS Sensor Array - Raipur Outer Yard (KM 828/14)',
        train_speed_kmph REAL NOT NULL DEFAULT 65.0,
        wheel_impact_kn REAL,
        acoustic_bearing_peak_db REAL,
        temperature_celsius REAL,
        wheel_profile_deviation_mm REAL,
        predicted_defects_json TEXT NOT NULL,
        triage_severity TEXT NOT NULL,
        is_triaged INTEGER NOT NULL DEFAULT 0,
        auto_reservation_triggered INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_omrs_wagon ON omrs_scans(wagon_number);
      CREATE INDEX IF NOT EXISTS idx_omrs_timestamp ON omrs_scans(scan_timestamp DESC);

      CREATE TABLE IF NOT EXISTS components (
        id TEXT PRIMARY KEY,
        serial_number TEXT NOT NULL UNIQUE,
        component_type TEXT NOT NULL,
        category TEXT NOT NULL,
        part_name TEXT NOT NULL,
        qr_code TEXT NOT NULL,
        rfid_tag TEXT,
        status TEXT NOT NULL DEFAULT 'AVAILABLE_IN_STORES',
        current_wagon_number TEXT,
        current_bogie_position TEXT NOT NULL DEFAULT 'NONE',
        manufacturing_date TEXT NOT NULL,
        manufacturer TEXT NOT NULL,
        total_km_travelled REAL NOT NULL DEFAULT 0,
        overhaul_count INTEGER NOT NULL DEFAULT 0,
        last_poh_date TEXT,
        next_poh_due TEXT,
        health_score INTEGER NOT NULL DEFAULT 100,
        health_status TEXT NOT NULL DEFAULT 'EXCELLENT',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_components_serial ON components(serial_number);
      CREATE INDEX IF NOT EXISTS idx_components_type ON components(component_type);
      CREATE INDEX IF NOT EXISTS idx_components_status ON components(status);
      CREATE INDEX IF NOT EXISTS idx_components_wagon ON components(current_wagon_number);

      CREATE TABLE IF NOT EXISTS component_history (
        id TEXT PRIMARY KEY,
        component_id TEXT NOT NULL,
        serial_number TEXT NOT NULL,
        event_type TEXT NOT NULL,
        wagon_number TEXT,
        stage TEXT,
        action_details TEXT NOT NULL,
        performed_by TEXT NOT NULL,
        performer_name TEXT NOT NULL,
        notes TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_comp_history_comp ON component_history(component_id);
      CREATE INDEX IF NOT EXISTS idx_comp_history_serial ON component_history(serial_number);
      CREATE INDEX IF NOT EXISTS idx_comp_history_wagon ON component_history(wagon_number);

      CREATE TRIGGER IF NOT EXISTS prevent_comp_history_update
      BEFORE UPDATE ON component_history
      BEGIN
        SELECT RAISE(ABORT, 'Component history is strictly append-only. UPDATE operations are forbidden.');
      END;

      CREATE TRIGGER IF NOT EXISTS prevent_comp_history_delete
      BEFORE DELETE ON component_history
      BEGIN
        SELECT RAISE(ABORT, 'Component history is strictly append-only. DELETE operations are forbidden.');
      END;

      CREATE TABLE IF NOT EXISTS acoustic_diagnostics (
        id TEXT PRIMARY KEY,
        wagon_number TEXT NOT NULL,
        dominant_frequency_hz REAL NOT NULL,
        peak_db REAL NOT NULL,
        is_anomaly_detected INTEGER NOT NULL DEFAULT 0,
        anomaly_type TEXT NOT NULL DEFAULT 'NONE',
        confidence REAL NOT NULL,
        recommended_action TEXT NOT NULL,
        inspector_id TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_acoustic_wagon ON acoustic_diagnostics(wagon_number);

      CREATE TABLE IF NOT EXISTS cv_measurements (
        id TEXT PRIMARY KEY,
        wagon_number TEXT NOT NULL,
        component_type TEXT NOT NULL,
        position TEXT NOT NULL,
        measured_height REAL NOT NULL,
        status TEXT NOT NULL,
        band_color TEXT,
        photo_id TEXT,
        confidence REAL NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_cv_wagon ON cv_measurements(wagon_number);

      CREATE TABLE IF NOT EXISTS voice_logs (
        id TEXT PRIMARY KEY,
        wagon_number TEXT NOT NULL,
        transcript TEXT NOT NULL,
        locale TEXT NOT NULL DEFAULT 'en',
        intent TEXT NOT NULL,
        target_category TEXT,
        target_part_name TEXT,
        status_applied TEXT,
        confidence REAL NOT NULL,
        inspector_id TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_voice_wagon ON voice_logs(wagon_number);
    `);

    // Seed default inventory stock
    this.seedDefaultInventory();
  }


  private getNextSequence(trackerName: string = 'inspection_seq'): number {
    const row = this.db.prepare('SELECT last_val FROM sequence_tracker WHERE name = ?').get(trackerName) as { last_val: number } | undefined;
    const nextVal = (row?.last_val ?? 0) + 1;
    this.db.prepare('UPDATE sequence_tracker SET last_val = ? WHERE name = ?').run(nextVal, trackerName);
    return nextVal;
  }

  // -----------------------------------------------------------------------
  // Phase 1: Inspection Audit Methods
  // -----------------------------------------------------------------------

  public logInspection(data: Omit<InspectionRecord, 'id' | 'sequenceNumber'> & { id?: string }): InspectionRecord {
    const id = data.id || crypto.randomUUID();
    const seq = this.getNextSequence('inspection_seq');
    const timestamp = data.timestamp || new Date().toISOString();

    const insertStmt = this.db.prepare(`
      INSERT INTO inspections (
        id, sequence_number, timestamp, inspector_id, inspector_name,
        wagon_number, bogie_type, spring_position, condition,
        measured_free_height, classified_band, band_roman, status,
        damage_type, damage_notes, is_overridden, original_band,
        override_band, override_reason, supervisor_id, supervisor_name,
        table_reference, sync_status, local_created_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?
      )
    `);

    insertStmt.run(
      id,
      seq,
      timestamp,
      data.inspectorId,
      data.inspectorName || null,
      data.wagonNumber,
      data.bogieType,
      data.springPosition,
      data.condition,
      data.measuredFreeHeight,
      data.classifiedBand || null,
      data.bandRoman || null,
      data.status,
      data.damageType || 'NONE',
      data.damageNotes || null,
      data.isOverridden ? 1 : 0,
      data.originalBand || null,
      data.overrideBand || null,
      data.overrideReason || null,
      data.supervisorId || null,
      data.supervisorName || null,
      data.tableReference,
      data.syncStatus || 'SYNCED',
      data.localCreatedAt || timestamp
    );

    return {
      ...data,
      id,
      sequenceNumber: seq,
      timestamp,
      inspectorName: data.inspectorName,
      damageNotes: data.damageNotes,
      originalBand: data.originalBand,
      overrideBand: data.overrideBand,
      overrideReason: data.overrideReason,
      supervisorId: data.supervisorId,
      supervisorName: data.supervisorName,
      syncStatus: data.syncStatus || 'SYNCED',
      localCreatedAt: data.localCreatedAt || timestamp
    };
  }

  public queryInspections(filter: InspectionFilter = {}): { records: InspectionRecord[]; total: number; page: number; limit: number } {
    const conditions: string[] = ['1=1'];
    const params: unknown[] = [];

    if (filter.wagonNumber) {
      conditions.push('wagon_number LIKE ?');
      params.push(`%${filter.wagonNumber}%`);
    }

    if (filter.startDate) {
      conditions.push('timestamp >= ?');
      params.push(filter.startDate);
    }

    if (filter.endDate) {
      conditions.push('timestamp <= ?');
      params.push(filter.endDate);
    }

    if (filter.inspectorId) {
      conditions.push('inspector_id = ?');
      params.push(filter.inspectorId);
    }

    if (filter.band) {
      conditions.push('classified_band = ?');
      params.push(filter.band);
    }

    if (filter.status) {
      conditions.push('status = ?');
      params.push(filter.status);
    }

    if (filter.bogieType) {
      conditions.push('bogie_type = ?');
      params.push(filter.bogieType);
    }

    if (filter.condition) {
      conditions.push('condition = ?');
      params.push(filter.condition);
    }

    const whereClause = conditions.join(' AND ');

    const countRow = this.db.prepare(`SELECT COUNT(*) as count FROM inspections WHERE ${whereClause}`).get(...params) as { count: number };
    const total = countRow?.count ?? 0;

    const page = Math.max(1, filter.page || 1);
    const limit = Math.max(1, Math.min(1000, filter.limit || 50));
    const offset = (page - 1) * limit;

    const queryStmt = this.db.prepare(`
      SELECT * FROM inspections
      WHERE ${whereClause}
      ORDER BY sequence_number DESC
      LIMIT ? OFFSET ?
    `);

    const rows = queryStmt.all(...params, limit, offset) as Record<string, unknown>[];

    const records: InspectionRecord[] = rows.map(r => ({
      id: r.id as string,
      sequenceNumber: r.sequence_number as number,
      timestamp: r.timestamp as string,
      inspectorId: r.inspector_id as string,
      inspectorName: r.inspector_name as string | undefined,
      wagonNumber: r.wagon_number as string,
      bogieType: r.bogie_type as BogieType,
      springPosition: r.spring_position as InspectionRecord['springPosition'],
      condition: r.condition as SpringCondition,
      measuredFreeHeight: r.measured_free_height as number,
      classifiedBand: r.classified_band as BandColor | null,
      bandRoman: r.band_roman as InspectionRecord['bandRoman'],
      status: r.status as InspectionRecord['status'],
      damageType: r.damage_type as DamageType,
      damageNotes: r.damage_notes as string | undefined,
      isOverridden: Boolean(r.is_overridden),
      originalBand: r.original_band as BandColor | null,
      overrideBand: r.override_band as BandColor | null,
      overrideReason: r.override_reason as string | undefined,
      supervisorId: r.supervisor_id as string | undefined,
      supervisorName: r.supervisor_name as string | undefined,
      tableReference: r.table_reference as string,
      syncStatus: r.sync_status as 'LOCAL' | 'SYNCED',
      localCreatedAt: r.local_created_at as string | undefined
    }));

    return { records, total, page, limit };
  }

  public getInspectionById(id: string): InspectionRecord | null {
    const row = this.db.prepare('SELECT * FROM inspections WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;

    return {
      id: row.id as string,
      sequenceNumber: row.sequence_number as number,
      timestamp: row.timestamp as string,
      inspectorId: row.inspector_id as string,
      inspectorName: row.inspector_name as string | undefined,
      wagonNumber: row.wagon_number as string,
      bogieType: row.bogie_type as BogieType,
      springPosition: row.spring_position as InspectionRecord['springPosition'],
      condition: (row.spring_condition || row.condition) as SpringCondition,
      measuredFreeHeight: row.measured_free_height as number,
      classifiedBand: row.classified_band as BandColor | null,
      bandRoman: row.band_roman as InspectionRecord['bandRoman'],
      status: row.status as InspectionRecord['status'],
      damageType: row.damage_type as DamageType,
      damageNotes: row.damage_notes as string | undefined,
      isOverridden: Boolean(row.is_overridden),
      originalBand: row.original_band as BandColor | null,
      overrideBand: row.override_band as BandColor | null,
      overrideReason: row.override_reason as string | undefined,
      supervisorId: row.supervisor_id as string | undefined,
      supervisorName: row.supervisor_name as string | undefined,
      tableReference: row.table_reference as string,
      syncStatus: row.sync_status as 'LOCAL' | 'SYNCED',
      localCreatedAt: row.local_created_at as string | undefined
    };
  }

  public getStats(): InspectionStats {
    const totalRow = this.db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'PASS' THEN 1 ELSE 0 END) as passed,
        SUM(CASE WHEN status = 'CONDEMNED' THEN 1 ELSE 0 END) as condemned
      FROM inspections
    `).get() as { total: number; passed: number; condemned: number };

    const total = totalRow?.total ?? 0;
    const passed = totalRow?.passed ?? 0;
    const condemned = totalRow?.condemned ?? 0;
    const rate = total > 0 ? (condemned / total) * 100 : 0;

    const bandDistribution: Record<BandColor, number> = {
      BLUE: 0, GREEN: 0, YELLOW: 0, ORANGE: 0, WHITE: 0, RED: 0
    };
    const bandRows = this.db.prepare(`SELECT classified_band, COUNT(*) as count FROM inspections WHERE classified_band IS NOT NULL GROUP BY classified_band`).all() as { classified_band: BandColor; count: number }[];
    for (const r of bandRows) {
      if (r.classified_band && bandDistribution[r.classified_band] !== undefined) {
        bandDistribution[r.classified_band] = r.count;
      }
    }

    const bogieTypeDistribution: Record<BogieType, number> = {
      CASNUB_22_NLB: 0, CASNUB_22_HS: 0, CASNUB_22_RFT: 0
    };
    const bogieRows = this.db.prepare(`SELECT bogie_type, COUNT(*) as count FROM inspections GROUP BY bogie_type`).all() as { bogie_type: BogieType; count: number }[];
    for (const r of bogieRows) {
      if (r.bogie_type && bogieTypeDistribution[r.bogie_type] !== undefined) {
        bogieTypeDistribution[r.bogie_type] = r.count;
      }
    }

    const conditionDistribution: Record<SpringCondition, number> = { USED: 0, NEW: 0 };
    const condRows = this.db.prepare(`SELECT condition, COUNT(*) as count FROM inspections GROUP BY condition`).all() as { condition: SpringCondition; count: number }[];
    for (const r of condRows) {
      if (r.condition && conditionDistribution[r.condition] !== undefined) {
        conditionDistribution[r.condition] = r.count;
      }
    }

    const damageTypeDistribution: Record<DamageType, number> = {
      NONE: 0, CRACK: 0, CORROSION: 0, DEFORMATION: 0, OTHER: 0
    };
    const damageRows = this.db.prepare(`SELECT damage_type, COUNT(*) as count FROM inspections GROUP BY damage_type`).all() as { damage_type: DamageType; count: number }[];
    for (const r of damageRows) {
      if (r.damage_type && damageTypeDistribution[r.damage_type] !== undefined) {
        damageTypeDistribution[r.damage_type] = r.count;
      }
    }

    return {
      totalInspections: total,
      totalPassed: passed,
      totalCondemned: condemned,
      condemnationRatePercentage: Number(rate.toFixed(2)),
      bandDistribution,
      bogieTypeDistribution,
      conditionDistribution,
      damageTypeDistribution
    };
  }

  public exportAuditData(format: 'csv' | 'json' = 'json', filter: InspectionFilter = {}): string {
    const { records } = this.queryInspections({ ...filter, limit: 10000 });

    if (format === 'json') {
      return JSON.stringify({
        exportTimestamp: new Date().toISOString(),
        totalRecords: records.length,
        inspections: records
      }, null, 2);
    }

    const headers = [
      'SequenceNumber', 'Timestamp', 'WagonNumber', 'BogieType', 'SpringPosition',
      'Condition', 'MeasuredFreeHeight', 'ClassifiedBand', 'BandRoman', 'Status',
      'DamageType', 'DamageNotes', 'IsOverridden', 'OriginalBand', 'OverrideBand',
      'OverrideReason', 'InspectorId', 'SupervisorId', 'TableReference'
    ];

    const csvLines = [headers.join(',')];
    for (const r of records) {
      const line = [
        r.sequenceNumber,
        `"${r.timestamp}"`,
        `"${r.wagonNumber}"`,
        `"${r.bogieType}"`,
        `"${r.springPosition}"`,
        `"${r.condition}"`,
        r.measuredFreeHeight.toFixed(2),
        `"${r.classifiedBand || ''}"`,
        `"${r.bandRoman || ''}"`,
        `"${r.status}"`,
        `"${r.damageType}"`,
        `"${(r.damageNotes || '').replace(/"/g, '""')}"`,
        r.isOverridden ? 1 : 0,
        `"${r.originalBand || ''}"`,
        `"${r.overrideBand || ''}"`,
        `"${(r.overrideReason || '').replace(/"/g, '""')}"`,
        `"${r.inspectorId}"`,
        `"${r.supervisorId || ''}"`,
        `"${r.tableReference}"`
      ];
      csvLines.push(line.join(','));
    }

    return csvLines.join('\n');
  }

  public attemptDirectUpdate(id: string, newHeight: number): void {
    this.db.prepare('UPDATE inspections SET measured_free_height = ? WHERE id = ?').run(newHeight, id);
  }

  public attemptDirectDelete(id: string): void {
    this.db.prepare('DELETE FROM inspections WHERE id = ?').run(id);
  }

  // -----------------------------------------------------------------------
  // Phase 2: Wagon Lifecycle Operations
  // -----------------------------------------------------------------------

  public registerWagon(req: WagonRegisterRequest): WagonRecord {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const entryDate = req.entryDate || now;

    this.db.prepare(`
      INSERT INTO wagons (
        id, wagon_number, wagon_type, owning_railway, current_stage,
        entry_date, release_date, condition_notes, is_released, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'ENTRY_REGISTRATION', ?, NULL, ?, 0, ?, ?)
    `).run(
      id,
      req.wagonNumber,
      req.wagonType,
      req.owningRailway,
      entryDate,
      req.conditionNotes || req.entryNotes || null,
      now,
      now
    );

    return {
      id,
      wagonNumber: req.wagonNumber,
      wagonType: req.wagonType,
      owningRailway: req.owningRailway,
      currentStage: 'ENTRY_REGISTRATION',
      entryDate,
      releaseDate: null,
      conditionNotes: req.conditionNotes || req.entryNotes || null,
      isReleased: false,
      createdAt: now,
      updatedAt: now
    };
  }

  public getWagon(wagonNumber: string): WagonRecord | null {
    const row = this.db.prepare('SELECT * FROM wagons WHERE wagon_number = ?').get(wagonNumber) as Record<string, unknown> | undefined;
    if (!row) return null;

    const conditionNotes = (row.condition_notes as string) || null;
    const isBlocked = conditionNotes ? conditionNotes.includes('Blocker') : false;
    const isReleased = Boolean(row.is_released);
    const status = (row.status as string) || (isBlocked ? 'BLOCKED' : isReleased ? 'RELEASED' : 'IN_PROGRESS');

    return {
      id: row.id as string,
      wagonNumber: row.wagon_number as string,
      wagonType: row.wagon_type as string,
      owningRailway: row.owning_railway as string,
      currentStage: row.current_stage as LifecycleStage,
      status,
      entryDate: row.entry_date as string,
      releaseDate: (row.release_date as string) || null,
      conditionNotes,
      isReleased,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string
    };
  }

  public getWagonByNumber(wagonNumber: string): WagonRecord | null {
    return this.getWagon(wagonNumber);
  }


  public getAllWagons(filter?: { stage?: string; wagonType?: string; owningRailway?: string; search?: string }): WagonRecord[] {
    const conditions: string[] = ['1=1'];
    const params: unknown[] = [];

    if (filter?.stage && filter.stage !== 'ALL') {
      conditions.push('current_stage = ?');
      params.push(filter.stage);
    }
    if (filter?.wagonType) {
      conditions.push('wagon_type = ?');
      params.push(filter.wagonType);
    }
    if (filter?.owningRailway) {
      conditions.push('owning_railway = ?');
      params.push(filter.owningRailway);
    }
    if (filter?.search && filter.search.trim() !== '') {
      const searchTerm = `%${filter.search.trim()}%`;
      conditions.push('(wagon_number LIKE ? OR owning_railway LIKE ? OR wagon_type LIKE ?)');
      params.push(searchTerm, searchTerm, searchTerm);
    }
    const query = `SELECT * FROM wagons WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`;
    const rows = this.db.prepare(query).all(...params) as Record<string, unknown>[];

    return rows.map(r => {
      const conditionNotes = (r.condition_notes as string) || null;
      const isBlocked = conditionNotes ? conditionNotes.includes('Blocker') : false;
      const isReleased = Boolean(r.is_released);
      const status = (r.status as string) || (isBlocked ? 'BLOCKED' : isReleased ? 'RELEASED' : 'IN_PROGRESS');

      return {
        id: r.id as string,
        wagonNumber: r.wagon_number as string,
        wagonType: r.wagon_type as string,
        owningRailway: r.owning_railway as string,
        currentStage: r.current_stage as LifecycleStage,
        status,
        entryDate: r.entry_date as string,
        releaseDate: (r.release_date as string) || null,
        conditionNotes,
        isReleased,
        createdAt: r.created_at as string,
        updatedAt: r.updated_at as string
      };
    });
  }


  public updateWagonStage(wagonNumber: string, targetStage: LifecycleStage, releaseDate?: string): WagonRecord {
    const now = new Date().toISOString();
    const isReleased = targetStage === 'RELEASE' ? 1 : 0;
    const finalReleaseDate = targetStage === 'RELEASE' ? (releaseDate || now) : null;

    this.db.prepare(`
      UPDATE wagons
      SET current_stage = ?, release_date = ?, is_released = ?, updated_at = ?
      WHERE wagon_number = ?
    `).run(targetStage, finalReleaseDate, isReleased, now, wagonNumber);

    return this.getWagon(wagonNumber)!;
  }

  public logTransition(data: {
    wagonNumber: string;
    fromStage: LifecycleStage;
    toStage: LifecycleStage;
    userId: string;
    userName?: string;
    userRole: UserRole;
    notes?: string;
    isOverride?: boolean;
    overrideJustification?: string;
    otpToken?: string;
    timestamp?: string;
  }): LifecycleTransition {
    const id = crypto.randomUUID();
    const seq = this.getNextSequence('transition_seq');
    const timestamp = data.timestamp || new Date().toISOString();

    this.db.prepare(`
      INSERT INTO lifecycle_transitions (
        id, sequence_number, wagon_number, from_stage, to_stage,
        timestamp, user_id, user_name, user_role, notes,
        is_override, override_justification, otp_token
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      seq,
      data.wagonNumber,
      data.fromStage,
      data.toStage,
      timestamp,
      data.userId,
      data.userName || null,
      data.userRole,
      data.notes || null,
      data.isOverride ? 1 : 0,
      data.overrideJustification || null,
      data.otpToken || null
    );

    return {
      id,
      wagonNumber: data.wagonNumber,
      fromStage: data.fromStage,
      toStage: data.toStage,
      timestamp,
      userId: data.userId,
      userName: data.userName,
      userRole: data.userRole,
      notes: data.notes || null,
      isOverride: Boolean(data.isOverride),
      overrideJustification: data.overrideJustification || null,
      otpToken: data.otpToken || null
    };
  }

  public getTransitions(wagonNumber: string): LifecycleTransition[] {
    const rows = this.db.prepare(`
      SELECT * FROM lifecycle_transitions
      WHERE wagon_number = ?
      ORDER BY sequence_number ASC
    `).all(wagonNumber) as Record<string, unknown>[];

    return rows.map(r => ({
      id: r.id as string,
      wagonNumber: r.wagon_number as string,
      fromStage: r.from_stage as LifecycleStage,
      toStage: r.to_stage as LifecycleStage,
      timestamp: r.timestamp as string,
      userId: r.user_id as string,
      userName: (r.user_name as string) || undefined,
      userRole: r.user_role as UserRole,
      notes: (r.notes as string) || null,
      isOverride: Boolean(r.is_override),
      overrideJustification: (r.override_justification as string) || null,
      otpToken: (r.otp_token as string) || null
    }));
  }

  public attemptDirectTransitionUpdate(id: string): void {
    this.db.prepare('UPDATE lifecycle_transitions SET notes = ? WHERE id = ?').run('hacked', id);
  }

  public attemptDirectTransitionDelete(id: string): void {
    this.db.prepare('DELETE FROM lifecycle_transitions WHERE id = ?').run(id);
  }

  // -----------------------------------------------------------------------
  // Phase 2: Checklist Operations
  // -----------------------------------------------------------------------

  public saveChecklistItems(items: ChecklistItem[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO checklist_items (
        id, wagon_number, category, part_name, status, criticality,
        condition_notes, repair_action, repair_notes, photo_id,
        inspected_by, inspected_by_name, inspected_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const item of items) {
      stmt.run(
        item.id,
        item.wagonNumber,
        item.category,
        item.partName,
        item.status,
        item.criticality,
        item.conditionNotes || null,
        item.repairAction || null,
        item.repairNotes || null,
        item.photoId || null,
        item.inspectedBy || null,
        item.inspectedByName || null,
        item.inspectedAt || new Date().toISOString(),
        item.updatedAt || new Date().toISOString()
      );
    }
  }

  public getChecklistItems(wagonNumber: string): ChecklistItem[] {
    const rows = this.db.prepare(`SELECT * FROM checklist_items WHERE wagon_number = ?`).all(wagonNumber) as Record<string, unknown>[];

    return rows.map(r => ({
      id: r.id as string,
      wagonNumber: r.wagon_number as string,
      category: r.category as ChecklistItem['category'],
      partName: r.part_name as string,
      status: r.status as ChecklistItem['status'],
      criticality: r.criticality as ChecklistItem['criticality'],
      conditionNotes: (r.condition_notes as string) || null,
      repairAction: (r.repair_action as ChecklistItem['repairAction']) || null,
      repairNotes: (r.repair_notes as string) || null,
      photoId: (r.photo_id as string) || null,
      inspectedBy: (r.inspected_by as string) || undefined,
      inspectedByName: (r.inspected_by_name as string) || undefined,
      inspectedAt: (r.inspected_at as string) || undefined,
      updatedAt: (r.updated_at as string) || undefined
    }));
  }

  public getChecklistItemById(id: string): ChecklistItem | null {
    const r = this.db.prepare(`SELECT * FROM checklist_items WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    if (!r) return null;

    return {
      id: r.id as string,
      wagonNumber: r.wagon_number as string,
      category: r.category as ChecklistItem['category'],
      partName: r.part_name as string,
      status: r.status as ChecklistItem['status'],
      criticality: r.criticality as ChecklistItem['criticality'],
      conditionNotes: (r.condition_notes as string) || null,
      repairAction: (r.repair_action as ChecklistItem['repairAction']) || null,
      repairNotes: (r.repair_notes as string) || null,
      photoId: (r.photo_id as string) || null,
      inspectedBy: (r.inspected_by as string) || undefined,
      inspectedByName: (r.inspected_by_name as string) || undefined,
      inspectedAt: (r.inspected_at as string) || undefined,
      updatedAt: (r.updated_at as string) || undefined
    };
  }


  public updateChecklistItem(id: string, updates: Partial<ChecklistItem>): ChecklistItem | null {
    const existing = this.db.prepare('SELECT * FROM checklist_items WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!existing) return null;

    const now = new Date().toISOString();
    const updatedStatus = updates.status !== undefined ? updates.status : existing.status;
    const updatedCriticality = updates.criticality !== undefined ? updates.criticality : existing.criticality;
    const updatedConditionNotes = updates.conditionNotes !== undefined ? updates.conditionNotes : existing.condition_notes;
    const updatedRepairAction = updates.repairAction !== undefined ? updates.repairAction : existing.repair_action;
    const updatedRepairNotes = updates.repairNotes !== undefined ? updates.repairNotes : existing.repair_notes;
    const updatedPhotoId = updates.photoId !== undefined ? updates.photoId : existing.photo_id;
    const updatedInspectedBy = updates.inspectedBy !== undefined ? updates.inspectedBy : existing.inspected_by;
    const updatedInspectedByName = updates.inspectedByName !== undefined ? updates.inspectedByName : existing.inspected_by_name;

    this.db.prepare(`
      UPDATE checklist_items
      SET status = ?, criticality = ?, condition_notes = ?, repair_action = ?,
          repair_notes = ?, photo_id = ?, inspected_by = ?, inspected_by_name = ?, updated_at = ?
      WHERE id = ?
    `).run(
      updatedStatus,
      updatedCriticality,
      updatedConditionNotes,
      updatedRepairAction,
      updatedRepairNotes,
      updatedPhotoId,
      updatedInspectedBy,
      updatedInspectedByName,
      now,
      id
    );

    return {
      id: existing.id as string,
      wagonNumber: existing.wagon_number as string,
      category: existing.category as ChecklistItem['category'],
      partName: existing.part_name as string,
      status: updatedStatus as ChecklistItem['status'],
      criticality: updatedCriticality as ChecklistItem['criticality'],
      conditionNotes: (updatedConditionNotes as string) || null,
      repairAction: (updatedRepairAction as ChecklistItem['repairAction']) || null,
      repairNotes: (updatedRepairNotes as string) || null,
      photoId: (updatedPhotoId as string) || null,
      inspectedBy: (updatedInspectedBy as string) || undefined,
      inspectedByName: (updatedInspectedByName as string) || undefined,
      inspectedAt: existing.inspected_at as string,
      updatedAt: now
    };
  }

  public saveChecklistConfig(configs: ChecklistConfigEntry[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO checklist_configs (id, wagon_type, category, part_name, criticality)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(wagon_type, category, part_name) DO UPDATE SET criticality = excluded.criticality
    `);

    for (const c of configs) {
      stmt.run(crypto.randomUUID(), c.wagonType, c.category, c.partName, c.criticality);
    }
  }

  public getChecklistConfigs(wagonType?: string): ChecklistConfigEntry[] {
    let rows: Record<string, unknown>[];
    if (wagonType) {
      rows = this.db.prepare('SELECT * FROM checklist_configs WHERE wagon_type = ?').all(wagonType) as Record<string, unknown>[];
    } else {
      rows = this.db.prepare('SELECT * FROM checklist_configs').all() as Record<string, unknown>[];
    }

    return rows.map(r => ({
      wagonType: r.wagon_type as string,
      category: r.category as ChecklistConfigEntry['category'],
      partName: r.part_name as string,
      criticality: r.criticality as ChecklistConfigEntry['criticality']
    }));
  }

  // -----------------------------------------------------------------------
  // Phase 2: Gate Signoff & Certificate Operations
  // -----------------------------------------------------------------------

  public saveGateSignoff(signoff: {
    wagonNumber: string;
    supervisorId: string;
    supervisorName: string;
    digitalSignature: string;
    notes?: string;
  }): void {
    const id = crypto.randomUUID();
    const signoffDate = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO gate_signoffs (id, wagon_number, supervisor_id, supervisor_name, digital_signature, signoff_date, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      signoff.wagonNumber,
      signoff.supervisorId,
      signoff.supervisorName,
      signoff.digitalSignature,
      signoffDate,
      signoff.notes || null
    );
  }

  public getGateSignoff(wagonNumber: string): {
    id: string;
    wagonNumber: string;
    supervisorId: string;
    supervisorName: string;
    digitalSignature: string;
    signoffDate: string;
    notes?: string;
  } | null {
    const row = this.db.prepare('SELECT * FROM gate_signoffs WHERE wagon_number = ?').get(wagonNumber) as Record<string, unknown> | undefined;
    if (!row) return null;

    return {
      id: row.id as string,
      wagonNumber: row.wagon_number as string,
      supervisorId: row.supervisor_id as string,
      supervisorName: row.supervisor_name as string,
      digitalSignature: row.digital_signature as string,
      signoffDate: row.signoff_date as string,
      notes: (row.notes as string) || undefined
    };
  }

  public saveReleaseCertificate(cert: ReleaseCertificate): void {
    this.db.prepare(`
      INSERT INTO release_certificates (
        certificate_number, wagon_number, wagon_type, owning_railway,
        entry_date, release_date, supervisor_id, supervisor_name,
        digital_signature, checklist_summary, spring_summary,
        qr_code, pdf_base64, html, generated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      cert.certificateNumber,
      cert.wagonNumber,
      cert.wagonType,
      cert.owningRailway,
      cert.entryDate,
      cert.releaseDate,
      cert.supervisorId,
      cert.supervisorName,
      cert.digitalSignature,
      JSON.stringify(cert.checklistSummary),
      JSON.stringify(cert.springSummary),
      cert.qrVerificationCode,
      cert.pdfBase64 || null,
      cert.html || null,
      cert.generatedAt
    );
  }

  public getReleaseCertificate(wagonNumber: string): ReleaseCertificate | null {
    const row = this.db.prepare('SELECT * FROM release_certificates WHERE wagon_number = ?').get(wagonNumber) as Record<string, unknown> | undefined;
    if (!row) return null;

    return {
      certificateNumber: row.certificate_number as string,
      wagonNumber: row.wagon_number as string,
      wagonType: row.wagon_type as string,
      owningRailway: row.owning_railway as string,
      entryDate: row.entry_date as string,
      releaseDate: row.release_date as string,
      supervisorId: row.supervisor_id as string,
      supervisorName: row.supervisor_name as string,
      digitalSignature: row.digital_signature as string,
      checklistSummary: JSON.parse(row.checklist_summary as string),
      springSummary: JSON.parse(row.spring_summary as string),
      qrVerificationCode: row.qr_code as string,
      generatedAt: row.generated_at as string,
      pdfBase64: (row.pdf_base64 as string) || undefined,
      html: (row.html as string) || undefined
    };
  }

  // -----------------------------------------------------------------------
  // Phase 3: Stores Depot Inventory & OMRS Telemetry Methods (M1 / R5)
  // -----------------------------------------------------------------------

  public seedDefaultInventory(): void {
    const defaultParts: Array<{
      partCode: string;
      partName: string;
      category: CASNUBCategory;
      stockQuantity: number;
      reorderThreshold: number;
      unitCostInr: number;
      binLocation: string;
    }> = [
      { partCode: 'PART-SP-OUTER', partName: 'Outer Spring (CASNUB 22 NLB)', category: 'SPRINGS', stockQuantity: 150, reorderThreshold: 20, unitCostInr: 2450, binLocation: 'BAY-A-01' },
      { partCode: 'PART-SP-INNER', partName: 'Inner Spring (CASNUB 22 NLB)', category: 'SPRINGS', stockQuantity: 120, reorderThreshold: 20, unitCostInr: 1850, binLocation: 'BAY-A-02' },
      { partCode: 'PART-SP-SNUB', partName: 'Snubber Spring (CASNUB 22 NLB)', category: 'SPRINGS', stockQuantity: 80, reorderThreshold: 15, unitCostInr: 1450, binLocation: 'BAY-A-03' },
      { partCode: 'PART-BRG-01', partName: 'Cartridge Tapered Roller Bearing (CTRB)', category: 'BEARINGS', stockQuantity: 45, reorderThreshold: 10, unitCostInr: 18500, binLocation: 'BAY-B-01' },
      { partCode: 'PART-BRK-BLK', partName: 'Composite Brake Block', category: 'BRAKE_SYSTEM', stockQuantity: 200, reorderThreshold: 30, unitCostInr: 850, binLocation: 'BAY-C-01' },
      { partCode: 'PART-FW-01', partName: 'Friction Wedge Block', category: 'FRICTION_WEDGES', stockQuantity: 60, reorderThreshold: 12, unitCostInr: 3200, binLocation: 'BAY-D-01' },
      { partCode: 'PART-WS-01', partName: 'Wheelset 1000mm (BoxNHL/BCNHL)', category: 'WHEELS_AXLES', stockQuantity: 25, reorderThreshold: 5, unitCostInr: 85000, binLocation: 'BAY-W-01' },
      { partCode: 'PART-DG-01', partName: 'Draft Gear High Capacity MK-50', category: 'COUPLERS_DRAFT_GEAR', stockQuantity: 18, reorderThreshold: 4, unitCostInr: 65000, binLocation: 'BAY-DG-01' }
    ];

    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO stores_inventory (
        id, part_code, part_name, category, unit_of_measure,
        stock_quantity, reserved_quantity, reorder_threshold,
        unit_cost_inr, bin_location, supplier_name, updated_at
      ) VALUES (?, ?, ?, ?, 'NOS', ?, 0, ?, ?, ?, 'RWF Yelahanka / Stores Depot', ?)
    `);

    const now = new Date().toISOString();
    for (const p of defaultParts) {
      stmt.run(crypto.randomUUID(), p.partCode, p.partName, p.category, p.stockQuantity, p.reorderThreshold, p.unitCostInr, p.binLocation, now);
    }
  }

  private mapStoresPartRow(row: Record<string, unknown>): StoresPart {
    const stockQuantity = Number(row.stock_quantity ?? 0);
    const reservedQuantity = Number(row.reserved_quantity ?? 0);
    return {
      id: row.id as string,
      partCode: row.part_code as string,
      partName: row.part_name as string,
      category: row.category as CASNUBCategory,
      unitOfMeasure: (row.unit_of_measure as string) || 'NOS',
      stockQuantity,
      reservedQuantity,
      availableQuantity: Math.max(0, stockQuantity - reservedQuantity),
      reorderThreshold: Number(row.reorder_threshold ?? 10),
      unitCostInr: Number(row.unit_cost_inr ?? 0),
      binLocation: (row.bin_location as string) || 'UNASSIGNED',
      supplierName: (row.supplier_name as string) || 'Stores Depot',
      updatedAt: (row.updated_at as string) || new Date().toISOString()
    };
  }

  public getInventory(category?: string): StoresPart[] {
    let query = 'SELECT * FROM stores_inventory';
    const params: unknown[] = [];
    if (category && category !== 'ALL') {
      query += ' WHERE category = ?';
      params.push(category.toUpperCase());
    }
    query += ' ORDER BY category ASC, part_code ASC';
    const rows = this.db.prepare(query).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.mapStoresPartRow(r));
  }

  public getPartByCode(partCode: string): StoresPart | null {
    if (!partCode) return null;
    const row = this.db.prepare('SELECT * FROM stores_inventory WHERE part_code = ?').get(partCode.trim().toUpperCase()) as Record<string, unknown> | undefined;
    return row ? this.mapStoresPartRow(row) : null;
  }

  public addOrUpdatePart(part: Partial<StoresPart> & { partCode: string; partName: string; category: CASNUBCategory }): StoresPart {
    const existing = this.getPartByCode(part.partCode);
    const now = new Date().toISOString();
    const id = existing?.id || crypto.randomUUID();
    const stockQty = part.stockQuantity !== undefined ? part.stockQuantity : (existing?.stockQuantity ?? 0);
    const reservedQty = part.reservedQuantity !== undefined ? part.reservedQuantity : (existing?.reservedQuantity ?? 0);
    const threshold = part.reorderThreshold !== undefined ? part.reorderThreshold : (existing?.reorderThreshold ?? 10);
    const unitCost = part.unitCostInr !== undefined ? part.unitCostInr : (existing?.unitCostInr ?? 0);
    const bin = part.binLocation || existing?.binLocation || 'UNASSIGNED';
    const supplier = part.supplierName || existing?.supplierName || 'Stores Depot';

    this.db.prepare(`
      INSERT INTO stores_inventory (
        id, part_code, part_name, category, unit_of_measure,
        stock_quantity, reserved_quantity, reorder_threshold,
        unit_cost_inr, bin_location, supplier_name, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(part_code) DO UPDATE SET
        part_name = excluded.part_name,
        category = excluded.category,
        stock_quantity = excluded.stock_quantity,
        reserved_quantity = excluded.reserved_quantity,
        reorder_threshold = excluded.reorder_threshold,
        unit_cost_inr = excluded.unit_cost_inr,
        bin_location = excluded.bin_location,
        supplier_name = excluded.supplier_name,
        updated_at = excluded.updated_at
    `).run(
      id,
      part.partCode.trim().toUpperCase(),
      part.partName,
      part.category,
      part.unitOfMeasure || 'NOS',
      stockQty,
      reservedQty,
      threshold,
      unitCost,
      bin,
      supplier,
      now
    );

    return this.getPartByCode(part.partCode)!;
  }

  public reservePart(data: {
    wagonNumber: string;
    partCode: string;
    quantity: number;
    source?: ReservationSource;
    predictedDefect?: string;
    confidenceScore?: number;
  }): InventoryReservation {
    const part = this.getPartByCode(data.partCode);
    if (!part) {
      throw new Error(`PART_NOT_FOUND: Part with code "${data.partCode}" does not exist in inventory.`);
    }

    if (data.quantity <= 0) {
      throw new Error('INVALID_QUANTITY: Reservation quantity must be greater than 0.');
    }

    if (part.availableQuantity < data.quantity) {
      throw new Error(`INSUFFICIENT_STOCK: Required ${data.quantity} units, but only ${part.availableQuantity} available for part ${part.partCode} (${part.partName}).`);
    }

    const resId = crypto.randomUUID();
    const now = new Date().toISOString();

    // Increment reserved_quantity
    this.db.prepare(`
      UPDATE stores_inventory
      SET reserved_quantity = reserved_quantity + ?,
          updated_at = ?
      WHERE part_code = ?
    `).run(data.quantity, now, part.partCode);

    // Insert reservation
    this.db.prepare(`
      INSERT INTO inventory_reservations (
        id, wagon_number, part_code, quantity, source,
        predicted_defect, confidence_score, status, allocated_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'RESERVED', ?, ?, ?)
    `).run(
      resId,
      data.wagonNumber.trim().toUpperCase(),
      part.partCode,
      data.quantity,
      data.source || 'MANUAL_INSPECTION',
      data.predictedDefect || null,
      data.confidenceScore !== undefined ? data.confidenceScore : null,
      now,
      now,
      now
    );

    return {
      id: resId,
      wagonNumber: data.wagonNumber.trim().toUpperCase(),
      partCode: part.partCode,
      quantity: data.quantity,
      source: data.source || 'MANUAL_INSPECTION',
      predictedDefect: data.predictedDefect,
      confidenceScore: data.confidenceScore,
      status: 'RESERVED',
      allocatedAt: now,
      createdAt: now,
      updatedAt: now,
      partName: part.partName,
      binLocation: part.binLocation,
      category: part.category
    };
  }

  public issuePart(data: {
    reservationId?: string;
    partCode?: string;
    quantity?: number;
    wagonNumber?: string;
  }): { success: boolean; issuedQuantity: number; remainingStock: number } {
    const now = new Date().toISOString();

    if (data.reservationId) {
      const resRow = this.db.prepare('SELECT * FROM inventory_reservations WHERE id = ?').get(data.reservationId) as Record<string, unknown> | undefined;
      if (!resRow) {
        throw new Error(`RESERVATION_NOT_FOUND: Reservation ID "${data.reservationId}" not found.`);
      }

      if (resRow.status === 'ISSUED_TO_FLOOR') {
        throw new Error('ALREADY_ISSUED: Reservation has already been issued.');
      }

      const partCode = resRow.part_code as string;
      const qty = Number(resRow.quantity);

      // Decrement stock and reserved quantity
      this.db.prepare(`
        UPDATE stores_inventory
        SET stock_quantity = MAX(0, stock_quantity - ?),
            reserved_quantity = MAX(0, reserved_quantity - ?),
            updated_at = ?
        WHERE part_code = ?
      `).run(qty, qty, now, partCode);

      // Update reservation status
      this.db.prepare(`
        UPDATE inventory_reservations
        SET status = 'ISSUED_TO_FLOOR',
            updated_at = ?
        WHERE id = ?
      `).run(now, data.reservationId);

      const part = this.getPartByCode(partCode)!;
      return { success: true, issuedQuantity: qty, remainingStock: part.stockQuantity };
    }

    if (data.partCode && data.quantity) {
      const part = this.getPartByCode(data.partCode);
      if (!part) throw new Error(`PART_NOT_FOUND: Part code "${data.partCode}" not found.`);
      if (part.stockQuantity < data.quantity) {
        throw new Error(`INSUFFICIENT_STOCK: Cannot issue ${data.quantity} units; only ${part.stockQuantity} in stock.`);
      }

      this.db.prepare(`
        UPDATE stores_inventory
        SET stock_quantity = stock_quantity - ?,
            updated_at = ?
        WHERE part_code = ?
      `).run(data.quantity, now, part.partCode);

      const updated = this.getPartByCode(part.partCode)!;
      return { success: true, issuedQuantity: data.quantity, remainingStock: updated.stockQuantity };
    }

    throw new Error('INVALID_ISSUE_REQUEST: Must provide reservationId or (partCode and quantity).');
  }

  public restockPart(partCode: string, quantity: number): StoresPart {
    if (quantity <= 0) throw new Error('INVALID_QUANTITY: Restock quantity must be positive.');
    const part = this.getPartByCode(partCode);
    if (!part) throw new Error(`PART_NOT_FOUND: Part code "${partCode}" not found.`);

    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE stores_inventory
      SET stock_quantity = stock_quantity + ?,
          updated_at = ?
      WHERE part_code = ?
    `).run(quantity, now, part.partCode);

    return this.getPartByCode(partCode)!;
  }

  public getReservations(wagonNumber?: string): InventoryReservation[] {
    let query = 'SELECT r.*, p.part_name, p.bin_location, p.category FROM inventory_reservations r LEFT JOIN stores_inventory p ON r.part_code = p.part_code';
    const params: unknown[] = [];
    if (wagonNumber) {
      query += ' WHERE r.wagon_number = ?';
      params.push(wagonNumber.trim().toUpperCase());
    }
    query += ' ORDER BY r.created_at DESC';
    const rows = this.db.prepare(query).all(...params) as Record<string, unknown>[];

    return rows.map(r => ({
      id: r.id as string,
      wagonNumber: r.wagon_number as string,
      partCode: r.part_code as string,
      quantity: Number(r.quantity),
      source: r.source as ReservationSource,
      predictedDefect: (r.predicted_defect as string) || null,
      confidenceScore: r.confidence_score !== null ? Number(r.confidence_score) : null,
      status: r.status as ReservationStatus,
      allocatedAt: (r.allocated_at as string) || null,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
      partName: r.part_name as string | undefined,
      binLocation: r.bin_location as string | undefined,
      category: r.category as CASNUBCategory | undefined
    }));
  }

  public getInventoryStats(): InventoryStats {
    const parts = this.getInventory();
    let lowStockCount = 0;
    let totalReservedCount = 0;
    let totalValuationInr = 0;

    for (const p of parts) {
      if (p.availableQuantity <= p.reorderThreshold) lowStockCount++;
      totalReservedCount += p.reservedQuantity;
      totalValuationInr += p.stockQuantity * p.unitCostInr;
    }

    return {
      totalParts: parts.length,
      lowStockCount,
      totalReservedCount,
      totalValuationInr
    };
  }

  // -----------------------------------------------------------------------
  // OMRS Telemetry Scans & AI Triage Methods
  // -----------------------------------------------------------------------

  public recordOMRSScan(data: Partial<OMRSScanRecord> & { wagonNumber: string }): OMRSScanRecord {
    const id = data.id || `omrs_${crypto.randomUUID()}`;
    const wagonNumber = data.wagonNumber.trim().toUpperCase();
    const scanTimestamp = data.scanTimestamp || new Date().toISOString();
    const location = data.location || 'Trackside OMRS Sensor Array - Raipur Outer Yard (KM 828/14)';
    const trainSpeed = Number(data.trainSpeedKmph ?? 65.0);
    const wheelImpact = data.wheelImpactKn !== undefined ? data.wheelImpactKn : null;
    const acousticPeak = data.acousticBearingPeakDb !== undefined ? data.acousticBearingPeakDb : null;
    const temp = data.temperatureCelsius !== undefined ? data.temperatureCelsius : null;
    const wheelDev = data.wheelProfileDeviationMm !== undefined ? data.wheelProfileDeviationMm : null;

    let predictedDefects = data.predictedDefects || [];
    let severity = data.triageSeverity || 'NORMAL';

    // Auto-predict defects if telemetry is anomalous and none explicitly provided
    if (predictedDefects.length === 0) {
      if (wheelImpact && wheelImpact > 35) {
        predictedDefects.push({
          component: 'Outer & Snubber Springs',
          defectType: 'Spring Fatigue / High Dynamic Impact',
          severity: 'CRITICAL',
          confidence: 0.94,
          recommendedPartCode: 'PART-SP-SNUB',
          quantity: 2
        });
        severity = 'CRITICAL_TRIAGE';
      }
      if (acousticPeak && acousticPeak > 78) {
        predictedDefects.push({
          component: 'Cartridge Tapered Roller Bearing (CTRB)',
          defectType: 'Bearing Sub-Surface Spalling / Acoustic Overload',
          severity: 'CRITICAL',
          confidence: 0.92,
          recommendedPartCode: 'PART-BRG-01',
          quantity: 1
        });
        severity = 'CRITICAL_TRIAGE';
      }
      if (wheelDev && wheelDev > 3.5) {
        predictedDefects.push({
          component: 'Wheel Profile',
          defectType: 'Flange Wear / Tread Hollow Wear',
          severity: 'ADVISORY',
          confidence: 0.88,
          recommendedPartCode: 'PART-WS-01',
          quantity: 1
        });
        if (severity === 'NORMAL') severity = 'ADVISORY';
      }
    }

    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO omrs_scans (
        id, wagon_number, scan_timestamp, location, train_speed_kmph,
        wheel_impact_kn, acoustic_bearing_peak_db, temperature_celsius,
        wheel_profile_deviation_mm, predicted_defects_json, triage_severity,
        is_triaged, auto_reservation_triggered, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)
    `).run(
      id,
      wagonNumber,
      scanTimestamp,
      location,
      trainSpeed,
      wheelImpact,
      acousticPeak,
      temp,
      wheelDev,
      JSON.stringify(predictedDefects),
      severity,
      now
    );

    return {
      id,
      wagonNumber,
      scanTimestamp,
      location,
      trainSpeedKmph: trainSpeed,
      wheelImpactKn: wheelImpact,
      acousticBearingPeakDb: acousticPeak,
      temperatureCelsius: temp,
      wheelProfileDeviationMm: wheelDev,
      predictedDefects,
      triageSeverity: severity,
      isTriaged: false,
      autoReservationTriggered: false,
      createdAt: now
    };
  }

  public getOMRSScans(): OMRSScanRecord[] {
    const rows = this.db.prepare('SELECT * FROM omrs_scans ORDER BY scan_timestamp DESC').all() as Record<string, unknown>[];
    return rows.map(r => ({
      id: r.id as string,
      wagonNumber: r.wagon_number as string,
      scanTimestamp: r.scan_timestamp as string,
      location: r.location as string,
      trainSpeedKmph: Number(r.train_speed_kmph),
      wheelImpactKn: r.wheel_impact_kn !== null ? Number(r.wheel_impact_kn) : null,
      acousticBearingPeakDb: r.acoustic_bearing_peak_db !== null ? Number(r.acoustic_bearing_peak_db) : null,
      temperatureCelsius: r.temperature_celsius !== null ? Number(r.temperature_celsius) : null,
      wheelProfileDeviationMm: r.wheel_profile_deviation_mm !== null ? Number(r.wheel_profile_deviation_mm) : null,
      predictedDefects: JSON.parse(r.predicted_defects_json as string),
      triageSeverity: r.triage_severity as OMRSTriageSeverity,
      isTriaged: Boolean(r.is_triaged),
      autoReservationTriggered: Boolean(r.auto_reservation_triggered),
      createdAt: r.created_at as string
    }));
  }

  public getOMRSScanByWagon(wagonNumber: string): OMRSScanRecord | null {
    const row = this.db.prepare('SELECT * FROM omrs_scans WHERE wagon_number = ? ORDER BY scan_timestamp DESC LIMIT 1').get(wagonNumber.trim().toUpperCase()) as Record<string, unknown> | undefined;
    if (!row) return null;

    return {
      id: row.id as string,
      wagonNumber: row.wagon_number as string,
      scanTimestamp: row.scan_timestamp as string,
      location: row.location as string,
      trainSpeedKmph: Number(row.train_speed_kmph),
      wheelImpactKn: row.wheel_impact_kn !== null ? Number(row.wheel_impact_kn) : null,
      acousticBearingPeakDb: row.acoustic_bearing_peak_db !== null ? Number(row.acoustic_bearing_peak_db) : null,
      temperatureCelsius: row.temperature_celsius !== null ? Number(row.temperature_celsius) : null,
      wheelProfileDeviationMm: row.wheel_profile_deviation_mm !== null ? Number(row.wheel_profile_deviation_mm) : null,
      predictedDefects: JSON.parse(row.predicted_defects_json as string),
      triageSeverity: row.triage_severity as OMRSTriageSeverity,
      isTriaged: Boolean(row.is_triaged),
      autoReservationTriggered: Boolean(row.auto_reservation_triggered),
      createdAt: row.created_at as string
    };
  }

  public triageWagonOMRS(wagonNumber: string): AITriageResult {
    const scan = this.getOMRSScanByWagon(wagonNumber);
    if (!scan) {
      throw new Error(`OMRS_SCAN_NOT_FOUND: No trackside OMRS telemetry found for wagon "${wagonNumber}".`);
    }

    const reservations: InventoryReservation[] = [];

    // Trigger auto-reservations if not already done
    if (!scan.autoReservationTriggered && scan.predictedDefects.length > 0) {
      for (const defect of scan.predictedDefects) {
        if (defect.recommendedPartCode) {
          try {
            const res = this.reservePart({
              wagonNumber,
              partCode: defect.recommendedPartCode,
              quantity: defect.quantity,
              source: 'OMRS_AI_TRIAGE',
              predictedDefect: `${defect.component}: ${defect.defectType}`,
              confidenceScore: defect.confidence
            });
            reservations.push(res);
          } catch (err: any) {
            // Log stock reservation failure if stock is depleted
          }
        }
      }

      this.db.prepare('UPDATE omrs_scans SET is_triaged = 1, auto_reservation_triggered = 1 WHERE id = ?').run(scan.id);
      scan.isTriaged = true;
      scan.autoReservationTriggered = true;
    } else {
      if (!scan.isTriaged) {
        this.db.prepare('UPDATE omrs_scans SET is_triaged = 1 WHERE id = ?').run(scan.id);
        scan.isTriaged = true;
      }
      reservations.push(...this.getReservations(wagonNumber));
    }

    const summary = scan.predictedDefects.length > 0
      ? `AI Triage flagged ${scan.predictedDefects.length} defect(s) (${scan.triageSeverity}). Auto-reserved ${reservations.length} replacement part(s).`
      : 'AI Triage completed: Telemetry nominal. No component defects predicted.';

    return {
      scan,
      reservations,
      triageSummary: summary
    };
  }

  // -----------------------------------------------------------------------
  // Phase 3: Component Health Passports & Serialization Methods (M2 / R4)
  // -----------------------------------------------------------------------

  public registerComponent(comp: Partial<SerializedComponent> & {
    serialNumber: string;
    componentType: SerializedComponentType;
    category: CASNUBCategory;
    partName: string;
  }): SerializedComponent {
    const id = comp.id || crypto.randomUUID();
    const sn = comp.serialNumber.trim().toUpperCase();
    const now = new Date().toISOString();
    const mfg = comp.manufacturer || 'RWF Yelahanka';
    const mfgDate = comp.manufacturingDate || '2026-01-01';
    const qr = comp.qrCode || `WRS-PASSPORT://v1?sn=${encodeURIComponent(sn)}&type=${encodeURIComponent(comp.componentType)}&mfg=${encodeURIComponent(mfg)}&date=${encodeURIComponent(mfgDate)}`;

    this.db.prepare(`
      INSERT INTO components (
        id, serial_number, component_type, category, part_name,
        qr_code, rfid_tag, status, current_wagon_number, current_bogie_position,
        manufacturing_date, manufacturer, total_km_travelled, overhaul_count,
        last_poh_date, next_poh_due, health_score, health_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      sn,
      comp.componentType,
      comp.category,
      comp.partName,
      qr,
      comp.rfidTag || null,
      comp.status || 'AVAILABLE_IN_STORES',
      comp.currentWagonNumber || null,
      comp.currentBogiePosition || 'NONE',
      mfgDate,
      mfg,
      comp.totalKmTravelled ?? 0,
      comp.overhaulCount ?? 0,
      comp.lastPohDate || null,
      comp.nextPohDue || null,
      comp.healthScore ?? 100,
      comp.healthStatus || 'EXCELLENT',
      now,
      now
    );

    // Initial history event
    this.addComponentHistory({
      componentId: id,
      serialNumber: sn,
      eventType: 'MANUFACTURED',
      wagonNumber: comp.currentWagonNumber || undefined,
      actionDetails: `Component manufactured by ${mfg} on ${mfgDate}`,
      performedBy: 'SYSTEM_STORES',
      performerName: 'Stores Depot Admin'
    });

    return this.getComponentById(id)!;
  }

  public getComponentById(id: string): SerializedComponent | null {
    const row = this.db.prepare('SELECT * FROM components WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapComponentRow(row);
  }

  public getComponentBySerial(serialNumber: string): SerializedComponent | null {
    const row = this.db.prepare('SELECT * FROM components WHERE serial_number = ?').get(serialNumber.trim().toUpperCase()) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapComponentRow(row);
  }

  private mapComponentRow(row: Record<string, unknown>): SerializedComponent {
    const history = this.getComponentHistory(row.id as string);
    return {
      id: row.id as string,
      serialNumber: row.serial_number as string,
      componentType: row.component_type as SerializedComponentType,
      category: row.category as CASNUBCategory,
      partName: row.part_name as string,
      qrCode: row.qr_code as string,
      rfidTag: (row.rfid_tag as string) || undefined,
      status: row.status as ComponentStatus,
      currentWagonNumber: (row.current_wagon_number as string) || null,
      currentBogiePosition: (row.current_bogie_position as any) || 'NONE',
      manufacturingDate: row.manufacturing_date as string,
      manufacturer: row.manufacturer as string,
      totalKmTravelled: Number(row.total_km_travelled ?? 0),
      overhaulCount: Number(row.overhaul_count ?? 0),
      lastPohDate: (row.last_poh_date as string) || undefined,
      nextPohDue: (row.next_poh_due as string) || undefined,
      healthScore: Number(row.health_score ?? 100),
      healthStatus: row.health_status as ComponentHealthStatus,
      history,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string
    };
  }

  public getAllComponents(filters?: { type?: string; status?: string; wagonNumber?: string }): SerializedComponent[] {
    let query = 'SELECT * FROM components WHERE 1=1';
    const params: unknown[] = [];

    if (filters?.type) {
      query += ' AND component_type = ?';
      params.push(filters.type.toUpperCase());
    }
    if (filters?.status) {
      query += ' AND status = ?';
      params.push(filters.status.toUpperCase());
    }
    if (filters?.wagonNumber) {
      query += ' AND current_wagon_number = ?';
      params.push(filters.wagonNumber.trim().toUpperCase());
    }

    query += ' ORDER BY serial_number ASC';
    const rows = this.db.prepare(query).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.mapComponentRow(r));
  }

  public assignComponentToWagon(
    componentIdOrSerial: string,
    wagonNumber: string,
    bogiePosition: 'BOGIE_1' | 'BOGIE_2' | 'UNDERFRAME' | 'BODY' | 'NONE' = 'BOGIE_1',
    performedBy: string = 'inspector1',
    performerName: string = 'Railway Inspector',
    stage: string = 'REASSEMBLY',
    notes?: string
  ): SerializedComponent {
    const comp = this.getComponentById(componentIdOrSerial) || this.getComponentBySerial(componentIdOrSerial);
    if (!comp) {
      throw new Error(`COMPONENT_NOT_FOUND: Component "${componentIdOrSerial}" not found.`);
    }

    const cleanWagon = wagonNumber.trim().toUpperCase();
    const now = new Date().toISOString();

    // If already assigned to another wagon, log removal
    if (comp.currentWagonNumber && comp.currentWagonNumber !== cleanWagon) {
      this.addComponentHistory({
        componentId: comp.id,
        serialNumber: comp.serialNumber,
        eventType: 'REMOVED_FROM_WAGON',
        wagonNumber: comp.currentWagonNumber,
        stage,
        actionDetails: `Component unassigned from wagon ${comp.currentWagonNumber} for reassignment to ${cleanWagon}`,
        performedBy,
        performerName,
        notes
      });
    }

    this.db.prepare(`
      UPDATE components
      SET current_wagon_number = ?,
          current_bogie_position = ?,
          status = 'IN_SERVICE',
          updated_at = ?
      WHERE id = ?
    `).run(cleanWagon, bogiePosition, now, comp.id);

    this.addComponentHistory({
      componentId: comp.id,
      serialNumber: comp.serialNumber,
      eventType: 'ASSIGNED_TO_WAGON',
      wagonNumber: cleanWagon,
      stage,
      actionDetails: `Assigned serialized ${comp.componentType} (${comp.serialNumber}) to wagon ${cleanWagon} at position ${bogiePosition}`,
      performedBy,
      performerName,
      notes
    });

    return this.getComponentById(comp.id)!;
  }

  public unassignComponent(
    componentIdOrSerial: string,
    performedBy: string = 'inspector1',
    performerName: string = 'Railway Inspector',
    notes?: string
  ): SerializedComponent {
    const comp = this.getComponentById(componentIdOrSerial) || this.getComponentBySerial(componentIdOrSerial);
    if (!comp) throw new Error(`COMPONENT_NOT_FOUND: Component "${componentIdOrSerial}" not found.`);

    const now = new Date().toISOString();
    const oldWagon = comp.currentWagonNumber;

    this.db.prepare(`
      UPDATE components
      SET current_wagon_number = NULL,
          current_bogie_position = 'NONE',
          status = 'AVAILABLE_IN_STORES',
          updated_at = ?
      WHERE id = ?
    `).run(now, comp.id);

    this.addComponentHistory({
      componentId: comp.id,
      serialNumber: comp.serialNumber,
      eventType: 'REMOVED_FROM_WAGON',
      wagonNumber: oldWagon || undefined,
      actionDetails: `Component unassigned from wagon ${oldWagon || 'N/A'} and returned to Stores Depot`,
      performedBy,
      performerName,
      notes
    });

    return this.getComponentById(comp.id)!;
  }

  public addComponentHistory(event: Omit<ComponentHistoryEvent, 'id' | 'createdAt'>): ComponentHistoryEvent {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO component_history (
        id, component_id, serial_number, event_type,
        wagon_number, stage, action_details, performed_by,
        performer_name, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      event.componentId,
      event.serialNumber,
      event.eventType,
      event.wagonNumber || null,
      event.stage || null,
      event.actionDetails,
      event.performedBy,
      event.performerName,
      event.notes || null,
      now
    );

    return {
      id,
      componentId: event.componentId,
      serialNumber: event.serialNumber,
      eventType: event.eventType,
      wagonNumber: event.wagonNumber,
      stage: event.stage,
      actionDetails: event.actionDetails,
      performedBy: event.performedBy,
      performerName: event.performerName,
      notes: event.notes,
      createdAt: now
    };
  }

  public getComponentHistory(componentIdOrSerial: string): ComponentHistoryEvent[] {
    const rows = this.db.prepare(`
      SELECT * FROM component_history
      WHERE component_id = ? OR serial_number = ?
      ORDER BY created_at ASC
    `).all(componentIdOrSerial, componentIdOrSerial.trim().toUpperCase()) as Record<string, unknown>[];

    return rows.map(r => ({
      id: r.id as string,
      componentId: r.component_id as string,
      serialNumber: r.serial_number as string,
      eventType: r.event_type as ComponentEventType,
      wagonNumber: (r.wagon_number as string) || undefined,
      stage: (r.stage as string) || undefined,
      actionDetails: r.action_details as string,
      performedBy: r.performed_by as string,
      performerName: r.performer_name as string,
      notes: (r.notes as string) || undefined,
      createdAt: r.created_at as string
    }));
  }

  // -----------------------------------------------------------------------
  // Acoustic Diagnostics & Blocker Methods (M5 / R3)
  // -----------------------------------------------------------------------

  public saveAcousticDiagnostic(data: {
    wagonNumber: string;
    dominantFrequencyHz: number;
    peakDb: number;
    isAnomalyDetected: boolean;
    anomalyType: string;
    confidence: number;
    recommendedAction: string;
    inspectorId?: string;
  }): { id: string; wagonNumber: string; anomalyType: string; isAnomalyDetected: boolean; createdAt: string } {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const wagonNumber = data.wagonNumber.trim().toUpperCase();

    this.db.prepare(`
      INSERT INTO acoustic_diagnostics (
        id, wagon_number, dominant_frequency_hz, peak_db,
        is_anomaly_detected, anomaly_type, confidence,
        recommended_action, inspector_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      wagonNumber,
      data.dominantFrequencyHz,
      data.peakDb,
      data.isAnomalyDetected ? 1 : 0,
      data.anomalyType,
      data.confidence,
      data.recommendedAction,
      data.inspectorId || null,
      now
    );

    // If anomaly detected at Final QC gate, mark blocker in wagon condition notes
    if (data.isAnomalyDetected) {
      this.db.prepare(`
        UPDATE wagons
        SET condition_notes = COALESCE(condition_notes || ' | ', '') || 'Acoustic Blocker: ' || ?,
            updated_at = ?
        WHERE wagon_number = ?
      `).run(`${data.anomalyType} detected (${data.dominantFrequencyHz}Hz, ${data.peakDb}dB)`, now, wagonNumber);
    }


    return {
      id,
      wagonNumber,
      anomalyType: data.anomalyType,
      isAnomalyDetected: data.isAnomalyDetected,
      createdAt: now
    };
  }

  public getAcousticDiagnostics(wagonNumber: string): any[] {
    const rows = this.db.prepare('SELECT * FROM acoustic_diagnostics WHERE wagon_number = ? ORDER BY created_at DESC').all(wagonNumber.trim().toUpperCase()) as Record<string, unknown>[];
    return rows.map(r => ({
      id: r.id as string,
      wagonNumber: r.wagon_number as string,
      dominantFrequencyHz: Number(r.dominant_frequency_hz),
      peakDb: Number(r.peak_db),
      isAnomalyDetected: Boolean(r.is_anomaly_detected),
      anomalyType: r.anomaly_type as string,
      confidence: Number(r.confidence),
      recommendedAction: r.recommended_action as string,
      inspectorId: (r.inspector_id as string) || null,
      createdAt: r.created_at as string
    }));
  }

  public getLatestAcousticDiagnostic(wagonNumber: string): any | null {
    const diags = this.getAcousticDiagnostics(wagonNumber);
    return diags.length > 0 ? diags[0] : null;
  }

  // -----------------------------------------------------------------------
  // CV Measurements & Voice Logs Methods (M4 / R2 & M3 / R1)
  // -----------------------------------------------------------------------

  public saveCVMeasurement(data: {
    wagonNumber: string;
    componentType: string;
    position: string;
    measuredHeight: number;
    status: string;
    bandColor?: string;
    photoId?: string;
    confidence: number;
  }): { id: string; wagonNumber: string; status: string; createdAt: string } {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const cleanWagon = data.wagonNumber.trim().toUpperCase();

    this.db.prepare(`
      INSERT INTO cv_measurements (
        id, wagon_number, component_type, position,
        measured_height, status, band_color, photo_id,
        confidence, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      cleanWagon,
      data.componentType,
      data.position,
      data.measuredHeight,
      data.status,
      data.bandColor || null,
      data.photoId || null,
      data.confidence,
      now
    );

    return {
      id,
      wagonNumber: cleanWagon,
      status: data.status,
      createdAt: now
    };
  }

  public getCVMeasurements(wagonNumber: string): any[] {
    const rows = this.db.prepare('SELECT * FROM cv_measurements WHERE wagon_number = ? ORDER BY created_at DESC').all(wagonNumber.trim().toUpperCase()) as Record<string, unknown>[];
    return rows.map(r => ({
      id: r.id as string,
      wagonNumber: r.wagon_number as string,
      componentType: r.component_type as string,
      position: r.position as string,
      measuredHeight: Number(r.measured_height),
      status: r.status as string,
      bandColor: (r.band_color as string) || null,
      photoId: (r.photo_id as string) || null,
      confidence: Number(r.confidence),
      createdAt: r.created_at as string
    }));
  }

  public saveVoiceLog(data: {
    wagonNumber: string;
    transcript: string;
    locale: string;
    intent: string;
    targetCategory?: string;
    targetPartName?: string;
    statusApplied?: string;
    confidence: number;
    inspectorId?: string;
  }): { id: string; wagonNumber: string; transcript: string; createdAt: string } {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO voice_logs (
        id, wagon_number, transcript, locale, intent,
        target_category, target_part_name, status_applied,
        confidence, inspector_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.wagonNumber.trim().toUpperCase(),
      data.transcript,
      data.locale || 'en',
      data.intent,
      data.targetCategory || null,
      data.targetPartName || null,
      data.statusApplied || null,
      data.confidence,
      data.inspectorId || null,
      now
    );

    return {
      id,
      wagonNumber: data.wagonNumber.trim().toUpperCase(),
      transcript: data.transcript,
      createdAt: now
    };
  }

  public getVoiceLogs(wagonNumber: string): any[] {
    const rows = this.db.prepare('SELECT * FROM voice_logs WHERE wagon_number = ? ORDER BY created_at DESC').all(wagonNumber.trim().toUpperCase()) as Record<string, unknown>[];
    return rows.map(r => ({
      id: r.id as string,
      wagonNumber: r.wagon_number as string,
      transcript: r.transcript as string,
      locale: r.locale as string,
      intent: r.intent as string,
      targetCategory: (r.target_category as string) || null,
      targetPartName: (r.target_part_name as string) || null,
      statusApplied: (r.status_applied as string) || null,
      confidence: Number(r.confidence),
      inspectorId: (r.inspector_id as string) || null,
      createdAt: r.created_at as string
    }));
  }

  public close(): void {
    this.db.close();
  }
}

