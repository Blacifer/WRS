/**
 * RDSO G-95 Rev-II Spring Classification Engine
 * Indian Railways WRS Raipur
 *
 * Implements Tables 28 to 33 with exact RDSO boundary resolution:
 * Measurements exactly at band boundaries belong to the HIGHER band.
 */

import type {
  BogieType,
  SpringCondition,
  SpringPosition,
  BandColor,
  BandRoman,
  InspectionStatus,
  ClassificationRequest,
  ClassificationResult,
  RDSOTableDefinition
} from '../../shared/types.ts';

export const COLOR_HEX_MAP: Record<BandColor, string> = {
  BLUE: '#2563eb',
  GREEN: '#16a34a',
  YELLOW: '#ca8a04',
  ORANGE: '#ea580c',
  WHITE: '#e2e8f0',
  RED: '#dc2626'
};

// Normalized position key
function normalizePosition(pos: SpringPosition): 'OUTER' | 'INNER' | 'SNUBBER' {
  if (pos === 'SNUBBER_OUTER' || pos === 'SNUBBER_INNER') {
    return 'SNUBBER';
  }
  return pos;
}

// RDSO G-95 Tables 28-33 Specifications
export const RDSO_TABLES: Record<string, RDSOTableDefinition> = {
  // Table 28: CASNUB 22 NLB/NLB(M) Used
  'TABLE_28_OUTER': {
    tableNumber: 'Table 28',
    bogieType: 'CASNUB_22_NLB',
    condition: 'USED',
    position: 'OUTER',
    nominalFreeHeight: 260,
    tolerance: 3,
    condemningMinHeight: 245,
    condemningMaxHeight: 263,
    bands: [
      { band: 'BLUE', bandRoman: 'Band I', minHeight: 260, maxHeight: 263 },
      { band: 'GREEN', bandRoman: 'Band II', minHeight: 257, maxHeight: 260 },
      { band: 'YELLOW', bandRoman: 'Band III', minHeight: 254, maxHeight: 257 },
      { band: 'ORANGE', bandRoman: 'Band IV', minHeight: 251, maxHeight: 254 },
      { band: 'WHITE', bandRoman: 'Band V', minHeight: 248, maxHeight: 251 },
      { band: 'RED', bandRoman: 'Band VI', minHeight: 245, maxHeight: 248 }
    ]
  },
  'TABLE_28_INNER': {
    tableNumber: 'Table 28',
    bogieType: 'CASNUB_22_NLB',
    condition: 'USED',
    position: 'INNER',
    nominalFreeHeight: 262,
    tolerance: 3,
    condemningMinHeight: 247,
    condemningMaxHeight: 265,
    bands: [
      { band: 'BLUE', bandRoman: 'Band I', minHeight: 262, maxHeight: 265 },
      { band: 'GREEN', bandRoman: 'Band II', minHeight: 259, maxHeight: 262 },
      { band: 'YELLOW', bandRoman: 'Band III', minHeight: 256, maxHeight: 259 },
      { band: 'ORANGE', bandRoman: 'Band IV', minHeight: 253, maxHeight: 256 },
      { band: 'WHITE', bandRoman: 'Band V', minHeight: 250, maxHeight: 253 },
      { band: 'RED', bandRoman: 'Band VI', minHeight: 247, maxHeight: 250 }
    ]
  },
  'TABLE_28_SNUBBER': {
    tableNumber: 'Table 28',
    bogieType: 'CASNUB_22_NLB',
    condition: 'USED',
    position: 'SNUBBER',
    nominalFreeHeight: 294,
    tolerance: 3,
    condemningMinHeight: 279,
    condemningMaxHeight: 297,
    bands: [
      { band: 'BLUE', bandRoman: 'Band I', minHeight: 294, maxHeight: 297 },
      { band: 'GREEN', bandRoman: 'Band II', minHeight: 291, maxHeight: 294 },
      { band: 'YELLOW', bandRoman: 'Band III', minHeight: 288, maxHeight: 291 },
      { band: 'ORANGE', bandRoman: 'Band IV', minHeight: 285, maxHeight: 288 },
      { band: 'WHITE', bandRoman: 'Band V', minHeight: 282, maxHeight: 285 },
      { band: 'RED', bandRoman: 'Band VI', minHeight: 279, maxHeight: 282 }
    ]
  },

  // Table 29: CASNUB 22HS/HS(M) Used
  'TABLE_29_OUTER': {
    tableNumber: 'Table 29',
    bogieType: 'CASNUB_22_HS',
    condition: 'USED',
    position: 'OUTER',
    nominalFreeHeight: 260,
    tolerance: 3,
    condemningMinHeight: 245,
    condemningMaxHeight: 263,
    bands: [
      { band: 'BLUE', bandRoman: 'Band I', minHeight: 260, maxHeight: 263 },
      { band: 'GREEN', bandRoman: 'Band II', minHeight: 257, maxHeight: 260 },
      { band: 'YELLOW', bandRoman: 'Band III', minHeight: 254, maxHeight: 257 },
      { band: 'ORANGE', bandRoman: 'Band IV', minHeight: 251, maxHeight: 254 },
      { band: 'WHITE', bandRoman: 'Band V', minHeight: 248, maxHeight: 251 },
      { band: 'RED', bandRoman: 'Band VI', minHeight: 245, maxHeight: 248 }
    ]
  },
  'TABLE_29_INNER': {
    tableNumber: 'Table 29',
    bogieType: 'CASNUB_22_HS',
    condition: 'USED',
    position: 'INNER',
    nominalFreeHeight: 243,
    tolerance: 3,
    condemningMinHeight: 228,
    condemningMaxHeight: 246,
    bands: [
      { band: 'BLUE', bandRoman: 'Band I', minHeight: 243, maxHeight: 246 },
      { band: 'GREEN', bandRoman: 'Band II', minHeight: 240, maxHeight: 243 },
      { band: 'YELLOW', bandRoman: 'Band III', minHeight: 237, maxHeight: 240 },
      { band: 'ORANGE', bandRoman: 'Band IV', minHeight: 234, maxHeight: 237 },
      { band: 'WHITE', bandRoman: 'Band V', minHeight: 231, maxHeight: 234 },
      { band: 'RED', bandRoman: 'Band VI', minHeight: 228, maxHeight: 231 }
    ]
  },
  'TABLE_29_SNUBBER': {
    tableNumber: 'Table 29',
    bogieType: 'CASNUB_22_HS',
    condition: 'USED',
    position: 'SNUBBER',
    nominalFreeHeight: 293,
    tolerance: 3,
    condemningMinHeight: 278,
    condemningMaxHeight: 296,
    bands: [
      { band: 'BLUE', bandRoman: 'Band I', minHeight: 293, maxHeight: 296 },
      { band: 'GREEN', bandRoman: 'Band II', minHeight: 290, maxHeight: 293 },
      { band: 'YELLOW', bandRoman: 'Band III', minHeight: 287, maxHeight: 290 },
      { band: 'ORANGE', bandRoman: 'Band IV', minHeight: 284, maxHeight: 287 },
      { band: 'WHITE', bandRoman: 'Band V', minHeight: 281, maxHeight: 284 },
      { band: 'RED', bandRoman: 'Band VI', minHeight: 278, maxHeight: 281 }
    ]
  },

  // Table 30: CASNUB 22 RFT Used
  'TABLE_30_OUTER': {
    tableNumber: 'Table 30',
    bogieType: 'CASNUB_22_RFT',
    condition: 'USED',
    position: 'OUTER',
    nominalFreeHeight: 272,
    tolerance: 3,
    condemningMinHeight: 257,
    condemningMaxHeight: 275,
    bands: [
      { band: 'BLUE', bandRoman: 'Band I', minHeight: 272, maxHeight: 275 },
      { band: 'GREEN', bandRoman: 'Band II', minHeight: 269, maxHeight: 272 },
      { band: 'YELLOW', bandRoman: 'Band III', minHeight: 266, maxHeight: 269 },
      { band: 'ORANGE', bandRoman: 'Band IV', minHeight: 263, maxHeight: 266 },
      { band: 'WHITE', bandRoman: 'Band V', minHeight: 260, maxHeight: 263 },
      { band: 'RED', bandRoman: 'Band VI', minHeight: 257, maxHeight: 260 }
    ]
  },
  'TABLE_30_INNER': {
    tableNumber: 'Table 30',
    bogieType: 'CASNUB_22_RFT',
    condition: 'USED',
    position: 'INNER',
    nominalFreeHeight: 237,
    tolerance: 3,
    condemningMinHeight: 222,
    condemningMaxHeight: 240,
    bands: [
      { band: 'BLUE', bandRoman: 'Band I', minHeight: 237, maxHeight: 240 },
      { band: 'GREEN', bandRoman: 'Band II', minHeight: 234, maxHeight: 237 },
      { band: 'YELLOW', bandRoman: 'Band III', minHeight: 231, maxHeight: 234 },
      { band: 'ORANGE', bandRoman: 'Band IV', minHeight: 228, maxHeight: 231 },
      { band: 'WHITE', bandRoman: 'Band V', minHeight: 225, maxHeight: 228 },
      { band: 'RED', bandRoman: 'Band VI', minHeight: 222, maxHeight: 225 }
    ]
  },
  'TABLE_30_SNUBBER': {
    tableNumber: 'Table 30',
    bogieType: 'CASNUB_22_RFT',
    condition: 'USED',
    position: 'SNUBBER',
    nominalFreeHeight: 304,
    tolerance: 3,
    condemningMinHeight: 289,
    condemningMaxHeight: 307,
    bands: [
      { band: 'BLUE', bandRoman: 'Band I', minHeight: 304, maxHeight: 307 },
      { band: 'GREEN', bandRoman: 'Band II', minHeight: 301, maxHeight: 304 },
      { band: 'YELLOW', bandRoman: 'Band III', minHeight: 298, maxHeight: 301 },
      { band: 'ORANGE', bandRoman: 'Band IV', minHeight: 295, maxHeight: 298 },
      { band: 'WHITE', bandRoman: 'Band V', minHeight: 292, maxHeight: 295 },
      { band: 'RED', bandRoman: 'Band VI', minHeight: 289, maxHeight: 292 }
    ]
  },

  // Table 31: CASNUB 22 NLB New
  'TABLE_31_OUTER': {
    tableNumber: 'Table 31',
    bogieType: 'CASNUB_22_NLB',
    condition: 'NEW',
    position: 'OUTER',
    nominalFreeHeight: 260,
    tolerance: 3,
    condemningMinHeight: 257,
    condemningMaxHeight: 263,
    bands: [
      { band: 'GREEN', bandRoman: 'Band I', minHeight: 261, maxHeight: 263 },
      { band: 'YELLOW', bandRoman: 'Band II', minHeight: 259, maxHeight: 261 },
      { band: 'RED', bandRoman: 'Band III', minHeight: 257, maxHeight: 259 }
    ]
  },
  'TABLE_31_INNER': {
    tableNumber: 'Table 31',
    bogieType: 'CASNUB_22_NLB',
    condition: 'NEW',
    position: 'INNER',
    nominalFreeHeight: 262,
    tolerance: 3,
    condemningMinHeight: 259,
    condemningMaxHeight: 265,
    bands: [
      { band: 'GREEN', bandRoman: 'Band I', minHeight: 263, maxHeight: 265 },
      { band: 'YELLOW', bandRoman: 'Band II', minHeight: 261, maxHeight: 263 },
      { band: 'RED', bandRoman: 'Band III', minHeight: 259, maxHeight: 261 }
    ]
  },
  'TABLE_31_SNUBBER': {
    tableNumber: 'Table 31',
    bogieType: 'CASNUB_22_NLB',
    condition: 'NEW',
    position: 'SNUBBER',
    nominalFreeHeight: 294,
    tolerance: 3,
    condemningMinHeight: 291,
    condemningMaxHeight: 297,
    bands: [
      { band: 'GREEN', bandRoman: 'Band I', minHeight: 295, maxHeight: 297 },
      { band: 'YELLOW', bandRoman: 'Band II', minHeight: 293, maxHeight: 295 },
      { band: 'RED', bandRoman: 'Band III', minHeight: 291, maxHeight: 293 }
    ]
  },

  // Table 32: CASNUB 22 HS New
  'TABLE_32_OUTER': {
    tableNumber: 'Table 32',
    bogieType: 'CASNUB_22_HS',
    condition: 'NEW',
    position: 'OUTER',
    nominalFreeHeight: 260,
    tolerance: 3,
    condemningMinHeight: 257,
    condemningMaxHeight: 263,
    bands: [
      { band: 'GREEN', bandRoman: 'Band I', minHeight: 261, maxHeight: 263 },
      { band: 'YELLOW', bandRoman: 'Band II', minHeight: 259, maxHeight: 261 },
      { band: 'RED', bandRoman: 'Band III', minHeight: 257, maxHeight: 259 }
    ]
  },
  'TABLE_32_INNER': {
    tableNumber: 'Table 32',
    bogieType: 'CASNUB_22_HS',
    condition: 'NEW',
    position: 'INNER',
    nominalFreeHeight: 243,
    tolerance: 3,
    condemningMinHeight: 240,
    condemningMaxHeight: 246,
    bands: [
      { band: 'GREEN', bandRoman: 'Band I', minHeight: 244, maxHeight: 246 },
      { band: 'YELLOW', bandRoman: 'Band II', minHeight: 242, maxHeight: 244 },
      { band: 'RED', bandRoman: 'Band III', minHeight: 240, maxHeight: 242 }
    ]
  },
  'TABLE_32_SNUBBER': {
    tableNumber: 'Table 32',
    bogieType: 'CASNUB_22_HS',
    condition: 'NEW',
    position: 'SNUBBER',
    nominalFreeHeight: 293,
    tolerance: 3,
    condemningMinHeight: 290,
    condemningMaxHeight: 296,
    bands: [
      { band: 'GREEN', bandRoman: 'Band I', minHeight: 294, maxHeight: 296 },
      { band: 'YELLOW', bandRoman: 'Band II', minHeight: 292, maxHeight: 294 },
      { band: 'RED', bandRoman: 'Band III', minHeight: 290, maxHeight: 292 }
    ]
  },

  // Table 33: CASNUB 22 RFT New
  'TABLE_33_OUTER': {
    tableNumber: 'Table 33',
    bogieType: 'CASNUB_22_RFT',
    condition: 'NEW',
    position: 'OUTER',
    nominalFreeHeight: 272,
    tolerance: 3,
    condemningMinHeight: 269,
    condemningMaxHeight: 275,
    bands: [
      { band: 'GREEN', bandRoman: 'Band I', minHeight: 273, maxHeight: 275 },
      { band: 'YELLOW', bandRoman: 'Band II', minHeight: 271, maxHeight: 273 },
      { band: 'RED', bandRoman: 'Band III', minHeight: 269, maxHeight: 271 }
    ]
  },
  'TABLE_33_INNER': {
    tableNumber: 'Table 33',
    bogieType: 'CASNUB_22_RFT',
    condition: 'NEW',
    position: 'INNER',
    nominalFreeHeight: 237,
    tolerance: 3,
    condemningMinHeight: 234,
    condemningMaxHeight: 240,
    bands: [
      { band: 'GREEN', bandRoman: 'Band I', minHeight: 238, maxHeight: 240 },
      { band: 'YELLOW', bandRoman: 'Band II', minHeight: 236, maxHeight: 238 },
      { band: 'RED', bandRoman: 'Band III', minHeight: 234, maxHeight: 236 }
    ]
  },
  'TABLE_33_SNUBBER': {
    tableNumber: 'Table 33',
    bogieType: 'CASNUB_22_RFT',
    condition: 'NEW',
    position: 'SNUBBER',
    nominalFreeHeight: 304,
    tolerance: 3,
    condemningMinHeight: 301,
    condemningMaxHeight: 307,
    bands: [
      { band: 'GREEN', bandRoman: 'Band I', minHeight: 305, maxHeight: 307 },
      { band: 'YELLOW', bandRoman: 'Band II', minHeight: 303, maxHeight: 305 },
      { band: 'RED', bandRoman: 'Band III', minHeight: 301, maxHeight: 303 }
    ]
  }
};

