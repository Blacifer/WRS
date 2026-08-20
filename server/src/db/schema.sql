-- =========================================================================
-- Indian Railways WRS Raipur Spring Classification & Inspection System
-- SQLite Schema & Immutable Append-Only Audit Logging Triggers (Phase 1 & Phase 2)
-- =========================================================================

-- 1. Users Table
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

-- 2. OTP Verifications Table
CREATE TABLE IF NOT EXISTS otp_verifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK(action_type IN ('OVERRIDE', 'EXPORT', 'USER_MGMT')),
  otp_code_hash TEXT NOT NULL,
  token_ref TEXT NOT NULL UNIQUE,
  is_used INTEGER NOT NULL DEFAULT 0 CHECK(is_used IN (0, 1)),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  used_at TEXT DEFAULT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
);

-- 3. Core Inspections Table (Strictly Append-Only)
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

-- 4. Inspection Audit Log (Immutable Event Ledger)
CREATE TABLE IF NOT EXISTS inspection_audit_log (
  id TEXT PRIMARY KEY,
  inspection_id TEXT,
  event_type TEXT NOT NULL CHECK(event_type IN (
    'INSPECTION_CREATED', 
    'SUPERVISOR_OVERRIDE_RECORDED', 
    'INSPECTION_SYNCED', 
    'BATCH_EXPORTED', 
    'SECURITY_ALERT',
    'AUTH_LOGIN',
    'OTP_GENERATED',
    'OTP_VERIFIED',
    'WAGON_REGISTERED',
    'WAGON_STAGE_TRANSITION',
    'CHECKLIST_ITEM_INSPECTED',
    'CHECKLIST_ITEM_UPDATED',
    'GATE_SIGNOFF_COMPLETED',
    'CERTIFICATE_GENERATED',
    'PHOTO_UPLOADED',
    'OMRS_TRIAGE_RUN',
    'INVENTORY_RESERVED',
    'INVENTORY_ISSUED',
    'INVENTORY_RESTOCKED',
    'COMPONENT_ASSIGNED',
    'COMPONENT_UNASSIGNED',
    'VOICE_COMMAND_LOGGED',
    'CV_MEASUREMENT_LOGGED',
    'ACOUSTIC_DEFECT_LOGGED'
  )),
  user_id TEXT NOT NULL,
  user_role TEXT NOT NULL,
  ip_address TEXT DEFAULT NULL,
  payload_json TEXT NOT NULL,
  previous_hash TEXT DEFAULT NULL,
  hash TEXT DEFAULT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
);

-- 5. Sequence Tracker Table for Strict Monotonic Sequence Numbers
CREATE TABLE IF NOT EXISTS sequence_tracker (
  name TEXT PRIMARY KEY,
  last_val INTEGER NOT NULL
);
INSERT OR IGNORE INTO sequence_tracker (name, last_val) VALUES ('inspection_seq', 0);

-- =========================================================================
-- Phase 2 Tables: Wagons, Lifecycle, Checklist, Gate & Photos
-- =========================================================================

-- 6. Wagons Table (Master Wagon Registry)
CREATE TABLE IF NOT EXISTS wagons (
  id TEXT PRIMARY KEY,
  wagon_number TEXT NOT NULL UNIQUE,
  wagon_type TEXT NOT NULL,
  owning_railway TEXT NOT NULL,
  current_stage TEXT NOT NULL DEFAULT 'ENTRY_REGISTRATION' CHECK(current_stage IN (
    'ENTRY_REGISTRATION',
    'DISMANTLING',
    'COMPONENT_INSPECTION',
    'REPAIR_REPLACEMENT',
    'REASSEMBLY',
    'FINAL_QC_GATE',
    'RELEASE'
  )),
  status TEXT NOT NULL DEFAULT 'IN_PROGRESS' CHECK(status IN ('IN_PROGRESS', 'BLOCKED', 'RELEASED', 'CONDEMNED', 'HELD')),
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

-- 7. Wagon Transitions Table (Append-Only Lifecycle Ledger)
CREATE TABLE IF NOT EXISTS wagon_transitions (
  id TEXT PRIMARY KEY,
  wagon_id TEXT NOT NULL,
  wagon_number TEXT NOT NULL,
  from_stage TEXT NOT NULL,
  to_stage TEXT NOT NULL,
  transition_type TEXT NOT NULL CHECK(transition_type IN (
    'NORMAL',
    'OVERRIDE_SKIP',
    'OVERRIDE_BACKWARD',
    'GATE_SIGNOFF',
    'REOPEN'
  )),
  performed_by TEXT NOT NULL,
  performer_name TEXT NOT NULL,
  performer_role TEXT NOT NULL,
  is_override INTEGER NOT NULL DEFAULT 0 CHECK(is_override IN (0, 1)),
  override_reason TEXT DEFAULT NULL,
  supervisor_id TEXT DEFAULT NULL,
  supervisor_name TEXT DEFAULT NULL,
  otp_token_ref TEXT DEFAULT NULL,
  notes TEXT DEFAULT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (wagon_id) REFERENCES wagons(id) ON DELETE RESTRICT,
  FOREIGN KEY (performed_by) REFERENCES users(id) ON DELETE RESTRICT
);

-- 8. CASNUB Checklist Items Table
CREATE TABLE IF NOT EXISTS checklist_items (
  id TEXT PRIMARY KEY,
  wagon_id TEXT NOT NULL,
  wagon_number TEXT NOT NULL,
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
  bogie_position TEXT NOT NULL DEFAULT 'NONE' CHECK(bogie_position IN ('BOGIE_1', 'BOGIE_2', 'UNDERFRAME', 'BODY', 'NONE')),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'PASS', 'FAIL', 'CONDEMNED', 'REPAIRED', 'REPLACED')),
  is_mandatory INTEGER NOT NULL DEFAULT 1 CHECK(is_mandatory IN (0, 1)),
  condition_notes TEXT DEFAULT NULL,
  repair_action TEXT DEFAULT NULL CHECK(repair_action IN ('REPAIRED', 'REPLACED_NEW', 'REPLACED_RECONDITIONED', 'NONE') OR repair_action IS NULL),
  repair_notes TEXT DEFAULT NULL,
  reinspected_status TEXT DEFAULT NULL CHECK(reinspected_status IN ('PASS', 'FAIL') OR reinspected_status IS NULL),
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

