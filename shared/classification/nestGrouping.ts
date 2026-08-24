/**
 * RDSO Spring Nest Grouping / Segregation Validator
 * Indian Railways WRS Raipur
 *
 * Source rule — RDSO Wagon Maintenance Manual 2.0, stated in three places
 * (Ch.6 suspension notes, the CASNUB spring group tables, and the
 * "Grouping of Springs (By strip method)" section):
 *
 *   "Matching of both, load and snubber springs, is important. It is
 *    recommended that springs having not more than 3 mm free height
 *    variation should be assembled in the same group."
 *   "Mixing of new and old springs must be avoided."
 *
 * This is precisely why the G-95 band tables (Tables 28-33) step in 3 mm
 * increments — one band IS one assembly group. A nest of six springs that
 * each individually PASS can still be an unsafe assembly if their heights
 * are spread across more than 3 mm, because the load will not share evenly
 * across the nest.
 *
 * The existing exit gate checks springs individually for condemnation. This
 * module adds the missing set-level check.
 */

import type { SpringCondition, SpringPosition } from '../types.ts';

/** Maximum permitted free-height spread within one assembly group (mm). */
export const MAX_NEST_HEIGHT_VARIATION_MM = 3.0;

export const NEST_RULE_REFERENCE =
  'RDSO Wagon Maintenance Manual 2.0 — "springs having not more than 3 mm free height variation should be assembled in the same group"';

/**
 * Why a defective spring is never repaired.
 *
 * WMM 2.0's bogie overhaul list is explicit, and the contrast within a single
 * numbered list settles it: item 2 reads "Replace cracked/Broken springs"
 * while item 3, two lines below, reads "Repair cracks/welding failures of
 * SSB/DSB". The manual distinguishes the two deliberately, and describes no
 * spring reconditioning process anywhere.
 *
 * Worth stating in the interface: when a spring is condemned for a visible
 * crack rather than lost height, "could this be welded?" is a reasonable
 * question, and the answer needs to be traceable rather than assumed.
 */
export const SPRING_REPLACE_NOT_REPAIR_REFERENCE =
  'RDSO Wagon Maintenance Manual 2.0, bogie overhaul schedule — "Replace cracked/Broken springs" (the same list specifies repair, not replacement, for SSB/DSB weld failures)';

export interface NestSpringInput {
  id: string;
  springPosition: SpringPosition;
  /**
   * Which bogie the spring belongs to. A nest lives on one bogie, so two
   * bogies on the same wagon are separate groups and may legitimately carry
   * different bands.
   */
  bogiePosition?: string | null;
  condition: SpringCondition;
  measuredFreeHeight: number;
  classifiedBand?: string | null;
  status?: string;
  /**
   * True when the height is a band midpoint recorded via the strip, not a
   * number anyone measured. Arithmetic that treats it as exact is unsound —
   * see getReplacementGuidance.
   */
  heightIsApproximate?: boolean;
}

export type NestViolationType = 'HEIGHT_VARIATION_EXCEEDED' | 'NEW_OLD_MIXED' | 'BAND_MIXED';

export interface NestViolation {
  type: NestViolationType;
  /** Grouping key these springs were assessed as, e.g. "OUTER". */
  groupKey: string;
  springPosition: SpringPosition;
  message: string;
  springIds: string[];
  /** Present for HEIGHT_VARIATION_EXCEEDED. */
  variationMm?: number;
  minHeight?: number;
  maxHeight?: number;
  /** Present for NEW_OLD_MIXED. */
  conditionsFound?: SpringCondition[];
  /** Present for BAND_MIXED. */
  bandsFound?: string[];
}

export interface NestGroupSummary {
  groupKey: string;
  springPosition: SpringPosition;
  springCount: number;
  minHeight: number;
  maxHeight: number;
  variationMm: number;
  conditionsFound: SpringCondition[];
  bandsFound: string[];
  isMatched: boolean;
}

export interface NestValidationResult {
  isValid: boolean;
  violations: NestViolation[];
  groups: NestGroupSummary[];
  ruleReference: string;
  maxVariationMm: number;
}

/**
 * Snubber(O) and Snubber(I) are separate physical positions on RFT bogies
 * but share identical tolerance tables. They are kept as distinct groups
 * here — an outer snubber and an inner snubber are not interchangeable
 * members of one nest.
 *
 * A nest is also bounded by its bogie: the twelve outer springs on bogie 1
 * are one assembly group, and bogie 2's twelve are another. Grouping across
 * both would flag a wagon whose bogies are each internally matched to
 * different bands — which is perfectly acceptable, since they are never
 * assembled together. Records predating per-spring indexing carry no bogie,
 * and fall back to the older wagon-wide grouping rather than being dropped.
 */
