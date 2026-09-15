/**
 * The shop that measures the standard
 * Indian Railways WRS Raipur
 *
 * RDSO published the G-95 bands from design and from the stock it could
 * sample. What no shop has ever been able to give back is the other
 * direction: what the springs that actually pass through a repair shop look
 * like, in numbers — where the free-height distribution of used NLB outer
 * springs sits, how much of it lands in each band, how much is condemned,
 * and how many readings cluster hard against a band edge, which is where a
 * half-millimetre of gauge or of reading style decides which nest a spring
 * joins. At seven hundred springs a shift, this shop accumulates in a month
 * what a design office could not sample in a year.
 *
 * This report is those numbers, and only those numbers. Every line carries
 * its n. Nothing is fitted, smoothed or extrapolated: a distribution is a
 * histogram in half-millimetre bins, a centre is a median, and a spread is
 * the 10th and 90th percentile. A kind with fewer than MIN_N readings is
 * listed as "too few to report" with its count, because a distribution of
 * twelve springs is an anecdote.
 *
 * Bench readings only (the wagon flow's forty rows would add noise, not
 * signal, until it is larger), measured heights only (a strip-read band has
 * no height to speak of), undone and corrected taps excluded.
 */

import { getRDSOTable, normalizePosition } from '../classification/tables.ts';
import type { BogieType, SpringCondition, SpringPosition } from '../types.ts';

export const MIN_N = 30;
export const BIN_MM = 0.5;
/** A reading this close to a band boundary is "on the edge". Half a bin. */
export const EDGE_MM = 0.5;

export interface StandardReading {
  bogieType: BogieType;
  condition: SpringCondition;
  position: SpringPosition;
  heightMm: number;
  band: string | null;
  status: 'PASS' | 'CONDEMNED';
}

export interface StandardLine {
  bogieType: BogieType;
  condition: SpringCondition;
  position: 'OUTER' | 'INNER' | 'SNUBBER';
  table: string | null;
  n: number;
  reportable: boolean;
  condemned: number;
  condemnedPct: number | null;
  medianMm: number | null;
  p10Mm: number | null;
  p90Mm: number | null;
  /** RDSO's own limits, for the reader to set the distribution against. */
  limits: { nominal: number | null; condemnMin: number; condemnMax: number } | null;
  bands: Array<{ band: string; roman: string; minMm: number; maxMm: number; n: number; pct: number | null }>;
  /** Half-millimetre histogram over the observed range. */
  histogram: Array<{ fromMm: number; n: number }>;
  /** Readings within EDGE_MM of any band boundary, and the boundary most crowded. */
  onEdge: { n: number; pct: number | null; busiestBoundaryMm: number | null; busiestN: number };
  /** Passing readings below RDSO's nominal height: springs kept that have already lost most of their set. */
  belowNominalPassPct: number | null;
}

export interface StandardReport {
  generatedAt: string;
  readings: number;
  lines: StandardLine[];
  notes: string[];
}

const q = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
const r1 = (x: number) => Math.round(x * 10) / 10;
const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);

