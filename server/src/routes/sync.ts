/**
 * Offline Synchronization Router
 * Indian Railways WRS Raipur (Phase 1 & Phase 2 Multi-Entity Batch Sync)
 */

import { Router } from '../framework/index.ts';
import type { Request, Response, NextFunction } from '../framework/index.ts';
import { getDatabase } from '../db/connection.ts';
import { InspectionRepository } from '../db/repository.ts';
import { WagonRepository } from '../db/wagonRepository.ts';
import { authMiddleware } from '../middleware/auth.ts';
import type { AuthenticatedRequest } from '../middleware/auth.ts';

export const syncRouter = Router();

/**
 * POST /api/sync/batch
 * Multi-entity idempotent batch synchronization for offline inspection, wagon, checklist & photo records
 */
/*
 * Authentication is REQUIRED here, and every record synced is attributed to
 * the authenticated user rather than to anything in the request body.
 *
 * This route used to use optionalAuthMiddleware and take the actor from
 * client-supplied fields, falling back to a hardcoded 'usr_insp_001'. Both
 * halves were exploitable and were verified so before this change:
 *
 *   - With no Authorization header at all, a stage transition was written
 *     naming usr_sup_001 as the performer, role SUPERVISOR, isOverride true.
 *     The permanent record said a named supervisor authorised an override
 *     that no supervisor was involved in.
 *
 *   - The same unauthenticated route accepted a MANDATORY checklist item with
 *     status PASS, attributed to whoever the body named. That is the exit
 *     gate's entire premise — it counts mandatory items that passed — being
 *     writable by anyone who can reach the port.
 *
 * The offline queue sends its token, so requiring one costs the real client
 * nothing. A queue with no token should wait for a login rather than sync
 * anonymously, which is the behaviour this now forces.
 */
