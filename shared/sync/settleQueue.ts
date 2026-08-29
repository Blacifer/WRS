/**
 * What to do with a queue after the server has answered
 * Indian Railways WRS Raipur
 *
 * WHY THIS IS NOT INSIDE offlineDb
 * --------------------------------
 * It was, and it lost work in two different ways, neither of which any test
 * could reach — the decision lived inline in a method that needs IndexedDB and
 * a network to run at all.
 *
 * The first was a race. The device read the queue, sent it, and then CLEARED
 * the store. An inspector keeps working while a sync runs — that is the whole
 * point of a background sync — and anything queued between the read and the
 * clear was destroyed without ever having been sent.
 *
 * The second was worse, because it was silent and it hit the safety records.
 * The server answers 200 even when it has refused individual items, and it
 * says which and why. The most important refusal it makes is a queued PASS
 * arriving over another inspector's CONDEMNED: the condemnation stands, so a
 * crack cannot be erased by a stale offline verdict. The device deleted that
 * item anyway. The queue emptied, nothing was said, and an inspector's
 * judgement was thrown away while they believed it had been saved.
 *
 * THE THREE OUTCOMES
 * ------------------
 * They are genuinely different and collapsing them is what caused the harm:
 *
 *   accepted    the server has it. Remove it.
 *   conflicted  the server refused it, deliberately, and explained why.
 *               Remove it — sending it again would only be refused again —
 *               but REPORT it, because a person has to be told.
 *   errored     something went wrong. Keep it and try again. A queue that
 *               stays visibly non-empty is a far better failure than one that
 *               empties by deleting the work.
 */

export interface SubmittedItem {
  clientTempId: string;
}

export interface ServerOutcome {
  clientTempId?: string;
  reason?: string;
  error?: string;
  entity?: string;
  wagonNumber?: string;
  partName?: string;
  attempted?: string;
  kept?: string;
}

export interface QueueSettlement {
  /** Keys to delete. Never anything that was not submitted. */
  remove: string[];
  /** Keys to leave queued for another attempt. */
  keep: string[];
  /** Refusals to show the inspector, in the server's own words. */
  report: ServerOutcome[];
}

/**
 * Decides the fate of every submitted item.
 *
 * `submitted` is the exact batch that was sent. Nothing outside it is ever
 * returned for removal, which is what makes the race impossible: an item
 * queued while the request was in flight is not in this list, so it cannot be
 * deleted by the settlement of a batch it was never part of.
 */
export function decideQueueSettlement(
  submitted: SubmittedItem[],
  response: { errors?: ServerOutcome[]; conflicts?: ServerOutcome[] } | null | undefined
): QueueSettlement {
  const errors = response?.errors || [];
  const conflicts = response?.conflicts || [];

  const erroredIds = new Set(errors.map((e) => e?.clientTempId).filter(Boolean) as string[]);

  const remove: string[] = [];
  const keep: string[] = [];

  for (const item of submitted) {
    if (!item?.clientTempId) continue;
    if (erroredIds.has(item.clientTempId)) keep.push(item.clientTempId);
    else remove.push(item.clientTempId);
  }

  /*
   * Conflicts are reported whether or not their id came back matched. An
   * unattributable refusal is still a refusal, and showing it without knowing
   * which row it belonged to is far better than showing nothing — the server
   * writes the wagon number and part name into the reason for exactly that
   * case.
   */
  return { remove, keep, report: conflicts };
}

/**
 * Whether an error is worth another attempt, or will fail identically forever.
 *
 * Kept separate and deliberately narrow: only errors that plainly cannot
 * improve are given up on. Everything else is retried, because the cost of
 * retrying is a queue badge that stays lit and the cost of giving up is
 * somebody's inspection.
 */
export function isPermanentFailure(error: string | undefined): boolean {
  if (!error) return false;
  const e = error.toLowerCase();
  return (
    e.includes('validation') ||
    e.includes('not a registered user') ||
    e.includes('deactivated')
  );
}
