/**
 * Single Wagon Test (SWT) — Specification & Evaluation
 * Indian Railways WRS Raipur
 *
 * WHY THIS EXISTS
 * ---------------
 * The app covered the air brake system with two checklist line items — a
 * distributor valve and an air hose — against which an inspector could only
 * record PASS or FAIL. The manual devotes a chapter to it, and specifies a
 * complete test with numeric acceptance criteria for every reading.
 *
 * WMM 2.0 §720: "Single wagon test is also carried out after POH". So for a
 * workshop doing periodic overhaul, this is not optional and not a judgement
 * call — it is twelve measured values, each with a published limit, currently
 * written onto a paper proforma and signed.
 *
 * SOURCE
 * ------
 * Limits: WMM 2.0 §720-C, "Proforma for Single Wagon Test for wagons other
 * than BOBR & BOBRN (single pipe / twin pipe)".
 * Piston stroke: WMM 2.0 §308B, which is keyed by wagon type rather than being
 * a single figure — a BOXN and a BOY have different strokes, and using one
 * limit for both would fail good wagons and pass bad ones.
 *
 * Nothing here is inferred. Every limit is quoted, and a reading with no
 * published limit is reported as measured-but-unjudged rather than guessed at,
 * the same way the CTRB end cap is handled.
 */

export type PipeType = 'SINGLE' | 'TWIN';
export type LoadCondition = 'EMPTY' | 'LOADED';

export interface SwtLimit {
  /** Proforma row, as printed. */
  ref: string;
  label: string;
  labelHi: string;
  unit: 'kg/cm2' | 'sec' | 'mm';
  min?: number;
  max?: number;
  /** True when the check is observational rather than numeric. */
  observational?: boolean;
  /** What the observation must be, for observational checks. */
  expected?: string;
  source: string;
  /** Only applies to this pipe configuration, when set. */
  pipeType?: PipeType;
}

const SRC = 'WMM 2.0 §720-C';

/**
 * The proforma, in order. Kept as one ordered list because the test is
 * performed as a sequence and the inspector works down the sheet.
 */
export const SWT_CHECKS: SwtLimit[] = [
  { ref: '1', label: 'Pressure in BP', labelHi: 'बीपी दाब', unit: 'kg/cm2', min: 4.9, max: 5.1, source: SRC },
  { ref: '1a', label: 'Pressure in FP (twin pipe)', labelHi: 'एफपी दाब (ट्विन पाइप)', unit: 'kg/cm2', min: 5.9, max: 6.1, source: SRC, pipeType: 'TWIN' },
  { ref: '2', label: 'Pressure in AR (single pipe)', labelHi: 'एआर दाब (सिंगल पाइप)', unit: 'kg/cm2', min: 4.9, max: 5.1, source: SRC, pipeType: 'SINGLE' },
  { ref: '2a', label: 'Pressure in AR (twin pipe)', labelHi: 'एआर दाब (ट्विन पाइप)', unit: 'kg/cm2', min: 5.9, max: 6.1, source: SRC, pipeType: 'TWIN' },
  { ref: '3', label: 'Leakage after charging, in one minute', labelHi: 'चार्जिंग के बाद रिसाव (एक मिनट)', unit: 'kg/cm2', max: 0.1, source: SRC },
  { ref: '4.1', label: 'Full service: brake cylinder filling time (0 → 3.6)', labelHi: 'पूर्ण सेवा: ब्रेक सिलेंडर भरने का समय', unit: 'sec', min: 18, max: 30, source: SRC },
  { ref: '4.2', label: 'Full service: maximum brake cylinder pressure', labelHi: 'पूर्ण सेवा: अधिकतम ब्रेक सिलेंडर दाब', unit: 'kg/cm2', min: 3.7, max: 3.9, source: SRC },
  { ref: '4.3', label: 'BP reduction for full service application', labelHi: 'पूर्ण सेवा हेतु बीपी कमी', unit: 'kg/cm2', min: 1.3, max: 1.6, source: SRC },
  { ref: '5.1', label: 'Release: draining time (3.8 → 0.4)', labelHi: 'रिलीज़: निकासी समय', unit: 'sec', min: 45, max: 60, source: SRC },
  { ref: '6', label: 'Sensitivity: brakes apply within', labelHi: 'संवेदनशीलता: ब्रेक लगने का समय', unit: 'sec', max: 6, source: SRC },
  { ref: '7', label: 'Insensitivity: brakes must NOT apply', labelHi: 'असंवेदनशीलता: ब्रेक नहीं लगने चाहिए', unit: 'sec', observational: true, expected: 'Brakes do not apply', source: SRC },
  { ref: '8.1', label: 'Emergency: brake cylinder filling time (0 → 3.6)', labelHi: 'आपात: ब्रेक सिलेंडर भरने का समय', unit: 'sec', min: 18, max: 30, source: SRC },
  { ref: '8.2', label: 'Emergency: maximum brake cylinder pressure', labelHi: 'आपात: अधिकतम ब्रेक सिलेंडर दाब', unit: 'kg/cm2', min: 3.7, max: 3.9, source: SRC },
  { ref: '9', label: 'Piston stroke', labelHi: 'पिस्टन स्ट्रोक', unit: 'mm', source: 'WMM 2.0 §308B' },
  { ref: '10', label: 'Brake cylinder leakage after emergency, in five minutes', labelHi: 'आपात के बाद ब्रेक सिलेंडर रिसाव (पाँच मिनट)', unit: 'kg/cm2', max: 0.1, source: SRC },
  { ref: '12', label: 'Brake cylinder and control reservoir exhaust automatically', labelHi: 'ब्रेक सिलेंडर व नियंत्रण जलाशय स्वतः निकास', unit: 'kg/cm2', observational: true, expected: 'Exhausts automatically', source: SRC }
];

