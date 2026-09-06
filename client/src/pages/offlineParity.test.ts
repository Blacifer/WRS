/**
 * What is recorded offline must be what is recorded online
 * Indian Railways WRS Raipur
 *
 * A spring inspection reaches the server by one of two routes. When there is
 * network the page posts it; when there is not, it goes into the IndexedDB
 * queue and is drained later. Both end at the same table, so the two payloads
 * have to agree — and they are written out by hand, separately, at five call
 * sites across three pages, which is why they did not.
 *
 * The field that went missing was the bogie. Online it was sent; offline it
 * was dropped. A spring with no bogie counts towards neither of them, so a
 * shift measured with the tablet out of signal read at the exit gate as a
 * shift of missing springs — and those springs grouped into a nest of their
 * own, where the 3 mm rule reported a free-height variation across springs
 * that never sat in the same nest.
 *
 * Nothing about a measurement should depend on whether the shop had signal
 * when it was taken. The symptom is also invisible on any bench with wi-fi,
 * which is the reason to pin it here rather than to trust a walkthrough.
 *
 * This checks the source rather than the behaviour on purpose: the bug is
 * that one branch of an if/else says less than the other, and that is a
 * property of the text. Rendering these pages to catch it would need a
 * browser, an IndexedDB and a forced offline state, and would still only
 * cover the one call site the test happened to drive.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const PAGES = import.meta.dirname;

/**
 * Slices out each `offlineDb.enqueueInspection({ ... })` argument by walking
 * braces, so a nested object inside the payload does not end the match early.
 */
function enqueuedPayloads(src: string, marker = 'enqueueInspection({'): string[] {
  const payloads: string[] = [];
  let from = 0;

  for (;;) {
    const start = src.indexOf(marker, from);
    if (start === -1) break;

    let depth = 0;
    let i = start + marker.length - 1;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    payloads.push(src.slice(start, i + 1));
    from = i + 1;
  }

  return payloads;
}

/** True if the payload passes `key`, written either longhand or shorthand. */
function present(payload: string, key: string): boolean {
  return new RegExp(`\\b${key}\\s*[:,}\\n]`).test(payload);
}

describe('The offline queue records everything the online post records', () => {
  const files = readdirSync(PAGES)
    .filter((f) => /\.tsx$/.test(f))
    .map((f) => join(PAGES, f));

  it('every offline spring inspection names the bogie it was measured on', () => {
    const offenders: string[] = [];
    let checked = 0;

    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const payload of enqueuedPayloads(src)) {
        checked++;
        // `key: value` and the shorthand `key,` are both the field being
        // passed. Matching only the colon form failed a payload that was
        // perfectly correct.
        if (!present(payload, 'bogiePosition')) {
          offenders.push(f.split('/').pop() as string);
        }
      }
    }

    expect(checked).toBeGreaterThan(0);
    expect(
      offenders,
      'a queued spring with no bogie counts towards neither bogie at the exit gate'
    ).toEqual([]);
  });

  it('a photograph queued offline stays tied to the finding it evidences', () => {
    /*
     * The same defect in a different queue. `api.uploadPhoto` is called with
     * `checklistItemId` and `enqueuePhoto` was not, so a defect photo taken
     * with no signal arrived detached from the finding it exists to prove.
     * The sync endpoint had always read the field off a queued photo; nothing
     * ever put one there.
     *
     * The rule is conditional rather than absolute, because not every
     * photograph belongs to a checklist item — a general wagon shot has no
     * finding. What must not happen is a file passing the link online and
     * dropping it offline.
     */
    const offenders: string[] = [];

    for (const f of [...files, join(PAGES, '..', 'components', 'PhotoCaptureModal.tsx')]) {
      let src: string;
      try { src = readFileSync(f, 'utf8'); } catch { continue; }
      if (!/enqueuePhoto\(\{/.test(src)) continue;
      if (!/uploadPhoto\([\s\S]{0,400}?checklistItemId/.test(src)) continue;

      for (const payload of enqueuedPayloads(src, 'enqueuePhoto({')) {
        if (!present(payload, 'checklistItemId')) {
          offenders.push(f.split('/').pop() as string);
        }
      }
    }

    expect(
      offenders,
      'a photo that cannot be tied to its finding is a picture, not evidence'
    ).toEqual([]);
  });

  it('every offline spring inspection carries the reading, the verdict and who took it', () => {
    /*
     * The bogie is the field that was actually lost, but it was lost because
     * nothing checked that the two branches matched. These are the rest of
     * what a spring record has to have for the gate, the nest rule and the
     * audit trail to mean anything: without the height there is no reading,
     * without the status no verdict, and without the inspector no accountable
     * person behind either.
     */
    const required = ['wagonNumber', 'springPosition', 'measuredFreeHeight', 'status', 'inspectorId'];
    const offenders: string[] = [];

    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const payload of enqueuedPayloads(src)) {
        const missing = required.filter((k) => !present(payload, k));
        if (missing.length) offenders.push(`${f.split('/').pop()}: missing ${missing.join(', ')}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});

/**
 * Every capture path caps what it stores
 * Indian Railways WRS Raipur
 *
 * Four screens take a photograph and two of them encoded whatever the camera
 * gave them. A workshop tablet is around twelve megapixels, so those two
 * produced megabytes of base64 per image, into the same SQLite file as the
 * audit chain, at roughly seven hundred springs a shift.
 *
 * The two that were correct were the two somebody had tested on a real phone
 * — exactly how the hard facingMode constraint survived in half the cameras.
 * A shared helper fixes the instances; this fixes the class, so the fifth
 * camera cannot get it wrong.
 */
describe('Photographs are bounded before they are stored', () => {
  const COMPONENTS = join(PAGES, '..', 'components');

  it('no component encodes a frame at the camera resolution', () => {
    const offenders: string[] = [];

    for (const f of readdirSync(COMPONENTS).filter((n) => /\.tsx$/.test(n))) {
      const src = readFileSync(join(COMPONENTS, f), 'utf8');

      if (!/toDataURL\(/.test(src)) continue;
      if (!/getUserMedia|videoWidth/.test(src)) continue;

      /*
       * Only frames that are actually KEPT are in scope.
       *
       * CaliperCamera draws the video to a canvas at full resolution and
       * encodes it as PNG, which looks like the worst offender here and is
       * correct: that frame is handed to OCR and shown as an on-screen
       * preview, and is never uploaded or queued. Downscaling it would cost
       * digit recognition to save bytes nothing ever writes.
       *
       * So the rule is about persistence, not about capture. A component is
       * in scope once its frame reaches an upload, a queue, or a callback
       * that carries it out of the component.
       */
      const persists = /uploadPhoto|enqueuePhoto|onPhotoChange|imageBase64|imageData\s*:|onCapture/.test(src);
      if (!persists) continue;

      /*
       * Either the shared helper, or a local cap with its own explicit
       * maximum — SpringEvidenceCamera targets 640 px deliberately, because
       * the sorting bench runs at a volume nothing else does.
       */
      const capped =
        /fitToStoredSize|MAX_STORED_EDGE/.test(src) ||
        /MAX_EDGE|targetWidth/.test(src);

      if (!capped) offenders.push(f);
    }

    expect(
      offenders,
      'a full-resolution capture is megabytes of base64 in the file that holds the audit chain'
    ).toEqual([]);
  });
});
