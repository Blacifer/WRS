/**
 * Database Migrations & Schema Initializer
 * Indian Railways WRS Raipur (Phase 1 & Phase 2)
 */

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * A table rebuild, all or nothing.
 *
 * SQLite cannot widen a CHECK in place, so three migrations below copy a
 * table into a replacement, DROP the original and RENAME the copy. Each of
 * those was a sequence of separate statements with no transaction around
 * them. Between the DROP and the RENAME the table did not exist, and a power
 * cut on the shop PC in that window — or any error — would have left the
 * database without it. For inspections that is the inspection record.
 *
 * So the whole sequence runs inside BEGIN IMMEDIATE ... COMMIT, and any
 * failure rolls back to the table exactly as it was. Foreign-key enforcement
 * is switched off OUTSIDE the transaction, because that pragma is a no-op
 * inside one — which is the mistake the obvious arrangement makes. The check
 * on the way out confirms the swap left every reference intact before it is
 * committed.
 */
export function rebuildAtomically(db: DatabaseSync, label: string, body: () => void): void {
  db.exec('PRAGMA foreign_keys = OFF;');
  try {
    db.exec('BEGIN IMMEDIATE;');
    try {
      body();
      const broken = db.prepare('PRAGMA foreign_key_check').all() as any[];
      if (broken.length > 0) {
        throw new Error(`${broken.length} foreign key reference(s) would be left dangling`);
      }
      db.exec('COMMIT;');
    } catch (err: any) {
      try {
        db.exec('ROLLBACK;');
      } catch {
        // Already rolled back by the engine, or never began; nothing to undo.
      }
      throw new Error(`${label}: rolled back, nothing changed — ${err?.message || err}`);
    }
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }
}