/**
 * Get RDSO table for bogie type, condition, and position
 */
export function getRDSOTable(bogieType: BogieType, condition: SpringCondition, position: SpringPosition): RDSOTableDefinition | null {
  const normPos = normalizePosition(position);

  let tablePrefix = 'TABLE_28';
  if (condition === 'USED') {
    if (bogieType === 'CASNUB_22_NLB') tablePrefix = 'TABLE_28';
    else if (bogieType === 'CASNUB_22_HS') tablePrefix = 'TABLE_29';
    else if (bogieType === 'CASNUB_22_RFT') tablePrefix = 'TABLE_30';
  } else {
    if (bogieType === 'CASNUB_22_NLB') tablePrefix = 'TABLE_31';
    else if (bogieType === 'CASNUB_22_HS') tablePrefix = 'TABLE_32';
    else if (bogieType === 'CASNUB_22_RFT') tablePrefix = 'TABLE_33';
  }

  const key = `${tablePrefix}_${normPos}`;
  return RDSO_TABLES[key] || null;
}

/**
 * Core RDSO G-95 Classification Engine
 *
 * Boundary Rule:
 * When height is on the boundary between Band N and Band N+1, it belongs to Band N (higher band).
 * E.g., for Band I [263, 260] and Band II [260, 257]:
 * - 263.00 -> Band I (max bound of Band I)
 * - 260.00 -> Band I (boundary between I and II -> higher band)
 * - 259.99 -> Band II
 * - 257.00 -> Band II (boundary between II and III -> higher band)
 * - 245.00 -> Band VI (min bound of lowest band)
 */
