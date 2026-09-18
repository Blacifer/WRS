/**
 * Wheel limits — the numbers a wheel reading is judged against
 * Indian Railways WRS Raipur
 *
 * On the floor, wheel tread diameters are chalked on the wheel disc
 * ("980.65 / 24") and recorded nowhere else. The checklist had "Wheel Tread
 * Diameter (Axle 1-4)" as a verdict a person ticked; it never took the
 * number. A number without the limit it is judged against is a number
 * nobody can act on, so the limits came first. They are here.
 *
 * Sources, in order of authority:
 *
 * 1. The Wagon Maintenance Manual, Chapter 6 (Bogie), section D "Wheels":
 *    "The last shop issue size and the condemning dia of different wheels
 *    shall be as per RDSO Drg. No. WD-88089/S-1" — the table gives, per
 *    wheel drawing, new / condemning (D) / last-shop-issue (E) diameters:
 *    22.9 t WD-97037-S-01: 1000 / 906 / 919; BLC CONTR-9404-S-13: 840 / 780
 *    / 793; and the footnote for 25 t CASNUB 22NLC (BOXNEL, BOYEL): minimum
 *    service 950, last shop issue 963. The same chapter gives the same-axle
 *    variation after turning (0.5 mm), the permissible flat (60 mm, BG
 *    wagons), the minimum flange thickness (16 mm) and the sharp-flange
 *    radius (5 mm), and for the rest says "refer IRCA Part III".
 * 2. IRCA Conference Rules Part III, 2020 edition (read 18 Sep 2026):
 *    Rule 2.8.9.2 — variation in tread diameter at wheel change: four-wheeled
 *    bogies 0.5 mm same axle / 13 mm same bogie / 25 mm same wagon; BLC
 *    wagons 0.5 / 5 / 13. Note 4: the same-axle figure applies at turning
 *    only; in service the tyre defect gauge governs. Plate 52 (Rule 3.3.5 and
 *    S 4.19.1) is the tyre defect gauge itself, dimensioned: deep flange 35,
 *    thin flange 16, sharp flange 5 R, root radius 13 R, flat 60 for BG
 *    wagons (note 4). S 4.19.1(a) repeats the 60 mm flat.
 * 3. IRIMEE (rskr.irimee.in) training notes, which agree with both, and are
 *    the only source for the hollow-tyre depth (5 mm).
 *
 * Every figure below names its source; only the hollow-tyre figure is
 * marked on the screen as resting on training notes.
 *
 * The 22NLC figure was 955 for both limits, from the IRIMEE bogie table,
 * which prints only a minimum. The manual's footnote gives both, and they
 * differ from it: 950 to condemn, 963 to leave a shop. The manual governs.
 *
 * Three verdicts, not two. "Last shop issue" is the diameter below which a
 * workshop must not send a wheel out (919 mm for BOXN), and it sits above
 * the condemning limit (906 mm) — a wheel between the two is still in
 * service on the line but must not leave a POH. That distinction is the
 * whole reason the workshop has its own figure.
 */

export type WheelFamily = 'CASNUB_BOXN' | 'CASNUB_22NLC' | 'LCCF_BLC';

export interface WheelDiameterLimits {
  family: WheelFamily;
  label: string;
  newMm: number;
  /** Below this a workshop must not issue the wheel. */
  lastShopIssueMm: number;
  condemnMm: number;
  drawing: string;
  /** Permitted difference in tread diameter, in mm. */
  variation: { sameAxle: number; sameBogie: number; sameWagon: number };
}

export const SOURCE = 'Wagon Maintenance Manual Ch.6 §D (RDSO Drg. WD-88089/S-1) for diameters; IRCA Conference Rules Part III (2020) Rule 2.8.9.2 for diameter variation and Plate 52 (tyre defect gauge, Rule 3.3.5 / S 4.19.1) for flange and flat limits; hollow tyre from IRIMEE training notes';
/** The one figure that still rests on the IRIMEE notes alone: IRCA Part III and the WMM do not print a hollow-tyre depth. */
export const AWAITING_IRCA = ['hollow tyre 5 mm'] as const;

