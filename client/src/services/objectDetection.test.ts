/**
 * Smart Vision detection tests
 * Indian Railways WRS Raipur
 *
 * The camera and the model are not exercised here — a browser and a device
 * are needed for that, and these tests would be lying if they claimed
 * otherwise. What is tested is everything between the model's output and what
 * reaches the audit trail: how a class is classified, what gets excluded, and
 * which part of the frame survives.
 *
 * That boundary is where the requirement actually lives. "Recognises a human
 * and actively filters it out" is a statement about this logic, given a
 * detection; whether the model spots the person in the first place is COCO-SSD's
 * business and is verified on a real device, not here.
 */

import { describe, it, expect } from 'vitest';
import {
  detectFrame,
  describeExclusions,
  exclusionTags,
  MIN_SCORE,
  type Detection
} from './objectDetection.ts';

const W = 640;
const H = 480;

/** Stands in for the model, so the logic can be tested without weights. */
function fakeModel(results: Array<{ class: string; score: number; bbox: [number, number, number, number] }>) {
  return {
    detect: async (
      _f: unknown,
      _max?: number,
      minScore?: number
    ) => results.filter((r) => r.score >= (minScore ?? 0))
  } as any;
}

const frame = {} as HTMLCanvasElement;

describe('Smart Vision — what is recognised, and what is kept', () => {
  it('classifies a person as PERSON and counts them', async () => {
    const res = await detectFrame(
      fakeModel([{ class: 'person', score: 0.94, bbox: [0, 0, 120, 480] }]),
      frame, W, H
    );

    expect(res.personCount).toBe(1);
    const person = res.detections.find((d: Detection) => d.className === 'person');
    expect(person?.role).toBe('PERSON');
    // The score is reported exactly as the model gave it.
    expect(person?.score).toBe(0.94);
  });

  it('classifies known clutter as BACKGROUND', async () => {
    const res = await detectFrame(
      fakeModel([
        { class: 'chair', score: 0.7, bbox: [0, 0, 80, 200] },
        { class: 'bottle', score: 0.8, bbox: [560, 0, 80, 120] }
      ]),
      frame, W, H
    );

    expect(res.backgroundCount).toBe(2);
    expect(res.personCount).toBe(0);
  });

  it('names an unlisted class OTHER but still excludes it', async () => {
    /*
     * The list decides how a thing is described, never whether it is
     * filtered. Anything recognised is kept out of the capture.
     */
    const res = await detectFrame(
      fakeModel([{ class: 'train', score: 0.9, bbox: [0, 0, 100, 480] }]),
      frame, W, H
    );

    expect(res.detections[0].role).toBe('OTHER');
    expect(res.targetRegion).not.toBeNull();
    // The region starts past the excluded box rather than at the frame edge.
    expect(res.targetRegion!.x).toBe(100);
  });

  it('ignores anything below the confidence floor', async () => {
    const res = await detectFrame(
      fakeModel([{ class: 'person', score: MIN_SCORE - 0.01, bbox: [0, 0, 100, 480] }]),
      frame, W, H
    );

    expect(res.detections).toHaveLength(0);
    expect(res.personCount).toBe(0);
    // A frame with nothing recognised keeps the whole picture.
    expect(res.targetRegion).toEqual({ x: 0, y: 0, width: W, height: H });
  });

  it('excludes a person at the edge by narrowing the frame, not blanking it', async () => {
    const res = await detectFrame(
      fakeModel([{ class: 'person', score: 0.95, bbox: [0, 0, 160, 480] }]),
      frame, W, H
    );

    expect(res.targetRegion).not.toBeNull();
    expect(res.targetRegion!.x).toBe(160);
    expect(res.targetRegion!.width).toBe(W - 160);
    expect(res.targetRegion!.height).toBe(H);
  });

  it('reports no usable region when a person fills the frame', async () => {
    /*
     * The honest answer to "photograph the component" when a person is
     * standing in front of it is that you cannot, and the inspector should be
     * told to move rather than handed a sliver of shoulder.
     */
    const res = await detectFrame(
      fakeModel([{ class: 'person', score: 0.97, bbox: [10, 10, 620, 460] }]),
      frame, W, H
    );

    expect(res.personCount).toBe(1);
    expect(res.targetRegion).toBeNull();
  });

  it('keeps the whole frame when nothing is recognised', async () => {
    const res = await detectFrame(fakeModel([]), frame, W, H);

    expect(res.detections).toHaveLength(0);
    expect(res.targetRegion).toEqual({ x: 0, y: 0, width: W, height: H });
  });

  it('never reports a component class, because the model has none', async () => {
    /*
     * The integrity test for this whole feature. COCO-SSD is trained on eighty
     * everyday classes and a CASNUB spring is not among them. Nothing in this
     * pipeline may invent one — a demonstration drawing "SPRING 98%" over an
     * untrained model is a fabrication, and the first person to point the
     * camera at a chair would find it out.
     */
    const res = await detectFrame(
      fakeModel([
        { class: 'person', score: 0.9, bbox: [0, 0, 60, 480] },
        { class: 'chair', score: 0.8, bbox: [580, 0, 60, 200] }
      ]),
      frame, W, H
    );

    for (const d of res.detections) {
      expect(d.className).not.toMatch(/spring|bogie|wagon|snubber|casnub/i);
      expect(['PERSON', 'BACKGROUND', 'OTHER']).toContain(d.role);
    }
  });

  it('reports how long inference took, for the diagnostic readout', async () => {
    const res = await detectFrame(fakeModel([]), frame, W, H);
    expect(typeof res.inferenceMs).toBe('number');
    expect(res.inferenceMs).toBeGreaterThanOrEqual(0);
  });
});

