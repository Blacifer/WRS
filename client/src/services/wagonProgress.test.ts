/**
 * Wagon progress readings
 * Indian Railways WRS Raipur
 */

import { describe, it, expect } from 'vitest';
import { readWagonProgress, canBulkClear, STAGE_ORDER } from './wagonProgress.ts';

describe('Where the wagon has got to', () => {
  it('places each stage in order', () => {
    expect(readWagonProgress({ currentStage: 'ENTRY_REGISTRATION' }).currentStageIndex).toBe(0);
    expect(readWagonProgress({ currentStage: 'FINAL_QC_GATE' }).currentStageIndex).toBe(5);
    expect(readWagonProgress({ currentStage: 'RELEASE' }).currentStageIndex).toBe(6);
  });

  it('knows the release stage is RELEASE, not RELEASED', () => {
    // Both read naturally; only one is the value the database holds. The wrong
    // one shows a released wagon as still in progress, with no error anywhere.
    expect(readWagonProgress({ currentStage: 'RELEASE' }).isReleased).toBe(true);
    expect(readWagonProgress({ currentStage: 'RELEASED' }).isReleased).toBe(false);
    expect(readWagonProgress({ currentStage: 'RELEASED' }).currentStageIndex).toBe(-1);
  });

  it('marks past, current and future stages consistently', () => {
    const p = readWagonProgress({ currentStage: 'REASSEMBLY' });
    const past = p.steps.filter((s) => s.isPast).length;
    const current = p.steps.filter((s) => s.isCurrent).length;
    const future = p.steps.filter((s) => s.isFuture).length;

    expect(current).toBe(1);
    expect(past + current + future).toBe(STAGE_ORDER.length);
    // No stage may be two things at once.
    for (const s of p.steps) {
      expect([s.isPast, s.isCurrent, s.isFuture].filter(Boolean)).toHaveLength(1);
    }
  });

  it('treats an unknown stage as not started rather than as stage one', () => {
    // Clamping -1 to 0 would assert the wagon is at entry registration, which
    // is a claim. Showing everything as future says only that we do not know.
    const p = readWagonProgress({ currentStage: 'SOMETHING_ELSE' });
    expect(p.currentStageIndex).toBe(-1);
    expect(p.completedStages).toBe(0);
    expect(p.steps.every((s) => s.isFuture)).toBe(true);
    expect(p.steps.some((s) => s.isCurrent)).toBe(false);
  });

  it('copes with no wagon at all', () => {
    for (const w of [null, undefined, {}]) {
      const p = readWagonProgress(w as any);
      expect(p.isReleased).toBe(false);
      expect(p.isAtQcGate).toBe(false);
      expect(p.steps).toHaveLength(STAGE_ORDER.length);
    }
  });
});

describe('Counting what is left', () => {
  it('counts an item with no status at all as pending', () => {
    // Absent is not passed. A checklist row that never got a status is
    // outstanding work, and reading it as anything else hides it.
    const checklist = [
      { status: 'PASS' },
      { status: 'PENDING' },
      { status: null },
      {},
      { status: 'CONDEMNED' }
    ];
    expect(readWagonProgress({ currentStage: 'REASSEMBLY' }, checklist).pendingCount).toBe(3);
  });

  it('counts nothing when the checklist is empty', () => {
    expect(readWagonProgress({ currentStage: 'REASSEMBLY' }, []).pendingCount).toBe(0);
    expect(readWagonProgress({ currentStage: 'REASSEMBLY' }).pendingCount).toBe(0);
  });
});

describe('Offering the bulk clear', () => {
  it('refuses a short attestation, and explains what it is for', () => {
    const r = canBulkClear('ok', 5);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/ten characters/i);
    // The reason should say the attestation is recorded in their name — that
    // is the point of asking for it.
    expect(r.reason).toMatch(/in your name/i);
  });

  it('refuses when there is nothing pending', () => {
    const r = canBulkClear('Physically verified all remaining items on the underframe', 0);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/no pending items/i);
  });

  it('allows a real attestation when work remains', () => {
    const r = canBulkClear('Physically verified all remaining items on the underframe', 7);
    expect(r.allowed).toBe(true);
    expect(r.reason).toBeUndefined();
  });

  it('does not count surrounding whitespace toward the minimum', () => {
    expect(canBulkClear('          ', 5).allowed).toBe(false);
    expect(canBulkClear('  short  ', 5).allowed).toBe(false);
  });
});
