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
   * The app knows how many springs of each kind this wagon carries.
   *
   * False means it does not, and will not guess. A gap to be filled from an
   * RDSO table, never by assuming a type resembles a similar-sounding one.
   */
  configured: boolean;

  /**
   * The app can also produce a PASS or CONDEMNED verdict for those springs.
   *
   * Deliberately separate from `configured`, because knowing how many springs
   * a wagon carries and being able to judge one are different things.
   *
   * Not the same as producing a colour band. LWLH25 and LCCF20 have no G-95
   * band table — WMM 2.0 §309C gives them a nominal and a condemning height
   * and nothing between — so BOXNS and BLCA springs are judged pass/condemn
   * with no band. That is the whole of what the published data supports, and
   * the safety-critical half of it.
   */
  classifiable: boolean;

  /**
   * ...and can put them in one of the six G-95 colour bands.
   *
   * False for the non-CASNUB bogies. Grouping a nest by band is the sorting
   * screen's whole job, so this is worth stating separately rather than
   * letting "classifiable" imply it.
   */
  banded?: boolean;

  /**
   * The designations this line actually covers, when the shop reports several
   * as one.
   *
   * The out-turn return has a single line reading "BRN/BFKN/BFNS" with one
   * total against it. That was recorded here as one unknown designation and
   * marked wholly unconfigured, which was wrong and stayed wrong: BRN and
   * BFNS are both fully configured, bandable, and offered in the wagon
   * picker. The line was reported to the DRM as 610 wagons a year the app
   * could not serve, when most of it could.
   *
   * The counts cannot be split — the shop's return does not break the line
   * down — so coverage over a mixed line is a range, not a figure. See
   * configuredCoverage.
   */
  members?: Array<{
    designation: string;
    configured: boolean;
    classifiable: boolean;
    banded: boolean;
    note?: string;
  }>;
}

/**
 * What the manual does NOT contain, so nobody searches for it twice.
 *
 * Every remaining unconfigured type was looked for across all 659 pages:
 *
 *   BVZI   a brake van on an ICF bogie, not a CASNUB — a different spring
 *          arrangement entirely, and outside everything this app holds.
 *   BFNV   appears only as a certification amendment record. Bogie named
 *          (LWLH), spring counts given nowhere.
 *   BVCM   appears once, as a speed figure.
 *   BLC    appears as dimensions only. The shop reports it as "BLC"; the type
 *          codes distinguish BLCA (61) from BLCB (62), and only BLCA's bogie
 *          is confirmed as LCCF20. Judging BLC springs against LCCF20 limits
 *          would be an assumption about which variant, so it is not made.
 *   BFKN   does not appear in the manual at all.
 *
 * These need a source other than WMM 2.0. They are not an oversight and they
 * will not be found by looking harder at the same document.
 *
 * BFNS WAS ON THAT LIST AND SHOULD NOT HAVE BEEN
 * ----------------------------------------------
 * It is in WAGON_SPRING_CONFIGS with 14/12/4 on a CASNUB 22 HS, bandable, and
 * offered in the picker — as is BRN. Only BFKN of that group is genuinely
 * missing. The error came from treating the shop's combined out-turn line
 * "BRN/BFKN/BFNS" as a single unknown designation, and it was then repeated
 * as fact: 610 wagons a year, the second busiest line at Raipur, described as
 * beyond the app when most of it was already working.
 *
 * Worth stating plainly because the file reads like a record of what was
 * checked, and one wrong entry in it propagates further than a wrong number
 * in code — nothing imports this module, so nothing could contradict it.
 */

