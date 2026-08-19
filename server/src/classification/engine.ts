/**
 * RDSO G-95 Revision-II Spring Classification Engine
 * Indian Railways Wagon Repair Shop (WRS) Raipur
 *
 * Implements exact boundary resolution, condemnation limits, and damage flagging
 * across Tables 28 through 33.
 */

import type {
  ClassificationRequest,
  ClassificationResult,
  BandColor,
  BandRoman,
  InspectionStatus
} from '../../../shared/types.ts';
import { getRDSOTable, COLOR_HEX_MAP } from './tables.ts';
import { validateClassificationRequest } from './validator.ts';

/**
 * Classifies a coil spring according to RDSO Technical Pamphlet G-95 Revision-II.
 * Pure function with deterministic output.
 */
export function classifySpring(request: ClassificationRequest): ClassificationResult {
  // 1. Sanity & schema validation
  const validation = validateClassificationRequest(request);
  if (!validation.isValid) {
    throw new Error(`Invalid classification request: ${validation.errors.join('; ')}`);
  }

  const {
    bogieType,
    condition,
    position,
    measuredHeight,
    damageType = 'NONE',
    damageNotes
  } = request;

  // 2. Fetch master RDSO table
  const table = getRDSOTable(bogieType, condition, position);
  if (!table) {
    throw new Error(
      `RDSO Table not found for Bogie: ${bogieType}, Condition: ${condition}, Position: ${position}`
    );
  }

  const minPermissible = table.condemningMinHeight;
  const maxPermissible = table.condemningMaxHeight;
  const hasPhysicalDamage = damageType !== 'NONE' && Boolean(damageType);

  // 3. Evaluate matching band using RDSO boundary rule:
  // - Boundary values strictly belong to the HIGHER band
  // - Band I (Highest): [min, max]
  // - Band II..N: [min, max)
  let matchedBand = table.bands.find(b => {
    if (b.isHighestBand) {
      return measuredHeight >= b.minHeight && measuredHeight <= b.maxHeight;
    }
    return measuredHeight >= b.minHeight && measuredHeight < b.maxHeight;
  }) || null;

  // 4. Physical damage condemnation check
  if (hasPhysicalDamage) {
    let defectReason = `Physical damage detected: ${damageType}`;
    if (damageNotes && damageNotes.trim().length > 0) {
      defectReason += ` (Notes: ${damageNotes.trim()})`;
    }

    return {
      band: null,
      bandRoman: null,
      status: 'CONDEMNED',
      tableReference: table.tableReference || table.tableNumber,
      validRange: { min: minPermissible, max: maxPermissible },
      bandRange: null,
      measuredHeight,
      bogieType,
      condition,
      position,
      condemnationReason: defectReason,
      isOverridden: false,
      colorHex: '#991b1b',
      details: {
        bogieType,
        condition,
        position,
        measuredHeight,
        matchedBandIndex: matchedBand?.bandNumber
      }
    };
  }

  // 5. Out of range free height check -> CONDEMNED
  if (!matchedBand) {
    let reason = '';
    if (measuredHeight < minPermissible) {
      reason = `Free height ${measuredHeight.toFixed(1)} mm is below minimum permissible limit (${minPermissible.toFixed(1)} mm) (Worn / Collapsed)`;
    } else if (measuredHeight > maxPermissible) {
      reason = `Free height ${measuredHeight.toFixed(1)} mm exceeds maximum permissible limit (${maxPermissible.toFixed(1)} mm) (Over-height)`;
    } else {
      reason = `Free height ${measuredHeight.toFixed(1)} mm falls outside all defined bands for ${table.tableNumber}`;
    }

    return {
      band: null,
      bandRoman: null,
      status: 'CONDEMNED',
      tableReference: table.tableReference || table.tableNumber,
      validRange: { min: minPermissible, max: maxPermissible },
      bandRange: null,
      measuredHeight,
      bogieType,
      condition,
      position,
      condemnationReason: reason,
      isOverridden: false,
      colorHex: '#991b1b',
      details: {
        bogieType,
        condition,
        position,
        measuredHeight
      }
    };
  }

  // 6. Normal Passed Spring
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
    isOverridden: false,
    colorHex: COLOR_HEX_MAP[matchedBand.band],
    details: {
      bogieType,
      condition,
      position,
      measuredHeight,
      matchedBandIndex: matchedBand.bandNumber
    }
  };
}
