/**
 * Shared Tamper-Evident Audit Log Writer
 * Indian Railways WRS Raipur
 *
 * Single write path for `inspection_audit_log` so every event across the
 * system (spring inspections, CV telemetry, wagon lifecycle, checklist
 * actions, inventory/OMRS triage) participates in the same SHA-256 hash
 * chain — each entry's hash is derived from the previous entry's hash,
 * seeded with 'GENESIS_BLOCK'. Writing directly to the table instead of
 * through this function breaks the chain's continuity.
 */

import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import type { AuditLogEntry } from '../../../shared/types.ts';

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
  const previousHash = prevRow?.hash || 'GENESIS_BLOCK';

  const dataToHash = `${previousHash}|${id}|${inspectionId}|${eventType}|${userId}|${payloadJson}|${createdAt}`;
  const hash = crypto.createHash('sha256').update(dataToHash).digest('hex');

  db.prepare(`
    INSERT INTO inspection_audit_log (id, inspection_id, event_type, user_id, user_role, ip_address, payload_json, previous_hash, hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, inspectionId, eventType, userId, userRole, ipAddress, payloadJson, previousHash, hash, createdAt);
}
