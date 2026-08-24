/**
 * CASNUB Bogie Master Checklist Template (RDSO)
 * Indian Railways WRS Raipur
 *
 * THE authoritative default checklist applied to every wagon registered in
 * this workshop. Reconciled against RDSO Technical Pamphlet G-95 Rev-II and
 * the Wagon Maintenance Manual 2.0 (including Appendix-V's Must-Change list
 * and the WRS Raipur Mark-50 Draft Gear gauge boards).
 *
 * This lives in its own module because it is production data, not demo data.
 * It previously sat inside seed.ts, which meant the code path that registers
 * REAL wagons imported its safety checklist from a demo-seeding file — and an
 * earlier hand-copied duplicate of this list in wagonRepository.ts drifted out
 * of sync, leaving real registrations on a stale 30-item checklist while the
 * demo data showed the reconciled one. One definition, one import, no drift.
 */

import type { CASNUBCategory } from '../../../shared/types.ts';

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
