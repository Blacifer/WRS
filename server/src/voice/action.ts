/**
 * Applying a spoken verdict, wherever it arrived from
 * Indian Railways WRS Raipur
 *
 * WHY THIS IS NOT INSIDE THE ROUTE
 * --------------------------------
 * A voice verdict reaches the server two ways: live, through
 * POST /api/checklist/voice-action, and later, out of the offline queue when a
 * tablet comes back into signal. Both must produce the same record — the
 * checklist item updated AND an audit entry carrying the transcript, the
 * language and the recogniser's confidence.
 *
 * They did not. Offline, only the item status was queued, so a condemnation
 * spoken with no network arrived with no transcript behind it. The verdict
 * survived; the evidence for it did not. On a spoken instruction that
 * transcript is the whole provenance — without it nobody can afterwards check
 * that "condemn brake block, visible crack" is what was actually said.
 *
 * Keeping the logic here rather than copying it into the sync route is the
 * point. Two implementations of "what a spoken verdict records" would drift,
 * and the one that drifted would be the offline one, because it is the one
 * nobody watches.
 */

import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { logAuditEvent } from '../db/auditLog.ts';
import type { CASNUBCategory, PartInspectionStatus } from '../../../shared/types.ts';

export interface VoiceActionInput {
  wagonNumber: string;
  itemId?: string | null;
  itemName?: string | null;
  category?: string | null;
  bogiePosition?: string | null;
  status: PartInspectionStatus;
  defectNotes?: string | null;
  repairAction?: string | null;
  repairNotes?: string | null;
  transcript: string;
  language?: string;
  confidence?: number;
  /** When the words were spoken, not when they reached the server. */
  timestamp?: string;
  inspectionId?: string | null;
}

export interface VoiceActionActor {
  inspectorId: string;
  inspectorName: string;
  userRole: string;
}

/**
 * Finds the checklist row a spoken instruction refers to.
 *
 * An id when the caller had one; otherwise the part name, matched loosely
 * because speech recognition does not reproduce punctuation or spacing; and
 * failing that the category, so "condemn the spring" lands somewhere rather
 * than being discarded.
 */
export function resolveVoiceTarget(allItems: any[], input: VoiceActionInput): any | null {
  if (input.itemId) {
    const byId = allItems.find((it: any) => it.id === input.itemId);
    if (byId) return byId;
  }

  if (input.itemName) {
    const wanted = input.itemName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const byName = allItems.find((it: any) => {
      const name = it.partName.toLowerCase().replace(/[^a-z0-9]/g, '');
      return name.includes(wanted) || wanted.includes(name);
    });
    if (byName) return byName;
  }

  if (input.category) {
    return allItems.find((it: any) => it.category === input.category) || null;
  }

  return null;
}

export interface VoiceActionResult {
  /** The checklist row as it now stands. */
  item: any;
  /** The audit entry that carries the transcript, so a caller can cite it. */
  auditLogId: string;
}

/** Applies the verdict and records what was said. */
export function applyVoiceAction(
  db: DatabaseSync,
  repo: any,
  input: VoiceActionInput,
  actor: VoiceActionActor
): VoiceActionResult {
  const wagonNumber = input.wagonNumber.trim().toUpperCase();
  const status = input.status;
  const timestamp = input.timestamp || new Date().toISOString();

  const allItems: any[] = repo.getChecklistItems(wagonNumber)?.allItems || [];
  const target = resolveVoiceTarget(allItems, input);

  let updatedItem: any;

  if (target) {
    /*
     * A repair verdict implies an action even when none was dictated — nobody
     * says "replaced with a new one" out loud every time — but a value already
     * on the row is never overwritten by the implication.
     */
    let effectiveRepairAction = input.repairAction || target.repairAction || null;
    if (status === 'REPAIRED' && !effectiveRepairAction) effectiveRepairAction = 'REPAIRED';
    else if (status === 'REPLACED' && !effectiveRepairAction) effectiveRepairAction = 'REPLACED_NEW';

    updatedItem = repo.updateChecklistItem(target.id, {
      status,
      conditionNotes:
        input.defectNotes !== undefined && input.defectNotes !== null
          ? input.defectNotes
          : target.conditionNotes,
      repairAction: effectiveRepairAction,
      repairNotes:
        input.repairNotes !== undefined && input.repairNotes !== null
          ? input.repairNotes
          : target.repairNotes,
      reinspectedStatus: ['REPAIRED', 'REPLACED'].includes(status) ? 'PASS' : null
    },
    /*
     * Who spoke it.
     *
     * updateChecklistItem defaults its audit attribution to 'usr_system', and
     * the live voice route never passed anything else — so the record of who
     * changed the part said "system" for every verdict anybody dictated. The
     * voice entry beside it named the inspector correctly, which made the two
     * disagree about the same act.
     */
    { userId: actor.inspectorId, userRole: actor.userRole });
  } else {
    const category = (input.category as CASNUBCategory) || 'SPRINGS';
    updatedItem = repo.upsertChecklistItem({
      wagonNumber,
      category,
      partName: input.itemName || `Component (${category})`,
      bogiePosition: input.bogiePosition || 'BOGIE_1',
      status,
      conditionNotes: input.defectNotes || null,
      repairAction: status === 'REPAIRED' ? 'REPAIRED' : status === 'REPLACED' ? 'REPLACED_NEW' : null,
      repairNotes: input.repairNotes || null,
      inspectorId: actor.inspectorId,
      inspectorName: actor.inspectorName
    });
  }

  /*
   * The words themselves, in the append-only log.
   *
   * This is what the offline path was missing. A spoken verdict without its
   * transcript is an assertion nobody can check; with it, an auditor reads
   * what was said, in which language, and how confident the recogniser was
   * that it heard correctly.
   */
  const auditLogId = `audit_voice_${crypto.randomUUID().replace(/-/g, '')}`;

  logAuditEvent(db, {
    id: auditLogId,
    inspectionId: input.inspectionId || null,
    eventType: 'CHECKLIST_ITEM_INSPECTED',
    userId: actor.inspectorId,
    userRole: actor.userRole,
    payload: {
      wagonNumber,
      itemId: updatedItem?.id ?? null,
      itemName: updatedItem?.partName ?? input.itemName ?? null,
      category: updatedItem?.category ?? input.category ?? null,
      status,
      previousStatus: target?.status ?? null,
      defectNotes: input.defectNotes || null,
      repairAction: updatedItem?.repairAction || null,
      transcript: input.transcript,
      language: input.language || 'en-IN',
      confidence: typeof input.confidence === 'number' ? input.confidence : 1.0,
      inputSource: 'VOICE_DICTATION',
      recordedAt: timestamp
    },
    createdAt: timestamp
  });

  return { item: updatedItem, auditLogId };
}
