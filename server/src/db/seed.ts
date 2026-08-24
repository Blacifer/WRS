/**
 * Indian Railways WRS Raipur - Rich Demo Seed Data Engine
 * 
 * Seeds realistic workshop data for DRM presentation:
 * 1. 13 wagons across all 7 lifecycle stages (2 Released, 1 Final QC Gate with active blockers, 2 Reassembly, 2 Repair, 3 Inspection, 2 Dismantling, 1 Entry)
 * 2. 40 spring inspection records covering all 6 RDSO bands + 2 condemned springs across 3 bogie types and 4 inspectors
 * 3. 8 CASNUB part categories checklists populated with PASS / REPAIRED / REPLACED / CONDEMNED / PENDING statuses
 * 4. Realistic 30-day chronological timeline transitions for every wagon
 * 5. Full Zero-Defect Exit Gate release certificates for Stage 7 wagons
 * 6. Strictly Idempotent: Checks existence prior to insert; respects append-only trigger constraints
 */

import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import { getDatabase } from './connection.ts';
import { runMigrations } from './migrations.ts';
import { hashPassword } from '../auth/password.ts';
import { classifySpring } from '../../../shared/classification/engine.ts';
import type {
  LifecycleStage,
  CASNUBCategory,
  BogieType,
  SpringPosition,
  SpringCondition,
  DamageType,
  SerializedComponentType,
  ComponentStatus,
  ComponentHealthStatus,
  ComponentEventType
} from '../../../shared/types.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const nowTime = Date.now();

function getIsoDate(daysAgo: number, hoursOffset: number = 0): string {
  const ms = nowTime - (daysAgo * 24 * 3600 * 1000) + (hoursOffset * 3600 * 1000);
  return new Date(ms).toISOString();
}

function generateAuditHash(record: Record<string, any>): string {
  const canonicalString = [
    record.id,
    record.sequence_number,
    record.wagon_number,
    record.bogie_type,
    record.spring_position,
    record.spring_condition,
    record.measured_height,
    record.classified_band,
    record.status,
    record.inspector_id,
    record.created_at
  ].join('|');

  return crypto.createHash('sha256').update(canonicalString).digest('hex');
}

function getNextSeq(db: DatabaseSync): number {
  const row = db.prepare("SELECT last_val FROM sequence_tracker WHERE name = 'inspection_seq'").get() as { last_val: number } | undefined;
  const nextVal = (row?.last_val ?? 0) + 1;
  db.prepare("UPDATE sequence_tracker SET last_val = ? WHERE name = 'inspection_seq'").run(nextVal);
  return nextVal;
}

// ---------------------------------------------------------------------------
// Demo Users
// ---------------------------------------------------------------------------

export const DEMO_USERS = [
  {
    id: 'usr_insp_001',
    username: 'inspector1',
    password: 'password123',
    role: 'INSPECTOR',
    full_name: 'Ramesh Kumar',
    employee_id: 'WRS-INSP-1042'
  },
  {
    id: 'usr_insp_002',
    username: 'inspector2',
    password: 'password123',
    role: 'INSPECTOR',
    full_name: 'Praveen Singh',
    employee_id: 'WRS-INSP-1043'
  },
  {
    id: 'usr_insp_003',
    username: 'inspector3',
    password: 'password123',
    role: 'INSPECTOR',
    full_name: 'Amit Sharma',
    employee_id: 'WRS-INSP-1044'
  },
  {
    id: 'usr_insp_004',
    username: 'inspector4',
    password: 'password123',
    role: 'INSPECTOR',
    full_name: 'Vikram Yadav',
    employee_id: 'WRS-INSP-1045'
  },
  {
    id: 'usr_sup_001',
    username: 'supervisor1',
    password: 'password123',
    role: 'SUPERVISOR',
    full_name: 'S. K. Verma',
    employee_id: 'WRS-SUP-2019'
  },
  {
    id: 'usr_adm_001',
    username: 'admin1',
    password: 'password123',
    role: 'ADMIN',
    full_name: 'A. K. Mishra',
    employee_id: 'WRS-ADM-0001'
  }
];

// ---------------------------------------------------------------------------
// CASNUB Master Checklist Items (8 RDSO Categories)
// ---------------------------------------------------------------------------

export interface ChecklistTemplateItem {
  category: CASNUBCategory;
  partName: string;
  bogiePosition: string;
  isMandatory: number;
  std: string;
}

// Single source of truth for the default CASNUB checklist — used both to seed
// checklist_config (below) for demo data, and directly by
// WagonRepository.getDefaultRDSOItems() as the fallback template for real
// wagon registrations. Previously duplicated by hand in wagonRepository.ts,
// which let the two copies drift out of sync; import this instead of
// re-declaring the list.
export const CASNUB_CHECKLIST_TEMPLATE: ChecklistTemplateItem[] = [
  // 1. SPRINGS
  { category: 'SPRINGS', partName: 'Outer Spring (Bogie 1)', bogiePosition: 'BOGIE_1', isMandatory: 1, std: 'RDSO G-95 Table 28' },
  { category: 'SPRINGS', partName: 'Inner Spring (Bogie 1)', bogiePosition: 'BOGIE_1', isMandatory: 1, std: 'RDSO G-95 Table 29' },
  { category: 'SPRINGS', partName: 'Snubber Spring (Bogie 1)', bogiePosition: 'BOGIE_1', isMandatory: 1, std: 'RDSO G-95 Table 30' },
  { category: 'SPRINGS', partName: 'Outer Spring (Bogie 2)', bogiePosition: 'BOGIE_2', isMandatory: 1, std: 'RDSO G-95 Table 28' },
  { category: 'SPRINGS', partName: 'Inner Spring (Bogie 2)', bogiePosition: 'BOGIE_2', isMandatory: 1, std: 'RDSO G-95 Table 29' },
  { category: 'SPRINGS', partName: 'Snubber Spring (Bogie 2)', bogiePosition: 'BOGIE_2', isMandatory: 1, std: 'RDSO G-95 Table 30' },

  // 2. WHEELS_AXLES
  { category: 'WHEELS_AXLES', partName: 'Wheel Tread Diameter (Axle 1-4)', bogiePosition: 'BOGIE_1', isMandatory: 1, std: 'RDSO C-9901' },
  { category: 'WHEELS_AXLES', partName: 'Flange Thickness (Min 16.0mm)', bogiePosition: 'BOGIE_1', isMandatory: 1, std: 'RDSO C-9901' },
  { category: 'WHEELS_AXLES', partName: 'Wheel Gauge (1600 +2/-1 mm)', bogiePosition: 'BOGIE_2', isMandatory: 1, std: 'RDSO C-9901' },
  { category: 'WHEELS_AXLES', partName: 'Axle Journal UST Flaw Detection', bogiePosition: 'BOGIE_2', isMandatory: 1, std: 'RDSO ND-97' },

  // 3. BEARINGS
  { category: 'BEARINGS', partName: 'CTRB Cartridge Bearing Rotation', bogiePosition: 'BOGIE_1', isMandatory: 1, std: 'RDSO G-81' },
  { category: 'BEARINGS', partName: 'Axle Box Adapter Crown Wear', bogiePosition: 'BOGIE_1', isMandatory: 1, std: 'RDSO G-81' },
  // Split from the previous generic "Grease Seals & End Cap Bolts" into the three
  // items the Railway Board's Must-Change list (WMM 2.0 Appx-V, A-4/A-5/A-6) mandates
  // 100% replacement of during POH — not just inspection.
  { category: 'BEARINGS', partName: 'CTRB Locking Plate (100% Replace — POH)', bogiePosition: 'BOGIE_2', isMandatory: 1, std: 'WMM 2.0 Appx-V A-4' },
  { category: 'BEARINGS', partName: 'CTRB Grease Seal (100% Replace — POH)', bogiePosition: 'BOGIE_2', isMandatory: 1, std: 'WMM 2.0 Appx-V A-5' },
  { category: 'BEARINGS', partName: 'CTRB End Cap Screws (100% Replace — POH)', bogiePosition: 'BOGIE_2', isMandatory: 1, std: 'WMM 2.0 Appx-V A-6' },

  // 4. BRAKE_SYSTEM
  { category: 'BRAKE_SYSTEM', partName: 'Composite Brake Blocks (Min 10mm)', bogiePosition: 'BOGIE_1', isMandatory: 1, std: 'RDSO 02-ABR-02' },
  { category: 'BRAKE_SYSTEM', partName: 'Brake Beams & Truss Assembly', bogiePosition: 'BOGIE_2', isMandatory: 1, std: 'RDSO 02-ABR-02' },
  { category: 'BRAKE_SYSTEM', partName: 'Brake Shoe Key Split Pin 12x110mm (100% Replace — POH)', bogiePosition: 'BOGIE_2', isMandatory: 1, std: 'WMM 2.0 Appx-V A-3' },
  { category: 'BRAKE_SYSTEM', partName: 'SAB Slack Adjuster DA-2(T)', bogiePosition: 'UNDERFRAME', isMandatory: 1, std: 'RDSO 02-ABR-02' },
  { category: 'BRAKE_SYSTEM', partName: 'Brake Cylinder Piston Stroke', bogiePosition: 'UNDERFRAME', isMandatory: 1, std: 'RDSO 02-ABR-02' },
  { category: 'BRAKE_SYSTEM', partName: 'Distributor Valve KE/C3W', bogiePosition: 'UNDERFRAME', isMandatory: 1, std: 'RDSO 02-ABR-02' },
  { category: 'BRAKE_SYSTEM', partName: 'Air Hose & Angle Cocks (BP Air Hose 100% Replace — POH)', bogiePosition: 'BODY', isMandatory: 1, std: 'WMM 2.0 Appx-V C-9' },

  // 5. COUPLERS_DRAFT_GEAR
  { category: 'COUPLERS_DRAFT_GEAR', partName: 'CBC Coupler Body Contour', bogiePosition: 'BODY', isMandatory: 1, std: 'RDSO 48-BD-08' },
  // Knuckle & Lock: Railway Board Must-Change list (B-1/B-2) mandates one-time
  // replacement with upgraded WD-70-BD-10 parts during POH — these are directly
  // implicated in train-parting/uncoupling incidents, not routine wear items.
  { category: 'COUPLERS_DRAFT_GEAR', partName: 'CBC Knuckle Nose Wear (100% Replace — POH, WD-70-BD-10)', bogiePosition: 'BODY', isMandatory: 1, std: 'WMM 2.0 Appx-V B-1' },
  { category: 'COUPLERS_DRAFT_GEAR', partName: 'CBC Lock (100% Replace — POH, WD-70-BD-10)', bogiePosition: 'BODY', isMandatory: 1, std: 'WMM 2.0 Appx-V B-2' },
  { category: 'COUPLERS_DRAFT_GEAR', partName: 'Mark-50 Draft Gear Housing', bogiePosition: 'BODY', isMandatory: 1, std: 'RDSO 49-BD-08' },
  { category: 'COUPLERS_DRAFT_GEAR', partName: 'Striker Casting Wear Plate (100% Replace — POH)', bogiePosition: 'BODY', isMandatory: 1, std: 'WMM 2.0 Appx-V B-7' },
  // Mark-50 Draft Gear recondition gauges, sourced from the WRS Raipur
  // shop-floor gauge reference boards (photographed on site, 2026-08-22),
  // not from a numbered RDSO/WMM clause — cited by Gauge No. as printed on
  // each board. The 7 items below with a caliper-measurable dimension are
  // wired into the AR Caliper flow (see DG_* entries in shared/types.ts,
  // server/src/routes/cv.ts, client/src/services/classification.ts). The
  // remaining 6 are physical GO/NO-GO or rotate-and-check gauges performed
  // by hand — deliberately left as a manual PASS/FAIL item, not a fake
  // digital measurement.
  { category: 'COUPLERS_DRAFT_GEAR', partName: 'Draft Gear Housing Box Profile Gauge (Gauge No. 27200)', bogiePosition: 'BODY', isMandatory: 1, std: 'WRS Raipur Gauge 27200 / BE/91-62-1' },
  { category: 'COUPLERS_DRAFT_GEAR', partName: 'Draft Gear Housing Wall Thickness (Min 15.88mm)', bogiePosition: 'BODY', isMandatory: 1, std: 'WRS Raipur Gauge BE/91-62-6' },
  { category: 'COUPLERS_DRAFT_GEAR', partName: 'Draft Gear Centre Wedge Location Gauge (59.54–61.11mm)', bogiePosition: 'BODY', isMandatory: 1, std: 'WRS Raipur Gauge BE/91-72-1' },
  { category: 'COUPLERS_DRAFT_GEAR', partName: 'Draft Gear Movable Plate Location Gauge (141.27–144.48mm)', bogiePosition: 'BODY', isMandatory: 1, std: 'WRS Raipur Gauge BE/91-61-10' },
  { category: 'COUPLERS_DRAFT_GEAR', partName: 'Draft Gear Movable Plate Rotation Gauge (180° Test)', bogiePosition: 'BODY', isMandatory: 1, std: 'WRS Raipur Gauge BE/91-61-10' },
  { category: 'COUPLERS_DRAFT_GEAR', partName: 'Draft Gear Outer Coil Spring (Free Height Min 342mm)', bogiePosition: 'BODY', isMandatory: 1, std: 'WRS Raipur Gauge BE/91-61-6' },
  { category: 'COUPLERS_DRAFT_GEAR', partName: 'Draft Gear Inner Coil Spring (Free Height Min 342mm)', bogiePosition: 'BODY', isMandatory: 1, std: 'WRS Raipur Gauge BE/91-61-7A' },
  { category: 'COUPLERS_DRAFT_GEAR', partName: 'Draft Gear Corner Coil Spring (Free Height Min 286mm)', bogiePosition: 'BODY', isMandatory: 1, std: 'WRS Raipur Gauge BE/91-61-7a' },
  { category: 'COUPLERS_DRAFT_GEAR', partName: 'Draft Gear Release Spring (Free Height Min 123mm)', bogiePosition: 'BODY', isMandatory: 1, std: 'WRS Raipur Gauge BE/91-61-8' },
  { category: 'COUPLERS_DRAFT_GEAR', partName: 'Draft Gear Wedge Shoe Gap Gauge (Max 0.38mm)', bogiePosition: 'BODY', isMandatory: 1, std: 'WRS Raipur Gauge BE/91-61-2' },
  { category: 'COUPLERS_DRAFT_GEAR', partName: 'Draft Gear Centre Wedge Gap Gauge (Max 0.38mm)', bogiePosition: 'BODY', isMandatory: 1, std: 'WRS Raipur Gauge BE/91-61-1' },
  { category: 'COUPLERS_DRAFT_GEAR', partName: 'Draft Gear Outer Stationary Plate Gap Gauge (Max 0.38mm)', bogiePosition: 'BODY', isMandatory: 1, std: 'WRS Raipur Gauge BE/91-61-3' },
  { category: 'COUPLERS_DRAFT_GEAR', partName: 'Draft Gear Taper Stationary Plate Gauge (NO GO 0.25mm)', bogiePosition: 'BODY', isMandatory: 1, std: 'WRS Raipur Gauge BE/91-61-4' },
  { category: 'COUPLERS_DRAFT_GEAR', partName: 'Draft Gear Spring Seat Gap Gauge (Max 0.38mm)', bogiePosition: 'BODY', isMandatory: 1, std: 'WRS Raipur Gauge BE/91-61-5' },

  // 6. BOGIE_FRAME_BOLSTER
  { category: 'BOGIE_FRAME_BOLSTER', partName: 'Side Frame Column Liners', bogiePosition: 'BOGIE_1', isMandatory: 1, std: 'RDSO G-95' },
  { category: 'BOGIE_FRAME_BOLSTER', partName: 'SF Key Nut Bolt with Washer (100% Replace — POH)', bogiePosition: 'BOGIE_1', isMandatory: 1, std: 'WMM 2.0 Appx-V A-1' },
  { category: 'BOGIE_FRAME_BOLSTER', partName: 'Bolster Pocket Slope Liners', bogiePosition: 'BOGIE_1', isMandatory: 1, std: 'RDSO G-95' },
  { category: 'BOGIE_FRAME_BOLSTER', partName: 'Center Plate & Pivot Pin', bogiePosition: 'BOGIE_2', isMandatory: 1, std: 'RDSO G-95' },
  { category: 'BOGIE_FRAME_BOLSTER', partName: 'Constant Contact Side Bearers', bogiePosition: 'BOGIE_2', isMandatory: 1, std: 'RDSO G-95' },

  // 7. FRICTION_WEDGES
  { category: 'FRICTION_WEDGES', partName: 'Wedge Main Slope Surface', bogiePosition: 'BOGIE_1', isMandatory: 1, std: 'RDSO G-95' },
  { category: 'FRICTION_WEDGES', partName: 'Wedge Vertical Face & Spigot Fit', bogiePosition: 'BOGIE_2', isMandatory: 1, std: 'RDSO G-95' },
  { category: 'FRICTION_WEDGES', partName: 'Elastomeric (EM) Pads (100% Replace — POH)', bogiePosition: 'BOGIE_2', isMandatory: 1, std: 'WMM 2.0 Appx-V A-8' },

  // 8. BODY_UNDERFRAME
  { category: 'BODY_UNDERFRAME', partName: 'Center Sill & Sole Bar Camber', bogiePosition: 'UNDERFRAME', isMandatory: 1, std: 'RDSO G-70' },
  { category: 'BODY_UNDERFRAME', partName: 'Steel Flooring & Perforations', bogiePosition: 'BODY', isMandatory: 1, std: 'RDSO G-70' },
  { category: 'BODY_UNDERFRAME', partName: 'Side Doors & Locking Gear', bogiePosition: 'BODY', isMandatory: 1, std: 'RDSO G-70' },
  { category: 'BODY_UNDERFRAME', partName: 'Paint & Stenciling Legibility', bogiePosition: 'BODY', isMandatory: 0, std: 'RDSO G-70' }
];

