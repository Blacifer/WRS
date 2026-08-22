/**
 * Classification Input Validator and Dimension Sanity Checker
 * Indian Railways WRS Raipur (RDSO G-95)
 */

import type {
  BogieType,
  SpringCondition,
  SpringPosition,
  DamageType,
  ClassificationRequest
} from '../types.ts';

export const VALID_BOGIE_TYPES: readonly BogieType[] = [
  'CASNUB_22_NLB',
  'CASNUB_22_HS',
  'CASNUB_22_RFT'
] as const;

export const VALID_SPRING_CONDITIONS: readonly SpringCondition[] = [
  'USED',
  'NEW'
] as const;

export const VALID_SPRING_POSITIONS: readonly SpringPosition[] = [
  'OUTER',
  'INNER',
  'SNUBBER',
  'SNUBBER_OUTER',
  'SNUBBER_INNER'
] as const;

export const VALID_DAMAGE_TYPES: readonly DamageType[] = [
  'NONE',
  'CRACK',
  'CORROSION',
  'DEFORMATION',
  'OTHER'
] as const;

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

export function validateClassificationRequest(req: Partial<ClassificationRequest>): ValidationResult {
  const errors: string[] = [];

  if (!req.bogieType || !VALID_BOGIE_TYPES.includes(req.bogieType as BogieType)) {
    errors.push(`Invalid or missing bogieType: "${req.bogieType}". Must be one of: ${VALID_BOGIE_TYPES.join(', ')}`);
  }

  if (!req.condition || !VALID_SPRING_CONDITIONS.includes(req.condition as SpringCondition)) {
    errors.push(`Invalid or missing condition: "${req.condition}". Must be one of: ${VALID_SPRING_CONDITIONS.join(', ')}`);
  }

  if (!req.position || !VALID_SPRING_POSITIONS.includes(req.position as SpringPosition)) {
    errors.push(`Invalid or missing position: "${req.position}". Must be one of: ${VALID_SPRING_POSITIONS.join(', ')}`);
  }

  if (req.measuredHeight === undefined || req.measuredHeight === null || typeof req.measuredHeight !== 'number' || isNaN(req.measuredHeight) || !isFinite(req.measuredHeight)) {
    errors.push(`Invalid or missing measuredHeight: "${req.measuredHeight}". Must be a finite number in mm`);
  } else if (req.measuredHeight < 100.0 || req.measuredHeight > 450.0) {
    errors.push(`measuredHeight ${req.measuredHeight}mm is outside physically permissible railway spring gauge limits (100.0mm - 450.0mm)`);
  }

  if (req.damageType && !VALID_DAMAGE_TYPES.includes(req.damageType as DamageType)) {
    errors.push(`Invalid damageType: "${req.damageType}". Must be one of: ${VALID_DAMAGE_TYPES.join(', ')}`);
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}