-- 9. Checklist Master Configuration Table (Per Wagon Type Rules)
CREATE TABLE IF NOT EXISTS checklist_config (
  id TEXT PRIMARY KEY,
  wagon_type TEXT NOT NULL,
  category TEXT NOT NULL,
  part_name TEXT NOT NULL,
  bogie_position TEXT NOT NULL DEFAULT 'NONE',
  is_mandatory INTEGER NOT NULL DEFAULT 1 CHECK(is_mandatory IN (0, 1)),
  standard_reference TEXT DEFAULT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(wagon_type, category, part_name, bogie_position)
);

-- 10. Gate Signoffs Table (Append-Only Digital Sign-off Ledger)
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

-- 11. Wagon Photos Table (Evidence Storage)
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

-- =========================================================================
-- Strict Immutability Triggers (Prevent UPDATE & DELETE)
-- =========================================================================

-- Block any UPDATE on inspections
CREATE TRIGGER IF NOT EXISTS trg_prevent_inspections_update
BEFORE UPDATE ON inspections
BEGIN
  SELECT RAISE(ABORT, 'Audit log is strictly append-only. Inspection records are immutable and cannot be updated.');
END;

-- Block any DELETE on inspections
CREATE TRIGGER IF NOT EXISTS trg_prevent_inspections_delete
BEFORE DELETE ON inspections
BEGIN
  SELECT RAISE(ABORT, 'Audit log is strictly append-only. Inspection records are immutable and cannot be deleted.');
END;

-- Block any UPDATE on inspection_audit_log
CREATE TRIGGER IF NOT EXISTS trg_prevent_audit_log_update
BEFORE UPDATE ON inspection_audit_log
BEGIN
  SELECT RAISE(ABORT, 'Audit log is strictly append-only. Audit log entries are immutable and cannot be updated.');
END;

-- Block any DELETE on inspection_audit_log
CREATE TRIGGER IF NOT EXISTS trg_prevent_audit_log_delete
BEFORE DELETE ON inspection_audit_log
BEGIN
  SELECT RAISE(ABORT, 'Audit log is strictly append-only. Audit log entries are immutable and cannot be deleted.');
END;

-- Automatic audit log entry creation upon inspection insertion
CREATE TRIGGER IF NOT EXISTS trg_auto_log_inspection_insert
AFTER INSERT ON inspections
BEGIN
  INSERT INTO inspection_audit_log (
    id,
    inspection_id,
    event_type,
    user_id,
    user_role,
    payload_json,
    created_at
  ) VALUES (
    lower(hex(randomblob(16))),
    NEW.id,
    CASE WHEN NEW.supervisor_override = 1 THEN 'SUPERVISOR_OVERRIDE_RECORDED' ELSE 'INSPECTION_CREATED' END,
    NEW.inspector_id,
    'INSPECTOR',
    json_object(
      'sequence_number', NEW.sequence_number,
      'wagon_number', NEW.wagon_number,
      'bogie_type', NEW.bogie_type,
      'spring_condition', NEW.spring_condition,
      'spring_position', NEW.spring_position,
      'measured_height', NEW.measured_height,
      'classified_band', NEW.classified_band,
      'status', NEW.status,
      'damage_type', NEW.damage_type,
      'damage_notes', NEW.damage_notes,
      'supervisor_override', NEW.supervisor_override,
      'override_reason', NEW.override_reason,
      'otp_token_ref', NEW.otp_token_ref,
      'measurement_source', NEW.measurement_source,
      'audit_hash', NEW.audit_hash
    ),
    NEW.created_at
  );
