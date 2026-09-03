/**
 * Wagon Lifecycle, CASNUB Checklist, Gate & Analytics Repository
 * Indian Railways WRS Raipur (Phase 2)
 */

import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import { logAuditEvent } from './auditLog.ts';
import { config } from '../config/index.ts';
import { signCertificate } from '../reports/certificateSigning.ts';
import * as analytics from './wagonAnalytics.ts';
import { CASNUB_CHECKLIST_TEMPLATE } from './checklistTemplate.ts';
import { validateSpringNests } from '../../../shared/classification/nestGrouping.ts';
import { getSpringCountOptions, buildSpringQueue } from '../../../shared/classification/springCounts.ts';
import { evaluateSwt } from '../../../shared/classification/swtSpec.ts';
import type { PipeType, LoadCondition, SwtReading } from '../../../shared/classification/swtSpec.ts';
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

/**
 * These unions were narrower than the values the gate actually emits, and
 * because the server is run with --experimental-strip-types (which strips
 * types without checking them) nothing ever complained. They are widened here
 * to the real vocabulary rather than the aspirational one.
 *
 * Note the two spellings of the same idea: `CRITICAL_BLOCKER` and `CRITICAL`
 * are both emitted. Nothing decides anything from them — release is gated on
 * `blockers.length === 0`, i.e. on which array a detail was pushed into, not
 * on this label — so the inconsistency is cosmetic. Worth normalising to one
 * spelling, but that changes the API payload, so it is left alone here.
 */
export interface ExitGateBlockerDetail {
  id: string;
  category: string;
  partName: string;
  issueType:
    | 'MISSING_INSPECTION'
    | 'INSPECTION_FAILED'
    | 'CONDEMNED_UNRESOLVED'
    | 'REINSPECTION_REQUIRED'
    | 'SPRING_CONDEMNED'
    | 'MISSING_SPRINGS'
    | 'STAGE_INVALID'
    | 'SPRINGS_NOT_FULLY_MEASURED'
    | 'CTRB_CYCLE_MISMATCH'
    | 'SWT_NOT_PERFORMED'
    | 'SWT_FAILED'
    // Nest grouping violations, from NestViolationType.
    | 'HEIGHT_VARIATION_EXCEEDED'
    | 'NEW_OLD_MIXED'
    | 'BAND_MIXED';
  description: string;
  severity: 'CRITICAL_BLOCKER' | 'CRITICAL' | 'WARNING' | 'ADVISORY';
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
    // No fallback to a demo user: a wagon registered by nobody in particular
    // is a record that cannot be questioned or defended later.
    const createdBy = this.requireActor(data.createdBy, 'Wagon registration');

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
      eventType: 'WAGON_REGISTERED',
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

    // The performer must already exist. This previously created the account if
    // the id was unknown, using the role the caller supplied — so an unknown
    // id could materialise as an active SUPERVISOR.
    this.requireActor(data.performedBy, 'Stage transition');

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
      eventType: 'WAGON_STAGE_TRANSITION',
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
    // Latest measurement per (bogie, position). bogie_position MUST be in the
    // grouping key: without it, measuring the same position on both bogies
    // collapsed to a single row and one bogie's measurement was discarded.
    // COALESCE keeps legacy rows (bogie_position NULL) as their own group.
    // Latest measurement per INDIVIDUAL spring. nest_index must be in the
    // grouping key: a 20.32t NLB bogie carries twelve outer springs, and
    // without it all twelve collapsed into one row — the gate saw a single
    // reading standing in for the whole nest, so eleven condemned springs
    // could hide behind one passing re-measurement.
    const springInspections = this.db.prepare(`
      SELECT i.* FROM inspections i
      INNER JOIN (
        SELECT wagon_number, bogie_type, spring_position,
               COALESCE(bogie_position, '__NONE__') AS bogie_key,
               COALESCE(nest_index, 0) AS nest_key,
               MAX(sequence_number) as max_seq
        FROM inspections
        WHERE wagon_number = ?
        GROUP BY wagon_number, bogie_type, spring_position, bogie_key, nest_key
      ) latest ON i.wagon_number = latest.wagon_number
              AND i.bogie_type = latest.bogie_type
              AND i.spring_position = latest.spring_position
              AND COALESCE(i.bogie_position, '__NONE__') = latest.bogie_key
              AND COALESCE(i.nest_index, 0) = latest.nest_key
              AND i.sequence_number = latest.max_seq
    `).all(wagonNumber) as any[];

    if (springInspections.length === 0) return;

    const persistStmt = this.db.prepare(`
      UPDATE checklist_items
      SET status = ?, condition_notes = ?, phase1_inspection_id = ?, updated_at = ?
      WHERE id = ? AND status != ?
    `);
    const now = new Date().toISOString();

