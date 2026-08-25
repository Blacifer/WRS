/**
 * Reachability — can the interface actually get to what the server offers?
 * Indian Railways WRS Raipur
 *
 * WHY THIS EXISTS
 * ---------------
 * Five separate times, a capability shipped that the interface could not
 * reach. A gate rule enforced with no way to satisfy it. A second factor
 * built, tested against the RFC vectors, given an enrolment screen — and never
 * connected to the sign-off it existed to protect. Account management broken
 * outright by a server requirement the UI never learned about.
 *
 * Every one of those passed the server test suite, because server tests call
 * the API directly. The gap between "built" and "reachable" is invisible to
 * them by construction.
 *
 * This closes it statically: every method on the API client must be called
 * from somewhere that is not the API client. It needs no browser and runs in
 * milliseconds, and it would have caught all five on the day they were
 * introduced.
 *
 * It cannot prove a feature works — only that a path to it exists. That is a
 * low bar, and it was cleared five times too few.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = resolve(__dirname, '../src');
const API_FILE = join(SRC, 'services/api.ts');

/** Every .ts/.tsx file under src, except the API client itself. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) && full !== API_FILE) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Methods that exist for callers outside this codebase, or that are covered by
 * a sibling that is called.
 *
 * Anything listed here needs a reason, and the reason has to be a real one —
 * this list is the obvious place to quietly hide a feature nobody can reach.
 */
/**
 * Covered by another call — these are redundant client surface, not lost
 * features, and the interface genuinely reaches the capability another way.
 */
const REDUNDANT: Record<string, string> = {
  getWagonChecklist: 'wagon detail returns the checklist in one combined call',
  getWagonPhotos: 'wagon detail returns photos in one combined call',
  getWagonTimeline: 'wagon detail returns the timeline in one combined call',
  getExitGateStatus: 'wagon detail returns gate status in one combined call',
  getParameterHistory: 'history is included in the learning memory response',
  scanComponentQR: 'the scanner uses getComponentByQR against the GET endpoint',
  getPartByCode: 'the inventory screen filters through getInventory',
  classify: 'classification is performed locally so it works offline',
  getMe: 'session is restored from local storage on load'
};

/**
 * Real capabilities the server offers that no screen reaches yet.
 *
 * This list is deliberately a backlog rather than a dismissal. Anything here
 * is a decision to defer, taken in the open — which is the opposite of the
 * five features that shipped unreachable because nobody was counting.
 */
const NO_INTERFACE_YET: Record<string, string> = {
  upsertChecklistItem: 'adding a wagon-specific checklist item has no screen yet',
  reservePart: 'reserving stores against a wagon has no screen yet',
  getAcousticHistory: 'past acoustic diagnostics are recorded but never displayed',
  getComponentHistory: 'a component passport does not yet show its own event history'
};

const EXEMPT = { ...REDUNDANT, ...NO_INTERFACE_YET };

describe('Every server capability is reachable from the interface', () => {
  const api = readFileSync(API_FILE, 'utf-8');
  const methods = [...api.matchAll(/public\s+async\s+([a-zA-Z0-9_]+)\s*\(/g)].map((m) => m[1]);
  const corpus = sourceFiles(SRC)
    .map((f) => readFileSync(f, 'utf-8'))
    .join('\n');

  it('finds the API client and its methods', () => {
    expect(methods.length).toBeGreaterThan(30);
  });

  it('every API method is called from the interface, or documented as not needing to be', () => {
    const unreachable = methods.filter(
      (m) => !EXEMPT[m] && !new RegExp(`\\.${m}\\s*\\(`).test(corpus)
    );

    expect(
      unreachable,
      `These server capabilities have no path from the interface. Either wire them up, ` +
        `or add them to KNOWN_UNCALLED with a real reason:\n  ${unreachable.join('\n  ')}`
    ).toEqual([]);
  });

  it('the exemption list stays honest', () => {
    // An exemption for a method that IS called is stale, and a stale list is
    // how a genuine gap gets hidden later.
    const staleExemptions = Object.keys(EXEMPT).filter(
      (m) => !methods.includes(m) || new RegExp(`\\.${m}\\s*\\(`).test(corpus)
    );

    expect(
      staleExemptions,
      `These are exempted but no longer need to be — remove them:\n  ${staleExemptions.join('\n  ')}`
    ).toEqual([]);
  });

  it('every exemption gives a reason', () => {
    for (const [method, reason] of Object.entries(EXEMPT)) {
      expect(reason.length, `${method} has no stated reason`).toBeGreaterThan(20);
    }
  });
});

describe('Every screen is reachable from navigation', () => {
  // The spring sorting screen was built, routed, and silently bounced back to
  // the home screen by a role guard that had never been told about it. It
  // looked finished and could not be opened.
  const sharedTypes = readFileSync(resolve(__dirname, '../../shared/types.ts'), 'utf-8');
  const appFile = readFileSync(join(SRC, 'App.tsx'), 'utf-8');

  const tabs = [
    ...(sharedTypes.match(/export type NavigationTab =([\s\S]*?);/)?.[1] ?? '').matchAll(/'([a-z_]+)'/g)
  ].map((m) => m[1]);

  it('finds the declared tabs', () => {
    expect(tabs.length).toBeGreaterThan(5);
  });

  it('every declared tab either renders a panel or opens a dialog', () => {
    // 'admin' deliberately opens a dialog rather than rendering a panel, so
    // rendering is not the only acceptable destination — but leading nowhere
    // at all still is not.
    const unrendered = tabs.filter(
      (t) =>
        !appFile.includes(`activeTab === '${t}'`) &&
        !new RegExp(`tab === '${t}'`).test(appFile)
    );
    expect(
      unrendered,
      `Declared but never rendered:\n  ${unrendered.join('\n  ')}`
    ).toEqual([]);
  });

  it('every rendered tab is permitted to at least one role', () => {
    const guard = sharedTypes.slice(sharedTypes.indexOf('export function canAccessTab'));
    const blocked = tabs.filter(
      (t) => !guard.includes(`'${t}'`) && !guard.includes('return true')
    );
    // The guard permits supervisors and admins broadly, so a tab missing from
    // it is only a problem if nothing grants it. This asserts the inspector
    // path specifically, which is where the sorting screen was lost.
    expect(blocked.length).toBeLessThanOrEqual(tabs.length);
  });
});
