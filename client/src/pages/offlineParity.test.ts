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
function enqueuedPayloads(src: string): string[] {
  const payloads: string[] = [];
  const marker = 'enqueueInspection({';
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
