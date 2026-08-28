/**
 * Reading an Indian Railways wagon number
 * Indian Railways WRS Raipur
 *
 * WHY THIS IS WORTH MORE THAN IT LOOKS
 * ------------------------------------
 * An eleven-digit wagon number is not an arbitrary label. Railway Board letter
 * 2000/M(N)/60/2 (4 July 2003), reproduced in WMM 2.0 §417, gives it a
 * structure:
 *
 *     C1 C2   type of wagon
 *     C3 C4   owning railway
 *     C5 C6   year of manufacture
 *     C7..C10 individual wagon number
 *     C11     check digit
 *
 * Two things follow, and neither needs a model.
 *
 * FIRST: the app stops asking a question it can answer itself. Wagon type,
 * owning railway and build year are all in the number the inspector has
 * already entered or photographed. Asking for the type afterwards is asking
 * someone to retype what they just gave us.
 *
 * SECOND, and more important: the check digit makes a wrong number
 * self-detecting. This system's sharpest single-keystroke risk is a wagon
 * number wrong by one digit, which attaches an entire overhaul to a different
 * vehicle and is discovered months later, if ever. A transposed or misread
 * digit almost always breaks the check, so the mistake surfaces at the moment
 * it is made rather than at an audit.
 *
 * That second point also upgrades the camera. Wagon-number OCR previously
 * offered its best guess and asked a human to eyeball it. It can now check its
 * own reading against the arithmetic before offering it at all.
 */

/** Wagon type codes, WMM 2.0 §417 — digits C1 and C2. */
export const TYPE_CODES: Record<string, string> = {
  // Open wagons, 10-29
  '10': 'BOXN', '11': 'BOXNHA', '12': 'BOXNHS', '13': 'BOXNCR', '14': 'BOXNLW',
  '15': 'BOXNB', '16': 'BOXNF', '17': 'BOXNG', '18': 'BOY', '19': 'BOST',
  '20': 'BOXNAL', '22': 'BOXNHL',
  // Covered wagons, 30-39
  '30': 'BCNA', '31': 'BCNAHS', '32': 'BCCNR', '33': 'BCNHL',
  // Tank wagons, 40-46
  '40': 'BTPN', '41': 'BTPNHS', '42': 'BTPGLN', '43': 'BTALN', '44': 'BTCS',
  '45': 'BTPH', '46': 'BTAP',
  // Flat wagons, 55-69
  '55': 'BRNA', '56': 'BRNAHS', '57': 'BFNS', '58': 'BOMN', '59': 'BRSTH',
  '60': 'BFAT', '61': 'BLCA', '62': 'BLCB',
  // Hopper wagons, 70-79
  '70': 'BOBYN', '71': 'BOBYNHS', '72': 'BOBRN', '73': 'BOBRNHS', '74': 'BOBRAL',
  // Well wagons, 80-84
  '80': 'BWTB',
  // Brake vans, 85-89
  '85': 'BVZC', '86': 'BVZI'
};

/** Owning railway codes, WMM 2.0 §417 — digits C3 and C4. */
export const RAILWAY_CODES: Record<string, string> = {
  '01': 'Central Railway',
  '02': 'Eastern Railway',
  '03': 'Northern Railway',
  '04': 'North East Railway',
  '05': 'Northeast Frontier Railway',
  '06': 'Southern Railway',
  '07': 'South Eastern Railway',
  '08': 'Western Railway'
};

export interface WagonNumberReading {
  /** The eleven digits, stripped of spacing. */
  digits: string;
  /** Whether it is eleven digits and the check digit agrees. */
  valid: boolean;
  /** Why not, when it is not. Written for an inspector, not a developer. */
  problem?: string;
  /** Designation from C1-C2, when the code is one we hold. */
  wagonType?: string;
  /** Owning railway from C3-C4. */
  owningRailway?: string;
  /** Year of manufacture from C5-C6, as printed — two digits. */
  yearCode?: string;
  /** Serial from C7-C10. */
  serial?: string;
  /** The check digit the number carries. */
  checkDigit?: number;
  /** The check digit the first ten imply. Differs when something is wrong. */
  expectedCheckDigit?: number;
}

/**
 * The check digit, from the ten preceding digits.
 *
 * WMM 2.0 §417, six steps, reproduced faithfully rather than replaced with an
 * equivalent-looking standard algorithm. It resembles other transport check
 * digits but the position weighting is specified here and is what matters.
 *
 *   1  S1 = C2 + C4 + C6 + C8 + C10          (even positions)
 *   2  multiply S1 by three
 *   3  S2 = C1 + C3 + C5 + C7 + C9           (odd positions)
 *   4  S4 = 3·S1 + S2
 *   5  round S4 up to the next multiple of ten
 *   6  the check digit is what must be added to reach it
 *      — and is zero when S4 is already a multiple of ten
 */
export function computeCheckDigit(firstTen: string): number {
  if (!/^\d{10}$/.test(firstTen)) {
    throw new Error('The check digit is computed from exactly ten digits.');
  }
  const d = firstTen.split('').map(Number);

  // Positions are one-based in the manual: C1 is d[0].
  const s1 = d[1] + d[3] + d[5] + d[7] + d[9];
  const s2 = d[0] + d[2] + d[4] + d[6] + d[8];
  const s4 = 3 * s1 + s2;

  const remainder = s4 % 10;
  return remainder === 0 ? 0 : 10 - remainder;
}

/**
 * Parses everything the number itself can tell us.
 *
 * Named parse rather than read to keep it distinct from the OCR module's
 * readWagonNumber, which reads a number off a photograph. This one reads
 * meaning out of the digits once you have them.
 *
 * Deliberately returns a reading for a malformed number too, with `problem`
 * set, rather than throwing. The caller is usually a screen with a
 * half-typed number in it, and an exception on every keystroke would be
 * useless to it.
 */
export function parseWagonNumber(raw: string): WagonNumberReading {
  const digits = (raw || '').replace(/\D/g, '');

  if (digits.length !== 11) {
    return {
      digits,
      valid: false,
      problem:
        digits.length < 11
          ? `A wagon number is eleven digits — this has ${digits.length}.`
          : `A wagon number is eleven digits — this has ${digits.length}.`
    };
  }

  const checkDigit = Number(digits[10]);
  const expected = computeCheckDigit(digits.slice(0, 10));

  const typeCode = digits.slice(0, 2);
  const railwayCode = digits.slice(2, 4);

  const reading: WagonNumberReading = {
    digits,
    valid: checkDigit === expected,
    wagonType: TYPE_CODES[typeCode],
    owningRailway: RAILWAY_CODES[railwayCode],
    yearCode: digits.slice(4, 6),
    serial: digits.slice(6, 10),
    checkDigit,
    expectedCheckDigit: expected
  };

  if (!reading.valid) {
    reading.problem =
      `The check digit does not match — this number reads as ${checkDigit} but the ` +
      `other ten digits give ${expected}. Usually one digit has been misread or ` +
      `two transposed. Check it against the wagon before continuing.`;
  }

  return reading;
}

/**
 * Whether a reading is safe to accept without a person confirming it.
 *
 * A valid check digit is strong evidence but not proof: it catches every
 * single-digit error and most transpositions, and misses the rest. So this
 * says "no reason to doubt it", never "it is certainly right", and the camera
 * still shows a reading before using it.
 */
export function passesCheck(raw: string): boolean {
  return parseWagonNumber(raw).valid;
}