export function runMigrations(db: DatabaseSync): void {
  const schemaPath = path.resolve(__dirname, 'schema.sql');
  let schemaSql = '';

  if (fs.existsSync(schemaPath)) {
    schemaSql = fs.readFileSync(schemaPath, 'utf8');
  } else {
    // Fallback embedded schema DDL
    schemaSql = `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('INSPECTOR', 'SUPERVISOR', 'ADMIN', 'Inspector', 'Supervisor', 'Admin')),
        full_name TEXT NOT NULL,
        employee_id TEXT NOT NULL UNIQUE,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      CREATE TABLE IF NOT EXISTS inspections (
        id TEXT PRIMARY KEY,
        sequence_number INTEGER UNIQUE,
        sync_id TEXT UNIQUE,
        wagon_number TEXT NOT NULL,
        bogie_type TEXT NOT NULL CHECK(bogie_type IN ('CASNUB_22_NLB', 'CASNUB_22_HS', 'CASNUB_22_RFT')),
        spring_condition TEXT NOT NULL CHECK(spring_condition IN ('USED', 'NEW')),
        spring_position TEXT NOT NULL CHECK(spring_position IN ('OUTER', 'INNER', 'SNUBBER', 'SNUBBER_OUTER', 'SNUBBER_INNER')),
        measured_height REAL NOT NULL CHECK(measured_height >= 0.0 AND measured_height <= 1000.0),
        classified_band TEXT CHECK(classified_band IN ('BLUE', 'GREEN', 'YELLOW', 'ORANGE', 'WHITE', 'RED') OR classified_band IS NULL),
        band_roman TEXT CHECK(band_roman IN ('Band I', 'Band II', 'Band III', 'Band IV', 'Band V', 'Band VI') OR band_roman IS NULL),
        status TEXT NOT NULL CHECK(status IN ('PASS', 'CONDEMNED')),
        damage_type TEXT NOT NULL DEFAULT 'NONE' CHECK(damage_type IN ('NONE', 'CRACK', 'CORROSION', 'DEFORMATION', 'OTHER')),
        damage_notes TEXT DEFAULT NULL,
        table_reference TEXT NOT NULL,
        valid_range_min REAL NOT NULL,
        valid_range_max REAL NOT NULL,
        condemnation_reason TEXT DEFAULT NULL,
        inspector_id TEXT NOT NULL,
        inspector_name TEXT NOT NULL,
        supervisor_override INTEGER NOT NULL DEFAULT 0 CHECK(supervisor_override IN (0, 1)),
        original_band TEXT DEFAULT NULL,
        override_band TEXT DEFAULT NULL,
        override_reason TEXT DEFAULT NULL,
        override_supervisor_id TEXT DEFAULT NULL,
        override_supervisor_name TEXT DEFAULT NULL,
        otp_token_ref TEXT DEFAULT NULL,
        measurement_source TEXT NOT NULL DEFAULT 'MANUAL' CHECK(measurement_source IN ('MANUAL', 'OCR', 'CAMERA_ASSISTED', 'CAMERA_AUTO')),
        ocr_confidence REAL DEFAULT NULL,
        ocr_image_ref TEXT DEFAULT NULL,
        offline_created_at TEXT DEFAULT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        synced_at TEXT DEFAULT NULL,
        audit_hash TEXT DEFAULT NULL,
        FOREIGN KEY (inspector_id) REFERENCES users(id) ON DELETE RESTRICT,
        FOREIGN KEY (override_supervisor_id) REFERENCES users(id) ON DELETE RESTRICT
      );

      CREATE TABLE IF NOT EXISTS inspection_audit_log (
        id TEXT PRIMARY KEY,
        inspection_id TEXT,
        event_type TEXT NOT NULL,
        user_id TEXT NOT NULL,
        user_role TEXT NOT NULL,
        ip_address TEXT DEFAULT NULL,
        payload_json TEXT NOT NULL,
        previous_hash TEXT DEFAULT NULL,
        hash TEXT DEFAULT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
      );

      CREATE TABLE IF NOT EXISTS sequence_tracker (
        name TEXT PRIMARY KEY,
        last_val INTEGER NOT NULL
      );
      INSERT OR IGNORE INTO sequence_tracker (name, last_val) VALUES ('inspection_seq', 0);

      CREATE TABLE IF NOT EXISTS wagons (
        id TEXT PRIMARY KEY,
        wagon_number TEXT NOT NULL UNIQUE,
        wagon_type TEXT NOT NULL,
        owning_railway TEXT NOT NULL,
        current_stage TEXT NOT NULL DEFAULT 'ENTRY_REGISTRATION',
        status TEXT NOT NULL DEFAULT 'IN_PROGRESS',
        entry_date TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        target_release_date TEXT DEFAULT NULL,
        actual_release_date TEXT DEFAULT NULL,
        entry_notes TEXT DEFAULT NULL,
        condition_notes TEXT DEFAULT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
      );

      CREATE TABLE IF NOT EXISTS wagon_transitions (
        id TEXT PRIMARY KEY,
        wagon_id TEXT NOT NULL,
        wagon_number TEXT NOT NULL,
        from_stage TEXT NOT NULL,
        to_stage TEXT NOT NULL,
        transition_type TEXT NOT NULL,
        performed_by TEXT NOT NULL,
        performer_name TEXT NOT NULL,
        performer_role TEXT NOT NULL,
        is_override INTEGER NOT NULL DEFAULT 0,
        override_reason TEXT DEFAULT NULL,
        supervisor_id TEXT DEFAULT NULL,
        supervisor_name TEXT DEFAULT NULL,
        otp_token_ref TEXT DEFAULT NULL,
        notes TEXT DEFAULT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        FOREIGN KEY (wagon_id) REFERENCES wagons(id) ON DELETE RESTRICT,
        FOREIGN KEY (performed_by) REFERENCES users(id) ON DELETE RESTRICT
      );

      CREATE TABLE IF NOT EXISTS checklist_items (
        id TEXT PRIMARY KEY,
        wagon_id TEXT NOT NULL,
        wagon_number TEXT NOT NULL,
        category TEXT NOT NULL,
        part_name TEXT NOT NULL,
        bogie_position TEXT NOT NULL DEFAULT 'NONE',
        status TEXT NOT NULL DEFAULT 'PENDING',
        is_mandatory INTEGER NOT NULL DEFAULT 1,
        condition_notes TEXT DEFAULT NULL,
        repair_action TEXT DEFAULT NULL,
        repair_notes TEXT DEFAULT NULL,
        reinspected_status TEXT DEFAULT NULL,
        inspector_id TEXT NOT NULL,
        inspector_name TEXT NOT NULL,
        photo_id TEXT DEFAULT NULL,
        phase1_inspection_id TEXT DEFAULT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        FOREIGN KEY (wagon_id) REFERENCES wagons(id) ON DELETE RESTRICT,
        FOREIGN KEY (inspector_id) REFERENCES users(id) ON DELETE RESTRICT,
        FOREIGN KEY (phase1_inspection_id) REFERENCES inspections(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS checklist_config (
        id TEXT PRIMARY KEY,
        wagon_type TEXT NOT NULL,
        category TEXT NOT NULL,
        part_name TEXT NOT NULL,
        bogie_position TEXT NOT NULL DEFAULT 'NONE',
        is_mandatory INTEGER NOT NULL DEFAULT 1,
        standard_reference TEXT DEFAULT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        UNIQUE(wagon_type, category, part_name, bogie_position)
      );

      CREATE TABLE IF NOT EXISTS gate_signoffs (
        id TEXT PRIMARY KEY,
        wagon_id TEXT NOT NULL,
        wagon_number TEXT NOT NULL,
        supervisor_id TEXT NOT NULL,
        supervisor_name TEXT NOT NULL,
        supervisor_employee_id TEXT NOT NULL,
        digital_signature TEXT NOT NULL,
        otp_token_ref TEXT NOT NULL,
        signoff_notes TEXT DEFAULT NULL,
        checks_summary_json TEXT NOT NULL,
        certificate_number TEXT NOT NULL UNIQUE,
        certificate_hash TEXT NOT NULL,
        signed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        FOREIGN KEY (wagon_id) REFERENCES wagons(id) ON DELETE RESTRICT,
        FOREIGN KEY (supervisor_id) REFERENCES users(id) ON DELETE RESTRICT
      );

      CREATE TABLE IF NOT EXISTS wagon_photos (
        id TEXT PRIMARY KEY,
        wagon_number TEXT NOT NULL,
        checklist_item_id TEXT DEFAULT NULL,
        category TEXT DEFAULT NULL,
        part_name TEXT DEFAULT NULL,
        stage TEXT DEFAULT NULL,
        file_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        image_data TEXT NOT NULL,
        inspector_id TEXT NOT NULL,
        inspector_name TEXT NOT NULL,
        tags_json TEXT DEFAULT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        FOREIGN KEY (inspector_id) REFERENCES users(id) ON DELETE RESTRICT
      );

      CREATE TRIGGER IF NOT EXISTS trg_prevent_inspections_update
      BEFORE UPDATE ON inspections
      BEGIN
        SELECT RAISE(ABORT, 'Audit log is strictly append-only. Inspection records are immutable and cannot be updated.');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_prevent_inspections_delete
      BEFORE DELETE ON inspections
      BEGIN
        SELECT RAISE(ABORT, 'Audit log is strictly append-only. Inspection records are immutable and cannot be deleted.');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_prevent_audit_log_update
      BEFORE UPDATE ON inspection_audit_log
      BEGIN
        SELECT RAISE(ABORT, 'Audit log is strictly append-only. Audit log entries are immutable and cannot be updated.');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_prevent_audit_log_delete
      BEFORE DELETE ON inspection_audit_log
      BEGIN
        SELECT RAISE(ABORT, 'Audit log is strictly append-only. Audit log entries are immutable and cannot be deleted.');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_prevent_wagon_transitions_update
      BEFORE UPDATE ON wagon_transitions
      BEGIN
        SELECT RAISE(ABORT, 'Audit log is strictly append-only. Wagon transition records are immutable and cannot be updated.');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_prevent_wagon_transitions_delete
      BEFORE DELETE ON wagon_transitions
      BEGIN
        SELECT RAISE(ABORT, 'Audit log is strictly append-only. Wagon transition records are immutable and cannot be deleted.');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_prevent_gate_signoffs_update
      BEFORE UPDATE ON gate_signoffs
      BEGIN
        SELECT RAISE(ABORT, 'Audit log is strictly append-only. Gate sign-off records are immutable and cannot be updated.');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_prevent_gate_signoffs_delete
      BEFORE DELETE ON gate_signoffs
      BEGIN
        SELECT RAISE(ABORT, 'Audit log is strictly append-only. Gate sign-off records are immutable and cannot be deleted.');
      END;

      CREATE TABLE IF NOT EXISTS stores_inventory (
        id TEXT PRIMARY KEY,
        part_code TEXT NOT NULL UNIQUE,
        part_name TEXT NOT NULL,
        category TEXT NOT NULL CHECK(category IN (
          'SPRINGS', 'WHEELS_AXLES', 'BEARINGS', 'BRAKE_SYSTEM',
          'COUPLERS_DRAFT_GEAR', 'BOGIE_FRAME_BOLSTER', 'FRICTION_WEDGES', 'BODY_UNDERFRAME'
        )),
        unit_of_measure TEXT NOT NULL DEFAULT 'NOS',
        stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK(stock_quantity >= 0),
        reserved_quantity INTEGER NOT NULL DEFAULT 0 CHECK(reserved_quantity >= 0),
        reorder_threshold INTEGER NOT NULL DEFAULT 10,
        unit_cost_inr REAL NOT NULL DEFAULT 0.0,
        bin_location TEXT NOT NULL,
        supplier_name TEXT DEFAULT 'RWF Yelahanka / Secunderabad Stores',
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      CREATE TABLE IF NOT EXISTS inventory_reservations (
        id TEXT PRIMARY KEY,
        wagon_number TEXT NOT NULL,
        part_code TEXT NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity > 0),
        source TEXT NOT NULL CHECK(source IN ('OMRS_AI_TRIAGE', 'MANUAL_INSPECTION', 'SUPERVISOR_ALLOCATION')),
        predicted_defect TEXT DEFAULT NULL,
        confidence_score REAL DEFAULT NULL,
        status TEXT NOT NULL DEFAULT 'RESERVED' CHECK(status IN ('RESERVED', 'ALLOCATED', 'ISSUED_TO_FLOOR', 'CANCELLED', 'RETURNED')),
        allocated_at TEXT DEFAULT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        FOREIGN KEY (part_code) REFERENCES stores_inventory(part_code) ON DELETE RESTRICT
      );

      CREATE TABLE IF NOT EXISTS omrs_scans (
        id TEXT PRIMARY KEY,
        wagon_number TEXT NOT NULL,
        scan_timestamp TEXT NOT NULL,
        location TEXT NOT NULL DEFAULT 'Trackside OMRS Sensor Array - Raipur Outer Yard (KM 828/14)',
        train_speed_kmph REAL NOT NULL DEFAULT 65.0,
        wheel_impact_kn REAL DEFAULT NULL,
        acoustic_bearing_peak_db REAL DEFAULT NULL,
        temperature_celsius REAL DEFAULT NULL,
        wheel_profile_deviation_mm REAL DEFAULT NULL,
        predicted_defects_json TEXT NOT NULL,
        triage_severity TEXT NOT NULL CHECK(triage_severity IN ('NORMAL', 'ADVISORY', 'CRITICAL_TRIAGE')),
        is_triaged INTEGER NOT NULL DEFAULT 0 CHECK(is_triaged IN (0, 1)),
        auto_reservation_triggered INTEGER NOT NULL DEFAULT 0 CHECK(auto_reservation_triggered IN (0, 1)),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      CREATE INDEX IF NOT EXISTS idx_inventory_part_code ON stores_inventory(part_code);
      CREATE INDEX IF NOT EXISTS idx_inventory_category ON stores_inventory(category);
      CREATE INDEX IF NOT EXISTS idx_reservations_wagon ON inventory_reservations(wagon_number);
      CREATE INDEX IF NOT EXISTS idx_reservations_status ON inventory_reservations(status);
      CREATE INDEX IF NOT EXISTS idx_omrs_wagon ON omrs_scans(wagon_number);
      CREATE INDEX IF NOT EXISTS idx_omrs_timestamp ON omrs_scans(scan_timestamp DESC);

      CREATE TABLE IF NOT EXISTS acoustic_diagnostics (
        id TEXT PRIMARY KEY,
        wagon_number TEXT NOT NULL,
        dominant_frequency_hz REAL NOT NULL,
        peak_db REAL NOT NULL,
        anomaly_type TEXT NOT NULL CHECK(anomaly_type IN ('NONE', 'AIR_LEAK', 'BEARING_DEFECT')),
        confidence REAL NOT NULL DEFAULT 1.0,
        details TEXT DEFAULT NULL,
        target_category TEXT DEFAULT NULL,
        target_part_name TEXT DEFAULT NULL,
        checklist_item_id TEXT DEFAULT NULL,
        inspector_id TEXT DEFAULT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        FOREIGN KEY (checklist_item_id) REFERENCES checklist_items(id) ON DELETE SET NULL,
        FOREIGN KEY (inspector_id) REFERENCES users(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_acoustic_wagon ON acoustic_diagnostics(wagon_number);
      CREATE INDEX IF NOT EXISTS idx_acoustic_anomaly ON acoustic_diagnostics(anomaly_type, created_at DESC);

      CREATE TABLE IF NOT EXISTS components (
        id TEXT PRIMARY KEY,
        serial_number TEXT NOT NULL UNIQUE,
        component_type TEXT NOT NULL CHECK(component_type IN (
          'WHEELSET',
          'BEARING',
          'DRAFT_GEAR',
          'BOGIE_FRAME_BOLSTER',
          'BRAKE_VALVE',
          'COUPLER',
          'FRICTION_WEDGE'
        )),
        category TEXT NOT NULL CHECK(category IN (
          'SPRINGS',
          'WHEELS_AXLES',
          'BEARINGS',
          'BRAKE_SYSTEM',
          'COUPLERS_DRAFT_GEAR',
          'BOGIE_FRAME_BOLSTER',
          'FRICTION_WEDGES',
          'BODY_UNDERFRAME'
        )),
        part_name TEXT NOT NULL,
        qr_code TEXT NOT NULL UNIQUE,
        rfid_tag TEXT DEFAULT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'AVAILABLE_IN_STORES' CHECK(status IN (
          'AVAILABLE_IN_STORES',
          'RESERVED',
          'IN_SERVICE',
          'UNDER_MAINTENANCE',
          'RECONDITIONED',
          'CONDEMNED'
        )),
        current_wagon_number TEXT DEFAULT NULL,
        current_bogie_position TEXT NOT NULL DEFAULT 'NONE' CHECK(current_bogie_position IN (
          'BOGIE_1',
          'BOGIE_2',
          'UNDERFRAME',
          'BODY',
          'NONE'
        )),
        manufacturing_date TEXT NOT NULL,
        manufacturer TEXT NOT NULL,
        total_km_travelled REAL NOT NULL DEFAULT 0.0 CHECK(total_km_travelled >= 0.0),
        overhaul_count INTEGER NOT NULL DEFAULT 0 CHECK(overhaul_count >= 0),
        last_poh_date TEXT DEFAULT NULL,
        next_poh_due TEXT DEFAULT NULL,
        health_score REAL NOT NULL DEFAULT 100.0 CHECK(health_score >= 0.0 AND health_score <= 100.0),
        health_status TEXT NOT NULL DEFAULT 'EXCELLENT' CHECK(health_status IN (
          'EXCELLENT',
          'GOOD',
          'FAIR',
          'ATTENTION_REQUIRED',
          'CRITICAL'
        )),
        bin_location TEXT DEFAULT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        FOREIGN KEY (current_wagon_number) REFERENCES wagons(wagon_number) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS component_history (
        id TEXT PRIMARY KEY,
        component_id TEXT NOT NULL,
        serial_number TEXT NOT NULL,
        event_type TEXT NOT NULL CHECK(event_type IN (
          'MANUFACTURED',
          'COMMISSIONED',
          'ASSIGNED_TO_WAGON',
          'REMOVED_FROM_WAGON',
          'INSPECTED',
          'MAINTENANCE_PERFORMED',
          'RECONDITIONED',
          'CONDEMNED',
          'RESERVED_STORES'
        )),
        wagon_number TEXT DEFAULT NULL,
        stage TEXT DEFAULT NULL,
        action_details TEXT NOT NULL,
        performed_by TEXT NOT NULL DEFAULT 'SYSTEM',
        performer_name TEXT NOT NULL DEFAULT 'System Auto-Trigger',
        notes TEXT DEFAULT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        FOREIGN KEY (component_id) REFERENCES components(id) ON DELETE RESTRICT
      );

      CREATE INDEX IF NOT EXISTS idx_components_serial ON components(serial_number);
      CREATE INDEX IF NOT EXISTS idx_components_qr ON components(qr_code);
      CREATE INDEX IF NOT EXISTS idx_components_type_status ON components(component_type, status);
      CREATE INDEX IF NOT EXISTS idx_components_wagon ON components(current_wagon_number);
      CREATE INDEX IF NOT EXISTS idx_components_category ON components(category);
      CREATE INDEX IF NOT EXISTS idx_components_rfid ON components(rfid_tag);
      CREATE INDEX IF NOT EXISTS idx_components_health ON components(health_score, health_status);

      CREATE INDEX IF NOT EXISTS idx_component_history_comp ON component_history(component_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_component_history_serial ON component_history(serial_number, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_component_history_wagon ON component_history(wagon_number, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_component_history_event ON component_history(event_type, created_at DESC);

      CREATE TRIGGER IF NOT EXISTS trg_prevent_component_history_update
      BEFORE UPDATE ON component_history
      BEGIN
        SELECT RAISE(ABORT, 'Component history is strictly append-only. History records are immutable and cannot be updated.');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_prevent_component_history_delete
      BEFORE DELETE ON component_history
      BEGIN
        SELECT RAISE(ABORT, 'Component history is strictly append-only. History records are immutable and cannot be deleted.');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_auto_log_component_commissioning
      AFTER INSERT ON components
      BEGIN
        INSERT INTO component_history (
          id,
          component_id,
          serial_number,
          event_type,
          wagon_number,
          stage,
          action_details,
          performed_by,
          performer_name,
          notes,
          created_at
        ) VALUES (
          lower(hex(randomblob(16))),
          NEW.id,
          NEW.serial_number,
          CASE 
            WHEN NEW.current_wagon_number IS NOT NULL THEN 'ASSIGNED_TO_WAGON'
            ELSE 'COMMISSIONED'
          END,
          NEW.current_wagon_number,
          'ENTRY_REGISTRATION',
          'Component registered with status ' || NEW.status || ' (Health: ' || CAST(NEW.health_score AS TEXT) || '%, ' || NEW.health_status || ')',
          'SYSTEM',
          'System Auto-Trigger',
          'Initial registration passport created',
          NEW.created_at
        );
      END;

      CREATE TRIGGER IF NOT EXISTS trg_auto_log_component_assignment_update
      AFTER UPDATE OF current_wagon_number, current_bogie_position ON components
      WHEN (OLD.current_wagon_number IS NOT NEW.current_wagon_number) OR (OLD.current_bogie_position IS NOT NEW.current_bogie_position)
      BEGIN
        INSERT INTO component_history (
          id,
          component_id,
          serial_number,
          event_type,
          wagon_number,
          stage,
          action_details,
          performed_by,
          performer_name,
          notes,
          created_at
        ) VALUES (
          lower(hex(randomblob(16))),
          NEW.id,
          NEW.serial_number,
          CASE 
            WHEN NEW.current_wagon_number IS NULL THEN 'REMOVED_FROM_WAGON'
            ELSE 'ASSIGNED_TO_WAGON'
          END,
          NEW.current_wagon_number,
          NULL,
          CASE 
            WHEN NEW.current_wagon_number IS NULL THEN 'Component unassigned from wagon ' || COALESCE(OLD.current_wagon_number, 'UNKNOWN')
            WHEN OLD.current_wagon_number IS NULL THEN 'Component assigned to wagon ' || NEW.current_wagon_number || ' at position ' || NEW.current_bogie_position
            ELSE 'Component reassigned from wagon ' || OLD.current_wagon_number || ' to wagon ' || NEW.current_wagon_number || ' at position ' || NEW.current_bogie_position
          END,
          'SYSTEM',
          'System Auto-Trigger',
          'Automated trigger on wagon/bogie position update',
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        );
      END;

      CREATE TRIGGER IF NOT EXISTS trg_auto_log_component_status_change
      AFTER UPDATE OF status ON components
      WHEN (OLD.status IS NOT NEW.status)
      BEGIN
        INSERT INTO component_history (
          id,
          component_id,
          serial_number,
          event_type,
          wagon_number,
          stage,
          action_details,
          performed_by,
          performer_name,
          notes,
          created_at
        ) VALUES (
          lower(hex(randomblob(16))),
          NEW.id,
          NEW.serial_number,
          CASE 
            WHEN NEW.status = 'CONDEMNED' THEN 'CONDEMNED'
            WHEN NEW.status = 'RECONDITIONED' THEN 'RECONDITIONED'
            WHEN NEW.status = 'UNDER_MAINTENANCE' THEN 'MAINTENANCE_PERFORMED'
            WHEN NEW.status = 'RESERVED' THEN 'RESERVED_STORES'
            ELSE 'INSPECTED'
          END,
          NEW.current_wagon_number,
          NULL,
          'Component status updated from ' || OLD.status || ' to ' || NEW.status || ' (Health: ' || CAST(NEW.health_score AS TEXT) || '%)',
          'SYSTEM',
          'System Auto-Trigger',
          'Automated trigger on lifecycle status transition',
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        );
      END;
    `;
  }

  db.exec(schemaSql);

  // Migration cleanup: older databases may still have this trigger from
  // before inspection-insert audit logging moved to application code
  // (it wrote unchained audit rows — no previous_hash/hash — which would
  // now duplicate the chained entry written by InspectionRepository).
  db.exec('DROP TRIGGER IF EXISTS trg_auto_log_inspection_insert;');

  // Additive migration: inspections.bogie_position. Older databases were
  // created before spring records carried a bogie identity, which meant one
  // measurement satisfied both bogies' checklist items. Added nullable so
  // existing rows stay honest about not knowing which bogie they came from.
  const inspectionCols = db.prepare('PRAGMA table_info(inspections)').all() as any[];
  if (!inspectionCols.some((c) => c.name === 'height_is_approximate')) {
    db.exec(
      'ALTER TABLE inspections ADD COLUMN height_is_approximate INTEGER NOT NULL DEFAULT 0 ' +
      'CHECK(height_is_approximate IN (0, 1));'
    );
  }
  if (!inspectionCols.some((c) => c.name === 'nest_index')) {
    db.exec(
      'ALTER TABLE inspections ADD COLUMN nest_index INTEGER DEFAULT NULL ' +
      'CHECK(nest_index IS NULL OR nest_index >= 1);'
    );
  }
  if (!inspectionCols.some((c) => c.name === 'bogie_position')) {
    db.exec(
      "ALTER TABLE inspections ADD COLUMN bogie_position TEXT DEFAULT NULL " +
      "CHECK(bogie_position IS NULL OR bogie_position IN ('BOGIE_1', 'BOGIE_2'));"
    );
  }


  /*
   * Shift handover notes.
   *
   * A narrative of the shift, drafted from the day's own records and reviewed
   * by a supervisor before it is kept. Its own table rather than an audit
   * payload: the audit chain records THAT a handover was recorded and by
   * whom, and this holds the text, which is read back as a document rather
   * than as an event. The draft is never stored — only what a person approved.
   */
  db.exec(`
    CREATE TABLE IF NOT EXISTS shift_handovers (
      id TEXT PRIMARY KEY,
      shift_date TEXT NOT NULL,
      body TEXT NOT NULL,
      facts_json TEXT NOT NULL,
      draft_source TEXT NOT NULL CHECK(draft_source IN ('MODEL', 'TEMPLATE')),
      edited INTEGER NOT NULL DEFAULT 0 CHECK(edited IN (0, 1)),
      recorded_by TEXT NOT NULL,
      recorded_by_name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      FOREIGN KEY (recorded_by) REFERENCES users(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS idx_shift_handovers_date ON shift_handovers(shift_date);
  `);

  /*
   * Blind readings of spring photographs — the go/no-go for the camera.
   *
   * Before any model is trained, one question decides whether the DRM's
   * camera is possible at all: can a PERSON read the band from the stored
   * photograph, without seeing what the bench recorded? If a second reader
   * cannot, no model can, and three weeks of photographs have answered the
   * question without a line of machine learning. If they can, the agreement
   * rate is the bar a model must clear, measured before it exists.
   *
   * The reader never sees the label. The agreement is computed at write time
   * from the label they did not see, so the aggregate is one SUM away.
   */
  db.exec(`
    CREATE TABLE IF NOT EXISTS spring_image_blind_reads (
      id TEXT PRIMARY KEY,
      image_id TEXT NOT NULL,
      reader_id TEXT NOT NULL,
      read_band TEXT DEFAULT NULL,
      read_status TEXT NOT NULL CHECK(read_status IN ('PASS', 'CONDEMNED', 'CANNOT_TELL')),
      band_agrees INTEGER DEFAULT NULL CHECK(band_agrees IS NULL OR band_agrees IN (0, 1)),
      status_agrees INTEGER DEFAULT NULL CHECK(status_agrees IS NULL OR status_agrees IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      UNIQUE (image_id, reader_id),
      FOREIGN KEY (image_id) REFERENCES spring_images(id) ON DELETE CASCADE,
      FOREIGN KEY (reader_id) REFERENCES users(id) ON DELETE RESTRICT
    );
  `);

  // Spring sorting — see the table comment in schema.sql. Created here too so
  // an existing database picks it up on boot rather than only a fresh one.
  db.exec(`
    CREATE TABLE IF NOT EXISTS spring_sorting_records (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      bogie_type TEXT NOT NULL,
      spring_condition TEXT NOT NULL CHECK(spring_condition IN ('NEW', 'USED')),
      spring_position TEXT NOT NULL CHECK(spring_position IN ('OUTER', 'INNER', 'SNUBBER', 'SNUBBER_OUTER', 'SNUBBER_INNER')),
      measured_height REAL NOT NULL,
      height_is_approximate INTEGER NOT NULL DEFAULT 0 CHECK(height_is_approximate IN (0, 1)),
      classified_band TEXT DEFAULT NULL,
      band_roman TEXT DEFAULT NULL,
      status TEXT NOT NULL CHECK(status IN ('PASS', 'CONDEMNED')),
      damage_type TEXT DEFAULT NULL,
      condemnation_reason TEXT DEFAULT NULL,
      table_reference TEXT DEFAULT NULL,
      inspector_id TEXT NOT NULL,
      inspector_name TEXT DEFAULT NULL,
      assigned_wagon_number TEXT DEFAULT NULL,
      sync_id TEXT DEFAULT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      FOREIGN KEY (inspector_id) REFERENCES users(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS idx_sorting_batch ON spring_sorting_records(batch_id);
    CREATE INDEX IF NOT EXISTS idx_sorting_group ON spring_sorting_records(bogie_type, spring_condition, spring_position, classified_band);
    CREATE INDEX IF NOT EXISTS idx_sorting_created ON spring_sorting_records(created_at);
    CREATE TRIGGER IF NOT EXISTS trg_prevent_sorting_update
    BEFORE UPDATE ON spring_sorting_records
    BEGIN
      SELECT RAISE(ABORT, 'Audit log is strictly append-only. Spring sorting records are immutable and cannot be updated.');
    END;
    CREATE TRIGGER IF NOT EXISTS trg_prevent_sorting_delete
    BEFORE DELETE ON spring_sorting_records
    BEGIN
      SELECT RAISE(ABORT, 'Audit log is strictly append-only. Spring sorting records are immutable and cannot be deleted.');
    END;
  `);


  /*
   * The gauges themselves, and whether anyone can still trust them.
   *
   * A record that says "260.5 mm, PASS" is worth a great deal less if nobody
   * can say which instrument produced the reading or whether that instrument
   * was in calibration on the day. Every measurement here was traceable to a
   * person and to a wagon, and to no instrument at all.
   *
   * The photograph from the shop floor makes the point better than the theory
   * does: the snubber gauge in daily use, SSG-02, carries a calibration label
   * whose "Calibrated on" and "Calibration valid upto" fields are both blank.
   * That is a finding whether or not the gauge is sound, because nothing on
   * the instrument or in the record says when it was last checked.
   *
   * calibrated_on and valid_upto are deliberately nullable, and the seeded
   * gauge deliberately leaves them null. Inventing a plausible date to make
   * the screen look finished would be exactly the fabrication we removed from
   * everywhere else.
   */
  db.exec(`
    CREATE TABLE IF NOT EXISTS gauges (
      id TEXT PRIMARY KEY,
      gauge_code TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      -- Which springs this gauge is for. A snubber gauge cannot judge an
      -- outer spring, and reading one against the other is how a condemned
      -- spring passes.
      applies_to TEXT DEFAULT NULL,
      certificate_number TEXT DEFAULT NULL,
      issued_to TEXT DEFAULT NULL,
      calibrated_on TEXT DEFAULT NULL,
      valid_upto TEXT DEFAULT NULL,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
      notes TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_gauges_active ON gauges(is_active);
  `);

  /*
   * The real gauge from the shop floor, exactly as its label reads.
   *
   * Transcribed from the photograph and nothing more: the two calibration
   * dates stay empty because they are empty on the instrument.
   */
  db.prepare(`
    INSERT OR IGNORE INTO gauges
      (id, gauge_code, description, applies_to, certificate_number, issued_to,
       calibrated_on, valid_upto, is_active, notes)
    VALUES
      ('gauge_ssg_02', 'SSG-02', 'Snubber spring gauge (HS)', 'SNUBBER',
       '1251122-04-125', 'SSE/CWM RWSS Raipur SECR',
       NULL, NULL, 1,
       'Transcribed from the instrument label. Both calibration dates are blank on the label itself.')
  `).run();

  // Which gauge took the reading. Nullable, because records written before
  // this existed genuinely do not know, and guessing would be worse.
  const sortingCols = db.prepare("PRAGMA table_info(spring_sorting_records)").all() as any[];
  if (sortingCols.length > 0 && !sortingCols.some((c) => c.name === 'gauge_code')) {
    db.exec("ALTER TABLE spring_sorting_records ADD COLUMN gauge_code TEXT DEFAULT NULL;");
  }
  /*
   * What the gauge's calibration looked like at the moment of the reading.
   *
   * Stored on the record rather than looked up later, because the gauge's
   * calibration will change and the record must keep saying what was true
   * when the spring was judged. A gauge recalibrated next month must not
   * retrospectively make today's uncalibrated readings look sound.
   */
  if (sortingCols.length > 0 && !sortingCols.some((c) => c.name === 'gauge_calibration_state')) {
    db.exec(
      "ALTER TABLE spring_sorting_records ADD COLUMN gauge_calibration_state TEXT DEFAULT NULL " +
      "CHECK(gauge_calibration_state IS NULL OR gauge_calibration_state IN ('VALID', 'EXPIRED', 'UNRECORDED', 'NO_GAUGE_NAMED'));"
    );
  }


  /*
   * Whether a checklist row was added on this wagon, or came from the template.
   *
   * The distinction decides whether a row may be withdrawn. A template row is
   * the standard and is not negotiable on a single vehicle; a row somebody
   * added to this wagon is a judgement about this wagon, and a judgement that
   * turns out to be wrong has to be reversible.
   *
   * That is the whole Mark-50 lesson written into a column. Fourteen MANDATORY
   * coupler items were added in August, every one of them permanently
   * incompletable, and because nothing could distinguish them from the
   * standard nothing could take them out — every wagon's exit gate stayed shut
   * until the code was edited.
   *
   * Defaults to 0, so every row that existed before this column did is treated
   * as part of the standard. That is the safe direction: the alternative would
   * make the entire existing checklist look withdrawable.
   */
  const checklistCols = db.prepare("PRAGMA table_info(checklist_items)").all() as any[];
  if (checklistCols.length > 0 && !checklistCols.some((c) => c.name === 'shop_added')) {
    db.exec("ALTER TABLE checklist_items ADD COLUMN shop_added INTEGER NOT NULL DEFAULT 0;");
  }
  /*
   * Why it was added. Required by the route, so a row that changes what the
   * gate enforces always carries the reason somebody thought it should.
   */
  if (checklistCols.length > 0 && !checklistCols.some((c) => c.name === 'added_reason')) {
    db.exec("ALTER TABLE checklist_items ADD COLUMN added_reason TEXT DEFAULT NULL;");
  }

  // Photo evidence stage — see the column comment in schema.sql.
  const photoCols = db.prepare("PRAGMA table_info(wagon_photos)").all() as any[];
  if (photoCols.length > 0 && !photoCols.some((c) => c.name === 'evidence_stage')) {
    db.exec(
      "ALTER TABLE wagon_photos ADD COLUMN evidence_stage TEXT DEFAULT NULL " +
      "CHECK(evidence_stage IS NULL OR evidence_stage IN ('BEFORE', 'AFTER', 'DEFECT', 'GENERAL'));"
    );
  }


  // Single Wagon Test — see the table comment in schema.sql.
  db.exec(`
    CREATE TABLE IF NOT EXISTS swt_tests (
      id TEXT PRIMARY KEY,
      wagon_number TEXT NOT NULL,
      wagon_type TEXT NOT NULL,
      pipe_type TEXT NOT NULL CHECK(pipe_type IN ('SINGLE', 'TWIN')),
      load_condition TEXT NOT NULL CHECK(load_condition IN ('EMPTY', 'LOADED')),
      readings_json TEXT NOT NULL,
      results_json TEXT NOT NULL,
      passed INTEGER NOT NULL CHECK(passed IN (0, 1)),
      failed_refs TEXT DEFAULT NULL,
      missing_refs TEXT DEFAULT NULL,
      unjudged_refs TEXT DEFAULT NULL,
      tested_by TEXT NOT NULL,
      tester_name TEXT DEFAULT NULL,
      notes TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      FOREIGN KEY (tested_by) REFERENCES users(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS idx_swt_wagon ON swt_tests(wagon_number, created_at);
    CREATE TRIGGER IF NOT EXISTS trg_prevent_swt_update
    BEFORE UPDATE ON swt_tests
    BEGIN
      SELECT RAISE(ABORT, 'Audit log is strictly append-only. Single wagon test records are immutable and cannot be updated.');
    END;
    CREATE TRIGGER IF NOT EXISTS trg_prevent_swt_delete
    BEFORE DELETE ON swt_tests
    BEGIN
      SELECT RAISE(ABORT, 'Audit log is strictly append-only. Single wagon test records are immutable and cannot be deleted.');
    END;
  `);


  // ROH cycle count on serialized components — see the column comment in
  // schema.sql. This is what the yellow paint on CTRB end cap screws encodes.
  const compCols = db.prepare("PRAGMA table_info(components)").all() as any[];
  if (compCols.length > 0 && !compCols.some((c) => c.name === 'roh_cycles_since_poh')) {
    db.exec(
      'ALTER TABLE components ADD COLUMN roh_cycles_since_poh INTEGER NOT NULL DEFAULT 0 ' +
      'CHECK(roh_cycles_since_poh >= 0 AND roh_cycles_since_poh <= 3);'
    );
  }


  // TOTP enrolment columns — see the comments in schema.sql.
  const userCols = db.prepare("PRAGMA table_info(users)").all() as any[];
  for (const [name, ddl] of [
    ['totp_secret_sealed', 'TEXT DEFAULT NULL'],
    ['totp_enrolled_at', 'TEXT DEFAULT NULL'],
    ['totp_last_counter', 'INTEGER DEFAULT NULL']
  ] as [string, string][]) {
    if (userCols.length > 0 && !userCols.some((c) => c.name === name)) {
      db.exec(`ALTER TABLE users ADD COLUMN ${name} ${ddl};`);
    }
  }

  /*
   * Correcting a mistapped spring.
   *
   * Sorting is one tap per spring, ~700 a shift. A wrong tap is not a
   * possibility, it is a certainty, and there was no way to fix one. An
   * inspector who cannot correct a mistake either stops trusting the record
   * or starts keeping the corrections on paper — and the paper version is the
   * thing this replaces.
   *
   * The records are append-only at the database engine (triggers refuse
   * UPDATE and DELETE), which is right for an audit trail and stays that way.
   * So a correction appends a NEW record carrying `supersedes`, pointing back
   * at the one it replaces. The old row is never touched.
   *
   * Deliberately only one column. Marking the old record "superseded_by"
   * would be an UPDATE, which the trigger refuses and should — so the link is
   * held by the new record alone, and the tally excludes any row whose id
   * appears in some other row's `supersedes`.
   */
  const sortCols = db.prepare("PRAGMA table_info(spring_sorting_records)").all() as any[];
  if (sortCols.length > 0 && !sortCols.some((c) => c.name === 'supersedes')) {
    db.exec('ALTER TABLE spring_sorting_records ADD COLUMN supersedes TEXT DEFAULT NULL;');
  }
  /*
   * Every live-record query excludes rows some later row supersedes, with
   * NOT EXISTS (... WHERE l.supersedes = r.id). Without an index on that
   * column the subquery is a full scan per row: 0.4 s at three thousand
   * rows, and quadratic from there — minutes at one year of the bench.
   * Found by timing the DRM dashboard on the demo record.
   */
  db.exec('CREATE INDEX IF NOT EXISTS idx_sorting_supersedes ON spring_sorting_records(supersedes);');

  /*
   * ...and whether the correcting record stands for a spring at all.
   *
   * `supersedes` alone cannot express a plain undo. A correction — "that was
   * a Yellow, not a Green" — appends a row that replaces the old one and is
   * itself a spring, so it counts. An undo — "that tap was an accident,
   * there is no spring" — appends a row that replaces the old one and counts
   * for nothing. Both look identical without this flag, which is why undoing
   * a spring briefly made the tally go UP: the old row was excluded and the
   * void row counted itself.
   *
   * A void row is still written rather than the old one deleted, because the
   * table is append-only at the database engine and the withdrawal is part of
   * the record. It is simply never counted.
   */
  if (sortCols.length > 0 && !sortCols.some((c) => c.name === 'voided')) {
    db.exec('ALTER TABLE spring_sorting_records ADD COLUMN voided INTEGER NOT NULL DEFAULT 0;');
  }


  /*
   * Widening the role constraint to include DRM.
   *
   * users.role carried CHECK(role IN ('INSPECTOR','SUPERVISOR','ADMIN',
   * 'Inspector','Supervisor','Admin')) — every role twice, and no DRM. The
   * divisional officer could therefore not be stored at all: the insert was
   * refused by the database and swallowed by INSERT OR IGNORE, so the account
   * was missing and nothing reported it.
   *
   * SQLite cannot alter a CHECK in place, so the table is rebuilt. There are
   * no indexes or triggers on users, which makes this the simple form of that
   * operation; foreign keys are suspended for the swap because many tables
   * reference users(id), and the ids are carried across unchanged.
   */
  const userTableSql = (db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'")
    .get() as { sql?: string } | undefined)?.sql || '';

  if (userTableSql && !userTableSql.includes("'DRM'")) {
    const cols = (db.prepare('PRAGMA table_info(users)').all() as any[]).map((c) => c.name);
    const columnList = cols.join(', ');
    const rebuilt = userTableSql
      .replace(/CREATE TABLE\s+(IF NOT EXISTS\s+)?["'`]?users["'`]?/i, 'CREATE TABLE users_rolefix')
      .replace(
        /CHECK\s*\(\s*role\s+IN\s*\([^)]*\)\s*\)/i,
        "CHECK(role IN ('INSPECTOR', 'SUPERVISOR', 'ADMIN', 'DRM'))"
      );

    rebuildAtomically(db, 'users rebuild', () => {
      db.exec(rebuilt);
      // Roles are normalised on the way across, so a row stored as "Admin"
      // under the old constraint survives the move to the new one.
      db.exec(`
        INSERT INTO users_rolefix (${columnList})
        SELECT ${cols.map((c) => (c === 'role' ? 'UPPER(TRIM(role)) AS role' : c)).join(', ')}
        FROM users;
      `);
      db.exec('DROP TABLE users;');
      db.exec('ALTER TABLE users_rolefix RENAME TO users;');
    });
  }

  /*
   * Who decided a checklist item's status: a person, or a measurement.
   *
   * Spring rows are refreshed from the latest Phase-1 measurement every time
   * the checklist is read, which is right when nobody has looked at the part
   * and catastrophic when somebody has. A supervisor could condemn a spring
   * by hand — "visible transverse crack near second coil" — and the next read
   * would rewrite it to PASS and replace the note with "Auto-linked from
   * spring measurement: 258.5mm". The condemnation and the evidence both
   * vanished, with no audit entry, and the exit gate then counted the item as
   * passed.
   *
   * Free height is one failure mode out of several. A cracked spring measures
   * perfectly, so a passing measurement can only ever mean "the height is in
   * band" — never "the part is good", and never enough to overturn somebody
   * who has looked at it.
   *
   * `phase1_inspection_id` could not carry this: it stays set after a human
   * edits a row that was previously auto-linked, which is exactly the case
   * that went wrong. So the human verdict is marked explicitly.
   *
   * Existing rows default to NULL — unmarked — because there is no way to
   * tell after the fact which of them a person set. They behave as before
   * until somebody touches them again.
   */
  const chkCols = db.prepare("PRAGMA table_info(checklist_items)").all() as any[];
  for (const [name, ddl] of [
    ['manual_verdict_at', 'TEXT DEFAULT NULL'],
    ['manual_verdict_by', 'TEXT DEFAULT NULL']
  ] as [string, string][]) {
    if (chkCols.length > 0 && !chkCols.some((c) => c.name === name)) {
      db.exec(`ALTER TABLE checklist_items ADD COLUMN ${name} ${ddl};`);
    }
  }

  /*
   * Photographs of sorted springs, each carrying the verdict a person gave it.
   *
   * WHY THIS TABLE AND NOT A CLASSIFIER
   * -----------------------------------
   * The ask is for a camera to name a spring's G-95 band. That cannot be done
   * from a photograph of a spring on its own, and the reason is geometry
   * rather than effort: a monocular image carries no scale. A small spring
   * near the lens and a large one further away are the same picture. The
   * bands are 2-3mm wide on a spring 245-290mm tall, so placing one correctly
   * needs better than +/-0.4% absolute accuracy, and there is nothing in the
   * frame to measure against.
   *
   * The two references that would fix it are the gauge post (excluded — the
   * spring is to be shot on its own) and the spring's own wire diameter,
   * which this system does not hold for any type. Inventing one would put a
   * fabricated number underneath every verdict the camera gave.
   *
   * So no band is produced from an image. What is produced is the thing that
   * would let one be built and, more importantly, MEASURED: every photograph
   * stored here is labelled with the verdict the inspector gave the spring in
   * front of them. The tap is the label. A few weeks of ordinary sorting
   * yields a real dataset from this shop, this lighting and these springs,
   * against which any future model can be scored before anybody trusts it.
   *
   * It earns its place before that day arrives: a photograph attached to a
   * condemnation is evidence, which is the half of this system CRIS cares
   * about.
   */
  db.exec(`
    CREATE TABLE IF NOT EXISTS spring_images (
      id TEXT PRIMARY KEY,
      sorting_record_id TEXT DEFAULT NULL,
      batch_id TEXT NOT NULL,
      bogie_type TEXT NOT NULL,
      spring_condition TEXT NOT NULL,
      spring_position TEXT NOT NULL,
      -- The verdict a person gave this spring. This is the label.
      labelled_band TEXT DEFAULT NULL,
      labelled_status TEXT NOT NULL,
      measured_height REAL DEFAULT NULL,
      mime_type TEXT NOT NULL DEFAULT 'image/jpeg',
      image_data TEXT NOT NULL,
      width INTEGER DEFAULT NULL,
      height INTEGER DEFAULT NULL,
      inspector_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      FOREIGN KEY (inspector_id) REFERENCES users(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS idx_spring_images_batch ON spring_images(batch_id);
    CREATE INDEX IF NOT EXISTS idx_spring_images_label
      ON spring_images(bogie_type, spring_condition, spring_position, labelled_band);
    CREATE INDEX IF NOT EXISTS idx_spring_images_record ON spring_images(sorting_record_id);
    -- Evidence, so append-only like every other measurement in this system.
    CREATE TRIGGER IF NOT EXISTS trg_prevent_spring_image_update
    BEFORE UPDATE ON spring_images
    BEGIN
      SELECT RAISE(ABORT, 'Spring evidence images are immutable and cannot be updated.');
    END;
    CREATE TRIGGER IF NOT EXISTS trg_prevent_spring_image_delete
    BEFORE DELETE ON spring_images
    BEGIN
      SELECT RAISE(ABORT, 'Spring evidence images are immutable and cannot be deleted.');
    END;
  `);

  // Learned parameter history — see the table comment in schema.sql.
  db.exec(`
    CREATE TABLE IF NOT EXISTS learned_parameter_history (
      id TEXT PRIMARY KEY,
      param_key TEXT NOT NULL,
      subsystem TEXT NOT NULL,
      previous_value REAL NOT NULL,
      proposed_value REAL NOT NULL,
      applied_value REAL DEFAULT NULL,
      decision TEXT NOT NULL CHECK(decision IN ('APPROVED', 'REJECTED')),
      rationale TEXT DEFAULT NULL,
      sample_size INTEGER DEFAULT NULL,
      decided_by TEXT NOT NULL,
      decided_by_name TEXT DEFAULT NULL,
      decided_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS idx_param_history ON learned_parameter_history(param_key, decided_at);
    CREATE TRIGGER IF NOT EXISTS trg_prevent_param_history_update
    BEFORE UPDATE ON learned_parameter_history
    BEGIN
      SELECT RAISE(ABORT, 'Audit log is strictly append-only. Learned parameter history is immutable and cannot be updated.');
    END;
    CREATE TRIGGER IF NOT EXISTS trg_prevent_param_history_delete
    BEFORE DELETE ON learned_parameter_history
    BEGIN
      SELECT RAISE(ABORT, 'Audit log is strictly append-only. Learned parameter history is immutable and cannot be deleted.');
    END;
  `);

  /*
   * Admit MEASUREMENT_ANOMALY to the learning ledger.
   *
   * The subsystem CHECK listed five values and the anomaly check is a sixth,
   * so every attempt to record a flagged reading was refused by the database.
   * The sorting route catches and swallows that failure deliberately — a
   * ledger write must never cost an inspector their tap — with the result that
   * the writes failed silently and the ledger simply stayed empty. This is the
   * same drift that had already occurred once between AuditEventType and the
   * audit log's own CHECK, and it is worth naming as a pattern: the constraint
   * is the authority, and a widened TypeScript union without a matching
   * migration is not a change, it is a silent no-op.
   *
   * SQLite cannot alter a CHECK in place, so the table is rebuilt. Dropping a
   * table takes its indexes and triggers with it, and this one carries the two
   * append-only triggers that make the ledger evidence rather than notes — so
   * all five objects are recreated explicitly after the swap. Losing them
   * silently would leave a ledger that looks intact and can be rewritten.
   */
  const mlTableSql = (db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='machine_learning_events'")
    .get() as { sql?: string } | undefined)?.sql || '';

  if (mlTableSql && !mlTableSql.includes("'PART_VISION'")) {
    const cols = (db.prepare('PRAGMA table_info(machine_learning_events)').all() as any[]).map(
      (c) => c.name
    );
    const columnList = cols.join(', ');
    const rebuilt = mlTableSql
      .replace(
        /CREATE TABLE\s+(IF NOT EXISTS\s+)?["'`]?machine_learning_events["'`]?/i,
        'CREATE TABLE machine_learning_events_subsysfix'
      )
      .replace(
        /CHECK\s*\(\s*subsystem\s+IN\s*\([^)]*\)\s*\)/i,
        "CHECK(subsystem IN ('OCR_CALIPER', 'SPRING_CLASSIFICATION', 'VOICE_COMMAND', " +
          "'ACOUSTIC_DIAGNOSTIC', 'DEFECT_SUGGESTION', 'MEASUREMENT_ANOMALY', " +
          "'WAGON_NUMBER_OCR', 'SPRING_VISION', 'PART_VISION'))"
      );

    rebuildAtomically(db, 'machine_learning_events rebuild', () => {
      // Must go before the table they guard, or the swap is refused.
      db.exec('DROP TRIGGER IF EXISTS trg_mle_no_update;');
      db.exec('DROP TRIGGER IF EXISTS trg_mle_no_delete;');

      db.exec(rebuilt);
      db.exec(`
        INSERT INTO machine_learning_events_subsysfix (${columnList})
        SELECT ${columnList} FROM machine_learning_events;
      `);
      db.exec('DROP TABLE machine_learning_events;');
      db.exec('ALTER TABLE machine_learning_events_subsysfix RENAME TO machine_learning_events;');

      db.exec(
        'CREATE INDEX IF NOT EXISTS idx_mle_subsystem ON machine_learning_events(subsystem, created_at DESC);'
      );
      db.exec(
        'CREATE INDEX IF NOT EXISTS idx_mle_corrected ON machine_learning_events(subsystem, was_corrected);'
      );
      db.exec(
        'CREATE INDEX IF NOT EXISTS idx_mle_created ON machine_learning_events(created_at DESC);'
      );

      db.exec(`
        CREATE TRIGGER IF NOT EXISTS trg_mle_no_update
        BEFORE UPDATE ON machine_learning_events
        BEGIN
          SELECT RAISE(ABORT, 'Machine learning event ledger is strictly append-only.');
        END;
      `);
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS trg_mle_no_delete
        BEFORE DELETE ON machine_learning_events
        BEGIN
          SELECT RAISE(ABORT, 'Machine learning event ledger is strictly append-only.');
        END;
      `);
    });
  }


  /*
   * What the camera has learned.
   *
   * Each row is one photograph a person labelled, reduced to the 1280 numbers
   * MobileNet uses to describe an image. The photograph itself is not here —
   * it is already kept as evidence in spring_images or wagon_photos under
   * their own append-only rules, and this row points back at it.
   *
   * WHY THE EMBEDDING AND NOT THE IMAGE
   * A photograph is 200 KB and an embedding is 5 KB, so three thousand of them
   * is 15 MB rather than 600 MB. That difference is what lets everything the
   * camera knows sit inside the database the weekly backup already carries off
   * the machine. Format the shop PC and restore the backup, and the camera
   * still recognises what it recognised before — which is not true of anything
   * that lives in a browser's storage on one bench.
   *
   * WHY IT IS ON THE SERVER AT ALL
   * Three benches each learning privately is three brains, each a third as
   * good, and each unable to help a new inspector on their first day. One
   * shared list means a spring taught at the sorting bench is recognised at
   * the assembly bay an hour later.
   *
   * WHY APPEND-ONLY, LIKE EVERYTHING ELSE HERE
   * These rows are the evidence for why the camera said what it said. An
   * inspector defending a condemnation can be shown the exact photographs that
   * produced the answer. That is only worth anything if nobody can quietly
   * revise them afterwards, so the same two triggers guard this table as guard
   * the inspection records themselves.
   *
   * There is deliberately no BAND head, and the CHECK below enforces it. A
   * band is 2 to 3mm on a component 245 to 290mm tall and a photograph carries
   * no scale, so a technique that measures how alike two pictures look would
   * be confident and wrong. Bands come from the strip or the caliper.
   */
  db.exec(`
    CREATE TABLE IF NOT EXISTS vision_examples (
      id TEXT PRIMARY KEY,
      domain TEXT NOT NULL CHECK(domain IN ('SPRING', 'WAGON_PART')),
      head TEXT NOT NULL CHECK(head IN ('CATEGORY', 'SURFACE', 'DAMAGE', 'PART_ID')),
      -- The person's answer. This is the truth; the camera only guesses at it.
      label TEXT NOT NULL,
      -- base64 of a Float32Array(1280), unit length.
      embedding TEXT NOT NULL,
      -- Points at the photograph this was taken from, so any answer can be
      -- traced back to pictures a person can actually look at.
      source_image_id TEXT DEFAULT NULL,
      /*
       * A small JPEG of the crop the embedding was taken from — about 3 KB at
       * 96 pixels square, against 5 KB for the embedding itself.
       *
       * Worth the space because of what it buys: an inspector defending a
       * condemnation can be shown the actual photographs that produced the
       * camera's answer, side by side with the spring in their hand. A trained
       * network cannot do that — it has no examples left to point at, only
       * weights — and it is the single strongest reason to prefer this
       * approach here over a conventional model.
       *
       * Nullable, because a teaching is still worth keeping if the thumbnail
       * could not be made, and because rows written before this column existed
       * are still perfectly good examples.
       */
      thumbnail TEXT DEFAULT NULL,
      part_name TEXT DEFAULT NULL,
      bogie_position TEXT DEFAULT NULL,
      -- Whether the camera had proposed something, and what. Kept so the
      -- corrections can be told apart from the first teachings later.
      proposed_label TEXT DEFAULT NULL,
      was_correction INTEGER NOT NULL DEFAULT 0,
      taught_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      FOREIGN KEY (taught_by) REFERENCES users(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS idx_vision_examples_head ON vision_examples(domain, head, label);
    CREATE INDEX IF NOT EXISTS idx_vision_examples_created ON vision_examples(created_at DESC);
    CREATE TRIGGER IF NOT EXISTS trg_vision_examples_no_update
    BEFORE UPDATE ON vision_examples
    BEGIN
      SELECT RAISE(ABORT, 'What the camera was taught is evidence and cannot be rewritten.');
    END;
    CREATE TRIGGER IF NOT EXISTS trg_vision_examples_no_delete
    BEFORE DELETE ON vision_examples
    BEGIN
      SELECT RAISE(ABORT, 'What the camera was taught is evidence and cannot be deleted.');
    END;
  `);

  // vision_examples predates its thumbnail column on any database created
  // between the two. Added rather than rebuilt: the table's append-only
  // triggers make a rebuild expensive, and a NULL thumbnail is a valid state.
  const vexCols = db.prepare("PRAGMA table_info(vision_examples)").all() as any[];
  if (vexCols.length > 0 && !vexCols.some((c) => c.name === 'thumbnail')) {
    db.exec('ALTER TABLE vision_examples ADD COLUMN thumbnail TEXT DEFAULT NULL;');
  }
  /*
   * One id per physical part per sitting, shared by every frame and head
   * taught from it, so the leave-one-out score can hide the whole sitting
   * rather than one row and be answered by its twin. NULL on anything taught
   * before this existed; shared/vision/knn.ts falls back to a similarity
   * check for those, and reports how many it had to hide that way.
   */
  if (vexCols.length > 0 && !vexCols.some((c) => c.name === 'capture_group')) {
    db.exec('ALTER TABLE vision_examples ADD COLUMN capture_group TEXT DEFAULT NULL;');
  }

  /*
   * What came off the wagon, and what went back on.
   *
   * THE QUESTION THIS ANSWERS
   * The DRM's worry, in his own words, is what happens after a wagon leaves:
   * that nobody should be able to ask whether something was missing, or
   * whether a part went back rusted or damaged, and get no answer. A count of
   * checklist lines does not answer that. What answers it is a ledger — every
   * part recorded coming off during dismantling, every part recorded going
   * back on during reassembly, and the difference named at the gate.
   *
   * WHY EVENTS AND NOT A TALLY
   * A running total can be corrected until it agrees with itself, which is
   * exactly the property that makes it worthless as evidence. Each row here is
   * one thing that happened, at a stage, by a named person, at a time, with a
   * photograph where one was taken. The balance is derived from them and can
   * never disagree with them.
   *
   * WHY NOT_FITTED IS AN EVENT
   * A part that came off and is deliberately not going back — a fitting this
   * wagon type does not carry, or one condemned with no replacement due — must
   * be recordable as a decision by a person, with a reason. Otherwise the only
   * way to balance the ledger is to lie in it, and a ledger people have to lie
   * in to close a wagon is worse than no ledger.
   */
  db.exec(`
    CREATE TABLE IF NOT EXISTS wagon_part_ledger (
      id TEXT PRIMARY KEY,
      wagon_id TEXT NOT NULL,
      wagon_number TEXT NOT NULL,
      -- Identifies the physical position, so two side frames on one bogie are
      -- two entries rather than one part counted twice.
      part_key TEXT NOT NULL,
      category TEXT NOT NULL,
      part_name TEXT NOT NULL,
      bogie_position TEXT NOT NULL DEFAULT 'NONE',
      event TEXT NOT NULL CHECK(event IN
        ('REMOVED', 'REFITTED', 'REPLACED', 'SCRAPPED', 'NOT_FITTED')),
      quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity > 0),
      -- Required by the route for NOT_FITTED and SCRAPPED: a part that is not
      -- going back needs a stated reason, not a silent absence.
      reason TEXT DEFAULT NULL,
      photo_id TEXT DEFAULT NULL,
      -- Where a replacement came from, so a new part's provenance is on the
      -- record beside the old part's removal.
      stores_item_id TEXT DEFAULT NULL,
      component_serial TEXT DEFAULT NULL,
      stage TEXT NOT NULL,
      inspector_id TEXT NOT NULL,
      inspector_name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      FOREIGN KEY (wagon_id) REFERENCES wagons(id) ON DELETE RESTRICT,
      FOREIGN KEY (inspector_id) REFERENCES users(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS idx_wpl_wagon ON wagon_part_ledger(wagon_id, part_key);
    CREATE INDEX IF NOT EXISTS idx_wpl_number ON wagon_part_ledger(wagon_number, created_at DESC);
    -- Evidence, so append-only like every other measurement in this system.
    CREATE TRIGGER IF NOT EXISTS trg_wpl_no_update
    BEFORE UPDATE ON wagon_part_ledger
    BEGIN
      SELECT RAISE(ABORT, 'The parts ledger records what happened and cannot be rewritten.');
    END;
    CREATE TRIGGER IF NOT EXISTS trg_wpl_no_delete
    BEFORE DELETE ON wagon_part_ledger
    BEGIN
      SELECT RAISE(ABORT, 'The parts ledger records what happened and cannot be deleted.');
    END;
  `);

  /*
   * How many of each part a wagon of this type actually carries.
   *
   * WHY THIS WAS MISSING, AND WHY IT MATTERS
   * checklist_config has always known WHICH parts a wagon type has and WHERE
   * they sit. It has never known HOW MANY. That was survivable while the
   * checklist was the only consumer — a line is inspected or it is not,
   * regardless of how many physical pieces it covers — but it is not
   * survivable for the parts ledger, which has to answer "is anything
   * missing".
   *
   * Without an expected count the ledger can only compare what went back on
   * against what somebody recorded coming off. If nobody recorded the removal,
   * it can say nothing at all. With one, a wagon can be measured against what
   * it is supposed to have, which is the question actually being asked.
   *
   * WHY source AND verified, AND WHY THE DEFAULT IS UNVERIFIED
   * Copied deliberately from SPRING_COUNTS in springCounts.ts, which carries
   * the same two fields for the same reason: a count with no cited source is
   * somebody's recollection, and a recollection printed on a release
   * certificate becomes a fact nobody can trace.
   *
   * So every existing row gets 1, marked NOT verified. One is the safe
   * default — it is right for the many genuinely single parts, and where it is
   * wrong it under-counts, which shows up as a position that looks complete
   * rather than a wagon falsely accused of missing parts.
   *
   * We do not fill these in ourselves. This shop has been burned by that
   * before: fourteen MK-50 coupler items were built from photographs of gauge
   * boards the shop turned out not to use, and every wagon's exit gate was
   * permanently blocked as a result. The note left in checklistTemplate.ts is
   * the lesson — a photograph of a board is evidence that a board exists, not
   * evidence of what the shop does. The counts come from the shop, through the
   * checklist editor, with a source against each.
   */
  const ccCols = db.prepare("PRAGMA table_info(checklist_config)").all() as any[];
  if (ccCols.length > 0 && !ccCols.some((c) => c.name === 'expected_quantity')) {
    db.exec("ALTER TABLE checklist_config ADD COLUMN expected_quantity INTEGER NOT NULL DEFAULT 1;");
    db.exec("ALTER TABLE checklist_config ADD COLUMN quantity_source TEXT DEFAULT NULL;");
    db.exec("ALTER TABLE checklist_config ADD COLUMN quantity_verified INTEGER NOT NULL DEFAULT 0;");
  }

  /*
   * Widen measurement_source on inspections to admit the two camera values.
   *
   * THE FAULT THIS FIXES
   * CAMERA_ASSISTED was added to the MeasurementSource union with no
   * migration. The CHECK on this column still said ('MANUAL', 'OCR'), so the
   * first inspection written with the new value would have been refused by
   * the database -- and the sorting route swallows write failures
   * deliberately, because a ledger write must never cost an inspector their
   * tap. The result would have been a camera that appeared to work and
   * recorded nothing. This is the drift the machine_learning_events rebuild
   * above already names as a pattern, and it happened again here because
   * nothing guarded it. server/tests/measurement-source-drift.test.ts now
   * does.
   *
   * SQLite cannot alter a CHECK in place, so the table is rebuilt. This one
   * is the inspection record itself: append-only by trigger, hash-chained
   * through the audit log, seven indexes, and a foreign-key target for
   * checklist_items. So every object is recreated explicitly after the swap,
   * foreign keys are off for the duration, and the row count is checked
   * before the old table is dropped -- losing an inspection here silently
   * would be worse than the fault being fixed.
   */
  const inspSql = (db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='inspections'")
    .get() as { sql?: string } | undefined)?.sql || '';

  if (inspSql && !inspSql.includes("'CAMERA_AUTO'")) {
    const cols = (db.prepare('PRAGMA table_info(inspections)').all() as any[]).map((c) => c.name);
    const columnList = cols.join(', ');
    const rebuilt = inspSql
      .replace(/CREATE TABLE\s+(IF NOT EXISTS\s+)?["'`]?inspections["'`]?/i, 'CREATE TABLE inspections_srcfix')
      .replace(
        /CHECK\s*\(\s*measurement_source\s+IN\s*\([^)]*\)\s*\)/i,
        "CHECK(measurement_source IN ('MANUAL', 'OCR', 'CAMERA_ASSISTED', 'CAMERA_AUTO'))"
      );
    if (!rebuilt.includes("'CAMERA_AUTO'")) {
      throw new Error('inspections rebuild: the measurement_source CHECK was not found to widen');
    }

    const before = Number((db.prepare('SELECT COUNT(*) AS c FROM inspections').get() as any).c);

    rebuildAtomically(db, 'inspections rebuild', () => {
      db.exec('DROP TRIGGER IF EXISTS trg_prevent_inspections_update;');
      db.exec('DROP TRIGGER IF EXISTS trg_prevent_inspections_delete;');

      db.exec(rebuilt);
      db.exec(`INSERT INTO inspections_srcfix (${columnList}) SELECT ${columnList} FROM inspections;`);

      const after = Number((db.prepare('SELECT COUNT(*) AS c FROM inspections_srcfix').get() as any).c);
      if (after !== before) {
        // The rollback discards the copy; the throw says why.
        throw new Error(`${before} rows before, ${after} after -- refusing to continue`);
      }

      db.exec('DROP TABLE inspections;');
      db.exec('ALTER TABLE inspections_srcfix RENAME TO inspections;');

      for (const ddl of [
        'CREATE INDEX IF NOT EXISTS idx_inspections_created_at ON inspections(created_at DESC);',
        'CREATE INDEX IF NOT EXISTS idx_inspections_wagon_created ON inspections(wagon_number, created_at DESC);',
        'CREATE INDEX IF NOT EXISTS idx_inspections_inspector_date ON inspections(inspector_id, created_at DESC);',
        'CREATE INDEX IF NOT EXISTS idx_inspections_band_status ON inspections(classified_band, status, created_at DESC);',
        'CREATE INDEX IF NOT EXISTS idx_inspections_status_date ON inspections(status, created_at DESC);',
        'CREATE INDEX IF NOT EXISTS idx_inspections_bogie_cond_pos ON inspections(bogie_type, spring_condition, spring_position);',
        'CREATE INDEX IF NOT EXISTS idx_inspections_sync_id ON inspections(sync_id);'
      ]) {
        db.exec(ddl);
      }

      db.exec(`
        CREATE TRIGGER IF NOT EXISTS trg_prevent_inspections_update
        BEFORE UPDATE ON inspections
        BEGIN
          SELECT RAISE(ABORT, 'Audit log is strictly append-only. Inspection records are immutable and cannot be updated.');
        END;
      `);
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS trg_prevent_inspections_delete
        BEFORE DELETE ON inspections
        BEGIN
          SELECT RAISE(ABORT, 'Audit log is strictly append-only. Inspection records are immutable and cannot be deleted.');
        END;
      `);
    });
  }

  /*
   * The sorting bench and the wagon checklist never recorded HOW a verdict
   * was arrived at, because until now the answer was always "a person". Once
   * the camera can decide unconfirmed, that has to be on the row -- it is
   * what lets a supervisor pull the auto-decided ones for a blind re-check,
   * and what stops a camera decision being mistaken for a person's later.
   */
  const ssrCols = db.prepare('PRAGMA table_info(spring_sorting_records)').all() as any[];
  if (ssrCols.length > 0 && !ssrCols.some((c) => c.name === 'measurement_source')) {
    db.exec(
      "ALTER TABLE spring_sorting_records ADD COLUMN measurement_source TEXT NOT NULL DEFAULT 'MANUAL' " +
        "CHECK(measurement_source IN ('MANUAL', 'OCR', 'CAMERA_ASSISTED', 'CAMERA_AUTO'));"
    );
  }
  const ciCols = db.prepare('PRAGMA table_info(checklist_items)').all() as any[];
  if (ciCols.length > 0 && !ciCols.some((c) => c.name === 'verdict_source')) {
    db.exec(
      "ALTER TABLE checklist_items ADD COLUMN verdict_source TEXT NOT NULL DEFAULT 'MANUAL' " +
        "CHECK(verdict_source IN ('MANUAL', 'OCR', 'CAMERA_ASSISTED', 'CAMERA_AUTO'));"
    );
  }

  // A declared principal for actions the system performs itself.
  //
  // Audit rows carry a foreign key to users, so an event with no human actor
  // had nowhere valid to point — which is why checklist verdicts written by a
  // direct repository call were silently not logged at all. This is a real,
  // deliberate row rather than a ghost conjured on demand, and it cannot be
  // signed into: is_active is 0, and its stored hash is not a valid PBKDF2
  // record, so with the unsalted-SHA-256 fallback removed nothing can ever
  // verify against it.
  db.exec(
    "INSERT OR IGNORE INTO users (id, username, password_hash, role, full_name, employee_id, is_active) " +
    "VALUES ('usr_system', 'system', 'NO_LOGIN', 'ADMIN', 'System (automated actions)', 'WRS-SYSTEM', 0);"
  );

  /*
   * Photographs as files, with their hash on the row.
   *
   * See server/src/db/photoStore.ts. New photographs are written beside the
   * database and image_data holds `file:<path>`; the SHA-256 of the bytes
   * lives here so a reader can tell an altered file from the evidence. Rows
   * written before this keep their inline base64 and a NULL hash — they are
   * read as they always were. spring_images is append-only, so its rows
   * could not be rewritten in any case.
   */
  for (const table of ['wagon_photos', 'spring_images']) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
    if (cols.length > 0 && !cols.some((c) => c.name === 'sha256')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN sha256 TEXT DEFAULT NULL;`);
    }
  }

  /*
   * The shadow run, written down where it happens.
   *
   * docs/SHADOW_MODE_FORMS.md asked for two paper forms: one line per
   * disagreement between the app and the register, and one summary per
   * shift. Paper is fine, and these are the same forms as screens, with
   * the app's half of every figure filled in from its own records — the
   * supervisor writes only what the app cannot know: what the register
   * said, who was right, why, and the minutes on paper.
   *
   * Append-only, like every other record here. A discrepancy written down
   * and later found to be wrong is corrected by another row that
   * `supersedes` it; both survive, because a log that can be tidied after
   * the fact is not the evidence CRIS or RDSO will be shown.
   */
  db.exec(`
    CREATE TABLE IF NOT EXISTS shadow_discrepancies (
      id TEXT PRIMARY KEY,
      occurred_on TEXT NOT NULL,
      shift TEXT NOT NULL,
      inspector_name TEXT NOT NULL,
      wagon_number TEXT DEFAULT NULL,
      location TEXT DEFAULT NULL,
      register_says TEXT NOT NULL,
      app_says TEXT NOT NULL,
      register_verdict TEXT NOT NULL CHECK(register_verdict IN ('PASS', 'CONDEMNED', 'OTHER')),
      app_verdict TEXT NOT NULL CHECK(app_verdict IN ('PASS', 'CONDEMNED', 'OTHER')),
      who_was_right TEXT NOT NULL CHECK(who_was_right IN ('APP', 'REGISTER', 'BOTH_WRONG', 'UNRESOLVED')),
      cause TEXT NOT NULL CHECK(cause IN ('BAND_MISREAD', 'WRONG_SPRING', 'OFF_STRIP_JUDGEMENT', 'CONFIGURATION', 'NEST_GROUPING', 'APP_COULD_NOT_ANSWER', 'DEVICE', 'OTHER')),
      why TEXT DEFAULT NULL,
      would_have_stopped_a_wagon INTEGER NOT NULL DEFAULT 0 CHECK(would_have_stopped_a_wagon IN (0, 1)),
      supersedes TEXT DEFAULT NULL,
      reported_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      FOREIGN KEY (reported_by) REFERENCES users(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS idx_shadow_disc_day ON shadow_discrepancies(occurred_on);
    CREATE TRIGGER IF NOT EXISTS trg_shadow_disc_no_update BEFORE UPDATE ON shadow_discrepancies
    BEGIN SELECT RAISE(ABORT, 'The shadow-run log is evidence and cannot be rewritten; add a correcting row.'); END;
    CREATE TRIGGER IF NOT EXISTS trg_shadow_disc_no_delete BEFORE DELETE ON shadow_discrepancies
    BEGIN SELECT RAISE(ABORT, 'The shadow-run log is evidence and cannot be deleted.'); END;

    CREATE TABLE IF NOT EXISTS shadow_daily_summaries (
      id TEXT PRIMARY KEY,
      summary_date TEXT NOT NULL,
      shift TEXT NOT NULL,
      supervisor_id TEXT NOT NULL,
      -- The register's half. The app's half is computed at read time.
      register_minutes_one_wagon REAL DEFAULT NULL,
      app_minutes_one_wagon REAL DEFAULT NULL,
      transcription_errors_box_missed INTEGER NOT NULL DEFAULT 0,
      what_app_got_wrong TEXT DEFAULT NULL,
      what_app_caught TEXT DEFAULT NULL,
      what_slowed TEXT DEFAULT NULL,
      would_have_stopped_a_wagon TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      FOREIGN KEY (supervisor_id) REFERENCES users(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS idx_shadow_sum_day ON shadow_daily_summaries(summary_date, shift);
    CREATE TRIGGER IF NOT EXISTS trg_shadow_sum_no_update BEFORE UPDATE ON shadow_daily_summaries
    BEGIN SELECT RAISE(ABORT, 'A shift summary is evidence and cannot be rewritten; write another for the same shift.'); END;
    CREATE TRIGGER IF NOT EXISTS trg_shadow_sum_no_delete BEFORE DELETE ON shadow_daily_summaries
    BEGIN SELECT RAISE(ABORT, 'A shift summary is evidence and cannot be deleted.'); END;
  `);

  /*
   * Passports from other shops — or this one, earlier.
   *
   * See server/src/reports/wagonPassport.ts. A wagon arriving for its next
   * overhaul may bring the file its last shop sealed. The whole file is kept
   * as it came, with what the import found: the issuing key's fingerprint,
   * whether the chain and seal verified, and whether that key is this
   * server's own. Nothing from the file is merged into this shop's tables —
   * it is the previous shop's record and is shown as such, alongside this
   * shop's. Append-only: a passport once imported is part of the wagon's
   * history here.
   */
  db.exec(`
    CREATE TABLE IF NOT EXISTS wagon_passports (
      id TEXT PRIMARY KEY,
      wagon_number TEXT NOT NULL,
      issuer_name TEXT NOT NULL,
      issuer_fingerprint TEXT NOT NULL,
      issued_by_this_server INTEGER NOT NULL CHECK(issued_by_this_server IN (0, 1)),
      exported_at TEXT NOT NULL,
      events INTEGER NOT NULL,
      terminal_hash TEXT NOT NULL,
      passport_jsonl TEXT NOT NULL,
      imported_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      UNIQUE (wagon_number, terminal_hash),
      FOREIGN KEY (imported_by) REFERENCES users(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS idx_wagon_passports_wagon ON wagon_passports(wagon_number);
    CREATE TRIGGER IF NOT EXISTS trg_wagon_passports_no_update BEFORE UPDATE ON wagon_passports
    BEGIN SELECT RAISE(ABORT, 'An imported passport is another shop\'\'s record and cannot be rewritten.'); END;
    CREATE TRIGGER IF NOT EXISTS trg_wagon_passports_no_delete BEFORE DELETE ON wagon_passports
    BEGIN SELECT RAISE(ABORT, 'An imported passport is another shop\'\'s record and cannot be deleted.'); END;
  `);

  /*
   * Pocket counts on assembly photographs.
   *
   * See shared/assembly/pocketCount.ts and docs/ASSEMBLY_COMPLETENESS.md. A
   * count is a set of marks a person made on one frame of an open bogie —
   * a label on a photograph, and the whole of the labelled dataset any
   * later model would be trained and judged on. The expected number is NOT
   * stored: it is derived from the wagon designation every time it is
   * compared, so a copy cannot drift from the registry. What is stored is
   * what the counter saw (the taps), tallied, and who saw it.
   *
   * FIRST is the first count of a frame; BLIND_RECOUNT is a second person's
   * count made without seeing the first, which is where the agreement
   * figure comes from. Append-only: a count that turns out wrong is
   * followed by another, and both survive.
   */
  db.exec(`
    CREATE TABLE IF NOT EXISTS bogie_pocket_counts (
      id TEXT PRIMARY KEY,
      photo_id TEXT NOT NULL,
      wagon_number TEXT NOT NULL,
      designation TEXT NOT NULL,
      bogie TEXT NOT NULL CHECK(bogie IN ('BOGIE_1', 'BOGIE_2')),
      side TEXT NOT NULL CHECK(side IN ('SIDE_A', 'SIDE_B')),
      kind TEXT NOT NULL CHECK(kind IN ('FIRST', 'BLIND_RECOUNT')),
      counted_outer INTEGER NOT NULL,
      counted_inner INTEGER NOT NULL,
      counted_snubber INTEGER NOT NULL,
      taps_json TEXT NOT NULL,
      counted_by TEXT NOT NULL,
      counted_by_name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      FOREIGN KEY (photo_id) REFERENCES wagon_photos(id) ON DELETE RESTRICT,
      FOREIGN KEY (counted_by) REFERENCES users(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS idx_pocket_counts_photo ON bogie_pocket_counts(photo_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_pocket_counts_wagon ON bogie_pocket_counts(wagon_number);
    CREATE TRIGGER IF NOT EXISTS trg_pocket_counts_no_update BEFORE UPDATE ON bogie_pocket_counts
    BEGIN SELECT RAISE(ABORT, 'A pocket count is a label on evidence and cannot be rewritten; count again.'); END;
    CREATE TRIGGER IF NOT EXISTS trg_pocket_counts_no_delete BEFORE DELETE ON bogie_pocket_counts
    BEGIN SELECT RAISE(ABORT, 'A pocket count is a label on evidence and cannot be deleted.'); END;
  `);

  /*
   * Wheel readings — the chalk on the wheel disc, kept.
   *
   * See shared/classification/wheelLimits.ts. Eight wheels per wagon, each
   * read for tread diameter (and flange thickness, height, root radius, flat
   * and hollow when taken), judged against the limits for the wagon's wheel
   * family at write time and stored with that verdict, the way spring
   * readings are. Append-only: a re-read is a new row, and the latest row per
   * wheel is the one that counts.
   */
  db.exec(`
    CREATE TABLE IF NOT EXISTS wheel_readings (
      id TEXT PRIMARY KEY,
      wagon_number TEXT NOT NULL,
      axle INTEGER NOT NULL CHECK(axle BETWEEN 1 AND 4),
      side TEXT NOT NULL CHECK(side IN ('L', 'R')),
      wheel_family TEXT DEFAULT NULL,
      tread_diameter_mm REAL NOT NULL,
      flange_thickness_mm REAL DEFAULT NULL,
      flange_height_mm REAL DEFAULT NULL,
      root_radius_mm REAL DEFAULT NULL,
      flat_mm REAL DEFAULT NULL,
      hollow_mm REAL DEFAULT NULL,
      verdict TEXT NOT NULL CHECK(verdict IN ('PASS', 'BELOW_SHOP_ISSUE', 'CONDEMN')),
      findings_json TEXT NOT NULL,
      instrument TEXT DEFAULT NULL,
      inspector_id TEXT NOT NULL,
      inspector_name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      FOREIGN KEY (inspector_id) REFERENCES users(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS idx_wheel_readings_wagon ON wheel_readings(wagon_number, axle, side, created_at);
    CREATE TRIGGER IF NOT EXISTS trg_wheel_readings_no_update BEFORE UPDATE ON wheel_readings
    BEGIN SELECT RAISE(ABORT, 'A wheel reading is a record and cannot be rewritten; take another.'); END;
    CREATE TRIGGER IF NOT EXISTS trg_wheel_readings_no_delete BEFORE DELETE ON wheel_readings
    BEGIN SELECT RAISE(ABORT, 'A wheel reading is a record and cannot be deleted.'); END;
  `);

  /*
   * What the offline queue has already delivered.
   *
   * A tablet that loses the wifi between the server committing a batch and
   * the 200 arriving keeps the whole batch queued and sends it again — that
   * is correct, because the alternative is losing an inspector's work. What
   * must then be true is that sending it again changes nothing. For spring
   * readings it always was: inspections and sorting records carry a sync_id
   * with a UNIQUE index. Stage transitions, spoken verdicts and photographs
   * carried nothing, so a resend moved the wagon twice, re-recorded the
   * verdict with a second audit entry, and stored the photograph again.
   *
   * One receipt per (entity, device id) the queue has delivered. The sync
   * route checks it before applying, and writes it after. Append-only, like
   * the record it protects; a receipt that could be deleted would be a
   * duplicate waiting to happen.
   */
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_receipts (
      entity TEXT NOT NULL CHECK(entity IN ('TRANSITION', 'VOICE_ACTION', 'PHOTO')),
      client_temp_id TEXT NOT NULL,
      server_id TEXT DEFAULT NULL,
      actor_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      PRIMARY KEY (entity, client_temp_id)
    ) WITHOUT ROWID;
    CREATE TRIGGER IF NOT EXISTS trg_sync_receipts_no_update
    BEFORE UPDATE ON sync_receipts
    BEGIN
      SELECT RAISE(ABORT, 'A sync receipt records a delivery and cannot be rewritten.');
    END;
    CREATE TRIGGER IF NOT EXISTS trg_sync_receipts_no_delete
    BEFORE DELETE ON sync_receipts
    BEGIN
      SELECT RAISE(ABORT, 'A sync receipt records a delivery and cannot be deleted.');
    END;
  `);

  /*
   * A wagon registered in error.
   *
   * Nothing in this record is deleted, and a wagon is no exception: the DRM's
   * first walk registered "ADSFADS" and then found there was no way to take
   * it back. A void is a mark, not a removal — who, when, why — placed only
   * while the wagon is still at entry with nothing recorded against it, by a
   * supervisor under a one-time code, and written to the audit trail. The
   * pipeline stops showing it; the row and its audit entries stay.
   */
  const wagonCols = db.prepare("PRAGMA table_info(wagons)").all() as any[];
  if (wagonCols.length > 0 && !wagonCols.some((c) => c.name === 'voided_at')) {
    db.exec("ALTER TABLE wagons ADD COLUMN voided_at TEXT DEFAULT NULL;");
    db.exec("ALTER TABLE wagons ADD COLUMN voided_by TEXT DEFAULT NULL;");
    db.exec("ALTER TABLE wagons ADD COLUMN void_reason TEXT DEFAULT NULL;");
  }
}