/** Wagons turned out at WRS Raipur, 2025–26, busiest first. */
export const RAIPUR_WORKLOAD_2025_26: RaipurWagonVolume[] = [
  { designation: 'BOXNHL', poh: 2503, npoh: 12, roh: 8, total: 2523, configured: true, classifiable: true, banded: true },
  /*
   * One line on the shop's return, three designations, no split given.
   *
   * The row-level flags mean "every wagon on this line is covered", so they
   * stay false while BFKN is unconfigured. That is not the same as the app
   * being unable to serve the line, which is what this row used to imply:
   * bring a BRN or a BFNS to the sorting screen today and it works.
   */
  {
    designation: 'BRN/BFKN/BFNS', poh: 519, npoh: 34, roh: 57, total: 610,
    configured: false, classifiable: false, banded: false,
    members: [
      { designation: 'BRN', configured: true, classifiable: true, banded: true, note: 'CASNUB 22 NLB. Outer count disputed between WMM 2.0 Chapter 6 (14) and Table 1.3 (12) — affects nest completeness only, not the band.' },
      { designation: 'BFNS', configured: true, classifiable: true, banded: true, note: 'CASNUB 22 HS, 14/12/4.' },
      { designation: 'BFKN', configured: false, classifiable: false, banded: false, note: 'Absent from WMM 2.0 entirely. Needs a source other than the manual.' }
    ]
  },
  { designation: 'BOST', poh: 457, npoh: 1, roh: 0, total: 458, configured: true, classifiable: true, banded: true },
  { designation: 'BOXN', poh: 395, npoh: 12, roh: 9, total: 416, configured: true, classifiable: true, banded: true },
  { designation: 'BOXNS', poh: 369, npoh: 0, roh: 0, total: 369, configured: true, classifiable: true, banded: false },
  { designation: 'BOBRN', poh: 305, npoh: 14, roh: 0, total: 319, configured: true, classifiable: true, banded: true },
  { designation: 'BOXNR', poh: 278, npoh: 5, roh: 2, total: 285, configured: true, classifiable: true, banded: true },
  { designation: 'BTAP', poh: 156, npoh: 0, roh: 0, total: 156, configured: true, classifiable: true, banded: true },
  { designation: 'BOBSN', poh: 136, npoh: 0, roh: 0, total: 136, configured: true, classifiable: true, banded: true },
  { designation: 'BVZI', poh: 132, npoh: 0, roh: 0, total: 132, configured: false, classifiable: false, banded: false },
  { designation: 'BFNV', poh: 102, npoh: 0, roh: 0, total: 102, configured: false, classifiable: false, banded: false },
  { designation: 'BCN', poh: 61, npoh: 0, roh: 0, total: 61, configured: true, classifiable: true, banded: true },
  { designation: 'BLC', poh: 0, npoh: 0, roh: 45, total: 45, configured: false, classifiable: false, banded: false },
  { designation: 'BOBYN', poh: 39, npoh: 0, roh: 8, total: 47, configured: true, classifiable: true, banded: true },
  { designation: 'BVCM', poh: 38, npoh: 0, roh: 0, total: 38, configured: false, classifiable: false, banded: false },
  { designation: 'BOXNLW', poh: 35, npoh: 8, roh: 0, total: 43, configured: true, classifiable: true, banded: true },
  { designation: 'BCNHL', poh: 3, npoh: 2, roh: 0, total: 5, configured: true, classifiable: true, banded: true },
  { designation: 'BWTB', poh: 1, npoh: 0, roh: 0, total: 1, configured: true, classifiable: true, banded: true },
  /*
   * IRF 108 HS, not a CASNUB. The springs can be counted; there is no G-95
   * band table for that bogie and no §309C condemning limit either, so no
   * verdict can be produced for them. This row claimed both and was the only
   * claim in the file wrong in the optimistic direction.
   */
  { designation: 'BOXNHAM', poh: 1, npoh: 0, roh: 0, total: 1, configured: true, classifiable: false, banded: false }
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

/**
 * How much of Raipur's work the app can actually serve.
 *
 * Three figures, because they answer different questions. `counted` is where
 * the app knows how many springs a wagon carries — enough to notice one
 * missing. `classified` is where it can also produce a verdict. `banded` is
 * where it can place a spring in a G-95 band, which is the actual sorting
 * job, and is always the smallest.
 *
 * WHY EACH ONE IS A RANGE
 * -----------------------
 * The shop reports "BRN/BFKN/BFNS" as one line of 610 wagons and does not
 * break it down. Two of those three are fully covered and one is not, so the
 * true figure depends on a split nobody has. The low bound assumes every
 * wagon on such a line is the uncovered type; the high bound assumes none is.
 *
 * A range rather than a midpoint, because a midpoint would be a number the
 * data does not support presented as one that is. This figure gets quoted to
 * the DRM, and "between 77% and 88%" is honest where "82.7%" is invented.
 */
export interface CoverageBand {
  /** Wagons certainly covered. */
  low: number;
  /** Wagons covered if every mixed line turned out to be the covered types. */
  high: number;
  lowPercent: number;
  highPercent: number;
  /** True when the bounds differ, i.e. some line's split is unknown. */
  uncertain: boolean;
}

export interface RaipurCoverage {
  total: number;
  counted: CoverageBand;
  classified: CoverageBand;
  banded: CoverageBand;
  /** Wagons sitting on lines whose split the shop's return does not give. */
  unknownSplit: number;
}

export function configuredCoverage(): RaipurCoverage {
  const total = RAIPUR_WORKLOAD_2025_26.reduce((sum, w) => sum + w.total, 0);

  const bandFor = (which: 'configured' | 'classifiable' | 'banded'): CoverageBand => {
    let low = 0;
    let high = 0;
    for (const w of RAIPUR_WORKLOAD_2025_26) {
      if (w.members && w.members.length > 0) {
        const covered = w.members.filter((m) => m[which]).length;
        // Unknown split: at worst none of these wagons are a covered type, at
        // best all of them are.
        if (covered > 0) high += w.total;
        if (covered === w.members.length) low += w.total;
        continue;
      }
      if (w[which]) {
        low += w.total;
        high += w.total;
      }
    }
    const pc = (n: number) => Math.round((n / total) * 1000) / 10;
    return { low, high, lowPercent: pc(low), highPercent: pc(high), uncertain: low !== high };
  };

  const unknownSplit = RAIPUR_WORKLOAD_2025_26
    .filter((w) => w.members && w.members.some((m) => m.banded) && w.members.some((m) => !m.banded))
    .reduce((sum, w) => sum + w.total, 0);

  return {
    total,
    counted: bandFor('configured'),
    classified: bandFor('classifiable'),
    banded: bandFor('banded'),
    unknownSplit
  };
}

/**
 * Every designation the app cannot serve, including those hidden inside a
 * combined line.
 *
 * Named rather than counted, because each needs a specific answer from a
 * document and the list is the work queue for getting them. The combined-line
 * members are the point: BFKN was invisible here while BRN and BFNS were
 * wrongly counted alongside it as unserved.
 */
export function unconfiguredDesignations(): Array<{ designation: string; note?: string }> {
  const out: Array<{ designation: string; note?: string }> = [];
  for (const w of RAIPUR_WORKLOAD_2025_26) {
    if (w.members && w.members.length > 0) {
      for (const m of w.members) {
        if (!m.configured) out.push({ designation: m.designation, note: m.note });
      }
      continue;
    }
    if (!w.configured) out.push({ designation: w.designation });
  }
  return out;
}
