/**
 * How large a stored photograph is allowed to be
 * Indian Railways WRS Raipur
 *
 * WHY THIS IS ONE PLACE
 * ---------------------
 * Four screens capture a photograph, and two of them downscaled the frame
 * before encoding while two encoded whatever the camera gave them. A workshop
 * tablet's rear camera is around twelve megapixels, so those two produced
 * JPEGs of a few megabytes, which become base64 rows a third larger again, in
 * a single SQLite file that also holds the audit chain.
 *
 * The sorting bench alone runs at roughly seven hundred springs a shift. With
 * evidence photography on, unbounded capture is measured in gigabytes a
 * month — and the cost is not only disk. Every backup copies it, every query
 * against the photo table drags it, and the device holds the same bytes in
 * IndexedDB while it waits for a network.
 *
 * The two components that got it right were the ones somebody had tested on a
 * real phone. That is the same reason the hard `facingMode` constraint
 * survived in half the cameras. So the rule lives here rather than in each
 * component, and a test asserts every capture path uses it.
 *
 * WHAT THE LIMIT IS FOR
 * ---------------------
 * 1600 px on the long edge is far more than enough to see a crack, corrosion
 * or a bent lug on a component photographed at arm's length — the defects
 * these photographs exist to show. It is deliberately not lower: this is
 * evidence somebody may have to defend, and a photograph too coarse to settle
 * an argument fails at the only job it has.
 */

/** Long edge, in pixels, of any photograph this system stores. */
export const MAX_STORED_EDGE = 1600;

/** JPEG quality for stored evidence. High enough to keep fine texture. */
export const STORED_QUALITY = 0.85;

/**
 * The largest base64 payload the server will accept for one photograph.
 *
 * Sized from the rule above with generous headroom rather than measured from
 * one sample: a 1600 px JPEG at this quality is a few hundred kilobytes, so
 * anything past this ceiling did not come from the capture path and should be
 * refused rather than quietly stored.
 *
 * Kept in shared reach of both sides on purpose. The client caps what it
 * sends; the server refuses what it is sent. Neither trusts the other — a
 * device with an older bundle, or a caller that is not the app at all, must
 * not be able to put a fifty megabyte row into the evidence table.
 */
export { MAX_STORED_PHOTO_BYTES } from '../../../shared/media/imageLimits.ts';

/**
 * Fits a frame inside the stored-photo limit, preserving aspect ratio.
 *
 * Returns the dimensions to draw at. Never enlarges: a small frame is left
 * alone rather than upscaled into a bigger file that carries no more detail.
 */
export function fitToStoredSize(
  width: number,
  height: number,
  maxEdge: number = MAX_STORED_EDGE
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (!longest || longest <= maxEdge) {
    return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
  }
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

/** Approximate byte length of a base64 data URL, without decoding it. */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}
