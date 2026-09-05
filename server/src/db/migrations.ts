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

    db.exec('PRAGMA foreign_keys = OFF;');
    try {
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
    } finally {
      db.exec('PRAGMA foreign_keys = ON;');
    }
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

  if (mlTableSql && !mlTableSql.includes("'WAGON_NUMBER_OCR'")) {
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
          "'WAGON_NUMBER_OCR'))"
      );

    db.exec('PRAGMA foreign_keys = OFF;');
    try {
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
    } finally {
      db.exec('PRAGMA foreign_keys = ON;');
    }
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
}