export function standardReport(readings: StandardReading[], generatedAt = new Date().toISOString()): StandardReport {
  const groups = new Map<string, StandardReading[]>();
  for (const r of readings) {
    if (!Number.isFinite(r.heightMm)) continue;
    const key = `${r.bogieType}|${r.condition}|${normalizePosition(r.position)}`;
    groups.set(key, [...(groups.get(key) || []), r]);
  }

  const lines: StandardLine[] = [];
  for (const [key, rows] of groups) {
    const [bogieType, condition, position] = key.split('|') as [BogieType, SpringCondition, 'OUTER' | 'INNER' | 'SNUBBER'];
    const table = getRDSOTable(bogieType, condition, position);
    const hs = rows.map((r) => r.heightMm).sort((a, b) => a - b);
    const n = hs.length;
    const reportable = n >= MIN_N;
    const condemned = rows.filter((r) => r.status === 'CONDEMNED').length;

    // The engine's boundary rule, so the shares add up: a height on a shared
    // boundary belongs to the higher band; only the top band owns its ceiling.
    const bands = (table?.bands || []).map((b) => {
      const inBand = rows.filter((r) => r.status === 'PASS' && r.heightMm >= b.minHeight && (r.heightMm < b.maxHeight || (b.isHighestBand && r.heightMm <= b.maxHeight))).length;
      return { band: b.band, roman: b.bandRoman, minMm: b.minHeight, maxMm: b.maxHeight, n: reportable ? inBand : 0, pct: reportable ? pct(inBand, n) : null };
    });

    // Boundaries: every band edge, plus the condemning limits.
    const boundaries = new Set<number>();
    for (const b of table?.bands || []) { boundaries.add(b.minHeight); boundaries.add(b.maxHeight); }
    if (table) { boundaries.add(table.condemningMinHeight); boundaries.add(table.condemningMaxHeight); }
    const edgeCounts = new Map<number, number>();
    let onEdgeN = 0;
    for (const h of hs) {
      let nearest: number | null = null;
      for (const b of boundaries) if (Math.abs(h - b) <= EDGE_MM && (nearest === null || Math.abs(h - b) < Math.abs(h - nearest))) nearest = b;
      if (nearest !== null) { onEdgeN++; edgeCounts.set(nearest, (edgeCounts.get(nearest) || 0) + 1); }
    }
    let busiest: [number | null, number] = [null, 0];
    for (const [b, c] of edgeCounts) if (c > busiest[1]) busiest = [b, c];

    const histogram: Array<{ fromMm: number; n: number }> = [];
    if (reportable) {
      const lo = Math.floor(hs[0] / BIN_MM) * BIN_MM;
      const hi = Math.floor(hs[n - 1] / BIN_MM) * BIN_MM;
      for (let b = lo; b <= hi + 1e-9; b += BIN_MM) histogram.push({ fromMm: r1(b), n: 0 });
      for (const h of hs) { const idx = Math.round((Math.floor(h / BIN_MM) * BIN_MM - lo) / BIN_MM); if (histogram[idx]) histogram[idx].n++; }
    }

    const passing = rows.filter((r) => r.status === 'PASS');
    // Not every table publishes a nominal height; where it does not, the figure is not made up.
    const nominal = typeof table?.nominalFreeHeight === 'number' ? table.nominalFreeHeight : null;
    const belowNominal = nominal !== null ? passing.filter((r) => r.heightMm < nominal).length : 0;

    lines.push({
      bogieType, condition, position,
      table: table?.tableReference ?? null,
      n, reportable, condemned,
      condemnedPct: reportable ? pct(condemned, n) : null,
      medianMm: reportable ? r1(q(hs, 0.5)) : null,
      p10Mm: reportable ? r1(q(hs, 0.1)) : null,
      p90Mm: reportable ? r1(q(hs, 0.9)) : null,
      limits: table ? { nominal, condemnMin: table.condemningMinHeight, condemnMax: table.condemningMaxHeight } : null,
      bands,
      histogram,
      onEdge: { n: reportable ? onEdgeN : 0, pct: reportable ? pct(onEdgeN, n) : null, busiestBoundaryMm: reportable ? busiest[0] : null, busiestN: reportable ? busiest[1] : 0 },
      belowNominalPassPct: reportable && nominal !== null && passing.length ? pct(belowNominal, passing.length) : null
    });
  }
  lines.sort((a, b) => b.n - a.n);

  const notes = [
    'Bench readings with a measured height only; strip-read bands, undone taps and corrected taps are excluded.',
    `A kind is reported from ${MIN_N} readings. Below that its count is shown and nothing else.`,
    `Histogram bins are ${BIN_MM} mm. Centre is the median; spread is the 10th to 90th percentile. Nothing is fitted or smoothed.`,
    `"On the edge" counts readings within ${EDGE_MM} mm of a band boundary or a condemning limit — where a half-millimetre of gauge or of reading decides the nest. With bands 3 mm wide, about a third of all readings sit that close to some boundary by geometry alone; the figure means something only against that baseline, and the busiest single boundary is the one to look at.`
  ];
  return { generatedAt, readings: readings.length, lines, notes };
}
