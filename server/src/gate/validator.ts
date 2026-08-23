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
  /**
   * Recommended-practice issues that do NOT block release — currently spring
   * nest grouping (RDSO WMM 2.0's 3 mm same-group variation recommendation).
   * Surfaced for supervisor judgement rather than enforced, because the
   * manual's wording is advisory and inspection records carry no per-spring
   * identity. See validateSpringNests() for the full reasoning.
   */
  advisories: string[];
  advisoryDetails: ExitGateBlockerDetail[];
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
    springNestCheck: {
      isMatched: boolean;
      violationCount: number;
      groups: unknown[];
      ruleReference: string;
      maxVariationMm: number;
    };
    hasSupervisorSignoff: boolean;
  };
}

export class ExitGateValidator {
  public static evaluate(wagonNumber: string, repository: WagonRepository): ExitGateEvaluationResult {
    return repository.evaluateExitGate(wagonNumber);
  }
}
