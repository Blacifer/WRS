/**
 * Component Health Passports & Serialization Repository
 * Indian Railways WRS Raipur (Phase 3 - R4)
 *
 * High-performance Data Access Object for serialized rolling stock components:
 * - Dual-table schema: `components` (current state) + `component_history` (immutable audit trail)
 * - RDSO G-95 health score degradation & status calculation matrix
 * - Multi-criteria search, pagination, QR/RFID lookup, and wagon assignment
 */

import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import type {
  SerializedComponent,
  SerializedComponentType,
  ComponentStatus,
  ComponentHealthStatus,
  ComponentEventType,
  ComponentHistoryEvent,
  CASNUBCategory,
  RegisterComponentRequest,
  AssignComponentRequest,
  UnassignComponentRequest,
  ComponentFilter,
  ComponentStats
} from '../../../shared/types.ts';

export function calculateHealthStatus(score: number): ComponentHealthStatus {
  const normalized = Math.max(0.0, Math.min(100.0, Number(score) || 0.0));
  if (normalized >= 90.0) return 'EXCELLENT';
  if (normalized >= 75.0) return 'GOOD';
  if (normalized >= 60.0) return 'FAIR';
  if (normalized >= 40.0) return 'ATTENTION_REQUIRED';
  return 'CRITICAL';
}

export function deriveCategoryAndPartName(
  type: SerializedComponentType,
  customCategory?: CASNUBCategory,
  customPartName?: string
): { category: CASNUBCategory; partName: string } {
  if (customCategory && customPartName) {
    return { category: customCategory, partName: customPartName };
  }

  const defaults: Record<SerializedComponentType, { category: CASNUBCategory; partName: string }> = {
    WHEELSET: {
      category: 'WHEELS_AXLES',
      partName: 'CASNUB Wheelset Assembly 1000mm (Forged Solid Wheels & Axle)'
    },
    BEARING: {
      category: 'BEARINGS',
      partName: 'Class E (6"x11") CTRB Cartridge Tapered Roller Bearing'
    },
    DRAFT_GEAR: {
      category: 'COUPLERS_DRAFT_GEAR',
      partName: 'Mark-50 High Capacity Friction Draft Gear'
    },
    BOGIE_FRAME_BOLSTER: {
      category: 'BOGIE_FRAME_BOLSTER',
      partName: 'CASNUB 22NLB Cast Steel Bolster & Side Frame'
    },
    BRAKE_VALVE: {
      category: 'BRAKE_SYSTEM',
      partName: 'Distributor Valve (DV) Type 02-ABR-02 Graduated Release'
    },
    COUPLER: {
      category: 'COUPLERS_DRAFT_GEAR',
      partName: 'AAR Type E/F High Tensile Center Buffer Coupler (CBC)'
    },
    FRICTION_WEDGE: {
      category: 'FRICTION_WEDGES',
      partName: 'CASNUB Cast Iron Snubber Friction Wedge'
    }
  };

  const matched = defaults[type] || {
    category: 'BODY_UNDERFRAME' as CASNUBCategory,
    partName: `${type} Assembly`
  };

  return {
    category: customCategory || matched.category,
    partName: customPartName || matched.partName
  };
}

