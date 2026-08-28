/**
 * Client-side RDSO G-95 Revision-II Classification Service
 * Indian Railways WRS Raipur
 */

import type {
  ClassificationRequest,
  ClassificationResult,
  BogieType,
  SpringCondition,
  SpringPosition,
  RDSOTableDefinition,
  CVComponentTarget
} from '../../../shared/types.ts';
import { RDSO_TABLES, getRDSOTable, COLOR_HEX_MAP } from '../../../shared/classification/tables.ts';

export { RDSO_TABLES, COLOR_HEX_MAP, getRDSOTable };

/**
 * Non-spring CASNUB component tolerance specs for the AR caliper checklist flow.
 * Mirrors RDSO_TOLERANCE_SPECS in server/src/routes/cv.ts (single min/max
 * interpretation, matching the pre-refactor SmartVisionCamera behaviour).
 */
export interface ComponentToleranceSpec {
  nominalValue: number;
  minPermissible: number;
  maxPermissible: number;
  tableRef: string;
  /** 'PENDING_SIGNOFF' means no approved limit exists; never judge against it. */
  verificationStatus?: 'VERIFIED' | 'PENDING_SIGNOFF';
}

export const COMPONENT_TOLERANCE_SPECS: Record<Exclude<CVComponentTarget, 'OUTER_SPRING' | 'INNER_SPRING' | 'SNUBBER_SPRING'>, ComponentToleranceSpec> = {
  FRICTION_WEDGE: { nominalValue: 136.0, minPermissible: 129.0, maxPermissible: 138.0, tableRef: 'RDSO G-95 Para 4.4' },
  // Preferred over FRICTION_WEDGE — matches the checklist's own two separate
  // line items (Vertical Face / Slope Surface), each with its own WMM 2.0
  // §309D wear limit (min=0 makes this a max-only wear check).
  FRICTION_WEDGE_VERTICAL: { nominalValue: 0.0, minPermissible: 0.0, maxPermissible: 7.0, tableRef: 'WMM 2.0 §309D (Vertical Surface)' },
  FRICTION_WEDGE_SLOPE: { nominalValue: 0.0, minPermissible: 0.0, maxPermissible: 3.0, tableRef: 'WMM 2.0 §309D (Slope Surface)' },
  // No numeric end-cap gap limit exists in WMM 2.0 or G-81 — only a torque and
  // must-change-screw procedure. These numbers are placeholders, and
  // PENDING_SIGNOFF is what keeps them from being shown as a verdict or
  // offered as a caliper reading. When a real figure is signed off, flipping
  // this one field turns the check on everywhere.
  /*
   * RESOLVED — there is no dimensional check, and there never was.
   *
   * WRS Raipur, 27 August 2026: "In axle End cap of CTRB only visual
   * inspection done, no any dimensional detail available to us."
   *
   * These placeholder figures sat here for the whole project marked
   * PENDING_SIGNOFF, on the assumption that a gap limit existed somewhere and
   * we had not found it. We had not found it because it does not exist. The
   * shop inspects the end cap by eye, and the mandatory work is replacing the
   * screws at POH, not measuring a gap.
   *
   * Kept as a record rather than deleted, because the useful part is the
   * history: the numbers were invented to complete a data structure, were
   * never allowed to produce a verdict, and are now confirmed to have been
   * describing a check nobody performs. PENDING_SIGNOFF did its job — it
   * stopped a fabricated tolerance from ever reaching an inspector while the
   * question was open. Deleting them silently would erase the evidence that
   * the guard worked.
   *
   * verificationStatus stays PENDING_SIGNOFF and must never be flipped: there
   * is nothing to sign off.
   */
  CTRB_END_CAP: { nominalValue: 1.5, minPermissible: 0.5, maxPermissible: 3.0, tableRef: 'RDSO G-81 Wheelset', verificationStatus: 'PENDING_SIGNOFF' },
  CTRB_BEARING_END_CAP: { nominalValue: 1.5, minPermissible: 0.5, maxPermissible: 3.0, tableRef: 'RDSO G-81 Wheelset', verificationStatus: 'PENDING_SIGNOFF' },
  WHEEL_FLANGE: { nominalValue: 28.5, minPermissible: 16.0, maxPermissible: 31.0, tableRef: 'RDSO G-95 Para 5.2 / WMM 2.0 §607(a), §7' },
  BRAKE_BLOCK: { nominalValue: 45.0, minPermissible: 10.0, maxPermissible: 55.0, tableRef: 'RDSO G-97 Para 6.1' },
  // Mark-50 Draft Gear gauges — mirrors RDSO_TOLERANCE_SPECS in
  // server/src/routes/cv.ts (see that file for sourcing/caveat comments).
  // maxPermissible on the 5 min-only entries below is an unsourced generous
  // input-range cap, not a real condemning ceiling — see DG_MIN_ONLY_TARGETS
  // handling in computeComponentVerdict below.
  DG_HOUSING_WALL_THICKNESS: { nominalValue: 15.88, minPermissible: 15.88, maxPermissible: 60.0, tableRef: 'WRS Raipur Gauge BE/91-62-6' },
  // Inclusive band between the two gauge readings — standard GO/NO-GO
  // gauging (see server/src/routes/cv.ts for the full reasoning).
  DG_CENTRE_WEDGE_LOCATION: { nominalValue: 60.325, minPermissible: 59.54, maxPermissible: 61.11, tableRef: 'WRS Raipur Gauge BE/91-72-1' },
  DG_MOVABLE_PLATE_LOCATION: { nominalValue: 142.875, minPermissible: 141.27, maxPermissible: 144.48, tableRef: 'WRS Raipur Gauge BE/91-61-10' },
  /*
   * WARNING — these are MARK-50 figures and no checklist item reaches them.
   *
   * WRS Raipur confirmed on 27 August 2026 that it no longer overhauls MK-50
   * and holds no MK-50 gauges; the checklist items that routed here were
   * withdrawn. The dimensions are kept because RDSO STR 49-BD-08 governs high
   * capacity draft gear generally and the structure will be reusable.
   *
   * They must NOT be reused for the 71-BD gear now fitted. Different gear,
   * different dimensions. Wiring a 71-BD item to a MK-50 limit would produce
   * a confident verdict against the wrong specification, which is worse than
   * having no check at all.
   */
  DG_OUTER_COIL_SPRING: { nominalValue: 342.0, minPermissible: 342.0, maxPermissible: 400.0, tableRef: 'WRS Raipur Gauge BE/91-61-6' },
  DG_INNER_COIL_SPRING: { nominalValue: 342.0, minPermissible: 342.0, maxPermissible: 400.0, tableRef: 'WRS Raipur Gauge BE/91-61-7A' },
  DG_CORNER_COIL_SPRING: { nominalValue: 286.0, minPermissible: 286.0, maxPermissible: 340.0, tableRef: 'WRS Raipur Gauge BE/91-61-7a' },
  DG_RELEASE_SPRING: { nominalValue: 123.0, minPermissible: 123.0, maxPermissible: 160.0, tableRef: 'WRS Raipur Gauge BE/91-61-8' }
};

