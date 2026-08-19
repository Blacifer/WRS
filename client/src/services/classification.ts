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
  RDSOTableDefinition
} from '../../../shared/types.ts';
import { RDSO_TABLES, getRDSOTable, COLOR_HEX_MAP } from '../../../server/src/classification/tables.ts';

export { RDSO_TABLES, COLOR_HEX_MAP };

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
