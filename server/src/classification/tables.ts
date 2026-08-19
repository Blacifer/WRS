/**
 * RDSO Technical Pamphlet G-95 Revision-II Master Spring Tables (Tables 28-33)
 * Indian Railways Wagon Repair Shop (WRS) Raipur
 */

import type {
  BogieType,
  SpringCondition,
  SpringPosition,
  RDSOTableDefinition,
  BandColor
} from '../../../shared/types.ts';

export const COLOR_HEX_MAP: Record<BandColor, string> = {
  BLUE: '#2563eb',
  GREEN: '#16a34a',
  YELLOW: '#ca8a04',
  ORANGE: '#ea580c',
  WHITE: '#e2e8f0',
  RED: '#dc2626'
};

export const RDSO_TABLES: Record<string, RDSOTableDefinition> = {
  // -------------------------------------------------------------------------
  // Table 28: CASNUB 22 NLB / NLB(M) — Used Springs
  // -------------------------------------------------------------------------
  'TABLE_28_OUTER': {
    tableNumber: 'Table 28',
    tableReference: 'Table 28',
    bogieType: 'CASNUB_22_NLB',
    condition: 'USED',
    position: 'OUTER',
    nominalFreeHeight: 260,
    tolerance: 3,
    condemningMinHeight: 245.0,
    condemningMaxHeight: 263.0,
    validRange: { min: 245.0, max: 263.0 },
    bands: [
      { band: 'BLUE', bandRoman: 'Band I', minHeight: 260.0, maxHeight: 263.0, isHighestBand: true, bandNumber: 1 },
      { band: 'GREEN', bandRoman: 'Band II', minHeight: 257.0, maxHeight: 260.0, isHighestBand: false, bandNumber: 2 },
      { band: 'YELLOW', bandRoman: 'Band III', minHeight: 254.0, maxHeight: 257.0, isHighestBand: false, bandNumber: 3 },
      { band: 'ORANGE', bandRoman: 'Band IV', minHeight: 251.0, maxHeight: 254.0, isHighestBand: false, bandNumber: 4 },
      { band: 'WHITE', bandRoman: 'Band V', minHeight: 248.0, maxHeight: 251.0, isHighestBand: false, bandNumber: 5 },
      { band: 'RED', bandRoman: 'Band VI', minHeight: 245.0, maxHeight: 248.0, isHighestBand: false, bandNumber: 6 }
    ]
  },
  'TABLE_28_INNER': {
    tableNumber: 'Table 28',
    tableReference: 'Table 28',
    bogieType: 'CASNUB_22_NLB',
    condition: 'USED',
    position: 'INNER',
    nominalFreeHeight: 262,
    tolerance: 3,
    condemningMinHeight: 247.0,
    condemningMaxHeight: 265.0,
    validRange: { min: 247.0, max: 265.0 },
    bands: [
      { band: 'BLUE', bandRoman: 'Band I', minHeight: 262.0, maxHeight: 265.0, isHighestBand: true, bandNumber: 1 },
      { band: 'GREEN', bandRoman: 'Band II', minHeight: 259.0, maxHeight: 262.0, isHighestBand: false, bandNumber: 2 },
      { band: 'YELLOW', bandRoman: 'Band III', minHeight: 256.0, maxHeight: 259.0, isHighestBand: false, bandNumber: 3 },
      { band: 'ORANGE', bandRoman: 'Band IV', minHeight: 253.0, maxHeight: 256.0, isHighestBand: false, bandNumber: 4 },
      { band: 'WHITE', bandRoman: 'Band V', minHeight: 250.0, maxHeight: 253.0, isHighestBand: false, bandNumber: 5 },
      { band: 'RED', bandRoman: 'Band VI', minHeight: 247.0, maxHeight: 250.0, isHighestBand: false, bandNumber: 6 }
    ]
  },
  'TABLE_28_SNUBBER': {
    tableNumber: 'Table 28',
    tableReference: 'Table 28',
    bogieType: 'CASNUB_22_NLB',
    condition: 'USED',
    position: 'SNUBBER',
    nominalFreeHeight: 294,
    tolerance: 3,
    condemningMinHeight: 279.0,
    condemningMaxHeight: 297.0,
    validRange: { min: 279.0, max: 297.0 },
    bands: [
      { band: 'BLUE', bandRoman: 'Band I', minHeight: 294.0, maxHeight: 297.0, isHighestBand: true, bandNumber: 1 },
      { band: 'GREEN', bandRoman: 'Band II', minHeight: 291.0, maxHeight: 294.0, isHighestBand: false, bandNumber: 2 },
      { band: 'YELLOW', bandRoman: 'Band III', minHeight: 288.0, maxHeight: 291.0, isHighestBand: false, bandNumber: 3 },
      { band: 'ORANGE', bandRoman: 'Band IV', minHeight: 285.0, maxHeight: 288.0, isHighestBand: false, bandNumber: 4 },
      { band: 'WHITE', bandRoman: 'Band V', minHeight: 282.0, maxHeight: 285.0, isHighestBand: false, bandNumber: 5 },
      { band: 'RED', bandRoman: 'Band VI', minHeight: 279.0, maxHeight: 282.0, isHighestBand: false, bandNumber: 6 }
    ]
  },

  // -------------------------------------------------------------------------
  // Table 29: CASNUB 22HS / HS(M) — Used Springs
  // -------------------------------------------------------------------------
  'TABLE_29_OUTER': {
    tableNumber: 'Table 29',
    tableReference: 'Table 29',
    bogieType: 'CASNUB_22_HS',
    condition: 'USED',
    position: 'OUTER',
    nominalFreeHeight: 260,
    tolerance: 3,
    condemningMinHeight: 245.0,
    condemningMaxHeight: 263.0,
    validRange: { min: 245.0, max: 263.0 },
    bands: [
      { band: 'BLUE', bandRoman: 'Band I', minHeight: 260.0, maxHeight: 263.0, isHighestBand: true, bandNumber: 1 },
      { band: 'GREEN', bandRoman: 'Band II', minHeight: 257.0, maxHeight: 260.0, isHighestBand: false, bandNumber: 2 },
      { band: 'YELLOW', bandRoman: 'Band III', minHeight: 254.0, maxHeight: 257.0, isHighestBand: false, bandNumber: 3 },
      { band: 'ORANGE', bandRoman: 'Band IV', minHeight: 251.0, maxHeight: 254.0, isHighestBand: false, bandNumber: 4 },
      { band: 'WHITE', bandRoman: 'Band V', minHeight: 248.0, maxHeight: 251.0, isHighestBand: false, bandNumber: 5 },
      { band: 'RED', bandRoman: 'Band VI', minHeight: 245.0, maxHeight: 248.0, isHighestBand: false, bandNumber: 6 }
    ]
  },
  'TABLE_29_INNER': {
    tableNumber: 'Table 29',
    tableReference: 'Table 29',
    bogieType: 'CASNUB_22_HS',
    condition: 'USED',
    position: 'INNER',
    nominalFreeHeight: 243,
    tolerance: 3,
    condemningMinHeight: 228.0,
    condemningMaxHeight: 246.0,
    validRange: { min: 228.0, max: 246.0 },
    bands: [
      { band: 'BLUE', bandRoman: 'Band I', minHeight: 243.0, maxHeight: 246.0, isHighestBand: true, bandNumber: 1 },
      { band: 'GREEN', bandRoman: 'Band II', minHeight: 240.0, maxHeight: 243.0, isHighestBand: false, bandNumber: 2 },
      { band: 'YELLOW', bandRoman: 'Band III', minHeight: 237.0, maxHeight: 240.0, isHighestBand: false, bandNumber: 3 },
      { band: 'ORANGE', bandRoman: 'Band IV', minHeight: 234.0, maxHeight: 237.0, isHighestBand: false, bandNumber: 4 },
      { band: 'WHITE', bandRoman: 'Band V', minHeight: 231.0, maxHeight: 234.0, isHighestBand: false, bandNumber: 5 },
      { band: 'RED', bandRoman: 'Band VI', minHeight: 228.0, maxHeight: 231.0, isHighestBand: false, bandNumber: 6 }
    ]
  },
  'TABLE_29_SNUBBER': {
    tableNumber: 'Table 29',
    tableReference: 'Table 29',
    bogieType: 'CASNUB_22_HS',
    condition: 'USED',
    position: 'SNUBBER',
    nominalFreeHeight: 293,
    tolerance: 3,
    condemningMinHeight: 278.0,
    condemningMaxHeight: 296.0,
    validRange: { min: 278.0, max: 296.0 },
    bands: [
      { band: 'BLUE', bandRoman: 'Band I', minHeight: 293.0, maxHeight: 296.0, isHighestBand: true, bandNumber: 1 },
      { band: 'GREEN', bandRoman: 'Band II', minHeight: 290.0, maxHeight: 293.0, isHighestBand: false, bandNumber: 2 },
      { band: 'YELLOW', bandRoman: 'Band III', minHeight: 287.0, maxHeight: 290.0, isHighestBand: false, bandNumber: 3 },
      { band: 'ORANGE', bandRoman: 'Band IV', minHeight: 284.0, maxHeight: 287.0, isHighestBand: false, bandNumber: 4 },
      { band: 'WHITE', bandRoman: 'Band V', minHeight: 281.0, maxHeight: 284.0, isHighestBand: false, bandNumber: 5 },
      { band: 'RED', bandRoman: 'Band VI', minHeight: 278.0, maxHeight: 281.0, isHighestBand: false, bandNumber: 6 }
    ]
  },

  // -------------------------------------------------------------------------
  // Table 30: CASNUB 22 RFT — Used Springs
  // -------------------------------------------------------------------------
  'TABLE_30_OUTER': {
    tableNumber: 'Table 30',
    tableReference: 'Table 30',
    bogieType: 'CASNUB_22_RFT',
    condition: 'USED',
    position: 'OUTER',
    nominalFreeHeight: 272,
    tolerance: 3,
    condemningMinHeight: 257.0,
    condemningMaxHeight: 275.0,
    validRange: { min: 257.0, max: 275.0 },
    bands: [
      { band: 'BLUE', bandRoman: 'Band I', minHeight: 272.0, maxHeight: 275.0, isHighestBand: true, bandNumber: 1 },
      { band: 'GREEN', bandRoman: 'Band II', minHeight: 269.0, maxHeight: 272.0, isHighestBand: false, bandNumber: 2 },
      { band: 'YELLOW', bandRoman: 'Band III', minHeight: 266.0, maxHeight: 269.0, isHighestBand: false, bandNumber: 3 },
      { band: 'ORANGE', bandRoman: 'Band IV', minHeight: 263.0, maxHeight: 266.0, isHighestBand: false, bandNumber: 4 },
      { band: 'WHITE', bandRoman: 'Band V', minHeight: 260.0, maxHeight: 263.0, isHighestBand: false, bandNumber: 5 },
      { band: 'RED', bandRoman: 'Band VI', minHeight: 257.0, maxHeight: 260.0, isHighestBand: false, bandNumber: 6 }
    ]
  },
  'TABLE_30_INNER': {
    tableNumber: 'Table 30',
    tableReference: 'Table 30',
    bogieType: 'CASNUB_22_RFT',
    condition: 'USED',
    position: 'INNER',
    nominalFreeHeight: 237,
    tolerance: 3,
    condemningMinHeight: 222.0,
    condemningMaxHeight: 240.0,
    validRange: { min: 222.0, max: 240.0 },
    bands: [
      { band: 'BLUE', bandRoman: 'Band I', minHeight: 237.0, maxHeight: 240.0, isHighestBand: true, bandNumber: 1 },
      { band: 'GREEN', bandRoman: 'Band II', minHeight: 234.0, maxHeight: 237.0, isHighestBand: false, bandNumber: 2 },
      { band: 'YELLOW', bandRoman: 'Band III', minHeight: 231.0, maxHeight: 234.0, isHighestBand: false, bandNumber: 3 },
      { band: 'ORANGE', bandRoman: 'Band IV', minHeight: 228.0, maxHeight: 231.0, isHighestBand: false, bandNumber: 4 },
      { band: 'WHITE', bandRoman: 'Band V', minHeight: 225.0, maxHeight: 228.0, isHighestBand: false, bandNumber: 5 },
      { band: 'RED', bandRoman: 'Band VI', minHeight: 222.0, maxHeight: 225.0, isHighestBand: false, bandNumber: 6 }
    ]
  },
  'TABLE_30_SNUBBER': {
    tableNumber: 'Table 30',
    tableReference: 'Table 30',
    bogieType: 'CASNUB_22_RFT',
    condition: 'USED',
    position: 'SNUBBER',
    nominalFreeHeight: 304,
    tolerance: 3,
    condemningMinHeight: 289.0,
    condemningMaxHeight: 307.0,
    validRange: { min: 289.0, max: 307.0 },
    bands: [
      { band: 'BLUE', bandRoman: 'Band I', minHeight: 304.0, maxHeight: 307.0, isHighestBand: true, bandNumber: 1 },
      { band: 'GREEN', bandRoman: 'Band II', minHeight: 301.0, maxHeight: 304.0, isHighestBand: false, bandNumber: 2 },
      { band: 'YELLOW', bandRoman: 'Band III', minHeight: 298.0, maxHeight: 301.0, isHighestBand: false, bandNumber: 3 },
      { band: 'ORANGE', bandRoman: 'Band IV', minHeight: 295.0, maxHeight: 298.0, isHighestBand: false, bandNumber: 4 },
      { band: 'WHITE', bandRoman: 'Band V', minHeight: 292.0, maxHeight: 295.0, isHighestBand: false, bandNumber: 5 },
      { band: 'RED', bandRoman: 'Band VI', minHeight: 289.0, maxHeight: 292.0, isHighestBand: false, bandNumber: 6 }
    ]
  },

  // -------------------------------------------------------------------------
  // Table 31: CASNUB 22 NLB / NLB(M) — New Springs (3 Bands)
  // -------------------------------------------------------------------------
  'TABLE_31_OUTER': {
    tableNumber: 'Table 31',
    tableReference: 'Table 31',
    bogieType: 'CASNUB_22_NLB',
    condition: 'NEW',
    position: 'OUTER',
    nominalFreeHeight: 260,
    tolerance: 3,
    condemningMinHeight: 257.0,
    condemningMaxHeight: 263.0,
    validRange: { min: 257.0, max: 263.0 },
    bands: [
      { band: 'GREEN', bandRoman: 'Band I', minHeight: 261.0, maxHeight: 263.0, isHighestBand: true, bandNumber: 1 },
      { band: 'YELLOW', bandRoman: 'Band II', minHeight: 259.0, maxHeight: 261.0, isHighestBand: false, bandNumber: 2 },
      { band: 'RED', bandRoman: 'Band III', minHeight: 257.0, maxHeight: 259.0, isHighestBand: false, bandNumber: 3 }
    ]
  },
  'TABLE_31_INNER': {
    tableNumber: 'Table 31',
    tableReference: 'Table 31',
    bogieType: 'CASNUB_22_NLB',
    condition: 'NEW',
    position: 'INNER',
    nominalFreeHeight: 262,
    tolerance: 3,
    condemningMinHeight: 259.0,
    condemningMaxHeight: 265.0,
    validRange: { min: 259.0, max: 265.0 },
    bands: [
      { band: 'GREEN', bandRoman: 'Band I', minHeight: 263.0, maxHeight: 265.0, isHighestBand: true, bandNumber: 1 },
      { band: 'YELLOW', bandRoman: 'Band II', minHeight: 261.0, maxHeight: 263.0, isHighestBand: false, bandNumber: 2 },
      { band: 'RED', bandRoman: 'Band III', minHeight: 259.0, maxHeight: 261.0, isHighestBand: false, bandNumber: 3 }
    ]
  },
  'TABLE_31_SNUBBER': {
    tableNumber: 'Table 31',
    tableReference: 'Table 31',
    bogieType: 'CASNUB_22_NLB',
    condition: 'NEW',
    position: 'SNUBBER',
    nominalFreeHeight: 294,
    tolerance: 3,
    condemningMinHeight: 291.0,
    condemningMaxHeight: 297.0,
    validRange: { min: 291.0, max: 297.0 },
    bands: [
      { band: 'GREEN', bandRoman: 'Band I', minHeight: 295.0, maxHeight: 297.0, isHighestBand: true, bandNumber: 1 },
      { band: 'YELLOW', bandRoman: 'Band II', minHeight: 293.0, maxHeight: 295.0, isHighestBand: false, bandNumber: 2 },
      { band: 'RED', bandRoman: 'Band III', minHeight: 291.0, maxHeight: 293.0, isHighestBand: false, bandNumber: 3 }
    ]
  },

  // -------------------------------------------------------------------------
  // Table 32: CASNUB 22HS / HS(M) — New Springs (3 Bands)
  // -------------------------------------------------------------------------
  'TABLE_32_OUTER': {
    tableNumber: 'Table 32',
    tableReference: 'Table 32',
    bogieType: 'CASNUB_22_HS',
    condition: 'NEW',
    position: 'OUTER',
    nominalFreeHeight: 260,
    tolerance: 3,
    condemningMinHeight: 257.0,
    condemningMaxHeight: 263.0,
    validRange: { min: 257.0, max: 263.0 },
    bands: [
      { band: 'GREEN', bandRoman: 'Band I', minHeight: 261.0, maxHeight: 263.0, isHighestBand: true, bandNumber: 1 },
      { band: 'YELLOW', bandRoman: 'Band II', minHeight: 259.0, maxHeight: 261.0, isHighestBand: false, bandNumber: 2 },
      { band: 'RED', bandRoman: 'Band III', minHeight: 257.0, maxHeight: 259.0, isHighestBand: false, bandNumber: 3 }
    ]
  },
  'TABLE_32_INNER': {
    tableNumber: 'Table 32',
    tableReference: 'Table 32',
    bogieType: 'CASNUB_22_HS',
    condition: 'NEW',
    position: 'INNER',
    nominalFreeHeight: 243,
    tolerance: 3,
    condemningMinHeight: 240.0,
    condemningMaxHeight: 246.0,
    validRange: { min: 240.0, max: 246.0 },
    bands: [
      { band: 'GREEN', bandRoman: 'Band I', minHeight: 244.0, maxHeight: 246.0, isHighestBand: true, bandNumber: 1 },
      { band: 'YELLOW', bandRoman: 'Band II', minHeight: 242.0, maxHeight: 244.0, isHighestBand: false, bandNumber: 2 },
      { band: 'RED', bandRoman: 'Band III', minHeight: 240.0, maxHeight: 242.0, isHighestBand: false, bandNumber: 3 }
    ]
  },
  'TABLE_32_SNUBBER': {
    tableNumber: 'Table 32',
    tableReference: 'Table 32',
    bogieType: 'CASNUB_22_HS',
    condition: 'NEW',
    position: 'SNUBBER',
    nominalFreeHeight: 293,
    tolerance: 3,
    condemningMinHeight: 290.0,
    condemningMaxHeight: 296.0,
    validRange: { min: 290.0, max: 296.0 },
    bands: [
      { band: 'GREEN', bandRoman: 'Band I', minHeight: 294.0, maxHeight: 296.0, isHighestBand: true, bandNumber: 1 },
      { band: 'YELLOW', bandRoman: 'Band II', minHeight: 292.0, maxHeight: 294.0, isHighestBand: false, bandNumber: 2 },
      { band: 'RED', bandRoman: 'Band III', minHeight: 290.0, maxHeight: 292.0, isHighestBand: false, bandNumber: 3 }
    ]
  },

  // -------------------------------------------------------------------------
  // Table 33: CASNUB 22 RFT — New Springs (3 Bands)
  // -------------------------------------------------------------------------
  'TABLE_33_OUTER': {
    tableNumber: 'Table 33',
    tableReference: 'Table 33',
    bogieType: 'CASNUB_22_RFT',
    condition: 'NEW',
    position: 'OUTER',
    nominalFreeHeight: 272,
    tolerance: 3,
    condemningMinHeight: 269.0,
    condemningMaxHeight: 275.0,
    validRange: { min: 269.0, max: 275.0 },
    bands: [
      { band: 'GREEN', bandRoman: 'Band I', minHeight: 273.0, maxHeight: 275.0, isHighestBand: true, bandNumber: 1 },
      { band: 'YELLOW', bandRoman: 'Band II', minHeight: 271.0, maxHeight: 273.0, isHighestBand: false, bandNumber: 2 },
      { band: 'RED', bandRoman: 'Band III', minHeight: 269.0, maxHeight: 271.0, isHighestBand: false, bandNumber: 3 }
    ]
  },
  'TABLE_33_INNER': {
    tableNumber: 'Table 33',
    tableReference: 'Table 33',
    bogieType: 'CASNUB_22_RFT',
    condition: 'NEW',
    position: 'INNER',
    nominalFreeHeight: 237,
    tolerance: 3,
    condemningMinHeight: 234.0,
    condemningMaxHeight: 240.0,
    validRange: { min: 234.0, max: 240.0 },
    bands: [
      { band: 'GREEN', bandRoman: 'Band I', minHeight: 238.0, maxHeight: 240.0, isHighestBand: true, bandNumber: 1 },
      { band: 'YELLOW', bandRoman: 'Band II', minHeight: 236.0, maxHeight: 238.0, isHighestBand: false, bandNumber: 2 },
      { band: 'RED', bandRoman: 'Band III', minHeight: 234.0, maxHeight: 236.0, isHighestBand: false, bandNumber: 3 }
    ]
  },
  'TABLE_33_SNUBBER': {
    tableNumber: 'Table 33',
    tableReference: 'Table 33',
    bogieType: 'CASNUB_22_RFT',
    condition: 'NEW',
    position: 'SNUBBER',
    nominalFreeHeight: 304,
    tolerance: 3,
    condemningMinHeight: 301.0,
    condemningMaxHeight: 307.0,
    validRange: { min: 301.0, max: 307.0 },
    bands: [
      { band: 'GREEN', bandRoman: 'Band I', minHeight: 305.0, maxHeight: 307.0, isHighestBand: true, bandNumber: 1 },
      { band: 'YELLOW', bandRoman: 'Band II', minHeight: 303.0, maxHeight: 305.0, isHighestBand: false, bandNumber: 2 },
      { band: 'RED', bandRoman: 'Band III', minHeight: 301.0, maxHeight: 303.0, isHighestBand: false, bandNumber: 3 }
    ]
  }
};