/**
 * Piston stroke, WMM 2.0 §308B — keyed by wagon type, not a single figure.
 *
 * The manual lists these by wagon designation, so the same lookup the spring
 * configuration uses applies here. A wagon not in this table has no published
 * stroke in §308B, and its stroke is recorded without a verdict rather than
 * judged against another wagon's limit.
 */
export const PISTON_STROKE_MM: Record<string, { empty: [number, number]; loaded: [number, number] | null }> = {
  BOXN: { empty: [75, 95], loaded: [120, 140] },
  BCN: { empty: [75, 95], loaded: [120, 140] },
  BCNA: { empty: [75, 95], loaded: [120, 140] },
  BRN: { empty: [75, 95], loaded: [120, 140] },
  BTPGLN: { empty: [75, 95], loaded: [120, 140] },
  BOXNHL: { empty: [75, 95], loaded: [110, 130] },
  BCNHL: { empty: [75, 95], loaded: [110, 130] },
  BTPN: { empty: [75, 95], loaded: [120, 140] },
  BOY: { empty: [80, 100], loaded: [125, 145] },
  BVZC: { empty: [60, 80], loaded: null },
  BOBRN: { empty: [90, 110], loaded: [100, 120] },
  BOBYN: { empty: [90, 110], loaded: [100, 120] },
  BLC: { empty: [85, 105], loaded: [110, 130] },
  BOSTHS: { empty: [75, 95], loaded: [120, 140] },
  BOBSN: { empty: [75, 95], loaded: [120, 140] }
};

export interface SwtReading {
  ref: string;
  /** Numeric reading, or null for an observational check. */
  value?: number | null;
  /** For observational checks: did the wagon behave as specified. */
  observed?: boolean;
}

export interface SwtCheckResult {
  ref: string;
  label: string;
  unit: string;
  value: number | null;
  observed?: boolean;
  /** null when no published limit applies — measured but not judged. */
  verdict: 'PASS' | 'FAIL' | null;
  specified: string;
  source: string;
  reason?: string;
}

export interface SwtEvaluation {
  pipeType: PipeType;
  loadCondition: LoadCondition;
  wagonType: string;
  results: SwtCheckResult[];
  passed: boolean;
  failedRefs: string[];
  unjudgedRefs: string[];
  missingRefs: string[];
}

/** Human-readable statement of what a check requires. */
function describeLimit(limit: SwtLimit, stroke?: [number, number] | null): string {
  if (limit.observational) return limit.expected || '—';
  if (limit.ref === '9') {
    return stroke ? `${stroke[0]}–${stroke[1]} ${limit.unit}` : 'no published limit for this wagon type';
  }
  if (limit.min !== undefined && limit.max !== undefined) return `${limit.min}–${limit.max} ${limit.unit}`;
  if (limit.max !== undefined) return `max ${limit.max} ${limit.unit}`;
  if (limit.min !== undefined) return `min ${limit.min} ${limit.unit}`;
  return '—';
}

