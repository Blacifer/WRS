/**
 * CASNUB Bogie Master Checklist Template (RDSO)
 * Indian Railways WRS Raipur
 *
 * THE authoritative default checklist applied to every wagon registered in
 * this workshop. Reconciled against RDSO Technical Pamphlet G-95 Rev-II and
 * the Wagon Maintenance Manual 2.0 (including Appendix-V's Must-Change list
 * and, formerly, the WRS Raipur Mark-50 gauge boards — see the note in the
 * COUPLERS_DRAFT_GEAR section for why those checks were withdrawn).
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
  // The end cap is a visual check, confirmed by WRS Raipur on 27 August 2026:
  // no dimensional detail exists for it. Named as a visual inspection so an
  // inspector is not left looking for a gauge that was never specified.
  { category: 'BEARINGS', partName: 'CTRB Cartridge Bearing Rotation', bogiePosition: 'BOGIE_1', isMandatory: 1, std: 'RDSO G-81' },
  { category: 'BEARINGS', partName: 'CTRB End Cap — visual inspection (no dimensional limit published)', bogiePosition: 'BOGIE_1', isMandatory: 1, std: 'RDSO G-81 / WRS Raipur practice' },
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
  { category: 'COUPLERS_DRAFT_GEAR', partName: 'Draft Gear Housing', bogiePosition: 'BODY', isMandatory: 1, std: 'RDSO 49-BD-08' },
  { category: 'COUPLERS_DRAFT_GEAR', partName: 'Striker Casting Wear Plate (100% Replace — POH)', bogiePosition: 'BODY', isMandatory: 1, std: 'WMM 2.0 Appx-V B-7' },
  /*
   * The Mark-50 gauge checks that used to sit here have been removed.
   *
   * WRS Raipur, 27 August 2026: "Presently we are not overhauling MK-50.
   * MK-50 draft gear replaced by upgraded High capacity 71-BD draft gear, and
   * presently we have no any MK-50 gauges."
   *
   * Fourteen MANDATORY items were asking inspectors to check a draft gear the
   * shop does not overhaul, using gauge numbers it no longer holds. Every one
   * would have been permanently incompletable, so every wagon's exit gate
   * would have been permanently blocked — and the only way past would have
   * been a supervisor bulk-clear, which would have turned the exception into
   * the normal path and hollowed out the gate entirely.
   *
   * They came from photographs of the shop's own gauge reference boards taken
   * on 22 August. The boards are apparently still on the wall; the gauges and
   * the work are not. A photograph of a board is evidence that a board exists,
   * which is not the same as evidence of what the shop does — and that
   * distinction is the whole lesson here.
   *
   * WHAT REPLACES THEM
   * ------------------
   * One item, below, against RDSO STR 49-BD-08, which governs high capacity
   * draft gear whichever type is fitted. It is deliberately not prescriptive
   * about dimensions: WMM 2.0 predates 71-BD and names only RF-361, MK-50 and
   * MINER SL-76, so this system holds no verified figures for what Raipur now
   * fits. Inventing some would repeat exactly the mistake being corrected.
   *
   * When the 71-BD limits arrive — from RDSO STR 49-BD-08 itself or from the
   * shop's own gauge board for the new gear — they belong here, as measurable
   * items with their source cited.
   */
  { category: 'COUPLERS_DRAFT_GEAR', partName: 'High Capacity Draft Gear — condition, free movement and seating', bogiePosition: 'BODY', isMandatory: 1, std: 'RDSO STR 49-BD-08 (type as fitted)' },

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
