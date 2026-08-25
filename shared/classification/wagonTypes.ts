/**
 * Wagon Type → Spring Configuration Registry
 * Indian Railways WRS Raipur
 *
 * WHY THIS EXISTS
 * ---------------
 * The app asked for a bogie type and an axle load. A shop asks "which wagon is
 * it?" — BOSTHS M2, BOXNLW, BRNA — and the bogie and spring configuration
 * follow from that. Asking the question the other way round put the burden of
 * a lookup on the inspector, using vocabulary they do not lead with.
 *
 * SOURCE
 * ------
 * RDSO Wagon Maintenance Manual 2.0, Chapter 1 §102 "Important Parameters of
 * Wagons", Tables 1.1 (Open), 1.2 (Covered) and 1.3 (Flat). Each row gives the
 * designation, axle load, bogie and spring configuration as "O – n / I – n /
 * S – n" — outer, inner and snubber springs per bogie.
 *
 * This is a second, independent source for the counts already held in
 * springCounts.ts from WMM §601, and it agrees with them: BOXN on CASNUB 22
 * NLB at 20.32t is 12/8/4, and BOXNHS on CASNUB 22 HS at 20.32t is 14/12/4.
 * Two sources agreeing is the reason to trust a number that decides whether a
 * wagon is released.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 * ----------------------------------
 * Several wagon types run on bogies with no G-95 band table in this system —
 * CASNUB 22 NLC and IRF 108 HS. Their spring *counts* are published here and
 * are trustworthy, but a spring on one of them cannot be classified into a
 * band, because we hold no table for it. Those entries carry bogieType: null
 * and the caller must not invent one. Counting is not classifying.
 */

import type { BogieType } from '../types.ts';

export type WagonCategory = 'OPEN' | 'COVERED' | 'FLAT';

export interface WagonSpringConfig {
  /** Designation as painted on the wagon and used in the shop. */
  designation: string;
  category: WagonCategory;
  axleLoad: string;
  /** Bogie exactly as the manual names it, including modification marks. */
  bogieDescription: string;
  /**
   * The G-95 band table family, or null when this system holds no table for
   * that bogie. Null means: count the springs, do not classify them.
   */
  bogieType: BogieType | null;
  counts: { outer: number; inner: number; snubber: number };
  tableRef: string;
  notes?: string;
}

const T11 = 'WMM 2.0 Table 1.1 (Open Wagons)';
const T12 = 'WMM 2.0 Table 1.2 (Covered Wagons)';
const T13 = 'WMM 2.0 Table 1.3 (Flat Wagons)';

