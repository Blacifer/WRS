/**
 * Judging a spring, whichever bogie it came off
 * Indian Railways WRS Raipur
 *
 * WHY THIS EXISTS
 * ---------------
 * Two different published rules decide whether a spring is serviceable, and
 * until now only one of them was reachable.
 *
 * CASNUB springs get RDSO G-95's six-band colour classification, and the
 * sorting screen is built around it because grouping a nest by band is the
 * job. LWLH25 and LCCF20 have no band table at all: WMM 2.0 §309C gives them
 * a nominal free height and a condemning height and nothing between, so they
 * get PASS or CONDEMNED and no colour.
 *
 * The §309C limits were transcribed, tested and documented as closing "the
 * safety-critical half" — and then nothing imported them. `BogieType` still
 * listed only the three CASNUB variants, the sorting screen offered only
 * those three, and so an inspector holding a BOXNS spring could not select
 * its bogie, let alone condemn it. BOXNS is 369 wagons a year at Raipur, the
 * fifth busiest type in the shop.
 *
 * This is the single place that knows which rule applies, so the screen and
 * the server route can ask one question and neither has to decide.
 *
 * WHY NOT JUST WIDEN BogieType
 * ----------------------------
 * `BogieType` means "a bogie with a G-95 band table" throughout the codebase,
 * including a CHECK constraint on the inspections table. Widening it would
 * make every band lookup in the system silently able to receive a bogie it
 * has no table for. The two kinds of bogie are genuinely different and the
 * types now say so.
 */

import type { BogieType, SpringCondition, SpringPosition, BandColor } from '../types.ts';
import { classifySpring } from './engine.ts';
import {
  judgeAgainstCondemningLimit,
  isNonBandedBogie,
  type NonBandedBogie
} from './condemningLimits.ts';

/** Any bogie the sorting screen can accept — banded or not. */
export type SortingBogie = BogieType | NonBandedBogie;

/** The bogies offered for sorting, with what can be said about each. */
export const SORTING_BOGIES: Array<{
  value: SortingBogie;
  label: string;
  /** False when the published data supports no colour band, only a verdict. */
  banded: boolean;
  source: string;
}> = [
  { value: 'CASNUB_22_NLB', label: 'CASNUB 22 NLB', banded: true, source: 'RDSO G-95 Rev-II' },
  { value: 'CASNUB_22_HS', label: 'CASNUB 22 HS', banded: true, source: 'RDSO G-95 Rev-II' },
  { value: 'CASNUB_22_RFT', label: 'CASNUB 22 RFT', banded: true, source: 'RDSO G-95 Rev-II' },
  { value: 'LWLH25', label: 'LWLH25 (BOXNS)', banded: false, source: 'WMM 2.0 §309C' },
  { value: 'LCCF20', label: 'LCCF20 (BLCA)', banded: false, source: 'WMM 2.0 §309C' }
];

export interface SpringVerdict {
  status: 'PASS' | 'CONDEMNED';
  /** Null for bogies with no band table. Never invented. */
  band: BandColor | null;
  bandRoman: string | null;
  tableReference: string;
  condemnationReason: string | null;
  /** Anything the source says that a bare verdict would lose. */
  note?: string;
  /** Whether a colour band was available at all, as opposed to simply not matching one. */
  bandingAvailable: boolean;
}

/** Whether this bogie is judged by band table or by condemning height alone. */
export function isBandedBogie(bogie: string): bogie is BogieType {
  return bogie === 'CASNUB_22_NLB' || bogie === 'CASNUB_22_HS' || bogie === 'CASNUB_22_RFT';
}

/** Whether the sorting screen can accept this bogie at all. */
export function isSortingBogie(bogie: string): bogie is SortingBogie {
  return isBandedBogie(bogie) || isNonBandedBogie(bogie);
}

/**
 * Judges one spring against whichever rule its bogie is published under.
 *
 * Throws for a bogie neither rule covers rather than guessing. A wagon whose
 * springs this system holds no data for must fail loudly at the point of
 * entry — quietly returning PASS would be the worst outcome available.
 */
export function judgeSortedSpring(request: {
  bogieType: SortingBogie;
  condition: SpringCondition;
  position: SpringPosition;
  measuredHeight: number;
  damageType?: string | null;
  damageNotes?: string | null;
}): SpringVerdict {
  const { bogieType, condition, position, measuredHeight, damageType, damageNotes } = request;

  if (isNonBandedBogie(bogieType)) {
    /*
     * Physical damage condemns regardless of height, exactly as it does for a
     * CASNUB spring. A cracked spring measures perfectly, so leaving this out
     * of the non-banded path would have made damage recordable on one kind of
     * bogie and invisible on the other.
     */
    if (damageType && damageType !== 'NONE') {
      return {
        status: 'CONDEMNED',
        band: null,
        bandRoman: null,
        tableReference: `WMM 2.0 §309C (${bogieType})`,
        condemnationReason: `Physical damage recorded: ${damageType}.${damageNotes ? ` ${damageNotes}` : ''}`,
        bandingAvailable: false
      };
    }

    const verdict = judgeAgainstCondemningLimit(bogieType, position, measuredHeight);
    return {
      status: verdict.status,
      band: null,
      bandRoman: null,
      tableReference: verdict.source,
      condemnationReason:
        verdict.status === 'CONDEMNED'
          ? `Measured ${verdict.measuredHeight}mm, below the ${verdict.condemningHeight}mm ` +
            `condemning height for ${bogieType} ${position} (nominal ${verdict.nominal}).`
          : null,
      note: verdict.note,
      bandingAvailable: false
    };
  }

  if (!isBandedBogie(bogieType)) {
    throw new Error(
      `No published rule held for bogie "${bogieType}". It must not be judged by guesswork.`
    );
  }

  const result = classifySpring({
    bogieType,
    condition,
    position: position as any,
    measuredHeight,
    damageType: damageType as any,
    damageNotes: damageNotes as any
  });

  return {
    status: result.status as 'PASS' | 'CONDEMNED',
    band: result.band ?? null,
    bandRoman: result.bandRoman ?? null,
    tableReference: result.tableReference,
    condemnationReason: result.condemnationReason ?? null,
    bandingAvailable: true
  };
}
