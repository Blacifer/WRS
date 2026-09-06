/**
 * Stored photographs have a size, and it is bounded
 * Indian Railways WRS Raipur
 *
 * Two of the four capture screens encoded whatever the camera gave them. On a
 * twelve-megapixel tablet that is megabytes per photograph, base64'd into the
 * same SQLite file as the audit chain, at roughly seven hundred springs a
 * shift. The two that were right were the two somebody had tested on a phone
 * — the same way the hard facingMode constraint survived in half the cameras.
 */

import { describe, it, expect } from 'vitest';
import {
  fitToStoredSize,
  dataUrlBytes,
  MAX_STORED_EDGE,
  MAX_STORED_PHOTO_BYTES
} from './imageSizing.ts';
import { MAX_STORED_PHOTO_BYTES as SHARED_LIMIT } from '../../../shared/media/imageLimits.ts';

describe('Stored photograph sizing', () => {
  it('brings a full-resolution tablet photograph inside the limit', () => {
    const { width, height } = fitToStoredSize(4032, 3024);
    expect(Math.max(width, height)).toBe(MAX_STORED_EDGE);
    // Aspect ratio is preserved, or the evidence is distorted.
    expect(width / height).toBeCloseTo(4032 / 3024, 2);
  });

  it('handles a portrait frame by its long edge, not its width', () => {
    const { width, height } = fitToStoredSize(3024, 4032);
    expect(height).toBe(MAX_STORED_EDGE);
    expect(width).toBeLessThan(height);
  });

  it('never enlarges a frame that is already small', () => {
    // Upscaling produces a bigger file carrying no more detail.
    expect(fitToStoredSize(640, 480)).toEqual({ width: 640, height: 480 });
  });

  it('leaves a frame exactly at the limit alone', () => {
    expect(fitToStoredSize(MAX_STORED_EDGE, 900)).toEqual({ width: MAX_STORED_EDGE, height: 900 });
  });

  it('survives a zero-sized frame rather than dividing by it', () => {
    // A video element read before it has dimensions.
    expect(fitToStoredSize(0, 0)).toEqual({ width: 1, height: 1 });
  });

  it('measures a data URL without decoding it', () => {
    // "AAAA" is 4 base64 chars with no padding = 3 bytes.
    expect(dataUrlBytes('data:image/jpeg;base64,AAAA')).toBe(3);
    expect(dataUrlBytes('data:image/jpeg;base64,AAA=')).toBe(2);
    expect(dataUrlBytes('data:image/jpeg;base64,AA==')).toBe(1);
  });

  it('uses the same ceiling the server enforces', () => {
    /*
     * If these drifted apart the failure would be silent: the client would
     * either send what the server rejects, or stop bounding what the server
     * still accepts.
     */
    expect(MAX_STORED_PHOTO_BYTES).toBe(SHARED_LIMIT);
  });

  it('leaves real headroom above what the capture path produces', () => {
    /*
     * A 1600px JPEG at quality 0.85 is a few hundred kilobytes. The ceiling
     * is well above that on purpose: it exists to stop something that is not
     * the capture path, not to reject a slightly large photograph.
     */
    expect(MAX_STORED_PHOTO_BYTES).toBeGreaterThan(1024 * 1024);
    expect(MAX_STORED_PHOTO_BYTES).toBeLessThan(10 * 1024 * 1024);
  });
});
