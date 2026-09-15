/**
 * Reading the shadow-mode log — the decision, as arithmetic
 * Indian Railways WRS Raipur
 *
 * docs/SHADOW_MODE_ROLLOUT.md says what ends shadow mode: not a feeling, but
 * these numbers. This turns the discrepancy log and the daily summaries into
 * the same verdict a supervisor and the DRM would reach reading them at the
 * end of the week, so the screen can show it and the export can carry it.
 *
 * The one non-negotiable is the first rule: a case where the app said PASS
 * and the register condemned is a blocker on its own, however few there are.
 * Everything else is a count with a denominator, because "most amber boxes
 * answered" is a statement about a fraction, and a fraction needs both halves.
 */

export type WhoWasRight = 'APP' | 'REGISTER' | 'BOTH_WRONG' | 'UNRESOLVED';
export type DiscrepancyCause =
  | 'BAND_MISREAD'
  | 'WRONG_SPRING'
  | 'OFF_STRIP_JUDGEMENT'
  | 'CONFIGURATION'
  | 'NEST_GROUPING'
  | 'APP_COULD_NOT_ANSWER'
  | 'DEVICE'
  | 'OTHER';
export type VerdictWord = 'PASS' | 'CONDEMNED' | 'OTHER';

export const WHO_WAS_RIGHT: readonly WhoWasRight[] = ['APP', 'REGISTER', 'BOTH_WRONG', 'UNRESOLVED'] as const;
export const DISCREPANCY_CAUSES: readonly DiscrepancyCause[] = [
  'BAND_MISREAD', 'WRONG_SPRING', 'OFF_STRIP_JUDGEMENT', 'CONFIGURATION', 'NEST_GROUPING', 'APP_COULD_NOT_ANSWER', 'DEVICE', 'OTHER'
] as const;
export const VERDICT_WORDS: readonly VerdictWord[] = ['PASS', 'CONDEMNED', 'OTHER'] as const;

export interface DiscrepancyRow {
  occurredOn: string;           // YYYY-MM-DD
  registerVerdict: VerdictWord;
  appVerdict: VerdictWord;
  whoWasRight: WhoWasRight;
  cause: DiscrepancyCause;
  wouldHaveStoppedAWagon: boolean;
}

export interface AmberBoxFigures {
  raised: number;
  reMeasured: number;
  stands: number;
  unanswered: number;
}

export interface DailySummaryRow {
  summaryDate: string;
  transcriptionErrorsBoxMissed: number;
  registerMinutesOneWagon: number | null;
  appMinutesOneWagon: number | null;
}

export interface ShadowVerdict {
  /** The rule that is not negotiable. Any one of these blocks going live. */
  appPassedRegisterCondemned: number;
  blocking: boolean;
  discrepancies: { total: number; appRight: number; registerRight: number; bothWrong: number; unresolved: number; byCause: Record<DiscrepancyCause, number>; wouldHaveStoppedAWagon: number };
  /** Week on week: discrepancies in the latest seven days against the seven before. */
  trend: { latest7: number; previous7: number; falling: boolean | null };
  amber: AmberBoxFigures & { answeredShare: number | null; falseAlarmShare: number | null };
  transcriptionErrorsBoxMissed: number;
  /** Paired timings — one wagon, both ways, on the same day. */
  timing: { pairs: number; medianRegisterMinutes: number | null; medianAppMinutes: number | null; note: string };
  unansweredCouldNotAnswer: number;
  findings: string[];
}

const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);

