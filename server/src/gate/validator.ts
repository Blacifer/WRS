/**
 * Zero-Defect Exit Gate Blocker Validator
 * Indian Railways WRS Raipur (Phase 2)
 *
 * Evaluates mandatory parts pass rate, condemned component status, Phase 1 spring nest
 * health, and stage prerequisites to guarantee zero defects before mainline release.
 */

import { WagonRepository } from '../db/wagonRepository.ts';
import type { ExitGateBlockerDetail } from '../db/wagonRepository.ts';
import type { LifecycleStage } from '../../../shared/types.ts';

export interface ExitGateEvaluationResult {
  canRelease: boolean;
  wagonNumber: string;
  currentStage: LifecycleStage;
  blockers: string[];
  blockerDetails: ExitGateBlockerDetail[];
  summary: {
    totalItems: number;
    totalMandatory: number;
    passedMandatory: number;
    failedMandatory: number;
    totalCondemned: number;
    unaddressedCondemned: number;
    springCheck: {
      totalSprings: number;
      passedSprings: number;
      condemnedSprings: number;
      hasCondemnedSprings: boolean;
    };
    hasSupervisorSignoff: boolean;
  };
}

export class ExitGateValidator {
  public static evaluate(wagonNumber: string, repository: WagonRepository): ExitGateEvaluationResult {
    return repository.evaluateExitGate(wagonNumber);
  }
}
