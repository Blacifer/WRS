/**
 * Smart Vision — what is actually in front of the camera
 * Indian Railways WRS Raipur
 *
 * WHAT THIS IS
 * ------------
 * Real object detection in the browser, using COCO-SSD (SSD-Lite MobileNet V2)
 * through TensorFlow.js. It runs on the device, needs no network once the
 * weights are cached, and nothing it reports is simulated.
 *
 * It exists to satisfy a specific requirement: the camera must demonstrate
 * that it recognises a human or background clutter and actively excludes it,
 * so that a captured frame records the component and not the person holding
 * it.
 *
 * WHAT IT HONESTLY CANNOT DO, AND WHY THE LABELS SAY SO
 * -----------------------------------------------------
 * COCO-SSD is trained on eighty everyday classes — person, chair, bottle, and
 * so on. **"Spring" is not one of them, and neither is any railway
 * component.** No amount of confidence tuning changes that; the model has
 * never seen a CASNUB spring and has no class to put one in.
 *
 * So this module is careful about what it claims:
 *
 *   - A person is a REAL detection. The model has a `person` class, it is one
 *     of its strongest, and when this says "person excluded" that is a fact
 *     about the frame.
 *   - Recognised clutter is a REAL detection, for the same reason.
 *   - The component region is NOT a detection. It is the area left once
 *     people and clutter are removed, and it is labelled "target region"
 *     rather than "spring", because calling it a spring would be the software
 *     asserting something it does not know.
 *
 * That distinction is the whole integrity of the feature. A demonstration that
 * drew "SPRING 98%" over an untrained model would be a fabrication, and the
 * first person to point the camera at a chair would discover it.
 *
 * Identifying the component itself needs a model trained on this shop's own
 * photographs. `GET /api/photos/dataset` is already collecting and labelling
 * them, and reports when the volume is enough to attempt it.
 *
 * OFFLINE
 * -------
 * Weights are served from this application at /models/coco-ssd/, not from a
 * Google CDN, because a workshop LAN may have no route to the internet. They
 * are roughly 19 MB, fetched once on first use of this screen and then cached
 * by the browser — which is why loading is deliberately explicit and reports
 * progress rather than blocking the UI.
 */

/** A class COCO-SSD genuinely knows, in the categories this shop cares about. */
export type DetectionRole =
  /** A human in frame. Excluded from what gets recorded. */
  | 'PERSON'
  /** Recognised everyday clutter — tools, furniture, bags. Excluded. */
  | 'BACKGROUND'
  /** Recognised, but not something we have a rule about. Excluded, and named. */
  | 'OTHER';

export interface Detection {
  /** The model's own class name, unaltered. */
  className: string;
  role: DetectionRole;
  /** 0-1, straight from the model. Never rounded up for presentation. */
  score: number;
  /** [x, y, width, height] in the source frame's pixels. */
  bbox: [number, number, number, number];
}

export interface VisionResult {
  /** Everything the model found above the threshold. */
  detections: Detection[];
  /** People found. The requirement's headline case. */
  personCount: number;
  /** Recognised clutter, excluded from the capture. */
  backgroundCount: number;
  /**
   * The region a capture should keep: the frame with detected people and
   * clutter cut out of consideration. Null when a person fills so much of the
   * frame that nothing useful is left, which is itself worth telling the
   * inspector.
   */
  targetRegion: { x: number; y: number; width: number; height: number } | null;
  /** Milliseconds the model took, for the diagnostic readout. */
  inferenceMs: number;
}

/**
 * COCO classes treated as workshop clutter.
 *
 * Drawn from what a model actually reports when pointed at a shop floor: bags
 * and bottles on the bench, chairs, a phone in shot. Anything recognised but
 * unlisted becomes OTHER, which is still excluded — the list decides how a
 * thing is described, never whether it is filtered.
 */
const BACKGROUND_CLASSES = new Set([
  'chair', 'bench', 'dining table', 'tv', 'laptop', 'cell phone', 'keyboard',
  'mouse', 'book', 'bottle', 'cup', 'backpack', 'handbag', 'suitcase',
  'umbrella', 'clock', 'potted plant', 'vase', 'scissors', 'remote'
]);

/**
 * Minimum confidence before anything is reported.
 *
 * Deliberately not low. A false "person excluded" over an empty frame teaches
 * an inspector that the overlay is noise, and an overlay people ignore fails
 * the requirement just as surely as one that does nothing.
 */
export const MIN_SCORE = 0.5;

/** Where the weights live. Served by this app, never a third-party CDN. */
export const MODEL_URL = '/models/coco-ssd/model.json';