// ---------------------------------------------------------------------------
// 13 Wagons Master Seed Specification
// ---------------------------------------------------------------------------

interface DemoWagonSpec {
  id: string;
  wagonNumber: string;
  wagonType: string;
  owningRailway: string;
  currentStage: LifecycleStage;
  status: string;
  entryDaysAgo: number;
  releaseDaysAgo?: number;
  entryNotes: string;
  conditionNotes?: string;
  createdBy: string;
  stagesPassed: LifecycleStage[];
  hasSignoff?: boolean;
  signoffCertificate?: string;
  isBlockerWagon?: boolean;
}

const DEMO_WAGONS: DemoWagonSpec[] = [
  // 1. RELEASE (Stage 7) - Wagon 1 (Turnaround ~6.0 days)
  {
    id: 'wagon_demo_01',
    wagonNumber: 'SECR/BOXNHL/10492',
    wagonType: 'BOXNHL',
    owningRailway: 'SECR',
    currentStage: 'RELEASE',
    status: 'RELEASED',
    entryDaysAgo: 28,
    releaseDaysAgo: 22,
    entryNotes: 'POH Intake - Wheel flange wear & brake beam overhaul',
    conditionNotes: 'Complete overhaul completed with zero defects. Certified for line service.',
    createdBy: 'usr_insp_001',
    stagesPassed: [
      'ENTRY_REGISTRATION', 'DISMANTLING', 'COMPONENT_INSPECTION',
      'REPAIR_REPLACEMENT', 'REASSEMBLY', 'FINAL_QC_GATE', 'RELEASE'
    ],
    hasSignoff: true,
    signoffCertificate: 'WRS/QC-REL/2026/07/1049'
  },
  // 2. RELEASE (Stage 7) - Wagon 2 (Turnaround ~5.8 days)
  {
    id: 'wagon_demo_02',
    wagonNumber: 'ECOR/BOXNHL/20831',
    wagonType: 'BOXNHL',
    owningRailway: 'ECOR',
    currentStage: 'RELEASE',
    status: 'RELEASED',
    entryDaysAgo: 14,
    releaseDaysAgo: 8,
    entryNotes: 'Routine POH overhaul - Center pivot pin replacement',
    conditionNotes: 'All 8 CASNUB categories passed. Gate sign-off granted.',
    createdBy: 'usr_insp_002',
    stagesPassed: [
      'ENTRY_REGISTRATION', 'DISMANTLING', 'COMPONENT_INSPECTION',
      'REPAIR_REPLACEMENT', 'REASSEMBLY', 'FINAL_QC_GATE', 'RELEASE'
    ],
    hasSignoff: true,
    signoffCertificate: 'WRS/QC-REL/2026/08/2083'
  },
  // 3. FINAL_QC_GATE (Stage 6) - Wagon 3 (Active Blockers: 1 Condemned Spring + 1 Missing CTRB)
  {
    id: 'wagon_demo_03',
    wagonNumber: 'SER/BOXNHL/30914',
    wagonType: 'BOXNHL',
    owningRailway: 'SER',
    currentStage: 'FINAL_QC_GATE',
    status: 'BLOCKED',
    entryDaysAgo: 7,
    entryNotes: 'Heavy freight coal wagon POH - Spring grouping check required',
    conditionNotes: 'Exit Gate Blocked: 1 condemned coil spring + missing CTRB bearing rotation inspection.',
    createdBy: 'usr_insp_001',
    stagesPassed: [
      'ENTRY_REGISTRATION', 'DISMANTLING', 'COMPONENT_INSPECTION',
      'REPAIR_REPLACEMENT', 'REASSEMBLY', 'FINAL_QC_GATE'
    ],
    hasSignoff: false,
    isBlockerWagon: true
  },
  // 4. REASSEMBLY (Stage 5) - Wagon 4
  {
    id: 'wagon_demo_04',
    wagonNumber: 'WR/BCNHL/40112',
    wagonType: 'BCNHL',
    owningRailway: 'WR',
    currentStage: 'REASSEMBLY',
    status: 'IN_PROGRESS',
    entryDaysAgo: 9,
    entryNotes: 'Covered wagon POH - Roof hatch seals & draft gear',
    conditionNotes: 'Component repairs completed. Bogie frame dropping in progress.',
    createdBy: 'usr_insp_003',
    stagesPassed: [
      'ENTRY_REGISTRATION', 'DISMANTLING', 'COMPONENT_INSPECTION',
      'REPAIR_REPLACEMENT', 'REASSEMBLY'
    ]
  },
  // 5. REASSEMBLY (Stage 5) - Wagon 5
  {
    id: 'wagon_demo_05',
    wagonNumber: 'CR/BOBRN/50223',
    wagonType: 'BOBRN',
    owningRailway: 'CR',
    currentStage: 'REASSEMBLY',
    status: 'IN_PROGRESS',
    entryDaysAgo: 8,
    entryNotes: 'Hopper bottom discharge door locking mechanism overhaul',
    conditionNotes: 'Friction wedges and side bearers fitted. Final torquing.',
    createdBy: 'usr_insp_004',
    stagesPassed: [
      'ENTRY_REGISTRATION', 'DISMANTLING', 'COMPONENT_INSPECTION',
      'REPAIR_REPLACEMENT', 'REASSEMBLY'
    ]
  },
  // 6. REPAIR_REPLACEMENT (Stage 4) - Wagon 6
  {
    id: 'wagon_demo_06',
    wagonNumber: 'NR/BOXN/60334',
    wagonType: 'BOXN',
    owningRailway: 'NR',
    currentStage: 'REPAIR_REPLACEMENT',
    status: 'IN_PROGRESS',
    entryDaysAgo: 10,
    entryNotes: 'Open wagon floor plate corrosion & brake beam crack',
    conditionNotes: 'Brake beams replaced with new RDSO unit. CBC knuckle machining underway.',
    createdBy: 'usr_insp_002',
    stagesPassed: [
      'ENTRY_REGISTRATION', 'DISMANTLING', 'COMPONENT_INSPECTION',
      'REPAIR_REPLACEMENT'
    ]
  },
  // 7. REPAIR_REPLACEMENT (Stage 4) - Wagon 7
  {
    id: 'wagon_demo_07',
    wagonNumber: 'WCR/BOXNHL/70445',
    wagonType: 'BOXNHL',
    owningRailway: 'WCR',
    currentStage: 'REPAIR_REPLACEMENT',
    status: 'IN_PROGRESS',
    entryDaysAgo: 6,
    entryNotes: 'Draft gear housing wear plate replacement',
    conditionNotes: 'New Mark-50 draft gear assembly fitted. Awaiting wheel reprofiling.',
    createdBy: 'usr_insp_001',
    stagesPassed: [
      'ENTRY_REGISTRATION', 'DISMANTLING', 'COMPONENT_INSPECTION',
      'REPAIR_REPLACEMENT'
    ]
  },
  // 8. COMPONENT_INSPECTION (Stage 3) - Wagon 8
  {
    id: 'wagon_demo_08',
    wagonNumber: 'SECR/BCNHL/80556',
    wagonType: 'BCNHL',
    owningRailway: 'SECR',
    currentStage: 'COMPONENT_INSPECTION',
    status: 'IN_PROGRESS',
    entryDaysAgo: 5,
    entryNotes: 'Periodic Bogie Maintenance (IOH)',
    conditionNotes: 'Springs free height testing & ultrasonic flaw detection in progress.',
    createdBy: 'usr_insp_003',
    stagesPassed: [
      'ENTRY_REGISTRATION', 'DISMANTLING', 'COMPONENT_INSPECTION'
    ]
  },
  // 9. COMPONENT_INSPECTION (Stage 3) - Wagon 9
  {
    id: 'wagon_demo_09',
    wagonNumber: 'ECOR/BOBRN/90667',
    wagonType: 'BOBRN',
    owningRailway: 'ECOR',
    currentStage: 'COMPONENT_INSPECTION',
    status: 'IN_PROGRESS',
    entryDaysAgo: 4,
    entryNotes: 'Hopper car air brake distributor valve overhaul',
    conditionNotes: 'Detected 1 snubber spring with transverse fatigue crack during Phase 1 testing.',
    createdBy: 'usr_insp_004',
    stagesPassed: [
      'ENTRY_REGISTRATION', 'DISMANTLING', 'COMPONENT_INSPECTION'
    ]
  },
  // 10. COMPONENT_INSPECTION (Stage 3) - Wagon 10
  {
    id: 'wagon_demo_10',
    wagonNumber: 'SR/BOXNHL/10778',
    wagonType: 'BOXNHL',
    owningRailway: 'SR',
    currentStage: 'COMPONENT_INSPECTION',
    status: 'IN_PROGRESS',
    entryDaysAgo: 3,
    entryNotes: 'Wheel tread shelling & flange thinning inspection',
    conditionNotes: 'Caliper digital optical classification active for CASNUB 22HS bogies.',
    createdBy: 'usr_insp_001',
    stagesPassed: [
      'ENTRY_REGISTRATION', 'DISMANTLING', 'COMPONENT_INSPECTION'
    ]
  },
  // 11. DISMANTLING (Stage 2) - Wagon 11
  {
    id: 'wagon_demo_11',
    wagonNumber: 'NCR/BOXN/20889',
    wagonType: 'BOXN',
    owningRailway: 'NCR',
    currentStage: 'DISMANTLING',
    status: 'IN_PROGRESS',
    entryDaysAgo: 3,
    entryNotes: 'Wagon body uncoupling & bogie frame disassembly',
    conditionNotes: 'Side frame column liners being degreased and inspected.',
    createdBy: 'usr_insp_002',
    stagesPassed: [
      'ENTRY_REGISTRATION', 'DISMANTLING'
    ]
  },
  // 12. DISMANTLING (Stage 2) - Wagon 12
  {
    id: 'wagon_demo_12',
    wagonNumber: 'ER/BCNHL/30990',
    wagonType: 'BCNHL',
    owningRailway: 'ER',
    currentStage: 'DISMANTLING',
    status: 'IN_PROGRESS',
    entryDaysAgo: 2,
    entryNotes: 'Door gear hinge damage & bogie frame overhaul',
    conditionNotes: 'Brake cylinder disassembled for seal inspection.',
    createdBy: 'usr_insp_003',
    stagesPassed: [
      'ENTRY_REGISTRATION', 'DISMANTLING'
    ]
  },
  // 13. ENTRY_REGISTRATION (Stage 1) - Wagon 13
  {
    id: 'wagon_demo_13',
    wagonNumber: 'SECR/BOXNHL/40101',
    wagonType: 'BOXNHL',
    owningRailway: 'SECR',
    currentStage: 'ENTRY_REGISTRATION',
    status: 'IN_PROGRESS',
    entryDaysAgo: 0,
    entryNotes: 'Fresh POH intake from Raipur yard - Initial visual survey completed',
    conditionNotes: 'Scheduled for bogie wash plant entry.',
    createdBy: 'usr_insp_001',
    stagesPassed: [
      'ENTRY_REGISTRATION'
    ]
  }
];

