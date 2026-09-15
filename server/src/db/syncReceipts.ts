/**
 * Receipts for what the offline queue has already delivered
 * Indian Railways WRS Raipur
 *
 * See the table's note in migrations.ts. A resend of a batch the server has
 * already applied must change nothing, and for the three entities that have
 * no natural unique key of their own — stage transitions, spoken verdicts,
 * photographs — this is the key.
 */

import type { DatabaseSync } from 'node:sqlite';

export type ReceiptEntity = 'TRANSITION' | 'VOICE_ACTION' | 'PHOTO';

export class SyncReceipts {
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  /** The server id this device id was applied as, or null if never seen. */
  find(entity: ReceiptEntity, clientTempId: string): { serverId: string | null } | null {
    const r = this.db
      .prepare('SELECT server_id FROM sync_receipts WHERE entity = ? AND client_temp_id = ?')
      .get(entity, clientTempId) as any;
    return r ? { serverId: r.server_id ?? null } : null;
  }

  record(entity: ReceiptEntity, clientTempId: string, serverId: string | null, actorId: string): void {
    this.db
      .prepare('INSERT INTO sync_receipts (entity, client_temp_id, server_id, actor_id) VALUES (?, ?, ?, ?)')
      .run(entity, clientTempId, serverId, actorId);
  }
}

/** A queued item with no device id cannot be made idempotent; say so rather than guess one. */
export function requireClientTempId(item: any, what: string): string {
  const id = item?.clientTempId ?? item?.id;
  if (typeof id !== 'string' || !id.trim()) {
    throw new Error(`A queued ${what} needs a clientTempId, so that sending it twice records it once.`);
  }
  return id.trim();
}