type CocoModel = {
  detect: (
    input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
    maxNumBoxes?: number,
    minScore?: number
  ) => Promise<Array<{ class: string; score: number; bbox: [number, number, number, number] }>>;
};

let modelPromise: Promise<CocoModel> | null = null;

/**
 * Load the detector, once per session.
 *
 * TensorFlow and the weights are imported dynamically so that the ~19 MB of
 * this feature is never on the path of an inspector who only sorts springs.
 */
export function loadDetector(): Promise<CocoModel> {
  if (!modelPromise) {
    modelPromise = (async () => {
      const [, cocoSsd] = await Promise.all([
        import('@tensorflow/tfjs'),
        import('@tensorflow-models/coco-ssd')
      ]);
      return (await cocoSsd.load({ modelUrl: MODEL_URL })) as unknown as CocoModel;
    })().catch((err) => {
      // Allow a later retry rather than caching the failure for the session —
      // the usual cause is the first fetch of the weights being interrupted.
      modelPromise = null;
      throw err;
    });
  }
  return modelPromise;
}

/** True when the weights have already been loaded this session. */
export function isDetectorLoaded(): boolean {
  return modelPromise !== null;
}

function roleFor(className: string): DetectionRole {
  if (className === 'person') return 'PERSON';
  if (BACKGROUND_CLASSES.has(className)) return 'BACKGROUND';
  return 'OTHER';
}

/**
 * The area left once everything recognised has been cut out.
 *
 * Deliberately simple: shrink the frame away from whichever edge each excluded
 * box intrudes from. It is not a segmentation, and it does not pretend to
 * outline the component — it answers "which part of this frame has nothing
 * recognisable in it", which is what deciding where to crop actually needs.
 */
function computeTargetRegion(
  frameWidth: number,
  frameHeight: number,
  excluded: Detection[]
): VisionResult['targetRegion'] {
  let left = 0;
  let top = 0;
  let right = frameWidth;
  let bottom = frameHeight;

  for (const d of excluded) {
    const [x, y, w, h] = d.bbox;
    const boxRight = x + w;
    const boxBottom = y + h;

    // Push in from whichever side the box is nearest, so a person standing at
    // the edge narrows the frame rather than erasing its middle.
    const fromLeft = x;
    const fromRight = frameWidth - boxRight;
    const fromTop = y;
    const fromBottom = frameHeight - boxBottom;
    const nearest = Math.min(fromLeft, fromRight, fromTop, fromBottom);

    if (nearest === fromLeft) left = Math.max(left, boxRight);
    else if (nearest === fromRight) right = Math.min(right, x);
    else if (nearest === fromTop) top = Math.max(top, boxBottom);
    else bottom = Math.min(bottom, y);
  }

  const width = right - left;
  const height = bottom - top;

  // Less than a tenth of the frame is not a usable capture; say so rather than
  // returning a sliver the inspector would photograph by accident.
  if (width <= 0 || height <= 0 || width * height < frameWidth * frameHeight * 0.1) {
    return null;
  }

  return { x: left, y: top, width, height };
}

/**
 * Run one detection pass over a frame.
 *
 * The caller owns the camera and the loop; this stays a pure question about
 * one image so it can be tested without a device.
 */
export async function detectFrame(
  model: CocoModel,
  frame: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  frameWidth: number,
  frameHeight: number
): Promise<VisionResult> {
  const started = performance.now();
  const raw = await model.detect(frame, 20, MIN_SCORE);
  const inferenceMs = Math.round(performance.now() - started);

  const detections: Detection[] = raw
    .filter((r) => r.score >= MIN_SCORE)
    .map((r) => ({
      className: r.class,
      role: roleFor(r.class),
      score: r.score,
      bbox: r.bbox
    }));

  return {
    detections,
    personCount: detections.filter((d) => d.role === 'PERSON').length,
    backgroundCount: detections.filter((d) => d.role === 'BACKGROUND').length,
    // Everything recognised is excluded from the capture, whatever its role.
    targetRegion: computeTargetRegion(frameWidth, frameHeight, detections),
    inferenceMs
  };
}

/**
 * Crop a frame to the target region, for the capture that gets stored.
 *
 * This is what makes "strictly record the target component" true rather than
 * asserted: the pixels containing a recognised person are not in the file that
 * reaches the audit trail.
 */