function groupKeyFor(spring: NestSpringInput): string {
  return spring.bogiePosition
    ? `${spring.bogiePosition} ${spring.springPosition}`
    : spring.springPosition;
}

/**
 * Validates that springs destined for the same nest form a matched set.
 *
 * Springs are grouped by position (outer springs are compared against other
 * outer springs, and so on). Condemned springs are excluded: they are
 * already blocked by the gate's per-spring check and must be replaced, so
 * including them would produce a duplicate, confusing blocker.
 *
 * Springs are grouped per bogie+position, which is what a nest physically is.
 * Records written before per-spring indexing carry no bogie and fall back to
 * wagon-wide grouping: the stricter reading, which can over-report on an old
 * record but never mask a genuine mismatch.
 */
export function validateSpringNests(springs: NestSpringInput[]): NestValidationResult {
  const violations: NestViolation[] = [];
  const groups: NestGroupSummary[] = [];

  const serviceable = springs.filter((s) => s.status !== 'CONDEMNED');

  const byGroup = new Map<string, NestSpringInput[]>();
  for (const spring of serviceable) {
    const key = groupKeyFor(spring);
    const bucket = byGroup.get(key);
    if (bucket) bucket.push(spring);
    else byGroup.set(key, [spring]);
  }

  for (const [groupKey, members] of byGroup) {
    // A single spring is trivially a matched set.
    if (members.length < 2) {
      if (members.length === 1) {
        groups.push({
          groupKey,
          springPosition: members[0].springPosition,
          springCount: 1,
          minHeight: members[0].measuredFreeHeight,
          maxHeight: members[0].measuredFreeHeight,
          variationMm: 0,
          conditionsFound: [members[0].condition],
          bandsFound: members[0].classifiedBand ? [members[0].classifiedBand] : [],
          isMatched: true
        });
      }
      continue;
    }

    const heights = members.map((m) => m.measuredFreeHeight);
    const minHeight = Math.min(...heights);
    const maxHeight = Math.max(...heights);
    const variationMm = Number((maxHeight - minHeight).toFixed(2));

    const conditionsFound = [...new Set(members.map((m) => m.condition))] as SpringCondition[];
    const bandsFound = [...new Set(members.map((m) => m.classifiedBand).filter(Boolean))] as string[];

    let isMatched = true;

    // Rule 1 — free height variation within the group.
    if (variationMm > MAX_NEST_HEIGHT_VARIATION_MM) {
      isMatched = false;
      violations.push({
        type: 'HEIGHT_VARIATION_EXCEEDED',
        groupKey,
        springPosition: members[0].springPosition,
        message:
          `${groupKey} spring group has ${variationMm.toFixed(2)} mm free-height variation ` +
          `(${minHeight.toFixed(1)}–${maxHeight.toFixed(1)} mm) across ${members.length} springs, ` +
          `exceeding the ${MAX_NEST_HEIGHT_VARIATION_MM.toFixed(0)} mm limit for springs assembled in the same group. ` +
          `Re-group so all ${groupKey.toLowerCase()} springs in a nest fall within one 3 mm band.`,
        springIds: members.map((m) => m.id),
        variationMm,
        minHeight,
        maxHeight
      });
    }

    // Rule 2 — springs recorded off the strip must all carry the same band.
    //
    // This check exists because the height arithmetic above cannot see the
    // fault when heights are approximate. A band-entered spring stores its
    // band's midpoint, and adjacent midpoints are exactly 3 mm apart — so a
    // nest of six GREEN and six BLUE springs computes a 3.00 mm variation and
    // passes, while the real springs could be 257 mm and 263 mm: 6 mm apart,
    // double the limit. The band is what was actually observed, so when the
    // heights are approximate the band is what must be checked.
    //
    // Measured nests are deliberately left to the height rule. Two genuinely
    // measured springs either side of a band boundary (259.5 and 260.5) are
    // 1 mm apart and perfectly matched; failing them would be wrong.
    const approximateMembers = members.filter((m) => m.heightIsApproximate);
    if (approximateMembers.length > 0 && bandsFound.length > 1) {
      isMatched = false;
      violations.push({
        type: 'BAND_MIXED',
        groupKey,
        springPosition: members[0].springPosition,
        message:
          `${groupKey} spring group mixes ${bandsFound.length} bands (${bandsFound.join(', ')}). ` +
          `Springs recorded off the strip are known only to their band, and two different ` +
          `bands can be up to ${(MAX_NEST_HEIGHT_VARIATION_MM * 2).toFixed(0)} mm apart in free height. ` +
          `All springs in one nest must come from a single band.`,
        springIds: members.map((m) => m.id),
        bandsFound
      });
    }

    // Rule 3 — new and used springs must not share a group.
    if (conditionsFound.length > 1) {
      isMatched = false;
      violations.push({
        type: 'NEW_OLD_MIXED',
        groupKey,
        springPosition: members[0].springPosition,
        message:
          `${groupKey} spring group mixes NEW and USED springs. ` +
          `Mixing new and old springs in the same group must be avoided — ` +
          `they settle at different rates and will not share load evenly.`,
        springIds: members.map((m) => m.id),
        conditionsFound
      });
    }

    groups.push({
      groupKey,
      springPosition: members[0].springPosition,
      springCount: members.length,
      minHeight,
      maxHeight,
      variationMm,
      conditionsFound,
      bandsFound,
      isMatched
    });
  }

  return {
    isValid: violations.length === 0,
    violations,
    groups,
    ruleReference: NEST_RULE_REFERENCE,
    maxVariationMm: MAX_NEST_HEIGHT_VARIATION_MM
  };
}

