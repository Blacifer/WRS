-- =========================================================================
-- Indian Railways WRS Raipur Spring Classification & Inspection System
-- SQLite Schema & Immutable Append-Only Audit Logging Triggers (Phase 1 & Phase 2)
-- =========================================================================

-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  -- TOTP enrolment. The secret is a credential rather than a record, so it is
  -- sealed with AES-256-GCM before it is stored — a copied backup must not
  -- hand over every supervisor's second factor. See auth/secretBox.ts.
  totp_secret_sealed TEXT DEFAULT NULL,
  totp_enrolled_at TEXT DEFAULT NULL,
  -- Highest TOTP counter already accepted, so a code cannot be replayed
  -- inside its ~90 second validity window.
  totp_last_counter INTEGER DEFAULT NULL,
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
  -- Which bogie this spring came off. Without it a single OUTER measurement
  -- was matched to BOTH bogies' checklist items, so measuring one spring
  -- marked two as verified. Nullable because rows created before this column
  -- existed genuinely do not know, and must not be guessed at.
  bogie_position TEXT DEFAULT NULL CHECK(bogie_position IS NULL OR bogie_position IN ('BOGIE_1', 'BOGIE_2')),
  -- Which spring within its nest (1..12 for a 20.32t NLB outer nest). Without
  -- it, twelve outer springs collapse to one row and the exit gate sees a
  -- single reading standing in for the whole nest.
  nest_index INTEGER DEFAULT NULL CHECK(nest_index IS NULL OR nest_index >= 1),
  -- 1 when the height is a band midpoint recorded from the strip rather than a
  -- measured figure. The band is what the inspector actually observed; storing
  -- a representative height without saying so would overstate the precision.
  height_is_approximate INTEGER NOT NULL DEFAULT 0 CHECK(height_is_approximate IN (0, 1)),
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

-- A declared principal for actions the system performs itself.
--
-- Audit rows carry a foreign key to users, so an event with no human actor has
-- nowhere valid to point and simply does not get written. It is defined here,
-- alongside the schema it is a constraint of, so a database built straight from
-- this file behaves the same as one built by the migrations.
--
-- It cannot be signed into: is_active is 0, and 'NO_LOGIN' is not a valid
-- PBKDF2 record, so with the unsalted-SHA-256 fallback removed nothing can
-- verify against it.
INSERT OR IGNORE INTO users (id, username, password_hash, role, full_name, employee_id, is_active)
VALUES ('usr_system', 'system', 'NO_LOGIN', 'ADMIN', 'System (automated actions)', 'WRS-SYSTEM', 0);

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
  -- What this photograph is evidence OF.
  --
  -- A repair is only demonstrable as a pair: the condition that justified the
  -- work, and the condition after it. Photos previously attached to a part with
  -- no way to say which they were, so a gallery of images could not answer
  -- "show me this component before you touched it".
  evidence_stage TEXT DEFAULT NULL CHECK(evidence_stage IS NULL OR evidence_stage IN ('BEFORE', 'AFTER', 'DEFECT', 'GENERAL')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (inspector_id) REFERENCES users(id) ON DELETE RESTRICT
);

-- =========================================================================
-- Strict Immutability Triggers (Prevent UPDATE & DELETE)
-- =========================================================================

-- Block any UPDATE on inspections

-- ---------------------------------------------------------------------------
-- SPRING SORTING
--
-- Springs arrive at WRS Raipur already dismantled, in bulk, and are sorted
-- against the strip into band groups — roughly 900 a day. At that moment the
-- wagon they came off is often not known, and the shop confirmed it varies by
-- day.
--
-- These are not wagon inspections and must not be stored as them. Every
-- completeness check, nest check and exit-gate query in this system is keyed
-- on a wagon; a sorted spring has no wagon yet, and forcing one in with a null
-- or a placeholder would corrupt all of them. A sorted spring is stock: it is
-- measured, grouped, and later drawn on for an assembly.
--
-- assigned_wagon_number is left for the day a sorted spring is claimed by an
-- assembly, so the two halves of the workflow can be joined without a
-- migration.
-- ---------------------------------------------------------------------------
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

-- Sorted springs are measurements, and are append-only like every other
-- measurement in this system.
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


-- ---------------------------------------------------------------------------
-- SINGLE WAGON TEST (air brake)
--
-- WMM 2.0 §720: "Single wagon test is also carried out after POH". It is a
-- proforma of measured values, each with a published limit in §720-C, and it
-- is currently filled in on paper and signed.
--
-- Stored whole rather than as checklist line items: the readings only mean
-- something together, and the verdict depends on the pipe configuration and
-- the load condition the test was run in.
-- ---------------------------------------------------------------------------
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


-- ---------------------------------------------------------------------------
-- LEARNED PARAMETER HISTORY
--
-- learned_parameters holds only the current state, so approving a second
-- proposal overwrote any record of the first. That made the one question worth
-- asking of a self-improving system — "what has it actually learned, and on
-- what evidence?" — unanswerable after the second change.
--
-- This is that record: every decision, accepted or rejected, with the value
-- before and after, the reasoning, how many observations it rested on, and who
-- decided. Rejections are kept too: knowing which suggestions a supervisor
-- turned down says as much about the system's judgement as the ones they took.
--
-- Append-only, like every other record here.
-- ---------------------------------------------------------------------------
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

