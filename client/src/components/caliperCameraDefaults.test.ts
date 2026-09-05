/**
 * The caliper camera must stay opt-in
 * Indian Railways WRS Raipur
 *
 * WRS Raipur measures everything by hand. Confirmed by the shop's own officer:
 * there is no instrument on this floor with a display of any kind. The only
 * machine-assisted test is air pressure — the Single Wagon Test — which does
 * not involve this component.
 *
 * The OCR path reads digits off a measuring instrument's DIGITAL DISPLAY. With
 * no display to read, offering the camera is worse than useless: it costs a
 * tap and a permission prompt on every spring, and it invites the reasonable
 * but wrong conclusion that photographing a spring can identify or measure it.
 *
 * This was not a hypothetical. The default was once `hideCamera = false`, so
 * every call site had to remember to opt out, and one of the three forgot — a
 * supervisor was asked to "align caliper LCD here" while holding a go/no-go
 * gauge with nothing on it to align. The shop's officer found that, not a
 * test. Hence this test.
 *
 * It reads the source rather than rendering the component, because what is
 * being protected is the DEFAULT — the behaviour a future call site inherits
 * by saying nothing at all.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const COMPONENT = join(import.meta.dirname, 'CaliperCamera.tsx');
const CLIENT_SRC = join(import.meta.dirname, '..');

describe('CaliperCamera — the camera is opt-in', () => {
  it('defaults to hiding the camera', () => {
    const src = readFileSync(COMPONENT, 'utf8');
    expect(src).toMatch(/hideCamera\s*=\s*true/);
  });

  it('defaults to manual entry', () => {
    const src = readFileSync(COMPONENT, 'utf8');
    expect(src).toMatch(/defaultMode\s*=\s*'manual'/);
  });

  it('no call site turns the camera back on without saying why', () => {
    /*
     * A shop that owns a digital caliper is entitled to pass
     * hideCamera={false} — but it has to be a deliberate, commented decision
     * at that call site, not something inherited. Any such opt-in should be
     * accompanied by a note explaining which instrument has a display.
     */
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) files.push(full);
      }
    };
    walk(CLIENT_SRC);

    const optIns: string[] = [];
    for (const f of files) {
      // Skip the component itself and every test — this file names the
      // patterns it forbids, and would otherwise report itself.
      if (f.endsWith('CaliperCamera.tsx')) continue;
      if (/\.test\.tsx?$/.test(f)) continue;
      const src = readFileSync(f, 'utf8');
      if (/hideCamera=\{false\}/.test(src) || /defaultMode="camera"/.test(src)) {
        optIns.push(f.replace(CLIENT_SRC, ''));
      }
    }

    expect(
      optIns,
      `These call sites re-enable the caliper camera. At WRS Raipur no instrument ` +
        `has a display, so each needs a comment naming the instrument that does: ` +
        `${optIns.join(', ')}`
    ).toEqual([]);
  });
});
