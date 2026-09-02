/**
 * Photo Evidence & Auto-Tagging API Router
 * Indian Railways WRS Raipur (Phase 2)
 */

import { Router } from '../framework/index.ts';
import type { Request, Response } from '../framework/index.ts';
import { authMiddleware } from '../middleware/auth.ts';
import type { AuthenticatedRequest } from '../middleware/auth.ts';
import { requireCapability } from '../middleware/rbac.ts';
import { getDatabase } from '../db/connection.ts';
import { WagonRepository } from '../db/wagonRepository.ts';
import { logAuditEvent } from '../db/auditLog.ts';

export const photosRouter = Router();

function getRepo() {
  const db = getDatabase();
  return new WagonRepository(db);
}

// -------------------------------------------------------------------------
// 1. Upload & Auto-tag Photo Evidence
// -------------------------------------------------------------------------

/*
 * Reading this system requires an account.
 *
 * These routes were mounted on optionalAuthMiddleware, which takes a token
 * when one is offered and proceeds perfectly happily when none is. The effect
 * was that everything readable here was readable by anyone who could reach
 * the server: the wagon list, every checklist, every spring measurement with
 * the inspector's name against it, the component ledger, the stores, and — the
 * worst of them — /api/inspections/export, which handed over the entire
 * inspection record as a CSV to a caller with no account.
 *
 * That last one also shows why "optional" auth is the wrong shape for a read
 * gate. The export's protections (no inspectors, and a second factor for
 * anyone enrolled) were all written inside `if (req.user)`, so sending no
 * credentials at all skipped every one of them. A check that only runs for
 * people who identified themselves is not a check.
 */

photosRouter.post('/upload', authMiddleware, async (req: Request, res: Response) => {
  const repo = getRepo();
  const {
    wagonNumber,
    checklistItemId,
    category,
    partCategory,
    partName,
    stage,
    fileName,
    mimeType,
    fileSize,
    imageBase64,
    imageData,
    tags,
    evidenceStage
  } = req.body;

  const effectiveImageData = imageBase64 || imageData;
  const effectiveCategory = category || partCategory || 'GENERAL_WAGON';

  if (!wagonNumber || !effectiveImageData) {
    res.status(400).json({
      success: false,
      error: 'MISSING_REQUIRED_FIELDS',
      message: 'wagonNumber and imageBase64 (or imageData) are required.',
      statusCode: 400,
      timestamp: new Date().toISOString()
    });
    return;
  }

  // Identity comes from the token. This fell back to a hardcoded demo
  // inspector, so evidence uploaded by anyone whose token lacked an id was
  // filed under someone else's name — the same fault the release certificate
  // had, on the records meant to prove what was actually done.
  if (!req.user?.id) {
    res.status(401).json({
      success: false,
      error: 'UNAUTHORIZED',
      message: 'Photo evidence must be attributable to an authenticated inspector.',
      statusCode: 401,
      timestamp: new Date().toISOString()
    });
    return;
  }
  const inspectorId = req.user.id;
  const inspectorName = req.user.name;

  try {
    const photo = repo.insertPhoto({
      wagonNumber,
      checklistItemId: checklistItemId || null,
      category: effectiveCategory,
      partName: partName || 'Component Inspection',
      stage: stage || 'COMPONENT_INSPECTION',
      fileName: fileName || `${wagonNumber}_${Date.now()}.jpg`,
      mimeType: mimeType || 'image/jpeg',
      fileSize: fileSize || Buffer.byteLength(effectiveImageData, 'utf8'),
      imageData: effectiveImageData,
      inspectorId,
      inspectorName,
      tags: Array.isArray(tags) ? tags : [wagonNumber, effectiveCategory, partName].filter(Boolean),
      evidenceStage: ['BEFORE', 'AFTER', 'DEFECT', 'GENERAL'].includes(evidenceStage) ? evidenceStage : null
    });

    // If checklistItemId is provided, link photo to checklist item
    if (checklistItemId) {
      repo.updateChecklistItem(checklistItemId, { photoId: photo.id });
    }

    /*
     * A photograph is evidence about a wagon that is about to leave, so who
     * took it and when belongs in the same ledger as everything else. The
     * image itself stays where it is — the audit entry records that it exists,
     * not a second copy of it.
     */
    logAuditEvent(getDatabase(), {
      eventType: 'PHOTO_UPLOADED',
      userId: inspectorId,
      userRole: req.user?.role || 'INSPECTOR',
      payload: {
        wagonNumber,
        photoId: photo.id,
        category: effectiveCategory,
        partName: partName || 'Component Inspection',
        checklistItemId: checklistItemId || null,
        evidenceStage: evidenceStage || null
      }
    });

    res.status(201).json({
      success: true,
      message: 'Photo evidence uploaded and auto-tagged successfully.',
      data: photo,
      meta: { timestamp: new Date().toISOString() }
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: 'PHOTO_UPLOAD_FAILED',
      message: err.message || 'Failed to store photo evidence',
      statusCode: 500,
      timestamp: new Date().toISOString()
    });
  }
});