// ---------------------------------------------------------------------------
// Replacement guidance
// ---------------------------------------------------------------------------

export interface ReplacementGuidance {
  /** What the inspector must do with the condemned spring. */
  action: 'REPLACE';
  /** Free-height window the replacement must fall in to keep the nest matched. */
  targetRange: { min: number; max: number } | null;
  /** Band the replacement should carry, when the nest already defines one. */
  targetBand: string | null;
  /** Plain-language instruction, ready to show. */
  message: string;
  /** Heights of the springs already measured in this nest, for context. */
  nestHeights: number[];
  reference: string;
}

/**
 * Replacement guidance for a nest recorded by band rather than by measurement.
 *
 * The rule is simply the grouping rule read directly: all springs in one nest
 * belong to one band. So the replacement must carry the band the rest of the
 * nest already carries, and the window quoted is that band's own range from
 * the RDSO table -- never a computed one.
 */
function bandBasedGuidance(
  serviceable: NestSpringInput[],
  bandLookup?: (height: number) => string | null,
  bandRange?: (band: string) => { min: number; max: number } | null
): ReplacementGuidance {
  const heights = serviceable.map((s) => s.measuredFreeHeight).sort((a, b) => a - b);

  // A measured spring in a mixed nest still has a band -- look it up so the
  // whole nest is judged on the same footing.
  const bands = [
    ...new Set(
      serviceable
        .map((s) => s.classifiedBand ?? (bandLookup ? bandLookup(s.measuredFreeHeight) : null))
        .filter(Boolean) as string[]
    )
  ];

  if (bands.length === 0) {
    return {
      action: 'REPLACE',
      targetRange: null,
      targetBand: null,
      message:
        'Replace this spring — a defective coil spring is renewed, not repaired. ' +
        'The band of the other springs in this nest has not been recorded, so the ' +
        'group is not established — record the rest of the nest first, then match ' +
        'the replacement to its band.',
      nestHeights: heights,
      reference: NEST_RULE_REFERENCE
    };
  }

  if (bands.length > 1) {
    return {
      action: 'REPLACE',
      targetRange: null,
      targetBand: null,
      message:
        `Replace this spring — a defective coil spring is renewed, not repaired. ` +
        `The rest of this nest is already spread across ${bands.length} bands ` +
        `(${bands.join(', ')}), so no single replacement can bring it into one group. ` +
        `Re-group the whole nest onto one band.`,
      nestHeights: heights,
      reference: NEST_RULE_REFERENCE
    };
  }

  const band = bands[0];
  const range = bandRange ? bandRange(band) : null;

  return {
    action: 'REPLACE',
    targetRange: range,
    targetBand: band,
    message:
      `Replace this spring — a defective coil spring is renewed, not repaired. ` +
      `Fit a spring from the ${band} band` +
      (range ? ` (${range.min.toFixed(1)}–${range.max.toFixed(1)} mm)` : '') +
      ` — the other ${serviceable.length} spring${serviceable.length === 1 ? '' : 's'} ` +
      `in this nest are ${band}, and all springs in one nest must come from the same band.`,
    nestHeights: heights,
    reference: NEST_RULE_REFERENCE
  };
}

