/**
 * Parts in, parts out
 * Indian Railways WRS Raipur
 *
 * WHAT THIS IS FOR
 * ----------------
 * The DRM's second ask, in his own words, is about what happens after a wagon
 * leaves: that nobody should be able to say something was missing, or that a
 * part went back rusted or damaged, and find no answer on the record.
 *
 * A count of checklist lines does not answer that. What answers it is a
 * ledger: everything recorded coming off during dismantling, everything
 * recorded going back on during reassembly, and the difference named — with a
 * photograph, a person and a time against each entry.
 *
 * WHY THE BALANCE IS DERIVED AND NEVER STORED
 * -------------------------------------------
 * A stored total can be adjusted until it agrees with itself, which is exactly
 * what makes it useless as evidence. Every figure here is computed from the
 * immutable rows each time it is asked for, so the summary and the events can
 * never disagree.
 *
 * WHY IT SUGGESTS RATHER THAN JUST REPORTS
 * ----------------------------------------
 * "One friction wedge outstanding" is a finding. "One friction wedge
 * outstanding; stores holds 12 in bin B-14; WMM 2.0 §309B requires all four"
 * is something a fitter can act on without leaving the wagon. The suggestion
 * is assembled from facts this system already holds — the ledger, the stores
 * level, the checklist's own cited standard. Nothing in it is generated, and
 * no quantity or limit in it comes from anywhere but a record.
 */

import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export type PartEvent = 'REMOVED' | 'REFITTED' | 'REPLACED' | 'SCRAPPED' | 'NOT_FITTED';

export const PART_EVENTS: readonly PartEvent[] = [
  'REMOVED',
  'REFITTED',
  'REPLACED',
  'SCRAPPED',
  'NOT_FITTED'
] as const;

/**
 * Events that require a stated reason.
 *
 * A part that is not going back needs a decision recorded against it. Without
 * this the only way to balance a wagon is to write something untrue, and a
 * ledger people must lie in to close a wagon is worse than no ledger at all.
 */
export const EVENTS_NEEDING_REASON: readonly PartEvent[] = ['SCRAPPED', 'NOT_FITTED'] as const;

export interface RecordPartEventInput {
  wagonId: string;
  wagonNumber: string;
  category: string;
  partName: string;
  bogiePosition?: string | null;
  event: PartEvent;
  quantity?: number;
  reason?: string | null;
  photoId?: string | null;
  storesItemId?: string | null;
  componentSerial?: string | null;
  stage: string;
  inspectorId: string;
  inspectorName: string;
}

export interface PartLedgerEntry {
  id: string;
  wagonId: string;
  wagonNumber: string;
  partKey: string;
  category: string;
  partName: string;
  bogiePosition: string;
  event: PartEvent;
  quantity: number;
  reason: string | null;
  photoId: string | null;
  storesItemId: string | null;
  componentSerial: string | null;
  stage: string;
  inspectorId: string;
  inspectorName: string;
  createdAt: string;
}

export interface PartBalance {
  partKey: string;
  category: string;
  partName: string;
  bogiePosition: string;
  removed: number;
  refitted: number;
  replaced: number;
  scrapped: number;
  notFitted: number;
  /** removed - (refitted + replaced + scrapped + notFitted). Zero is balanced. */
  outstanding: number;
  /** True when something went back that was never recorded coming off. */
  unaccounted: boolean;
  photographs: number;
  suggestion: string | null;
}

export interface Reconciliation {
  wagonNumber: string;
  balanced: boolean;
  totalRemoved: number;
  totalBack: number;
  outstandingParts: PartBalance[];
  unaccountedParts: PartBalance[];
  parts: PartBalance[];
  /** Plain words for the gate panel and the certificate. */
  summary: string;
}

/**
 * One physical position, so two side frames on one bogie are two entries
 * rather than one part counted twice.
 *
 * Normalised hard because this string is the join key between a removal
 * recorded on a Tuesday and a refit recorded on a Friday, quite possibly by
 * different people typing the same part name differently.
 */
export function partKeyFor(category: string, partName: string, bogiePosition?: string | null): string {
  const norm = (v: string) => v.trim().toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_\-.]/g, '');
  return [norm(category), norm(partName), norm(bogiePosition || 'NONE')].join('|');
}

export class PartLedgerRepository {
  private db: DatabaseSync;

