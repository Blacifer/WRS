/**
 * Every camera must degrade to whatever the device actually has
 * Indian Railways WRS Raipur
 *
 * `facingMode: 'environment'` is a HARD constraint. On a device with no rear
 * camera — any laptop, which is what the shop's officer reviewed the app on —
 * getUserMedia rejects with OverconstrainedError and the camera never opens.
 * The component falls back to its upload path, so the symptom is not an error
 * message but a missing capability: "I could upload a photograph but not take
 * one."
 *
 * `facingMode: { ideal: 'environment' }` expresses the same preference without
 * the failure: a tablet still gets its rear camera, a laptop gets the one it
 * has.
 *
 * Three of the six camera components had the hard form and three had the soft
 * one, which is how this survived — the components that worked were the ones
 * anybody tested on a phone. This test removes the inconsistency as a source
 * of future bugs rather than relying on whoever writes the seventh camera
 * noticing which pattern to copy.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const COMPONENTS = import.meta.dirname;

describe('Camera components prefer the rear lens without requiring it', () => {
  const files = readdirSync(COMPONENTS)
    .filter((f) => /\.tsx$/.test(f))
    .map((f) => join(COMPONENTS, f));

  it('no component uses facingMode as a hard constraint', () => {
    const offenders: string[] = [];

    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      if (!/getUserMedia/.test(src)) continue;

      /*
       * A bare string value — facingMode: 'environment' or "user" — is the
       * hard form. The soft form is an object: { ideal: 'environment' }.
       */
      if (/facingMode:\s*['"]/.test(src)) {
        offenders.push(f.split('/').pop() as string);
      }
    }

    expect(
      offenders,
      `These components require a camera the device may not have, and will fail ` +
        `outright on a laptop instead of using the available one: ${offenders.join(', ')}. ` +
        `Use facingMode: { ideal: 'environment' }.`
    ).toEqual([]);
  });

  it('every component that opens a camera states a preference at all', () => {
    /*
     * The opposite oversight: omitting facingMode entirely means a tablet
     * opens the selfie camera to photograph a spring, which is a worse
     * first impression than a slightly wrong resolution.
     */
    const missing: string[] = [];

    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      if (!/getUserMedia/.test(src)) continue;
      if (!/facingMode/.test(src)) missing.push(f.split('/').pop() as string);
    }

    expect(
      missing,
      `These open a camera without saying which one, so a tablet may use the ` +
        `front lens: ${missing.join(', ')}`
    ).toEqual([]);
  });
});
