/**
 * A gauge that reads high — seen in the distribution it leaves behind
 * Indian Railways WRS Raipur
 *
 * The sorting bench records which gauge each reading was taken with. Springs
 * of one kind, on one bench, over enough readings, have a free-height
 * distribution the shop's other gauges also see. A gauge that is bent, worn
 * at the anvil, or read against the wrong zero shows up as that same
 * distribution shifted — every spring a millimetre taller than the others
 * say it is. Nobody sees this on the bench, because each reading on its
 * own is plausible; it is visible only in the records, side by side.
 *
 * G-95 bands are three millimetres wide. A systematic shift of one
 * millimetre moves a third of a band's worth of springs across a line —
 * PASSing some the other gauges would condemn, or condemning some they
 * would pass. So the threshold is one millimetre, on at least thirty
 * readings on each side of the comparison, and it is advisory: a supervisor
 * puts the gauge against the master and finds out.
 *
 * The comparison is median against median, within the same bogie type,
 * condition and position, so a gauge used only on inner springs is not
 * compared to the outer-spring population. A gauge that is the shop's only
 * gauge for a kind has nothing to be compared with, and is said so.
 */

export const DRIFT_THRESHOLD_MM = 1.0;
export const MIN_READINGS_EACH_SIDE = 30;

export interface Reading {
  gaugeCode: string;
  /** bogieType|condition|position — the population a reading belongs to. */
  kind: string;
  heightMm: number;
}

export interface GaugeDriftLine {
  gaugeCode: string;
  kind: string;
  n: number;
  medianMm: number;
  /** The other gauges on the same kind, pooled. */
  othersN: number;
  othersMedianMm: number | null;
  /** This gauge's median less the others'. Positive: this gauge reads high. */
  shiftMm: number | null;
  flagged: boolean;
  note: string;
  noteHi: string;
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const r1 = (x: number) => Math.round(x * 10) / 10;

export function gaugeDrift(readings: Reading[]): GaugeDriftLine[] {
  const byKind = new Map<string, Map<string, number[]>>();
  for (const r of readings) {
    if (!r.gaugeCode || !Number.isFinite(r.heightMm)) continue;
    const g = byKind.get(r.kind) || new Map<string, number[]>();
    // Append in place. Copying the array on every reading is quadratic —
    // fifteen seconds for a year of the bench in the standard report next door.
    let arr = g.get(r.gaugeCode);
    if (!arr) { arr = []; g.set(r.gaugeCode, arr); }
    arr.push(r.heightMm);
    byKind.set(r.kind, g);
  }
  const out: GaugeDriftLine[] = [];
  for (const [kind, gauges] of byKind) {
    for (const [gaugeCode, hs] of gauges) {
      if (hs.length < MIN_READINGS_EACH_SIDE) continue;
      const others: number[] = [];
      for (const [other, ohs] of gauges) if (other !== gaugeCode) others.push(...ohs);
      const med = median(hs);
      if (others.length < MIN_READINGS_EACH_SIDE) {
        out.push({ gaugeCode, kind, n: hs.length, medianMm: r1(med), othersN: others.length, othersMedianMm: null, shiftMm: null, flagged: false,
          note: others.length === 0 ? 'The only gauge used on this kind — nothing to compare it with.' : `Only ${others.length} readings on other gauges for this kind; ${MIN_READINGS_EACH_SIDE} needed to compare.`,
          noteHi: others.length === 0 ? 'इस प्रकार पर यही एक गेज इस्तेमाल हुआ — तुलना के लिए कुछ नहीं।' : `इस प्रकार पर दूसरे गेजों की केवल ${others.length} रीडिंग; तुलना के लिए ${MIN_READINGS_EACH_SIDE} चाहिए।` });
        continue;
      }
      const omed = median(others);
      const shift = r1(med - omed);
      const flagged = Math.abs(shift) >= DRIFT_THRESHOLD_MM;
      out.push({ gaugeCode, kind, n: hs.length, medianMm: r1(med), othersN: others.length, othersMedianMm: r1(omed), shiftMm: shift, flagged,
        note: flagged
          ? `Reads ${Math.abs(shift)} mm ${shift > 0 ? 'higher' : 'lower'} than the shop's other gauges on this kind (median ${r1(med)} vs ${r1(omed)}, ${hs.length} vs ${others.length} readings). Put it against the master.`
          : `Within ${DRIFT_THRESHOLD_MM} mm of the shop's other gauges (${shift >= 0 ? '+' : ''}${shift} mm over ${hs.length} readings).`,
        noteHi: flagged
          ? `इस प्रकार पर शॉप के दूसरे गेजों से ${Math.abs(shift)} मिमी ${shift > 0 ? 'ऊँचा' : 'नीचा'} पढ़ता है (मध्यमान ${r1(med)} बनाम ${r1(omed)}, ${hs.length} बनाम ${others.length} रीडिंग)। इसे मास्टर गेज से मिलाएँ।`
          : `शॉप के दूसरे गेजों के ${DRIFT_THRESHOLD_MM} मिमी के भीतर (${hs.length} रीडिंग पर ${shift >= 0 ? '+' : ''}${shift} मिमी)।` });
    }
  }
  return out.sort((a, b) => Math.abs(b.shiftMm ?? 0) - Math.abs(a.shiftMm ?? 0));
}
