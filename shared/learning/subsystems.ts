/**
 * What the system keeps a learning record about
 * Indian Railways WRS Raipur
 *
 * WHY THIS IS IN shared/ RATHER THAN THE SERVICE
 * ----------------------------------------------
 * This vocabulary had reached four copies: the CHECK constraint on
 * machine_learning_events, the union in learningService.ts, the label map on
 * the learning dashboard, and a hand-written duplicate in the client's API
 * method. Adding a subsystem meant remembering all four, and twice it was not
 * remembered — once the database refused every write the anomaly check made,
 * silently, because the constraint had not been widened with the union.
 *
 * So the list lives here, imported by both sides. The database CHECK remains
 * the outer authority and a migration is still what changes it; this array
 * must match it, and the tests assert that they agree.
 */

export const ALL_LEARNING_SUBSYSTEMS = [
  /** Reading a measurement off a digital caliper display. */
  'OCR_CALIPER',
  /** Judging a spring against the RDSO band tables. */
  'SPRING_CLASSIFICATION',
  /** Hands-free checklist entry. */
  'VOICE_COMMAND',
  /** Bearing knock and air leak detection from sound. */
  'ACOUSTIC_DIAGNOSTIC',
  /** Which defect types to offer first. */
  'DEFECT_SUGGESTION',
  /*
   * Readings the anomaly check questioned, and what the inspector did next.
   *
   * The ledger that matters most, because every free height in this system is
   * hand-entered and always will be — so this is the only running measure of
   * how often that goes wrong.
   *
   * An "acceptance" here reads backwards from the others. Elsewhere the
   * machine proposes and the human accepts, so acceptance means the machine
   * was right. Here the machine only asks a question, and the human answering
   * "the reading stands" means the question was unnecessary. wasCorrected is
   * therefore true when the inspector re-measured and changed the value —
   * which is the flag having done its job.
   */
  'MEASUREMENT_ANOMALY',
  /*
   * Reading the eleven stencilled digits off a wagon, and whether the
   * supervisor kept what was read.
   *
   * This one has an unusually honest teacher. The number carries a check
   * digit (WMM 2.0 §417), so a misread is normally detectable at the moment
   * it happens rather than months later, and the supervisor's correction is
   * ground truth rather than an opinion.
   */
  'WAGON_NUMBER_OCR'
] as const;

export type LearningSubsystem = (typeof ALL_LEARNING_SUBSYSTEMS)[number];

/** Shown to a person. The dashboard reads these rather than keeping its own. */
export const SUBSYSTEM_LABELS: Record<LearningSubsystem, string> = {
  OCR_CALIPER: 'Caliper OCR',
  SPRING_CLASSIFICATION: 'Spring Classification',
  VOICE_COMMAND: 'Voice Commands',
  ACOUSTIC_DIAGNOSTIC: 'Acoustic Diagnostics',
  DEFECT_SUGGESTION: 'Defect Suggestions',
  MEASUREMENT_ANOMALY: 'Unusual Readings',
  WAGON_NUMBER_OCR: 'Wagon Number from Photograph'
};