syncRouter.post('/batch', authMiddleware, (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  try {
    const {
      records = [],
      wagons = [],
      transitions = [],
      checklistItems = [],
      photos = [],
      deviceId,
      syncTimestamp
    } = req.body || {};

    const db = getDatabase();
    const inspectionRepo = new InspectionRepository(db);
    const wagonRepo = new WagonRepository(db);

    let insertedCount = 0;
    let duplicateCount = 0;
    let syncedWagons = 0;
    let syncedTransitions = 0;
    let syncedChecklistItems = 0;
    let syncedPhotos = 0;

    const syncedRecords: Array<{ clientTempId?: string; serverId: string; sequenceNumber?: number }> = [];
    const errors: Array<{ clientTempId?: string; entity?: string; error: string }> = [];

    // Bound once, from the token, and used for every record in the batch.
    const actorId = req.user?.id;
    const actorName = req.user?.name || req.user?.username || 'Unknown';
    const actorRole = req.user?.role || 'INSPECTOR';
    if (!actorId) {
      res.status(401).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Synced records must name the person who made them.',
        statusCode: 401,
        timestamp: new Date().toISOString()
      });
      return;
    }

    // 1. Process Phase 1 inspections records
    if (Array.isArray(records)) {
      for (const item of records) {
        try {
          const clientTempId = item.clientTempId || item.syncId || item.id;
          const record = inspectionRepo.insertInspection({
            ...item,
            syncId: item.syncId || clientTempId,
            syncStatus: 'SYNCED',
            timestamp: item.timestamp || item.localCreatedAt || item.clientTimestamp || new Date().toISOString()
          });

          insertedCount++;
          syncedRecords.push({
            clientTempId,
            serverId: record.id,
            sequenceNumber: record.sequenceNumber
          });
        } catch (err: any) {
          if (err.message?.includes('UNIQUE constraint failed: inspections.sync_id')) {
            duplicateCount++;
          } else {
            errors.push({
              clientTempId: item.clientTempId || item.syncId,
              entity: 'INSPECTION',
              error: err.message || 'Failed to sync inspection record'
            });
          }
        }
      }
    }

    // 2. Process Wagons
    if (Array.isArray(wagons)) {
      for (const w of wagons) {
        try {
          const existing = wagonRepo.getWagonByNumber(w.wagonNumber);
          if (!existing) {
            wagonRepo.registerWagon({
              wagonNumber: w.wagonNumber,
              wagonType: w.wagonType || 'BOXNHL',
              owningRailway: w.owningRailway || 'SECR',
              entryNotes: w.entryNotes || w.conditionNotes,
              entryDate: w.entryDate,
              createdBy: actorId
            });
          }
          syncedWagons++;
        } catch (err: any) {
          errors.push({
            clientTempId: w.id || w.wagonNumber,
            entity: 'WAGON',
            error: err.message || 'Failed to sync wagon'
          });
        }
      }
    }

    // 3. Process Checklist Items
    if (Array.isArray(checklistItems)) {
      for (const chk of checklistItems) {
        try {
          wagonRepo.upsertChecklistItem({
            wagonNumber: chk.wagonNumber,
            category: chk.category,
            partName: chk.partName,
            bogiePosition: chk.bogiePosition || 'NONE',
            status: chk.status,
            isMandatory: chk.isMandatory !== undefined ? chk.isMandatory : chk.criticality === 'MANDATORY',
            conditionNotes: chk.conditionNotes,
            repairAction: chk.repairAction,
            repairNotes: chk.repairNotes,
            // Never chk.inspectedBy — a verdict is attributed to whoever was
            // authenticated, not to whoever the payload names.
            inspectorId: actorId,
            inspectorName: actorName,
            photoId: chk.photoId
          });
          syncedChecklistItems++;
        } catch (err: any) {
          errors.push({
            clientTempId: chk.id,
            entity: 'CHECKLIST',
            error: err.message || 'Failed to sync checklist item'
          });
        }
      }
    }

    // 4. Process Transitions
    if (Array.isArray(transitions)) {
      for (const tr of transitions) {
        try {
          wagonRepo.recordTransition({
            wagonNumber: tr.wagonNumber,
            fromStage: tr.fromStage,
            toStage: tr.toStage,
            transitionType: tr.transitionType || 'NORMAL',
            // These previously took the body's value FIRST, so a caller could
            // name any performer and claim any role, including SUPERVISOR on
            // an override.
            performedBy: actorId,
            performerName: actorName,
            performerRole: actorRole,
            isOverride: Boolean(tr.isOverride),
            overrideReason: tr.overrideJustification || tr.overrideReason,
            notes: tr.notes
          });
          syncedTransitions++;
        } catch (err: any) {
          errors.push({
            clientTempId: tr.id,
            entity: 'TRANSITION',
            error: err.message || 'Failed to sync stage transition'
          });
        }
      }
    }

    // 5. Process Photos
    if (Array.isArray(photos)) {
      for (const p of photos) {
        try {
          wagonRepo.insertPhoto({
            id: p.id,
            wagonNumber: p.wagonNumber,
            checklistItemId: p.checklistItemId,
            category: p.partCategory || p.category,
            partName: p.partName,
            imageData: p.imageBase64 || p.imageData,
            // Same rule as the rest: attributed to the authenticated user.
            inspectorId: actorId,
            inspectorName: req.user?.name || p.inspectorName || 'Inspector',
            tags: p.tags
          });
          syncedPhotos++;
        } catch (err: any) {
          errors.push({
            clientTempId: p.id,
            entity: 'PHOTO',
            error: err.message || 'Failed to sync photo'
          });
        }
      }
    }

    res.status(200).json({
      success: errors.length === 0,
      totalSubmitted: (records.length || 0) + (wagons.length || 0) + (checklistItems.length || 0) + (transitions.length || 0) + (photos.length || 0),
      syncedCount: insertedCount,
      insertedCount,
      duplicateCount,
      syncedWagons,
      syncedTransitions,
      syncedChecklistItems,
      syncedPhotos,
      failedCount: errors.length,
      syncedRecords,
      errors: errors.length > 0 ? errors : undefined,
      meta: {
        deviceId,
        syncTimestamp: syncTimestamp || new Date().toISOString()
      }
    });
  } catch (error) {
    next(error);
  }
});