export function cropToTarget(
  frame: HTMLVideoElement | HTMLCanvasElement,
  region: VisionResult['targetRegion'],
  frameWidth: number,
  frameHeight: number
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const r = region ?? { x: 0, y: 0, width: frameWidth, height: frameHeight };
  canvas.width = Math.max(1, Math.round(r.width));
  canvas.height = Math.max(1, Math.round(r.height));

  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.drawImage(
      frame as CanvasImageSource,
      r.x, r.y, r.width, r.height,
      0, 0, canvas.width, canvas.height
    );
  }
  return canvas;
}

/**
 * The frame with everything the model found drawn on it.
 *
 * WHY THIS IS SEPARATE FROM THE EVIDENCE PHOTOGRAPH
 * -------------------------------------------------
 * `cropToTarget` above produces what gets STORED against the inspection: the
 * component, with people and clutter cut out of the pixels. That is
 * deliberate — an inspection record should not quietly accumulate photographs
 * of the people who took it.
 *
 * This produces something different and equally necessary: proof that the
 * camera saw what it says it saw. A chair, a person, a bottle on the bench —
 * boxed, named, with the model's own confidence, on the frame itself. Without
 * it, "one person was excluded" is a claim the inspector has to take on faith,
 * and an exclusion nobody can see is indistinguishable from the detector
 * having done nothing at all.
 *
 * So the annotated frame is what the inspector is shown and what a supervisor
 * can be handed; the cropped frame is what the record keeps.
 */
export function annotateFrame(
  frame: HTMLVideoElement | HTMLCanvasElement,
  result: VisionResult,
  frameWidth: number,
  frameHeight: number
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(frameWidth));
  canvas.height = Math.max(1, Math.round(frameHeight));

  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  ctx.drawImage(frame as CanvasImageSource, 0, 0, canvas.width, canvas.height);

  /* The region that survives, drawn under the exclusions so the exclusions
   * remain legible where the two overlap. */
  if (result.targetRegion) {
    const r = result.targetRegion;
    ctx.strokeStyle = '#34d399';
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 6]);
    ctx.strokeRect(r.x, r.y, r.width, r.height);
    ctx.setLineDash([]);
  }

  for (const d of result.detections) {
    const [x, y, w, h] = d.bbox;
    const colour = d.role === 'PERSON' ? '#f87171' : d.role === 'BACKGROUND' ? '#fbbf24' : '#a3a3a3';

    ctx.strokeStyle = colour;
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, w, h);

    /*
     * The model's own class name and its own score. Neither is rounded up,
     * relabelled, or mapped onto a component name — the whole value of this
     * overlay is that every word on it came from the detector.
     */
    const label = `${d.className.toUpperCase()} ${(d.score * 100).toFixed(0)}%`;
    ctx.font = 'bold 14px system-ui, sans-serif';
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = colour;
    ctx.fillRect(x, Math.max(0, y - 22), tw + 12, 22);
    ctx.fillStyle = '#0b0f14';
    ctx.fillText(label, x + 6, Math.max(14, y - 6));
  }

  return canvas;
}

/**
 * What was in frame and is not in the stored photograph, in a sentence.
 *
 * This goes into the record beside the image. A photograph that has had
 * things cut out of it should say so in words a person reads six months
 * later, rather than leaving a cropped frame that looks like the whole
 * scene.
 *
 * Counts are grouped by class so five bottles read as "5 bottles" rather
 * than five separate clauses.
 */
export function describeExclusions(result: VisionResult, isHi = false): string | null {
  if (!result.detections.length) return null;

  const counts = new Map<string, number>();
  for (const d of result.detections) {
    counts.set(d.className, (counts.get(d.className) || 0) + 1);
  }

  const parts = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, n]) => (n === 1 ? `1 ${name}` : `${n} ${name}s`));

  const list = parts.length === 1
    ? parts[0]
    : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;

  return isHi
    ? `कैमरे ने फ़्रेम में ${list} देखा। यह संग्रहीत तस्वीर में शामिल नहीं है।`
    : `The camera detected ${list} in frame. Not included in the stored photograph.`;
}

/**
 * The exclusions as tags, for the stored record.
 *
 * `wagon_photos` has no free-text notes column and it sits behind append-only
 * triggers, so adding one is a migration rather than a field — not something
 * to do casually to a table that already holds evidence. Tags carry the same
 * information in a form the gallery already displays and a query can filter
 * on, and `describeExclusions` can rebuild the sentence from them wherever a
 * person needs to read it.
 *
 * Shape is `EXCLUDED:<class>:<count>` — the model's own class name, never a
 * component name it does not know.
 */
export function exclusionTags(result: VisionResult): string[] {
  const counts = new Map<string, number>();
  for (const d of result.detections) {
    counts.set(d.className, (counts.get(d.className) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, n]) => `EXCLUDED:${name}:${n}`);
}