  // Written out rather than as a constructor parameter property: Node runs
  // this project's TypeScript in strip-only mode, which rejects that shorthand
  // at runtime even though tsc accepts it.
  constructor(db: DatabaseSync) {
    this.db = db;
  }

  record(input: RecordPartEventInput): PartLedgerEntry {
    const id = `wpl_${randomUUID()}`;
    const partKey = partKeyFor(input.category, input.partName, input.bogiePosition);

    this.db
      .prepare(
        `INSERT INTO wagon_part_ledger
           (id, wagon_id, wagon_number, part_key, category, part_name, bogie_position,
            event, quantity, reason, photo_id, stores_item_id, component_serial,
            stage, inspector_id, inspector_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.wagonId,
        input.wagonNumber,
        partKey,
        input.category,
        input.partName,
        input.bogiePosition || 'NONE',
        input.event,
        Math.max(1, Math.floor(input.quantity ?? 1)),
        input.reason ?? null,
        input.photoId ?? null,
        input.storesItemId ?? null,
        input.componentSerial ?? null,
        input.stage,
        input.inspectorId,
        input.inspectorName
      );

    return this.get(id)!;
  }

  get(id: string): PartLedgerEntry | null {
    const row = this.db.prepare('SELECT * FROM wagon_part_ledger WHERE id = ?').get(id) as any;
    return row ? this.map(row) : null;
  }

  /** Every event for one wagon, oldest first — the story from entry to exit. */
  entries(wagonNumber: string): PartLedgerEntry[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM wagon_part_ledger WHERE wagon_number = ?
         ORDER BY created_at ASC, rowid ASC`
      )
      .all(wagonNumber) as any[];
    return rows.map((r) => this.map(r));
  }

  /**
   * Does what came off match what went back on?
   *
   * `storesLookup` is injected rather than queried here so that the balance
   * arithmetic stays independent of the stores schema and can be tested on its
   * own. When it is absent the suggestions simply say less; they never guess a
   * quantity.
   */
  reconcile(
    wagonNumber: string,
    storesLookup?: (partName: string) => { available: number; binLocation: string | null } | null,
    standardLookup?: (partKey: string) => string | null
  ): Reconciliation {
    const rows = this.db
      .prepare(
        `SELECT part_key, category, part_name, bogie_position, event,
                SUM(quantity) AS qty,
                SUM(CASE WHEN photo_id IS NOT NULL THEN 1 ELSE 0 END) AS photos
         FROM wagon_part_ledger
         WHERE wagon_number = ?
         GROUP BY part_key, event`
      )
      .all(wagonNumber) as any[];

    const byKey = new Map<string, PartBalance>();
    for (const r of rows) {
      const key = String(r.part_key);
      const b: PartBalance = byKey.get(key) ?? {
        partKey: key,
        category: String(r.category),
        partName: String(r.part_name),
        bogiePosition: String(r.bogie_position),
        removed: 0,
        refitted: 0,
        replaced: 0,
        scrapped: 0,
        notFitted: 0,
        outstanding: 0,
        unaccounted: false,
        photographs: 0,
        suggestion: null
      };
      const qty = Number(r.qty) || 0;
      b.photographs += Number(r.photos) || 0;
      if (r.event === 'REMOVED') b.removed += qty;
      else if (r.event === 'REFITTED') b.refitted += qty;
      else if (r.event === 'REPLACED') b.replaced += qty;
      else if (r.event === 'SCRAPPED') b.scrapped += qty;
      else if (r.event === 'NOT_FITTED') b.notFitted += qty;
      byKey.set(key, b);
    }

    const parts = [...byKey.values()];
    for (const b of parts) {
      const accountedFor = b.refitted + b.replaced + b.scrapped + b.notFitted;
      b.outstanding = b.removed - accountedFor;
      /*
       * More went back than came off. Usually a removal nobody recorded, which
       * is worth naming rather than quietly netting off: an unrecorded removal
       * is precisely the gap this ledger exists to close, and treating it as
       * "balanced" would hide it.
       */
      b.unaccounted = b.outstanding < 0;
      b.suggestion = suggestionFor(b, storesLookup, standardLookup);
    }

    const outstandingParts = parts.filter((p) => p.outstanding > 0);
    const unaccountedParts = parts.filter((p) => p.unaccounted);
    const totalRemoved = parts.reduce((n, p) => n + p.removed, 0);
    const totalBack = parts.reduce((n, p) => n + p.refitted + p.replaced, 0);

    return {
      wagonNumber,
      balanced: outstandingParts.length === 0 && unaccountedParts.length === 0,
      totalRemoved,
      totalBack,
      outstandingParts,
      unaccountedParts,
      parts: parts.sort((a, b) => b.outstanding - a.outstanding || a.partName.localeCompare(b.partName)),
      summary: summarise(parts, outstandingParts, unaccountedParts, totalRemoved, totalBack)
    };
  }