// -------------------------------------------------------------------------
// 2. Retrieve Photo by ID
// -------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// GET /api/photos/dataset/defects — labelled defect training set
//
// Every condemnation captured through the app attaches a photograph tagged
// with its defect type. This endpoint is how that accumulated evidence leaves
// the system as an actual dataset, so a defect-detection model can eventually
// be trained on this workshop's own components rather than stock imagery.
//
// Returns metadata by default (fast, safe to poll for progress). Pass
// includeImages=true to get the base64 payloads for an export run.
// ---------------------------------------------------------------------------
photosRouter.get(
  '/dataset/defects',
  authMiddleware,
  /*
   * A judgement call, stated rather than buried.
   *
   * This is a bulk export of the workshop's own photograph dataset, which is
   * divisional reading rather than shop-floor work, so it moves to
   * analytics.read — the administrator and the DRM. A supervisor loses it and
   * the DRM gains it. Nothing in the interface calls this endpoint; it is used
   * out of band to assemble a training set, so no screen changes.
   */
  requireCapability('analytics.read'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const db = getDatabase();
      const includeImages = String(req.query?.includeImages || '').toLowerCase() === 'true';
      const limit = Math.min(Number(req.query?.limit) || 500, 2000);

      const rows = db.prepare(`
        SELECT id, wagon_number, category, part_name, tags_json, created_at,
               inspector_name${includeImages ? ', image_data' : ''}
        FROM wagon_photos
        WHERE tags_json LIKE '%DEFECT_EVIDENCE%'
        ORDER BY created_at DESC
        LIMIT ?
      `).all(limit) as any[];

      const samples = rows.map((r) => {
        let tags: string[] = [];
        try {
          tags = JSON.parse(r.tags_json || '[]');
        } catch {
          tags = [];
        }
        const labelTag = tags.find((t) => t.startsWith('DAMAGE_'));
        return {
          id: r.id,
          wagonNumber: r.wagon_number,
          category: r.category,
          partName: r.part_name,
          // The defect type is the training label.
          label: labelTag ? labelTag.replace('DAMAGE_', '') : 'UNSPECIFIED',
          tags,
          capturedAt: r.created_at,
          capturedBy: r.inspector_name,
          ...(includeImages ? { imageBase64: r.image_data } : {})
        };
      });

      // Class balance matters more than raw count when judging readiness.
      const labelCounts: Record<string, number> = {};
      for (const s of samples) labelCounts[s.label] = (labelCounts[s.label] || 0) + 1;

      res.status(200).json({
        success: true,
        data: {
          totalSamples: samples.length,
          labelCounts,
          // An honest readiness signal rather than a vague "collecting data".
          readiness:
            samples.length >= 1000
              ? 'A defect classifier is worth attempting on this volume.'
              : samples.length >= 200
              ? 'Useful for evaluation and baselines; too few to train a dependable classifier yet.'
              : 'Still accumulating. Keep capturing — every condemnation adds a labelled example.',
          samples
        },
        meta: { includeImages, timestamp: new Date().toISOString() }
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: 'DATASET_QUERY_FAILED',
        message: err?.message || 'Could not build the defect dataset',
        statusCode: 500,
        timestamp: new Date().toISOString()
      });
    }
  }
);

photosRouter.get('/:photoId', authMiddleware, async (req: Request, res: Response) => {
  const repo = getRepo();
  const photoId = req.params?.photoId;

  if (!photoId) {
    res.status(400).json({
      success: false,
      error: 'MISSING_PARAM',
      message: 'photoId parameter is required',
      statusCode: 400,
      timestamp: new Date().toISOString()
    });
    return;
  }

  const photo = repo.getPhotoById(photoId);
  if (!photo) {
    res.status(404).json({
      success: false,
      error: 'PHOTO_NOT_FOUND',
      message: `Photo with ID ${photoId} was not found.`,
      statusCode: 404,
      timestamp: new Date().toISOString()
    });
    return;
  }

  res.status(200).json({
    success: true,
    data: photo,
    meta: { timestamp: new Date().toISOString() }
  });
});

// -------------------------------------------------------------------------
// 3. Retrieve Photos for a Wagon
// -------------------------------------------------------------------------

photosRouter.get('/wagon/:wagonNumber', authMiddleware, async (req: Request, res: Response) => {
  const repo = getRepo();
  const wagonNumber = req.params?.wagonNumber;
  const category = req.query?.category;
  const stage = req.query?.stage;

  if (!wagonNumber) {
    res.status(400).json({
      success: false,
      error: 'MISSING_PARAM',
      message: 'wagonNumber parameter is required',
      statusCode: 400,
      timestamp: new Date().toISOString()
    });
    return;
  }

  const photos = repo.getPhotosByWagon(wagonNumber, category, stage);

  res.status(200).json({
    success: true,
    data: photos,
    meta: {
      wagonNumber,
      totalPhotos: photos.length,
      timestamp: new Date().toISOString()
    }
  });
});
