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
 * Source: Indian Railways' own training material — IRIMEE (rskr.irimee.in),
 * "Wheel Set / Wheel Defects" (STC/NBQ) and "Types of Bogies in Wagon Stock",
 * which give the tread-diameter table by wheel type with the drawing it
 * comes from (WD-97037 S-01 for BCN/BOXN on CASNUB), the permitted variation
 * within an axle, a bogie and a wagon, and the condemning limits for flange
 * and tread defects. Every figure below names that source; nothing is
 * inferred. The workshop should confirm them against IRCA Part III / the WMM
 * before relying on them for a release, and the readiness of that check is
 * stated on the screen.
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

export const SOURCE = 'IRIMEE STC training notes "Wheel Set / Wheel Defects" and "Types of Bogies in Wagon Stock" (rskr.irimee.in)';

export const WHEEL_DIAMETER_LIMITS: Record<WheelFamily, WheelDiameterLimits> = {
  CASNUB_BOXN: {
    family: 'CASNUB_BOXN', label: 'BCN / BOXN on CASNUB', newMm: 1000, lastShopIssueMm: 919, condemnMm: 906,
    drawing: 'WD-97037 S-01', variation: { sameAxle: 0.5, sameBogie: 13, sameWagon: 25 }
  },
  CASNUB_22NLC: {
    // The bogie table gives only a minimum for 22NLC; the last-shop-issue figure is not published there.
    family: 'CASNUB_22NLC', label: 'CASNUB 22NLC (25 t)', newMm: 1000, lastShopIssueMm: 955, condemnMm: 955,
    drawing: 'WD-97037 S-01 (minimum 955 mm for 22NLC)', variation: { sameAxle: 0.5, sameBogie: 13, sameWagon: 25 }
  },
  LCCF_BLC: {
    family: 'LCCF_BLC', label: 'BLC on LCCF 20(C)', newMm: 840, lastShopIssueMm: 793, condemnMm: 780,
    drawing: 'CONTR-9404-S/13', variation: { sameAxle: 0.5, sameBogie: 13, sameWagon: 25 }
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