export const WHEEL_DIAMETER_LIMITS: Record<WheelFamily, WheelDiameterLimits> = {
  CASNUB_BOXN: {
    family: 'CASNUB_BOXN', label: 'BCN / BOXN on CASNUB', newMm: 1000, lastShopIssueMm: 919, condemnMm: 906,
    drawing: 'WD-97037-S-01 (WMM Ch.6, WD-88089/S-1)', variation: { sameAxle: 0.5, sameBogie: 13, sameWagon: 25 }
  },
  CASNUB_22NLC: {
    // WMM Ch.6 §D, footnote to the WD-88089/S-1 table: "Minimum service diameter of wheel disc
    // in 25 T axle load having CASNUB 22 NLC bogie like BOXNEL, BOYEL etc. is 950 mm. Last shop
    // issue size of such wheels is 963 mm." (IRIMEE's bogie table prints 955 as a bare minimum.)
    family: 'CASNUB_22NLC', label: 'CASNUB 22NLC (25 t)', newMm: 1000, lastShopIssueMm: 963, condemnMm: 950,
    drawing: 'WD-88089/S-1 footnote (25 t, CASNUB 22NLC)', variation: { sameAxle: 0.5, sameBogie: 13, sameWagon: 25 }
  },
  LCCF_BLC: {
    // IRCA Part III Rule 2.8.9.2: BLC wagons 0.5 / 5 / 13 — tighter than the 13 / 25 of a four-wheeled bogie.
    family: 'LCCF_BLC', label: 'BLC on LCCF 20(C)', newMm: 840, lastShopIssueMm: 793, condemnMm: 780,
    drawing: 'CONTR-9404-S-13 (WMM Ch.6, WD-88089/S-1)', variation: { sameAxle: 0.5, sameBogie: 5, sameWagon: 13 }
  }
};

/** Flange and tread limits, common to BG C&W wheels. Standard = new / worn-wheel-profile figure. */
export const WHEEL_PROFILE_LIMITS = {
  flangeThicknessMm: { standard: 29.4, condemnAtOrBelow: 16, note: 'Thin flange: 16 mm or less (22 mm for high-speed stock). Measured about 13 mm from the flange tip.' },
  flangeHeightMm: { standard: 28.5, condemnAtOrAbove: 35, note: 'Deep flange: 35 mm or more, measured from the flange tip to a point on the tread 63.5 mm from the back of the wheel.' },
  rootRadiusMm: { standard: 14, condemnAtOrBelow: 13, note: 'Less radius at root of flange: 13 mm or less.' },
  flangeTipRadiusMm: { standard: 14.5, condemnAtOrBelow: 5, note: 'Sharp flange: 5 mm or less.' },
  hollowTyreMm: { standard: 0, condemnAtOrAbove: 5, note: 'Hollow tyre: 5 mm or more.' },
  flatTyreMm: { standard: 0, condemnAtOrAbove: 60, note: 'Flat tyre: 60 mm or more for BG wagons (50 mm for coaches).' },
  wheelGaugeMm: { nominal: 1600, min: 1599, max: 1602, note: 'Wheel gauge 1600 +2/−1 mm.' },
  diameterMeasuredAt: 'Tread diameter is measured 66.5 mm from the rim face (63.5 mm from the flange end).'
} as const;

/** Which limit table a wagon's wheels are judged against, from its bogie description. */
export function wheelFamilyFor(bogieDescription: string | null | undefined): WheelFamily | null {
  const d = String(bogieDescription || '').toUpperCase();
  if (!d) return null;
  if (d.includes('LCCF')) return 'LCCF_BLC';
  if (d.includes('NLC')) return 'CASNUB_22NLC';
  if (d.includes('CASNUB')) return 'CASNUB_BOXN';
  return null; // LWLH25 and anything else: no table held — record, do not judge.
}

export type WheelVerdict = 'PASS' | 'BELOW_SHOP_ISSUE' | 'CONDEMN';

export interface WheelReadingInput {
  treadDiameterMm: number;
  flangeThicknessMm?: number | null;
  flangeHeightMm?: number | null;
  rootRadiusMm?: number | null;
  flatMm?: number | null;
  hollowMm?: number | null;
}

export interface WheelJudgement {
  verdict: WheelVerdict;
  family: WheelFamily | null;
  /** One line per dimension read, each with the limit it was held against. */
  findings: Array<{ dimension: string; value: number; limit: string; verdict: WheelVerdict }>;
  source: string;
}

const r1 = (x: number) => Math.round(x * 10) / 10;

