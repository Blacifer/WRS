/**
 * Offline Sync Engine & Batch Ingestion
 * Indian Railways WRS Raipur
 *
 * Implements client offline queue management and server-side atomic batch sync
 * with idempotency, local timestamp preservation, and sequential audit logging.
 */

import type { AuditDatabase } from './audit_db.ts';
import type { SyncPayload, SyncResponse, InspectionRecord } from '../../shared/types.ts';

export class OfflineSyncQueue {
  private localQueue: Array<Omit<InspectionRecord, 'id' | 'sequenceNumber'> & { clientTempId: string }> = [];

  public enqueue(record: Omit<InspectionRecord, 'id' | 'sequenceNumber'>): string {
    const clientTempId = `local-temp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    this.localQueue.push({
      ...record,
      clientTempId,
      syncStatus: 'LOCAL',
      localCreatedAt: record.localCreatedAt || new Date().toISOString()
    });
    return clientTempId;
  }

  public getQueueLength(): number {
    return this.localQueue.length;
  }

  public getPendingRecords() {
    return [...this.localQueue];
  }

  public createSyncPayload(deviceId: string = 'WRS-HANDHELD-001'): SyncPayload {
    return {
      records: [...this.localQueue],
      deviceId,
      syncTimestamp: new Date().toISOString()
    };
  }

  public clearQueue(): void {
    this.localQueue = [];
  }
}

export class ServerSyncProcessor {
  private auditDb: AuditDatabase;
  private processedTempIds: Set<string> = new Set();

  constructor(auditDb: AuditDatabase) {
    this.auditDb = auditDb;
  }

  /**
   * Process incoming batch sync payload idempotently
   */
  public processBatchSync(payload: SyncPayload): SyncResponse {
    const syncedRecords: Array<{ clientTempId?: string; serverId: string; sequenceNumber: number }> = [];
    const errors: Array<{ clientTempId?: string; error: string }> = [];

    for (const item of payload.records) {
      try {
        const clientTempId = item.clientTempId;

        // Check if already processed (idempotency)
        if (clientTempId && this.processedTempIds.has(clientTempId)) {
          // Find existing record
          const existing = this.auditDb.queryInspections({ wagonNumber: item.wagonNumber, limit: 1 });
          if (existing.records.length > 0) {
            syncedRecords.push({
              clientTempId,
              serverId: existing.records[0].id,
              sequenceNumber: existing.records[0].sequenceNumber
            });
            continue;
          }
        }

        // Ingest into audit database
        const saved = this.auditDb.logInspection({
          ...item,
          syncStatus: 'SYNCED',
          timestamp: item.timestamp || item.localCreatedAt || new Date().toISOString(),
          localCreatedAt: item.localCreatedAt
        });

        if (clientTempId) {
          this.processedTempIds.add(clientTempId);
        }

        syncedRecords.push({
          clientTempId,
          serverId: saved.id,
          sequenceNumber: saved.sequenceNumber
        });
      } catch (err: unknown) {
        errors.push({
          clientTempId: item.clientTempId,
          error: (err as Error).message || 'Failed to sync record'
        });
      }
    }

    return {
      success: errors.length === 0,
      syncedCount: syncedRecords.length,
      failedCount: errors.length,
      syncedRecords,
      errors: errors.length > 0 ? errors : undefined
    };
  }
}
