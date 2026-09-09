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

/**
 * What a wagon of this type is supposed to carry — the baseline the ledger is
 * measured against.
 *
 * `verified` is false until the shop has cited a source for the count. An
 * unsourced expectation still helps (it names the positions), but it must
 * never be presented as a fact, so it travels with the flag rather than
 * without it.
 */
export interface ExpectedPart {
  partKey: string;
  category: string;
  partName: string;
  bogiePosition: string;
  expectedQuantity: number;
  quantitySource: string | null;
  quantityVerified: boolean;
  isMandatory: boolean;
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
  /** What the wagon type is supposed to carry here, when that is configured. */
  expected: number | null;
  /** False when the expected figure has no cited source behind it. */
  expectedVerified: boolean;
  /**
   * Expected, but with nothing recorded against it at all.
   *
   * Distinct from outstanding, and the distinction is the point: outstanding
   * means we watched it come off and not go back, which is a finding about the
   * wagon. This means nobody looked, which is a finding about the record.
   */
  neverRecorded: boolean;
}

export interface Reconciliation {
  wagonNumber: string;
  balanced: boolean;
  totalRemoved: number;
  totalBack: number;
  outstandingParts: PartBalance[];
  unaccountedParts: PartBalance[];
  /** Expected positions with nothing recorded against them at all. */
  neverRecordedParts: PartBalance[];
  parts: PartBalance[];
  /** How much of the expected wagon the ledger actually covers, 0..1. */
  coverage: number | null;
  /** How many expected positions carry a cited source for their count. */
  expectedVerifiedCount: number;
  expectedTotal: number;
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

/**
 * What a wagon of this type is supposed to carry.
 *
 * Read from checklist_config, which is the shop's own list, editable by the
 * shop, with a cited standard against each line. It is deliberately not a
 * table of our own: this workshop has already been given fourteen coupler
 * items built from photographs of gauge boards it turned out not to use, and
 * every wagon's exit gate was permanently blocked as a result. The lesson
 * recorded in checklistTemplate.ts is that a photograph of a board is evidence
 * a board exists, not evidence of what the shop does.
 *
 * DEFAULT rows fill in for a wagon type that has no list of its own, and are
 * overridden line by line where the type does. A type with nothing configured
 * returns an empty list, and the reconciliation then says plainly that it has
 * no baseline rather than inventing one.
 */
export function expectedPartsFor(db: DatabaseSync, wagonType: string): ExpectedPart[] {
  let rows: any[] = [];
  try {
    rows = db
      .prepare(
        `SELECT wagon_type, category, part_name, bogie_position, is_mandatory,
                expected_quantity, quantity_source, quantity_verified
         FROM checklist_config
         WHERE wagon_type IN (?, 'DEFAULT')`
      )
      .all(wagonType) as any[];
  } catch {
    // A database predating the expected-quantity columns. No baseline is a
    // valid state; a wrong one is not.
    return [];
  }

  const byKey = new Map<string, ExpectedPart>();
  for (const r of rows) {
    const key = partKeyFor(r.category, r.part_name, r.bogie_position);
    const isSpecific = r.wagon_type === wagonType;
    // A line for this exact type beats the DEFAULT line for the same position.
    if (byKey.has(key) && !isSpecific) continue;
    byKey.set(key, {
      partKey: key,
      category: String(r.category),
      partName: String(r.part_name),
      bogiePosition: String(r.bogie_position || 'NONE'),
      expectedQuantity: Math.max(1, Number(r.expected_quantity) || 1),
      quantitySource: r.quantity_source ?? null,
      quantityVerified: Number(r.quantity_verified) === 1,
      isMandatory: Number(r.is_mandatory) === 1
    });
  }
  return [...byKey.values()];
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
    standardLookup?: (partKey: string) => string | null,
    expectedParts?: ExpectedPart[]
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
        suggestion: null,
        // Filled in below from the expected list, when the wagon type has one.
        expected: null,
        expectedVerified: false,
        neverRecorded: false
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

    /*
     * Every position the wagon type is supposed to carry, whether or not
     * anything has been recorded against it.
     *
     * This is what turns "nothing was recorded, so I cannot tell you" into
     * "forty-three positions are expected and nothing has been recorded
     * against any of them". The first is honest and useless; the second is
     * honest and actionable.
     */
    const expectedByKey = new Map<string, ExpectedPart>();
    for (const e of expectedParts || []) expectedByKey.set(e.partKey, e);

    for (const [key, e] of expectedByKey) {
      if (byKey.has(key)) continue;
      byKey.set(key, {
        partKey: key,
        category: e.category,
        partName: e.partName,
        bogiePosition: e.bogiePosition,
        removed: 0,
        refitted: 0,
        replaced: 0,
        scrapped: 0,
        notFitted: 0,
        outstanding: 0,
        unaccounted: false,
        photographs: 0,
        suggestion: null,
        expected: e.expectedQuantity,
        expectedVerified: e.quantityVerified,
        neverRecorded: true
      });
    }

    const parts = [...byKey.values()];
    for (const b of parts) {
      const e = expectedByKey.get(b.partKey);
      b.expected = e ? e.expectedQuantity : b.expected ?? null;
      b.expectedVerified = e ? e.quantityVerified : false;
      /*
       * Nothing at all recorded here. Deliberately not folded into
       * `outstanding`: outstanding means we watched it come off and not go
       * back, which is a finding about the WAGON. This means nobody looked,
       * which is a finding about the RECORD, and a supervisor should be able
       * to tell those two apart at a glance.
       */
      b.neverRecorded =
        b.removed === 0 && b.refitted === 0 && b.replaced === 0 && b.scrapped === 0 && b.notFitted === 0;
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
    const neverRecordedParts = parts.filter((p) => p.neverRecorded && p.expected !== null);
    const totalRemoved = parts.reduce((n, p) => n + p.removed, 0);
    const totalBack = parts.reduce((n, p) => n + p.refitted + p.replaced, 0);

    const expectedTotal = expectedByKey.size;
    const covered = expectedTotal - neverRecordedParts.length;

    return {
      wagonNumber,
      /*
       * A wagon is only balanced if every expected position was actually
       * looked at. Calling a wagon balanced because the three positions
       * somebody happened to record all add up — while forty others were never
       * touched — is precisely the false assurance this whole feature exists
       * to prevent.
       */
      balanced:
        outstandingParts.length === 0 &&
        unaccountedParts.length === 0 &&
        neverRecordedParts.length === 0 &&
        parts.length > 0,
      totalRemoved,
      totalBack,
      outstandingParts,
      unaccountedParts,
      neverRecordedParts,
      coverage: expectedTotal > 0 ? covered / expectedTotal : null,
      expectedVerifiedCount: [...expectedByKey.values()].filter((e) => e.quantityVerified).length,
      expectedTotal,
      parts: parts.sort(
        (a, b) =>
          Number(b.unaccounted) - Number(a.unaccounted) ||
          b.outstanding - a.outstanding ||
          Number(b.neverRecorded) - Number(a.neverRecorded) ||
          a.partName.localeCompare(b.partName)
      ),
      summary: summarise(
        parts,
        outstandingParts,
        unaccountedParts,
        neverRecordedParts,
        totalRemoved,
        totalBack,
        expectedTotal
      )
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
  if (b.neverRecorded && b.expected !== null) {
    return (
      `Nothing has been recorded for this position. A ${b.bogiePosition.replace(/_/g, ' ').toLowerCase()} ` +
      `is expected to carry ${b.expected}${b.expectedVerified ? '' : ' (count not yet sourced from the shop)'}. ` +
      `Record what came off, or record that it was not disturbed.`
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
  neverRecorded: PartBalance[],
  totalRemoved: number,
  totalBack: number,
  expectedTotal: number
): string {
  if (parts.length === 0) {
    return (
      'Nothing has been recorded coming off this wagon yet, and no expected parts list ' +
      'is configured for its type. The ledger cannot say anything about whether ' +
      'something is missing — which is not the same as saying nothing is.'
    );
  }
  /*
   * The strongest version of the empty case, and the reason the expected list
   * is worth having at all: a number of positions nobody has touched beats
   * "cannot tell you", because it says how much is unknown.
   */
  if (expectedTotal > 0 && neverRecorded.length === expectedTotal) {
    return (
      `${expectedTotal} part position${expectedTotal === 1 ? ' is' : 's are'} expected on a wagon of this type, ` +
      `and nothing has been recorded against any of them. This wagon has no parts record at all.`
    );
  }
  if (neverRecorded.length > 0) {
    const covered = expectedTotal - neverRecorded.length;
    const base =
      `${covered} of ${expectedTotal} expected position${expectedTotal === 1 ? '' : 's'} have been recorded. ` +
      `${neverRecorded.length} ${neverRecorded.length === 1 ? 'has' : 'have'} nothing against ` +
      `${neverRecorded.length === 1 ? 'it' : 'them'} at all: ` +
      neverRecorded.slice(0, 4).map((p) => `${p.partName} (${p.bogiePosition})`).join('; ') +
      (neverRecorded.length > 4 ? `, and ${neverRecorded.length - 4} more.` : '.');
    const rest =
      outstanding.length > 0
        ? ` Separately, ${outstanding.reduce((t, p) => t + p.outstanding, 0)} recorded coming off ` +
          'and not going back on.'
        : '';
    return base + rest;
  }
  if (outstanding.length === 0 && unaccounted.length === 0) {
    return (
      (expectedTotal > 0 ? `All ${expectedTotal} expected positions were recorded. ` : '') +
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
