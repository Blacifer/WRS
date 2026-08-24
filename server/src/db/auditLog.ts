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
  const ipAddress = event.ipAddress || null;
  const payloadJson = JSON.stringify(event.payload || {});
  const createdAt = event.createdAt || new Date().toISOString();

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
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export type AuditBreakReason =
  /** The row's own contents no longer hash to the hash stored on it. */
  | 'CONTENT_ALTERED'
  /** This row does not point at the previous row — an entry was removed or inserted. */
  | 'BROKEN_LINK'
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
export function verifyAuditChain(db: DatabaseSync): AuditChainVerification {
  const rows = db.prepare(`
    SELECT rowid, id, inspection_id, event_type, user_id, user_role,
           ip_address, payload_json, previous_hash, hash, created_at
    FROM inspection_audit_log
    ORDER BY rowid ASC
  `).all() as any[];

  const breaks: AuditChainBreak[] = [];
  let expectedPrevious = GENESIS_HASH;

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
      // 2. Contents are intact, so a mismatched link means the sequence itself
      //    was disturbed rather than this entry's data.
      breaks.push({
        ...base,
        reason: expectedPrevious === GENESIS_HASH ? 'GENESIS_MISMATCH' : 'BROKEN_LINK',
        detail:
          expectedPrevious === GENESIS_HASH
            ? `The log does not begin at the genesis seed — earlier entries were removed.`
            : `Entry ${row.id} does not follow the entry before it — an entry was removed or inserted.`
      });
    }

    expectedPrevious = row.hash;
  }

  return {
    verified: breaks.length === 0,
    entriesChecked: rows.length,
    firstBrokenAt: breaks[0] ?? null,
    breaksFound: breaks.length,
    checkedAt: new Date().toISOString()
  };
}