  private map(r: any): PartLedgerEntry {
    return {
      id: r.id,
      wagonId: r.wagon_id,
      wagonNumber: r.wagon_number,
      partKey: r.part_key,
      category: r.category,
      partName: r.part_name,
      bogiePosition: r.bogie_position,
      event: r.event,
      quantity: Number(r.quantity),
      reason: r.reason ?? null,
      photoId: r.photo_id ?? null,
      storesItemId: r.stores_item_id ?? null,
      componentSerial: r.component_serial ?? null,
      stage: r.stage,
      inspectorId: r.inspector_id,
      inspectorName: r.inspector_name,
      createdAt: r.created_at
    };
  }
}

/**
 * What a fitter should do next, in one sentence.
 *
 * Every figure in it is read from a record — the ledger, the stores level, the
 * checklist's own cited standard. Nothing is generated and nothing is
 * inferred: when stores are unknown the sentence simply says less.
 */
function suggestionFor(
  b: PartBalance,
  storesLookup?: (partName: string) => { available: number; binLocation: string | null } | null,
  standardLookup?: (partKey: string) => string | null
): string | null {
  if (b.unaccounted) {
    const extra = Math.abs(b.outstanding);
    return (
      `${extra} more went back on than were recorded coming off. ` +
      `Either a removal was not recorded, or one of the refits was entered twice. ` +
      `Check the entries for this position before the gate.`
    );
  }
  if (b.outstanding <= 0) return null;

  const bits: string[] = [
    `${b.removed} came off, ${b.refitted + b.replaced} back on — ${b.outstanding} outstanding.`
  ];

  const stock = storesLookup?.(b.partName);
  if (stock && stock.available > 0) {
    bits.push(
      `Stores holds ${stock.available}${stock.binLocation ? ` (bin ${stock.binLocation})` : ''}.`
    );
  } else if (stock) {
    bits.push('Stores shows none in stock — raise an indent.');
  }

  const std = standardLookup?.(b.partKey);
  if (std) bits.push(std);

  bits.push('If it is deliberately not being refitted, record that with a reason.');
  return bits.join(' ');
}

function summarise(
  parts: PartBalance[],
  outstanding: PartBalance[],
  unaccounted: PartBalance[],
  totalRemoved: number,
  totalBack: number
): string {
  if (parts.length === 0) {
    return (
      'Nothing has been recorded coming off this wagon yet. ' +
      'The ledger fills in during dismantling; until it does, it can say nothing ' +
      'about whether anything is missing.'
    );
  }
  if (outstanding.length === 0 && unaccounted.length === 0) {
    return (
      `${totalRemoved} part${totalRemoved === 1 ? '' : 's'} came off and every one is accounted for — ` +
      `${totalBack} refitted or replaced, the rest recorded as scrapped or deliberately not refitted, ` +
      `each with a reason and a name against it.`
    );
  }
  const lines: string[] = [];
  if (outstanding.length > 0) {
    const n = outstanding.reduce((t, p) => t + p.outstanding, 0);
    lines.push(
      `${n} part${n === 1 ? '' : 's'} came off and ${n === 1 ? 'has' : 'have'} not gone back on, ` +
        `across ${outstanding.length} position${outstanding.length === 1 ? '' : 's'}: ` +
        outstanding.map((p) => `${p.partName} (${p.bogiePosition}) ×${p.outstanding}`).join('; ') +
        '.'
    );
  }
  if (unaccounted.length > 0) {
    lines.push(
      `${unaccounted.length} position${unaccounted.length === 1 ? '' : 's'} had more go back on than came off, ` +
        'which means a removal was not recorded or a refit was entered twice: ' +
        unaccounted.map((p) => `${p.partName} (${p.bogiePosition})`).join('; ') +
        '.'
    );
  }
  return lines.join(' ');
}
