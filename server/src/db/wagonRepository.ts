/**
 * Wagon Lifecycle, CASNUB Checklist, Gate & Analytics Repository
 * Indian Railways WRS Raipur (Phase 2)
 */

import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import { logAuditEvent } from './auditLog.ts';
import { CASNUB_CHECKLIST_TEMPLATE } from './seed.ts';
import type {
  LifecycleStage,
  CASNUBCategory,
  PartInspectionStatus,
  PartCriticality,
  RepairActionType,
  UserRole,
  BogieType,
  SpringPosition,
  SpringCondition,
  AcousticAnomalyType,
  AcousticDiagnosticResult,
  AcousticDiagnosticRecord,
  ChecklistItem
} from '../../../shared/types.ts';

export interface WagonData {
  id?: string;
  wagonNumber: string;
  wagonType: string;
  owningRailway: string;
  currentStage?: LifecycleStage;
  status?: string;
  entryDate?: string;
  targetReleaseDate?: string | null;
  actualReleaseDate?: string | null;
  entryNotes?: string | null;
  conditionNotes?: string | null;
  createdBy?: string;
}

export interface TransitionData {
  id?: string;
  wagonNumber: string;
  fromStage: LifecycleStage;
  toStage: LifecycleStage;
  transitionType: 'NORMAL' | 'OVERRIDE_SKIP' | 'OVERRIDE_BACKWARD' | 'GATE_SIGNOFF' | 'REOPEN';
  performedBy: string;
  performerName: string;
  performerRole: string;
  isOverride?: boolean;
  overrideReason?: string | null;
  supervisorId?: string | null;
  supervisorName?: string | null;
  otpTokenRef?: string | null;
  notes?: string | null;
  createdAt?: string;
}

export interface ChecklistItemData {
  id?: string;
  wagonNumber: string;
  category: CASNUBCategory;
  partName: string;
  bogiePosition?: string;
  status?: PartInspectionStatus;
  isMandatory?: boolean;
  conditionNotes?: string | null;
  repairAction?: RepairActionType | null;
  repairNotes?: string | null;
  reinspectedStatus?: 'PASS' | 'FAIL' | null;
  inspectorId: string;
  inspectorName: string;
  photoId?: string | null;
  phase1InspectionId?: string | null;
}

export interface ExitGateBlockerDetail {
  id: string;
  category: string;
  partName: string;
  issueType: 'MISSING_INSPECTION' | 'INSPECTION_FAILED' | 'CONDEMNED_UNRESOLVED' | 'REINSPECTION_REQUIRED' | 'SPRING_CONDEMNED' | 'MISSING_SPRINGS' | 'STAGE_INVALID';
  description: string;
  severity: 'CRITICAL_BLOCKER' | 'WARNING';
  remediationAction: string;
}

export class WagonRepository {
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  // -------------------------------------------------------------------------
  // Wagon Master Management
  // -------------------------------------------------------------------------