/** The checks that apply to a given pipe configuration. */
export function checksFor(pipeType: PipeType): SwtLimit[] {
  return SWT_CHECKS.filter((c) => !c.pipeType || c.pipeType === pipeType);
}

/**
 * Evaluates a completed Single Wagon Test against the proforma.
 *
 * A check with no reading is reported as missing rather than passing — the
 * whole point of the proforma is that every row is answered. A check with a
 * reading but no published limit for that wagon is reported as unjudged, and
 * is not counted as a pass.
 */
export function evaluateSwt(input: {
  pipeType: PipeType;
  loadCondition: LoadCondition;
  wagonType: string;
  readings: SwtReading[];
}): SwtEvaluation {
  const applicable = checksFor(input.pipeType);
  const byRef = new Map(input.readings.map((r) => [r.ref, r]));
  const strokeSpec = PISTON_STROKE_MM[input.wagonType.toUpperCase().trim()];
  const stroke = strokeSpec
    ? input.loadCondition === 'EMPTY'
      ? strokeSpec.empty
      : strokeSpec.loaded
    : null;

  const results: SwtCheckResult[] = [];
  const failedRefs: string[] = [];
  const unjudgedRefs: string[] = [];
  const missingRefs: string[] = [];

  for (const limit of applicable) {
    const reading = byRef.get(limit.ref);
    const specified = describeLimit(limit, stroke);

    if (!reading || (reading.value === undefined && reading.observed === undefined)) {
      missingRefs.push(limit.ref);
      results.push({
        ref: limit.ref, label: limit.label, unit: limit.unit, value: null,
        verdict: null, specified, source: limit.source, reason: 'Not recorded.'
      });
      continue;
    }

    if (limit.observational) {
      const ok = reading.observed === true;
      if (!ok) failedRefs.push(limit.ref);
      results.push({
        ref: limit.ref, label: limit.label, unit: limit.unit, value: null,
        observed: reading.observed, verdict: ok ? 'PASS' : 'FAIL',
        specified, source: limit.source,
        reason: ok ? undefined : `Expected: ${limit.expected}.`
      });
      continue;
    }

    const value = Number(reading.value);
    if (!Number.isFinite(value)) {
      missingRefs.push(limit.ref);
      results.push({
        ref: limit.ref, label: limit.label, unit: limit.unit, value: null,
        verdict: null, specified, source: limit.source, reason: 'Not a valid reading.'
      });
      continue;
    }

    // Piston stroke is the one limit that depends on the wagon.
    const min = limit.ref === '9' ? stroke?.[0] : limit.min;
    const max = limit.ref === '9' ? stroke?.[1] : limit.max;

    if (min === undefined && max === undefined) {
      unjudgedRefs.push(limit.ref);
      results.push({
        ref: limit.ref, label: limit.label, unit: limit.unit, value,
        verdict: null, specified, source: limit.source,
        reason: `No published limit for ${input.wagonType} in ${limit.source} — recorded, not judged.`
      });
      continue;
    }

    const belowMin = min !== undefined && value < min;
    const aboveMax = max !== undefined && value > max;
    const ok = !belowMin && !aboveMax;
    if (!ok) failedRefs.push(limit.ref);

    results.push({
      ref: limit.ref, label: limit.label, unit: limit.unit, value,
      verdict: ok ? 'PASS' : 'FAIL', specified, source: limit.source,
      reason: ok ? undefined : `${value} ${limit.unit} is outside ${specified}.`
    });
  }

  return {
    pipeType: input.pipeType,
    loadCondition: input.loadCondition,
    wagonType: input.wagonType,
    results,
    // A test passes only when every applicable row is answered and within
    // limit. An unanswered row is not a pass, and neither is an unjudged one.
    passed: failedRefs.length === 0 && missingRefs.length === 0 && unjudgedRefs.length === 0,
    failedRefs,
    unjudgedRefs,
    missingRefs
  };
}
