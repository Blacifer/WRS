/**
 * Assembly evidence — what a photograph of an open bogie has to carry
 * Indian Railways WRS Raipur
 *
 * WHY THIS EXISTS
 * ---------------
 * A wagon leaves the shop and something happens on the road. The question that
 * follows is whether a part was missing when it left, and today the answer
 * rests on a checklist item somebody ticked. A photograph of the bogie taken
 * after spring placement and before the frame is lowered — the one moment when
 * every pocket is simultaneously visible — answers it with evidence instead.
 *
 * This module is only the vocabulary for that photograph. There is no model
 * here, no count, and no verdict. See docs/ASSEMBLY_COMPLETENESS.md for why
 * those come later and what they may never do.
 *
 * WHY THE TAGS MATTER MORE THAN THEY LOOK
 * ---------------------------------------
 * `wagon_photos` sits behind append-only triggers: every row written is
 * permanent and cannot be edited. A tag shape that turns out wrong cannot be
 * migrated, only abandoned — and a dataset with two tag shapes in it is a
 * dataset somebody has to write a special case for, forever. So the shape is
 * defined once, here, and both the capture screen and the export endpoint read
 * it from this file rather than spelling it out twice.
 *
 * WHY COLONS AND NOT UNDERSCORES
 * ------------------------------
 * The older defect tags use `DAMAGE_CRACK`, `POSITION_OUTER`. That works while
 * every value is a single word. Wagon designations are not: "BOXN M1" and
 * "BOSTHS M2" contain spaces, so `WAGON_TYPE_BOXN M1` cannot be split back
 * apart unambiguously. `EXCLUDED:person:2` in objectDetection.ts already uses
 * colons for the same reason, and this follows it.
 *
 * WHAT IS DELIBERATELY NOT STORED
 * -------------------------------
 * The expected spring count. It is a property of the wagon designation and it
 * lives in WAGON_SPRING_CONFIGS, which carries two independent RDSO sources
 * that agree. Copying a number into a tag would create a second source that
 * can disagree with the first, and the copy is the one that would be wrong —
 * BOXN and BOXN M1 share a bogie family and differ by four springs. Store what
 * the wagon *is*; derive what it should have, every time, from the registry.
 */

import { getWagonSpringConfig } from '../classification/wagonTypes.ts';

/**
 * Which side of the bogie the camera was on.
 *
 * A CASNUB bogie cannot be photographed whole: no single frame shows every
 * pocket. Two frames per bogie is the minimum that covers it, so the side is
 * part of what identifies a capture rather than an optional note.
 *
 * A and B rather than LEFT and RIGHT because left depends on which end you are
 * standing at, and the shop floor has no fixed convention for it. A and B are
 * assigned by the marked camera positions and mean the same thing to everyone.
 */
export type BogieSide = 'SIDE_A' | 'SIDE_B';

export const BOGIE_SIDES: readonly BogieSide[] = ['SIDE_A', 'SIDE_B'] as const;

export type BogiePosition = 'BOGIE_1' | 'BOGIE_2';

export const BOGIE_POSITIONS: readonly BogiePosition[] = ['BOGIE_1', 'BOGIE_2'] as const;

/** Marks a photograph as belonging to the assembly-completeness set. */
export const ASSEMBLY_EVIDENCE_TAG = 'ASSEMBLY_EVIDENCE';

const WAGON_TYPE_PREFIX = 'WAGON_TYPE:';
const BOGIE_PREFIX = 'BOGIE:';
const SIDE_PREFIX = 'SIDE:';

export interface AssemblyCapture {
  /**
   * The wagon designation, canonicalised against the registry at capture time.
   *
   * Recorded on the photograph rather than looked up from the wagon record
   * later, because the photograph is evidence and evidence should say what was
   * believed when it was taken. A wagon record can be corrected; this row
   * cannot, and the two disagreeing is information rather than a fault.
   */
  designation: string;
  bogiePosition: BogiePosition;
  side: BogieSide;
}

/**
 * The tags for one assembly photograph.
 *
 * Throws on an unknown designation rather than storing it. This is the last
 * point at which a bad value can be refused — after the insert it is permanent,
 * and a dataset row labelled with a designation that no table knows is a row
 * nobody can compute an expected count for.
 */
export function buildAssemblyTags(capture: AssemblyCapture): string[] {
  const config = getWagonSpringConfig(capture.designation);
  if (!config) {
    throw new Error(
      `Unknown wagon designation "${capture.designation}". Assembly evidence must ` +
        `name a designation held in WAGON_SPRING_CONFIGS, because the expected ` +
        `spring count is derived from it and cannot be derived from anything else.`
    );
  }
  if (!BOGIE_POSITIONS.includes(capture.bogiePosition)) {
    throw new Error(`Invalid bogiePosition "${capture.bogiePosition}".`);
  }
  if (!BOGIE_SIDES.includes(capture.side)) {
    throw new Error(`Invalid bogie side "${capture.side}".`);
  }

  return [
    ASSEMBLY_EVIDENCE_TAG,
    // The registry's spelling, not the caller's, so "boxn m1" and "BOXN M1"
    // produce one label in the dataset rather than two.
    `${WAGON_TYPE_PREFIX}${config.designation}`,
    `${BOGIE_PREFIX}${capture.bogiePosition}`,
    `${SIDE_PREFIX}${capture.side}`
  ];
}

