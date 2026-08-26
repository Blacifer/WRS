/**
 * What the exit gate panel says
 * Indian Railways WRS Raipur
 *
 * WHY THIS IS NOT IN THE COMPONENT
 * --------------------------------
 * This is the screen a supervisor reads before deciding whether a wagon may
 * leave the shop. The four tier readings on it are the summary of that
 * decision, and they were computed inline inside a 2,200-line component,
 * where nothing could test them and a wrong comparison would simply render.
 *
 * The stakes are lopsided in the usual direction: a panel that says BLOCKED
 * when the wagon is fine costs somebody a phone call, and a panel that says
 * CLEARED when it is not is how an unsafe wagon leaves. So the rule here is
 * that anything uncertain reads as not-satisfied — a missing summary field
 * is treated as "not known to be clear", never as clear.
 *
 * The server remains the authority. It refuses the sign-off regardless of
 * what this renders; this exists so the screen agrees with that refusal
 * rather than contradicting it.
 */

/** The stage at which a wagon has reached the release gate. */
export const GATE_STAGES = ['FINAL_QC_GATE', 'RELEASE'] as const;

export interface GateTier {
  /** Which of the four release rules this is. */
  rule: 1 | 2 | 3 | 4;
  /** The reading to show. */
  value: string;
  /** Whether this tier is satisfied. Drives the colour, not just the text. */
  satisfied: boolean;
}

export interface GatePanelReading {
  /** The headline. True only when the server says so. */
  canRelease: boolean;
  /** Banner text — the one thing read from across a room. */
  headline: 'ZERO-DEFECT CLEARED' | 'RELEASE BLOCKED';
  tiers: GateTier[];
  blockerCount: number;
  /** Advisories that must be acknowledged before sign-off is offered. */
  unacknowledgedAdvisories: number;
  /** Whether the sign-off button should be offered at all. */
  offerSignoff: boolean;
}

/**
 * Turns the server's gate status into what the panel shows.
 *
 * `gateStatus` is deliberately typed loosely: it comes off the wire, and
 * pretending otherwise would push the missing-field handling into a cast
 * rather than into the code where it is actually decided.
 */
export function readGatePanel(
  gateStatus: any,
  wagon: { currentStage?: string } | null | undefined,
  options: { isReleased?: boolean; acknowledgedAdvisoryIds?: string[] } = {}
): GatePanelReading {
  const summary = gateStatus?.summary ?? {};

  // Only the server's own verdict may say a wagon can go. Anything absent or
  // malformed is not a release.
  const canRelease = gateStatus?.canRelease === true;

  const passed = Number(summary.passedMandatory ?? 0);
  const totalMandatory = Number(summary.totalMandatory ?? 0);
  const unaddressedCondemned = Number(summary.unaddressedCondemned ?? 0);
  const hasCondemnedSprings = summary.springCheck?.hasCondemnedSprings === true;
  const stage = wagon?.currentStage;
  const stageReached = GATE_STAGES.includes(stage as any);

  const tiers: GateTier[] = [
    {
      rule: 1,
      value: `${passed} / ${totalMandatory} Passed`,
      // Zero of zero is not a pass. An empty checklist means the template
      // never loaded, and rendering that as satisfied would be the most
      // dangerous possible reading of a missing checklist.
      satisfied: totalMandatory > 0 && passed >= totalMandatory
    },
    {
      rule: 2,
      value: `${unaddressedCondemned} Unresolved`,
      satisfied: unaddressedCondemned === 0
    },
    {
      rule: 3,
      value: hasCondemnedSprings ? '⚠️ CONDEMNED' : '✓ CLEAR',
      satisfied: !hasCondemnedSprings
    },
    {
      rule: 4,
      value: stageReached ? '✓ REACHED' : `STAGE ${stage ?? 'UNKNOWN'}`,
      satisfied: stageReached
    }
  ];

  const advisories: any[] = Array.isArray(gateStatus?.advisoryDetails)
    ? gateStatus.advisoryDetails
    : [];
  const acknowledged = new Set(options.acknowledgedAdvisoryIds ?? []);
  const unacknowledgedAdvisories = advisories.filter((a) => !acknowledged.has(a?.id)).length;

  return {
    canRelease,
    headline: canRelease ? 'ZERO-DEFECT CLEARED' : 'RELEASE BLOCKED',
    tiers,
    blockerCount: Array.isArray(gateStatus?.blockers) ? gateStatus.blockers.length : 0,
    unacknowledgedAdvisories,
    // Never offer sign-off for a wagon already released — a second signature
    // on the same wagon is a record nobody can explain afterwards.
    offerSignoff: canRelease && options.isReleased !== true
  };
}