  public registerWagon(data: WagonData): any {
    const id = data.id || `wagon_${crypto.randomUUID()}`;
    const wagonNumber = data.wagonNumber.trim().toUpperCase();
    const wagonType = (data.wagonType || 'BOXNHL').trim().toUpperCase();
    const owningRailway = (data.owningRailway || 'SECR').trim().toUpperCase();
    const currentStage: LifecycleStage = data.currentStage || 'ENTRY_REGISTRATION';
    const status = data.status || 'IN_PROGRESS';
    const entryDate = data.entryDate || new Date().toISOString();
    const entryNotes = data.entryNotes || data.conditionNotes || null;
    const conditionNotes = data.conditionNotes || data.entryNotes || null;
    const createdBy = data.createdBy || 'usr_insp_001';

    // Ensure createdBy user exists
    const userCheck = this.db.prepare('SELECT id FROM users WHERE id = ?').get(createdBy);
    if (!userCheck) {
      this.db.prepare(`
        INSERT OR IGNORE INTO users (id, username, password_hash, role, full_name, employee_id, is_active)
        VALUES (?, ?, 'none', 'INSPECTOR', 'Inspector', ?, 1)
      `).run(createdBy, `user_${createdBy}`, `EMP-${createdBy}`);
    }

    const stmt = this.db.prepare(`
      INSERT INTO wagons (
        id, wagon_number, wagon_type, owning_railway, current_stage, status,
        entry_date, target_release_date, actual_release_date, entry_notes, condition_notes,
        created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const now = new Date().toISOString();
    stmt.run(
      id, wagonNumber, wagonType, owningRailway, currentStage, status,
      entryDate, data.targetReleaseDate || null, data.actualReleaseDate || null,
      entryNotes, conditionNotes, createdBy, now, now
    );

    // Initial transition record
    const transId = `trans_${crypto.randomUUID()}`;
    this.db.prepare(`
      INSERT INTO wagon_transitions (
        id, wagon_id, wagon_number, from_stage, to_stage, transition_type,
        performed_by, performer_name, performer_role, is_override, override_reason,
        supervisor_id, supervisor_name, otp_token_ref, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, NULL, NULL, ?, ?)
    `).run(
      transId, id, wagonNumber, currentStage, currentStage, 'NORMAL',
      createdBy, 'Intake Inspector', 'INSPECTOR', 'Wagon intake and initial registration', now
    );

    // Initialize default checklist for this wagon
    this.initializeDefaultChecklist(id, wagonNumber, wagonType, createdBy, 'Intake Inspector');

    // Audit log
    logAuditEvent(this.db, {
      eventType: 'WAGON_REGISTERED' as any,
      userId: createdBy,
      userRole: 'INSPECTOR',
      payload: { wagonId: id, wagonNumber, wagonType, owningRailway, entryDate },
      createdAt: now
    });

    return this.getWagonByNumber(wagonNumber);
  }

  public getWagonByNumber(wagonNumber: string): any {
    const row = this.db.prepare(`
      SELECT * FROM wagons WHERE wagon_number = ?
    `).get(wagonNumber.trim().toUpperCase()) as any;

    if (!row) return null;
    return this.mapWagonRow(row);
  }

  public getWagonById(wagonId: string): any {
    const row = this.db.prepare(`
      SELECT * FROM wagons WHERE id = ?
    `).get(wagonId) as any;

    if (!row) return null;
    return this.mapWagonRow(row);
  }

  public queryWagons(params: {
    stage?: string;
    wagonType?: string;
    owningRailway?: string;
    status?: string;
    search?: string;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: string;
  } = {}): { records: any[]; totalCount: number; page: number; limit: number; totalPages: number } {
    const whereClauses: string[] = ['1=1'];
    const bindParams: any[] = [];

    if (params.stage) {
      whereClauses.push('current_stage = ?');
      bindParams.push(params.stage);
    }
    if (params.wagonType) {
      whereClauses.push('wagon_type = ?');
      bindParams.push(params.wagonType);
    }
    if (params.owningRailway) {
      whereClauses.push('owning_railway = ?');
      bindParams.push(params.owningRailway);
    }
    if (params.status) {
      whereClauses.push('status = ?');
      bindParams.push(params.status);
    }
    if (params.search) {
      whereClauses.push('(wagon_number LIKE ? OR entry_notes LIKE ?)');
      bindParams.push(`%${params.search.trim()}%`, `%${params.search.trim()}%`);
    }

    const whereSql = whereClauses.join(' AND ');

    const countRow = this.db.prepare(`SELECT COUNT(*) as total FROM wagons WHERE ${whereSql}`).get(...bindParams) as { total: number };
    const totalCount = countRow ? countRow.total : 0;

    const page = Math.max(1, params.page || 1);
    const limit = Math.min(500, Math.max(1, params.limit || 50));
    const offset = (page - 1) * limit;

    const validSortCols: Record<string, string> = {
      entryDate: 'entry_date',
      entry_date: 'entry_date',
      wagonNumber: 'wagon_number',
      wagon_number: 'wagon_number',
      currentStage: 'current_stage',
      current_stage: 'current_stage',
      status: 'status',
      createdAt: 'created_at',
      created_at: 'created_at'
    };

    const sortBy = validSortCols[params.sortBy || 'entry_date'] || 'entry_date';
    const sortOrder = (params.sortOrder || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const rows = this.db.prepare(`
      SELECT * FROM wagons
      WHERE ${whereSql}
      ORDER BY ${sortBy} ${sortOrder}
      LIMIT ? OFFSET ?
    `).all(...bindParams, limit, offset) as any[];

    const records = rows.map(r => this.mapWagonRow(r));
    const totalPages = Math.ceil(totalCount / limit) || 1;

    return { records, totalCount, page, limit, totalPages };
  }

  // -------------------------------------------------------------------------
  // Lifecycle State Machine & Transitions
  // -------------------------------------------------------------------------

  public recordTransition(data: TransitionData): any {
    const wagon = this.getWagonByNumber(data.wagonNumber);
    if (!wagon) {
      throw new Error(`Wagon ${data.wagonNumber} not found.`);
    }

    const id = data.id || `trans_${crypto.randomUUID()}`;
    const now = data.createdAt || new Date().toISOString();
    const isOverride = data.isOverride ? 1 : 0;

    // Ensure performer exists
    const userCheck = this.db.prepare('SELECT id FROM users WHERE id = ?').get(data.performedBy);
    if (!userCheck) {
      this.db.prepare(`
        INSERT OR IGNORE INTO users (id, username, password_hash, role, full_name, employee_id, is_active)
        VALUES (?, ?, 'none', ?, ?, ?, 1)
      `).run(data.performedBy, `user_${data.performedBy}`, data.performerRole || 'INSPECTOR', data.performerName || 'User', `EMP-${data.performedBy}`);
    }

    // Insert transition
    this.db.prepare(`
      INSERT INTO wagon_transitions (
        id, wagon_id, wagon_number, from_stage, to_stage, transition_type,
        performed_by, performer_name, performer_role, is_override, override_reason,
        supervisor_id, supervisor_name, otp_token_ref, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, wagon.id, wagon.wagonNumber, data.fromStage, data.toStage, data.transitionType,
      data.performedBy, data.performerName, data.performerRole, isOverride,
      data.overrideReason || null, data.supervisorId || null, data.supervisorName || null,
      data.otpTokenRef || null, data.notes || null, now
    );

    // Update wagon current_stage
    const actualReleaseDate = data.toStage === 'RELEASE' ? now : (data.fromStage === 'RELEASE' ? null : wagon.actualReleaseDate);
    const wagonStatus = data.toStage === 'RELEASE' ? 'RELEASED' : 'IN_PROGRESS';

    this.db.prepare(`
      UPDATE wagons
      SET current_stage = ?, status = ?, actual_release_date = ?, updated_at = ?
      WHERE id = ?
    `).run(data.toStage, wagonStatus, actualReleaseDate, now, wagon.id);

    // Log to audit trail
    logAuditEvent(this.db, {
      eventType: 'WAGON_STAGE_TRANSITION' as any,
      userId: data.performedBy,
      userRole: data.performerRole,
      payload: {
        transitionId: id,
        wagonNumber: wagon.wagonNumber,
        fromStage: data.fromStage,
        toStage: data.toStage,
        transitionType: data.transitionType,
        isOverride: Boolean(isOverride),
        overrideReason: data.overrideReason
      },
      createdAt: now
    });

    return {
      id,
      wagonId: wagon.id,
      wagonNumber: wagon.wagonNumber,
      fromStage: data.fromStage,
      toStage: data.toStage,
      transitionType: data.transitionType,
      performedBy: data.performedBy,
      performerName: data.performerName,
      performerRole: data.performerRole,
      isOverride: Boolean(isOverride),
      overrideReason: data.overrideReason || null,
      supervisorId: data.supervisorId || null,
      supervisorName: data.supervisorName || null,
      otpTokenRef: data.otpTokenRef || null,
      notes: data.notes || null,
      createdAt: now
    };
  }

  public getWagonTimeline(wagonNumber: string): any[] {
    const rows = this.db.prepare(`
      SELECT * FROM wagon_transitions
      WHERE wagon_number = ?
      ORDER BY created_at ASC
    `).all(wagonNumber.trim().toUpperCase()) as any[];

    const transitions = rows.map((r, index) => {
      let durationHours = 0;
      if (index < rows.length - 1) {
        const nextTime = new Date(rows[index + 1].created_at).getTime();
        const curTime = new Date(r.created_at).getTime();
        durationHours = Math.max(0, Math.round(((nextTime - curTime) / (1000 * 60 * 60)) * 10) / 10);
      } else {
        const curTime = new Date(r.created_at).getTime();
        const now = Date.now();
        durationHours = Math.max(0, Math.round(((now - curTime) / (1000 * 60 * 60)) * 10) / 10);
      }

      return {
        id: r.id,
        wagonId: r.wagon_id,
        wagon_id: r.wagon_id,
        wagonNumber: r.wagon_number,
        wagon_number: r.wagon_number,
        fromStage: r.from_stage,
        from_stage: r.from_stage,
        toStage: r.to_stage,
        to_stage: r.to_stage,
        transitionType: r.transition_type,
        transition_type: r.transition_type,
        performedBy: r.performed_by,
        performed_by: r.performed_by,
        performerName: r.performer_name,
        performer_name: r.performer_name,
        performerRole: r.performer_role,
        performer_role: r.performer_role,
        isOverride: r.is_override === 1,
        is_override: r.is_override,
        overrideReason: r.override_reason,
        override_reason: r.override_reason,
        supervisorId: r.supervisor_id,
        supervisor_id: r.supervisor_id,
        supervisorName: r.supervisor_name,
        supervisor_name: r.supervisor_name,
        otpTokenRef: r.otp_token_ref,
        otp_token_ref: r.otp_token_ref,
        notes: r.notes,
        createdAt: r.created_at,
        created_at: r.created_at,
        timestamp: r.created_at,
        durationInStageHours: durationHours
      };
    });

    return transitions;
  }

  // -------------------------------------------------------------------------
  // CASNUB Checklist Management & Phase 1 Spring Integration
  // -------------------------------------------------------------------------

  public initializeDefaultChecklist(
    wagonId: string,
    wagonNumber: string,
    wagonType: string,
    inspectorId: string,
    inspectorName: string
  ): void {
    // Check if checklist configuration exists for this wagon type
    let configRows = this.db.prepare(`
      SELECT * FROM checklist_config WHERE wagon_type = ?
    `).all(wagonType) as any[];

    if (configRows.length === 0) {
      configRows = this.db.prepare(`
        SELECT * FROM checklist_config WHERE wagon_type = 'DEFAULT'
      `).all() as any[];
    }

    // Default 8-category template if no config in DB
    const templateItems: Array<{ category: CASNUBCategory; partName: string; bogiePosition: string; isMandatory: number }> = configRows.length > 0
      ? configRows.map(c => ({
          category: c.category as CASNUBCategory,
          partName: c.part_name,
          bogiePosition: c.bogie_position,
          isMandatory: c.is_mandatory
        }))
      : this.getDefaultRDSOItems();

    const insertStmt = this.db.prepare(`
      INSERT OR IGNORE INTO checklist_items (
        id, wagon_id, wagon_number, category, part_name, bogie_position,
        status, is_mandatory, condition_notes, repair_action, repair_notes,
        reinspected_status, inspector_id, inspector_name, photo_id,
        phase1_inspection_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, NULL, NULL, NULL, NULL, ?, ?, NULL, NULL, ?, ?)
    `);

    const now = new Date().toISOString();
    for (const item of templateItems) {
      const itemId = `chk_${crypto.randomUUID()}`;
      insertStmt.run(
        itemId, wagonId, wagonNumber, item.category, item.partName, item.bogiePosition,
        item.isMandatory, inspectorId, inspectorName, now, now
      );
    }
  }

  public getChecklistItems(wagonNumber: string): any {
    const normalizedWagonNumber = wagonNumber.trim().toUpperCase();
    const rows = this.db.prepare(`
      SELECT * FROM checklist_items WHERE wagon_number = ? ORDER BY category, part_name
    `).all(normalizedWagonNumber) as any[];

    // Sync Phase 1 spring inspection records into Category 1 ('SPRINGS')
    this.syncPhase1SpringsToChecklist(normalizedWagonNumber, rows);

    // Group by category
    const categoriesMap: Record<string, any[]> = {};
    const validCategories: CASNUBCategory[] = [
      'SPRINGS', 'WHEELS_AXLES', 'BEARINGS', 'BRAKE_SYSTEM',
      'COUPLERS_DRAFT_GEAR', 'BOGIE_FRAME_BOLSTER', 'FRICTION_WEDGES', 'BODY_UNDERFRAME'
    ];

    for (const cat of validCategories) {
      categoriesMap[cat] = [];
    }

    for (const row of rows) {
      const item = this.mapChecklistItem(row);
      if (!categoriesMap[item.category]) {
        categoriesMap[item.category] = [];
      }
      categoriesMap[item.category].push(item);
    }

    return {
      wagonNumber: normalizedWagonNumber,
      categories: categoriesMap,
      allItems: rows.map(r => this.mapChecklistItem(r))
    };
  }

  private syncPhase1SpringsToChecklist(wagonNumber: string, checklistRows: any[]): void {
    const springInspections = this.db.prepare(`
      SELECT i.* FROM inspections i
      INNER JOIN (
        SELECT wagon_number, bogie_type, spring_position, MAX(sequence_number) as max_seq
        FROM inspections
        WHERE wagon_number = ?
        GROUP BY wagon_number, bogie_type, spring_position
      ) latest ON i.wagon_number = latest.wagon_number
              AND i.bogie_type = latest.bogie_type
              AND i.spring_position = latest.spring_position
              AND i.sequence_number = latest.max_seq
    `).all(wagonNumber) as any[];

    if (springInspections.length === 0) return;

    for (const row of checklistRows) {
      if (row.category === 'SPRINGS') {
        const matched = springInspections.find(si => {
          const partLower = row.part_name.toLowerCase();
          const posLower = si.spring_position.toLowerCase();
          return partLower.includes(posLower) || (partLower.includes('outer') && posLower.includes('outer'))
            || (partLower.includes('inner') && posLower.includes('inner'))
            || (partLower.includes('snubber') && posLower.includes('snubber'));
        });

        if (matched) {
          row.phase1_inspection_id = matched.id;
          if (matched.status === 'CONDEMNED' && row.status !== 'REPLACED') {
            row.status = 'CONDEMNED';
            row.condition_notes = matched.condemnation_reason || 'Condemned in Phase 1 Spring Classification';
          } else if (matched.status === 'PASS') {
            row.status = 'PASS';
          }
        }
      }
    }
  }

  public upsertChecklistItem(data: ChecklistItemData): any {
    const wagon = this.getWagonByNumber(data.wagonNumber);
    const wagonId = wagon ? wagon.id : `wagon_${crypto.randomUUID()}`;
    const normalizedWagonNumber = data.wagonNumber.trim().toUpperCase();

    // Check if item already exists by wagonNumber, category, partName (and bogiePosition if specified)
    let existing: any = null;
    if (data.bogiePosition && data.bogiePosition !== 'NONE') {
      existing = this.db.prepare(`
        SELECT * FROM checklist_items
        WHERE wagon_number = ? AND category = ? AND part_name = ? AND bogie_position = ?
      `).get(normalizedWagonNumber, data.category, data.partName, data.bogiePosition) as any;
    }
    if (!existing) {
      existing = this.db.prepare(`
        SELECT * FROM checklist_items
        WHERE wagon_number = ? AND category = ? AND part_name = ?
      `).get(normalizedWagonNumber, data.category, data.partName) as any;
    }

    const now = new Date().toISOString();

    if (existing) {
      this.db.prepare(`
        UPDATE checklist_items
        SET status = ?, condition_notes = ?, repair_action = ?, repair_notes = ?,
            reinspected_status = ?, photo_id = ?, inspector_id = ?, inspector_name = ?,
            updated_at = ?
        WHERE id = ?
      `).run(
        data.status || existing.status,
        data.conditionNotes !== undefined ? data.conditionNotes : existing.condition_notes,
        data.repairAction !== undefined ? data.repairAction : existing.repair_action,
        data.repairNotes !== undefined ? data.repairNotes : existing.repair_notes,
        data.reinspectedStatus !== undefined ? data.reinspectedStatus : existing.reinspected_status,
        data.photoId !== undefined ? data.photoId : existing.photo_id,
        data.inspectorId,
        data.inspectorName,
        now,
        existing.id
      );

      return this.getChecklistItemById(existing.id);
    } else {
      const id = data.id || `chk_${crypto.randomUUID()}`;
      this.db.prepare(`
        INSERT INTO checklist_items (
          id, wagon_id, wagon_number, category, part_name, bogie_position,
          status, is_mandatory, condition_notes, repair_action, repair_notes,
          reinspected_status, inspector_id, inspector_name, photo_id,
          phase1_inspection_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, wagonId, normalizedWagonNumber, data.category, data.partName,
        data.bogiePosition || 'NONE', data.status || 'PENDING',
        data.isMandatory !== undefined ? (data.isMandatory ? 1 : 0) : 1,
        data.conditionNotes || null, data.repairAction || null, data.repairNotes || null,
        data.reinspectedStatus || null, data.inspectorId, data.inspectorName,
        data.photoId || null, data.phase1InspectionId || null, now, now
      );

      return this.getChecklistItemById(id);
    }
  }

  public updateChecklistItem(itemId: string, updates: Partial<ChecklistItemData>): any {
    const existing = this.getChecklistItemById(itemId);
    if (!existing) {
      throw new Error(`Checklist item ${itemId} not found.`);
    }

    const now = new Date().toISOString();
    const status = updates.status !== undefined ? updates.status : existing.status;
    const repairAction = updates.repairAction !== undefined ? updates.repairAction : existing.repairAction;
    const repairNotes = updates.repairNotes !== undefined ? updates.repairNotes : existing.repairNotes;
    const reinspectedStatus = updates.reinspectedStatus !== undefined ? updates.reinspectedStatus : existing.reinspectedStatus;
    const conditionNotes = updates.conditionNotes !== undefined ? updates.conditionNotes : existing.conditionNotes;
    const photoId = updates.photoId !== undefined ? updates.photoId : existing.photoId;

    this.db.prepare(`
      UPDATE checklist_items
      SET status = ?, repair_action = ?, repair_notes = ?, reinspected_status = ?,
          condition_notes = ?, photo_id = ?, updated_at = ?
      WHERE id = ?
    `).run(status, repairAction, repairNotes, reinspectedStatus, conditionNotes, photoId, now, itemId);

    return this.getChecklistItemById(itemId);
  }

  public getChecklistItemById(id: string): any {
    const row = this.db.prepare('SELECT * FROM checklist_items WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.mapChecklistItem(row);
  }

  // -------------------------------------------------------------------------
  // Checklist Configuration Management
  // -------------------------------------------------------------------------

  public getChecklistConfig(wagonType?: string): any[] {
    if (wagonType) {
      return this.db.prepare(`
        SELECT * FROM checklist_config WHERE wagon_type = ? ORDER BY category, part_name
      `).all(wagonType) as any[];
    }
    return this.db.prepare(`
      SELECT * FROM checklist_config ORDER BY wagon_type, category, part_name
    `).all() as any[];
  }

  public setChecklistConfig(entry: {
    wagonType: string;
    category: string;
    partName: string;
    bogiePosition?: string;
    isMandatory: boolean;
    standardReference?: string;
  }): void {
    const id = `cfg_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO checklist_config (
        id, wagon_type, category, part_name, bogie_position, is_mandatory, standard_reference, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(wagon_type, category, part_name, bogie_position)
      DO UPDATE SET is_mandatory = excluded.is_mandatory, standard_reference = excluded.standard_reference, updated_at = excluded.updated_at
    `).run(
      id, entry.wagonType, entry.category, entry.partName, entry.bogiePosition || 'NONE',
      entry.isMandatory ? 1 : 0, entry.standardReference || null, now, now
    );
  }

  // -------------------------------------------------------------------------
  // Zero-Defect Exit Gate & Release Certification
  // -------------------------------------------------------------------------

  public evaluateExitGate(wagonNumber: string): {
    canRelease: boolean;
    wagonNumber: string;
    currentStage: LifecycleStage;
    blockers: string[];
    blockerDetails: ExitGateBlockerDetail[];
    summary: {
      totalItems: number;
      totalMandatory: number;
      passedMandatory: number;
      failedMandatory: number;
      totalCondemned: number;
      unaddressedCondemned: number;
      springCheck: {
        totalSprings: number;
        passedSprings: number;
        condemnedSprings: number;
        hasCondemnedSprings: boolean;
      };
      hasSupervisorSignoff: boolean;
    };
  } {
    const normalizedWagonNumber = wagonNumber.trim().toUpperCase();
    const wagon = this.getWagonByNumber(normalizedWagonNumber);
    const blockers: string[] = [];
    const blockerDetails: ExitGateBlockerDetail[] = [];

    const currentStage: LifecycleStage = wagon ? wagon.currentStage : 'ENTRY_REGISTRATION';

    // Query all checklist items
    const checklistData = this.getChecklistItems(normalizedWagonNumber);
    const items: any[] = checklistData.allItems;

    let totalMandatory = 0;
    let passedMandatory = 0;
    let failedMandatory = 0;
    let totalCondemned = 0;
    let unaddressedCondemned = 0;

    for (const item of items) {
      if (item.isMandatory) {
        totalMandatory++;
        if (item.status === 'PASS' || (['REPAIRED', 'REPLACED'].includes(item.status) && item.reinspectedStatus === 'PASS')) {
          passedMandatory++;
        } else if (item.status === 'PENDING') {
          failedMandatory++;
          const msg = `Mandatory component "${item.partName}" (${item.category}) has not been inspected.`;
          blockers.push(msg);
          blockerDetails.push({
            id: item.id,
            category: item.category,
            partName: item.partName,
            issueType: 'MISSING_INSPECTION',
            description: msg,
            severity: 'CRITICAL_BLOCKER',
            remediationAction: 'Perform physical inspection and record status.'
          });
        } else if (item.status === 'FAIL') {
          failedMandatory++;
          const msg = `Mandatory component "${item.partName}" (${item.category}) failed inspection and has not been repaired or replaced.`;
          blockers.push(msg);
          blockerDetails.push({
            id: item.id,
            category: item.category,
            partName: item.partName,
            issueType: 'INSPECTION_FAILED',
            description: msg,
            severity: 'CRITICAL_BLOCKER',
            remediationAction: 'Execute repair or replacement work order.'
          });
        } else if (item.status === 'CONDEMNED') {
          failedMandatory++;
          totalCondemned++;
          unaddressedCondemned++;
          const msg = `Mandatory component "${item.partName}" (${item.category}) is condemned and requires replacement.`;
          blockers.push(msg);
          blockerDetails.push({
            id: item.id,
            category: item.category,
            partName: item.partName,
            issueType: 'CONDEMNED_UNRESOLVED',
            description: msg,
            severity: 'CRITICAL_BLOCKER',
            remediationAction: 'Replace condemned part with new/reconditioned unit and re-inspect.'
          });
        } else if (['REPAIRED', 'REPLACED'].includes(item.status) && item.reinspectedStatus !== 'PASS') {
          failedMandatory++;
          const msg = `Repaired/Replaced component "${item.partName}" (${item.category}) requires re-inspection sign-off.`;
          blockers.push(msg);
          blockerDetails.push({
            id: item.id,
            category: item.category,
            partName: item.partName,
            issueType: 'REINSPECTION_REQUIRED',
            description: msg,
            severity: 'CRITICAL_BLOCKER',
            remediationAction: 'Inspector must certify repaired/replaced part with PASS status.'
          });
        }
      } else {
        // Advisory items
        if (item.status === 'CONDEMNED') {
          totalCondemned++;
          unaddressedCondemned++;
          const msg = `Advisory component "${item.partName}" (${item.category}) is condemned and requires resolution.`;
          blockers.push(msg);
          blockerDetails.push({
            id: item.id,
            category: item.category,
            partName: item.partName,
            issueType: 'CONDEMNED_UNRESOLVED',
            description: msg,
            severity: 'WARNING',
            remediationAction: 'Replace or supervisor approve condemned advisory part.'
          });
        }
      }
    }

    // Check Phase 1 Spring Classification
    const latestSprings = this.db.prepare(`
      SELECT i.* FROM inspections i
      INNER JOIN (
        SELECT wagon_number, bogie_type, spring_position, MAX(sequence_number) as max_seq
        FROM inspections
        WHERE wagon_number = ?
        GROUP BY wagon_number, bogie_type, spring_position
      ) latest ON i.wagon_number = latest.wagon_number
              AND i.bogie_type = latest.bogie_type
              AND i.spring_position = latest.spring_position
              AND i.sequence_number = latest.max_seq
    `).all(normalizedWagonNumber) as any[];

    const springCount = latestSprings.length;
    let springsPassed = 0;
    let springsCondemned = 0;

    for (const sp of latestSprings) {
      if (sp.status === 'PASS') {
        springsPassed++;
      } else if (sp.status === 'CONDEMNED') {
        springsCondemned++;
        const msg = `Condemned spring in Bogie (${sp.bogie_type}, ${sp.spring_position}, ${sp.measured_height}mm). Condemned springs must be replaced.`;
        blockers.push(msg);
        blockerDetails.push({
          id: sp.id,
          category: 'SPRINGS',
          partName: `${sp.bogie_type} ${sp.spring_position}`,
          issueType: 'SPRING_CONDEMNED',
          description: msg,
          severity: 'CRITICAL_BLOCKER',
          remediationAction: 'Replace spring and log a new Phase 1 inspection record.'
        });
      }
    }

    // Check if stage is at FINAL_QC_GATE or RELEASE
    if (currentStage !== 'FINAL_QC_GATE' && currentStage !== 'RELEASE') {
      const msg = `Wagon is at stage "${currentStage}". Wagon must reach Stage 6 (FINAL_QC_GATE) for release.`;
      blockers.push(msg);
      blockerDetails.push({
        id: `stage_blocker`,
        category: 'LIFECYCLE',
        partName: 'Stage Prerequisite',
        issueType: 'STAGE_INVALID',
        description: msg,
        severity: 'CRITICAL_BLOCKER',
        remediationAction: 'Advance wagon through required workshop stages to Stage 6.'
      });
    }

    // Check if supervisor signoff exists
    const signoffRow = this.db.prepare('SELECT id FROM gate_signoffs WHERE wagon_number = ?').get(normalizedWagonNumber);
    const hasSupervisorSignoff = Boolean(signoffRow);

    const canRelease = blockers.length === 0;

    return {
      canRelease,
      wagonNumber: normalizedWagonNumber,
      currentStage,
      blockers,
      blockerDetails,
      summary: {
        totalItems: items.length,
        totalMandatory,
        passedMandatory,
        failedMandatory,
        totalCondemned,
        unaddressedCondemned,
        springCheck: {
          totalSprings: springCount,
          passedSprings: springsPassed,
          condemnedSprings: springsCondemned,
          hasCondemnedSprings: springsCondemned > 0
        },
        hasSupervisorSignoff
      }
    };
  }

  public recordGateSignoff(data: {
    wagonNumber: string;
    supervisorId: string;
    supervisorName: string;
    supervisorEmployeeId: string;
    digitalSignature: string;
    otpTokenRef: string;
    signoffNotes?: string;
    checksSummary: Record<string, unknown>;
  }): any {
    const normalizedWagonNumber = data.wagonNumber.trim().toUpperCase();
    const wagon = this.getWagonByNumber(normalizedWagonNumber);
    if (!wagon) {
      throw new Error(`Wagon ${normalizedWagonNumber} not found.`);
    }

    // Evaluate gate blockers
    const evaluation = this.evaluateExitGate(normalizedWagonNumber);
    if (!evaluation.canRelease && wagon.currentStage !== 'RELEASE') {
      throw new Error(`Cannot sign off release. Blocker evaluation failed: ${evaluation.blockers.join('; ')}`);
    }

    const id = `signoff_${crypto.randomUUID()}`;
    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    const randomSuffix = crypto.randomBytes(2).toString('hex').toUpperCase();
    const certificateNumber = `WRS/QC-REL/${year}/${month}/${randomSuffix}`;

    const canonicalSummary = JSON.stringify({
      wagonNumber: normalizedWagonNumber,
      certificateNumber,
      supervisorId: data.supervisorId,
      timestamp: new Date().toISOString(),
      summary: data.checksSummary
    });
    const certificateHash = crypto.createHash('sha256').update(canonicalSummary).digest('hex');

    // Ensure supervisor user exists
    const userCheck = this.db.prepare('SELECT id FROM users WHERE id = ?').get(data.supervisorId);
    if (!userCheck) {
      this.db.prepare(`
        INSERT OR IGNORE INTO users (id, username, password_hash, role, full_name, employee_id, is_active)
        VALUES (?, ?, 'none', 'SUPERVISOR', ?, ?, 1)
      `).run(data.supervisorId, `sup_${data.supervisorId}`, data.supervisorName, data.supervisorEmployeeId);
    }

    const now = new Date().toISOString();

    // Insert signoff
    this.db.prepare(`
      INSERT INTO gate_signoffs (
        id, wagon_id, wagon_number, supervisor_id, supervisor_name, supervisor_employee_id,
        digital_signature, otp_token_ref, signoff_notes, checks_summary_json,
        certificate_number, certificate_hash, signed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, wagon.id, normalizedWagonNumber, data.supervisorId, data.supervisorName,
      data.supervisorEmployeeId, data.digitalSignature, data.otpTokenRef,
      data.signoffNotes || null, JSON.stringify(data.checksSummary),
      certificateNumber, certificateHash, now
    );

    // Record transition to RELEASE (Stage 7)
    this.recordTransition({
      wagonNumber: normalizedWagonNumber,
      fromStage: wagon.currentStage,
      toStage: 'RELEASE',
      transitionType: 'GATE_SIGNOFF',
      performedBy: data.supervisorId,
      performerName: data.supervisorName,
      performerRole: 'SUPERVISOR',
      notes: `Exit Gate Cleared and Released with Certificate ${certificateNumber}`,
      otpTokenRef: data.otpTokenRef
    });

    return {
      id,
      wagonId: wagon.id,
      wagonNumber: normalizedWagonNumber,
      supervisorId: data.supervisorId,
      supervisorName: data.supervisorName,
      supervisorEmployeeId: data.supervisorEmployeeId,
      digitalSignature: data.digitalSignature,
      otpTokenRef: data.otpTokenRef,
      signoffNotes: data.signoffNotes || null,
      checksSummary: data.checksSummary,
      certificateNumber,
      certificateHash,
      signedAt: now
    };
  }

  public getGateSignoff(wagonNumber: string): any {
    const row = this.db.prepare(`
      SELECT * FROM gate_signoffs WHERE wagon_number = ?
    `).get(wagonNumber.trim().toUpperCase()) as any;

    if (!row) return null;
    return {
      id: row.id,
      wagonId: row.wagon_id,
      wagonNumber: row.wagon_number,
      supervisorId: row.supervisor_id,
      supervisorName: row.supervisor_name,
      supervisorEmployeeId: row.supervisor_employee_id,
      digitalSignature: row.digital_signature,
      otpTokenRef: row.otp_token_ref,
      signoffNotes: row.signoff_notes,
      checksSummary: JSON.parse(row.checks_summary_json || '{}'),
      certificateNumber: row.certificate_number,
      certificateHash: row.certificate_hash,
      signedAt: row.signed_at
    };
  }

  // -------------------------------------------------------------------------
  // Photo Evidence Management
  // -------------------------------------------------------------------------

  public insertPhoto(data: {
    id?: string;
    wagonNumber: string;
    checklistItemId?: string | null;
    category?: string | null;
    partName?: string | null;
    stage?: string | null;
    fileName?: string;
    mimeType?: string;
    fileSize?: number;
    imageData: string;
    inspectorId: string;
    inspectorName: string;
    tags?: string[];
  }): any {
    const id = data.id || `photo_${crypto.randomUUID()}`;
    const wagonNumber = data.wagonNumber.trim().toUpperCase();
    const fileName = data.fileName || `${wagonNumber}_${Date.now()}.jpg`;
    const mimeType = data.mimeType || 'image/jpeg';
    const fileSize = data.fileSize || Buffer.byteLength(data.imageData, 'utf8');
    const tagsJson = JSON.stringify(data.tags || []);
    const now = new Date().toISOString();

    // Ensure inspector user exists
    const userCheck = this.db.prepare('SELECT id FROM users WHERE id = ?').get(data.inspectorId);
    if (!userCheck) {
      this.db.prepare(`
        INSERT OR IGNORE INTO users (id, username, password_hash, role, full_name, employee_id, is_active)
        VALUES (?, ?, 'none', 'INSPECTOR', ?, ?, 1)
      `).run(data.inspectorId, `user_${data.inspectorId}`, data.inspectorName, `EMP-${data.inspectorId}`);
    }

    this.db.prepare(`
      INSERT INTO wagon_photos (
        id, wagon_number, checklist_item_id, category, part_name, stage,
        file_name, mime_type, file_size, image_data, inspector_id,
        inspector_name, tags_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, wagonNumber, data.checklistItemId || null, data.category || null,
      data.partName || null, data.stage || null, fileName, mimeType, fileSize,
      data.imageData, data.inspectorId, data.inspectorName, tagsJson, now
    );

    return this.getPhotoById(id);
  }

  public getPhotosByWagon(wagonNumber: string, category?: string, stage?: string): any[] {
    const whereClauses = ['wagon_number = ?'];
    const bindParams: any[] = [wagonNumber.trim().toUpperCase()];

    if (category) {
      whereClauses.push('category = ?');
      bindParams.push(category);
    }
    if (stage) {
      whereClauses.push('stage = ?');
      bindParams.push(stage);
    }

    const rows = this.db.prepare(`
      SELECT * FROM wagon_photos WHERE ${whereClauses.join(' AND ')} ORDER BY created_at DESC
    `).all(...bindParams) as any[];

    return rows.map(r => this.mapPhotoRow(r));
  }

  public getPhotosByChecklistItem(checklistItemId: string): any[] {
    const rows = this.db.prepare(`
      SELECT * FROM wagon_photos WHERE checklist_item_id = ? ORDER BY created_at DESC
    `).all(checklistItemId) as any[];

    return rows.map(r => this.mapPhotoRow(r));
  }

  public getPhotoById(id: string): any {
    const row = this.db.prepare('SELECT * FROM wagon_photos WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.mapPhotoRow(row);
  }

  // -------------------------------------------------------------------------
  // Analytics & DRM Dashboards
  // -------------------------------------------------------------------------

  public getAnalyticsPipeline(): any {
    const stages: LifecycleStage[] = [
      'ENTRY_REGISTRATION', 'DISMANTLING', 'COMPONENT_INSPECTION',
      'REPAIR_REPLACEMENT', 'REASSEMBLY', 'FINAL_QC_GATE', 'RELEASE'
    ];

    const counts: Record<LifecycleStage, number> = {
      ENTRY_REGISTRATION: 0,
      DISMANTLING: 0,
      COMPONENT_INSPECTION: 0,
      REPAIR_REPLACEMENT: 0,
      REASSEMBLY: 0,
      FINAL_QC_GATE: 0,
      RELEASE: 0
    };

    const rows = this.db.prepare(`
      SELECT current_stage, COUNT(*) as count
      FROM wagons
      GROUP BY current_stage
    `).all() as Array<{ current_stage: LifecycleStage; count: number }>;

    for (const r of rows) {
      if (r.current_stage in counts) {
        counts[r.current_stage] = r.count;
      }
    }

    let totalActive = 0;
    for (const stage of stages) {
      if (stage !== 'RELEASE') {
        totalActive += counts[stage];
      }
    }

    const totalReleased = counts.RELEASE;

    return {
      counts,
      totalActive,
      totalReleased,
      timestamp: new Date().toISOString()
    };
  }

  public getAnalyticsTAT(): any {
    const rows = this.db.prepare(`
      SELECT entry_date, actual_release_date
      FROM wagons
      WHERE current_stage = 'RELEASE' AND actual_release_date IS NOT NULL
    `).all() as Array<{ entry_date: string; actual_release_date: string }>;

    if (rows.length === 0) {
      return {
        averageHours: 0,
        medianHours: 0,
        minHours: 0,
        maxHours: 0,
        p90Hours: 0,
        completedWagonsCount: 0,
        trends: []
      };
    }

    const durations: number[] = [];
    const trendMap: Record<string, { totalHours: number; count: number }> = {};

    for (const r of rows) {
      const entryTime = new Date(r.entry_date).getTime();
      const releaseTime = new Date(r.actual_release_date).getTime();
      const hours = Math.max(0, (releaseTime - entryTime) / (1000 * 60 * 60));
      durations.push(hours);

      const period = r.actual_release_date.slice(0, 10);
      if (!trendMap[period]) {
        trendMap[period] = { totalHours: 0, count: 0 };
      }
      trendMap[period].totalHours += hours;
      trendMap[period].count += 1;
    }

    durations.sort((a, b) => a - b);
    const sum = durations.reduce((acc, v) => acc + v, 0);
    const averageHours = Math.round((sum / durations.length) * 10) / 10;
    const medianHours = Math.round(durations[Math.floor(durations.length / 2)] * 10) / 10;
    const minHours = Math.round(durations[0] * 10) / 10;
    const maxHours = Math.round(durations[durations.length - 1] * 10) / 10;
    const p90Index = Math.min(durations.length - 1, Math.floor(durations.length * 0.9));
    const p90Hours = Math.round(durations[p90Index] * 10) / 10;

    const trends = Object.entries(trendMap).map(([period, data]) => ({
      period,
      avgHours: Math.round((data.totalHours / data.count) * 10) / 10,
      count: data.count
    })).sort((a, b) => a.period.localeCompare(b.period));

    return {
      averageHours,
      medianHours,
      minHours,
      maxHours,
      p90Hours,
      completedWagonsCount: durations.length,
      trends
    };
  }

  public getAnalyticsThroughput(): any {
    const entryRows = this.db.prepare(`
      SELECT substr(entry_date, 1, 10) as dt, COUNT(*) as cnt
      FROM wagons
      GROUP BY dt
      ORDER BY dt DESC
      LIMIT 30
    `).all() as Array<{ dt: string; cnt: number }>;

    const releaseRows = this.db.prepare(`
      SELECT substr(actual_release_date, 1, 10) as dt, COUNT(*) as cnt
      FROM wagons
      WHERE current_stage = 'RELEASE' AND actual_release_date IS NOT NULL
      GROUP BY dt
      ORDER BY dt DESC
      LIMIT 30
    `).all() as Array<{ dt: string; cnt: number }>;

    const entryMap: Record<string, number> = {};
    for (const r of entryRows) entryMap[r.dt] = r.cnt;

    const releaseMap: Record<string, number> = {};
    for (const r of releaseRows) releaseMap[r.dt] = r.cnt;

    const allDates = Array.from(new Set([...Object.keys(entryMap), ...Object.keys(releaseMap)])).sort();

    const daily = allDates.map(date => ({
      date,
      entered: entryMap[date] || 0,
      released: releaseMap[date] || 0
    }));

    return {
      daily,
      weekly: daily.slice(-7),
      monthly: daily
    };
  }

  public getAnalyticsParts(): any {
    const validCategories: CASNUBCategory[] = [
      'SPRINGS', 'WHEELS_AXLES', 'BEARINGS', 'BRAKE_SYSTEM',
      'COUPLERS_DRAFT_GEAR', 'BOGIE_FRAME_BOLSTER', 'FRICTION_WEDGES', 'BODY_UNDERFRAME'
    ];

    const categoryBreakdown: Record<string, any> = {};
    for (const cat of validCategories) {
      categoryBreakdown[cat] = {
        total: 0,
        pass: 0,
        fail: 0,
        condemned: 0,
        repaired: 0,
        replaced: 0
      };
    }

    const rows = this.db.prepare(`
      SELECT category, status, COUNT(*) as count
      FROM checklist_items
      GROUP BY category, status
    `).all() as Array<{ category: string; status: string; count: number }>;

    let totalInspected = 0;
    let totalPassed = 0;
    let totalFailed = 0;
    let totalCondemned = 0;
    let totalRepaired = 0;
    let totalReplaced = 0;

    for (const r of rows) {
      if (categoryBreakdown[r.category]) {
        categoryBreakdown[r.category].total += r.count;
        totalInspected += r.count;

        if (r.status === 'PASS') {
          categoryBreakdown[r.category].pass += r.count;
          totalPassed += r.count;
        } else if (r.status === 'FAIL') {
          categoryBreakdown[r.category].fail += r.count;
          totalFailed += r.count;
        } else if (r.status === 'CONDEMNED') {
          categoryBreakdown[r.category].condemned += r.count;
          totalCondemned += r.count;
        } else if (r.status === 'REPAIRED') {
          categoryBreakdown[r.category].repaired += r.count;
          totalRepaired += r.count;
        } else if (r.status === 'REPLACED') {
          categoryBreakdown[r.category].replaced += r.count;
          totalReplaced += r.count;
        }
      }
    }

    return {
      totalInspected,
      totalPassed,
      totalFailed,
      totalCondemned,
      totalRepaired,
      totalReplaced,
      categoryBreakdown
    };
  }

  public getAnalyticsInspectors(): any {
    const rows = this.db.prepare(`
      SELECT 
        inspector_id,
        inspector_name,
        COUNT(*) as total,
        SUM(CASE WHEN status = 'PASS' THEN 1 ELSE 0 END) as passed,
        SUM(CASE WHEN status = 'FAIL' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'CONDEMNED' THEN 1 ELSE 0 END) as condemned
      FROM checklist_items
      GROUP BY inspector_id, inspector_name
      ORDER BY total DESC
    `).all() as Array<{
      inspector_id: string;
      inspector_name: string;
      total: number;
      passed: number;
      failed: number;
      condemned: number;
    }>;

    return {
      inspectors: rows.map(r => ({
        inspectorId: r.inspector_id,
        inspectorName: r.inspector_name,
        inspectionsCompleted: r.total,
        partsPassed: r.passed,
        partsFailed: r.failed,
        partsCondemned: r.condemned
      }))
    };
  }

  public getAnalyticsBlockers(): any {
    const wagons = this.db.prepare(`
      SELECT wagon_number, wagon_type, current_stage, entry_date
      FROM wagons
      WHERE current_stage != 'RELEASE'
    `).all() as Array<{
      wagon_number: string;
      wagon_type: string;
      current_stage: LifecycleStage;
      entry_date: string;
    }>;

    const blockedWagons: any[] = [];
    for (const w of wagons) {
      const evaluation = this.evaluateExitGate(w.wagon_number);
      if (!evaluation.canRelease && evaluation.blockers.length > 0) {
        blockedWagons.push({
          wagonNumber: w.wagon_number,
          wagonType: w.wagon_type,
          currentStage: w.current_stage,
          blockers: evaluation.blockers,
          blockerDetails: evaluation.blockerDetails,
          entryDate: w.entry_date
        });
      }
    }

    return { blockedWagons };
  }

  // -------------------------------------------------------------------------
  // Mappers & Helpers
  // -------------------------------------------------------------------------

  private mapWagonRow(row: any): any {
    const totalElapsedHours = row.entry_date
      ? Math.max(0, Math.round(((Date.now() - new Date(row.entry_date).getTime()) / (1000 * 60 * 60)) * 10) / 10)
      : 0;

    return {
      id: row.id,
      wagonNumber: row.wagon_number,
      wagon_number: row.wagon_number,
      wagonType: row.wagon_type,
      wagon_type: row.wagon_type,
      owningRailway: row.owning_railway,
      owning_railway: row.owning_railway,
      currentStage: row.current_stage as LifecycleStage,
      current_stage: row.current_stage as LifecycleStage,
      status: row.status,
      entryDate: row.entry_date,
      entry_date: row.entry_date,
      targetReleaseDate: row.target_release_date,
      target_release_date: row.target_release_date,
      actualReleaseDate: row.actual_release_date,
      actual_release_date: row.actual_release_date,
      releaseDate: row.actual_release_date,
      entryNotes: row.entry_notes,
      entry_notes: row.entry_notes,
      conditionNotes: row.condition_notes || row.entry_notes,
      condition_notes: row.condition_notes || row.entry_notes,
      createdBy: row.created_by,
      created_by: row.created_by,
      isReleased: row.current_stage === 'RELEASE',
      createdAt: row.created_at,
      created_at: row.created_at,
      updatedAt: row.updated_at,
      updated_at: row.updated_at,
      totalElapsedHours
    };
  }

  private mapChecklistItem(row: any): any {
    return {
      id: row.id,
      wagonId: row.wagon_id,
      wagon_id: row.wagon_id,
      wagonNumber: row.wagon_number,
      wagon_number: row.wagon_number,
      category: row.category as CASNUBCategory,
      partName: row.part_name,
      part_name: row.part_name,
      bogiePosition: row.bogie_position,
      bogie_position: row.bogie_position,
      status: row.status as PartInspectionStatus,
      isMandatory: row.is_mandatory === 1,
      is_mandatory: row.is_mandatory,
      criticality: row.is_mandatory === 1 ? 'MANDATORY' : 'ADVISORY',
      conditionNotes: row.condition_notes,
      condition_notes: row.condition_notes,
      repairAction: row.repair_action as RepairActionType | null,
      repair_action: row.repair_action as RepairActionType | null,
      repairNotes: row.repair_notes,
      repair_notes: row.repair_notes,
      reinspectedStatus: row.reinspected_status,
      reinspected_status: row.reinspected_status,
      inspectorId: row.inspector_id,
      inspector_id: row.inspector_id,
      inspectorName: row.inspector_name,
      inspector_name: row.inspector_name,
      photoId: row.photo_id,
      photo_id: row.photo_id,
      phase1InspectionId: row.phase1_inspection_id,
      phase1_inspection_id: row.phase1_inspection_id,
      createdAt: row.created_at,
      created_at: row.created_at,
      updatedAt: row.updated_at,
      updated_at: row.updated_at
    };
  }

  private mapPhotoRow(row: any): any {
    let tags: string[] = [];
    try {
      tags = JSON.parse(row.tags_json || '[]');
    } catch {
      tags = [];
    }

    return {
      id: row.id,
      wagonNumber: row.wagon_number,
      wagon_number: row.wagon_number,
      checklistItemId: row.checklist_item_id,
      checklist_item_id: row.checklist_item_id,
      category: row.category,
      partCategory: row.category,
      partName: row.part_name,
      part_name: row.part_name,
      stage: row.stage,
      fileName: row.file_name,
      file_name: row.file_name,
      mimeType: row.mime_type,
      mime_type: row.mime_type,
      fileSize: row.file_size,
      file_size: row.file_size,
      imageData: row.image_data,
      image_data: row.image_data,
      imageBase64: row.image_data,
      inspectorId: row.inspector_id,
      inspector_id: row.inspector_id,
      inspectorName: row.inspector_name,
      inspector_name: row.inspector_name,
      tags,
      timestamp: row.created_at,
      capturedAt: row.created_at,
      createdAt: row.created_at,
      created_at: row.created_at
    };
  }

  // -------------------------------------------------------------------------
  // Phase 3 (M5): Smart Acoustic Bearing & Leak Detection (R3)
  // -------------------------------------------------------------------------

  public recordAcousticDiagnostic(params: {
    wagonNumber: string;
    dominantFrequencyHz: number;
    peakDb: number;
    anomalyType: AcousticAnomalyType;
    confidence?: number;
    details?: string | null;
    targetCategory?: CASNUBCategory | null;
    targetPartName?: string | null;
    inspectorId?: string | null;
  }): {
    diagnosticResult: AcousticDiagnosticResult;
    diagnosticRecord: AcousticDiagnosticRecord;
    checklistItem: ChecklistItem | null;
    gateBlocked: boolean;
    blockers: string[];
  } {
    const normalizedWagonNumber = params.wagonNumber.trim().toUpperCase();
    const wagon = this.getWagonByNumber(normalizedWagonNumber);
    if (!wagon) {
      this.registerWagon({
        wagonNumber: normalizedWagonNumber,
        wagonType: 'BOXNHL',
        owningRailway: 'SECR'
      });
    }

    const now = new Date().toISOString();
    const anomalyType = params.anomalyType;
    const dominantFreq = Number(params.dominantFrequencyHz) || 0;
    const peakDb = Number(params.peakDb) || 0;
    const confidence = params.confidence ?? (anomalyType === 'NONE' ? 0.95 : 0.88);
    const inspectorId = params.inspectorId || 'usr_insp_001';

    let targetCategory = params.targetCategory || null;
    let targetPartName = params.targetPartName || null;

    if (!targetCategory && anomalyType === 'AIR_LEAK') {
      targetCategory = 'BRAKE_SYSTEM';
      targetPartName = targetPartName || 'Air Hose & Angle Cocks';
    } else if (!targetCategory && anomalyType === 'BEARING_DEFECT') {
      targetCategory = 'BEARINGS';
      targetPartName = targetPartName || 'CTRB Cartridge Bearing Rotation';
    }

    let updatedChecklistItem: ChecklistItem | null = null;

    if (anomalyType === 'AIR_LEAK' || anomalyType === 'BEARING_DEFECT') {
      const category = targetCategory || (anomalyType === 'AIR_LEAK' ? 'BRAKE_SYSTEM' : 'BEARINGS');
      const partName = targetPartName || (anomalyType === 'AIR_LEAK' ? 'Air Hose & Angle Cocks' : 'CTRB Cartridge Bearing Rotation');

      const condNotes = `Acoustic defect detected: ${anomalyType === 'AIR_LEAK' ? 'Pneumatic Air Leak' : 'CTRB Bearing Spall/Defect'} at ${dominantFreq.toFixed(1)} Hz (${peakDb.toFixed(1)} dB SPL)`;

      const item = this.upsertChecklistItem({
        wagonNumber: normalizedWagonNumber,
        category: category as CASNUBCategory,
        partName: partName,
        status: 'FAIL',
        isMandatory: true,
        conditionNotes: condNotes,
        inspectorId: inspectorId,
        inspectorName: 'Acoustic Inspector'
      });

      updatedChecklistItem = item;
    }

    // Persist diagnostic record
    const diagId = `ac_${crypto.randomUUID()}`;
    const details = params.details || (
      anomalyType === 'AIR_LEAK'
        ? `High-frequency pneumatic hiss detected at ${dominantFreq.toFixed(1)} Hz`
        : anomalyType === 'BEARING_DEFECT'
        ? `Low/Mid periodic impact pulses detected at ${dominantFreq.toFixed(1)} Hz`
        : 'Acoustic spectrum nominal'
    );

    const insertDiag = this.db.prepare(`
      INSERT INTO acoustic_diagnostics (
        id, wagon_number, dominant_frequency_hz, peak_db, anomaly_type,
        confidence, details, target_category, target_part_name, checklist_item_id,
        inspector_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertDiag.run(
      diagId,
      normalizedWagonNumber,
      dominantFreq,
      peakDb,
      anomalyType,
      confidence,
      details,
      targetCategory,
      targetPartName,
      updatedChecklistItem?.id || null,
      inspectorId,
      now
    );

    // Audit log
    logAuditEvent(this.db, {
      eventType: 'ACOUSTIC_DEFECT_LOGGED' as any,
      userId: inspectorId,
      userRole: 'INSPECTOR',
      payload: {
        diagnosticId: diagId,
        wagonNumber: normalizedWagonNumber,
        anomalyType,
        dominantFrequencyHz: dominantFreq,
        peakDb,
        confidence,
        targetCategory,
        targetPartName,
        checklistItemId: updatedChecklistItem?.id || null
      },
      createdAt: now
    });

    const diagnosticResult: AcousticDiagnosticResult = {
      timestamp: now,
      dominantFrequencyHz: dominantFreq,
      peakDb,
      anomalyType,
      confidence,
      details,
      recommendedAction: anomalyType === 'AIR_LEAK'
        ? 'Inspect air hose coupling, angle cocks, and distributor valve seals for pneumatic leakage.'
        : anomalyType === 'BEARING_DEFECT'
        ? 'Perform CTRB bearing rotation check and replace defective cartridge bearing.'
        : 'Zero acoustic anomalies detected. Subsystems nominal.'
    };

    const diagnosticRecord: AcousticDiagnosticRecord = {
      id: diagId,
      wagonNumber: normalizedWagonNumber,
      dominantFrequencyHz: dominantFreq,
      peakDb,
      anomalyType,
      confidence,
      details,
      targetCategory: targetCategory as CASNUBCategory | null,
      targetPartName,
      checklistItemId: updatedChecklistItem?.id || null,
      inspectorId,
      createdAt: now
    };

    // Re-evaluate exit gate
    const gateStatus = this.evaluateExitGate(normalizedWagonNumber);

    return {
      diagnosticResult,
      diagnosticRecord,
      checklistItem: updatedChecklistItem,
      gateBlocked: !gateStatus.canRelease,
      blockers: gateStatus.blockers
    };
  }

  public getAcousticDiagnostics(wagonNumber?: string): AcousticDiagnosticRecord[] {
    let rows: any[];
    if (wagonNumber) {
      rows = this.db.prepare(`
        SELECT * FROM acoustic_diagnostics
        WHERE wagon_number = ?
        ORDER BY created_at DESC
      `).all(wagonNumber.trim().toUpperCase()) as any[];
    } else {
      rows = this.db.prepare(`
        SELECT * FROM acoustic_diagnostics
        ORDER BY created_at DESC
        LIMIT 100
      `).all() as any[];
    }

    return rows.map(r => ({
      id: r.id,
      wagonNumber: r.wagon_number,
      dominantFrequencyHz: r.dominant_frequency_hz,
      peakDb: r.peak_db,
      anomalyType: r.anomaly_type,
      confidence: r.confidence,
      details: r.details,
      targetCategory: r.target_category,
      targetPartName: r.target_part_name,
      checklistItemId: r.checklist_item_id,
      inspectorId: r.inspector_id,
      createdAt: r.created_at
    }));
  }

  private getDefaultRDSOItems(): Array<{ category: CASNUBCategory; partName: string; bogiePosition: string; isMandatory: number }> {
    return CASNUB_CHECKLIST_TEMPLATE.map(({ category, partName, bogiePosition, isMandatory }) => ({
      category, partName, bogiePosition, isMandatory
    }));
  }
}

function lowerHexRandom(bytes: number): string {
  return crypto.randomBytes(bytes).toString('hex').toLowerCase();
}
