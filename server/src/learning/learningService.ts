/**
 * Machine Learning Feedback Loop
 * Indian Railways WRS Raipur
 *
 * Closes the loop between what the machine proposed and what the human
 * actually committed, so the system measurably improves with use instead of
 * repeating the same mistakes forever.
 *
 * HOW THIS "LEARNS"
 * -----------------
 * Every machine judgement (OCR read, band classification, voice command,
 * acoustic call) is recorded alongside the human's final decision. From that
 * ledger the service derives:
 *
 *   1. Accuracy over time      — is the system actually getting better?
 *   2. Confidence calibration  — at what confidence does the machine stop
 *                                being trustworthy?
 *   3. Systematic weaknesses   — specific conditions where it reliably fails
 *   4. Tuning proposals        — concrete parameter changes, with evidence
 *
 * WHAT IT IS NOT
 * --------------
 * This does not retrain a neural network, and it never edits a safety limit.
 * RDSO band tables and condemning heights are regulation; they are not
 * parameters and nothing here may touch them. What adapts is operational
 * behaviour — chiefly when to stop trusting an OCR read and ask the inspector
 * to confirm it by hand.
 *
 * Every proposal requires a named human approval before it takes effect.
 * An unsupervised system that silently retunes itself around a safety
 * decision is precisely what a workshop should not deploy.
 */

import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export type LearningSubsystem =
  | 'OCR_CALIPER'
  | 'SPRING_CLASSIFICATION'
  | 'VOICE_COMMAND'
  | 'ACOUSTIC_DIAGNOSTIC'
  | 'DEFECT_SUGGESTION';

export interface RecordOutcomeInput {
  subsystem: LearningSubsystem;
  wagonNumber?: string | null;
  inspectionId?: string | null;
  machineOutput: unknown;
  machineConfidence?: number | null;
  humanOutput?: unknown;
  wasCorrected: boolean;
  correctionMagnitude?: number | null;
  context?: Record<string, unknown> | null;
  userId?: string | null;
  userRole?: string | null;
}

export interface SubsystemAccuracy {
  subsystem: LearningSubsystem;
  totalEvents: number;
  acceptedCount: number;
  correctedCount: number;
  /** Share of machine outputs the human accepted unchanged, 0.0 - 1.0. */
  acceptanceRate: number;
  meanCorrectionMagnitude: number | null;
  meanConfidence: number | null;
  /**
   * Acceptance rate over the most recent half of the sample minus the
   * earliest half. Positive means the system is improving.
   */
  trend: number | null;
  hasEnoughData: boolean;
}

export interface ConfidenceBucket {
  bucket: string;
  lowerBound: number;
  upperBound: number;
  total: number;
  corrected: number;
  acceptanceRate: number;
}

export interface LearningInsight {
  subsystem: LearningSubsystem;
  severity: 'INFO' | 'ACTIONABLE';
  title: string;
  detail: string;
  sampleSize: number;
  suggestedParamKey?: string;
  suggestedValue?: number;
}

/** Below this, any pattern is noise rather than a finding. */
export const MIN_SAMPLE_FOR_INSIGHT = 30;

/**
 * Operational parameters the loop is permitted to tune. Safety limits are
 * deliberately absent — see the module header.
 */
export const TUNABLE_PARAMETERS: {
  key: string;
  subsystem: LearningSubsystem;
  defaultValue: number;
  min: number;
  max: number;
  description: string;
}[] = [
  {
    key: 'ocr.manual_confirm_threshold',
    subsystem: 'OCR_CALIPER',
    defaultValue: 0.5,
    min: 0.3,
    max: 0.95,
    description:
      'OCR confidence below which the inspector is asked to confirm the reading by hand. ' +
      'Raising it trades a little speed for fewer wrong readings reaching the record.'
  },
  {
    key: 'acoustic.alert_threshold',
    subsystem: 'ACOUSTIC_DIAGNOSTIC',
    defaultValue: 0.6,
    min: 0.3,
    max: 0.95,
    description: 'Confidence above which an acoustic anomaly is raised to the inspector.'
  },
  {
    key: 'voice.match_threshold',
    subsystem: 'VOICE_COMMAND',
    defaultValue: 0.7,
    min: 0.4,
    max: 0.95,
    description: 'Fuzzy-match score below which a voice command asks for confirmation.'
  }
];

export class LearningService {
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  // -------------------------------------------------------------------------
  // Capture
  // -------------------------------------------------------------------------