/** Judge one wheel's readings. A null family records the figures and judges nothing about diameter. */
export function judgeWheel(family: WheelFamily | null, r: WheelReadingInput): WheelJudgement {
  const findings: WheelJudgement['findings'] = [];
  const worse = (a: WheelVerdict, b: WheelVerdict): WheelVerdict => (a === 'CONDEMN' || b === 'CONDEMN' ? 'CONDEMN' : a === 'BELOW_SHOP_ISSUE' || b === 'BELOW_SHOP_ISSUE' ? 'BELOW_SHOP_ISSUE' : 'PASS');
  let verdict: WheelVerdict = 'PASS';

  if (family) {
    const L = WHEEL_DIAMETER_LIMITS[family];
    const v: WheelVerdict = r.treadDiameterMm < L.condemnMm ? 'CONDEMN' : r.treadDiameterMm < L.lastShopIssueMm ? 'BELOW_SHOP_ISSUE' : 'PASS';
    findings.push({ dimension: 'treadDiameterMm', value: r1(r.treadDiameterMm), limit: `last shop issue ${L.lastShopIssueMm} mm, condemn ${L.condemnMm} mm (${L.drawing})`, verdict: v });
    verdict = worse(verdict, v);
  } else {
    findings.push({ dimension: 'treadDiameterMm', value: r1(r.treadDiameterMm), limit: 'no diameter table held for this bogie — recorded, not judged', verdict: 'PASS' });
  }
  const P = WHEEL_PROFILE_LIMITS;
  const check = (dimension: string, value: number | null | undefined, ok: (x: number) => boolean, limit: string) => {
    if (value === null || value === undefined || !Number.isFinite(value)) return;
    const v: WheelVerdict = ok(value) ? 'PASS' : 'CONDEMN';
    findings.push({ dimension, value: r1(value), limit, verdict: v });
    verdict = worse(verdict, v);
  };
  check('flangeThicknessMm', r.flangeThicknessMm, (x) => x > P.flangeThicknessMm.condemnAtOrBelow, `thin flange at or below ${P.flangeThicknessMm.condemnAtOrBelow} mm`);
  check('flangeHeightMm', r.flangeHeightMm, (x) => x < P.flangeHeightMm.condemnAtOrAbove, `deep flange at or above ${P.flangeHeightMm.condemnAtOrAbove} mm`);
  check('rootRadiusMm', r.rootRadiusMm, (x) => x > P.rootRadiusMm.condemnAtOrBelow, `root radius at or below ${P.rootRadiusMm.condemnAtOrBelow} mm`);
  check('flatMm', r.flatMm, (x) => x < P.flatTyreMm.condemnAtOrAbove, `flat tyre at or above ${P.flatTyreMm.condemnAtOrAbove} mm`);
  check('hollowMm', r.hollowMm, (x) => x < P.hollowTyreMm.condemnAtOrAbove, `hollow tyre at or above ${P.hollowTyreMm.condemnAtOrAbove} mm`);
  return { verdict, family, findings, source: SOURCE };
}

export interface WheelSetReading { axle: 1 | 2 | 3 | 4; side: 'L' | 'R'; treadDiameterMm: number }

export interface WheelSetJudgement {
  /** Every pair, bogie and the wagon, against the permitted variation. */
  variations: Array<{ scope: string; members: string[]; spreadMm: number; limitMm: number; ok: boolean }>;
  ok: boolean;
  wheelsRead: number;
  missing: string[];
}

/**
 * The variation rules. Axles 1–2 are bogie 1, 3–4 bogie 2. A wheel that has
 * not been read is named as missing rather than treated as matching.
 */
export function judgeWheelSet(family: WheelFamily | null, readings: WheelSetReading[]): WheelSetJudgement {
  const lim = family ? WHEEL_DIAMETER_LIMITS[family].variation : WHEEL_DIAMETER_LIMITS.CASNUB_BOXN.variation;
  const key = (a: number, s: string) => `A${a}${s}`;
  const by = new Map<string, number>();
  for (const r of readings) by.set(key(r.axle, r.side), r.treadDiameterMm);
  const missing: string[] = [];
  for (const a of [1, 2, 3, 4]) for (const s of ['L', 'R']) if (!by.has(key(a, s))) missing.push(key(a, s));
  const spread = (keys: string[]) => {
    const vals = keys.filter((k) => by.has(k)).map((k) => by.get(k)!);
    return vals.length >= 2 ? r1(Math.max(...vals) - Math.min(...vals)) : null;
  };
  const variations: WheelSetJudgement['variations'] = [];
  const add = (scope: string, members: string[], limitMm: number) => {
    const s = spread(members);
    if (s === null) return;
    variations.push({ scope, members, spreadMm: s, limitMm, ok: s <= limitMm });
  };
  for (const a of [1, 2, 3, 4]) add(`axle ${a}`, [key(a, 'L'), key(a, 'R')], lim.sameAxle);
  add('bogie 1', ['A1L', 'A1R', 'A2L', 'A2R'], lim.sameBogie);
  add('bogie 2', ['A3L', 'A3R', 'A4L', 'A4R'], lim.sameBogie);
  add('wagon', ['A1L', 'A1R', 'A2L', 'A2R', 'A3L', 'A3R', 'A4L', 'A4R'], lim.sameWagon);
  return { variations, ok: variations.every((v) => v.ok), wheelsRead: by.size, missing };
}