/**
 * Works out what a replacement spring has to be, given the rest of its nest.
 *
 * A condemned spring is replaced, never repaired — WMM 2.0's overhaul steps say
 * "check the springs and replace the defective ones", and to do so "such that
 * variation in the height of springs in the same group" stays within limit.
 *
 * That second clause is the part an inspector cannot work out at a glance: the
 * replacement is not simply "any serviceable spring", it has to sit inside the
 * 3 mm window already established by the eleven springs still in the nest.
 * Fitting a good spring from the wrong band produces exactly the mismatched
 * nest the grouping rule exists to prevent.
 *
 * Everything here is computed from measurements already taken. Nothing is
 * predicted or inferred.
 */
export function getReplacementGuidance(
  nestSprings: NestSpringInput[],
  bandLookup?: (height: number) => string | null,
  bandRange?: (band: string) => { min: number; max: number } | null
): ReplacementGuidance {
  const serviceable = nestSprings.filter((s) => s.status !== 'CONDEMNED');
  const heights = serviceable.map((s) => s.measuredFreeHeight).sort((a, b) => a - b);

  // A nest recorded off the strip cannot be reasoned about arithmetically.
  // Every band-entered spring stores its band's midpoint, so twelve springs
  // genuinely spread across the full 3 mm of GREEN all read as one identical
  // number. Applying the +/-3 mm window to that midpoint yields a range wider
  // than the band itself -- for GREEN (257-260) it admits 255.5, which is a
  // YELLOW spring. Fitting it would produce exactly the mismatched nest the
  // rule exists to prevent, while the arithmetic claimed a pass.
  //
  // The band is what was actually observed, and one band IS one assembly
  // group, so for these nests the band is the constraint.
  if (serviceable.length > 0 && serviceable.some((s) => s.heightIsApproximate)) {
    return bandBasedGuidance(serviceable, bandLookup, bandRange);
  }

  if (heights.length === 0) {
    return {
      action: 'REPLACE',
      targetRange: null,
      targetBand: null,
      message:
        'Replace this spring — a defective coil spring is renewed, not repaired. ' +
        'No other spring in this nest has been measured yet, ' +
        'so the group height is not established — measure the rest of the nest first, ' +
        'then match the replacement to it.',
      nestHeights: [],
      reference: NEST_RULE_REFERENCE
    };
  }

  const lo = heights[0];
  const hi = heights[heights.length - 1];
  const spread = Number((hi - lo).toFixed(2));

  // The replacement must keep the whole nest inside the limit, so its window is
  // bounded by the existing extremes, not merely near the average.
  const allowedMin = Number((hi - MAX_NEST_HEIGHT_VARIATION_MM).toFixed(2));
  const allowedMax = Number((lo + MAX_NEST_HEIGHT_VARIATION_MM).toFixed(2));

  if (allowedMin > allowedMax) {
    return {
      action: 'REPLACE',
      targetRange: null,
      targetBand: null,
      message:
        `Replace this spring — a defective coil spring is renewed, not repaired. ` +
        `The rest of this nest already spans ${spread.toFixed(2)} mm ` +
        `(${lo.toFixed(1)}–${hi.toFixed(1)} mm), which is wider than the ${MAX_NEST_HEIGHT_VARIATION_MM} mm limit — ` +
        `no single replacement can bring it back into one group. Re-group the whole nest.`,
      nestHeights: heights,
      reference: NEST_RULE_REFERENCE
    };
  }

  const midpoint = Number(((allowedMin + allowedMax) / 2).toFixed(1));
  const targetBand = bandLookup ? bandLookup(midpoint) : null;

  return {
    action: 'REPLACE',
    targetRange: { min: allowedMin, max: allowedMax },
    targetBand,
    message:
      `Replace this spring — a defective coil spring is renewed, not repaired. ` +
      `The replacement must measure between ` +
      `${allowedMin.toFixed(1)} and ${allowedMax.toFixed(1)} mm` +
      (targetBand ? ` (${targetBand} band)` : '') +
      ` to keep this nest within ${MAX_NEST_HEIGHT_VARIATION_MM} mm — the other ` +
      `${heights.length} spring${heights.length === 1 ? '' : 's'} here measure ` +
      `${lo.toFixed(1)}–${hi.toFixed(1)} mm.`,
    nestHeights: heights,
    reference: NEST_RULE_REFERENCE
  };
}
