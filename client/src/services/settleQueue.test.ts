/**
 * Settling the offline queue
 * Indian Railways WRS Raipur
 *
 * These exist because the sync used to clear each store outright on any 200
 * response, which lost work two ways: it destroyed anything queued while the
 * request was in flight, and it deleted items the server had explicitly
 * REFUSED — including a stale offline PASS refused over another inspector's
 * CONDEMNED, which is the one refusal in this system that must never pass
 * unnoticed.
 *
 * The tests below are about what survives, not about what syncs.
 */

import { describe, it, expect } from 'vitest';
import {
  decideQueueSettlement,
  isPermanentFailure
} from '../../../shared/sync/settleQueue.ts';

const item = (id: string) => ({ clientTempId: id });

describe('The race that emptied the queue', () => {
  it('never removes anything that was not submitted', () => {
    /*
     * The actual bug. An inspector keeps tapping while a sync runs; the old
     * code cleared the whole store afterwards, so those taps vanished having
     * never been sent. Deletion is by submitted key, so an item enqueued
     * mid-flight cannot be touched by a batch it was not part of.
     */
    const submitted = [item('a'), item('b')];
    const { remove } = decideQueueSettlement(submitted, { errors: [], conflicts: [] });

    expect(remove).toEqual(['a', 'b']);
    expect(remove).not.toContain('c-queued-during-the-request');
  });

  it('removes an accepted batch completely', () => {
    const submitted = ['a', 'b', 'c'].map(item);
    const { remove, keep } = decideQueueSettlement(submitted, {});
    expect(remove).toHaveLength(3);
    expect(keep).toHaveLength(0);
  });
});

describe('Work the server refused', () => {
  it('reports a refused condemnation rather than swallowing it', () => {
    // The case that matters most: a queued PASS arriving over someone else's
    // CONDEMNED. The server refuses it by design. The device used to delete
    // it and say nothing, so the inspector believed it had been recorded.
    const submitted = [item('chk-1')];
    const response = {
      conflicts: [{
        clientTempId: 'chk-1',
        entity: 'CHECKLIST',
        wagonNumber: '22071901239',
        partName: 'Brake Beam',
        attempted: 'PASS',
        kept: 'CONDEMNED',
        reason: '"Brake Beam" was condemned by another inspector after this was recorded.'
      }]
    };

    const { remove, report } = decideQueueSettlement(submitted, response);

    expect(report).toHaveLength(1);
    expect(report[0].reason).toMatch(/condemned/i);
    expect(report[0].wagonNumber).toBe('22071901239');
    // Removed, because re-sending would only be refused again — but only
    // because it is also being reported.
    expect(remove).toContain('chk-1');
  });

  it('reports a conflict even when it cannot be matched to a row', () => {
    // An unattributable refusal is still a refusal. The server writes the
    // wagon and part into the reason for exactly this case.
    const { report } = decideQueueSettlement([item('x')], {
      conflicts: [{ reason: 'Something was not applied.' }]
    });
    expect(report).toHaveLength(1);
  });
});

describe('Work that merely failed', () => {
  it('keeps an errored item queued instead of deleting it', () => {
    const submitted = [item('a'), item('b'), item('c')];
    const response = { errors: [{ clientTempId: 'b', error: 'Database is locked' }] };

    const { remove, keep } = decideQueueSettlement(submitted, response);

    expect(keep, 'a failure must not delete the work').toEqual(['b']);
    expect(remove).toEqual(['a', 'c']);
  });

  it('keeps failures across repeated attempts rather than giving up', () => {
    // A queue that stays visibly non-empty is a better failure than one that
    // empties by throwing the work away.
    let queue = [item('a'), item('b')];
    for (let attempt = 0; attempt < 5; attempt++) {
      const { keep } = decideQueueSettlement(queue, {
        errors: [{ clientTempId: 'a', error: 'Network error' }]
      });
      queue = keep.map(item);
    }
    expect(queue).toEqual([item('a')]);
  });

  it('survives a response with nothing in it', () => {
    // A server that answers 200 and says nothing else means everything landed.
    for (const response of [null, undefined, {}, { errors: [], conflicts: [] }]) {
      const { remove, keep } = decideQueueSettlement([item('a')], response as any);
      expect(remove).toEqual(['a']);
      expect(keep).toEqual([]);
    }
  });

  it('ignores an item with no id rather than deleting by accident', () => {
    const { remove } = decideQueueSettlement(
      [{ clientTempId: '' } as any, item('real')],
      {}
    );
    expect(remove).toEqual(['real']);
  });
});

describe('Telling a permanent failure from a transient one', () => {
  it('knows what will never succeed', () => {
    expect(isPermanentFailure('VALIDATION_ERROR: partName is required')).toBe(true);
    expect(isPermanentFailure('Inspector usr_x is not a registered user.')).toBe(true);
    expect(isPermanentFailure('Inspector usr_x is deactivated and cannot record sorting.')).toBe(true);
  });

  it('treats anything it does not recognise as worth retrying', () => {
    // Erring towards retry: the cost is a badge that stays lit, and the cost
    // of the other mistake is somebody's inspection.
    expect(isPermanentFailure('Database is locked')).toBe(false);
    expect(isPermanentFailure('Network error')).toBe(false);
    expect(isPermanentFailure(undefined)).toBe(false);
  });
});