export const WAGON_SPRING_CONFIGS: WagonSpringConfig[] = [
  // ---------------------------------------------------------------- OPEN ---
  { designation: 'BOXN', category: 'OPEN', axleLoad: '20.32t', bogieDescription: 'CASNUB 22 NLB', bogieType: 'CASNUB_22_NLB', counts: { outer: 12, inner: 8, snubber: 4 }, tableRef: T11 },
  { designation: 'BOXN M1', category: 'OPEN', axleLoad: '22.82t', bogieDescription: 'CASNUB 22 NLB (Modified)', bogieType: 'CASNUB_22_NLB', counts: { outer: 14, inner: 10, snubber: 4 }, tableRef: T11, notes: 'High axle load version of BOXN.' },
  { designation: 'BOXNR', category: 'OPEN', axleLoad: '22.9t', bogieDescription: 'CASNUB 22 NLB', bogieType: 'CASNUB_22_NLB', counts: { outer: 12, inner: 8, snubber: 4 }, tableRef: T11 },
  { designation: 'BOY', category: 'OPEN', axleLoad: '22.9t', bogieDescription: 'CASNUB 22 NLB (modified)', bogieType: 'CASNUB_22_NLB', counts: { outer: 14, inner: 10, snubber: 4 }, tableRef: T11, notes: 'No doors. Designed for heavy minerals.' },
  { designation: 'BOXNHS', category: 'OPEN', axleLoad: '20.32t', bogieDescription: 'CASNUB 22 HS', bogieType: 'CASNUB_22_HS', counts: { outer: 14, inner: 12, snubber: 4 }, tableRef: T11 },
  { designation: 'BOXNHS M1', category: 'OPEN', axleLoad: '22.82t', bogieDescription: 'CASNUB 22 HS (Modified)', bogieType: 'CASNUB_22_HS', counts: { outer: 14, inner: 14, snubber: 4 }, tableRef: T11 },
  { designation: 'BOXNLW', category: 'OPEN', axleLoad: '20.32t', bogieDescription: 'CASNUB 22 HS', bogieType: 'CASNUB_22_HS', counts: { outer: 14, inner: 12, snubber: 4 }, tableRef: T11, notes: 'Light-weight BOXN: stainless steel (IRS M44) / Corten steel (IRS M41) body and underframe.' },
  { designation: 'BOXNLW M1', category: 'OPEN', axleLoad: '22.82t', bogieDescription: 'CASNUB 22 HS (Modified)', bogieType: 'CASNUB_22_HS', counts: { outer: 14, inner: 14, snubber: 4 }, tableRef: T11 },
  { designation: 'BOXNHL', category: 'OPEN', axleLoad: '25t', bogieDescription: 'CASNUB 22 HS', bogieType: 'CASNUB_22_HS', counts: { outer: 14, inner: 14, snubber: 4 }, tableRef: T11 },
  { designation: 'BOST', category: 'OPEN', axleLoad: '20.32t', bogieDescription: 'CASNUB 22 HS', bogieType: 'CASNUB_22_HS', counts: { outer: 14, inner: 12, snubber: 4 }, tableRef: T11 },
  { designation: 'BOST M1', category: 'OPEN', axleLoad: '22.32t', bogieDescription: 'CASNUB 22 HS (modified)', bogieType: 'CASNUB_22_HS', counts: { outer: 14, inner: 14, snubber: 4 }, tableRef: T11, notes: 'High axle load version of BOST.' },
  { designation: 'BOSTHS', category: 'OPEN', axleLoad: '20.32t', bogieDescription: 'CASNUB 22 HS (mod-I)', bogieType: 'CASNUB_22_HS', counts: { outer: 12, inner: 12, snubber: 4 }, tableRef: T11, notes: 'High speed version of BOST.' },
  { designation: 'BOSTHS M1', category: 'OPEN', axleLoad: '22.32t', bogieDescription: 'Modified CASNUB 22 HS (Mod-I)', bogieType: 'CASNUB_22_HS', counts: { outer: 14, inner: 14, snubber: 4 }, tableRef: T11, notes: 'High axle load version of BOSTHS.' },
  { designation: 'BOSTHS M2', category: 'OPEN', axleLoad: '22.32t', bogieDescription: 'Modified CASNUB 22 HS (Mod-II)', bogieType: 'CASNUB_22_HS', counts: { outer: 12, inner: 12, snubber: 4 }, tableRef: T11 },
  // Bogies with no G-95 band table held in this system.
  { designation: 'BOYEL', category: 'OPEN', axleLoad: '25.0t', bogieDescription: 'CASNUB 22 NLC', bogieType: null, counts: { outer: 14, inner: 14, snubber: 4 }, tableRef: T11, notes: 'NLC bogie — no G-95 band table held; springs can be counted but not classified.' },
  { designation: 'BOXNEL', category: 'OPEN', axleLoad: '25.0t', bogieDescription: 'CASNUB 22 NLC', bogieType: null, counts: { outer: 14, inner: 14, snubber: 4 }, tableRef: T11, notes: 'NLC bogie — no G-95 band table held.' },
  { designation: 'BOXNHA', category: 'OPEN', axleLoad: '22.1t / 22.82t', bogieDescription: 'IRF 108 HS', bogieType: null, counts: { outer: 14, inner: 14, snubber: 4 }, tableRef: T11, notes: 'IRF 108 bogie, not CASNUB — no G-95 band table held.' },
  { designation: 'BOXNHAM', category: 'OPEN', axleLoad: '22.82t', bogieDescription: 'IRF 108 HS', bogieType: null, counts: { outer: 14, inner: 14, snubber: 4 }, tableRef: T11, notes: 'IRF 108 bogie, not CASNUB — no G-95 band table held.' },

  // ------------------------------------------------------------- COVERED ---
  { designation: 'BCN', category: 'COVERED', axleLoad: '20.32t', bogieDescription: 'CASNUB 22 NLB', bogieType: 'CASNUB_22_NLB', counts: { outer: 12, inner: 8, snubber: 4 }, tableRef: T12 },
  { designation: 'BCN M1', category: 'COVERED', axleLoad: '22.82t', bogieDescription: 'CASNUB 22 NLB (Modified)', bogieType: 'CASNUB_22_NLB', counts: { outer: 14, inner: 10, snubber: 4 }, tableRef: T12 },
  { designation: 'BCNHS M1', category: 'COVERED', axleLoad: '22.82t', bogieDescription: 'CASNUB 22 HS (Modified)', bogieType: 'CASNUB_22_HS', counts: { outer: 14, inner: 14, snubber: 4 }, tableRef: T12 },
  { designation: 'BCNA', category: 'COVERED', axleLoad: '20.32t', bogieDescription: 'CASNUB 22 NLB', bogieType: 'CASNUB_22_NLB', counts: { outer: 12, inner: 8, snubber: 4 }, tableRef: T12 },
  { designation: 'BCNA M1', category: 'COVERED', axleLoad: '22.82t', bogieDescription: 'CASNUB 22 NLB (Modified)', bogieType: 'CASNUB_22_NLB', counts: { outer: 14, inner: 10, snubber: 4 }, tableRef: T12 },
  { designation: 'BCNAHS', category: 'COVERED', axleLoad: '20.32t', bogieDescription: 'CASNUB 22 HS', bogieType: 'CASNUB_22_HS', counts: { outer: 14, inner: 12, snubber: 4 }, tableRef: T12 },
  { designation: 'BCNAHS M1', category: 'COVERED', axleLoad: '22.82t', bogieDescription: 'CASNUB 22 HS (Modified)', bogieType: 'CASNUB_22_HS', counts: { outer: 14, inner: 14, snubber: 4 }, tableRef: T12 },

  // ---------------------------------------------------------------- FLAT ---
  { designation: 'BRN', category: 'FLAT', axleLoad: '20.32t', bogieDescription: 'CASNUB 22 NLB', bogieType: 'CASNUB_22_NLB', counts: { outer: 12, inner: 8, snubber: 4 }, tableRef: T13, notes: 'Designed for rails and heavy steel products.' },
  { designation: 'BRN 22.9', category: 'FLAT', axleLoad: '22.9t', bogieDescription: 'CASNUB 22 HS', bogieType: 'CASNUB_22_HS', counts: { outer: 14, inner: 14, snubber: 4 }, tableRef: T13 },
  { designation: 'BRNA', category: 'FLAT', axleLoad: '20.32t', bogieDescription: 'CASNUB 22 NLB', bogieType: 'CASNUB_22_NLB', counts: { outer: 12, inner: 8, snubber: 4 }, tableRef: T13 },
  { designation: 'BRNAHS', category: 'FLAT', axleLoad: '20.32t', bogieDescription: 'CASNUB 22 HS', bogieType: 'CASNUB_22_HS', counts: { outer: 14, inner: 12, snubber: 4 }, tableRef: T13, notes: 'High speed variant of BRNA.' },
  { designation: 'BFNS', category: 'FLAT', axleLoad: '20.32t', bogieDescription: 'CASNUB 22 HS', bogieType: 'CASNUB_22_HS', counts: { outer: 14, inner: 12, snubber: 4 }, tableRef: T13, notes: 'Steel coils, plates, sheets and billets.' },
  { designation: 'BRHNEHS', category: 'FLAT', axleLoad: '20.32t', bogieDescription: 'CASNUB 22 HS', bogieType: 'CASNUB_22_HS', counts: { outer: 14, inner: 12, snubber: 4 }, tableRef: T13, notes: 'Bogie rail wagon for track relaying trains.' },
  { designation: 'BRSTN', category: 'FLAT', axleLoad: '20.32t', bogieDescription: 'CASNUB 22 NLB', bogieType: 'CASNUB_22_NLB', counts: { outer: 12, inner: 8, snubber: 4 }, tableRef: T13, notes: 'Bogie rail wagon for heavy vehicles.' },
  { designation: 'BWTB', category: 'FLAT', axleLoad: '22.9t', bogieDescription: 'CASNUB 22 NLB', bogieType: 'CASNUB_22_NLB', counts: { outer: 14, inner: 10, snubber: 4 }, tableRef: T13, notes: 'Bogie well wagon, well height 1055 mm.' }
];