export function classifySpring(request: ClassificationRequest): ClassificationResult {
  const { bogieType, condition, position, measuredHeight, damageType, damageNotes } = request;

  // Validate numeric input
  if (typeof measuredHeight !== 'number' || Number.isNaN(measuredHeight) || !Number.isFinite(measuredHeight)) {
    return {
      band: null,
      bandRoman: null,
      status: 'CONDEMNED',
      tableReference: 'Unknown',
      validRange: { min: 0, max: 0 },
      condemnationReason: `Invalid measurement value: ${measuredHeight}`
    };
  }

  const table = getRDSOTable(bogieType, condition, position);
  if (!table) {
    return {
      band: null,
      bandRoman: null,
      status: 'CONDEMNED',
      tableReference: 'Unknown',
      validRange: { min: 0, max: 0 },
      condemnationReason: `No RDSO table found for ${bogieType} ${condition} ${position}`
    };
  }

  const validRange = {
    min: table.condemningMinHeight,
    max: table.condemningMaxHeight
  };

  // Check physical damage flag
  const hasPhysicalDamage = damageType && damageType !== 'NONE';

  // Check condemning range limits
  const isOutOfRange = (measuredHeight < table.condemningMinHeight) || (measuredHeight > table.condemningMaxHeight);

  if (isOutOfRange || hasPhysicalDamage) {
    const reasons: string[] = [];
    if (measuredHeight < table.condemningMinHeight) {
      reasons.push(`Free height ${measuredHeight.toFixed(2)} mm is below minimum permissible limit (${table.condemningMinHeight} mm)`);
    } else if (measuredHeight > table.condemningMaxHeight) {
      reasons.push(`Free height ${measuredHeight.toFixed(2)} mm exceeds maximum permissible limit (${table.condemningMaxHeight} mm)`);
    }

    if (hasPhysicalDamage) {
      reasons.push(`Visible physical damage detected: ${damageType}${damageNotes ? ` (${damageNotes})` : ''}`);
    }

    return {
      band: null,
      bandRoman: null,
      status: 'CONDEMNED',
      tableReference: table.tableNumber,
      validRange,
      condemnationReason: reasons.join(' | ')
    };
  }

  // Iterate over bands in descending order (Band I down to Band VI)
  // Higher bands are checked first. Exact boundaries belong to the higher band.
  for (let i = 0; i < table.bands.length; i++) {
    const bandDef = table.bands[i];
    if (measuredHeight >= bandDef.minHeight) {
      return {
        band: bandDef.band,
        bandRoman: bandDef.bandRoman,
        status: 'PASS',
        tableReference: table.tableNumber,
        validRange,
        colorHex: COLOR_HEX_MAP[bandDef.band]
      };
    }
  }

  // Fallback if not matched (e.g. edge case)
  return {
    band: null,
    bandRoman: null,
    status: 'CONDEMNED',
    tableReference: table.tableNumber,
    validRange,
    condemnationReason: `Free height ${measuredHeight.toFixed(2)} mm falls outside all RDSO band ranges`
  };
}