export function shadowVerdict(
  rows: DiscrepancyRow[],
  amber: AmberBoxFigures,
  summaries: DailySummaryRow[],
  today = new Date().toISOString().slice(0, 10)
): ShadowVerdict {
  const appPassedRegisterCondemned = rows.filter((r) => r.appVerdict === 'PASS' && r.registerVerdict === 'CONDEMNED').length;
  const byCause = Object.fromEntries(DISCREPANCY_CAUSES.map((c) => [c, 0])) as Record<DiscrepancyCause, number>;
  for (const r of rows) byCause[r.cause] = (byCause[r.cause] || 0) + 1;

  const dayDiff = (d: string) => Math.floor((Date.parse(today) - Date.parse(d)) / 86400_000);
  const latest7 = rows.filter((r) => dayDiff(r.occurredOn) < 7).length;
  const previous7 = rows.filter((r) => dayDiff(r.occurredOn) >= 7 && dayDiff(r.occurredOn) < 14).length;

  const answered = amber.reMeasured + amber.stands;
  const answeredShare = amber.raised > 0 ? answered / amber.raised : null;
  const falseAlarmShare = answered > 0 ? amber.stands / answered : null;

  const pairs = summaries.filter((s) => s.registerMinutesOneWagon != null && s.appMinutesOneWagon != null);
  const transcriptionErrorsBoxMissed = summaries.reduce((a, s) => a + (s.transcriptionErrorsBoxMissed || 0), 0);
  const unansweredCouldNotAnswer = rows.filter((r) => r.cause === 'APP_COULD_NOT_ANSWER' && r.whoWasRight === 'UNRESOLVED').length;

  const findings: string[] = [];
  if (appPassedRegisterCondemned > 0) {
    findings.push(`${appPassedRegisterCondemned} case(s) where the app said PASS and the register condemned. This alone blocks going live — the app being under-cautious is the thing that must never happen.`);
  }
  if (previous7 > 0 && latest7 > previous7) findings.push(`Discrepancies rose week on week (${previous7} → ${latest7}). Expect them to fall, with the residue explained.`);
  if (amber.raised >= 10 && answeredShare !== null && answeredShare < 0.5) {
    findings.push(`Only ${Math.round(answeredShare * 100)}% of amber boxes were answered. An advisory nobody answers is an advisory nobody reads — a finding about where the box appears, not about the inspectors.`);
  }
  if (transcriptionErrorsBoxMissed >= 3) findings.push(`${transcriptionErrorsBoxMissed} transcription error(s) the paper diff caught that the amber box did not. One is expected; a pattern means the threshold is too loose.`);
  if (unansweredCouldNotAnswer > 0) findings.push(`${unansweredCouldNotAnswer} "app could not answer" case(s) neither fixed nor written down as an accepted limitation.`);
  if (pairs.length > 0 && pairs.length < 5) findings.push(`${pairs.length} paired timing(s). Enough to notice a large difference, not enough to defend a precise one — say so rather than report a figure the sample cannot carry.`);

  return {
    appPassedRegisterCondemned,
    blocking: appPassedRegisterCondemned > 0,
    discrepancies: {
      total: rows.length,
      appRight: rows.filter((r) => r.whoWasRight === 'APP').length,
      registerRight: rows.filter((r) => r.whoWasRight === 'REGISTER').length,
      bothWrong: rows.filter((r) => r.whoWasRight === 'BOTH_WRONG').length,
      unresolved: rows.filter((r) => r.whoWasRight === 'UNRESOLVED').length,
      byCause,
      wouldHaveStoppedAWagon: rows.filter((r) => r.wouldHaveStoppedAWagon).length
    },
    trend: { latest7, previous7, falling: previous7 === 0 ? null : latest7 < previous7 },
    amber: { ...amber, answeredShare, falseAlarmShare },
    transcriptionErrorsBoxMissed,
    timing: {
      pairs: pairs.length,
      medianRegisterMinutes: median(pairs.map((p) => p.registerMinutesOneWagon!)),
      medianAppMinutes: median(pairs.map((p) => p.appMinutesOneWagon!)),
      note: pairs.length === 0
        ? 'No paired timing yet. Time one wagon on the register each day; the app\'s minutes come from its own timestamps.'
        : pairs.length < 5
          ? `${pairs.length} paired observation(s) — a large difference is visible, a precise one is not.`
          : `${pairs.length} paired observations.`
    },
    unansweredCouldNotAnswer,
    findings
  };
}
