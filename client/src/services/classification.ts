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
}

export const COMPONENT_TOLERANCE_SPECS: Record<Exclude<CVComponentTarget, 'OUTER_SPRING' | 'INNER_SPRING' | 'SNUBBER_SPRING'>, ComponentToleranceSpec> = {
  FRICTION_WEDGE: { nominalValue: 136.0, minPermissible: 129.0, maxPermissible: 138.0, tableRef: 'RDSO G-95 Para 4.4' },
  CTRB_END_CAP: { nominalValue: 1.5, minPermissible: 0.5, maxPermissible: 3.0, tableRef: 'RDSO G-81 Wheelset' },
  CTRB_BEARING_END_CAP: { nominalValue: 1.5, minPermissible: 0.5, maxPermissible: 3.0, tableRef: 'RDSO G-81 Wheelset' },
  WHEEL_FLANGE: { nominalValue: 28.5, minPermissible: 16.0, maxPermissible: 31.0, tableRef: 'RDSO G-95 Para 5.2 / WMM 2.0 §607(a), §7' },
  BRAKE_BLOCK: { nominalValue: 45.0, minPermissible: 10.0, maxPermissible: 55.0, tableRef: 'RDSO G-97 Para 6.1' },
  // Mark-50 Draft Gear gauges — mirrors RDSO_TOLERANCE_SPECS in
  // server/src/routes/cv.ts (see that file for sourcing/caveat comments).
  // maxPermissible on the 5 min-only entries below is an unsourced generous
  // input-range cap, not a real condemning ceiling — see DG_MIN_ONLY_TARGETS
  // handling in computeComponentVerdict below.
  DG_HOUSING_WALL_THICKNESS: { nominalValue: 15.88, minPermissible: 15.88, maxPermissible: 60.0, tableRef: 'WRS Raipur Gauge BE/91-62-6' },
  DG_CENTRE_WEDGE_LOCATION: { nominalValue: 60.325, minPermissible: 59.54, maxPermissible: 61.11, tableRef: 'WRS Raipur Gauge BE/91-72-1 (direction unconfirmed)' },
  DG_MOVABLE_PLATE_LOCATION: { nominalValue: 142.875, minPermissible: 141.27, maxPermissible: 144.48, tableRef: 'WRS Raipur Gauge BE/91-61-10 (direction unconfirmed)' },
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
