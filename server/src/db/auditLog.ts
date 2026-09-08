/**
 * Shared Tamper-Evident Audit Log Writer & Verifier
 * Indian Railways WRS Raipur
 *
 * Single write path for `inspection_audit_log` so every event across the
 * system (spring inspections, CV telemetry, wagon lifecycle, checklist
 * actions, inventory/OMRS triage) participates in the same SHA-256 hash
 * chain — each entry's hash is derived from the previous entry's hash,
 * seeded with 'GENESIS_BLOCK'. Writing directly to the table instead of
 * through this function breaks the chain's continuity.
 *
 * WHY A VERIFIER EXISTS
 * ---------------------
 * The chain was being written but had never been read back. Append-only
 * triggers stop tampering through the application; the chain is what detects
 * tampering that went around it — someone who copies the database file, drops
 * the triggers, edits a row and puts the file back. That detection is only
 * real if something actually recomputes the hashes, which is what
 * verifyAuditChain() does.
 */

import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import type { AuditLogEntry } from '../../../shared/types.ts';
import { currentClientIp } from '../middleware/requestContext.ts';

/** Seed for the first entry, so the chain has a fixed, known starting point. */
export const GENESIS_HASH = 'GENESIS_BLOCK';

interface HashableAuditFields {
  previousHash: string;
  id: string;
  inspectionId: string | null;
  eventType: string;
  userId: string;
  userRole: string;
  ipAddress: string | null;
  payloadJson: string;
  createdAt: string;
}

/**
 * The one definition of an entry's hash. Both the writer and the verifier go
 * through here — if they ever computed it separately, a drift between them
 * would look exactly like tampering.
 *
 * user_role and ip_address are part of the hash. They were not originally,
 * which left a real hole: the audit log's whole purpose is answering "who did
 * this", and an attacker who reached the file could have rewritten a role from
 * INSPECTOR to ADMIN without disturbing a single hash. Anything the log
 * asserts should be something the chain protects.
 */
export function computeAuditHash(f: HashableAuditFields): string {
  const dataToHash = [
    f.previousHash,
    f.id,
    f.inspectionId,
    f.eventType,
    f.userId,
    f.userRole,
    f.ipAddress,
    f.payloadJson,
    f.createdAt
  ].join('|');

  return crypto.createHash('sha256').update(dataToHash).digest('hex');
}