// ---------------------------------------------------------------------------
// 40 Spring Inspections Specification (RDSO G-95 Revision-II)
// ---------------------------------------------------------------------------

interface DemoSpringSpec {
  syncId: string;
  wagonNumber: string;
  bogieType: BogieType;
  condition: SpringCondition;
  position: SpringPosition;
  measuredHeight: number;
  damageType?: DamageType;
  damageNotes?: string;
  inspectorId: string;
  inspectorName: string;
  daysAgo: number;
  hoursOffset?: number;
}

const DEMO_SPRINGS: DemoSpringSpec[] = [
  // Wagon 1 (SECR/BOXNHL/10492) - 4 Springs (All PASS)
  {
    syncId: 'demo_sp_01',
    wagonNumber: 'SECR/BOXNHL/10492',
    bogieType: 'CASNUB_22_NLB',
    condition: 'USED',
    position: 'OUTER',
    measuredHeight: 261.5, // Band I BLUE (260-263)
    inspectorId: 'usr_insp_001',
    inspectorName: 'Ramesh Kumar',
    daysAgo: 26,
    hoursOffset: 2
  },
  {
    syncId: 'demo_sp_02',
    wagonNumber: 'SECR/BOXNHL/10492',
    bogieType: 'CASNUB_22_NLB',
    condition: 'USED',
    position: 'INNER',
    measuredHeight: 260.5, // Band II GREEN (259-262)
    inspectorId: 'usr_insp_001',
    inspectorName: 'Ramesh Kumar',
    daysAgo: 26,
    hoursOffset: 3
  },
  {
    syncId: 'demo_sp_03',
    wagonNumber: 'SECR/BOXNHL/10492',
    bogieType: 'CASNUB_22_NLB',
    condition: 'USED',
    position: 'SNUBBER',
    measuredHeight: 289.5, // Band III YELLOW (288-291)
    inspectorId: 'usr_insp_002',
    inspectorName: 'Praveen Singh',
    daysAgo: 26,
    hoursOffset: 4
  },
  {
    syncId: 'demo_sp_04',
    wagonNumber: 'SECR/BOXNHL/10492',
    bogieType: 'CASNUB_22_NLB',
    condition: 'USED',
    position: 'OUTER',
    measuredHeight: 252.5, // Band IV ORANGE (251-254)
    inspectorId: 'usr_insp_003',
    inspectorName: 'Amit Sharma',
    daysAgo: 26,
    hoursOffset: 5
  },

  // Wagon 2 (ECOR/BOXNHL/20831) - 4 Springs (All PASS)
  {
    syncId: 'demo_sp_05',
    wagonNumber: 'ECOR/BOXNHL/20831',
    bogieType: 'CASNUB_22_NLB',
    condition: 'USED',
    position: 'OUTER',
    measuredHeight: 249.5, // Band V WHITE (248-251)
    inspectorId: 'usr_insp_002',
    inspectorName: 'Praveen Singh',
    daysAgo: 12,
    hoursOffset: 1
  },
  {
    syncId: 'demo_sp_06',
    wagonNumber: 'ECOR/BOXNHL/20831',
    bogieType: 'CASNUB_22_NLB',
    condition: 'USED',
    position: 'INNER',
    measuredHeight: 248.5, // Band VI RED (247-250)
    inspectorId: 'usr_insp_003',
    inspectorName: 'Amit Sharma',
    daysAgo: 12,
    hoursOffset: 2
  },
  {
    syncId: 'demo_sp_07',
    wagonNumber: 'ECOR/BOXNHL/20831',
    bogieType: 'CASNUB_22_NLB',
    condition: 'USED',
    position: 'SNUBBER',
    measuredHeight: 292.0, // Band II GREEN (291-294)
    inspectorId: 'usr_insp_004',
    inspectorName: 'Vikram Yadav',
    daysAgo: 12,
    hoursOffset: 3
  },
  {
    syncId: 'demo_sp_08',
    wagonNumber: 'ECOR/BOXNHL/20831',
    bogieType: 'CASNUB_22_NLB',
    condition: 'USED',
    position: 'OUTER',
    measuredHeight: 262.0, // Band I BLUE (260-263)
    inspectorId: 'usr_insp_001',
    inspectorName: 'Ramesh Kumar',
    daysAgo: 12,
    hoursOffset: 4
  },

  // Wagon 3 (SER/BOXNHL/30914) - 4 Springs (1 CONDEMNED Blocker + 3 PASS)
  {
    syncId: 'demo_sp_09',
    wagonNumber: 'SER/BOXNHL/30914',
    bogieType: 'CASNUB_22_NLB',
    condition: 'USED',
    position: 'OUTER',
    measuredHeight: 242.0, // CONDEMNED (Under min 245.0mm) - Active QC Blocker
    inspectorId: 'usr_insp_001',
    inspectorName: 'Ramesh Kumar',
    daysAgo: 5,
    hoursOffset: 1
  },
  {
    syncId: 'demo_sp_10',
    wagonNumber: 'SER/BOXNHL/30914',
    bogieType: 'CASNUB_22_NLB',
    condition: 'USED',
    position: 'INNER',
    measuredHeight: 257.5, // Band III YELLOW (256-259)
    inspectorId: 'usr_insp_002',
    inspectorName: 'Praveen Singh',
    daysAgo: 5,
    hoursOffset: 2
  },
  {
    syncId: 'demo_sp_11',
    wagonNumber: 'SER/BOXNHL/30914',
    bogieType: 'CASNUB_22_NLB',
    condition: 'USED',
    position: 'SNUBBER',
    measuredHeight: 283.5, // Band V WHITE (282-285)
    inspectorId: 'usr_insp_003',
    inspectorName: 'Amit Sharma',
    daysAgo: 5,
    hoursOffset: 3
  },
  {
    syncId: 'demo_sp_12',
    wagonNumber: 'SER/BOXNHL/30914',
    bogieType: 'CASNUB_22_NLB',
    condition: 'USED',
    position: 'INNER',
    measuredHeight: 263.0, // Band I BLUE (262-265)
    inspectorId: 'usr_insp_004',
    inspectorName: 'Vikram Yadav',
    daysAgo: 5,
    hoursOffset: 4
  },

  // Wagon 4 (WR/BCNHL/40112) - 3 Springs (CASNUB_22_HS)
  {
    syncId: 'demo_sp_13',
    wagonNumber: 'WR/BCNHL/40112',
    bogieType: 'CASNUB_22_HS',
    condition: 'USED',
    position: 'OUTER',
    measuredHeight: 261.0, // Band I BLUE (260-263)
    inspectorId: 'usr_insp_002',
    inspectorName: 'Praveen Singh',
    daysAgo: 7,
    hoursOffset: 1
  },
  {
    syncId: 'demo_sp_14',
    wagonNumber: 'WR/BCNHL/40112',
    bogieType: 'CASNUB_22_HS',
    condition: 'USED',
    position: 'INNER',
    measuredHeight: 241.5, // Band II GREEN (240-243)
    inspectorId: 'usr_insp_003',
    inspectorName: 'Amit Sharma',
    daysAgo: 7,
    hoursOffset: 2
  },
  {
    syncId: 'demo_sp_15',
    wagonNumber: 'WR/BCNHL/40112',
    bogieType: 'CASNUB_22_HS',
    condition: 'USED',
    position: 'SNUBBER',
    measuredHeight: 288.5, // Band III YELLOW (287-290)
    inspectorId: 'usr_insp_001',
    inspectorName: 'Ramesh Kumar',
    daysAgo: 7,
    hoursOffset: 3
  },

  // Wagon 5 (CR/BOBRN/50223) - 3 Springs (CASNUB_22_RFT)
  {
    syncId: 'demo_sp_16',
    wagonNumber: 'CR/BOBRN/50223',
    bogieType: 'CASNUB_22_RFT',
    condition: 'USED',
    position: 'OUTER',
    measuredHeight: 273.0, // Band I BLUE (272-275)
    inspectorId: 'usr_insp_004',
    inspectorName: 'Vikram Yadav',
    daysAgo: 6,
    hoursOffset: 1
  },
  {
    syncId: 'demo_sp_17',
    wagonNumber: 'CR/BOBRN/50223',
    bogieType: 'CASNUB_22_RFT',
    condition: 'USED',
    position: 'INNER',
    measuredHeight: 229.5, // Band IV ORANGE (228-231)
    inspectorId: 'usr_insp_002',
    inspectorName: 'Praveen Singh',
    daysAgo: 6,
    hoursOffset: 2
  },
  {
    syncId: 'demo_sp_18',
    wagonNumber: 'CR/BOBRN/50223',
    bogieType: 'CASNUB_22_RFT',
    condition: 'USED',
    position: 'SNUBBER',
    measuredHeight: 290.5, // Band VI RED (289-292)
    inspectorId: 'usr_insp_003',
    inspectorName: 'Amit Sharma',
    daysAgo: 6,
    hoursOffset: 3
  },

  // Wagon 6 (NR/BOXN/60334) - 3 Springs
  {
    syncId: 'demo_sp_19',
    wagonNumber: 'NR/BOXN/60334',
    bogieType: 'CASNUB_22_NLB',
    condition: 'USED',
    position: 'OUTER',
    measuredHeight: 249.0, // Band V WHITE (248-251)
    inspectorId: 'usr_insp_001',
    inspectorName: 'Ramesh Kumar',
    daysAgo: 8,
    hoursOffset: 1
  },
  {
    syncId: 'demo_sp_20',
    wagonNumber: 'NR/BOXN/60334',
    bogieType: 'CASNUB_22_NLB',
    condition: 'USED',
    position: 'INNER',
    measuredHeight: 254.5, // Band IV ORANGE (253-256)
    inspectorId: 'usr_insp_002',
    inspectorName: 'Praveen Singh',
    daysAgo: 8,
    hoursOffset: 2
  },
  {
    syncId: 'demo_sp_21',
    wagonNumber: 'NR/BOXN/60334',
    bogieType: 'CASNUB_22_NLB',
    condition: 'USED',
    position: 'SNUBBER',
    measuredHeight: 293.0, // Band II GREEN (291-294)
    inspectorId: 'usr_insp_004',
    inspectorName: 'Vikram Yadav',
    daysAgo: 8,
    hoursOffset: 3
  },

  // Wagon 7 (WCR/BOXNHL/70445) - 3 Springs (NEW Condition)
  {
    syncId: 'demo_sp_22',
    wagonNumber: 'WCR/BOXNHL/70445',
    bogieType: 'CASNUB_22_NLB',
    condition: 'NEW',
    position: 'OUTER',
    measuredHeight: 262.0, // Band I GREEN (261-263)
    inspectorId: 'usr_insp_003',
    inspectorName: 'Amit Sharma',
    daysAgo: 4,
    hoursOffset: 1
  },
  {
    syncId: 'demo_sp_23',
    wagonNumber: 'WCR/BOXNHL/70445',
    bogieType: 'CASNUB_22_NLB',
    condition: 'NEW',
    position: 'INNER',
    measuredHeight: 262.0, // Band II YELLOW (261-263)
    inspectorId: 'usr_insp_001',
    inspectorName: 'Ramesh Kumar',
    daysAgo: 4,
    hoursOffset: 2
  },
  {
    syncId: 'demo_sp_24',
    wagonNumber: 'WCR/BOXNHL/70445',
    bogieType: 'CASNUB_22_NLB',
    condition: 'NEW',
    position: 'SNUBBER',
    measuredHeight: 292.0, // Band III RED (291-293)
    inspectorId: 'usr_insp_002',
    inspectorName: 'Praveen Singh',
    daysAgo: 4,
    hoursOffset: 3
  },

  // Wagon 8 (SECR/BCNHL/80556) - 3 Springs (CASNUB_22_HS)
  {
    syncId: 'demo_sp_25',
    wagonNumber: 'SECR/BCNHL/80556',
    bogieType: 'CASNUB_22_HS',
    condition: 'USED',
    position: 'OUTER',
    measuredHeight: 262.5, // Band I BLUE (260-263)
    inspectorId: 'usr_insp_004',
    inspectorName: 'Vikram Yadav',
    daysAgo: 3,
    hoursOffset: 1
  },
  {
    syncId: 'demo_sp_26',
    wagonNumber: 'SECR/BCNHL/80556',
    bogieType: 'CASNUB_22_HS',
    condition: 'USED',
    position: 'INNER',
    measuredHeight: 238.5, // Band III YELLOW (237-240)
    inspectorId: 'usr_insp_001',
    inspectorName: 'Ramesh Kumar',
    daysAgo: 3,
    hoursOffset: 2
  },
  {
    syncId: 'demo_sp_27',
    wagonNumber: 'SECR/BCNHL/80556',
    bogieType: 'CASNUB_22_HS',
    condition: 'USED',
    position: 'SNUBBER',
    measuredHeight: 280.0, // Band VI RED (278-281)
    inspectorId: 'usr_insp_003',
    inspectorName: 'Amit Sharma',
    daysAgo: 3,
    hoursOffset: 3
  },

  // Wagon 9 (ECOR/BOBRN/90667) - 4 Springs (1 CONDEMNED Damage + 3 PASS)
  {
    syncId: 'demo_sp_28',
    wagonNumber: 'ECOR/BOBRN/90667',
    bogieType: 'CASNUB_22_RFT',
    condition: 'USED',
    position: 'OUTER',
    measuredHeight: 270.5, // Band II GREEN (269-272)
    inspectorId: 'usr_insp_002',
    inspectorName: 'Praveen Singh',
    daysAgo: 2,
    hoursOffset: 1
  },
  {
    syncId: 'demo_sp_29',
    wagonNumber: 'ECOR/BOBRN/90667',
    bogieType: 'CASNUB_22_RFT',
    condition: 'USED',
    position: 'INNER',
    measuredHeight: 226.5, // Band V WHITE (225-228)
    inspectorId: 'usr_insp_003',
    inspectorName: 'Amit Sharma',
    daysAgo: 2,
    hoursOffset: 2
  },
  {
    syncId: 'demo_sp_30',
    wagonNumber: 'ECOR/BOBRN/90667',
    bogieType: 'CASNUB_22_RFT',
    condition: 'USED',
    position: 'SNUBBER',
    measuredHeight: 296.0, // Band IV ORANGE (295-298)
    inspectorId: 'usr_insp_001',
    inspectorName: 'Ramesh Kumar',
    daysAgo: 2,
    hoursOffset: 3
  },
  {
    syncId: 'demo_sp_31',
    wagonNumber: 'ECOR/BOBRN/90667',
    bogieType: 'CASNUB_22_RFT',
    condition: 'USED',
    position: 'SNUBBER',
    measuredHeight: 302.0,
    damageType: 'CRACK',
    damageNotes: 'Transverse fatigue crack on 3rd active coil',
    inspectorId: 'usr_insp_004',
    inspectorName: 'Vikram Yadav',
    daysAgo: 2,
    hoursOffset: 4
  },

  // Wagon 10 (SR/BOXNHL/10778) - 4 Springs (NEW + USED)
  {
    syncId: 'demo_sp_32',
    wagonNumber: 'SR/BOXNHL/10778',
    bogieType: 'CASNUB_22_HS',
    condition: 'NEW',
    position: 'OUTER',
    measuredHeight: 262.5, // Band I GREEN (261-263)
    inspectorId: 'usr_insp_001',
    inspectorName: 'Ramesh Kumar',
    daysAgo: 2,
    hoursOffset: 1
  },
  {
    syncId: 'demo_sp_33',
    wagonNumber: 'SR/BOXNHL/10778',
    bogieType: 'CASNUB_22_HS',
    condition: 'NEW',
    position: 'INNER',
    measuredHeight: 242.0, // Band II YELLOW (241-243)
    inspectorId: 'usr_insp_002',
    inspectorName: 'Praveen Singh',
    daysAgo: 2,
    hoursOffset: 2
  },
  {
    syncId: 'demo_sp_34',
    wagonNumber: 'SR/BOXNHL/10778',
    bogieType: 'CASNUB_22_HS',
    condition: 'NEW',
    position: 'SNUBBER',
    measuredHeight: 291.0, // Band III RED (290-292)
    inspectorId: 'usr_insp_003',
    inspectorName: 'Amit Sharma',
    daysAgo: 2,
    hoursOffset: 3
  },
  {
    syncId: 'demo_sp_35',
    wagonNumber: 'SR/BOXNHL/10778',
    bogieType: 'CASNUB_22_NLB',
    condition: 'USED',
    position: 'OUTER',
    measuredHeight: 261.0, // Band I BLUE (260-263)
    inspectorId: 'usr_insp_004',
    inspectorName: 'Vikram Yadav',
    daysAgo: 2,
    hoursOffset: 4
  },

  // Wagon 11 (NCR/BOXN/20889) - 2 Springs
  {
    syncId: 'demo_sp_36',
    wagonNumber: 'NCR/BOXN/20889',
    bogieType: 'CASNUB_22_NLB',
    condition: 'USED',
    position: 'OUTER',
    measuredHeight: 261.8, // Band I BLUE (260-263)
    inspectorId: 'usr_insp_001',
    inspectorName: 'Ramesh Kumar',
    daysAgo: 2,
    hoursOffset: 1
  },
  {
    syncId: 'demo_sp_37',
    wagonNumber: 'NCR/BOXN/20889',
    bogieType: 'CASNUB_22_NLB',
    condition: 'USED',
    position: 'INNER',
    measuredHeight: 258.0, // Band III YELLOW (256-259)
    inspectorId: 'usr_insp_002',
    inspectorName: 'Praveen Singh',
    daysAgo: 2,
    hoursOffset: 2
  },

  // Wagon 12 (ER/BCNHL/30990) - 2 Springs
  {
    syncId: 'demo_sp_38',
    wagonNumber: 'ER/BCNHL/30990',
    bogieType: 'CASNUB_22_HS',
    condition: 'USED',
    position: 'OUTER',
    measuredHeight: 258.5, // Band II GREEN (257-260)
    inspectorId: 'usr_insp_003',
    inspectorName: 'Amit Sharma',
    daysAgo: 1,
    hoursOffset: 1
  },
  {
    syncId: 'demo_sp_39',
    wagonNumber: 'ER/BCNHL/30990',
    bogieType: 'CASNUB_22_HS',
    condition: 'USED',
    position: 'INNER',
    measuredHeight: 235.0, // Band IV ORANGE (234-237)
    inspectorId: 'usr_insp_004',
    inspectorName: 'Vikram Yadav',
    daysAgo: 1,
    hoursOffset: 2
  },

  // Wagon 13 (SECR/BOXNHL/40101) - 1 Spring
  {
    syncId: 'demo_sp_40',
    wagonNumber: 'SECR/BOXNHL/40101',
    bogieType: 'CASNUB_22_NLB',
    condition: 'USED',
    position: 'OUTER',
    measuredHeight: 260.5, // Band I BLUE (260-263)
    inspectorId: 'usr_insp_001',
    inspectorName: 'Ramesh Kumar',
    daysAgo: 0,
    hoursOffset: 0
  }
];

