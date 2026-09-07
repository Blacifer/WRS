/**
 * Every API client method is called by something
 * Indian Railways WRS Raipur
 *
 * WHY THIS EXISTS
 * ---------------
 * routeReachability.test.ts guards one half of the gap: a server route with no
 * path from the client. It cannot see the other half. A route reached by an
 * API client method counts as reachable there — even when nothing in the
 * application ever calls that method.
 *
 * That is not a hypothetical. Voice entry was built end to end and joined in
 * the middle by nobody: the server could read an unparsed sentence, the client
 * had a method to send one, and no screen ever did. It looked wired from both
 * directions and worked from neither.
 *
 * So this asserts the second half. A method nobody calls is either a feature
 * with no way in, or dead weight that suggests a capability the app does not
 * have. Both are worth knowing about; neither is worth discovering during a
 * demonstration.
 *
 * An entry in UNCALLED is not a failure — several of these are genuinely
 * redundant, because the data arrives in a combined response. What is refused
 * is an UNDOCUMENTED one.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');
const API_FILE = join(SRC, 'services', 'api.ts');

/**
 * Methods with no caller, each with the reason it is acceptable.
 *
 * "Redundant" means the same data already arrives another way, so the method
 * is spare rather than missing. "Not surfaced" means the capability exists on
 * the server and no screen offers it — a real gap, recorded here rather than
 * forgotten.
 */
const UNCALLED: Record<string, string> = {
  // The combined wagon-detail response already returns these three, and the
  // page reads them from it. Calling them separately would be a second
  // round trip for data already in hand.
  getWagonChecklist: 'redundant — the wagon detail response carries checklistSummary',
  getWagonPhotos: 'redundant — the wagon detail response carries photos',
  getWagonTimeline: 'redundant — the wagon detail response carries timeline',

  // The scanner resolves a code through getComponentByQR, then falls back to
  // serial and search. This one duplicates the first of those.
  scanComponentQR: 'redundant — PassportQRScannerModal uses getComponentByQR',
  getComponentHistory: 'redundant — component lookups request history inline',

  // The gate shown on the wagon page is computed by services/gatePanel.ts from
  // data already loaded. The server keeps its own authoritative gate and
  // enforces it on release; this endpoint is for reading it directly.
  getExitGateStatus: 'redundant — the panel is computed client-side by gatePanel.ts',

  // The signed-in user comes from the login response and is held in the api
  // service, so nothing needs to ask again.
  getMe: 'redundant — the user is returned by login and cached',

  // NOT SURFACED. Each of these is a server capability with no way in from any
  // screen. Listed so the absence is deliberate and visible rather than
  // discovered.
  getAcousticHistory:
    'not surfaced — SoundDiagnosticTool records readings but shows no history of them',
  getParameterHistory:
    'not surfaced — effective values are shown, how they changed over time is not',
  getPartByCode: 'not surfaced — stores lookup by code has no screen',
  reservePart: 'not surfaced — reserving stock against a wagon has no screen',
  classify: 'not surfaced — sorting classifies through the batch and single-spring paths',
  upsertChecklistItem:
    'not surfaced — the shop edits its checklist through ChecklistConfigPage, which uses upsertChecklistConfig'
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry) && full !== API_FILE) out.push(full);
  }
  return out;
}

describe('Every API client method is called by something', () => {
  it('a method with no caller is either wired up or documented as uncalled', () => {
    const api = readFileSync(API_FILE, 'utf-8');
    const methods = [...api.matchAll(/public async ([a-zA-Z0-9_]+)\(/g)].map((m) => m[1]);
    expect(methods.length).toBeGreaterThan(50);

    /*
     * Whitespace is stripped before searching. Calls are routinely written
     * with the dot on the following line — `api\n  .getManualStatus()` — and a
     * line-based search reports those as uncalled, which is how a first pass
     * at this produced two false accusations.
     */
    const all = walk(SRC).map((f) => readFileSync(f, 'utf-8')).join('\n');
    const flat = all.replace(/\s+/g, '');

    const uncalled = methods.filter((m) => !flat.includes(`.${m}(`));
    const undocumented = uncalled.filter((m) => !(m in UNCALLED));

    expect(
      undocumented,
      'These API client methods are called by nothing in the app. Either wire them ' +
        'to a screen, or add them to UNCALLED with the reason they are spare:'
    ).toEqual([]);
  });

  it('the documented list does not outlive what it documents', () => {
    // An exemption for a method that is now called, or no longer exists, is a
    // comment that has stopped being true — and this file is only useful for
    // as long as every line in it is.
    const api = readFileSync(API_FILE, 'utf-8');
    const methods = new Set(
      [...api.matchAll(/public async ([a-zA-Z0-9_]+)\(/g)].map((m) => m[1])
    );
    const all = walk(SRC).map((f) => readFileSync(f, 'utf-8')).join('\n');
    const flat = all.replace(/\s+/g, '');

    const stale = Object.keys(UNCALLED).filter(
      (m) => !methods.has(m) || flat.includes(`.${m}(`)
    );

    expect(stale, 'These entries in UNCALLED are no longer true — remove them:').toEqual([]);
  });
});
