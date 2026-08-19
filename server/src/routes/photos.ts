/**
 * Photo Evidence & Auto-Tagging API Router
 * Indian Railways WRS Raipur (Phase 2)
 */

import { Router } from '../framework/index.ts';
import type { Request, Response } from '../framework/index.ts';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth.ts';
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