  /** Records one machine judgement and the human's response to it. */
  public recordOutcome(input: RecordOutcomeInput): { id: string } {
    const id = `mle_${crypto.randomUUID()}`;

    this.db.prepare(`
      INSERT INTO machine_learning_events (
        id, subsystem, wagon_number, inspection_id,
        machine_output_json, machine_confidence,
        human_output_json, was_corrected, correction_magnitude,
        context_json, user_id, user_role, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.subsystem,
      input.wagonNumber ?? null,
      input.inspectionId ?? null,
      JSON.stringify(input.machineOutput ?? null),
      input.machineConfidence ?? null,
      input.humanOutput === undefined ? null : JSON.stringify(input.humanOutput),
      input.wasCorrected ? 1 : 0,
      input.correctionMagnitude ?? null,
      input.context ? JSON.stringify(input.context) : null,
      input.userId ?? null,
      input.userRole ?? null,
      new Date().toISOString()
    );

    return { id };
  }

  // -------------------------------------------------------------------------
  // Measure
  // -------------------------------------------------------------------------

  public getAccuracy(subsystem: LearningSubsystem, windowDays?: number): SubsystemAccuracy {
    const params: unknown[] = [subsystem];
    let windowClause = '';
    if (windowDays && windowDays > 0) {
      windowClause = ` AND created_at >= ?`;
      params.push(new Date(Date.now() - windowDays * 86400000).toISOString());
    }

    const rows = this.db.prepare(`
      SELECT was_corrected, correction_magnitude, machine_confidence, created_at
      FROM machine_learning_events
      WHERE subsystem = ?${windowClause}
      ORDER BY created_at ASC
    `).all(...(params as any[])) as any[];

    const totalEvents = rows.length;
    const correctedCount = rows.filter((r) => r.was_corrected === 1).length;
    const acceptedCount = totalEvents - correctedCount;

    const magnitudes = rows
      .map((r) => r.correction_magnitude)
      .filter((m): m is number => typeof m === 'number' && !Number.isNaN(m));
    const confidences = rows
      .map((r) => r.machine_confidence)
      .filter((c): c is number => typeof c === 'number' && !Number.isNaN(c));

    // Trend: compare acceptance in the earlier half against the later half.
    let trend: number | null = null;
    if (totalEvents >= MIN_SAMPLE_FOR_INSIGHT) {
      const mid = Math.floor(totalEvents / 2);
      const earlier = rows.slice(0, mid);
      const later = rows.slice(mid);
      const rate = (set: any[]) =>
        set.length === 0 ? 0 : set.filter((r) => r.was_corrected === 0).length / set.length;
      trend = Number((rate(later) - rate(earlier)).toFixed(4));
    }

    return {
      subsystem,
      totalEvents,
      acceptedCount,
      correctedCount,
      acceptanceRate: totalEvents === 0 ? 0 : Number((acceptedCount / totalEvents).toFixed(4)),
      meanCorrectionMagnitude:
        magnitudes.length === 0
          ? null
          : Number((magnitudes.reduce((a, b) => a + b, 0) / magnitudes.length).toFixed(3)),
      meanConfidence:
        confidences.length === 0
          ? null
          : Number((confidences.reduce((a, b) => a + b, 0) / confidences.length).toFixed(4)),
      trend,
      hasEnoughData: totalEvents >= MIN_SAMPLE_FOR_INSIGHT
    };
  }

  /**
   * Buckets outcomes by the machine's stated confidence. This is what reveals
   * whether the machine actually knows when it is unsure — a well-calibrated
   * system is corrected far more often in its low-confidence buckets.
   */
  public getConfidenceCalibration(subsystem: LearningSubsystem): ConfidenceBucket[] {
    const rows = this.db.prepare(`
      SELECT machine_confidence, was_corrected
      FROM machine_learning_events
      WHERE subsystem = ? AND machine_confidence IS NOT NULL
    `).all(subsystem) as any[];

    const edges = [0.0, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0001];
    const buckets: ConfidenceBucket[] = [];

    for (let i = 0; i < edges.length - 1; i++) {
      const lo = edges[i];
      const hi = edges[i + 1];
      const inBucket = rows.filter((r) => r.machine_confidence >= lo && r.machine_confidence < hi);
      const corrected = inBucket.filter((r) => r.was_corrected === 1).length;
      buckets.push({
        bucket: `${lo.toFixed(2)}–${Math.min(hi, 1).toFixed(2)}`,
        lowerBound: lo,
        upperBound: Math.min(hi, 1),
        total: inBucket.length,
        corrected,
        acceptanceRate:
          inBucket.length === 0 ? 0 : Number(((inBucket.length - corrected) / inBucket.length).toFixed(4))
      });
    }

    return buckets;
  }

  // -------------------------------------------------------------------------
  // Learn
  // -------------------------------------------------------------------------

  /**
   * Derives findings from the ledger. Only emits something when there is
   * enough evidence to justify it — an insight from six samples is a guess
   * wearing a lab coat.
   */
  public deriveInsights(): LearningInsight[] {
    const insights: LearningInsight[] = [];

    // --- OCR: find the confidence floor below which reads aren't trustworthy
    const ocrCal = this.getConfidenceCalibration('OCR_CALIPER');
    const ocrTotal = ocrCal.reduce((sum, b) => sum + b.total, 0);

    if (ocrTotal >= MIN_SAMPLE_FOR_INSIGHT) {
      // Lowest bucket boundary at which acceptance is still >= 90%.
      const reliable = ocrCal.filter((b) => b.total >= 10 && b.acceptanceRate >= 0.9);
      const unreliable = ocrCal.filter((b) => b.total >= 10 && b.acceptanceRate < 0.7);

      if (reliable.length > 0) {
        const floor = Math.min(...reliable.map((b) => b.lowerBound));
        const current = this.getParameter('ocr.manual_confirm_threshold');
        if (current !== null && Math.abs(floor - current) >= 0.05) {
          insights.push({
            subsystem: 'OCR_CALIPER',
            severity: 'ACTIONABLE',
            title: `OCR reads are reliable only above ${floor.toFixed(2)} confidence`,
            detail:
              `Across ${ocrTotal} recorded reads, inspectors accepted at least 90% of OCR values ` +
              `above ${floor.toFixed(2)} confidence. The manual-confirmation threshold is currently ` +
              `${current.toFixed(2)}. Moving it to ${floor.toFixed(2)} would ask for confirmation ` +
              `on the reads that actually get corrected, and stop interrupting on the ones that don't.`,
            sampleSize: ocrTotal,
            suggestedParamKey: 'ocr.manual_confirm_threshold',
            suggestedValue: Number(floor.toFixed(2))
          });
        }
      }

      for (const b of unreliable) {
        insights.push({
          subsystem: 'OCR_CALIPER',
          severity: 'INFO',
          title: `OCR is unreliable in the ${b.bucket} confidence band`,
          detail:
            `${b.corrected} of ${b.total} reads in this band were corrected by hand ` +
            `(${((1 - b.acceptanceRate) * 100).toFixed(0)}%). Readings here should not be ` +
            `written to the record without confirmation.`,
          sampleSize: b.total
        });
      }
    }

    // --- Systematic weakness by context (e.g. one component target or device)
    for (const subsystem of ['OCR_CALIPER', 'ACOUSTIC_DIAGNOSTIC'] as LearningSubsystem[]) {
      const contextRows = this.db.prepare(`
        SELECT context_json, was_corrected FROM machine_learning_events
        WHERE subsystem = ? AND context_json IS NOT NULL
      `).all(subsystem) as any[];

      if (contextRows.length < MIN_SAMPLE_FOR_INSIGHT) continue;

      const byKey = new Map<string, { total: number; corrected: number }>();
      for (const row of contextRows) {
        let ctx: Record<string, unknown>;
        try {
          ctx = JSON.parse(row.context_json);
        } catch {
          continue;
        }
        for (const [k, v] of Object.entries(ctx)) {
          if (v === null || v === undefined || typeof v === 'object') continue;
          const key = `${k}=${String(v)}`;
          const acc = byKey.get(key) || { total: 0, corrected: 0 };
          acc.total++;
          if (row.was_corrected === 1) acc.corrected++;
          byKey.set(key, acc);
        }
      }

      const overallRate =
        contextRows.filter((r) => r.was_corrected === 1).length / contextRows.length;

      for (const [key, stat] of byKey) {
        if (stat.total < 15) continue;
        const rate = stat.corrected / stat.total;
        // Flag conditions materially worse than the subsystem's own average.
        if (rate > overallRate + 0.2) {
          insights.push({
            subsystem,
            severity: 'ACTIONABLE',
            title: `Higher error rate when ${key}`,
            detail:
              `${(rate * 100).toFixed(0)}% of readings with ${key} were corrected, against ` +
              `${(overallRate * 100).toFixed(0)}% overall across ${contextRows.length} samples. ` +
              `This condition is a systematic weak point worth addressing directly.`,
            sampleSize: stat.total
          });
        }
      }
    }

    return insights;
  }

  /**
   * Writes derived insights into learned_parameters as PENDING proposals.
   * Nothing takes effect until a human approves it.
   */
  public generateProposals(): { proposed: number } {
    const insights = this.deriveInsights().filter(
      (i) => i.suggestedParamKey && typeof i.suggestedValue === 'number'
    );

    let proposed = 0;
    for (const insight of insights) {
      const spec = TUNABLE_PARAMETERS.find((p) => p.key === insight.suggestedParamKey);
      if (!spec) continue;

      const value = Math.min(spec.max, Math.max(spec.min, insight.suggestedValue!));
      const existing = this.db
        .prepare('SELECT id, current_value FROM learned_parameters WHERE param_key = ?')
        .get(spec.key) as any;
      if (!existing) continue;
      if (Math.abs(existing.current_value - value) < 0.01) continue;

      this.db.prepare(`
        UPDATE learned_parameters
        SET proposed_value = ?, proposal_rationale = ?, proposal_sample_size = ?,
            proposed_at = ?, approval_status = 'PENDING', updated_at = ?
        WHERE param_key = ?
      `).run(
        value,
        insight.detail,
        insight.sampleSize,
        new Date().toISOString(),
        new Date().toISOString(),
        spec.key
      );
      proposed++;
    }

    return { proposed };
  }

  // -------------------------------------------------------------------------
  // Parameters
  // -------------------------------------------------------------------------

  /** Seeds the tunable parameter rows at their safe defaults. Idempotent. */
  public ensureParameters(): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO learned_parameters (
        id, param_key, subsystem, current_value, default_value,
        min_allowed, max_allowed, description, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const now = new Date().toISOString();
    for (const p of TUNABLE_PARAMETERS) {
      stmt.run(
        `lp_${p.key.replace(/[^a-zA-Z0-9]/g, '_')}`,
        p.key,
        p.subsystem,
        p.defaultValue,
        p.defaultValue,
        p.min,
        p.max,
        p.description,
        now
      );
    }
  }

  public getParameter(paramKey: string): number | null {
    const row = this.db
      .prepare('SELECT current_value FROM learned_parameters WHERE param_key = ?')
      .get(paramKey) as any;
    return row ? row.current_value : null;
  }

  public listParameters(): any[] {
    return this.db
      .prepare('SELECT * FROM learned_parameters ORDER BY subsystem, param_key')
      .all() as any[];
  }

  /**
   * Applies or rejects a pending proposal. Requires a real user id — a
   * parameter change that affects inspection behaviour must be attributable.
   */
  public decideProposal(
    paramKey: string,
    decision: 'APPROVE' | 'REJECT',
    userId: string
  ): any {
    const row = this.db
      .prepare('SELECT * FROM learned_parameters WHERE param_key = ?')
      .get(paramKey) as any;

    if (!row) {
      const err: any = new Error(`Unknown parameter "${paramKey}".`);
      err.name = 'ValidationError';
      throw err;
    }
    if (row.approval_status !== 'PENDING' || row.proposed_value === null) {
      const err: any = new Error(`Parameter "${paramKey}" has no pending proposal to decide.`);
      err.name = 'ValidationError';
      throw err;
    }

    const now = new Date().toISOString();

    if (decision === 'APPROVE') {
      const clamped = Math.min(row.max_allowed, Math.max(row.min_allowed, row.proposed_value));
      this.db.prepare(`
        UPDATE learned_parameters
        SET current_value = ?, approval_status = 'APPROVED', approved_by = ?, approved_at = ?,
            proposed_value = NULL, updated_at = ?
        WHERE param_key = ?
      `).run(clamped, userId, now, now, paramKey);
    } else {
      this.db.prepare(`
        UPDATE learned_parameters
        SET approval_status = 'REJECTED', approved_by = ?, approved_at = ?,
            proposed_value = NULL, updated_at = ?
        WHERE param_key = ?
      `).run(userId, now, now, paramKey);
    }

    return this.db.prepare('SELECT * FROM learned_parameters WHERE param_key = ?').get(paramKey);
  }

  /** Everything the "what has the system learned" view needs, in one call. */
  public getDashboard(): Record<string, unknown> {
    const subsystems: LearningSubsystem[] = [
      'OCR_CALIPER',
      'SPRING_CLASSIFICATION',
      'VOICE_COMMAND',
      'ACOUSTIC_DIAGNOSTIC',
      'DEFECT_SUGGESTION'
    ];

    return {
      accuracy: subsystems.map((s) => this.getAccuracy(s)),
      accuracyLast30Days: subsystems.map((s) => this.getAccuracy(s, 30)),
      ocrCalibration: this.getConfidenceCalibration('OCR_CALIPER'),
      insights: this.deriveInsights(),
      parameters: this.listParameters(),
      minSampleForInsight: MIN_SAMPLE_FOR_INSIGHT
    };
  }
}
