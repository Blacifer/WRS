/**
 * Photo Evidence & Auto-Tagging API Router
 * Indian Railways WRS Raipur (Phase 2)
 */

import { Router } from '../framework/index.ts';
import type { Request, Response } from '../framework/index.ts';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth.ts';
import type { AuthenticatedRequest } from '../middleware/auth.ts';
import { requireRole } from '../middleware/rbac.ts';
import { getDatabase } from '../db/connection.ts';
import { WagonRepository } from '../db/wagonRepository.ts';

export const photosRouter = Router();

function getRepo() {
  const db = getDatabase();
  return new WagonRepository(db);
}

// -------------------------------------------------------------------------
// 1. Upload & Auto-tag Photo Evidence
// -------------------------------------------------------------------------

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
    tags
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

  const inspectorId = req.user?.id || 'usr_insp_001';
  const inspectorName = req.user?.name || 'Inspector';

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
      tags: Array.isArray(tags) ? tags : [wagonNumber, effectiveCategory, partName].filter(Boolean)
    });

    // If checklistItemId is provided, link photo to checklist item
    if (checklistItemId) {
      repo.updateChecklistItem(checklistItemId, { photoId: photo.id });
    }

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
  requireRole('SUPERVISOR', 'ADMIN'),
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

photosRouter.get('/:photoId', optionalAuthMiddleware, async (req: Request, res: Response) => {
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

photosRouter.get('/wagon/:wagonNumber', optionalAuthMiddleware, async (req: Request, res: Response) => {
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
