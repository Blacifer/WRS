/**
 * Photo Evidence & Mobile Tagging Engine
 * Indian Railways WRS Raipur (Phase 2)
 *
 * Implements camera photo capture, auto-tagging (wagon, category, part, inspector, timestamp),
 * and photo gallery retrieval per wagon.
 */

import crypto from 'node:crypto';
import type { PhotoRecord, PhotoUploadRequest, CASNUBCategory, User } from '../../shared/types.ts';
import { CASNUB_CATEGORIES } from '../../shared/types.ts';

export class PhotoEvidenceEngine {
  private photos: Map<string, PhotoRecord> = new Map();

  /**
   * Auto-tag and store a photo evidence record
   */
  public uploadPhoto(
    req: PhotoUploadRequest,
    user: { id: string; name?: string }
  ): { photo: PhotoRecord } | { error: string } {
    if (!req.wagonNumber || typeof req.wagonNumber !== 'string' || req.wagonNumber.trim().length === 0) {
      return { error: 'Wagon number is required for photo attachment' };
    }

    if (!req.partCategory || !CASNUB_CATEGORIES.includes(req.partCategory)) {
      return { error: `Invalid part category: ${req.partCategory}` };
    }

    if (!req.partName || typeof req.partName !== 'string' || req.partName.trim().length === 0) {
      return { error: 'Part name is required for photo attachment' };
    }

    if (!req.imageBase64 || typeof req.imageBase64 !== 'string' || req.imageBase64.trim().length === 0) {
      return { error: 'imageBase64 payload is required' };
    }

    const id = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const dateStr = timestamp.slice(0, 10);

    const tags: string[] = [
      req.wagonNumber.trim(),
      req.partCategory,
      req.partName.trim(),
      user.id,
      dateStr,
      ...(req.tags || [])
    ];

    const photo: PhotoRecord = {
      id,
      wagonNumber: req.wagonNumber.trim(),
      partCategory: req.partCategory,
      partName: req.partName.trim(),
      inspectorId: user.id,
      inspectorName: user.name || user.id,
      timestamp,
      imageBase64: req.imageBase64,
      tags
    };

    this.photos.set(id, photo);
    return { photo };
  }

  public getPhotoById(photoId: string): PhotoRecord | null {
    return this.photos.get(photoId) || null;
  }

  public getPhotosByWagon(wagonNumber: string): PhotoRecord[] {
    return Array.from(this.photos.values()).filter(p => p.wagonNumber === wagonNumber);
  }

  public getAllPhotos(): PhotoRecord[] {
    return Array.from(this.photos.values());
  }

  public clear(): void {
    this.photos.clear();
  }
}
