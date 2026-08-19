/**
 * 7-Stage Wagon Lifecycle Engine & State Machine
 * Indian Railways WRS Raipur (Phase 2)
 *
 * Implements strict sequential progression, supervisor override validation,
 * transition audit trail, and wagon registration.
 */

import crypto from 'node:crypto';
import type {
  LifecycleStage,
  WagonRecord,
  LifecycleTransition,
  WagonRegisterRequest,
  WagonTransitionRequest,
  User
} from '../../shared/types.ts';

export const STAGE_ORDER: Record<LifecycleStage, number> = {
  ENTRY_REGISTRATION: 1,
  DISMANTLING: 2,
  COMPONENT_INSPECTION: 3,
  REPAIR_REPLACEMENT: 4,
  REASSEMBLY: 5,
  FINAL_QC_GATE: 6,
  RELEASE: 7
};

export const STAGE_NAMES_BY_INDEX: Record<number, LifecycleStage> = {
  1: 'ENTRY_REGISTRATION',
  2: 'DISMANTLING',
  3: 'COMPONENT_INSPECTION',
  4: 'REPAIR_REPLACEMENT',
  5: 'REASSEMBLY',
  6: 'FINAL_QC_GATE',
  7: 'RELEASE'
};

export class WagonLifecycleEngine {
  /**
   * Validate wagon number format
   * Accepts: OWNER/TYPE/NUMBER (e.g. NR/BOXNHL/12345, SECR/BCNHL/98765) or standard alphanumeric strings
   */
  public static validateWagonNumber(wagonNumber: string): { valid: boolean; error?: string } {
    if (!wagonNumber || typeof wagonNumber !== 'string') {
      return { valid: false, error: 'Wagon number is required' };
    }
    const trimmed = wagonNumber.trim();
    if (trimmed.length < 3) {
      return { valid: false, error: 'Wagon number must be at least 3 characters' };
    }
    if (/[<>'"`;\\{}]/.test(trimmed)) {
      return { valid: false, error: 'Wagon number contains invalid characters' };
    }
    return { valid: true };
  }

  /**
   * Validate stage transition rule
   */
  public static validateTransition(
    currentStage: LifecycleStage,
    targetStage: LifecycleStage,
    isSupervisor: boolean,
    hasOverride: boolean,
    justification?: string
  ): { allowed: boolean; error?: string; isOverride: boolean } {
    const currentIndex = STAGE_ORDER[currentStage];
    const targetIndex = STAGE_ORDER[targetStage];

    if (!currentIndex || !targetIndex) {
      return { allowed: false, error: `Invalid stage: ${targetStage}`, isOverride: false };
    }

    if (currentIndex === 7) {
      return { allowed: false, error: 'Wagon is already in RELEASE stage and cannot be transitioned further', isOverride: false };
    }

    // Normal forward sequential progression (e.g. 1 -> 2, 2 -> 3)
    if (targetIndex === currentIndex + 1) {
      return { allowed: true, isOverride: false };
    }

    // Same stage - idempotent no-op or note update
    if (targetIndex === currentIndex) {
      return { allowed: true, isOverride: false };
    }

    // Skipping stages forward (e.g. 1 -> 3) or moving backward (e.g. 4 -> 2)
    if (!isSupervisor) {
      return {
        allowed: false,
        error: `Only Supervisors or Admins can perform non-sequential stage transitions (from ${currentStage} to ${targetStage})`,
        isOverride: true
      };
    }

    if (!hasOverride) {
      return {
        allowed: false,
        error: `Non-sequential stage transition from ${currentStage} to ${targetStage} requires supervisorOverride: true`,
        isOverride: true
      };
    }

    if (!justification || justification.trim().length < 5) {
      return {
        allowed: false,
        error: 'Mandatory justification (at least 5 characters) is required for supervisor override',
        isOverride: true
      };
    }

    return { allowed: true, isOverride: true };
  }
}