/**
 * Normalizes spring position key (maps SNUBBER_OUTER and SNUBBER_INNER to SNUBBER for RDSO tables)
 */
export function normalizePosition(pos: SpringPosition): 'OUTER' | 'INNER' | 'SNUBBER' {
  if (pos === 'SNUBBER_OUTER' || pos === 'SNUBBER_INNER') {
    return 'SNUBBER';
  }
  return pos;
}

/**
 * Determines the RDSO table key from bogieType, condition, and position
 */
export function getRDSOTable(
  bogieType: BogieType,
  condition: SpringCondition,
  position: SpringPosition
): RDSOTableDefinition | null {
  const normPos = normalizePosition(position);

  let tablePrefix = '';
  if (bogieType === 'CASNUB_22_NLB') {
    tablePrefix = condition === 'USED' ? 'TABLE_28' : 'TABLE_31';
  } else if (bogieType === 'CASNUB_22_HS') {
    tablePrefix = condition === 'USED' ? 'TABLE_29' : 'TABLE_32';
  } else if (bogieType === 'CASNUB_22_RFT') {
    tablePrefix = condition === 'USED' ? 'TABLE_30' : 'TABLE_33';
  }

  const key = `${tablePrefix}_${normPos}`;
  return RDSO_TABLES[key] || null;
}