-- NOTE: Inspection-insert audit logging is done in application code
-- (InspectionRepository.insertInspection -> auditLog.ts's logAuditEvent),
-- not via a DB trigger here, because it needs to compute a SHA-256 hash
-- chain (previous_hash/hash) that plain SQLite triggers cannot produce.

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
  -- ROH cycles completed since the last POH.
  --
  -- WMM 2.0 Chapter 6 encodes this physically, in paint: at POH the end cap
  -- screws are a must-change item and go on unpainted; at each subsequent ROH
  -- one more screw head is painted golden yellow. Counting yellow screws tells
  -- a fitter how far through its overhaul cycle a bearing is.
  --
  -- It matters because of clause (f) of the same section: only bearings
  -- carrying the SAME painting scheme may be fitted under one wagon. That is a
  -- matched-set rule enforced by eye and verified by sample check, which is
  -- exactly the kind of thing that should not depend on counting paint.
  roh_cycles_since_poh INTEGER NOT NULL DEFAULT 0 CHECK(roh_cycles_since_poh >= 0 AND roh_cycles_since_poh <= 3),
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



-- ===========================================================================
-- MACHINE LEARNING FEEDBACK LOOP
--
-- The system makes machine judgements in several places (OCR caliper reads,
-- RDSO band classification, voice command parsing, acoustic diagnostics).
-- Whenever a human accepts or corrects one of those judgements, that is a
-- labelled training signal. Previously those signals were discarded, so the
-- system could never get better at anything.
--
-- These two tables close the loop:
--   machine_learning_events  — the correction ledger (append-only evidence)
--   learned_parameters       — tuned values, each requiring human approval
--
-- DELIBERATE CONSTRAINT: nothing here may silently alter a safety limit. The
-- RDSO band tables and condemning limits are regulation, not parameters. What
-- adapts is operational behaviour — when to ask an inspector to double-check
-- a reading, which defect types to surface first, and so on.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS machine_learning_events (
  id TEXT PRIMARY KEY,
  subsystem TEXT NOT NULL CHECK(subsystem IN (
    'OCR_CALIPER',
    'SPRING_CLASSIFICATION',
    'VOICE_COMMAND',
    'ACOUSTIC_DIAGNOSTIC',
    'DEFECT_SUGGESTION'
  )),
  wagon_number TEXT DEFAULT NULL,
  inspection_id TEXT DEFAULT NULL,

  -- What the machine proposed, and how sure it was (0.0 - 1.0).
  machine_output_json TEXT NOT NULL,
  machine_confidence REAL DEFAULT NULL
    CHECK(machine_confidence IS NULL OR (machine_confidence >= 0.0 AND machine_confidence <= 1.0)),

  -- What the human committed. NULL means the machine output was accepted as-is.
  human_output_json TEXT DEFAULT NULL,
  was_corrected INTEGER NOT NULL DEFAULT 0 CHECK(was_corrected IN (0, 1)),
  -- Absolute numeric delta where the judgement is numeric (mm for OCR).
  correction_magnitude REAL DEFAULT NULL,

  -- Free-form conditions that may explain the outcome (device, lighting,
  -- component target). Used to find systematic weaknesses.
  context_json TEXT DEFAULT NULL,

  user_id TEXT DEFAULT NULL,
  user_role TEXT DEFAULT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_mle_subsystem   ON machine_learning_events(subsystem, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mle_corrected   ON machine_learning_events(subsystem, was_corrected);
CREATE INDEX IF NOT EXISTS idx_mle_created     ON machine_learning_events(created_at DESC);

-- Evidence must not be rewritten after the fact, same principle as the audit log.
CREATE TRIGGER IF NOT EXISTS trg_mle_no_update
BEFORE UPDATE ON machine_learning_events
BEGIN
  SELECT RAISE(ABORT, 'Machine learning event ledger is strictly append-only.');
END;

CREATE TRIGGER IF NOT EXISTS trg_mle_no_delete
BEFORE DELETE ON machine_learning_events
BEGIN
  SELECT RAISE(ABORT, 'Machine learning event ledger is strictly append-only.');
END;

CREATE TABLE IF NOT EXISTS learned_parameters (
  id TEXT PRIMARY KEY,
  param_key TEXT NOT NULL UNIQUE,
  subsystem TEXT NOT NULL,

  current_value REAL NOT NULL,
  default_value REAL NOT NULL,
  -- A proposal derived from the ledger, awaiting a human decision.
  proposed_value REAL DEFAULT NULL,
  proposal_rationale TEXT DEFAULT NULL,
  proposal_sample_size INTEGER DEFAULT NULL,
  proposed_at TEXT DEFAULT NULL,

  -- Proposals never self-apply. A named human accepts or rejects.
  approval_status TEXT NOT NULL DEFAULT 'NONE'
    CHECK(approval_status IN ('NONE', 'PENDING', 'APPROVED', 'REJECTED')),
  approved_by TEXT DEFAULT NULL,
  approved_at TEXT DEFAULT NULL,

  min_allowed REAL NOT NULL,
  max_allowed REAL NOT NULL,
  description TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  FOREIGN KEY (approved_by) REFERENCES users(id)
);