const DG_MIN_ONLY_TARGETS: ReadonlySet<CVComponentTarget> = new Set([
  'DG_HOUSING_WALL_THICKNESS',
  'DG_OUTER_COIL_SPRING',
  'DG_INNER_COIL_SPRING',
  'DG_CORNER_COIL_SPRING',
  'DG_RELEASE_SPRING'
]);

export interface ComponentVerdict {
  status: 'PASS' | 'CONDEMNED';
  band: ClassificationResult['band'];
  bandRoman: ClassificationResult['bandRoman'];
  nominalValue: number;
  delta: number;
  tableReference: string;
  validRange: { min: number; max: number };
}

/**
 * Computes a PASS/CONDEMNED verdict for a captured measurement against a
 * given CV component target — springs go through the RDSO band engine
 * (classifySpringLocally); everything else uses its tolerance spec above.
 * Always returns a uniform shape (ClassificationResult has no
 * nominalValue/delta fields, so the spring case is normalized into one here).
 */
export function computeComponentVerdict(
  componentType: CVComponentTarget,
  measuredValue: number,
  bogieType: BogieType,
  condition: SpringCondition
): ComponentVerdict {
  if (componentType === 'OUTER_SPRING' || componentType === 'INNER_SPRING' || componentType === 'SNUBBER_SPRING') {
    const position = componentType.replace('_SPRING', '') as SpringPosition;
    const result = classifySpringLocally({ bogieType, condition, position, measuredHeight: measuredValue });
    const table = getRDSOTable(bogieType, condition, position);
    const nominalValue = table?.nominalFreeHeight ?? measuredValue;
    return {
      status: result.status,
      band: result.band,
      bandRoman: result.bandRoman,
      nominalValue,
      delta: Number((measuredValue - nominalValue).toFixed(2)),
      tableReference: result.tableReference,
      validRange: result.validRange
    };
  }

  const spec = COMPONENT_TOLERANCE_SPECS[componentType];
  const nominalValue = spec.nominalValue;
  const delta = Number((measuredValue - nominalValue).toFixed(2));
  const status: 'PASS' | 'CONDEMNED' = DG_MIN_ONLY_TARGETS.has(componentType)
    ? (measuredValue >= spec.minPermissible ? 'PASS' : 'CONDEMNED')
    : (measuredValue >= spec.minPermissible && measuredValue <= spec.maxPermissible ? 'PASS' : 'CONDEMNED');

  return {
    status,
    band: null,
    bandRoman: null,
    nominalValue,
    delta,
    tableReference: spec.tableRef,
    validRange: { min: spec.minPermissible, max: spec.maxPermissible }
  };
}