/**
 * Anything in frame that is not a component must be visible on the image, not
 * silently dropped.
 *
 * The requirement, in the shop's words: if the camera sees a chair, a person,
 * or anything else that is not on the list, it should show it on the image and
 * box it out. Two halves — box it (the annotated frame) and say so (the record
 * beside it) — and the second is the one that survives to an audit six months
 * later, when nobody can re-run the camera.
 */
describe('Smart Vision — what was excluded is stated, not silently dropped', () => {
  it('names every recognised object in the sentence that goes with the record', async () => {
    const res = await detectFrame(
      fakeModel([
        { class: 'person', score: 0.94, bbox: [0, 0, 100, 400] },
        { class: 'chair', score: 0.81, bbox: [400, 100, 120, 160] }
      ]),
      frame, W, H
    );

    const note = describeExclusions(res);
    expect(note).toContain('person');
    expect(note).toContain('chair');
    expect(note).toContain('Not included in the stored photograph');
  });

  it('groups repeats by count rather than listing them one by one', async () => {
    const res = await detectFrame(
      fakeModel([
        { class: 'bottle', score: 0.7, bbox: [10, 10, 20, 40] },
        { class: 'bottle', score: 0.7, bbox: [40, 10, 20, 40] },
        { class: 'bottle', score: 0.7, bbox: [70, 10, 20, 40] }
      ]),
      frame, W, H
    );
    expect(describeExclusions(res)).toContain('3 bottles');
  });

  it('reports an object the shop has no rule about, by the model\'s own name', async () => {
    /*
     * The point of the requirement. A cricket bat on the bench is not a
     * person and not on the clutter list, and the honest thing is to name it
     * as the model named it rather than quietly ignoring it or inventing a
     * component label for it.
     */
    const res = await detectFrame(
      fakeModel([{ class: 'baseball bat', score: 0.77, bbox: [200, 200, 80, 40] }]),
      frame, W, H
    );

    expect(res.detections[0].role).toBe('OTHER');
    expect(res.detections[0].className).toBe('baseball bat');
    expect(describeExclusions(res)).toContain('baseball bat');
    expect(exclusionTags(res)).toEqual(['EXCLUDED:baseball bat:1']);
  });

  it('says nothing rather than something vague when nothing was recognised', async () => {
    const res = await detectFrame(fakeModel([]), frame, W, H);
    expect(describeExclusions(res)).toBeNull();
    expect(exclusionTags(res)).toEqual([]);
  });

  it('carries the counts into the tags that reach the stored record', async () => {
    const res = await detectFrame(
      fakeModel([
        { class: 'person', score: 0.9, bbox: [0, 0, 50, 400] },
        { class: 'person', score: 0.88, bbox: [60, 0, 50, 400] },
        { class: 'chair', score: 0.75, bbox: [400, 100, 120, 160] }
      ]),
      frame, W, H
    );

    // Sorted by class so the same scene always produces the same tags.
    expect(exclusionTags(res)).toEqual(['EXCLUDED:chair:1', 'EXCLUDED:person:2']);
  });

  it('never names a component, because the model has no component class', async () => {
    /*
     * The guard that matters most. If a future edit ever maps a COCO class
     * onto a spring, this fails — a photograph labelled SPRING by a model
     * with no spring class is a fabrication on an inspection record.
     */
    const res = await detectFrame(
      fakeModel([{ class: 'donut', score: 0.9, bbox: [10, 10, 60, 60] }]),
      frame, W, H
    );
    const note = (describeExclusions(res) || '').toUpperCase();
    for (const word of ['SPRING', 'OUTER', 'INNER', 'SNUBBER', 'BOGIE', 'WAGON']) {
      expect(note).not.toContain(word);
    }
  });
});