// ---------------------------------------------------------------------------
// 22 Serialized Components Master Specification (RDSO R4 Serialization)
// ---------------------------------------------------------------------------

interface DemoComponentSpec {
  id: string;
  serialNumber: string;
  componentType: SerializedComponentType;
  category: CASNUBCategory;
  partName: string;
  qrCode: string;
  rfidTag?: string;
  status: ComponentStatus;
  currentWagonNumber: string | null;
  currentBogiePosition: 'BOGIE_1' | 'BOGIE_2' | 'UNDERFRAME' | 'BODY' | 'NONE';
  manufacturingDate: string;
  manufacturer: string;
  totalKmTravelled: number;
  overhaulCount: number;
  lastPohDate?: string;
  nextPohDue?: string;
  healthScore: number;
  healthStatus: ComponentHealthStatus;
  binLocation?: string;
  historyEvents?: Array<{
    eventType: ComponentEventType;
    wagonNumber?: string;
    stage?: string;
    actionDetails: string;
    performedBy: string;
    performerName: string;
    notes?: string;
    daysAgo: number;
    hoursOffset?: number;
  }>;
}

const DEMO_COMPONENTS: DemoComponentSpec[] = [
  // 1. Wagon 1 (SECR/BOXNHL/10492 - RELEASED)
  {
    id: 'cmp_demo_01',
    serialNumber: 'WHL-RWF-2023-8841',
    componentType: 'WHEELSET',
    category: 'WHEELS_AXLES',
    partName: 'CASNUB Wheelset Assembly 1000mm (Forged Solid Wheels & Axle)',
    qrCode: 'WRS-PASSPORT|WHL-RWF-2023-8841|WHEELSET|RWF_YELAHANKA',
    rfidTag: 'RFID-WS-8841-01',
    status: 'IN_SERVICE',
    currentWagonNumber: 'SECR/BOXNHL/10492',
    currentBogiePosition: 'BOGIE_1',
    manufacturingDate: '2023-04-15',
    manufacturer: 'Rail Wheel Factory (RWF) Yelahanka',
    totalKmTravelled: 42500.0,
    overhaulCount: 1,
    lastPohDate: '2026-07-22',
    nextPohDue: '2030-01-22',
    healthScore: 98.0,
    healthStatus: 'EXCELLENT',
    historyEvents: [
      {
        eventType: 'COMMISSIONED',
        actionDetails: 'Commissioned at WRS Raipur stores depot following ultrasonic axle testing.',
        performedBy: 'usr_insp_001',
        performerName: 'Ramesh Kumar',
        daysAgo: 28,
        hoursOffset: 2
      },
      {
        eventType: 'ASSIGNED_TO_WAGON',
        wagonNumber: 'SECR/BOXNHL/10492',
        stage: 'REASSEMBLY',
        actionDetails: 'Mounted to Bogie 1 position during POH overhaul cycle.',
        performedBy: 'usr_sup_001',
        performerName: 'S. K. Verma',
        daysAgo: 24,
        hoursOffset: 4
      }
    ]
  },
  {
    id: 'cmp_demo_02',
    serialNumber: 'BRG-SKF-2023-9941',
    componentType: 'BEARING',
    category: 'BEARINGS',
    partName: 'Class E (6"x11") CTRB Cartridge Tapered Roller Bearing',
    qrCode: 'WRS-PASSPORT|BRG-SKF-2023-9941|BEARING|SKF_INDIA',
    rfidTag: 'RFID-BRG-9941-01',
    status: 'IN_SERVICE',
    currentWagonNumber: 'SECR/BOXNHL/10492',
    currentBogiePosition: 'BOGIE_1',
    manufacturingDate: '2023-06-10',
    manufacturer: 'SKF India Ltd (Bangalore)',
    totalKmTravelled: 38000.0,
    overhaulCount: 1,
    lastPohDate: '2026-07-22',
    nextPohDue: '2030-01-22',
    healthScore: 96.0,
    healthStatus: 'EXCELLENT',
    historyEvents: [
      {
        eventType: 'COMMISSIONED',
        actionDetails: 'Cleaned, greased, and fitted with new poly-amide cage seal.',
        performedBy: 'usr_insp_002',
        performerName: 'Praveen Singh',
        daysAgo: 28
      }
    ]
  },
  {
    id: 'cmp_demo_03',
    serialNumber: 'DGF-CW-2022-3810',
    componentType: 'DRAFT_GEAR',
    category: 'COUPLERS_DRAFT_GEAR',
    partName: 'Mark-50 High Capacity Friction Draft Gear',
    qrCode: 'WRS-PASSPORT|DGF-CW-2022-3810|DRAFT_GEAR|CARDWELL_WESTINGHOUSE',
    rfidTag: 'RFID-DG-3810-01',
    status: 'IN_SERVICE',
    currentWagonNumber: 'SECR/BOXNHL/10492',
    currentBogiePosition: 'BODY',
    manufacturingDate: '2022-11-20',
    manufacturer: 'Cardwell Westinghouse',
    totalKmTravelled: 85000.0,
    overhaulCount: 2,
    lastPohDate: '2026-07-22',
    nextPohDue: '2030-01-22',
    healthScore: 95.0,
    healthStatus: 'EXCELLENT'
  },
  {
    id: 'cmp_demo_04',
    serialNumber: 'CBC-TRSL-2023-1120',
    componentType: 'COUPLER',
    category: 'COUPLERS_DRAFT_GEAR',
    partName: 'AAR Type E/F High Tensile Center Buffer Coupler (CBC)',
    qrCode: 'WRS-PASSPORT|CBC-TRSL-2023-1120|COUPLER|TITAGARH_RAIL',
    rfidTag: 'RFID-CBC-1120-01',
    status: 'IN_SERVICE',
    currentWagonNumber: 'SECR/BOXNHL/10492',
    currentBogiePosition: 'BODY',
    manufacturingDate: '2023-02-18',
    manufacturer: 'Titagarh Rail Systems Ltd (TRSL)',
    totalKmTravelled: 34000.0,
    overhaulCount: 1,
    lastPohDate: '2026-07-22',
    nextPohDue: '2030-01-22',
    healthScore: 97.0,
    healthStatus: 'EXCELLENT'
  },

  // 2. Wagon 2 (ECOR/BOXNHL/20831 - RELEASED)
  {
    id: 'cmp_demo_05',
    serialNumber: 'WHL-BSP-2022-4912',
    componentType: 'WHEELSET',
    category: 'WHEELS_AXLES',
    partName: 'CASNUB Wheelset Assembly 1000mm (Forged Solid Wheels & Axle)',
    qrCode: 'WRS-PASSPORT|WHL-BSP-2022-4912|WHEELSET|BHILAI_STEEL_PLANT',
    rfidTag: 'RFID-WS-4912-02',
    status: 'IN_SERVICE',
    currentWagonNumber: 'ECOR/BOXNHL/20831',
    currentBogiePosition: 'BOGIE_2',
    manufacturingDate: '2022-09-12',
    manufacturer: 'Bhilai Steel Plant (BSP / SAIL)',
    totalKmTravelled: 92000.0,
    overhaulCount: 2,
    lastPohDate: '2026-08-08',
    nextPohDue: '2030-02-08',
    healthScore: 92.0,
    healthStatus: 'EXCELLENT'
  },
  {
    id: 'cmp_demo_06',
    serialNumber: 'BRG-TMK-2022-7721',
    componentType: 'BEARING',
    category: 'BEARINGS',
    partName: 'Class E (6"x11") CTRB Cartridge Tapered Roller Bearing',
    qrCode: 'WRS-PASSPORT|BRG-TMK-2022-7721|BEARING|TIMKEN_INDIA',
    rfidTag: 'RFID-BRG-7721-02',
    status: 'IN_SERVICE',
    currentWagonNumber: 'ECOR/BOXNHL/20831',
    currentBogiePosition: 'BOGIE_2',
    manufacturingDate: '2022-08-25',
    manufacturer: 'Timken India Ltd (Jamshedpur)',
    totalKmTravelled: 89000.0,
    overhaulCount: 2,
    lastPohDate: '2026-08-08',
    nextPohDue: '2030-02-08',
    healthScore: 90.0,
    healthStatus: 'EXCELLENT'
  },
  {
    id: 'cmp_demo_07',
    serialNumber: 'DGF-TEX-2023-4419',
    componentType: 'DRAFT_GEAR',
    category: 'COUPLERS_DRAFT_GEAR',
    partName: 'Mark-50 High Capacity Friction Draft Gear',
    qrCode: 'WRS-PASSPORT|DGF-TEX-2023-4419|DRAFT_GEAR|TEXMACO_RAIL',
    rfidTag: 'RFID-DG-4419-02',
    status: 'IN_SERVICE',
    currentWagonNumber: 'ECOR/BOXNHL/20831',
    currentBogiePosition: 'BODY',
    manufacturingDate: '2023-01-14',
    manufacturer: 'Texmaco Rail & Engineering Ltd',
    totalKmTravelled: 41000.0,
    overhaulCount: 1,
    lastPohDate: '2026-08-08',
    nextPohDue: '2030-02-08',
    healthScore: 94.0,
    healthStatus: 'EXCELLENT'
  },

  // 3. Wagon 3 (SER/BOXNHL/30914 - Blocked Gate)
  {
    id: 'cmp_demo_08',
    serialNumber: 'WHL-RWP-2021-1082',
    componentType: 'WHEELSET',
    category: 'WHEELS_AXLES',
    partName: 'CASNUB Wheelset Assembly 1000mm (Forged Solid Wheels & Axle)',
    qrCode: 'WRS-PASSPORT|WHL-RWP-2021-1082|WHEELSET|RWP_BELA',
    rfidTag: 'RFID-WS-1082-03',
    status: 'IN_SERVICE',
    currentWagonNumber: 'SER/BOXNHL/30914',
    currentBogiePosition: 'BOGIE_1',
    manufacturingDate: '2021-05-19',
    manufacturer: 'Rail Wheel Plant (RWP) Bela',
    totalKmTravelled: 165000.0,
    overhaulCount: 3,
    healthScore: 54.0,
    healthStatus: 'ATTENTION_REQUIRED'
  },
  {
    id: 'cmp_demo_09',
    serialNumber: 'BRG-NBC-2020-3310',
    componentType: 'BEARING',
    category: 'BEARINGS',
    partName: 'Class E (6"x11") CTRB Cartridge Tapered Roller Bearing',
    qrCode: 'WRS-PASSPORT|BRG-NBC-2020-3310|BEARING|NBC_BEARINGS',
    rfidTag: 'RFID-BRG-3310-03',
    status: 'IN_SERVICE',
    currentWagonNumber: 'SER/BOXNHL/30914',
    currentBogiePosition: 'BOGIE_1',
    manufacturingDate: '2020-10-08',
    manufacturer: 'National Engineering Industries (NBC) Jaipur',
    totalKmTravelled: 198000.0,
    overhaulCount: 4,
    healthScore: 38.0,
    healthStatus: 'CRITICAL'
  },

  // 4. Wagon 4 (WR/BCNHL/40112 - Reassembly)
  {
    id: 'cmp_demo_10',
    serialNumber: 'WHL-RWF-2024-5501',
    componentType: 'WHEELSET',
    category: 'WHEELS_AXLES',
    partName: 'CASNUB Wheelset Assembly 1000mm (Forged Solid Wheels & Axle)',
    qrCode: 'WRS-PASSPORT|WHL-RWF-2024-5501|WHEELSET|RWF_YELAHANKA',
    rfidTag: 'RFID-WS-5501-04',
    status: 'IN_SERVICE',
    currentWagonNumber: 'WR/BCNHL/40112',
    currentBogiePosition: 'BOGIE_1',
    manufacturingDate: '2024-01-20',
    manufacturer: 'Rail Wheel Factory (RWF) Yelahanka',
    totalKmTravelled: 5000.0,
    overhaulCount: 0,
    healthScore: 100.0,
    healthStatus: 'EXCELLENT'
  },
  {
    id: 'cmp_demo_11',
    serialNumber: 'BLS-SMP-2021-0492',
    componentType: 'BOGIE_FRAME_BOLSTER',
    category: 'BOGIE_FRAME_BOLSTER',
    partName: 'CASNUB 22NLB Cast Steel Bolster & Side Frame',
    qrCode: 'WRS-PASSPORT|BLS-SMP-2021-0492|BOGIE_FRAME_BOLSTER|SIMPLEX_CASTINGS',
    rfidTag: 'RFID-BLS-0492-04',
    status: 'IN_SERVICE',
    currentWagonNumber: 'WR/BCNHL/40112',
    currentBogiePosition: 'BOGIE_1',
    manufacturingDate: '2021-07-15',
    manufacturer: 'Simplex Castings Ltd (Raipur)',
    totalKmTravelled: 120000.0,
    overhaulCount: 2,
    healthScore: 91.0,
    healthStatus: 'EXCELLENT'
  },

  // 5. Wagon 6 (NR/BOXN/60334 - Repair / Replacement)
  {
    id: 'cmp_demo_12',
    serialNumber: 'VAL-KB-2023-6612',
    componentType: 'BRAKE_VALVE',
    category: 'BRAKE_SYSTEM',
    partName: 'Distributor Valve (DV) Type 02-ABR-02 Graduated Release',
    qrCode: 'WRS-PASSPORT|VAL-KB-2023-6612|BRAKE_VALVE|KNORR_BREMSE',
    rfidTag: 'RFID-VAL-6612-06',
    status: 'IN_SERVICE',
    currentWagonNumber: 'NR/BOXN/60334',
    currentBogiePosition: 'UNDERFRAME',
    manufacturingDate: '2023-05-11',
    manufacturer: 'Knorr-Bremse India Ltd (Palwal)',
    totalKmTravelled: 55000.0,
    overhaulCount: 1,
    healthScore: 88.0,
    healthStatus: 'GOOD'
  },

  // 6. Stores Inventory Spares (Available for QR Scanning & Assignment)
  {
    id: 'cmp_demo_13',
    serialNumber: 'WHL-RWF-2024-9001',
    componentType: 'WHEELSET',
    category: 'WHEELS_AXLES',
    partName: 'CASNUB Wheelset Assembly 1000mm (Forged Solid Wheels & Axle)',
    qrCode: 'WRS-PASSPORT|WHL-RWF-2024-9001|WHEELSET|RWF_YELAHANKA',
    rfidTag: 'RFID-WS-9001-ST',
    status: 'AVAILABLE_IN_STORES',
    currentWagonNumber: null,
    currentBogiePosition: 'NONE',
    manufacturingDate: '2024-03-01',
    manufacturer: 'Rail Wheel Factory (RWF) Yelahanka',
    totalKmTravelled: 0.0,
    overhaulCount: 0,
    healthScore: 100.0,
    healthStatus: 'EXCELLENT',
    binLocation: 'BIN-W1'
  },
  {
    id: 'cmp_demo_14',
    serialNumber: 'WHL-BSP-2024-9002',
    componentType: 'WHEELSET',
    category: 'WHEELS_AXLES',
    partName: 'CASNUB Wheelset Assembly 1000mm (Forged Solid Wheels & Axle)',
    qrCode: 'WRS-PASSPORT|WHL-BSP-2024-9002|WHEELSET|BHILAI_STEEL_PLANT',
    rfidTag: 'RFID-WS-9002-ST',
    status: 'AVAILABLE_IN_STORES',
    currentWagonNumber: null,
    currentBogiePosition: 'NONE',
    manufacturingDate: '2024-03-10',
    manufacturer: 'Bhilai Steel Plant (BSP / SAIL)',
    totalKmTravelled: 0.0,
    overhaulCount: 0,
    healthScore: 100.0,
    healthStatus: 'EXCELLENT',
    binLocation: 'BIN-W2'
  },
  {
    id: 'cmp_demo_15',
    serialNumber: 'BRG-SKF-2024-1011',
    componentType: 'BEARING',
    category: 'BEARINGS',
    partName: 'Class E (6"x11") CTRB Cartridge Tapered Roller Bearing',
    qrCode: 'WRS-PASSPORT|BRG-SKF-2024-1011|BEARING|SKF_INDIA',
    rfidTag: 'RFID-BRG-1011-ST',
    status: 'AVAILABLE_IN_STORES',
    currentWagonNumber: null,
    currentBogiePosition: 'NONE',
    manufacturingDate: '2024-02-15',
    manufacturer: 'SKF India Ltd (Bangalore)',
    totalKmTravelled: 0.0,
    overhaulCount: 0,
    healthScore: 100.0,
    healthStatus: 'EXCELLENT',
    binLocation: 'BIN-B1'
  },
  {
    id: 'cmp_demo_16',
    serialNumber: 'BRG-TMK-2024-1012',
    componentType: 'BEARING',
    category: 'BEARINGS',
    partName: 'Class E (6"x11") CTRB Cartridge Tapered Roller Bearing',
    qrCode: 'WRS-PASSPORT|BRG-TMK-2024-1012|BEARING|TIMKEN_INDIA',
    rfidTag: 'RFID-BRG-1012-ST',
    status: 'AVAILABLE_IN_STORES',
    currentWagonNumber: null,
    currentBogiePosition: 'NONE',
    manufacturingDate: '2024-02-20',
    manufacturer: 'Timken India Ltd (Jamshedpur)',
    totalKmTravelled: 0.0,
    overhaulCount: 0,
    healthScore: 100.0,
    healthStatus: 'EXCELLENT',
    binLocation: 'BIN-B2'
  },
  {
    id: 'cmp_demo_17',
    serialNumber: 'DGF-CW-2024-2001',
    componentType: 'DRAFT_GEAR',
    category: 'COUPLERS_DRAFT_GEAR',
    partName: 'Mark-50 High Capacity Friction Draft Gear',
    qrCode: 'WRS-PASSPORT|DGF-CW-2024-2001|DRAFT_GEAR|CARDWELL_WESTINGHOUSE',
    rfidTag: 'RFID-DG-2001-ST',
    status: 'AVAILABLE_IN_STORES',
    currentWagonNumber: null,
    currentBogiePosition: 'NONE',
    manufacturingDate: '2024-01-10',
    manufacturer: 'Cardwell Westinghouse',
    totalKmTravelled: 0.0,
    overhaulCount: 0,
    healthScore: 100.0,
    healthStatus: 'EXCELLENT',
    binLocation: 'BIN-D1'
  },
  {
    id: 'cmp_demo_18',
    serialNumber: 'CBC-TRSL-2024-3001',
    componentType: 'COUPLER',
    category: 'COUPLERS_DRAFT_GEAR',
    partName: 'AAR Type E/F High Tensile Center Buffer Coupler (CBC)',
    qrCode: 'WRS-PASSPORT|CBC-TRSL-2024-3001|COUPLER|TITAGARH_RAIL',
    rfidTag: 'RFID-CBC-3001-ST',
    status: 'AVAILABLE_IN_STORES',
    currentWagonNumber: null,
    currentBogiePosition: 'NONE',
    manufacturingDate: '2024-01-25',
    manufacturer: 'Titagarh Rail Systems Ltd (TRSL)',
    totalKmTravelled: 0.0,
    overhaulCount: 0,
    healthScore: 100.0,
    healthStatus: 'EXCELLENT',
    binLocation: 'BIN-C1'
  },
  {
    id: 'cmp_demo_19',
    serialNumber: 'BLS-BEC-2023-8819',
    componentType: 'BOGIE_FRAME_BOLSTER',
    category: 'BOGIE_FRAME_BOLSTER',
    partName: 'CASNUB 22NLB Cast Steel Bolster & Side Frame',
    qrCode: 'WRS-PASSPORT|BLS-BEC-2023-8819|BOGIE_FRAME_BOLSTER|BHILAI_ENG',
    rfidTag: 'RFID-BLS-8819-ST',
    status: 'AVAILABLE_IN_STORES',
    currentWagonNumber: null,
    currentBogiePosition: 'NONE',
    manufacturingDate: '2023-09-05',
    manufacturer: 'Bhilai Engineering Corporation (BEC)',
    totalKmTravelled: 15000.0,
    overhaulCount: 1,
    healthScore: 95.0,
    healthStatus: 'EXCELLENT',
    binLocation: 'BIN-F1'
  },
  {
    id: 'cmp_demo_20',
    serialNumber: 'VAL-FTR-2022-8104',
    componentType: 'BRAKE_VALVE',
    category: 'BRAKE_SYSTEM',
    partName: 'Distributor Valve (DV) Type 02-ABR-02 Graduated Release',
    qrCode: 'WRS-PASSPORT|VAL-FTR-2022-8104|BRAKE_VALVE|FAIVELEY_TRANSPORT',
    rfidTag: 'RFID-VAL-8104-ST',
    status: 'RECONDITIONED',
    currentWagonNumber: null,
    currentBogiePosition: 'NONE',
    manufacturingDate: '2022-04-18',
    manufacturer: 'Faiveley Transport Rail Technologies',
    totalKmTravelled: 78000.0,
    overhaulCount: 1,
    lastPohDate: '2026-06-15',
    nextPohDue: '2030-01-15',
    healthScore: 92.0,
    healthStatus: 'EXCELLENT',
    binLocation: 'BIN-V1'
  },
  {
    id: 'cmp_demo_21',
    serialNumber: 'WDG-WRS-2024-0012',
    componentType: 'FRICTION_WEDGE',
    category: 'FRICTION_WEDGES',
    partName: 'CASNUB Cast Iron Snubber Friction Wedge',
    qrCode: 'WRS-PASSPORT|WDG-WRS-2024-0012|FRICTION_WEDGE|WRS_RAIPUR',
    rfidTag: 'RFID-WDG-0012-ST',
    status: 'AVAILABLE_IN_STORES',
    currentWagonNumber: null,
    currentBogiePosition: 'NONE',
    manufacturingDate: '2024-03-05',
    manufacturer: 'WRS Raipur Foundry Shop',
    totalKmTravelled: 0.0,
    overhaulCount: 0,
    healthScore: 100.0,
    healthStatus: 'EXCELLENT',
    binLocation: 'BIN-W3'
  },
  {
    id: 'cmp_demo_22',
    serialNumber: 'BRG-NBC-2019-9901',
    componentType: 'BEARING',
    category: 'BEARINGS',
    partName: 'Class E (6"x11") CTRB Cartridge Tapered Roller Bearing',
    qrCode: 'WRS-PASSPORT|BRG-NBC-2019-9901|BEARING|NBC_BEARINGS',
    rfidTag: 'RFID-BRG-9901-SC',
    status: 'CONDEMNED',
    currentWagonNumber: null,
    currentBogiePosition: 'NONE',
    manufacturingDate: '2019-03-12',
    manufacturer: 'National Engineering Industries (NBC) Jaipur',
    totalKmTravelled: 265000.0,
    overhaulCount: 4,
    healthScore: 15.0,
    healthStatus: 'CRITICAL',
    binLocation: 'BIN-SCRAP'
  }
];

