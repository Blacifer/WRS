/**
 * The exit gate panel
 * Indian Railways WRS Raipur
 *
 * This is what a supervisor reads before deciding whether a wagon leaves. The
 * asymmetry runs one way: a panel that wrongly says BLOCKED costs a phone
 * call, and a panel that wrongly says CLEARED is how an unsafe wagon goes
 * out of the gate. So most of these tests are about the second kind.
 */

import { describe, it, expect } from 'vitest';
import { readGatePanel } from './gatePanel.ts';

const cleared = {
  canRelease: true,
  blockers: [],
  summary: {
    passedMandatory: 52,
    totalMandatory: 52,
    unaddressedCondemned: 0,
    springCheck: { hasCondemnedSprings: false }
  }
};

describe('Never reading as cleared when it is not', () => {
  it('only the server’s own verdict clears a wagon', () => {
    expect(readGatePanel(cleared, { currentStage: 'FINAL_QC_GATE' }).canRelease).toBe(true);
    expect(readGatePanel({ ...cleared, canRelease: false }, { currentStage: 'FINAL_QC_GATE' }).canRelease).toBe(false);
  });

  it('treats a missing or malformed status as blocked, never as clear', () => {
    // A failed fetch, a truncated response, an older server. None of these
    // are a release.
    for (const bad of [null, undefined, {}, { canRelease: 'yes' }, { canRelease: 1 }, { summary: {} }]) {
      const r = readGatePanel(bad, { currentStage: 'FINAL_QC_GATE' });
      expect(r.canRelease, JSON.stringify(bad)).toBe(false);
      expect(r.headline).toBe('RELEASE BLOCKED');
      expect(r.offerSignoff).toBe(false);
    }
  });

  it('does not read an empty checklist as all-passed', () => {
    // 0 of 0 is arithmetically "all passed" and is the single most dangerous
    // reading available: it means the template never loaded.
    const r = readGatePanel(
      { canRelease: false, summary: { passedMandatory: 0, totalMandatory: 0 } },
      { currentStage: 'FINAL_QC_GATE' }
    );
    expect(r.tiers.find((t) => t.rule === 1)!.satisfied).toBe(false);
  });

  it('does not offer sign-off on a wagon that was already released', () => {
    // A second signature on the same wagon is a record nobody can explain.
    const r = readGatePanel(cleared, { currentStage: 'RELEASE' }, { isReleased: true });
    expect(r.canRelease).toBe(true);
    expect(r.offerSignoff).toBe(false);
  });
});

describe('The four tier readings', () => {
  it('marks the mandatory-items tier satisfied only when all have passed', () => {
    const partial = readGatePanel(
      { canRelease: false, summary: { passedMandatory: 51, totalMandatory: 52 } },
      { currentStage: 'FINAL_QC_GATE' }
    );
    expect(partial.tiers[0].value).toBe('51 / 52 Passed');
    expect(partial.tiers[0].satisfied).toBe(false);

    const full = readGatePanel(cleared, { currentStage: 'FINAL_QC_GATE' });
    expect(full.tiers[0].satisfied).toBe(true);
  });

  it('flags unresolved condemned components', () => {
    const r = readGatePanel(
      { canRelease: false, summary: { unaddressedCondemned: 3 } },
      { currentStage: 'FINAL_QC_GATE' }
    );
    expect(r.tiers[1].value).toBe('3 Unresolved');
    expect(r.tiers[1].satisfied).toBe(false);
  });

  it('flags condemned springs', () => {
    const r = readGatePanel(
      { canRelease: false, summary: { springCheck: { hasCondemnedSprings: true } } },
      { currentStage: 'FINAL_QC_GATE' }
    );
    expect(r.tiers[2].satisfied).toBe(false);
    expect(r.tiers[2].value).toContain('CONDEMNED');
  });

  it('counts both gate stages as reached, and nothing else', () => {
    // The stage is named RELEASE, not RELEASED. Getting this wrong would show
    // "STAGE RELEASE" on a released wagon instead of a tick — harmless, but
    // it is exactly the sort of near-miss string worth pinning.
    expect(readGatePanel(cleared, { currentStage: 'FINAL_QC_GATE' }).tiers[3].satisfied).toBe(true);
    expect(readGatePanel(cleared, { currentStage: 'RELEASE' }).tiers[3].satisfied).toBe(true);

    for (const stage of ['ENTRY_REGISTRATION', 'DISMANTLING', 'REASSEMBLY', 'RELEASED']) {
      const r = readGatePanel(cleared, { currentStage: stage });
      expect(r.tiers[3].satisfied, stage).toBe(false);
      expect(r.tiers[3].value).toContain(stage);
    }
  });

  it('says UNKNOWN rather than "undefined" when the stage is missing', () => {
    const r = readGatePanel(cleared, null);
    expect(r.tiers[3].value).toBe('STAGE UNKNOWN');
    expect(r.tiers[3].satisfied).toBe(false);
  });
});

describe('Blockers and advisories', () => {
  it('counts blockers, and copes with the field being absent', () => {
    expect(readGatePanel({ canRelease: false, blockers: ['a', 'b'] }, null).blockerCount).toBe(2);
    expect(readGatePanel({ canRelease: false }, null).blockerCount).toBe(0);
    expect(readGatePanel({ canRelease: false, blockers: 'not an array' }, null).blockerCount).toBe(0);
  });

  it('counts only the advisories not yet acknowledged', () => {
    const status = {
      ...cleared,
      advisoryDetails: [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }]
    };
    expect(readGatePanel(status, { currentStage: 'RELEASE' }).unacknowledgedAdvisories).toBe(3);
    expect(
      readGatePanel(status, { currentStage: 'RELEASE' }, { acknowledgedAdvisoryIds: ['a1', 'a3'] })
        .unacknowledgedAdvisories
    ).toBe(1);
    expect(
      readGatePanel(status, { currentStage: 'RELEASE' }, { acknowledgedAdvisoryIds: ['a1', 'a2', 'a3'] })
        .unacknowledgedAdvisories
    ).toBe(0);
  });
});