export function classifySpringLocally(request: ClassificationRequest): ClassificationResult {
  const {
    bogieType,
    condition,
    position,
    measuredHeight,
    damageType = 'NONE',
    damageNotes
  } = request;

  if (measuredHeight === undefined || isNaN(measuredHeight) || measuredHeight < 100 || measuredHeight > 450) {
    return {
      band: null,
      bandRoman: null,
      status: 'CONDEMNED',
      tableReference: 'N/A',
      validRange: { min: 100, max: 450 },
      measuredHeight,
      condemnationReason: `Measurement ${measuredHeight}mm is invalid or outside gauge limits (100-450mm)`,
      colorHex: '#991b1b'
    };
  }

  const table = getRDSOTable(bogieType, condition, position);
  if (!table) {
    return {
      band: null,
      bandRoman: null,
      status: 'CONDEMNED',
      tableReference: 'N/A',
      validRange: { min: 100, max: 450 },
      measuredHeight,
      condemnationReason: `No RDSO table found for ${bogieType} ${condition} ${position}`,
      colorHex: '#991b1b'
    };
  }

  const minPermissible = table.condemningMinHeight;
  const maxPermissible = table.condemningMaxHeight;
  const hasDamage = damageType !== 'NONE' && Boolean(damageType);

  // RDSO Boundary rule: Boundary strictly belongs to HIGHER band
  const matchedBand = table.bands.find(b => {
    if (b.isHighestBand) {
      return measuredHeight >= b.minHeight && measuredHeight <= b.maxHeight;
    }
    return measuredHeight >= b.minHeight && measuredHeight < b.maxHeight;
  }) || null;

  if (hasDamage) {
    let reason = `Physical damage detected: ${damageType}`;
    if (damageNotes && damageNotes.trim().length > 0) {
      reason += ` (${damageNotes.trim()})`;
    }
    return {
      band: null,
      bandRoman: null,
      status: 'CONDEMNED',
      tableReference: table.tableReference || table.tableNumber,
      validRange: { min: minPermissible, max: maxPermissible },
      measuredHeight,
      bogieType,
      condition,
      position,
      condemnationReason: reason,
      colorHex: '#991b1b'
    };
  }

  if (!matchedBand) {
    let reason = '';
    if (measuredHeight < minPermissible) {
      reason = `Free height ${measuredHeight.toFixed(1)} mm is below minimum permissible limit (${minPermissible.toFixed(1)} mm)`;
    } else if (measuredHeight > maxPermissible) {
      reason = `Free height ${measuredHeight.toFixed(1)} mm exceeds maximum permissible limit (${maxPermissible.toFixed(1)} mm)`;
    } else {
      reason = `Free height ${measuredHeight.toFixed(1)} mm falls outside all defined bands for ${table.tableNumber}`;
    }

    return {
      band: null,
      bandRoman: null,
      status: 'CONDEMNED',
      tableReference: table.tableReference || table.tableNumber,
      validRange: { min: minPermissible, max: maxPermissible },
      measuredHeight,
      bogieType,
      condition,
      position,
      condemnationReason: reason,
      colorHex: '#991b1b'
    };
  }

  return {
    band: matchedBand.band,
    bandRoman: matchedBand.bandRoman,
    status: 'PASS',
    tableReference: table.tableReference || table.tableNumber,
    validRange: { min: minPermissible, max: maxPermissible },
    bandRange: { min: matchedBand.minHeight, max: matchedBand.maxHeight },
    measuredHeight,
    bogieType,
    condition,
    position,
    condemnationReason: null,
    colorHex: COLOR_HEX_MAP[matchedBand.band]
  };
}

