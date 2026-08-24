/**
 * Band-First Spring Entry
 * Indian Railways WRS Raipur
 *
 * WHY THIS EXISTS
 * ---------------
 * The DRM described the real workflow: inspectors use a strip — a stick — and
 * checking a spring against it tells them directly which band the spring
 * belongs to. RDSO calls this "Grouping of Springs (By strip method)" in
 * WMM 2.0 Chapter 6.
 *
 * The tool already answers the question. It does not produce a number that
 * then needs looking up.
 *
 * The app was asking inspectors to type a three-digit height and then
 * re-deriving the band they had already read off the strip — more work than
 * the tool requires, nine hundred times a day, to arrive at an answer they
 * were already holding.
 *
 * Recording the band directly is one tap. It is also sufficient: one band IS
 * one 3 mm assembly group, so nest matching, condemnation and the exit gate
 * all work identically. Nothing needed for safety is lost.
 *
 * An exact height can still be entered where it matters — a borderline spring,
 * a disputed reading, or a workshop that measures numerically. This module
 * supports both without pretending one is the other.
 */

import type { BogieType, SpringCondition, SpringPosition, BandColor } from '../types.ts';
import { getRDSOTable } from './tables.ts';

export interface BandOption {
  band: BandColor;
  bandRoman: string;
  /** The free-height window this band covers, straight from the RDSO table. */
  minHeight: number;
  maxHeight: number;
  /** Representative height stored when only a band is recorded. */
  midpoint: number;
  label: string;
  labelHi: string;
}

const BAND_LABEL_HI: Record<string, string> = {
  BLUE: 'नीला',
  GREEN: 'हरा',
  YELLOW: 'पीला',
  ORANGE: 'नारंगी',
  WHITE: 'सफ़ेद',
  RED: 'लाल'
};

/**
 * The bands available for a given spring, in the order they appear on the
 * strip — highest free height first, matching the printed RDSO tables so the
 * on-screen order mirrors the tool in the inspector's hand.
 */
export function getBandOptions(
  bogieType: BogieType,
  condition: SpringCondition,
  position: SpringPosition
): BandOption[] {
  const table = getRDSOTable(bogieType, condition, position);
  if (!table) return [];

  return table.bands.map((b) => ({
    band: b.band,
    bandRoman: b.bandRoman,
    minHeight: b.minHeight,
    maxHeight: b.maxHeight,
    // Midway through the band: the most defensible single value when the
    // measurement recorded was "this band", not a specific number.
    midpoint: Number(((b.minHeight + b.maxHeight) / 2).toFixed(1)),
    label: b.band,
    labelHi: BAND_LABEL_HI[b.band] || b.band
  }));
}

export interface BandEntryResult {
  band: BandColor;
  bandRoman: string;
  status: 'PASS';
  /** Representative height persisted for this entry. */
  measuredFreeHeight: number;
  /** True when the height is a band midpoint rather than a real measurement. */
  heightIsApproximate: true;
  bandRange: { min: number; max: number };
  tableReference: string;
}

/**
 * Records a spring by the band read off the strip.
 *
 * The stored height is the band's midpoint and is flagged approximate, so
 * nothing downstream mistakes it for a measured value. Every safety decision —
 * pass or condemn, nest matching, the exit gate — depends on the band, which
 * is exactly what was observed.
 */
export function recordByBand(
  bogieType: BogieType,
  condition: SpringCondition,
  position: SpringPosition,
  band: BandColor
): BandEntryResult | null {
  const table = getRDSOTable(bogieType, condition, position);
  if (!table) return null;

  const match = table.bands.find((b) => b.band === band);
  if (!match) return null;

  return {
    band: match.band,
    bandRoman: match.bandRoman,
    // Every band in an RDSO table is a serviceable group. A spring that falls
    // outside them is condemned, and that is recorded as a condemnation rather
    // than as a band.
    status: 'PASS',
    measuredFreeHeight: Number(((match.minHeight + match.maxHeight) / 2).toFixed(1)),
    heightIsApproximate: true,
    bandRange: { min: match.minHeight, max: match.maxHeight },
    tableReference: table.tableReference || table.tableNumber
  };
}

/**
 * A spring the strip rejects — below the lowest band or above the highest.
 *
 * Recorded as condemned without inventing a height, because the inspector
 * observed "off the strip", not a number. The stored value sits just outside
 * the condemning limit so it can never be mistaken for a serviceable reading.
 */
export function recordAsCondemned(
  bogieType: BogieType,
  condition: SpringCondition,
  position: SpringPosition,
  direction: 'BELOW' | 'ABOVE' = 'BELOW'
): {
  status: 'CONDEMNED';
  measuredFreeHeight: number;
  heightIsApproximate: true;
  condemnationReason: string;
  tableReference: string;
} | null {
  const table = getRDSOTable(bogieType, condition, position);
  if (!table) return null;

  const height =
    direction === 'BELOW'
      ? Number((table.condemningMinHeight - 1).toFixed(1))
      : Number((table.condemningMaxHeight + 1).toFixed(1));

  return {
    status: 'CONDEMNED',
    measuredFreeHeight: height,
    heightIsApproximate: true,
    condemnationReason:
      direction === 'BELOW'
        ? `Spring falls below the lowest band on the strip (under ${table.condemningMinHeight} mm) — worn or collapsed.`
        : `Spring exceeds the highest band on the strip (over ${table.condemningMaxHeight} mm).`,
    tableReference: table.tableReference || table.tableNumber
  };
}