/** Normalises the many ways a designation gets written or spoken. */
function normaliseDesignation(input: string): string {
  return input
    .toUpperCase()
    .replace(/[\s_\-–—]+/g, ' ')
    .replace(/\bMK\s*/g, 'M')
    .trim();
}

/**
 * Looks up a wagon designation. Matching is forgiving about spacing and
 * hyphenation ("BOSTHS-M2", "bosths m2", "BOSTHS  M2") because this is typed
 * on a shop floor, but it never guesses a different wagon: an unrecognised
 * designation returns null so the caller has to ask rather than assume.
 */
export function getWagonSpringConfig(designation: string): WagonSpringConfig | null {
  if (!designation) return null;
  const key = normaliseDesignation(designation);
  return (
    WAGON_SPRING_CONFIGS.find((w) => normaliseDesignation(w.designation) === key) || null
  );
}

/** Every designation known, for a picker. Grouped by category, alphabetical. */
export function listWagonDesignations(category?: WagonCategory): WagonSpringConfig[] {
  const rows = category
    ? WAGON_SPRING_CONFIGS.filter((w) => w.category === category)
    : WAGON_SPRING_CONFIGS;
  return [...rows].sort(
    (a, b) => a.category.localeCompare(b.category) || a.designation.localeCompare(b.designation)
  );
}

/** Springs on one bogie of this wagon. */
export function springsPerBogie(config: WagonSpringConfig): number {
  return config.counts.outer + config.counts.inner + config.counts.snubber;
}

/** Springs on the whole wagon — two bogies. */
export function springsPerWagon(config: WagonSpringConfig): number {
  return springsPerBogie(config) * 2;
}

/**
 * True when this wagon's springs can be classified into RDSO bands.
 *
 * False means the count is known and the band is not — the wagon runs on a
 * bogie whose G-95 table this system does not hold. The distinction matters:
 * such a wagon can still be swept for completeness, but no band or pass/fail
 * verdict may be produced for its springs.
 */
export function canClassifySprings(config: WagonSpringConfig): boolean {
  return config.bogieType !== null;
}