    for (const row of checklistRows) {
      if (row.category !== 'SPRINGS') continue;

      const partLower = row.part_name.toLowerCase();
      // Which spring position does this checklist item describe?
      const wantedPosition = partLower.includes('snubber')
        ? 'SNUBBER'
        : partLower.includes('inner')
        ? 'INNER'
        : partLower.includes('outer')
        ? 'OUTER'
        : null;
      if (!wantedPosition) continue;

      // Which bogie does it describe? Part names read "Outer Spring (Bogie 1)".
      const wantedBogie = /bogie\s*1/.test(partLower)
        ? 'BOGIE_1'
        : /bogie\s*2/.test(partLower)
        ? 'BOGIE_2'
        : null;

      const matched = springInspections.find((si) => {
        const pos = String(si.spring_position || '').toUpperCase();
        const positionMatches =
          pos === wantedPosition ||
          (wantedPosition === 'SNUBBER' && pos.startsWith('SNUBBER'));
        if (!positionMatches) return false;

        // CRITICAL: only link when the bogie is actually known to match.
        // Previously any OUTER measurement satisfied BOTH bogies' items, so
        // measuring one spring marked two as verified — the exit gate would
        // then pass a bogie whose springs were never measured at all.
        if (wantedBogie) {
          return si.bogie_position === wantedBogie;
        }
        // Item does not name a bogie — a position match is sufficient.
        return true;
      });

      if (!matched) continue;

      row.phase1_inspection_id = matched.id;

      /*
       * A measurement never overturns a person.
       *
       * This used to rewrite every spring row from the latest measurement on
       * every read, in both directions. A supervisor could condemn a spring
       * by hand — "visible transverse crack near second coil" — and the next
       * time anyone opened the checklist it read PASS again, with the note
       * replaced by "Auto-linked from spring measurement: 258.5mm". No audit
       * entry, and the exit gate reads this same method, so the wagon became
       * releasable.
       *
       * Free height is one failure mode out of several and a cracked spring
       * measures perfectly, so a passing measurement means "the height is in
       * band", never "the part is good".
       *
       * The rule the sync route already applies to offline work applies here
       * too: fill in what nobody has judged, escalate freely, never downgrade
       * a human verdict. A more severe measurement is not discarded — it is
       * carried as a conflict and blocks release.
       */
      if (row.manual_verdict_at) {
        const held = String(row.status || '');
        const measurementIsWorse =
          matched.status === 'CONDEMNED' && held !== 'CONDEMNED' && held !== 'REPLACED';
        if (measurementIsWorse) {
          row.measurementConflict = {
            measured: 'CONDEMNED',
            held,
            measuredHeight: matched.measured_height,
            tableReference: matched.table_reference || 'RDSO G-95',
            reason:
              `Measured at ${matched.measured_height}mm, which condemns it under ` +
              `${matched.table_reference || 'RDSO G-95'}, but this part is recorded as ${held} ` +
              `by ${row.inspector_name || 'an inspector'}. Someone must reconcile the two before release.`
          };
        }
        continue;
      }

      let newStatus: string | null = null;
      let notes = row.condition_notes;

      if (matched.status === 'CONDEMNED' && row.status !== 'REPLACED') {
        newStatus = 'CONDEMNED';
        notes = matched.condemnation_reason || 'Condemned in Phase 1 Spring Classification';
      } else if (matched.status === 'PASS') {
        newStatus = 'PASS';
        notes =
          `Auto-linked from spring measurement: ${matched.measured_height}mm ` +
          `(${matched.classified_band || 'band not recorded'}, ${matched.table_reference || 'RDSO G-95'})`;
      }

      if (newStatus && row.status !== newStatus) {
        row.status = newStatus;
        row.condition_notes = notes;
        // Persist, so the linkage is real rather than a display-time illusion.
        // Anything reading checklist_items directly previously saw PENDING
        // even though the UI and gate showed the spring as cleared.
        persistStmt.run(newStatus, notes, matched.id, now, row.id, 'REPLACED');
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
      /*
       * A status written here by a person is their verdict, and must not be
       * silently replaced by a later measurement. PENDING is not a verdict —
       * it is the absence of one — so it does not claim the row.
       */
      const isHumanVerdict = !!data.status && data.status !== 'PENDING';
      const manualAt = isHumanVerdict ? now : existing.manual_verdict_at;
      const manualBy = isHumanVerdict
        ? (data.inspectorId || existing.manual_verdict_by)
        : existing.manual_verdict_by;

      this.db.prepare(`
        UPDATE checklist_items
        SET status = ?, condition_notes = ?, repair_action = ?, repair_notes = ?,
            reinspected_status = ?, photo_id = ?, inspector_id = ?, inspector_name = ?,
            updated_at = ?, manual_verdict_at = ?, manual_verdict_by = ?
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
        manualAt ?? null,
        manualBy ?? null,
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

  public updateChecklistItem(
    itemId: string,
    updates: Partial<ChecklistItemData>,
    options?: { expectedUpdatedAt?: string; userId?: string; userRole?: string }
  ): any {
    const existing = this.getChecklistItemById(itemId);
    if (!existing) {
      throw new Error(`Checklist item ${itemId} not found.`);
    }

    // Optimistic concurrency. Two inspectors on the same wagon previously
    // overwrote each other silently — the loser's verdict simply vanished
    // with no error shown to anyone. When the caller tells us which version
    // it read, refuse the write if the row moved underneath it.
    if (options?.expectedUpdatedAt && existing.updatedAt) {
      if (options.expectedUpdatedAt !== existing.updatedAt) {
        const err: any = new Error(
          `This item was changed by someone else while you were working on it ` +
          `(current status: ${existing.status}). Refresh to see their update, then re-apply yours.`
        );
        err.name = 'ConflictError';
        err.currentItem = existing;
        throw err;
      }
    }

    const now = new Date().toISOString();
    const status = updates.status !== undefined ? updates.status : existing.status;
    const repairAction = updates.repairAction !== undefined ? updates.repairAction : existing.repairAction;
    const repairNotes = updates.repairNotes !== undefined ? updates.repairNotes : existing.repairNotes;
    const reinspectedStatus = updates.reinspectedStatus !== undefined ? updates.reinspectedStatus : existing.reinspectedStatus;
    const conditionNotes = updates.conditionNotes !== undefined ? updates.conditionNotes : existing.conditionNotes;
    const photoId = updates.photoId !== undefined ? updates.photoId : existing.photoId;

    // This route is only ever reached by a person acting on the part, so any
    // status they set claims the row against later measurement updates.
    const claimsRow = updates.status !== undefined && updates.status !== 'PENDING';

    this.db.prepare(`
      UPDATE checklist_items
      SET status = ?, repair_action = ?, repair_notes = ?, reinspected_status = ?,
          condition_notes = ?, photo_id = ?, updated_at = ?,
          manual_verdict_at = ?, manual_verdict_by = ?
      WHERE id = ?
    `).run(
      status, repairAction, repairNotes, reinspectedStatus, conditionNotes, photoId, now,
      claimsRow ? now : (existing.manualVerdictAt ?? null),
      claimsRow ? (options?.userId || existing.manualVerdictBy || null) : (existing.manualVerdictBy ?? null),
      itemId
    );

    // Every verdict on every part goes into the chain.
    //
    // Only the bulk "clear by exception" path was audited before, so the
    // ordinary route — an inspector marking one component PASS, FAIL or
    // CONDEMNED, which is the great majority of what happens to a wagon —
    // left no trace at all. The system's claim is that nothing is skipped
    // silently; that has to include the record of the inspection itself.
    logAuditEvent(this.db, {
      eventType: 'CHECKLIST_ITEM_INSPECTED',
      userId: options?.userId || 'usr_system',
      userRole: options?.userRole || 'SYSTEM',
      payload: {
        wagonNumber: existing.wagon_number,
        itemId,
        category: existing.category,
        partName: existing.part_name,
        previousStatus: existing.status,
        newStatus: status,
        repairAction,
        reinspectedStatus,
        conditionNotes: conditionNotes || null
      }
    });

    return this.getChecklistItemById(itemId);
  }

  public getChecklistItemById(id: string): any {
    const row = this.db.prepare('SELECT * FROM checklist_items WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.mapChecklistItem(row);
  }

  /**
   * Inspect-by-exception: clear every still-PENDING item on a wagon in one
   * action, having flagged the exceptions individually first.
   *
   * This is how experienced inspectors already work on paper — they walk the
   * bogie, note what is wrong, and everything else is good by definition.
   * Forcing 53 individual taps to say "fine" is data entry, not inspection,
   * and it is the single largest source of manual effort in the app.
   *
   * Safety properties that make this defensible rather than a rubber stamp:
   *   - It only ever touches PENDING items. A FAIL or CONDEMNED verdict that
   *     someone already recorded can never be bulk-overwritten.
   *   - Springs are excluded. Those carry measured RDSO band data and must
   *     come from an actual measurement, never from a blanket action.
   *   - It requires an attestation string, stored on every affected row, so
   *     the record shows this was a deliberate declaration by a named person.
   *   - Each affected item is written through the normal audit path.
   */
  public bulkClearPendingItems(
    wagonNumber: string,
    options: {
      attestation: string;
      userId: string;
      userRole?: string;
      excludeCategories?: string[];
    }
  ): { clearedCount: number; skippedCategories: string[]; itemIds: string[] } {
    const normalizedWagonNumber = wagonNumber.trim().toUpperCase();

    if (!options.attestation || options.attestation.trim().length < 10) {
      const err: any = new Error(
        'An attestation of at least 10 characters is required — this action declares physical inspection of every remaining item.'
      );
      err.name = 'ValidationError';
      throw err;
    }

    // SPRINGS always excluded: their status must derive from a real measured
    // free height classified against the RDSO tables.
    const excluded = ['SPRINGS', ...(options.excludeCategories || [])];
    const placeholders = excluded.map(() => '?').join(',');

    const pending = this.db.prepare(`
      SELECT id, category, part_name FROM checklist_items
      WHERE wagon_number = ?
        AND (status IS NULL OR status = 'PENDING')
        AND category NOT IN (${placeholders})
    `).all(normalizedWagonNumber, ...excluded) as any[];

    const now = new Date().toISOString();
    const note = `Cleared by exception-based inspection: ${options.attestation.trim()}`;
    const updateStmt = this.db.prepare(`
      UPDATE checklist_items
      SET status = 'PASS', condition_notes = ?, updated_at = ?
      WHERE id = ?
    `);

    const itemIds: string[] = [];
    for (const item of pending) {
      updateStmt.run(note, now, item.id);
      itemIds.push(item.id);
    }

    if (itemIds.length > 0) {
      logAuditEvent(this.db, {
        id: `audit_bulk_${crypto.randomUUID()}`,
        inspectionId: null,
        eventType: 'CHECKLIST_ITEM_UPDATED',
        userId: options.userId,
        userRole: options.userRole,
        payload: {
          wagonNumber: normalizedWagonNumber,
          action: 'BULK_CLEAR_BY_EXCEPTION',
          attestation: options.attestation.trim(),
          clearedCount: itemIds.length,
          clearedItems: pending.map((p) => `${p.category}/${p.part_name}`),
          excludedCategories: excluded
        }
      });
    }

    return { clearedCount: itemIds.length, skippedCategories: excluded, itemIds };
  }

  /**
   * Suggests a likely status for each pending item from this wagon's own
   * repair history, so an inspector confirms rather than recalls.
   *
   * This is pattern lookup over data the workshop already produced — no model,
   * no training, no inference cost, and it works offline on the shop floor.
   * Nothing here decides anything: suggestions are advisory and the UI must
   * present them as prompts, never as pre-filled answers.
   */
  public suggestChecklistStatuses(wagonNumber: string): {
    wagonNumber: string;
    suggestions: {
      itemId: string;
      category: string;
      partName: string;
      suggestedStatus: string;
      confidence: number;
      basis: string;
    }[];
  } {
    const normalizedWagonNumber = wagonNumber.trim().toUpperCase();

    const pending = this.db.prepare(`
      SELECT id, category, part_name FROM checklist_items
      WHERE wagon_number = ? AND (status IS NULL OR status = 'PENDING')
    `).all(normalizedWagonNumber) as any[];

    if (pending.length === 0) {
      return { wagonNumber: normalizedWagonNumber, suggestions: [] };
    }

    // Fleet-wide outcome history for the same part, most recent first.
    const historyStmt = this.db.prepare(`
      SELECT status, COUNT(*) AS n
      FROM checklist_items
      WHERE part_name = ? AND status IS NOT NULL AND status != 'PENDING'
      GROUP BY status
      ORDER BY n DESC
    `);

    const suggestions = pending.map((item) => {
      const rows = historyStmt.all(item.part_name) as any[];
      const total = rows.reduce((sum, r) => sum + r.n, 0);

      if (total < 5) {
        return {
          itemId: item.id,
          category: item.category,
          partName: item.part_name,
          suggestedStatus: 'PENDING',
          confidence: 0,
          basis: 'Not enough history for this part yet'
        };
      }

      const top = rows[0];
      return {
        itemId: item.id,
        category: item.category,
        partName: item.part_name,
        suggestedStatus: top.status,
        confidence: Number((top.n / total).toFixed(3)),
        basis: `${top.n} of ${total} previous inspections of this part were ${top.status}`
      };
    });

    return { wagonNumber: normalizedWagonNumber, suggestions };
  }

  // -------------------------------------------------------------------------
  // Checklist Configuration Management
  // -------------------------------------------------------------------------

  public getChecklistConfig(wagonType?: string): any[] {
    if (wagonType) {
      const rows = this.db.prepare(`
        SELECT * FROM checklist_config WHERE wagon_type = ? ORDER BY category, part_name
      `).all(wagonType) as any[];

      // No saved overrides for this wagon type yet — return the standard
      // CASNUB template rather than an empty list. Asking "what is the
      // checklist for a BOXNHL?" should answer with the default checklist,
      // which is what actually gets applied at registration; an empty array
      // wrongly implies no checks are configured.
      if (rows.length === 0) {
        return CASNUB_CHECKLIST_TEMPLATE.map((it) => ({
          id: `cfg_default_${wagonType}_${it.category}_${it.partName}`.replace(/[^a-zA-Z0-9_]/g, '_'),
          wagon_type: wagonType,
          category: it.category,
          part_name: it.partName,
          bogie_position: it.bogiePosition,
          is_mandatory: it.isMandatory,
          standard_reference: it.std,
          is_default: 1
        }));
      }
      return rows;
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
    advisories: string[];
    advisoryDetails: ExitGateBlockerDetail[];
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
      springNestCheck: {
        isMatched: boolean;
        violationCount: number;
        groups: unknown[];
        ruleReference: string;
        maxVariationMm: number;
      };
      hasSupervisorSignoff: boolean;
    };
  } {
    const normalizedWagonNumber = wagonNumber.trim().toUpperCase();
    const wagon = this.getWagonByNumber(normalizedWagonNumber);
    const blockers: string[] = [];
    const blockerDetails: ExitGateBlockerDetail[] = [];
    // Advisories do not block release — they surface recommended-practice
    // issues (currently spring nest grouping) for supervisor judgement.
    const advisories: string[] = [];
    const advisoryDetails: ExitGateBlockerDetail[] = [];

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
      /*
       * A measurement that condemns a part somebody has recorded as
       * serviceable blocks release, whether the part is mandatory or not.
       *
       * The measurement is deliberately not applied — a person who looked at
       * the part is not overruled by a number — but it cannot be dropped
       * either. Before this, the checklist row was simply overwritten by
       * whichever ran last, and one of those two findings disappeared without
       * anyone being told which.
       */
      if (item.measurementConflict) {
        const msg =
          `"${item.partName}" (${item.category}) — ${item.measurementConflict.reason}`;
        blockers.push(msg);
        blockerDetails.push({
          id: item.id,
          category: item.category,
          partName: item.partName,
          issueType: 'INSPECTION_FAILED',
          description: msg,
          severity: 'CRITICAL_BLOCKER',
          remediationAction:
            'Re-examine the part. Either record the condemnation, or re-measure and record why the reading stands.'
        });
      }

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

    // Latest measurement per INDIVIDUAL spring.
    //
    // This grouping key decides what the exit gate can see, and it was far too
    // coarse: every outer spring on the wagon collapsed into a single row.
    // A 20.32t NLB carries twelve outer springs per bogie, so eleven of them
    // — including condemned ones — were invisible here, and even the two
    // bogies were indistinguishable from each other.
    //
    // COALESCE keeps rows recorded before bogie/nest indexing as their own
    // group rather than silently merging them.
    const latestSprings = this.db.prepare(`
      SELECT i.* FROM inspections i
      INNER JOIN (
        SELECT wagon_number, bogie_type, spring_position,
               COALESCE(bogie_position, '__NONE__') AS bogie_key,
               COALESCE(nest_index, 0) AS nest_key,
               MAX(sequence_number) as max_seq
        FROM inspections
        WHERE wagon_number = ?
        GROUP BY wagon_number, bogie_type, spring_position, bogie_key, nest_key
      ) latest ON i.wagon_number = latest.wagon_number
              AND i.bogie_type = latest.bogie_type
              AND i.spring_position = latest.spring_position
              AND COALESCE(i.bogie_position, '__NONE__') = latest.bogie_key
              AND COALESCE(i.nest_index, 0) = latest.nest_key
              AND i.sequence_number = latest.max_seq
    `).all(normalizedWagonNumber) as any[];

    // -----------------------------------------------------------------------
    // Spring completeness. A bogie carries far more than one spring per
    // position — a 20.32t NLB has twelve outer, eight inner, four snubber —
    // so a wagon can have springs recorded and still be largely unmeasured.
    // Releasing on a partial sweep is the failure this check exists to stop.
    //
    // Only enforced once at least one indexed spring exists, so wagons
    // recorded before per-spring indexing are not retrospectively blocked on
    // data that was never captured.
    // -----------------------------------------------------------------------
    const indexedSprings = latestSprings.filter((s: any) => s.nest_index != null);
    if (indexedSprings.length > 0) {
      const bogieTypeOfRecord = String(indexedSprings[0].bogie_type);
      const options = getSpringCountOptions(bogieTypeOfRecord as any);

      // Without a recorded axle load, judge against the smallest documented
      // configuration so the gate never demands springs the bogie may not have.
      const smallest = options
        .slice()
        .sort((a, b) => (a.counts.outer + a.counts.inner + a.counts.snubber) -
                        (b.counts.outer + b.counts.inner + b.counts.snubber))[0];

      if (smallest) {
        const expected = buildSpringQueue(smallest.counts);
        const measured = new Set(
          indexedSprings.map((s: any) => `${s.bogie_position}|${s.spring_position}|${s.nest_index}`)
        );
        const missing = expected.filter(
          (e) => !measured.has(`${e.bogiePosition}|${e.position}|${e.indexInNest}`)
        );

        if (missing.length > 0) {
          const byNest = new Map<string, number>();
          for (const m of missing) {
            const key = `${m.bogiePosition.replace('_', ' ')} ${m.position.toLowerCase()}`;
            byNest.set(key, (byNest.get(key) || 0) + 1);
          }
          const detail = [...byNest.entries()]
            .map(([nest, n]) => `${n} × ${nest}`)
            .join(', ');

          const msg =
            `${missing.length} of ${expected.length} springs have not been measured ` +
            `(${detail}). A ${bogieTypeOfRecord} at ${smallest.axleLoad} carries ` +
            `${smallest.counts.outer} outer, ${smallest.counts.inner} inner and ` +
            `${smallest.counts.snubber} snubber springs per bogie.`;

          blockers.push(msg);
          blockerDetails.push({
            id: 'springs_incomplete',
            category: 'SPRINGS',
            partName: 'Spring nest sweep',
            issueType: 'SPRINGS_NOT_FULLY_MEASURED',
            description: msg,
            severity: 'CRITICAL_BLOCKER',
            remediationAction: 'Complete the spring batch for both bogies before requesting release.'
          });
        }
      }
    }

    // -----------------------------------------------------------------------
    // Spring nest grouping / segregation check (RDSO WMM 2.0).
    //
    // The per-spring loop below catches individually condemned springs. This
    // check catches the set-level failure it cannot see: a nest whose springs
    // each PASS individually but whose free heights are spread across more
    // than 3 mm, which will not share load evenly once assembled.
    //
    // Raised as an ADVISORY rather than a hard blocker, for two reasons:
    //   1. The manual's own wording is "it is recommended that springs having
    //      not more than 3 mm free height variation should be assembled in the
    //      same group" — advisory language, not a condemning limit.
    //   2. Records written before per-spring indexing carry no nest index, so
    //      two rows at the same position may be two springs OR one spring
    //      measured twice. Hard-blocking on an ambiguous signal would wrongly
    //      detain wagons carrying that older data.
    // -----------------------------------------------------------------------
    const allWagonSprings = this.db.prepare(`
      SELECT id, bogie_position, spring_position, spring_condition, measured_height,
             classified_band, height_is_approximate, status
      FROM inspections WHERE wagon_number = ?
    `).all(normalizedWagonNumber) as any[];

    const nestResult = validateSpringNests(
      allWagonSprings.map((s) => ({
        id: s.id,
        springPosition: s.spring_position,
        bogiePosition: s.bogie_position,
        condition: s.spring_condition,
        measuredFreeHeight: s.measured_height,
        classifiedBand: s.classified_band,
        // Without this the nest check cannot tell a strip reading from a
        // measurement, and silently passes a nest of mixed bands.
        heightIsApproximate: s.height_is_approximate === 1,
        status: s.status
      }))
    );

    // Severity follows the manual's own wording, rather than a judgement of
    // our own about how serious each fault is:
    //
    //   NEW_OLD_MIXED — "Mixing of new and old springs must be avoided."
    //     A prohibition, so it blocks.
    //
    //   HEIGHT_VARIATION_EXCEEDED / BAND_MIXED — "it is recommended that
    //     springs having not more than 3 mm free height variation should be
    //     assembled in the same group." A recommendation, so it does not block.
    //
    // Band mixing in particular is not a certain breach: two springs either
    // side of a band boundary can be a fraction of a millimetre apart. What is
    // certain is that the real spread is unknown, which is a matter for
    // supervisor judgement — not grounds to detain a wagon automatically.
    //
    // A recommendation is not permission to ignore it silently, though. Every
    // advisory raised here has to be acknowledged by name at sign-off (see
    // recordGateSignoff), so a wagon can leave with a mismatched nest only as
    // a recorded decision, never by nobody noticing.
    for (const v of nestResult.violations) {
      const detail = {
        id: `nest_${v.type}_${v.groupKey}`,
        category: 'SPRINGS' as const,
        partName: `${v.groupKey} spring nest`,
        issueType: v.type,
        description: v.message,
        remediationAction:
          v.type === 'NEW_OLD_MIXED'
            ? 'Re-group so each nest contains either all-new or all-used springs.'
            : `Re-group so every spring in this nest falls within one 3 mm band. ${nestResult.ruleReference}.`
      };

      if (v.type === 'NEW_OLD_MIXED') {
        blockers.push(v.message);
        blockerDetails.push({ ...detail, severity: 'CRITICAL' });
      } else {
        advisories.push(v.message);
        advisoryDetails.push({ ...detail, severity: 'ADVISORY' });
      }
    }

    // -----------------------------------------------------------------------
    // Bearings fitted to one wagon must share an overhaul cycle.
    //
    // WMM 2.0 Chapter 6, clause (f): "While fitting CTRBs back into a wagon in
    // ROH depots, it must be ensured that only CTRB with cap screws having one
    // particular type of painting scheme (One cap screw painted / two cap
    // screw painted / three cap screw painted) are strictly placed under a
    // wagon undergoing ROH."
    //
    // The scheme is a physical record: at POH the end cap screws are replaced
    // unpainted, and one more is painted golden yellow at each ROH. So the
    // rule is that every bearing under a wagon must be at the same point in
    // its overhaul cycle — a matched-set rule of exactly the same shape as the
    // spring nest rule, currently enforced by counting paint and verified by
    // sample check (clause (i)).
    //
    // "must be ensured" and "strictly" is prohibition language, so this blocks
    // rather than advises. Wagons with no bearing passports recorded are not
    // judged: absence of data is not evidence of a mismatch.
    // -----------------------------------------------------------------------
    const fittedBearings = this.db.prepare(`
      SELECT serial_number, roh_cycles_since_poh, current_bogie_position
      FROM components
      WHERE current_wagon_number = ? AND component_type = 'BEARING' AND status != 'CONDEMNED'
    `).all(normalizedWagonNumber) as any[];

    if (fittedBearings.length > 1) {
      const cycles = [...new Set(fittedBearings.map((b) => b.roh_cycles_since_poh))].sort();
      if (cycles.length > 1) {
        const describe = (n: number) =>
          n === 0 ? 'no screws painted (fresh from POH)' : `${n} screw${n === 1 ? '' : 's'} painted`;
        const summary = cycles.map(describe).join(' and ');

        blockers.push(
          `Bearings fitted to this wagon are at different points in their overhaul cycle — ${summary}. ` +
          `WMM 2.0 Chapter 6 requires that only CTRBs with one painting scheme are fitted under a wagon.`
        );
        blockerDetails.push({
          id: 'ctrb_cycle_mismatch',
          category: 'BEARINGS',
          partName: 'CTRB overhaul cycle',
          issueType: 'CTRB_CYCLE_MISMATCH',
          description:
            `${fittedBearings.length} bearings fitted, spanning ${cycles.length} overhaul cycles (${summary}). ` +
            `Serials: ${fittedBearings.map((b) => `${b.serial_number} (${b.roh_cycles_since_poh})`).join(', ')}.`,
          severity: 'CRITICAL',
          remediationAction:
            'Refit so every bearing under this wagon carries the same painting scheme, per WMM 2.0 Chapter 6 clause (f).'
        });
      }
    }

    // -----------------------------------------------------------------------
    // Single Wagon Test (air brake).
    //
    // WMM 2.0 §720: "Single wagon test is also carried out after POH". For a
    // workshop doing periodic overhaul that makes it mandatory, not advisory,
    // so a wagon without a passing test does not leave. The brake system is
    // the one component whose failure is not recoverable by the next
    // inspection down the line.
    //
    // A test that was run and failed, and a test that was never run, are
    // reported differently: they need different things done about them.
    // -----------------------------------------------------------------------
    const latestSwt = this.getLatestSwt(normalizedWagonNumber);
    if (!latestSwt) {
      blockers.push(
        'Single Wagon Test (air brake) has not been carried out. WMM 2.0 §720 requires it after POH.'
      );
      blockerDetails.push({
        id: 'swt_not_performed',
        category: 'BRAKE_SYSTEM',
        partName: 'Single Wagon Test',
        issueType: 'SWT_NOT_PERFORMED',
        description:
          'No Single Wagon Test on record for this wagon. WMM 2.0 §720 requires one after POH ' +
          'and after any change of distributor valve.',
        severity: 'CRITICAL',
        remediationAction: 'Carry out the Single Wagon Test and record the proforma readings.'
      });
    } else if (!latestSwt.passed) {
      const failed = (latestSwt.failed_refs || '').split(',').filter(Boolean);
      const missing = (latestSwt.missing_refs || '').split(',').filter(Boolean);
      const parts: string[] = [];
      if (failed.length) parts.push(`${failed.length} reading(s) outside limit (rows ${failed.join(', ')})`);
      if (missing.length) parts.push(`${missing.length} row(s) not recorded (rows ${missing.join(', ')})`);

      blockers.push(`Single Wagon Test did not pass — ${parts.join('; ')}.`);
      blockerDetails.push({
        id: 'swt_failed',
        category: 'BRAKE_SYSTEM',
        partName: 'Single Wagon Test',
        issueType: 'SWT_FAILED',
        description: `Single Wagon Test did not pass — ${parts.join('; ')}.`,
        severity: 'CRITICAL',
        remediationAction: 'Rectify the air brake faults and repeat the Single Wagon Test.'
      });
    }

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
      advisories,
      advisoryDetails,
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
        springNestCheck: {
          isMatched: nestResult.isValid,
          violationCount: nestResult.violations.length,
          groups: nestResult.groups,
          ruleReference: nestResult.ruleReference,
          maxVariationMm: nestResult.maxVariationMm
        },
        hasSupervisorSignoff
      }
    };
  }

  /**
   * Employee ID of a registered, active user — the identifier printed on a
   * release certificate. Returns null when the user is unknown or inactive,
   * so callers must decide explicitly rather than falling back to a constant.
   */
  public getUserEmployeeId(userId: string): string | null {
    const row = this.db
      .prepare('SELECT employee_id, is_active FROM users WHERE id = ?')
      .get(userId) as { employee_id: string | null; is_active: number } | undefined;
    if (!row || !row.is_active) return null;
    return row.employee_id || null;
  }

  public recordGateSignoff(data: {
    wagonNumber: string;
    supervisorId: string;
    supervisorName: string;
    supervisorEmployeeId: string;
    otpTokenRef: string;
    /**
     * Advisory ids the supervisor has explicitly accepted. Every advisory the
     * gate currently raises must appear here, or sign-off is refused.
     */
    acknowledgedAdvisoryIds?: string[];
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

    // -----------------------------------------------------------------------
    // Advisories must be acknowledged, not merely displayed.
    //
    // The nest grouping rule is worded as a recommendation, so it does not
    // block. That is not the same as being ignorable: a wagon leaving with a
    // mismatched nest should be a decision somebody made and put their name
    // to, not something nobody happened to read. Requiring each advisory to be
    // named at sign-off is what turns a notice into a decision — and the
    // acknowledgement travels inside the signed certificate contents below, so
    // it cannot be quietly detached from the release afterwards.
    // -----------------------------------------------------------------------
    const acknowledged = new Set(data.acknowledgedAdvisoryIds || []);
    const unacknowledged = (evaluation.advisoryDetails || []).filter((a: any) => !acknowledged.has(a.id));

    if (unacknowledged.length > 0) {
      throw new Error(
        `Cannot sign off release. ${unacknowledged.length} advisory finding(s) have not been ` +
        `acknowledged: ${unacknowledged.map((a: any) => a.description).join('; ')} ` +
        `Acknowledge each finding to release the wagon on your authority, or resolve it first.`
      );
    }

    const id = `signoff_${crypto.randomUUID()}`;
    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    const randomSuffix = crypto.randomBytes(2).toString('hex').toUpperCase();
    const certificateNumber = `WRS/QC-REL/${year}/${month}/${randomSuffix}`;

    // One timestamp, used both inside the signed content and as the stored
    // signed_at. It used to be a fresh `new Date()` inside the canonical
    // summary and a separate one for the row, so the hash covered a moment
    // that was never recorded — nobody could ever recompute it to check the
    // certificate. A hash that cannot be re-derived attests to nothing.
    const signedAt = new Date().toISOString();

    // The acknowledgement is folded into the checks summary rather than kept
    // as a signature-only field, because the summary is what gets stored.
    // Anything the signature covers has to be recoverable from the record, or
    // the certificate can never be re-verified by whoever receives it.
    const checksSummary = {
      ...(data.checksSummary as Record<string, unknown>),
      acknowledgedAdvisoryIds: [...acknowledged].sort()
    };

    const canonicalSummary = JSON.stringify({
      wagonNumber: normalizedWagonNumber,
      certificateNumber,
      supervisorId: data.supervisorId,
      supervisorEmployeeId: data.supervisorEmployeeId,
      signedAt,
      summary: checksSummary
    });
    const certificateHash = crypto.createHash('sha256').update(canonicalSummary).digest('hex');

    /*
     * An Ed25519 signature over the certificate's contents.
     *
     * Two earlier versions of this line are worth remembering. The first
     * stored `HMAC-` followed by 16 random bytes — a label claiming to be a
     * MAC over a document it had never seen. The second was a genuine keyed
     * HMAC-SHA256, which detected alteration but could only be verified by
     * whoever held the signing key.
     *
     * That second property is the problem for this particular document. The
     * people who will want to check a release certificate — a CRIS reviewer,
     * an auditor, a railway receiving the wagon — are precisely the people who
     * must not be able to issue one. A shared key cannot give them the first
     * without the second, so nobody outside this server could ever really
     * check anything.
     *
     * Ed25519 separates signing from verifying. The public key is printed on
     * the certificate by fingerprint and served from /api/audit/certificate-key,
     * so verification is something a third party does for themselves.
     */
    const digitalSignature = signCertificate(canonicalSummary);

    // The signing supervisor must already exist and be active.
    //
    // This previously created the user if it was missing — an INSERT giving
    // the unknown id a SUPERVISOR role and a password of 'none'. On the one
    // route whose entire purpose is accountable sign-off, an unrecognised
    // signatory conjured an account rather than being refused. Ghost-user
    // creation was removed from the inspection path for exactly this reason;
    // it survived here, where it mattered most.
    const signer = this.db
      .prepare('SELECT id, is_active FROM users WHERE id = ?')
      .get(data.supervisorId) as { id: string; is_active: number } | undefined;

    if (!signer) {
      throw new Error(
        `Supervisor ${data.supervisorId} is not a registered user. A release certificate ` +
        `cannot be signed by an unknown signatory.`
      );
    }
    if (!signer.is_active) {
      throw new Error(
        `Supervisor ${data.supervisorId} is deactivated and cannot sign a release certificate.`
      );
    }

    // Insert signoff
    this.db.prepare(`
      INSERT INTO gate_signoffs (
        id, wagon_id, wagon_number, supervisor_id, supervisor_name, supervisor_employee_id,
        digital_signature, otp_token_ref, signoff_notes, checks_summary_json,
        certificate_number, certificate_hash, signed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, wagon.id, normalizedWagonNumber, data.supervisorId, data.supervisorName,
      data.supervisorEmployeeId, digitalSignature, data.otpTokenRef,
      data.signoffNotes || null, JSON.stringify(checksSummary),
      certificateNumber, certificateHash, signedAt
    );

    // The release itself, as its own event.
    //
    // This produced only a stage transition before — a side effect of the
    // release rather than a record of it — so the audit log could not answer
    // "who released this wagon, under which certificate, accepting what".
    // That is the single most consequential act in the system and the one a
    // DRM would look for first.
    logAuditEvent(this.db, {
      eventType: 'GATE_SIGNOFF_COMPLETED',
      userId: data.supervisorId,
      userRole: 'SUPERVISOR',
      payload: {
        wagonNumber: normalizedWagonNumber,
        certificateNumber,
        certificateHash,
        supervisorName: data.supervisorName,
        supervisorEmployeeId: data.supervisorEmployeeId,
        otpTokenRef: data.otpTokenRef,
        acknowledgedAdvisoryIds: [...acknowledged].sort(),
        signedAt
      }
    });

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
      digitalSignature,
      otpTokenRef: data.otpTokenRef,
      signoffNotes: data.signoffNotes || null,
      checksSummary,
      certificateNumber,
      certificateHash,
      signedAt
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

  /**
   * Resolves an actor to a registered, active user, or refuses.
   *
   * Three call sites used to conjure a user row when the id was unknown —
   * wagon registration, stage transitions and photo evidence — each inserting
   * an account with a password of 'none'. The transition one took the role
   * from the caller, so an unknown id could materialise as a SUPERVISOR.
   *
   * Ghost-user creation was removed from the inspection path during the Tier 1
   * cleanup with a note never to reintroduce it. It had survived in four other
   * places. Everything this system records is an assertion that a named person
   * did something; an actor who cannot be identified is a reason to refuse, not
   * to invent one.
   */
  /**
   * Evidence held for one checklist item, split by what it shows.
   *
   * The question this answers is "can this repair be demonstrated?" — which
   * needs a before and an after, not merely a count of photographs.
   */
  public getEvidenceForItem(checklistItemId: string): {
    before: any[];
    after: any[];
    defect: any[];
    other: any[];
    hasBeforeAndAfter: boolean;
  } {
    const rows = this.db.prepare(`
      SELECT id, evidence_stage, file_name, part_name, inspector_name, created_at
      FROM wagon_photos WHERE checklist_item_id = ? ORDER BY created_at ASC
    `).all(checklistItemId) as any[];

    const of = (stage: string) => rows.filter((r) => r.evidence_stage === stage);
    const before = of('BEFORE');
    const after = of('AFTER');

    return {
      before,
      after,
      defect: of('DEFECT'),
      other: rows.filter((r) => !['BEFORE', 'AFTER', 'DEFECT'].includes(r.evidence_stage)),
      hasBeforeAndAfter: before.length > 0 && after.length > 0
    };
  }

  private requireActor(userId: string | undefined | null, context: string): string {
    if (!userId) {
      throw new Error(`${context}: no user was supplied. Every record must name who made it.`);
    }
    const row = this.db
      .prepare('SELECT id, is_active FROM users WHERE id = ?')
      .get(userId) as { id: string; is_active: number } | undefined;

    if (!row) {
      throw new Error(`${context}: user ${userId} is not registered. Records must name a real person.`);
    }
    if (!row.is_active) {
      throw new Error(`${context}: user ${userId} is deactivated.`);
    }
    return row.id;
  }

  /**
   * Records a Single Wagon Test.
   *
   * The verdict is computed here from the readings, never accepted from the
   * caller — a test whose result the tester can assert is not a test.
   */
  public recordSwt(data: {
    wagonNumber: string;
    wagonType: string;
    pipeType: PipeType;
    loadCondition: LoadCondition;
    readings: SwtReading[];
    testedBy: string;
    testerName?: string | null;
    notes?: string | null;
  }): any {
    const wagonNumber = data.wagonNumber.trim().toUpperCase();
    this.requireActor(data.testedBy, 'Single wagon test');

    const evaluation = evaluateSwt({
      pipeType: data.pipeType,
      loadCondition: data.loadCondition,
      wagonType: data.wagonType,
      readings: data.readings
    });

    const id = `swt_${crypto.randomUUID()}`;
    this.db.prepare(`
      INSERT INTO swt_tests (
        id, wagon_number, wagon_type, pipe_type, load_condition,
        readings_json, results_json, passed, failed_refs, missing_refs,
        unjudged_refs, tested_by, tester_name, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, wagonNumber, data.wagonType, data.pipeType, data.loadCondition,
      JSON.stringify(data.readings), JSON.stringify(evaluation.results),
      evaluation.passed ? 1 : 0,
      evaluation.failedRefs.join(',') || null,
      evaluation.missingRefs.join(',') || null,
      evaluation.unjudgedRefs.join(',') || null,
      data.testedBy, data.testerName ?? null, data.notes ?? null
    );

    // Logged as INSPECTION_CREATED with an explicit action, not as
    // CHECKLIST_ITEM_INSPECTED. A single wagon test is not a checklist verdict,
    // and counting it as one made the log overstate how many components had
    // been individually inspected. The event_type column carries a CHECK
    // constraint listing the permitted values, and SQLite cannot extend that
    // on an existing table without rebuilding it — which is not something to
    // do casually to the append-only audit log — so the precise meaning lives
    // in the payload's action field.
    logAuditEvent(this.db, {
      eventType: 'INSPECTION_CREATED',
      userId: data.testedBy,
      userRole: 'INSPECTOR',
      payload: {
        action: 'SINGLE_WAGON_TEST',
        wagonNumber,
        pipeType: data.pipeType,
        loadCondition: data.loadCondition,
        passed: evaluation.passed,
        failedRefs: evaluation.failedRefs,
        missingRefs: evaluation.missingRefs
      }
    });

    return { id, ...evaluation };
  }

  /** Most recent Single Wagon Test for a wagon, or null. */
  public getLatestSwt(wagonNumber: string): any | null {
    const row = this.db.prepare(`
      SELECT * FROM swt_tests WHERE wagon_number = ? ORDER BY created_at DESC, rowid DESC LIMIT 1
    `).get(wagonNumber.trim().toUpperCase()) as any;
    if (!row) return null;
    return {
      ...row,
      passed: row.passed === 1,
      readings: JSON.parse(row.readings_json),
      results: JSON.parse(row.results_json)
    };
  }

  public getSwtHistory(wagonNumber: string): any[] {
    return (this.db.prepare(`
      SELECT id, pipe_type, load_condition, passed, failed_refs, tester_name, created_at
      FROM swt_tests WHERE wagon_number = ? ORDER BY created_at DESC
    `).all(wagonNumber.trim().toUpperCase()) as any[]).map((r) => ({ ...r, passed: r.passed === 1 }));
  }

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
    /** BEFORE / AFTER for a repair, DEFECT for a condemnation, else GENERAL. */
    evidenceStage?: 'BEFORE' | 'AFTER' | 'DEFECT' | 'GENERAL' | null;
  }): any {
    const id = data.id || `photo_${crypto.randomUUID()}`;
    const wagonNumber = data.wagonNumber.trim().toUpperCase();
    const fileName = data.fileName || `${wagonNumber}_${Date.now()}.jpg`;
    const mimeType = data.mimeType || 'image/jpeg';
    const fileSize = data.fileSize || Buffer.byteLength(data.imageData, 'utf8');
    const tagsJson = JSON.stringify(data.tags || []);
    const now = new Date().toISOString();

    // Photo evidence is only evidence if it is attributable.
    this.requireActor(data.inspectorId, 'Photo evidence');

    this.db.prepare(`
      INSERT INTO wagon_photos (
        id, wagon_number, checklist_item_id, category, part_name, stage,
        file_name, mime_type, file_size, image_data, inspector_id,
        inspector_name, tags_json, evidence_stage, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, wagonNumber, data.checklistItemId || null, data.category || null,
      data.partName || null, data.stage || null, fileName, mimeType, fileSize,
      data.imageData, data.inspectorId, data.inspectorName, tagsJson,
      data.evidenceStage || null, now
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
  //
  // Implemented in wagonAnalytics.ts. They stay on the repository so callers
  // are unaffected by the move, but the queries themselves now live somewhere
  // this file is not responsible for.
  // -------------------------------------------------------------------------

  public getAnalyticsPipeline(): any { return analytics.getAnalyticsPipeline(this.db); }
  public getAnalyticsTAT(): any { return analytics.getAnalyticsTAT(this.db); }
  public getAnalyticsThroughput(): any { return analytics.getAnalyticsThroughput(this.db); }
  public getAnalyticsParts(): any { return analytics.getAnalyticsParts(this.db); }
  public getAnalyticsInspectors(): any { return analytics.getAnalyticsInspectors(this.db); }
  // Passed the repository rather than the handle: this one needs the exit
  // gate evaluated per wagon, which is not a query.
  public getAnalyticsBlockers(): any {
    return analytics.getAnalyticsBlockers({
      db: this.db,
      evaluateExitGate: (w: string) => this.evaluateExitGate(w)
    });
  }

  // -------------------------------------------------------------------------
  // Mappers & Helpers
  // -------------------------------------------------------------------------

  private mapWagonRow(row: any): any {
    const totalElapsedHours = row.entry_date
      ? Math.max(0, Math.round(((Date.now() - new Date(row.entry_date).getTime()) / (1000 * 60 * 60)) * 10) / 10)
      : 0;

    /*
     * One name per field.
     *
     * This returned every field twice — wagonNumber AND wagon_number, twelve
     * pairs of them — so /api/wagons was sending each value under two names.
     * The cost is not really the doubled payload. It is that two names for one
     * value invite code that reads one and writes the other, and a mapper that
     * updates one spelling and forgets its twin produces an object that
     * disagrees with itself. Nothing had gone wrong yet; the arrangement was
     * simply waiting for it to.
     *
     * The database columns stay snake_case and the API stays camelCase, which
     * is the boundary this mapper exists to cross. What the server ACCEPTS is
     * unchanged and still takes either spelling — an offline tablet may hold
     * queued records written in the older form, and refusing them to tidy up
     * the response would lose real readings. Liberal in what it accepts,
     * single-voiced in what it sends.
     */
    return {
      id: row.id,
      wagonNumber: row.wagon_number,
      wagonType: row.wagon_type,
      owningRailway: row.owning_railway,
      currentStage: row.current_stage as LifecycleStage,
      status: row.status,
      entryDate: row.entry_date,
      targetReleaseDate: row.target_release_date,
      actualReleaseDate: row.actual_release_date,
      releaseDate: row.actual_release_date,
      entryNotes: row.entry_notes,
      conditionNotes: row.condition_notes || row.entry_notes,
      createdBy: row.created_by,
      isReleased: row.current_stage === 'RELEASE',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
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
      manualVerdictAt: row.manual_verdict_at,
      manual_verdict_at: row.manual_verdict_at,
      manualVerdictBy: row.manual_verdict_by,
      manual_verdict_by: row.manual_verdict_by,
      /*
       * Set when a measurement disagrees with a standing human verdict and is
       * MORE severe. The measurement is not applied — a person's finding is
       * not overwritten — but it cannot be dropped either, so it is carried
       * here and blocks the exit gate.
       */
      measurementConflict: row.measurementConflict || null,
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
      eventType: 'ACOUSTIC_DEFECT_LOGGED',
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
