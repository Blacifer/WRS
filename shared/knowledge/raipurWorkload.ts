/**
 * What WRS Raipur actually overhauls
 * Indian Railways WRS Raipur
 *
 * SOURCE
 * ------
 * The shop's own out-turn return for 2025–26, twelve months, supplied by WRS
 * Raipur on 27 August 2026. These are counts of wagons actually turned out,
 * not a plan and not an RDSO list of what exists on the network.
 *
 * WHY IT MATTERS
 * --------------
 * The app knew 22 wagon designations, taken from the RDSO manual's tables.
 * The shop turned out 19 types last year, and eleven of them were not in that
 * list at all — including BOBRN at 305 wagons and BTAP at 156.
 *
 * The more useful discovery is the shape of the work rather than the names.
 * BOXNHL alone is 43.6% of everything Raipur overhauls — 2,503 wagons out of
 * 5,747. A screen that asks an inspector to pick a wagon type from an
 * alphabetical list of 22 is asking the wrong question 44% of the time, when
 * it could offer the right answer first.
 *
 * WHAT THIS FILE IS NOT
 * ---------------------
 * It carries no engineering data. Spring counts, bogie types and tolerances
 * still come only from RDSO documents, and a type appearing here does not
 * mean the app knows how to classify its springs — several of these have no
 * configuration yet, which is exactly what `configured: false` records.
 */

export interface RaipurWagonVolume {
  /** Designation as the shop writes it on its own return. */
  designation: string;
  /** Periodic overhaul — the bulk of the work. */
  poh: number;
  /** Non-periodic overhaul. */
  npoh: number;
  /** Routine overhaul. */
  roh: number;
  /** All three, for ranking. */
  total: number;
  /**
   * Whether the app holds a spring configuration for this designation.
   *
   * False means the app will count its springs but decline to classify them,
   * which is the correct behaviour for a type whose bogie and spring layout
   * nobody has given us. It is a gap to be filled from RDSO tables, never by
   * assuming it resembles a similar-sounding type.
   */
  configured: boolean;
}

/** Wagons turned out at WRS Raipur, 2025–26, busiest first. */
export const RAIPUR_WORKLOAD_2025_26: RaipurWagonVolume[] = [
  { designation: 'BOXNHL', poh: 2503, npoh: 12, roh: 8, total: 2523, configured: true },
  { designation: 'BRN/BFKN/BFNS', poh: 519, npoh: 34, roh: 57, total: 610, configured: false },
  { designation: 'BOST', poh: 457, npoh: 1, roh: 0, total: 458, configured: true },
  { designation: 'BOXN', poh: 395, npoh: 12, roh: 9, total: 416, configured: true },
  { designation: 'BOXNS', poh: 369, npoh: 0, roh: 0, total: 369, configured: false },
  { designation: 'BOBRN', poh: 305, npoh: 14, roh: 0, total: 319, configured: false },
  { designation: 'BOXNR', poh: 278, npoh: 5, roh: 2, total: 285, configured: true },
  { designation: 'BTAP', poh: 156, npoh: 0, roh: 0, total: 156, configured: false },
  { designation: 'BOBSN', poh: 136, npoh: 0, roh: 0, total: 136, configured: false },
  { designation: 'BVZI', poh: 132, npoh: 0, roh: 0, total: 132, configured: false },
  { designation: 'BFNV', poh: 102, npoh: 0, roh: 0, total: 102, configured: false },
  { designation: 'BCN', poh: 61, npoh: 0, roh: 0, total: 61, configured: true },
  { designation: 'BLC', poh: 0, npoh: 0, roh: 45, total: 45, configured: false },
  { designation: 'BOBYN', poh: 39, npoh: 0, roh: 8, total: 47, configured: false },
  { designation: 'BVCM', poh: 38, npoh: 0, roh: 0, total: 38, configured: false },
  { designation: 'BOXNLW', poh: 35, npoh: 8, roh: 0, total: 43, configured: true },
  { designation: 'BCNHL', poh: 3, npoh: 2, roh: 0, total: 5, configured: false },
  { designation: 'BWTB', poh: 1, npoh: 0, roh: 0, total: 1, configured: true },
  { designation: 'BOXNHAM', poh: 1, npoh: 0, roh: 0, total: 1, configured: true }
];

/** Everything turned out in 2025–26. */
export const RAIPUR_ANNUAL_TOTAL = 5747;

/** Working days in that year, from the same return. */
export const RAIPUR_WORKING_DAYS = 297;

/**
 * Designations ordered by how often the shop actually sees them.
 *
 * For populating a picker: the first three cover 62% of the year's work, so
 * an inspector usually finds the right answer without scrolling.
 */
export function byFrequency(): string[] {
  return RAIPUR_WORKLOAD_2025_26.map((w) => w.designation);
}

/**
 * Types the shop overhauls that the app cannot yet classify springs for.
 *
 * Named rather than counted, because each one needs a specific answer from an
 * RDSO table and the list is the work queue for getting them.
 */
export function unconfiguredTypes(): RaipurWagonVolume[] {
  return RAIPUR_WORKLOAD_2025_26.filter((w) => !w.configured);
}

/** Share of the year's work the app can classify springs for. */
export function configuredCoverage(): { covered: number; total: number; percent: number } {
  const covered = RAIPUR_WORKLOAD_2025_26
    .filter((w) => w.configured)
    .reduce((sum, w) => sum + w.total, 0);
  const total = RAIPUR_WORKLOAD_2025_26.reduce((sum, w) => sum + w.total, 0);
  return { covered, total, percent: Math.round((covered / total) * 1000) / 10 };
}