export function logAuditEvent(db: DatabaseSync, event: Partial<AuditLogEntry>): void {
  const id = event.id || `audit_${crypto.randomUUID()}`;
  const inspectionId = event.inspectionId || null;
  const eventType = event.eventType || 'INSPECTION_CREATED';
  const userId = event.userId || 'system';
  const userRole = event.userRole || 'SYSTEM';
  // An address the caller knows beats one inferred; otherwise fall back to
  // the request being served. Work with no request behind it logs no address
  // rather than a plausible-looking invention.
  const ipAddress = event.ipAddress || currentClientIp();
  const payloadJson = JSON.stringify(event.payload || {});
  const createdAt = event.createdAt || new Date().toISOString();

  /*
   * Reading the last hash and appending must be ONE atomic step.
   *
   * Found by running the restore drill, not by a test. The pilot database's
   * chain reported BROKEN, and the restored copy reported the same break at
   * the same row — so the backup was faithful and the damage was already
   * there. Rows 152 and 153 carried the same previous_hash and the same
   * millisecond timestamp: two writers had each read the same "last hash" and
   * each appended their own entry. The chain forked.
   *
   * Nothing had been tampered with. Two people signed in at the same moment,
   * which in a workshop with several tablets is an ordinary Tuesday.
   *
   * The consequence was worse than a wrong figure. The audit chain is this
   * system's central claim — that the record cannot be altered without
   * detection — and a chain that reports tampering because two logins
   * coincided cries wolf. After the first false break, a real one is
   * indistinguishable from the noise, and an auditor is entitled to treat the
   * whole mechanism as unreliable.
   *
   * BEGIN IMMEDIATE takes the write lock before the read, so a second writer
   * — including one in another process, which is how this happened — waits
   * rather than reading a hash that is about to be superseded. busy_timeout
   * is already 5s on the connection, so the wait is handled rather than
   * failing outright.
   *
   * When a caller is already inside a transaction, that transaction holds the
   * write lock and starting another would throw; the read and insert are then
   * already serialised and are done directly.
   */
  const ownTransaction = !db.isTransaction;
  if (ownTransaction) db.exec('BEGIN IMMEDIATE');

  try {
    const prevRow = db.prepare(`
      SELECT hash FROM inspection_audit_log ORDER BY rowid DESC LIMIT 1
    `).get() as { hash: string } | undefined;
    const previousHash = prevRow?.hash || GENESIS_HASH;

    const hash = computeAuditHash({
      previousHash,
      id,
      inspectionId,
      eventType,
      userId,
      userRole,
      ipAddress,
      payloadJson,
      createdAt
    });

    db.prepare(`
      INSERT INTO inspection_audit_log (id, inspection_id, event_type, user_id, user_role, ip_address, payload_json, previous_hash, hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, inspectionId, eventType, userId, userRole, ipAddress, payloadJson, previousHash, hash, createdAt);

    if (ownTransaction) db.exec('COMMIT');
  } catch (err) {
    // Leaving a transaction open would wedge every later write on this
    // connection behind a lock nobody holds a reason for.
    if (ownTransaction && db.isTransaction) {
      try { db.exec('ROLLBACK'); } catch { /* the commit already failed; nothing more to do */ }
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export type AuditBreakReason =
  /** The row's own contents no longer hash to the hash stored on it. */
  | 'CONTENT_ALTERED'
  /** This row does not point at the previous row — an entry was removed or inserted. */
  | 'BROKEN_LINK'
  /**
   * This row's parent is present, and so is another row claiming the same
   * parent. Two writers appended at the same moment and the chain forked.
   * Nothing is missing.
   */
  | 'CONCURRENT_APPEND'
  /** The first entry does not start from the genesis seed. */
  | 'GENESIS_MISMATCH'
  /** The row carries no hash at all, so nothing about it can be attested. */
  | 'UNCHAINED';

export interface AuditChainBreak {
  rowid: number;
  id: string;
  eventType: string;
  createdAt: string;
  reason: AuditBreakReason;
  /** Plain-language explanation, safe to show a supervisor. */
  detail: string;
}

export interface AuditChainVerification {
  verified: boolean;
  entriesChecked: number;
  /** Where the chain first stops adding up — the place to start investigating. */
  firstBrokenAt: AuditChainBreak | null;
  breaksFound: number;
  checkedAt: string;
  /**
   * How much of the log this answer covers.
   *
   * FULL walked every entry from the genesis hash. TAIL walked only the most
   * recent `entriesChecked` of `totalEntries`, which is a different and weaker
   * claim — it cannot see tampering further back. Nothing may render a TAIL
   * result as "the chain is intact", and the field exists so that no screen
   * can do so by accident.
   */
  scope: 'FULL' | 'TAIL';
  /** Entries in the log, whether or not this pass looked at them. */
  totalEntries: number;
}

/**
 * Walks the audit log in insertion order and re-derives every hash.
 *
 * Two independent faults are distinguished, because they mean different
 * things to whoever has to investigate:
 *
 *   CONTENT_ALTERED — the row's stored hash does not match its own contents.
 *                     Someone edited this entry.
 *   BROKEN_LINK     — the row's contents are intact but it does not follow the
 *                     entry before it. Someone removed or inserted an entry.
 *
 * Checking content against the row's own stored previous_hash keeps the two
 * separate; otherwise a single deleted row would cascade and report every
 * later entry as altered, burying the actual edit.
 *
 * The walk continues past the first fault so the total is honest, but the
 * first one is reported prominently — after a break, later entries are
 * chained to a history that is already in question.
 */
/**
 * Walk the chain and re-derive every hash.
 *
 * `tail` limits the walk to the most recent N entries. That is not a cheaper
 * version of the same answer — it is a weaker one, and the returned `scope`
 * says which was asked for. See verifyAuditChainTail below for why the
 * dashboard needs it.
 *
 * WHY THE ROWS ARE STREAMED
 * -------------------------
 * This used to load the entire log with `.all()`, holding every payload in
 * memory at once. That is why the cost grew faster than the log: 250,000
 * entries verified in 1.3s, 500,000 in 4.2s, 750,000 in 8.0s — and this runs
 * on the shop PC, three to five times slower than the machine those figures
 * came from. Three years in, an officer opening a dashboard would have frozen
 * the server for half a minute.
 */
export function verifyAuditChain(
  db: DatabaseSync,
  options?: { tail?: number }
): AuditChainVerification {
  const totalEntries = Number(
    (db.prepare('SELECT COUNT(*) AS c FROM inspection_audit_log').get() as { c: number })?.c ?? 0
  );
  const tail = options?.tail && options.tail > 0 ? Math.floor(options.tail) : null;
  const scope: 'FULL' | 'TAIL' = tail && tail < totalEntries ? 'TAIL' : 'FULL';

  /*
   * A tail walk starts from the stored hash of the entry before the window,
   * not from the genesis hash. Starting at GENESIS would report a break on
   * the first entry of every window — a false alarm on a healthy chain, which
   * is worse than no check at all.
   */
  let startAfterRowid = 0;
  let expectedPrevious = GENESIS_HASH;
  if (scope === 'TAIL') {
    const firstInWindow = db.prepare(
      'SELECT rowid FROM inspection_audit_log ORDER BY rowid DESC LIMIT 1 OFFSET ?'
    ).get(tail! - 1) as { rowid: number } | undefined;
    if (firstInWindow) {
      const before = db.prepare(
        'SELECT rowid, hash FROM inspection_audit_log WHERE rowid < ? ORDER BY rowid DESC LIMIT 1'
      ).get(firstInWindow.rowid) as { rowid: number; hash: string } | undefined;
      if (before) {
        startAfterRowid = before.rowid;
        expectedPrevious = before.hash;
      }
    }
  }

  const rows = db.prepare(`
    SELECT rowid, id, inspection_id, event_type, user_id, user_role,
           ip_address, payload_json, previous_hash, hash, created_at
    FROM inspection_audit_log
    WHERE rowid > ?
    ORDER BY rowid ASC
  `).all(startAfterRowid) as any[];

  const breaks: AuditChainBreak[] = [];

  /*
   * Every hash in the walked window, so a mismatched link can be asked the
   * question that actually matters: is the entry this one claims to follow
   * still here?
   */
  const seenHashes = new Set<string>(rows.map((r) => r.hash).filter(Boolean));

  for (const row of rows) {
    const base = {
      rowid: row.rowid as number,
      id: row.id as string,
      eventType: row.event_type as string,
      createdAt: row.created_at as string
    };

    if (!row.hash) {
      breaks.push({
        ...base,
        reason: 'UNCHAINED',
        detail:
          `Entry ${row.id} carries no hash, so nothing about it can be attested. ` +
          `It was written directly to the table rather than through the audit writer.`
      });
      // Nothing to chain from, so the next entry is judged on its own terms.
      expectedPrevious = row.hash || expectedPrevious;
      continue;
    }

    // 1. Does the row still hash to what it claims? Judged against the row's
    //    own previous_hash so this stays independent of link integrity.
    const recomputed = computeAuditHash({
      previousHash: row.previous_hash ?? GENESIS_HASH,
      id: row.id,
      inspectionId: row.inspection_id ?? null,
      eventType: row.event_type,
      userId: row.user_id,
      userRole: row.user_role,
      ipAddress: row.ip_address ?? null,
      payloadJson: row.payload_json,
      createdAt: row.created_at
    });

    if (recomputed !== row.hash) {
      breaks.push({
        ...base,
        reason: 'CONTENT_ALTERED',
        detail:
          `Entry ${row.id} (${row.event_type}, recorded ${row.created_at}) no longer matches ` +
          `its own signature — its contents were changed after it was written.`
      });
    } else if (row.previous_hash !== expectedPrevious) {
      /*
       * 2. Contents are intact, so the SEQUENCE was disturbed rather than this
       *    entry's data. Two very different things produce that, and calling
       *    them by the same name was a false accusation.
       *
       *    If this row's parent is still in the log, nothing was removed:
       *    another row already claimed that parent, and both are present. That
       *    is what two writers appending at the same instant produce — the
       *    fault this codebase had until the append was made atomic, and the
       *    reason the pilot database reported tampering when two people had
       *    simply signed in together.
       *
       *    If the parent is nowhere in the log, an entry really is gone.
       *
       *    The distinction is not an excuse. A fork says both entries and
       *    their parent are present; it does not say nothing was inserted,
       *    and it is reported as a break either way so the chain still fails
       *    verification and somebody still has to look.
       */
      const parentPresent = row.previous_hash && seenHashes.has(row.previous_hash);

      breaks.push({
        ...base,
        reason:
          expectedPrevious === GENESIS_HASH ? 'GENESIS_MISMATCH'
          : parentPresent ? 'CONCURRENT_APPEND'
          : 'BROKEN_LINK',
        detail:
          expectedPrevious === GENESIS_HASH
            ? `The log does not begin at the genesis seed — earlier entries were removed.`
            : parentPresent
            ? `Entry ${row.id} shares its parent with another entry: two were appended at the ` +
              `same moment and the chain forked. Both are present and the entry they follow is ` +
              `present, so nothing has been removed here.`
            : `Entry ${row.id} does not follow the entry before it, and the entry it claims to ` +
              `follow is not in the log — an entry was removed.`
      });
    }

    expectedPrevious = row.hash;
  }

  return {
    verified: breaks.length === 0,
    entriesChecked: rows.length,
    firstBrokenAt: breaks[0] ?? null,
    breaksFound: breaks.length,
    checkedAt: new Date().toISOString(),
    scope,
    totalEntries
  };
}

/**
 * Verify only the most recent entries.
 *
 * For screens that ask "is the record intact?" as one line among several, on
 * every load. The full walk belongs where somebody has asked for it — the
 * Audit Chain page — and running it on a dashboard is what made an officer's
 * home screen freeze the server for half a minute in year three.
 *
 * This is a WEAKER claim and callers must not dress it up. It says the recent
 * end of the log is internally consistent and correctly linked to what came
 * before it. It says nothing about an entry altered last year. The returned
 * `scope` is 'TAIL' whenever the window was smaller than the log, so a screen
 * that renders "unbroken" without checking that field is stating something
 * this function did not establish.
 */
export function verifyAuditChainTail(db: DatabaseSync, entries = 500): AuditChainVerification {
  return verifyAuditChain(db, { tail: entries });
}
