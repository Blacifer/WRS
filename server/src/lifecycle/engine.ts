/**
 * 7-Stage Wagon Lifecycle State Machine Engine
 * Indian Railways WRS Raipur (Phase 2)
 *
 * Enforces strict sequential progression across workshop stages and governs
 * supervisor overrides for out-of-sequence / backward transitions with OTP audit.
 */

import type { LifecycleStage, UserRole } from '../../../shared/types.ts';
import { LIFECYCLE_STAGES } from '../../../shared/types.ts';
import { can } from '../../../shared/auth/permissions.ts';

export interface TransitionValidationResult {
  valid: boolean;
  error?: string;
  statusCode?: number;
  transitionType: 'NORMAL' | 'OVERRIDE_SKIP' | 'OVERRIDE_BACKWARD' | 'GATE_SIGNOFF' | 'REOPEN';
}

export class LifecycleEngine {
  private static stageIndexMap: Record<LifecycleStage, number> = {
    ENTRY_REGISTRATION: 0,
    DISMANTLING: 1,
    COMPONENT_INSPECTION: 2,
    REPAIR_REPLACEMENT: 3,
    REASSEMBLY: 4,
    FINAL_QC_GATE: 5,
    RELEASE: 6
  };

  /**
   * Validates whether a state transition is permissible under workshop rules
   */
  public static validateTransition(params: {
    currentStage: LifecycleStage;
    targetStage: LifecycleStage;
    userRole: UserRole | string;
    isOverride?: boolean;
    overrideJustification?: string | null;
    otpToken?: string | null;
  }): TransitionValidationResult {
    const { currentStage, targetStage, userRole, isOverride, overrideJustification } = params;

    if (!LIFECYCLE_STAGES.includes(targetStage)) {
      return {
        valid: false,
        error: `Invalid target lifecycle stage: "${targetStage}"`,
        statusCode: 400,
        transitionType: 'NORMAL'
      };
    }

    if (currentStage === targetStage) {
      return {
        valid: true,
        transitionType: 'NORMAL'
      };
    }

    const currentIndex = this.stageIndexMap[currentStage] ?? 0;
    const targetIndex = this.stageIndexMap[targetStage] ?? 0;
    /*
     * The same authority the rest of the system uses.
     *
     * This was `roleUpper === 'SUPERVISOR' || roleUpper === 'ADMIN'` — a third
     * permission mechanism, hardcoded, sitting underneath the route guards and
     * disagreeing with them. The gate sign-off route refuses an administrator
     * because the matrix deliberately withholds wagon.release from them: an
     * administrator runs the system and does not certify that a wagon is fit
     * to run. This engine then let that same administrator override a stage
     * transition, reopen a released wagon, and force a move to RELEASE.
     *
     * One boundary, in one place. A supervisor holds wagon.override; an
     * administrator and the DRM do not, and now cannot.
     */
    const mayOverride = can(userRole, 'wagon.override');

    // 1. Reopening a released wagon (from RELEASE to earlier stage)
    if (currentStage === 'RELEASE') {
      if (!mayOverride) {
        return {
          valid: false,
          error: 'Only a supervisor can reopen a released wagon.',
          statusCode: 403,
          transitionType: 'REOPEN'
        };
      }
      if (!overrideJustification || overrideJustification.trim().length < 10) {
        return {
          valid: false,
          error: 'Reopening a released wagon requires a detailed supervisor justification (min 10 characters).',
          statusCode: 400,
          transitionType: 'REOPEN'
        };
      }
      return {
        valid: true,
        transitionType: 'REOPEN'
      };
    }

    // 2. Normal sequential forward advance (S_i -> S_{i+1})
    if (targetIndex === currentIndex + 1) {
      if (targetStage === 'RELEASE') {
        // Transition to RELEASE strictly requires gate sign-off or explicit supervisor override
        if (!isOverride) {
          return {
            valid: false,
            error: 'Direct transition to RELEASE is strictly restricted to the Exit Gate Digital Sign-off endpoint (/api/wagons/:wagonNumber/gate/signoff).',
            statusCode: 422,
            transitionType: 'NORMAL'
          };
        }
        if (!mayOverride) {
          return {
            valid: false,
            error: 'Only a supervisor can override a wagon to RELEASE.',
            statusCode: 403,
            transitionType: 'GATE_SIGNOFF'
          };
        }
        if (!overrideJustification || overrideJustification.trim().length < 10) {
          return {
            valid: false,
            error: 'Supervisor override to RELEASE requires a non-empty justification (min 10 characters).',
            statusCode: 400,
            transitionType: 'GATE_SIGNOFF'
          };
        }
        return {
          valid: true,
          transitionType: 'GATE_SIGNOFF'
        };
      }

      return {
        valid: true,
        transitionType: 'NORMAL'
      };
    }

    // 3. Stage Skipping (S_i -> S_{i+k} where k > 1)
    if (targetIndex > currentIndex + 1) {
      if (!isOverride) {
        return {
          valid: false,
          error: `Sequential workflow violation: cannot jump directly from ${currentStage} to ${targetStage}. Stage skipping requires supervisor override.`,
          statusCode: 400,
          transitionType: 'OVERRIDE_SKIP'
        };
      }
      if (!mayOverride) {
        return {
          valid: false,
          error: 'Only a supervisor can skip a stage.',
          statusCode: 403,
          transitionType: 'OVERRIDE_SKIP'
        };
      }
      if (!overrideJustification || overrideJustification.trim().length < 10) {
        return {
          valid: false,
          error: 'Stage skipping requires a non-empty supervisor justification (min 10 characters).',
          statusCode: 400,
          transitionType: 'OVERRIDE_SKIP'
        };
      }

      return {
        valid: true,
        transitionType: 'OVERRIDE_SKIP'
      };
    }

    // 4. Backward Transitions (S_i -> S_j where j < i)
    if (targetIndex < currentIndex) {
      if (!isOverride) {
        return {
          valid: false,
          error: `Backward stage transition from ${currentStage} to ${targetStage} requires supervisor override.`,
          statusCode: 400,
          transitionType: 'OVERRIDE_BACKWARD'
        };
      }
      if (!mayOverride) {
        return {
          valid: false,
          error: 'Only a supervisor can move a wagon back a stage.',
          statusCode: 403,
          transitionType: 'OVERRIDE_BACKWARD'
        };
      }
      if (!overrideJustification || overrideJustification.trim().length < 10) {
        return {
          valid: false,
          error: 'Backward transitions require a non-empty supervisor justification (min 10 characters).',
          statusCode: 400,
          transitionType: 'OVERRIDE_BACKWARD'
        };
      }

      return {
        valid: true,
        transitionType: 'OVERRIDE_BACKWARD'
      };
    }

    return {
      valid: false,
      error: 'Unhandled transition scenario',
      statusCode: 400,
      transitionType: 'NORMAL'
    };
  }

  public static getStageIndex(stage: LifecycleStage): number {
    return this.stageIndexMap[stage] ?? 0;
  }

  public static getNextStage(stage: LifecycleStage): LifecycleStage | null {
    const idx = this.stageIndexMap[stage];
    if (idx !== undefined && idx < LIFECYCLE_STAGES.length - 1) {
      return LIFECYCLE_STAGES[idx + 1];
    }
    return null;
  }

  public static getPreviousStage(stage: LifecycleStage): LifecycleStage | null {
    const idx = this.stageIndexMap[stage];
    if (idx !== undefined && idx > 0) {
      return LIFECYCLE_STAGES[idx - 1];
    }
    return null;
  }
}