export class ComponentRepository {
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  private mapComponentRow(row: Record<string, unknown>): SerializedComponent {
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
      currentBogiePosition: (row.current_bogie_position as SerializedComponent['currentBogiePosition']) || 'NONE',
      manufacturingDate: row.manufacturing_date as string,
      manufacturer: row.manufacturer as string,
      totalKmTravelled: Number(row.total_km_travelled ?? 0.0),
      overhaulCount: Number(row.overhaul_count ?? 0),
      // What the yellow paint on the end cap screws encodes.
      rohCyclesSincePoh: Number(row.roh_cycles_since_poh ?? 0),
      lastPohDate: (row.last_poh_date as string) || undefined,
      nextPohDue: (row.next_poh_due as string) || undefined,
      healthScore: Number(row.health_score ?? 100.0),
      healthStatus: (row.health_status as ComponentHealthStatus) || calculateHealthStatus(Number(row.health_score ?? 100.0)),
      binLocation: (row.bin_location as string) || undefined,
      createdAt: (row.created_at as string) || undefined,
      updatedAt: (row.updated_at as string) || undefined
    };
  }

  private mapHistoryRow(row: Record<string, unknown>): ComponentHistoryEvent {
    return {
      id: row.id as string,
      componentId: row.component_id as string,
      serialNumber: row.serial_number as string,
      eventType: row.event_type as ComponentEventType,
      wagonNumber: (row.wagon_number as string) || undefined,
      stage: (row.stage as string) || undefined,
      actionDetails: row.action_details as string,
      performedBy: row.performed_by as string,
      performerName: row.performer_name as string,
      notes: (row.notes as string) || undefined,
      createdAt: row.created_at as string
    };
  }

  /**
   * Register a new serialized component in the passport ledger.
   */
  public registerComponent(
    data: RegisterComponentRequest & { qrCode?: string },
    userId = 'SYSTEM',
    userName = 'System Operator'
  ): SerializedComponent {
    const serialNumber = (data.serialNumber || '').trim().toUpperCase();
    if (!serialNumber) {
      throw new Error('SERIAL_NUMBER_REQUIRED: serialNumber is required and cannot be empty.');
    }

    if (!data.componentType) {
      throw new Error('COMPONENT_TYPE_REQUIRED: componentType is required.');
    }

    const existing = this.db.prepare('SELECT id FROM components WHERE UPPER(serial_number) = ?').get(serialNumber);
    if (existing) {
      throw new Error(`COMPONENT_ALREADY_EXISTS: Serial number "${serialNumber}" is already registered.`);
    }

    const { category, partName } = deriveCategoryAndPartName(data.componentType, data.category, data.partName);
    const id = `comp_${crypto.randomUUID()}`;
    const manufacturer = data.manufacturer?.trim() || 'Indian Railways WRS Raipur';
    const manufacturingDate = data.manufacturingDate || new Date().toISOString().slice(0, 10);
    const qrCode = data.qrCode || `WRS-PASSPORT|${serialNumber}|${data.componentType}|${manufacturer.replace(/\s+/g, '_')}`;
    const rfidTag = data.rfidTag?.trim() || null;
    const currentWagonNumber = data.wagonNumber ? data.wagonNumber.trim().toUpperCase() : null;
    const currentBogiePosition = data.bogiePosition || 'NONE';
    const status: ComponentStatus = data.initialStatus || (currentWagonNumber ? 'IN_SERVICE' : 'AVAILABLE_IN_STORES');
    const totalKmTravelled = Number(data.totalKmTravelled ?? 0.0);
    const healthScore = Math.max(0.0, Math.min(100.0, Number(data.healthScore ?? 100.0)));
    const healthStatus = calculateHealthStatus(healthScore);
    const binLocation = data.binLocation || (currentWagonNumber ? null : 'BIN-MAIN-01');
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO components (
        id, serial_number, component_type, category, part_name, qr_code, rfid_tag,
        status, current_wagon_number, current_bogie_position, manufacturing_date,
        manufacturer, total_km_travelled, overhaul_count, last_poh_date, next_poh_due,
        health_score, health_status, bin_location, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?, ?, ?, ?)
    `).run(
      id,
      serialNumber,
      data.componentType,
      category,
      partName,
      qrCode,
      rfidTag,
      status,
      currentWagonNumber,
      currentBogiePosition,
      manufacturingDate,
      manufacturer,
      totalKmTravelled,
      healthScore,
      healthStatus,
      binLocation,
      now,
      now
    );

    return this.getComponentBySerial(serialNumber, false)!;
  }

  /**
   * Retrieve component by serial number, including full lifecycle history by default.
   */
  public getComponentBySerial(
    serialNumber: string,
    includeHistory = true
  ): (SerializedComponent & { history: ComponentHistoryEvent[] }) | null {
    if (!serialNumber) return null;
    const normalized = serialNumber.trim().toUpperCase();

    const row = this.db.prepare(`
      SELECT * FROM components WHERE UPPER(TRIM(serial_number)) = ?
    `).get(normalized) as Record<string, unknown> | undefined;

    if (!row) return null;

    const component = this.mapComponentRow(row);
    let history: ComponentHistoryEvent[] = [];

    if (includeHistory) {
      const historyRows = this.db.prepare(`
        SELECT * FROM component_history
        WHERE UPPER(TRIM(serial_number)) = ? OR component_id = ?
        ORDER BY created_at DESC
      `).all(normalized, component.id) as Record<string, unknown>[];

      history = historyRows.map(r => this.mapHistoryRow(r));
    }

    return {
      ...component,
      history
    };
  }

  public getComponentBySerialNumber(
    serialNumber: string,
    includeHistory = true
  ): (SerializedComponent & { history: ComponentHistoryEvent[] }) | null {
    return this.getComponentBySerial(serialNumber, includeHistory);
  }

  public getComponentById(
    id: string,
    includeHistory = true
  ): (SerializedComponent & { history: ComponentHistoryEvent[] }) | null {
    if (!id) return null;

    const row = this.db.prepare(`
      SELECT * FROM components WHERE id = ?
    `).get(id) as Record<string, unknown> | undefined;

    if (!row) return null;

    const component = this.mapComponentRow(row);
    let history: ComponentHistoryEvent[] = [];

    if (includeHistory) {
      const historyRows = this.db.prepare(`
        SELECT * FROM component_history
        WHERE component_id = ? OR UPPER(TRIM(serial_number)) = ?
        ORDER BY created_at DESC
      `).all(component.id, component.serialNumber.toUpperCase()) as Record<string, unknown>[];

      history = historyRows.map(r => this.mapHistoryRow(r));
    }

    return {
      ...component,
      history
    };
  }

  /**
   * Retrieve component by scanned QR Code or parsed embedded serial number.
   */
  public getComponentByQR(
    qrCode: string,
    includeHistory = true
  ): (SerializedComponent & { history: ComponentHistoryEvent[] }) | null {
    if (!qrCode) return null;
    const trimmed = qrCode.trim();

    // 1. Exact match on qr_code column
    let row = this.db.prepare(`
      SELECT * FROM components WHERE qr_code = ?
    `).get(trimmed) as Record<string, unknown> | undefined;

    // 2. Direct match on serial_number
    if (!row) {
      row = this.db.prepare(`
        SELECT * FROM components WHERE UPPER(TRIM(serial_number)) = ?
      `).get(trimmed.toUpperCase()) as Record<string, unknown> | undefined;
    }

    // 3. Structured QR payload parsing: e.g. WRS-PASSPORT|<SERIAL>|<TYPE>|<MFR> or WRSRP-COMP:<SERIAL>
    if (!row) {
      if (trimmed.includes('|')) {
        const parts = trimmed.split('|');
        if (parts.length >= 2) {
          const serialCandidate = parts[1].trim().toUpperCase();
          row = this.db.prepare(`
            SELECT * FROM components WHERE UPPER(TRIM(serial_number)) = ?
          `).get(serialCandidate) as Record<string, unknown> | undefined;
        }
      } else if (trimmed.includes(':')) {
        const parts = trimmed.split(':');
        if (parts.length >= 2) {
          const serialCandidate = parts[1].trim().toUpperCase();
          row = this.db.prepare(`
            SELECT * FROM components WHERE UPPER(TRIM(serial_number)) = ?
          `).get(serialCandidate) as Record<string, unknown> | undefined;
        }
      }
    }

    if (!row) return null;

    const component = this.mapComponentRow(row);
    let history: ComponentHistoryEvent[] = [];

    if (includeHistory) {
      const historyRows = this.db.prepare(`
        SELECT * FROM component_history
        WHERE component_id = ? OR UPPER(TRIM(serial_number)) = ?
        ORDER BY created_at DESC
      `).all(component.id, component.serialNumber.toUpperCase()) as Record<string, unknown>[];

      history = historyRows.map(r => this.mapHistoryRow(r));
    }

    return {
      ...component,
      history
    };
  }

  public getComponentByQrCode(
    qrCode: string,
    includeHistory = true
  ): (SerializedComponent & { history: ComponentHistoryEvent[] }) | null {
    return this.getComponentByQR(qrCode, includeHistory);
  }

  /**
   * Retrieve all components currently mounted on a specified wagon.
   */
  public getComponentsByWagon(wagonNumber: string): SerializedComponent[] {
    if (!wagonNumber) return [];
    const normalized = wagonNumber.trim().toUpperCase();

    const rows = this.db.prepare(`
      SELECT * FROM components
      WHERE UPPER(TRIM(current_wagon_number)) = ?
      ORDER BY category ASC, current_bogie_position ASC, part_name ASC
    `).all(normalized) as Record<string, unknown>[];

    return rows.map(r => this.mapComponentRow(r));
  }

  /**
   * Query serialized components with multi-criteria filtering and pagination.
   */
  public getComponents(filter: ComponentFilter = {}): {
    components: SerializedComponent[];
    pagination: { total: number; page: number; limit: number; pages: number };
  } {
    const conditions: string[] = ['1=1'];
    const params: unknown[] = [];

    if (filter.componentType && filter.componentType !== 'ALL') {
      conditions.push('component_type = ?');
      params.push(filter.componentType);
    }

    if (filter.status && filter.status !== 'ALL') {
      conditions.push('status = ?');
      params.push(filter.status);
    }

    if (filter.category && filter.category !== 'ALL') {
      conditions.push('category = ?');
      params.push(filter.category);
    }

    if (filter.healthStatus && filter.healthStatus !== 'ALL') {
      conditions.push('health_status = ?');
      params.push(filter.healthStatus);
    }

    if (filter.wagonNumber) {
      conditions.push('UPPER(TRIM(current_wagon_number)) = ?');
      params.push(filter.wagonNumber.trim().toUpperCase());
    }

    if (filter.search && filter.search.trim() !== '') {
      const term = `%${filter.search.trim()}%`;
      conditions.push(`(
        serial_number LIKE ? OR
        part_name LIKE ? OR
        manufacturer LIKE ? OR
        qr_code LIKE ? OR
        rfid_tag LIKE ? OR
        current_wagon_number LIKE ? OR
        bin_location LIKE ?
      )`);
      params.push(term, term, term, term, term, term, term);
    }

    const whereSql = conditions.join(' AND ');

    // Total Count
    const countRow = this.db.prepare(`
      SELECT COUNT(*) as total FROM components WHERE ${whereSql}
    `).get(...params) as { total: number };
    const total = countRow ? countRow.total : 0;

    // Sorting & Pagination
    const page = Math.max(1, Number(filter.page) || 1);
    const limit = Math.min(500, Math.max(1, Number(filter.limit) || 50));
    const offset = (page - 1) * limit;

    const validSortCols: Record<string, string> = {
      serial_number: 'serial_number',
      manufacturing_date: 'manufacturing_date',
      health_score: 'health_score',
      created_at: 'created_at',
      updated_at: 'updated_at',
      part_name: 'part_name'
    };

    const sortBy = validSortCols[filter.sortBy || 'updated_at'] || 'updated_at';
    const sortOrder = (filter.sortOrder || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const rows = this.db.prepare(`
      SELECT * FROM components
      WHERE ${whereSql}
      ORDER BY ${sortBy} ${sortOrder}
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as Record<string, unknown>[];

    const components = rows.map(r => this.mapComponentRow(r));
    const pages = Math.ceil(total / limit) || 1;

    return {
      components,
      pagination: {
        total,
        page,
        limit,
        pages
      }
    };
  }

  public queryComponents(filter: ComponentFilter = {}) {
    return this.getComponents(filter);
  }

  /**
   * Assign or transfer a component to a wagon.
   */
  public assignComponent(
    serialNumber: string,
    wagonNumber: string,
    bogiePosition = 'NONE',
    stage?: string,
    notes?: string,
    userId = 'SYSTEM',
    userName = 'System Operator'
  ): SerializedComponent {
    const component = this.getComponentBySerial(serialNumber, false);
    if (!component) {
      throw new Error(`COMPONENT_NOT_FOUND: Serialized component "${serialNumber}" not found.`);
    }

    const normalizedWagonNumber = wagonNumber.trim().toUpperCase();
    const now = new Date().toISOString();

    // Update component current wagon and bogie position
    // (The SQLite trigger trg_auto_log_component_assignment_update records the event)
    this.db.prepare(`
      UPDATE components
      SET current_wagon_number = ?,
          current_bogie_position = ?,
          status = 'IN_SERVICE',
          bin_location = NULL,
          updated_at = ?
      WHERE id = ?
    `).run(
      normalizedWagonNumber,
      bogiePosition || 'NONE',
      now,
      component.id
    );

    // If explicit user details or custom notes are passed, supplement or update the trigger log
    if (notes || stage || userId !== 'SYSTEM') {
      this.recordMaintenanceEvent(
        component.serialNumber,
        'ASSIGNED_TO_WAGON',
        `Assigned to wagon ${normalizedWagonNumber} at position ${bogiePosition}${stage ? ` during ${stage}` : ''}`,
        stage,
        notes,
        userId,
        userName
      );
    }

    return this.getComponentBySerial(serialNumber, false)!;
  }

  public assignToWagon(
    serialNumber: string,
    wagonNumber: string,
    bogiePosition = 'NONE',
    stage?: string,
    notes?: string,
    userId = 'SYSTEM',
    userName = 'System Operator'
  ): SerializedComponent {
    return this.assignComponent(serialNumber, wagonNumber, bogiePosition, stage, notes, userId, userName);
  }

  /**
   * Unassign a component from a wagon.
   */
  public unassignComponent(
    serialNumber: string,
    reason?: string,
    targetStatus: ComponentStatus = 'AVAILABLE_IN_STORES',
    notes?: string,
    userId = 'SYSTEM',
    userName = 'System Operator'
  ): SerializedComponent {
    const component = this.getComponentBySerial(serialNumber, false);
    if (!component) {
      throw new Error(`COMPONENT_NOT_FOUND: Serialized component "${serialNumber}" not found.`);
    }

    const oldWagon = component.currentWagonNumber || 'NONE';
    const now = new Date().toISOString();
    const binLocation = targetStatus === 'AVAILABLE_IN_STORES' ? 'BIN-MAIN-01' : (targetStatus === 'CONDEMNED' ? 'BIN-SCRAP' : 'BIN-MAINT-01');

    this.db.prepare(`
      UPDATE components
      SET current_wagon_number = NULL,
          current_bogie_position = 'NONE',
          status = ?,
          bin_location = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      targetStatus,
      binLocation,
      now,
      component.id
    );

    if (reason || notes || userId !== 'SYSTEM') {
      this.recordMaintenanceEvent(
        component.serialNumber,
        'REMOVED_FROM_WAGON',
        `Unassigned from wagon ${oldWagon}. Reason: ${reason || 'Workshop maintenance re-allocation'}`,
        'REPAIR_REPLACEMENT',
        notes,
        userId,
        userName
      );
    }

    return this.getComponentBySerial(serialNumber, false)!;
  }

  public unassignFromWagon(
    serialNumber: string,
    targetStatus: ComponentStatus = 'AVAILABLE_IN_STORES',
    reason?: string,
    notes?: string,
    userId = 'SYSTEM',
    userName = 'System Operator'
  ): SerializedComponent {
    return this.unassignComponent(serialNumber, reason, targetStatus, notes, userId, userName);
  }

  /**
   * Update component health score and recompute health status.
   */
  public updateHealthScore(
    serialNumber: string,
    healthScore: number,
    notes?: string,
    userId = 'SYSTEM',
    userName = 'System Inspector'
  ): SerializedComponent {
    const component = this.getComponentBySerial(serialNumber, false);
    if (!component) {
      throw new Error(`COMPONENT_NOT_FOUND: Serialized component "${serialNumber}" not found.`);
    }

    const clampedScore = Math.max(0.0, Math.min(100.0, Number(healthScore)));
    const newHealthStatus = calculateHealthStatus(clampedScore);
    const now = new Date().toISOString();

    let newStatus = component.status;
    if (clampedScore === 0.0) {
      newStatus = 'CONDEMNED';
    } else if (clampedScore < 40.0 && component.status === 'AVAILABLE_IN_STORES') {
      newStatus = 'UNDER_MAINTENANCE';
    }

    this.db.prepare(`
      UPDATE components
      SET health_score = ?,
          health_status = ?,
          status = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      clampedScore,
      newHealthStatus,
      newStatus,
      now,
      component.id
    );

    this.recordMaintenanceEvent(
      component.serialNumber,
      'INSPECTED',
      `Health score updated to ${clampedScore.toFixed(1)}% (${newHealthStatus})`,
      'COMPONENT_INSPECTION',
      notes,
      userId,
      userName
    );

    return this.getComponentBySerial(serialNumber, false)!;
  }

  /**
   * Record a maintenance or overhaul event, incrementing overhaul count if applicable.
   */

  /**
   * Records a routine overhaul (ROH) on a component.
   *
   * WMM 2.0 Chapter 6: at each ROH one more end cap screw head is painted
   * golden yellow, so the count of painted screws says how many ROH cycles the
   * bearing has had since its last POH. Recording it here replaces counting
   * paint on a shed floor.
   *
   * The manual describes at most three ROH schedules within a POH cycle, so a
   * fourth is refused rather than silently recorded — a bearing that has
   * apparently had four is a data fault worth surfacing, not a number to keep
   * incrementing.
   */
  public recordRoh(
    serialNumber: string,
    userId: string,
    userName: string,
    notes?: string
  ): SerializedComponent {
    const component = this.getComponentBySerial(serialNumber, false);
    if (!component) {
      throw new Error(`COMPONENT_NOT_FOUND: Serialized component "${serialNumber}" not found.`);
    }

    const current = (component as any).rohCyclesSincePoh ?? 0;
    if (current >= 3) {
      throw new Error(
        `${serialNumber} has already completed ${current} ROH cycles since its last POH. ` +
        `WMM 2.0 describes at most three before POH is due — record a POH, or investigate the record.`
      );
    }

    this.db.prepare(`
      UPDATE components SET roh_cycles_since_poh = roh_cycles_since_poh + 1, updated_at = ? WHERE id = ?
    `).run(new Date().toISOString(), component.id);

    this.recordMaintenanceEvent(
      serialNumber,
      'MAINTENANCE_PERFORMED',
      `Routine overhaul (ROH) recorded. Cycles since last POH: ${current + 1}.`,
      'REPAIR_REPLACEMENT',
      notes,
      userId,
      userName
    );

    return this.getComponentBySerial(serialNumber, false)!;
  }

  public recordOverhaul(
    serialNumber: string,
    pohDate?: string,
    nextPohDue?: string,
    restoredHealthScore = 100.0,
    notes?: string,
    userId = 'SYSTEM',
    userName = 'POH Workshop Engineer'
  ): SerializedComponent {
    const component = this.getComponentBySerial(serialNumber, false);
    if (!component) {
      throw new Error(`COMPONENT_NOT_FOUND: Serialized component "${serialNumber}" not found.`);
    }

    const now = new Date().toISOString();
    const effectivePohDate = pohDate || now.slice(0, 10);
    const effectiveNextPohDue = nextPohDue || new Date(Date.now() + 4.5 * 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const healthScore = Math.max(0.0, Math.min(100.0, restoredHealthScore));
    const healthStatus = calculateHealthStatus(healthScore);

    this.db.prepare(`
      UPDATE components
      SET overhaul_count = overhaul_count + 1,
          -- POH resets the ROH cycle count: the end cap screws are a
          -- must-change item and the new ones go on unpainted.
          roh_cycles_since_poh = 0,
          last_poh_date = ?,
          next_poh_due = ?,
          health_score = ?,
          health_status = ?,
          status = 'RECONDITIONED',
          updated_at = ?
      WHERE id = ?
    `).run(
      effectivePohDate,
      effectiveNextPohDue,
      healthScore,
      healthStatus,
      now,
      component.id
    );

    this.recordMaintenanceEvent(
      component.serialNumber,
      'RECONDITIONED',
      `Periodic Overhaul (POH) performed. Overhaul cycle count: ${component.overhaulCount + 1}. Health restored to ${healthScore}%`,
      'REPAIR_REPLACEMENT',
      notes,
      userId,
      userName
    );

    return this.getComponentBySerial(serialNumber, false)!;
  }

  /**
   * Append a custom lifecycle/maintenance record to the immutable history ledger.
   */
  public recordMaintenanceEvent(
    serialNumber: string,
    eventType: ComponentEventType,
    actionDetails: string,
    stage?: string,
    notes?: string,
    performedBy = 'SYSTEM',
    performerName = 'System Operator'
  ): ComponentHistoryEvent {
    const component = this.getComponentBySerial(serialNumber, false);
    if (!component) {
      throw new Error(`COMPONENT_NOT_FOUND: Serialized component "${serialNumber}" not found.`);
    }

    const id = `cmph_${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO component_history (
        id, component_id, serial_number, event_type, wagon_number,
        stage, action_details, performed_by, performer_name, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      component.id,
      component.serialNumber,
      eventType,
      component.currentWagonNumber,
      stage || null,
      actionDetails,
      performedBy,
      performerName,
      notes || null,
      now
    );

    return {
      id,
      componentId: component.id,
      serialNumber: component.serialNumber,
      eventType,
      wagonNumber: component.currentWagonNumber || undefined,
      stage: stage || undefined,
      actionDetails,
      performedBy,
      performerName,
      notes: notes || undefined,
      createdAt: now
    };
  }

  /**
   * Compute workshop aggregate statistics for components.
   */
  public getComponentStats(): ComponentStats {
    const totalRow = this.db.prepare(`
      SELECT 
        COUNT(*) as total_components,
        SUM(CASE WHEN status = 'AVAILABLE_IN_STORES' THEN 1 ELSE 0 END) as available_in_stores,
        SUM(CASE WHEN status = 'IN_SERVICE' THEN 1 ELSE 0 END) as in_service,
        SUM(CASE WHEN status = 'UNDER_MAINTENANCE' THEN 1 ELSE 0 END) as under_maintenance,
        SUM(CASE WHEN status = 'RECONDITIONED' THEN 1 ELSE 0 END) as reconditioned,
        SUM(CASE WHEN status = 'CONDEMNED' THEN 1 ELSE 0 END) as condemned,
        AVG(health_score) as avg_health_score,
        SUM(CASE WHEN health_status = 'CRITICAL' THEN 1 ELSE 0 END) as critical_count
      FROM components
    `).get() as Record<string, unknown> | undefined;

    const totalComponents = Number(totalRow?.total_components ?? 0);
    const availableInStores = Number(totalRow?.available_in_stores ?? 0);
    const inService = Number(totalRow?.in_service ?? 0);
    const underMaintenance = Number(totalRow?.under_maintenance ?? 0);
    const reconditioned = Number(totalRow?.reconditioned ?? 0);
    const condemned = Number(totalRow?.condemned ?? 0);
    const averageHealthScore = totalComponents > 0 ? Number(Number(totalRow?.avg_health_score ?? 100.0).toFixed(1)) : 100.0;
    const criticalHealthCount = Number(totalRow?.critical_count ?? 0);

    return {
      totalComponents,
      availableInStores,
      inService,
      underMaintenance,
      reconditioned,
      condemned,
      averageHealthScore,
      criticalHealthCount
    };
  }
}
