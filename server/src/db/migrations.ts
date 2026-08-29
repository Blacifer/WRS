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
        measurement_source TEXT NOT NULL DEFAULT 'MANUAL' CHECK(measurement_source IN ('MANUAL', 'OCR')),
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
}
