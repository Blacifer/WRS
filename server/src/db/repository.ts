/**
 * Inspection & Audit Repository (Data Access Object)
 * Indian Railways WRS Raipur
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
  AuditLogEntry
} from '../../../shared/types.ts';
import { logAuditEvent as sharedLogAuditEvent } from './auditLog.ts';

export class InspectionRepository {
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  /**
   * Monotonically increments and returns the next inspection sequence number
   */
  public getNextSequenceNumber(): number {
    const row = this.db
      .prepare("SELECT last_val FROM sequence_tracker WHERE name = 'inspection_seq'")
      .get() as { last_val: number } | undefined;

    const nextVal = (row?.last_val ?? 0) + 1;
    this.db
      .prepare("UPDATE sequence_tracker SET last_val = ? WHERE name = 'inspection_seq'")
      .run(nextVal);
    return nextVal;
  }

  /**
   * Generates a cryptographic SHA-256 audit hash for an inspection record
   */
  private generateAuditHash(record: Record<string, any>): string {
    const canonicalString = [
      record.id,
      record.sequence_number,
      record.wagon_number,
      record.bogie_type,
      record.spring_position,
      record.condition || record.spring_condition,
      record.measured_free_height || record.measured_height,
      record.classified_band,
      record.status,
      record.inspector_id,
      record.timestamp || record.created_at
    ].join('|');

    return crypto.createHash('sha256').update(canonicalString).digest('hex');
  }

  /**
   * Inserts an inspection record (Strictly Append-Only)
   */
  public insertInspection(data: Partial<InspectionRecord>): InspectionRecord {
    const id = data.id || `insp_${crypto.randomUUID()}`;
    const sequenceNumber = data.sequenceNumber || data.sequence_number || this.getNextSequenceNumber();
    const timestamp = data.timestamp || data.created_at || new Date().toISOString();
    // Operator precedence made this always evaluate to null: `||` binds tighter
    // than `?:`, so it read as ((sync_id || SYNCED) ? null : ...). The column
    // was therefore never populated, and the sync endpoint's duplicate
    // suppression — which catches the UNIQUE violation on sync_id — could not
    // fire. A retried offline batch inserted every spring a second time, which
    // now also corrupts nest counting: twelve outer springs appear as
    // twenty-four. Also accepts the camelCase form the sync route sends.
    const syncId = data.syncId ?? data.sync_id ?? null;

    const wagonNumber = data.wagonNumber || data.wagon_number || '';
    const bogieType = data.bogieType || data.bogie_type || 'CASNUB_22_NLB';
    const springCondition = data.condition || data.spring_condition || 'USED';
    const springPosition = data.springPosition || data.spring_position || 'OUTER';
    const measuredHeight = data.measuredFreeHeight ?? data.measured_height ?? 0.0;
    const classifiedBand = data.classifiedBand ?? data.band ?? data.classified_band ?? null;
    const bandRoman = data.bandRoman ?? data.band_roman ?? null;
    const status = data.status || 'PASS';
    const damageType = data.damageType || data.damage_type || 'NONE';
    const damageNotes = data.damageNotes ?? data.damage_notes ?? null;
    const tableReference = data.tableReference || data.table_reference || 'Table 28';
    const validRangeMin = data.valid_range_min ?? 245.0;
    const validRangeMax = data.valid_range_max ?? 263.0;
    const condemnationReason = data.condemnationReason ?? data.condemnation_reason ?? null;

    const inspectorId = data.inspectorId || data.inspector_id || 'usr_insp_001';
    const inspectorName = data.inspectorName || data.inspector_name || 'Ramesh Kumar';

    const supervisorOverride = data.isOverridden || data.supervisor_override ? 1 : 0;
    const originalBand = data.originalBand ?? data.original_band ?? null;
    const overrideBand = data.overrideBand ?? data.override_band ?? null;
    const overrideReason = data.overrideReason ?? data.override_reason ?? null;
    const overrideSupervisorId = data.supervisorId ?? data.override_supervisor_id ?? null;
    const overrideSupervisorName = data.supervisorName ?? data.override_supervisor_name ?? null;
    const otpTokenRef = data.otpTokenRef ?? data.otp_token_ref ?? null;

    // Verify inspector user exists — do NOT silently create ghost users, and do
    // NOT let a missing FK surface as a raw, unhandled SQLite constraint error.
    const userCheck = this.db.prepare('SELECT id FROM users WHERE id = ?');
    if (!userCheck.get(inspectorId)) {
      const err: any = new Error(`Inspector ID "${inspectorId}" does not correspond to a known, active user. Please re-authenticate and try again.`);
      err.name = 'ValidationError';
      throw err;
    }

    if (overrideSupervisorId && !userCheck.get(overrideSupervisorId)) {
      const err: any = new Error(`Supervisor ID "${overrideSupervisorId}" does not correspond to a known, active user.`);
      err.name = 'ValidationError';
      throw err;
    }

    // Which bogie this spring came from. Optional so existing callers keep
    // working, but without it the spring cannot be matched to a specific
    // bogie's checklist item — see syncPhase1SpringsToChecklist.
    const bogiePosition = data.bogiePosition ?? data.bogie_position ?? null;
    // Which spring within its nest. Optional for callers that measure a single
    // representative spring, required for a full nest sweep to be countable.
    const nestIndex = data.nestIndex ?? data.nest_index ?? null;
    const measurementSource = data.measurementSource ?? data.measurement_source ?? 'MANUAL';
    const ocrConfidence = data.ocrConfidence ?? data.ocr_confidence ?? null;
    const ocrImageRef = data.ocrImageRef ?? data.ocr_image_ref ?? null;
    const offlineCreatedAt = data.offline_created_at ?? data.localCreatedAt ?? null;
    const syncedAt = data.synced_at || new Date().toISOString();

    const auditHash = this.generateAuditHash({
      id,
      sequence_number: sequenceNumber,
      wagon_number: wagonNumber,
      bogie_type: bogieType,
      spring_position: springPosition,
      spring_condition: springCondition,
      measured_height: measuredHeight,
      classified_band: classifiedBand,
      status,
      inspector_id: inspectorId,
      created_at: timestamp
    });

    const stmt = this.db.prepare(`
      INSERT INTO inspections (
        id, sequence_number, sync_id, wagon_number, bogie_type, spring_condition, spring_position,
        measured_height, classified_band, band_roman, status, damage_type, damage_notes,
        table_reference, valid_range_min, valid_range_max, condemnation_reason,
        inspector_id, inspector_name, supervisor_override, original_band, override_band,
        override_reason, override_supervisor_id, override_supervisor_name, otp_token_ref,
        measurement_source, ocr_confidence, ocr_image_ref, offline_created_at, created_at, synced_at, audit_hash,
        bogie_position, nest_index
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?
      )
    `);

    stmt.run(
      id, sequenceNumber, syncId, wagonNumber, bogieType, springCondition, springPosition,
      measuredHeight, classifiedBand, bandRoman, status, damageType, damageNotes,
      tableReference, validRangeMin, validRangeMax, condemnationReason,
      inspectorId, inspectorName, supervisorOverride, originalBand, overrideBand,
      overrideReason, overrideSupervisorId, overrideSupervisorName, otpTokenRef,
      measurementSource, ocrConfidence, ocrImageRef, offlineCreatedAt, timestamp, syncedAt, auditHash,
      bogiePosition, nestIndex
    );

    // Chained audit trail entry — this is the highest-volume event type in
    // the system (every spring inspection), so it must go through the same
    // hash chain as everything else rather than the old DB trigger, which
    // could not compute a chained hash.
    sharedLogAuditEvent(this.db, {
      inspectionId: id,
      eventType: supervisorOverride ? 'SUPERVISOR_OVERRIDE_RECORDED' : 'INSPECTION_CREATED',
      userId: inspectorId,
      userRole: 'INSPECTOR',
      payload: {
        sequenceNumber,
        wagonNumber,
        bogieType,
        springCondition,
        springPosition,
        bogiePosition,
        nestIndex,
        measuredHeight,
        classifiedBand,
        status,
        damageType,
        damageNotes,
        supervisorOverride: Boolean(supervisorOverride),
        overrideReason,
        otpTokenRef,
        measurementSource,
        auditHash
      },
      createdAt: timestamp
    });

    return {
      id,
      sequenceNumber,
      sequence_number: sequenceNumber,
      timestamp,
      created_at: timestamp,
      inspectorId,
      inspector_id: inspectorId,
      inspectorName,
      inspector_name: inspectorName,
      wagonNumber,
      wagon_number: wagonNumber,
      bogieType: bogieType as BogieType,
      bogie_type: bogieType as BogieType,
      springPosition: springPosition as any,
      spring_position: springPosition as any,
      condition: springCondition as SpringCondition,
      spring_condition: springCondition as SpringCondition,
      measuredFreeHeight: measuredHeight,
      measured_height: measuredHeight,
      classifiedBand: classifiedBand as BandColor | null,
      classified_band: classifiedBand as BandColor | null,
      band: classifiedBand as BandColor | null,
      bandRoman: bandRoman as any,
      band_roman: bandRoman as any,
      status: status as any,
      damageType: damageType as DamageType,
      damage_type: damageType as DamageType,
      damageNotes,
      damage_notes: damageNotes,
      tableReference,
      table_reference: tableReference,
      condemnationReason,
      condemnation_reason: condemnationReason,
      isOverridden: supervisorOverride === 1,
      supervisor_override: supervisorOverride,
      originalBand: originalBand as BandColor | null,
      original_band: originalBand as BandColor | null,
      overrideBand: overrideBand as BandColor | null,
      override_band: overrideBand as BandColor | null,
      overrideReason,
      override_reason: overrideReason,
      supervisorId: overrideSupervisorId,
      override_supervisor_id: overrideSupervisorId,
      supervisorName: overrideSupervisorName,
      override_supervisor_name: overrideSupervisorName,
      otpTokenRef,
      otp_token_ref: otpTokenRef,
      measurementSource: measurementSource as any,
      measurement_source: measurementSource as any,
      ocrConfidence,
      ocr_confidence: ocrConfidence,
      ocrImageRef,
      ocr_image_ref: ocrImageRef,
      syncStatus: 'SYNCED',
      synced_at: syncedAt,
      auditHash
    };
  }

  /**
   * Retrieves an inspection record by ID
   */
  public getInspectionById(id: string): InspectionRecord | null {
    const row = this.db.prepare('SELECT * FROM inspections WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.mapRowToInspection(row);
  }

  /**
   * Multi-criteria search and filter
   */
  public queryInspections(params: InspectionFilter = {}): {
    records: InspectionRecord[];
    totalCount: number;
    page: number;
    limit: number;
    totalPages: number;
  } {
    const whereClauses: string[] = ['1=1'];
    const bindParams: any[] = [];

    if (params.wagonNumber) {
      whereClauses.push('wagon_number LIKE ?');
      bindParams.push(`%${params.wagonNumber.trim()}%`);
    }

    if (params.startDate) {
      whereClauses.push('created_at >= ?');
      bindParams.push(params.startDate);
    }

    if (params.endDate) {
      whereClauses.push('created_at <= ?');
      bindParams.push(params.endDate);
    }

    if (params.inspectorId) {
      whereClauses.push('inspector_id = ?');
      bindParams.push(params.inspectorId);
    }

    if (params.band) {
      whereClauses.push('classified_band = ?');
      bindParams.push(params.band);
    }

    if (params.status) {
      whereClauses.push('status = ?');
      bindParams.push(params.status);
    }

    if (params.bogieType) {
      whereClauses.push('bogie_type = ?');
      bindParams.push(params.bogieType);
    }

    if (params.condition) {
      whereClauses.push('spring_condition = ?');
      bindParams.push(params.condition);
    }

    if (params.position) {
      whereClauses.push('spring_position = ?');
      bindParams.push(params.position);
    }

    if (params.supervisorOverride !== undefined) {
      whereClauses.push('supervisor_override = ?');
      bindParams.push(params.supervisorOverride ? 1 : 0);
    }

    if (params.damageType) {
      whereClauses.push('damage_type = ?');
      bindParams.push(params.damageType);
    }

    const whereSql = whereClauses.join(' AND ');

    // Total count
    const countRow = this.db.prepare(`SELECT COUNT(*) as total FROM inspections WHERE ${whereSql}`).get(...bindParams) as { total: number };
    const totalCount = countRow ? countRow.total : 0;

    // Pagination
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(500, Math.max(1, params.limit || 50));
    const offset = (page - 1) * limit;

    const validSortCols: Record<string, string> = {
      timestamp: 'created_at',
      created_at: 'created_at',
      wagonNumber: 'wagon_number',
      wagon_number: 'wagon_number',
      measuredHeight: 'measured_height',
      measured_height: 'measured_height',
      id: 'id'
    };

    const sortBy = validSortCols[params.sortBy || 'created_at'] || 'created_at';
    const sortOrder = (params.sortOrder || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const dataSql = `
      SELECT * FROM inspections
      WHERE ${whereSql}
      ORDER BY ${sortBy} ${sortOrder}
      LIMIT ? OFFSET ?
    `;

    const rows = this.db.prepare(dataSql).all(...bindParams, limit, offset) as any[];
    const records = rows.map(r => this.mapRowToInspection(r));
    const totalPages = Math.ceil(totalCount / limit) || 1;

    return {
      records,
      totalCount,
      page,
      limit,
      totalPages
    };
  }

  /**
   * Aggregates shift productivity and quality metrics
   */
  public getInspectionStats(startDate?: string, endDate?: string, wagonNumber?: string): InspectionStats {
    const whereClauses: string[] = ['1=1'];
    const bindParams: any[] = [];

    if (startDate) {
      whereClauses.push('created_at >= ?');
      bindParams.push(startDate);
    }
    if (endDate) {
      whereClauses.push('created_at <= ?');
      bindParams.push(endDate);
    }
    if (wagonNumber) {
      whereClauses.push('wagon_number LIKE ?');
      bindParams.push(`%${wagonNumber.trim()}%`);
    }

    const whereSql = whereClauses.join(' AND ');

    // Summary counts
    const summaryRow = this.db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'PASS' THEN 1 ELSE 0 END) as passed,
        SUM(CASE WHEN status = 'CONDEMNED' THEN 1 ELSE 0 END) as condemned,
        SUM(supervisor_override) as overrides,
        COUNT(DISTINCT wagon_number) as unique_wagons,
        COUNT(DISTINCT inspector_id) as unique_inspectors
      FROM inspections
      WHERE ${whereSql}
    `).get(...bindParams) as any;

    const totalInspections = summaryRow?.total || 0;
    const totalPassed = summaryRow?.passed || 0;
    const totalCondemned = summaryRow?.condemned || 0;
    const totalOverrides = summaryRow?.overrides || 0;
    const condemnationRatePercentage = totalInspections > 0 ? (totalCondemned * 100.0) / totalInspections : 0.0;
    const overrideRatePercentage = totalInspections > 0 ? (totalOverrides * 100.0) / totalInspections : 0.0;

    // Band distribution
    const bandRows = this.db.prepare(`
      SELECT classified_band, COUNT(*) as count
      FROM inspections
      WHERE ${whereSql} AND classified_band IS NOT NULL
      GROUP BY classified_band
    `).all(...bindParams) as Array<{ classified_band: string; count: number }>;

    const bandDistribution: Record<BandColor, number> = {
      BLUE: 0,
      GREEN: 0,
      YELLOW: 0,
      ORANGE: 0,
      WHITE: 0,
      RED: 0
    };
    for (const r of bandRows) {
      if (r.classified_band in bandDistribution) {
        bandDistribution[r.classified_band as BandColor] = r.count;
      }
    }

    // Bogie distribution
    const bogieRows = this.db.prepare(`
      SELECT bogie_type, COUNT(*) as count
      FROM inspections
      WHERE ${whereSql}
      GROUP BY bogie_type
    `).all(...bindParams) as Array<{ bogie_type: string; count: number }>;

    const bogieTypeDistribution: Record<BogieType, number> = {
      CASNUB_22_NLB: 0,
      CASNUB_22_HS: 0,
      CASNUB_22_RFT: 0
    };
    for (const r of bogieRows) {
      if (r.bogie_type in bogieTypeDistribution) {
        bogieTypeDistribution[r.bogie_type as BogieType] = r.count;
      }
    }

    // Condition distribution
    const condRows = this.db.prepare(`
      SELECT spring_condition, COUNT(*) as count
      FROM inspections
      WHERE ${whereSql}
      GROUP BY spring_condition
    `).all(...bindParams) as Array<{ spring_condition: string; count: number }>;

    const conditionDistribution: Record<SpringCondition, number> = {
      USED: 0,
      NEW: 0
    };
    for (const r of condRows) {
      if (r.spring_condition in conditionDistribution) {
        conditionDistribution[r.spring_condition as SpringCondition] = r.count;
      }
    }

    // Damage type distribution
    const damageRows = this.db.prepare(`
      SELECT damage_type, COUNT(*) as count
      FROM inspections
      WHERE ${whereSql}
      GROUP BY damage_type
    `).all(...bindParams) as Array<{ damage_type: string; count: number }>;

    const damageTypeDistribution: Record<DamageType, number> = {
      NONE: 0,
      CRACK: 0,
      CORROSION: 0,
      DEFORMATION: 0,
      OTHER: 0
    };
    for (const r of damageRows) {
      if (r.damage_type in damageTypeDistribution) {
        damageTypeDistribution[r.damage_type as DamageType] = r.count;
      }
    }

    // Hourly throughput
    const hourlyRows = this.db.prepare(`
      SELECT 
        strftime('%H:00', created_at) as hour,
        COUNT(*) as count,
        SUM(CASE WHEN status = 'PASS' THEN 1 ELSE 0 END) as pass_count,
        SUM(CASE WHEN status = 'CONDEMNED' THEN 1 ELSE 0 END) as condemn_count
      FROM inspections
      WHERE ${whereSql}
      GROUP BY hour
      ORDER BY hour ASC
    `).all(...bindParams) as Array<{ hour: string; count: number; pass_count: number; condemn_count: number }>;

    const hourlyThroughput = hourlyRows.map(r => ({
      hour: r.hour || '00:00',
      count: r.count,
      passCount: r.pass_count,
      condemnCount: r.condemn_count
    }));

    // Inspector productivity
    const inspectorRows = this.db.prepare(`
      SELECT 
        inspector_id,
        inspector_name,
        COUNT(*) as total,
        SUM(CASE WHEN status = 'PASS' THEN 1 ELSE 0 END) as passed,
        SUM(CASE WHEN status = 'CONDEMNED' THEN 1 ELSE 0 END) as condemned
      FROM inspections
      WHERE ${whereSql}
      GROUP BY inspector_id, inspector_name
      ORDER BY total DESC
    `).all(...bindParams) as Array<{
      inspector_id: string;
      inspector_name: string;
      total: number;
      passed: number;
      condemned: number;
    }>;

    const inspectorProductivity = inspectorRows.map(r => ({
      inspectorId: r.inspector_id,
      inspectorName: r.inspector_name,
      inspectionsCount: r.total,
      passedCount: r.passed,
      condemnedCount: r.condemned
    }));

    return {
      totalInspections,
      totalPassed,
      totalCondemned,
      condemnationRatePercentage: Math.round(condemnationRatePercentage * 100) / 100,
      totalOverrides,
      overrideRatePercentage: Math.round(overrideRatePercentage * 100) / 100,
      uniqueWagonsCount: summaryRow?.unique_wagons || 0,
      activeInspectorsCount: summaryRow?.unique_inspectors || 0,
      bandDistribution,
      bogieTypeDistribution,
      conditionDistribution,
      damageTypeDistribution,
      hourlyThroughput,
      inspectorProductivity
    };
  }

  /**
   * Fetch user by username
   */
  public getUserByUsername(username: string): any {
    return this.db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(username);
  }

  /**
   * Fetch user by ID
   */
  public getUserById(id: string): any {
    return this.db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').get(id);
  }

  /**
   * List all users (active and inactive), excluding password hashes.
   */
  public listUsers(): any[] {
    return this.db.prepare(`
      SELECT id, username, role, full_name, employee_id, is_active, created_at, updated_at
      FROM users ORDER BY created_at ASC
    `).all();
  }

  /**
   * Create a real user account. Throws a ValidationError (caught by the
   * centralized error handler -> 400) on a duplicate username/employee_id
   * rather than letting a raw UNIQUE constraint violation surface.
   */
  public createUser(data: {
    username: string;
    passwordHash: string;
    role: string;
    fullName: string;
    employeeId: string;
  }): any {
    const existing = this.db.prepare('SELECT id FROM users WHERE username = ? OR employee_id = ?')
      .get(data.username, data.employeeId);
    if (existing) {
      const err: any = new Error(`A user with username "${data.username}" or employee ID "${data.employeeId}" already exists.`);
      err.name = 'ValidationError';
      throw err;
    }

    const id = `usr_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO users (id, username, password_hash, role, full_name, employee_id, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(id, data.username, data.passwordHash, data.role, data.fullName, data.employeeId, now, now);

    return this.db.prepare(`
      SELECT id, username, role, full_name, employee_id, is_active, created_at, updated_at FROM users WHERE id = ?
    `).get(id);
  }

  /**
   * Deactivate (soft-disable) a user account — never hard-deletes, since
   * users are referenced by FK from inspections/audit rows and those must
   * remain attributable.
   */
  public setUserActive(id: string, isActive: boolean): any {
    const now = new Date().toISOString();
    const result = this.db.prepare('UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?')
      .run(isActive ? 1 : 0, now, id);
    if (result.changes === 0) {
      const err: any = new Error(`User "${id}" not found.`);
      err.name = 'ValidationError';
      throw err;
    }
    return this.db.prepare(`
      SELECT id, username, role, full_name, employee_id, is_active, created_at, updated_at FROM users WHERE id = ?
    `).get(id);
  }

  /**
   * Log an audit event — delegates to the shared chained writer so this
   * repository's events participate in the same hash chain as every other
   * subsystem (see server/src/db/auditLog.ts).
   */
  public logAuditEvent(event: Partial<AuditLogEntry>): void {
    sharedLogAuditEvent(this.db, event);
  }

  /**
   * Direct UPDATE attempt for verifying SQLite trigger immutability
   */
  public attemptDirectUpdate(id: string, newHeight: number): void {
    this.db.prepare('UPDATE inspections SET measured_height = ? WHERE id = ?').run(newHeight, id);
  }

  /**
   * Direct DELETE attempt for verifying SQLite trigger immutability
   */
  public attemptDirectDelete(id: string): void {
    this.db.prepare('DELETE FROM inspections WHERE id = ?').run(id);
  }

  private mapRowToInspection(row: any): InspectionRecord {
    return {
      id: row.id,
      sequenceNumber: row.sequence_number,
      sequence_number: row.sequence_number,
      timestamp: row.created_at,
      created_at: row.created_at,
      inspectorId: row.inspector_id,
      inspector_id: row.inspector_id,
      inspectorName: row.inspector_name,
      inspector_name: row.inspector_name,
      wagonNumber: row.wagon_number,
      wagon_number: row.wagon_number,
      bogieType: row.bogie_type,
      bogie_type: row.bogie_type,
      springPosition: row.spring_position,
      spring_position: row.spring_position,
      condition: row.spring_condition,
      spring_condition: row.spring_condition,
      measuredFreeHeight: row.measured_height,
      measured_height: row.measured_height,
      classifiedBand: row.classified_band,
      classified_band: row.classified_band,
      band: row.classified_band,
      bandRoman: row.band_roman,
      band_roman: row.band_roman,
      status: row.status,
      damageType: row.damage_type,
      damage_type: row.damage_type,
      damageNotes: row.damage_notes,
      damage_notes: row.damage_notes,
      condemnationReason: row.condemnation_reason,
      condemnation_reason: row.condemnation_reason,
      tableReference: row.table_reference,
      table_reference: row.table_reference,
      isOverridden: row.supervisor_override === 1,
      supervisor_override: row.supervisor_override,
      originalBand: row.original_band,
      original_band: row.original_band,
      overrideBand: row.override_band,
      override_band: row.override_band,
      overrideReason: row.override_reason,
      override_reason: row.override_reason,
      supervisorId: row.override_supervisor_id,
      override_supervisor_id: row.override_supervisor_id,
      supervisorName: row.override_supervisor_name,
      override_supervisor_name: row.override_supervisor_name,
      otpTokenRef: row.otp_token_ref,
      otp_token_ref: row.otp_token_ref,
      measurementSource: row.measurement_source,
      measurement_source: row.measurement_source,
      ocrConfidence: row.ocr_confidence,
      ocr_confidence: row.ocr_confidence,
      ocrImageRef: row.ocr_image_ref,
      ocr_image_ref: row.ocr_image_ref,
      syncStatus: 'SYNCED',
      synced_at: row.synced_at,
      auditHash: row.audit_hash
    };
  }
}