/**
 * A target is only offered to the caliper when its spec has an approved
 * limit. Keeping this in one place means "we have no sourced figure for this"
 * is enforced by the registry rather than remembered as a special case in the
 * UI — which is how the bearings items ended up showing a confidently precise
 * button backed by numbers nobody could cite.
 */
function withApprovedLimit(target: CVComponentTarget): CVComponentTarget | null {
  const spec = (COMPONENT_TOLERANCE_SPECS as any)[target];
  if (spec && spec.verificationStatus === 'PENDING_SIGNOFF') return null;
  return target;
}

export function resolveComponentTarget(partName: string, category: string): CVComponentTarget | null {
  const name = partName.toLowerCase();

  // Draft Gear items are handled as a dedicated block, checked first and
  // always returning (a DG_* target or null), so a name like "Spring Seat
  // Gap Gauge" can't fall through into the generic spring-branch default
  // below just because it contains the word "spring".
  if (category === 'COUPLERS_DRAFT_GEAR' || name.includes('draft gear')) {
    if (name.includes('wall thickness')) return withApprovedLimit('DG_HOUSING_WALL_THICKNESS');
    if (name.includes('centre wedge location')) return withApprovedLimit('DG_CENTRE_WEDGE_LOCATION');
    if (name.includes('movable plate location')) return withApprovedLimit('DG_MOVABLE_PLATE_LOCATION');
    if (name.includes('outer coil spring')) return withApprovedLimit('DG_OUTER_COIL_SPRING');
    if (name.includes('inner coil spring')) return withApprovedLimit('DG_INNER_COIL_SPRING');
    if (name.includes('corner coil spring')) return withApprovedLimit('DG_CORNER_COIL_SPRING');
    if (name.includes('release spring')) return withApprovedLimit('DG_RELEASE_SPRING');
    // Housing box profile gauge, the gap/contact gauges (wedge shoe, centre
    // wedge, outer stationary plate, taper stationary plate, spring seat),
    // the movable-plate 180° rotation check, and the pre-existing
    // coupler/knuckle/lock/housing items are physical GO/NO-GO or visual
    // checks with no digital caliper reading defined — no AR Caliper button.
    return null;
  }

  if (category === 'SPRINGS' || name.includes('spring') || name.includes('स्प्रिंग')) {
    if (name.includes('snubber') || name.includes('स्नबर')) return withApprovedLimit('SNUBBER_SPRING');
    if (name.includes('inner') || name.includes('भीतरी') || name.includes('इनर')) return withApprovedLimit('INNER_SPRING');
    return withApprovedLimit('OUTER_SPRING');
  }
  if (category === 'FRICTION_WEDGES' || name.includes('wedge') || name.includes('घर्षण') || name.includes('वेज')) {
    // WMM 2.0 §309D gives distinct per-surface wear limits and the
    // checklist already names the two surfaces separately — route each to
    // its own spec instead of the shared legacy FRICTION_WEDGE target.
    if (name.includes('slope')) return withApprovedLimit('FRICTION_WEDGE_SLOPE');
    if (name.includes('vertical')) return withApprovedLimit('FRICTION_WEDGE_VERTICAL');
    return withApprovedLimit('FRICTION_WEDGE');
  }
  if (category === 'BEARINGS' || name.includes('end cap') || name.includes('ctrb') || name.includes('bearing') || name.includes('कैप')) {
    // Routed normally. Whether a caliper button appears is decided at the end
    // of this function by the spec's own verificationStatus, not by a special
    // case here — CTRB_END_CAP is PENDING_SIGNOFF, so it resolves to null
    // today and starts working the day a real figure is signed off, with no
    // code change in this file.
    //
    // The other BEARINGS items are not caliper measurements in any case:
    // "CTRB Cartridge Bearing Rotation" is a spin test, and Locking Plate /
    // Grease Seal / End Cap Screws are 100%-replace items.
    return withApprovedLimit('CTRB_END_CAP');
  }
  if (category === 'WHEELS_AXLES' || name.includes('flange') || name.includes('wheel') || name.includes('पहिया')) {
    return withApprovedLimit('WHEEL_FLANGE');
  }
  if (category === 'BRAKE_SYSTEM' || name.includes('brake') || name.includes('ब्रेक')) {
    return withApprovedLimit('BRAKE_BLOCK');
  }
  return withApprovedLimit('OUTER_SPRING');
}