// ---------------------------------------------------------------------------
// Main Seed Function (Strictly Idempotent)
// ---------------------------------------------------------------------------

export function seedUsers(db?: DatabaseSync): void {
  const database = db || getDatabase();
  const checkUserStmt = database.prepare('SELECT id FROM users WHERE id = ? OR username = ? OR employee_id = ?');
  const insertUserStmt = database.prepare(`
    INSERT OR IGNORE INTO users (id, username, password_hash, role, full_name, employee_id, is_active)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `);

  for (const u of DEMO_USERS) {
    if (!checkUserStmt.get(u.id, u.username, u.employee_id)) {
      const hashed = hashPassword(u.password);
      insertUserStmt.run(u.id, u.username, hashed, u.role, u.full_name, u.employee_id);
    }
  }
}

export function seedDemoData(db?: DatabaseSync): void {
  const database = db || getDatabase();

  console.log('⚡ [Demo Seed] Initializing Rich Demo Seed Data for WRS Raipur...');

  // 1. Seed Users
  seedUsers(database);

  // 2. Seed Checklist Config Templates
  const wagonTypes = ['DEFAULT', 'BOXNHL', 'BOXN', 'BCNHL', 'BOBRN'];
  const insertConfigStmt = database.prepare(`
    INSERT OR IGNORE INTO checklist_config (
      id, wagon_type, category, part_name, bogie_position, is_mandatory, standard_reference, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const nowIso = new Date().toISOString();
  for (const wt of wagonTypes) {
    for (const it of CASNUB_CHECKLIST_TEMPLATE) {
      const id = `cfg_${wt}_${it.category}_${it.partName}`.replace(/[^a-zA-Z0-9_]/g, '_');
      insertConfigStmt.run(id, wt, it.category, it.partName, it.bogiePosition, it.isMandatory, it.std, nowIso, nowIso);
    }
  }

  // 3. Seed 13 Wagons across all 7 stages
  const checkWagonStmt = database.prepare('SELECT * FROM wagons WHERE id = ? OR wagon_number = ? COLLATE NOCASE');
  const insertWagonStmt = database.prepare(`
    INSERT INTO wagons (
      id, wagon_number, wagon_type, owning_railway, current_stage, status,
      entry_date, target_release_date, actual_release_date, entry_notes, condition_notes,
      created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const updateWagonStmt = database.prepare(`
    UPDATE wagons
    SET wagon_number = ?, current_stage = ?, status = ?, entry_date = ?, target_release_date = ?,
        actual_release_date = ?, entry_notes = ?, condition_notes = ?, updated_at = ?
    WHERE id = ?
  `);

  for (const w of DEMO_WAGONS) {
    const normWagonNumber = w.wagonNumber.trim().toUpperCase();
    const entryDate = getIsoDate(w.entryDaysAgo, 2);
    const targetDate = getIsoDate(Math.max(0, w.entryDaysAgo - 7), 6);
    const actualReleaseDate = w.releaseDaysAgo !== undefined ? getIsoDate(w.releaseDaysAgo, 6) : null;
    const existing = checkWagonStmt.get(w.id, normWagonNumber) as any;

    if (!existing) {
      insertWagonStmt.run(
        w.id,
        normWagonNumber,
        w.wagonType,
        w.owningRailway,
        w.currentStage,
        w.status,
        entryDate,
        targetDate,
        actualReleaseDate,
        w.entryNotes,
        w.conditionNotes || null,
        w.createdBy,
        entryDate,
        actualReleaseDate || entryDate
      );
    } else {
      updateWagonStmt.run(
        normWagonNumber,
        w.currentStage,
        w.status,
        entryDate,
        targetDate,
        actualReleaseDate,
        w.entryNotes,
        w.conditionNotes || null,
        actualReleaseDate || entryDate,
        existing.id
      );
    }
  }

  // 4. Seed 40 Spring Inspection Records
  const checkInspStmt = database.prepare('SELECT id FROM inspections WHERE id = ? OR sync_id = ?');
  const insertInspStmt = database.prepare(`
    INSERT INTO inspections (
      id, sequence_number, sync_id, wagon_number, bogie_type, spring_condition, spring_position,
      measured_height, classified_band, band_roman, status, damage_type, damage_notes,
      table_reference, valid_range_min, valid_range_max, condemnation_reason,
      inspector_id, inspector_name, supervisor_override, original_band, override_band,
      override_reason, override_supervisor_id, override_supervisor_name, otp_token_ref,
      measurement_source, ocr_confidence, ocr_image_ref, offline_created_at, created_at, synced_at, audit_hash,
      bogie_position
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?,
      ?
    )
  `);

  for (const [springIdx, sp] of DEMO_SPRINGS.entries()) {
    const inspId = `insp_${sp.syncId}`;
    const existing = checkInspStmt.get(inspId, sp.syncId);
    if (!existing) {
      const normWagonNumber = sp.wagonNumber.trim().toUpperCase();
      const classification = classifySpring({
        bogieType: sp.bogieType,
        condition: sp.condition,
        position: sp.position,
        measuredHeight: sp.measuredHeight,
        damageType: sp.damageType || 'NONE',
        damageNotes: sp.damageNotes
      });

      const seq = getNextSeq(database);
      const createdAt = getIsoDate(sp.daysAgo, sp.hoursOffset || 0);

      const auditHash = generateAuditHash({
        id: inspId,
        sequence_number: seq,
        wagon_number: normWagonNumber,
        bogie_type: sp.bogieType,
        spring_position: sp.position,
        spring_condition: sp.condition,
        measured_height: sp.measuredHeight,
        classified_band: classification.band,
        status: classification.status,
        inspector_id: sp.inspectorId,
        created_at: createdAt
      });

      insertInspStmt.run(
        inspId,
        seq,
        sp.syncId,
        normWagonNumber,
        sp.bogieType,
        sp.condition,
        sp.position,
        sp.measuredHeight,
        classification.band,
        classification.bandRoman,
        classification.status,
        sp.damageType || 'NONE',
        sp.damageNotes || null,
        classification.tableReference,
        classification.validRange.min,
        classification.validRange.max,
        classification.condemnationReason || null,
        sp.inspectorId,
        sp.inspectorName,
        0,
        null,
        null,
        null,
        null,
        null,
        null,
        'MANUAL',
        null,
        null,
        null,
        createdAt,
        createdAt,
        auditHash,
        // Demo springs alternate across the two bogies so seeded data
        // exercises the same per-bogie checklist linkage real measurements do.
        (sp as any).bogiePosition || (springIdx % 2 === 0 ? 'BOGIE_1' : 'BOGIE_2')
      );
    }
  }

  // 5. Seed CASNUB Checklist Items per Wagon
  const checkItemStmt = database.prepare(`
    SELECT id FROM checklist_items
    WHERE id = ? OR (wagon_number = ? COLLATE NOCASE AND category = ? AND part_name = ? AND bogie_position = ?)
  `);

  const insertItemStmt = database.prepare(`
    INSERT INTO checklist_items (
      id, wagon_id, wagon_number, category, part_name, bogie_position,
      status, is_mandatory, condition_notes, repair_action, repair_notes,
      reinspected_status, inspector_id, inspector_name, photo_id,
      phase1_inspection_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
  `);

  const updateItemStmt = database.prepare(`
    UPDATE checklist_items
    SET wagon_id = ?, wagon_number = ?, status = ?, is_mandatory = ?, condition_notes = ?, repair_action = ?,
        repair_notes = ?, reinspected_status = ?, inspector_id = ?, inspector_name = ?,
        phase1_inspection_id = ?, updated_at = ?
    WHERE id = ?
  `);

  const inspectorList = [
    { id: 'usr_insp_001', name: 'Ramesh Kumar' },
    { id: 'usr_insp_002', name: 'Praveen Singh' },
    { id: 'usr_insp_003', name: 'Amit Sharma' },
    { id: 'usr_insp_004', name: 'Vikram Yadav' }
  ];

  for (const w of DEMO_WAGONS) {
    const normWagonNumber = w.wagonNumber.trim().toUpperCase();
    const wagonRow = checkWagonStmt.get(w.id, normWagonNumber) as any;
    const wagonId = wagonRow ? wagonRow.id : w.id;

    for (let i = 0; i < CASNUB_CHECKLIST_TEMPLATE.length; i++) {
      const it = CASNUB_CHECKLIST_TEMPLATE[i];
      const insp = inspectorList[i % inspectorList.length];
      const itemId = `chk_${w.id}_${i + 1}`;
      const createdAt = getIsoDate(w.entryDaysAgo, 3);
      const updatedAt = w.releaseDaysAgo !== undefined ? getIsoDate(w.releaseDaysAgo, 5) : getIsoDate(Math.max(0, w.entryDaysAgo - 2), 4);

      let status = 'PENDING';
      let repairAction: string | null = null;
      let repairNotes: string | null = null;
      let reinspectedStatus: string | null = null;
      let conditionNotes: string | null = null;
      let phase1InspectionId: string | null = null;

      // Status determination based on stage and wagon spec
      if (w.currentStage === 'ENTRY_REGISTRATION' || w.currentStage === 'DISMANTLING') {
        status = 'PENDING';
      } else if (w.currentStage === 'COMPONENT_INSPECTION') {
        if (it.category === 'SPRINGS') {
          status = 'PASS';
          conditionNotes = 'Spring classification passed RDSO G-95';
        } else if (i % 3 === 0) {
          status = 'PASS';
        } else if (i % 5 === 0) {
          status = 'FAIL';
          conditionNotes = 'Wear detected exceeding permissible limits';
        } else {
          status = 'PENDING';
        }
      } else if (w.currentStage === 'REPAIR_REPLACEMENT') {
        if (i % 4 === 0) {
          status = 'REPAIRED';
          repairAction = 'REPAIRED';
          repairNotes = 'Welfare welding & machining complete';
          reinspectedStatus = 'PASS';
        } else if (i % 6 === 0) {
          status = 'REPLACED';
          repairAction = 'REPLACED_NEW';
          repairNotes = 'Replaced with new RDSO-approved part';
          reinspectedStatus = 'PASS';
        } else if (i % 7 === 0) {
          status = 'FAIL';
          conditionNotes = 'Work in progress in machine shop';
        } else {
          status = 'PASS';
        }
      } else if (w.currentStage === 'REASSEMBLY') {
        if (i % 5 === 0) {
          status = 'REPAIRED';
          repairAction = 'REPAIRED';
          repairNotes = 'Overhauled and calibrated';
          reinspectedStatus = 'PASS';
        } else if (i % 7 === 0) {
          status = 'REPLACED';
          repairAction = 'REPLACED_NEW';
          repairNotes = 'New component fitted during reassembly';
          reinspectedStatus = 'PASS';
        } else {
          status = 'PASS';
        }
      } else if (w.currentStage === 'FINAL_QC_GATE' || w.currentStage === 'RELEASE') {
        // Stage 6 & 7: Highly completed checklist
        if (i % 6 === 0) {
          status = 'REPAIRED';
          repairAction = 'REPAIRED';
          repairNotes = 'Overhauled and reinspected with PASS';
          reinspectedStatus = 'PASS';
        } else if (i % 8 === 0) {
          status = 'REPLACED';
          repairAction = 'REPLACED_NEW';
          repairNotes = 'New unit fitted and certified';
          reinspectedStatus = 'PASS';
        } else {
          status = 'PASS';
        }
      }

      // Special active blockers for Wagon 3 at FINAL_QC_GATE
      if (w.isBlockerWagon) {
        if (it.category === 'BEARINGS' && it.partName.includes('CTRB')) {
          status = 'PENDING';
          conditionNotes = 'Awaiting rotational torque & temperature inspection';
        } else if (it.category === 'SPRINGS' && it.partName.includes('Outer Spring (Bogie 1)')) {
          status = 'CONDEMNED';
          conditionNotes = 'Free height 242.0 mm is below minimum permissible limit (245.0 mm) (Worn / Collapsed)';
          phase1InspectionId = 'insp_demo_sp_09';
        }
      }

      const existingItem = checkItemStmt.get(itemId, normWagonNumber, it.category, it.partName, it.bogiePosition) as any;
      if (!existingItem) {
        insertItemStmt.run(
          itemId,
          wagonId,
          normWagonNumber,
          it.category,
          it.partName,
          it.bogiePosition,
          status,
          it.isMandatory,
          conditionNotes,
          repairAction,
          repairNotes,
          reinspectedStatus,
          insp.id,
          insp.name,
          phase1InspectionId,
          createdAt,
          updatedAt
        );
      } else {
        updateItemStmt.run(
          wagonId,
          normWagonNumber,
          status,
          it.isMandatory,
          conditionNotes,
          repairAction,
          repairNotes,
          reinspectedStatus,
          insp.id,
          insp.name,
          phase1InspectionId,
          updatedAt,
          existingItem.id
        );
      }
    }
  }

  // 6. Seed Chronological Wagon Transitions
  const checkTransStmt = database.prepare(`
    SELECT id FROM wagon_transitions
    WHERE id = ? OR (wagon_number = ? COLLATE NOCASE AND from_stage = ? AND to_stage = ? AND transition_type = ?)
  `);

  const insertTransStmt = database.prepare(`
    INSERT INTO wagon_transitions (
      id, wagon_id, wagon_number, from_stage, to_stage, transition_type,
      performed_by, performer_name, performer_role, is_override, override_reason,
      supervisor_id, supervisor_name, otp_token_ref, notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const stageOrder: LifecycleStage[] = [
    'ENTRY_REGISTRATION',
    'DISMANTLING',
    'COMPONENT_INSPECTION',
    'REPAIR_REPLACEMENT',
    'REASSEMBLY',
    'FINAL_QC_GATE',
    'RELEASE'
  ];

  for (const w of DEMO_WAGONS) {
    const normWagonNumber = w.wagonNumber.trim().toUpperCase();
    const wagonRow = checkWagonStmt.get(w.id, normWagonNumber) as any;
    const wagonId = wagonRow ? wagonRow.id : w.id;
    const currentStageIndex = stageOrder.indexOf(w.currentStage);

    // Initial Registration Transition
    const regTransId = `trans_${w.id}_0`;
    const regCreatedAt = getIsoDate(w.entryDaysAgo, 2);
    if (!checkTransStmt.get(regTransId, normWagonNumber, 'ENTRY_REGISTRATION', 'ENTRY_REGISTRATION', 'NORMAL')) {
      insertTransStmt.run(
        regTransId,
        wagonId,
        normWagonNumber,
        'ENTRY_REGISTRATION',
        'ENTRY_REGISTRATION',
        'NORMAL',
        w.createdBy,
        'Intake Inspector',
        'INSPECTOR',
        0,
        null,
        null,
        null,
        null,
        'Wagon intake and initial registration',
        regCreatedAt
      );
    }

    // Subsequent Transitions
    for (let s = 0; s < currentStageIndex; s++) {
      const fromStage = stageOrder[s];
      const toStage = stageOrder[s + 1];
      const isReleaseStep = toStage === 'RELEASE';
      const transitionType = isReleaseStep ? 'GATE_SIGNOFF' : 'NORMAL';
      const performerRole = isReleaseStep ? 'SUPERVISOR' : 'INSPECTOR';
      const performerId = isReleaseStep ? 'usr_sup_001' : (s % 2 === 0 ? 'usr_insp_001' : 'usr_insp_002');
      const performerName = isReleaseStep ? 'S. K. Verma' : (s % 2 === 0 ? 'Ramesh Kumar' : 'Praveen Singh');

      const transDaysAgo = w.releaseDaysAgo !== undefined && isReleaseStep
        ? w.releaseDaysAgo
        : Math.max(0, w.entryDaysAgo - (s + 1) * Math.max(1, Math.floor((w.entryDaysAgo - (w.releaseDaysAgo || 0)) / (currentStageIndex || 1))));

      const transCreatedAt = getIsoDate(transDaysAgo, 4 + s);
      const transId = `trans_${w.id}_${s + 1}`;

      if (!checkTransStmt.get(transId, normWagonNumber, fromStage, toStage, transitionType)) {
        insertTransStmt.run(
          transId,
          wagonId,
          normWagonNumber,
          fromStage,
          toStage,
          transitionType,
          performerId,
          performerName,
          performerRole,
          0,
          null,
          isReleaseStep ? 'usr_sup_001' : null,
          isReleaseStep ? 'S. K. Verma' : null,
          isReleaseStep ? `OTP-${w.id}` : null,
          isReleaseStep ? `Exit gate cleared and released with Certificate ${w.signoffCertificate}` : `Sequential progression: ${fromStage} -> ${toStage}`,
          transCreatedAt
        );
      }
    }
  }

  // 7. Seed Gate Signoffs for RELEASED Wagons
  const checkSignoffStmt = database.prepare(`
    SELECT id FROM gate_signoffs 
    WHERE id = ? OR wagon_number = ? COLLATE NOCASE OR certificate_number = ?
  `);
  const insertSignoffStmt = database.prepare(`
    INSERT INTO gate_signoffs (
      id, wagon_id, wagon_number, supervisor_id, supervisor_name, supervisor_employee_id,
      digital_signature, otp_token_ref, signoff_notes, checks_summary_json,
      certificate_number, certificate_hash, signed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const w of DEMO_WAGONS) {
    if (w.hasSignoff && w.signoffCertificate) {
      const normWagonNumber = w.wagonNumber.trim().toUpperCase();
      const signoffId = `signoff_${w.id}`;
      if (!checkSignoffStmt.get(signoffId, normWagonNumber, w.signoffCertificate)) {
        const wagonRow = checkWagonStmt.get(w.id, normWagonNumber) as any;
        const wagonId = wagonRow ? wagonRow.id : w.id;
        const signedAt = getIsoDate(w.releaseDaysAgo || 0, 6);

        const summaryJson = JSON.stringify({
          wagonNumber: normWagonNumber,
          wagonType: w.wagonType,
          owningRailway: w.owningRailway,
          certificateNumber: w.signoffCertificate,
          totalCategoriesChecked: 8,
          mandatoryItemsPassed: 31,
          springsCertified: 4,
          condemnedItems: 0,
          turnaroundDays: (w.entryDaysAgo - (w.releaseDaysAgo || 0)).toFixed(1)
        });

        const certHash = crypto.createHash('sha256').update(summaryJson + signedAt).digest('hex');

        insertSignoffStmt.run(
          signoffId,
          wagonId,
          normWagonNumber,
          'usr_sup_001',
          'S. K. Verma',
          'WRS-SUP-2019',
          `DIGISIG_VERMA_${normWagonNumber.replace(/[^A-Z0-9]/g, '_')}`,
          `OTP-SIG-${w.id}`,
          'All 8 CASNUB component categories and coil springs inspected, repaired, and certified zero-defect. Approved for line service.',
          summaryJson,
          w.signoffCertificate,
          certHash,
          signedAt
        );
      }
    }
  }

  // 8. Seed Stores Depot Inventory Parts
  const checkPartStmt = database.prepare(`
    SELECT id FROM stores_inventory WHERE part_code = ?
  `);
  const insertPartStmt = database.prepare(`
    INSERT INTO stores_inventory (
      id, part_code, part_name, category, unit_of_measure, stock_quantity,
      reserved_quantity, reorder_threshold, unit_cost_inr, bin_location,
      supplier_name, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const DEMO_INVENTORY_PARTS = [
    {
      id: 'prt_casnub_outer_spring',
      partCode: 'PRT-SPR-OUT-01',
      partName: 'CASNUB 22NLB Outer Coil Spring (RDSO WD-01-HLS-1994)',
      category: 'SPRINGS',
      unitOfMeasure: 'NOS',
      stockQuantity: 48,
      reservedQuantity: 12,
      reorderThreshold: 15,
      unitCostInr: 2450,
      binLocation: 'BAY-1-RACK-A1',
      supplierName: 'RWS Lallaguda / Raipur Spring Shop'
    },
    {
      id: 'prt_casnub_inner_spring',
      partCode: 'PRT-SPR-INN-01',
      partName: 'CASNUB 22NLB Inner Coil Spring (RDSO WD-01-HLS-1994)',
      category: 'SPRINGS',
      unitOfMeasure: 'NOS',
      stockQuantity: 36,
      reservedQuantity: 8,
      reorderThreshold: 15,
      unitCostInr: 1850,
      binLocation: 'BAY-1-RACK-A2',
      supplierName: 'RWS Lallaguda / Raipur Spring Shop'
    },
    {
      id: 'prt_casnub_snubber_spring',
      partCode: 'PRT-SPR-SNUB-01',
      partName: 'CASNUB Snubber Spring (Damping Coil)',
      category: 'SPRINGS',
      unitOfMeasure: 'NOS',
      stockQuantity: 24,
      reservedQuantity: 6,
      reorderThreshold: 10,
      unitCostInr: 1200,
      binLocation: 'BAY-1-RACK-A3',
      supplierName: 'Raipur Spring Shop'
    },
    {
      id: 'prt_ctrb_bearing',
      partCode: 'PRT-BRG-CTRB',
      partName: 'Cartridge Tapered Roller Bearing (CTRB Class E - 6x11)',
      category: 'BEARINGS',
      unitOfMeasure: 'SET',
      stockQuantity: 18,
      reservedQuantity: 4,
      reorderThreshold: 8,
      unitCostInr: 18500,
      binLocation: 'BAY-2-RACK-B1',
      supplierName: 'Timken India / NEI Ltd'
    },
    {
      id: 'prt_wheelset_boxnhl',
      partCode: 'PRT-WHL-BOXNHL',
      partName: 'BOXNHL Heavy Freight Wheelset Assembly (840mm DIA)',
      category: 'WHEELS_AXLES',
      unitOfMeasure: 'SET',
      stockQuantity: 12,
      reservedQuantity: 2,
      reorderThreshold: 5,
      unitCostInr: 68000,
      binLocation: 'WHEEL-PARK-BAY-A',
      supplierName: 'RWF Yelahanka / Rail Wheel Plant Bela'
    },
    {
      id: 'prt_draft_gear_mk50',
      partCode: 'PRT-DG-MK50',
      partName: 'High Capacity Rubber-Friction Draft Gear MK-50',
      category: 'COUPLERS_DRAFT_GEAR',
      unitOfMeasure: 'NOS',
      stockQuantity: 8,
      reservedQuantity: 1,
      reorderThreshold: 4,
      unitCostInr: 42000,
      binLocation: 'HEAVY-STORES-RACK-C1',
      supplierName: 'Frontier Alloy Steels / BESCO'
    },
    {
      id: 'prt_brake_block_comp',
      partCode: 'PRT-BRK-COMP-BLK',
      partName: 'High Friction Composite K-Type Brake Block (RDSO MP.0.01.00.04)',
      category: 'BRAKE_SYSTEM',
      unitOfMeasure: 'NOS',
      stockQuantity: 120,
      reservedQuantity: 24,
      reorderThreshold: 30,
      unitCostInr: 650,
      binLocation: 'BAY-3-BIN-104',
      supplierName: 'Rane Brake Lining / Sundaram Brake Discs'
    },
    {
      id: 'prt_friction_wedge',
      partCode: 'PRT-FRIC-WDG-01',
      partName: 'CASNUB Cast Steel Friction Wedge (RDSO SK-77579)',
      category: 'FRICTION_WEDGES',
      unitOfMeasure: 'NOS',
      stockQuantity: 40,
      reservedQuantity: 8,
      reorderThreshold: 15,
      unitCostInr: 1450,
      binLocation: 'BAY-2-BIN-202',
      supplierName: 'Bhilai Engineering Corp / Simplex'
    },
    {
      id: 'prt_bogie_bolster',
      partCode: 'PRT-BOG-BOLST-01',
      partName: 'CASNUB 22NLB Cast Steel Bolster (WD-89006-S/01)',
      category: 'BOGIE_FRAME_BOLSTER',
      unitOfMeasure: 'NOS',
      stockQuantity: 6,
      reservedQuantity: 1,
      reorderThreshold: 3,
      unitCostInr: 85000,
      binLocation: 'YARD-BAY-4',
      supplierName: 'Texmaco Rail & Engineering'
    },
    {
      id: 'prt_cbc_knuckle',
      partCode: 'PRT-CPL-KNUCKLE',
      partName: 'AAR High Strength CBC Knuckle (Grade E Steel)',
      category: 'COUPLERS_DRAFT_GEAR',
      unitOfMeasure: 'NOS',
      stockQuantity: 16,
      reservedQuantity: 3,
      reorderThreshold: 6,
      unitCostInr: 12500,
      binLocation: 'BAY-3-RACK-D2',
      supplierName: 'Titagarh Rail Systems / BESCO'
    },
    {
      id: 'prt_distributor_valve',
      partCode: 'PRT-BRK-DV-01',
      partName: 'Graduated Release Air Brake Distributor Valve (C3W / KE Type)',
      category: 'BRAKE_SYSTEM',
      unitOfMeasure: 'NOS',
      stockQuantity: 10,
      reservedQuantity: 2,
      reorderThreshold: 4,
      unitCostInr: 34000,
      binLocation: 'AIR-BRAKE-SHOP-RACK-1',
      supplierName: 'Escorts Ltd / Knorr-Bremse India'
    },
    {
      id: 'prt_center_pivot',
      partCode: 'PRT-UF-CTR-PIV',
      partName: 'Bogie Center Pivot with Manganese Steel Liners',
      category: 'BODY_UNDERFRAME',
      unitOfMeasure: 'SET',
      stockQuantity: 20,
      reservedQuantity: 4,
      reorderThreshold: 8,
      unitCostInr: 4500,
      binLocation: 'BAY-4-BIN-305',
      supplierName: 'Raipur Foundry Shop'
    }
  ];

  for (const part of DEMO_INVENTORY_PARTS) {
    if (!checkPartStmt.get(part.partCode)) {
      insertPartStmt.run(
        part.id,
        part.partCode,
        part.partName,
        part.category,
        part.unitOfMeasure,
        part.stockQuantity,
        part.reservedQuantity,
        part.reorderThreshold,
        part.unitCostInr,
        part.binLocation,
        part.supplierName,
        getIsoDate(1, 0)
      );
    }
  }

  // 9. Seed Trackside OMRS Scans & Inventory Reservations
  const checkOMRSStmt = database.prepare(`
    SELECT id FROM omrs_scans WHERE wagon_number = ?
  `);
  const insertOMRSStmt = database.prepare(`
    INSERT INTO omrs_scans (
      id, wagon_number, scan_timestamp, location, train_speed_kmph,
      wheel_impact_kn, acoustic_bearing_peak_db, temperature_celsius,
      wheel_profile_deviation_mm, predicted_defects_json, triage_severity,
      is_triaged, auto_reservation_triggered, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const checkResStmt = database.prepare(`
    SELECT id FROM inventory_reservations WHERE wagon_number = ? AND part_code = ? AND source = ?
  `);
  const insertResStmt = database.prepare(`
    INSERT INTO inventory_reservations (
      id, wagon_number, part_code, quantity, source,
      predicted_defect, confidence_score, status, allocated_at,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const DEMO_OMRS_SCANS = [
    {
      id: 'omrs_scan_55303',
      wagonNumber: 'SER/BOXNHL/55303',
      scanTimestamp: getIsoDate(2, 4),
      location: 'Trackside OMRS Array - Raipur Outer Yard (KM 828/14)',
      trainSpeedKmph: 64.2,
      wheelImpactKn: 142.5,
      acousticBearingPeakDb: 86.8,
      temperatureCelsius: 68.5,
      wheelProfileDeviationMm: 4.6,
      predictedDefects: [
        {
          component: 'WHEELSET_ASSEMBLY',
          defectType: 'WHEEL_FLAT_IMPACT_HIGH',
          severity: 'CRITICAL',
          confidence: 0.96,
          recommendedPartCode: 'PRT-WHL-BOXNHL',
          quantity: 1
        },
        {
          component: 'CTRB_BEARING',
          defectType: 'CTRB_BEARING_ACOUSTIC_DEFECT',
          severity: 'CRITICAL',
          confidence: 0.94,
          recommendedPartCode: 'PRT-BRG-CTRB',
          quantity: 2
        }
      ],
      triageSeverity: 'CRITICAL_TRIAGE',
      isTriaged: 1,
      autoReservationTriggered: 1,
      reservations: [
        {
          id: 'res_omrs_55303_whl',
          partCode: 'PRT-WHL-BOXNHL',
          quantity: 1,
          predictedDefect: 'WHEEL_FLAT_IMPACT_HIGH',
          confidence: 0.96,
          status: 'RESERVED'
        },
        {
          id: 'res_omrs_55303_brg',
          partCode: 'PRT-BRG-CTRB',
          quantity: 2,
          predictedDefect: 'CTRB_BEARING_ACOUSTIC_DEFECT',
          confidence: 0.94,
          status: 'RESERVED'
        }
      ]
    },
    {
      id: 'omrs_scan_66313',
      wagonNumber: 'ER/BOXNHL/66313',
      scanTimestamp: getIsoDate(3, 1),
      location: 'Trackside OMRS Array - Raipur Outer Yard (KM 828/14)',
      trainSpeedKmph: 72.0,
      wheelImpactKn: 135.0,
      acousticBearingPeakDb: 74.2,
      temperatureCelsius: 58.0,
      wheelProfileDeviationMm: 5.2,
      predictedDefects: [
        {
          component: 'WHEELSET_ASSEMBLY',
          defectType: 'WHEEL_FLAT_IMPACT_HIGH',
          severity: 'CRITICAL',
          confidence: 0.93,
          recommendedPartCode: 'PRT-WHL-BOXNHL',
          quantity: 1
        }
      ],
      triageSeverity: 'CRITICAL_TRIAGE',
      isTriaged: 1,
      autoReservationTriggered: 1,
      reservations: [
        {
          id: 'res_omrs_66313_whl',
          partCode: 'PRT-WHL-BOXNHL',
          quantity: 1,
          predictedDefect: 'WHEEL_FLAT_IMPACT_HIGH',
          confidence: 0.93,
          status: 'RESERVED'
        }
      ]
    },
    {
      id: 'omrs_scan_11808',
      wagonNumber: 'NCR/BOXNHL/11808',
      scanTimestamp: getIsoDate(4, 2),
      location: 'Trackside OMRS Array - Raipur Outer Yard (KM 828/14)',
      trainSpeedKmph: 61.5,
      wheelImpactKn: 88.0,
      acousticBearingPeakDb: 62.0,
      temperatureCelsius: 82.5,
      wheelProfileDeviationMm: 2.1,
      predictedDefects: [
        {
          component: 'BRAKE_BLOCK_AND_AXLE',
          defectType: 'HOT_AXLE_BRAKE_BINDING',
          severity: 'CRITICAL',
          confidence: 0.92,
          recommendedPartCode: 'PRT-BRK-COMP-BLK',
          quantity: 4
        }
      ],
      triageSeverity: 'CRITICAL_TRIAGE',
      isTriaged: 1,
      autoReservationTriggered: 1,
      reservations: [
        {
          id: 'res_omrs_11808_brk',
          partCode: 'PRT-BRK-COMP-BLK',
          quantity: 4,
          predictedDefect: 'HOT_AXLE_BRAKE_BINDING',
          confidence: 0.92,
          status: 'ALLOCATED'
        }
      ]
    },
    {
      id: 'omrs_scan_33104',
      wagonNumber: 'ECoR/BOXNHL/33104',
      scanTimestamp: getIsoDate(1, 6),
      location: 'Trackside OMRS Array - Raipur Outer Yard (KM 828/14)',
      trainSpeedKmph: 65.0,
      wheelImpactKn: 108.0,
      acousticBearingPeakDb: 76.5,
      temperatureCelsius: 54.0,
      wheelProfileDeviationMm: 3.8,
      predictedDefects: [
        {
          component: 'CTRB_BEARING',
          defectType: 'BEARING_VIBRATION_ADVISORY',
          severity: 'ADVISORY',
          confidence: 0.79,
          recommendedPartCode: 'PRT-BRG-CTRB',
          quantity: 1
        }
      ],
      triageSeverity: 'ADVISORY',
      isTriaged: 1,
      autoReservationTriggered: 1,
      reservations: [
        {
          id: 'res_omrs_33104_brg',
          partCode: 'PRT-BRG-CTRB',
          quantity: 1,
          predictedDefect: 'BEARING_VIBRATION_ADVISORY',
          confidence: 0.79,
          status: 'RESERVED'
        }
      ]
    },
    {
      id: 'omrs_scan_77192',
      wagonNumber: 'WR/BOXNHL/77192',
      scanTimestamp: getIsoDate(0, 3),
      location: 'Trackside OMRS Array - Raipur Outer Yard (KM 828/14)',
      trainSpeedKmph: 70.0,
      wheelImpactKn: 62.0,
      acousticBearingPeakDb: 48.0,
      temperatureCelsius: 42.0,
      wheelProfileDeviationMm: 1.2,
      predictedDefects: [],
      triageSeverity: 'NORMAL',
      isTriaged: 1,
      autoReservationTriggered: 0,
      reservations: []
    }
  ];

  for (const scan of DEMO_OMRS_SCANS) {
    if (!checkOMRSStmt.get(scan.wagonNumber)) {
      insertOMRSStmt.run(
        scan.id,
        scan.wagonNumber,
        scan.scanTimestamp,
        scan.location,
        scan.trainSpeedKmph,
        scan.wheelImpactKn,
        scan.acousticBearingPeakDb,
        scan.temperatureCelsius,
        scan.wheelProfileDeviationMm,
        JSON.stringify(scan.predictedDefects),
        scan.triageSeverity,
        scan.isTriaged,
        scan.autoReservationTriggered,
        scan.scanTimestamp
      );

      for (const res of scan.reservations) {
        if (!checkResStmt.get(scan.wagonNumber, res.partCode, 'OMRS_AI_TRIAGE')) {
          insertResStmt.run(
            res.id,
            scan.wagonNumber,
            res.partCode,
            res.quantity,
            'OMRS_AI_TRIAGE',
            res.predictedDefect,
            res.confidence,
            res.status,
            res.status === 'ALLOCATED' ? scan.scanTimestamp : null,
            scan.scanTimestamp,
            scan.scanTimestamp
          );
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // 6. Seed Serialized Components & Passport Ledgers (Phase 3 - R4)
  // -------------------------------------------------------------------------
  const checkCompStmt = database.prepare('SELECT id FROM components WHERE serial_number = ?');
  const insertCompStmt = database.prepare(`
    INSERT INTO components (
      id, serial_number, component_type, category, part_name, qr_code, rfid_tag,
      status, current_wagon_number, current_bogie_position, manufacturing_date,
      manufacturer, total_km_travelled, overhaul_count, last_poh_date, next_poh_due,
      health_score, health_status, bin_location, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertHistoryStmt = database.prepare(`
    INSERT INTO component_history (
      id, component_id, serial_number, event_type, wagon_number, stage,
      action_details, performed_by, performer_name, notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const comp of DEMO_COMPONENTS) {
    if (!checkCompStmt.get(comp.serialNumber)) {
      const createdAt = getIsoDate(30, 0);
      const updatedAt = getIsoDate(0, 0);

      insertCompStmt.run(
        comp.id,
        comp.serialNumber,
        comp.componentType,
        comp.category,
        comp.partName,
        comp.qrCode,
        comp.rfidTag || null,
        comp.status,
        comp.currentWagonNumber || null,
        comp.currentBogiePosition,
        comp.manufacturingDate,
        comp.manufacturer,
        comp.totalKmTravelled,
        comp.overhaulCount,
        comp.lastPohDate || null,
        comp.nextPohDue || null,
        comp.healthScore,
        comp.healthStatus,
        comp.binLocation || null,
        createdAt,
        updatedAt
      );

      // Insert custom history provenance events if provided
      if (comp.historyEvents) {
        for (const evt of comp.historyEvents) {
          const evtId = `cmph_${crypto.randomUUID()}`;
          const evtDate = getIsoDate(evt.daysAgo, evt.hoursOffset || 0);
          insertHistoryStmt.run(
            evtId,
            comp.id,
            comp.serialNumber,
            evt.eventType,
            evt.wagonNumber || comp.currentWagonNumber || null,
            evt.stage || null,
            evt.actionDetails,
            evt.performedBy,
            evt.performerName,
            evt.notes || null,
            evtDate
          );
        }
      }
    }
  }

  const wagonCount = (database.prepare('SELECT COUNT(*) as c FROM wagons').get() as any).c;
  const springCount = (database.prepare('SELECT COUNT(*) as c FROM inspections').get() as any).c;
  const checklistCount = (database.prepare('SELECT COUNT(*) as c FROM checklist_items').get() as any).c;
  const inventoryCount = (database.prepare('SELECT COUNT(*) as c FROM stores_inventory').get() as any).c;
  const componentCount = (database.prepare('SELECT COUNT(*) as c FROM components').get() as any).c;

  console.log('✅ [Demo Seed] Rich Demo Seeding successfully finished!');
  console.log(`📊 Summary: ${wagonCount} Wagons across all 7 stages, ${springCount} Springs, ${checklistCount} Checklist Items, ${inventoryCount} Stores Inventory Parts, ${componentCount} Serialized Components.`);
}

// ---------------------------------------------------------------------------
// Direct CLI Execution
// ---------------------------------------------------------------------------

const isDirectRun = Boolean(
  process.argv[1] && (
    process.argv[1].endsWith('seed.ts') ||
    process.argv[1].endsWith('seed.js')
  )
);

if (isDirectRun) {
  const db = getDatabase();
  runMigrations(db);
  seedDemoData(db);
}
