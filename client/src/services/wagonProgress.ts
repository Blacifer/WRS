/**
 * What the wagon screen derives about a wagon's state
 * Indian Railways WRS Raipur
 *
 * Lifted out of WagonDetailPage, where it sat inline among 2,200 lines of
 * JSX and could not be tested. None of it is complicated; all of it decides
 * what an inspector is told about where a wagon has got to and what remains.
 *
 * The pattern this guards against is the near-miss string. Elsewhere in this
 * file the release stage is compared against 'RELEASE' — the correct value —
 * but 'RELEASED' reads just as plausibly, and a wrong one here shows a
 * released wagon as still in progress with no error anywhere. Small, silent,
 * and invisible until somebody looks.
 */

/** The seven lifecycle stages, in order. */
export const STAGE_ORDER = [
  'ENTRY_REGISTRATION',
  'DISMANTLING',
  'COMPONENT_INSPECTION',
  'REPAIR_REPLACEMENT',
  'REASSEMBLY',
  'FINAL_QC_GATE',
  'RELEASE'
] as const;

export type WagonStage = (typeof STAGE_ORDER)[number];

export interface StageStep {
  stage: string;
  index: number;
  isPast: boolean;
  isCurrent: boolean;
  isFuture: boolean;
}

export interface WagonProgress {
  /** Position in STAGE_ORDER, or -1 when the stage is unrecognised. */
  currentStageIndex: number;
  /** The wagon has been released. */
  isReleased: boolean;
  /** The wagon is at the final QC gate. */
  isAtQcGate: boolean;
  /** Checklist items not yet judged. */
  pendingCount: number;
  /** How many of the seven stages are complete, for a progress reading. */
  completedStages: number;
  /** Per-stage flags for the stepper. */
  steps: StageStep[];
}

interface ChecklistLike {
  status?: string | null;
}

export function readWagonProgress(
  wagon: { currentStage?: string } | null | undefined,
  checklist: ChecklistLike[] = []
): WagonProgress {
  const stage = wagon?.currentStage;
  const currentStageIndex = stage ? (STAGE_ORDER as readonly string[]).indexOf(stage) : -1;

  /*
   * An unrecognised stage is shown as "not started" rather than being coerced
   * to stage zero. indexOf returns -1, and using that directly as a position
   * would make every stage look "future" — which is at least honest — whereas
   * quietly clamping it to 0 would assert the wagon is at entry registration
   * when the truth is that the stage is not understood.
   */
  const steps: StageStep[] = STAGE_ORDER.map((s, idx) => ({
    stage: s,
    index: idx,
    isPast: currentStageIndex >= 0 && idx < currentStageIndex,
    isCurrent: currentStageIndex >= 0 && idx === currentStageIndex,
    isFuture: currentStageIndex < 0 || idx > currentStageIndex
  }));

  return {
    currentStageIndex,
    // The stage is named RELEASE, not RELEASED. Both read naturally; only one
    // is correct, and the wrong one fails silently.
    isReleased: stage === 'RELEASE',
    isAtQcGate: stage === 'FINAL_QC_GATE',
    // An item with no status at all is pending: absent is not passed.
    pendingCount: checklist.filter((i) => !i.status || i.status === 'PENDING').length,
    completedStages: currentStageIndex < 0 ? 0 : currentStageIndex,
    steps
  };
}

/**
 * Whether a bulk clear may be offered, and why not when it may not.
 *
 * Bulk clear marks every remaining non-spring item PASS on one supervisor's
 * attestation. The server enforces the same minimum, so this exists to
 * explain the refusal rather than to be the protection.
 */
export function canBulkClear(
  attestation: string,
  pendingCount: number
): { allowed: boolean; reason?: string } {
  if (pendingCount === 0) {
    return { allowed: false, reason: 'There are no pending items to clear.' };
  }
  if (attestation.trim().length < 10) {
    return {
      allowed: false,
      reason:
        'Describe what you physically verified — at least ten characters. ' +
        'This attestation is recorded against every item it clears, in your name.'
    };
  }
  return { allowed: true };
}