/**
 * Read a capture back out of a stored photograph's tags.
 *
 * Returns null for anything that is not a complete assembly capture, including
 * a row that carries the marker tag but is missing a field. A partial row is
 * not a usable sample and must not be counted as one — the readiness figures
 * this feeds are the basis for deciding whether a model is worth attempting,
 * and inflating them with unusable rows would answer that question wrongly.
 */
export function parseAssemblyTags(tags: string[] | null | undefined): AssemblyCapture | null {
  if (!Array.isArray(tags) || !tags.includes(ASSEMBLY_EVIDENCE_TAG)) return null;

  const find = (prefix: string): string | null => {
    const hit = tags.find((t) => typeof t === 'string' && t.startsWith(prefix));
    return hit ? hit.slice(prefix.length) : null;
  };

  const designation = find(WAGON_TYPE_PREFIX);
  const bogiePosition = find(BOGIE_PREFIX) as BogiePosition | null;
  const side = find(SIDE_PREFIX) as BogieSide | null;

  if (!designation || !bogiePosition || !side) return null;
  if (!BOGIE_POSITIONS.includes(bogiePosition)) return null;
  if (!BOGIE_SIDES.includes(side)) return null;
  // A designation that no longer resolves is a row we cannot compute against.
  if (!getWagonSpringConfig(designation)) return null;

  return { designation, bogiePosition, side };
}

/**
 * The two frames one bogie needs, for a screen that has to ask for both.
 */
export function requiredFramesForBogie(bogiePosition: BogiePosition): AssemblyCapture['side'][] {
  void bogiePosition;
  return [...BOGIE_SIDES];
}

/**
 * What has actually been covered, from a set of parsed captures.
 *
 * Lives here rather than inside the export route for one reason: the route
 * cannot be exercised without standing up HTTP, and this is the arithmetic
 * that decides whether somebody attempts a model. Arithmetic that steers a
 * decision that size should be pinned by tests directly.
 */
export interface AssemblyCoverage {
  totalPhotos: number;
  /** Bogies photographed from BOTH sides — the only ones that cover every pocket. */
  completeBogies: number;
  /** Bogies with one side only. Not usable, and not counted as progress. */
  partialBogies: number;
  photosByDesignation: Record<string, number>;
}

export function summariseAssemblyCoverage(
  samples: Array<AssemblyCapture & { wagonNumber: string }>
): AssemblyCoverage {
  const sidesByBogie = new Map<string, Set<BogieSide>>();
  const photosByDesignation: Record<string, number> = {};

  for (const s of samples) {
    const key = `${s.wagonNumber}::${s.bogiePosition}`;
    if (!sidesByBogie.has(key)) sidesByBogie.set(key, new Set());
    sidesByBogie.get(key)!.add(s.side);
    photosByDesignation[s.designation] = (photosByDesignation[s.designation] || 0) + 1;
  }

  let completeBogies = 0;
  let partialBogies = 0;
  for (const sides of sidesByBogie.values()) {
    if (BOGIE_SIDES.every((side) => sides.has(side))) completeBogies += 1;
    else partialBogies += 1;
  }

  return {
    totalPhotos: samples.length,
    completeBogies,
    partialBogies,
    photosByDesignation
  };
}

/**
 * An honest sentence about where collection stands.
 *
 * The thresholds are round numbers and are not pretending to be derived — the
 * real figure depends on how variable this shop's lighting and camera
 * positions turn out to be, which nobody knows until captures exist. They are
 * deliberately stated in whole bogies rather than photographs so that
 * photographing one side twice as fast cannot move them.
 */
export function assemblyReadiness(completeBogies: number): string {
  if (completeBogies >= 300) {
    return (
      'Enough covered bogies to attempt an occupancy baseline. Publish the ' +
      'always-full baseline first: any model has to beat it, not beat zero.'
    );
  }
  if (completeBogies >= 50) {
    return (
      'Useful for evaluating capture protocol and lighting; far too few to ' +
      'train against. Keep collecting.'
    );
  }
  return 'Still accumulating. Both sides of a bogie are needed before it counts.';
}

/**
 * Stated on every response rather than left for somebody to work out.
 *
 * A set gathered from correct assemblies contains almost no empty pockets, so
 * a model trained on it learns to say "fine", scores extremely well, and never
 * fires. No amount of volume fixes that, which is why it is a constant here
 * and not a threshold.
 */
export const ASSEMBLY_NEGATIVES_WARNING =
  'These counts say nothing about class balance. Occupancy needs staged empty ' +
  'pockets, deliberately photographed and labelled — waiting for genuine ' +
  'misassemblies means waiting for the failure this is meant to prevent.';