END;

-- Block UPDATE on wagon_transitions
CREATE TRIGGER IF NOT EXISTS trg_prevent_wagon_transitions_update
BEFORE UPDATE ON wagon_transitions
BEGIN
  SELECT RAISE(ABORT, 'Audit log is strictly append-only. Wagon transition records are immutable and cannot be updated.');
END;

-- Block DELETE on wagon_transitions
CREATE TRIGGER IF NOT EXISTS trg_prevent_wagon_transitions_delete
BEFORE DELETE ON wagon_transitions
BEGIN
  SELECT RAISE(ABORT, 'Audit log is strictly append-only. Wagon transition records are immutable and cannot be deleted.');
END;

-- Block UPDATE on gate_signoffs
CREATE TRIGGER IF NOT EXISTS trg_prevent_gate_signoffs_update
BEFORE UPDATE ON gate_signoffs
BEGIN
  SELECT RAISE(ABORT, 'Audit log is strictly append-only. Gate sign-off records are immutable and cannot be updated.');
END;

-- Block DELETE on gate_signoffs
CREATE TRIGGER IF NOT EXISTS trg_prevent_gate_signoffs_delete
BEFORE DELETE ON gate_signoffs
BEGIN
  SELECT RAISE(ABORT, 'Audit log is strictly append-only. Gate sign-off records are immutable and cannot be deleted.');
END;

-- =========================================================================
-- Performance & Analytical Indexes
-- =========================================================================

CREATE INDEX IF NOT EXISTS idx_inspections_created_at ON inspections(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inspections_wagon_created ON inspections(wagon_number, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inspections_inspector_date ON inspections(inspector_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inspections_band_status ON inspections(classified_band, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inspections_status_date ON inspections(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inspections_bogie_cond_pos ON inspections(bogie_type, spring_condition, spring_position);
CREATE INDEX IF NOT EXISTS idx_inspections_sync_id ON inspections(sync_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_inspection_id ON inspection_audit_log(inspection_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_event_user ON inspection_audit_log(event_type, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_otp_token_ref ON otp_verifications(token_ref);

CREATE INDEX IF NOT EXISTS idx_wagons_stage_status ON wagons(current_stage, status);
CREATE INDEX IF NOT EXISTS idx_wagons_entry_date ON wagons(entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_wagons_type ON wagons(wagon_type);
CREATE INDEX IF NOT EXISTS idx_transitions_wagon ON wagon_transitions(wagon_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_transitions_wagon_number ON wagon_transitions(wagon_number, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_transitions_performer ON wagon_transitions(performed_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_checklist_wagon_cat ON checklist_items(wagon_number, category);
CREATE INDEX IF NOT EXISTS idx_checklist_wagon_status ON checklist_items(wagon_number, status, is_mandatory);
CREATE INDEX IF NOT EXISTS idx_gate_signoffs_wagon ON gate_signoffs(wagon_id);
CREATE INDEX IF NOT EXISTS idx_gate_signoffs_wagon_num ON gate_signoffs(wagon_number);
CREATE INDEX IF NOT EXISTS idx_gate_signoffs_cert ON gate_signoffs(certificate_number);
CREATE INDEX IF NOT EXISTS idx_wagon_photos_wagon ON wagon_photos(wagon_number, created_at DESC);

-- =========================================================================
-- Phase 3 (M1): Stores Depot Inventory & Pre-Arrival OMRS AI Triage (R5)
-- =========================================================================

-- 12. Stores Depot Inventory Catalog & Stock
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

-- 13. Stores Inventory Reservations Table
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

-- 14. Trackside OMRS Scans & AI Triage Telemetry Table
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

-- =========================================================================
-- Phase 3 (M5): Smart Acoustic Bearing & Leak Detection (R3)
-- =========================================================================

-- 15. Acoustic Diagnostics Telemetry Table
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

-- =========================================================================
-- Phase 3 (M1): Component Health Passports & Serialization (R4)
-- =========================================================================

-- 16. Serialized Components Table (Current State & Health Metrics)
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

-- 17. Component History Ledger (Immutable Append-Only Audit Trail)
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

-- Indexes for Component Search and History Queries
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

-- Component Immutability Triggers
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

-- Automatic Component History Logging Triggers
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


