/**
 * Checklist Configuration & Voice Action API Router
 * Indian Railways WRS Raipur (Phase 2 & Phase 3 Milestone 3)
 */

import crypto from 'node:crypto';
import { Router } from '../framework/index.ts';
import type { Request, Response } from '../framework/index.ts';
import { authMiddleware } from '../middleware/auth.ts';
import type { AuthenticatedRequest } from '../middleware/auth.ts';
import { requireRole } from '../middleware/rbac.ts';
import { getDatabase } from '../db/connection.ts';
import { WagonRepository } from '../db/wagonRepository.ts';
import { logAuditEvent } from '../db/auditLog.ts';
import type {
  VoiceActionRequest,
  VoiceActionResponse,
  PartInspectionStatus,
  CASNUBCategory
} from '../../shared/types.ts';

export const checklistRouter = Router();

function getRepo() {
  const db = getDatabase();
  return new WagonRepository(db);
}

// -------------------------------------------------------------------------
// 1. Get Master Checklist Configuration (by wagonType or all)
// -------------------------------------------------------------------------

/*
 * Reading this system requires an account.
 *
 * These routes were mounted on optionalAuthMiddleware, which takes a token
 * when one is offered and proceeds perfectly happily when none is. The effect
 * was that everything readable here was readable by anyone who could reach
 * the server: the wagon list, every checklist, every spring measurement with
 * the inspector's name against it, the component ledger, the stores, and — the
 * worst of them — /api/inspections/export, which handed over the entire
 * inspection record as a CSV to a caller with no account.
 *
 * That last one also shows why "optional" auth is the wrong shape for a read
 * gate. The export's protections (no inspectors, and a second factor for
 * anyone enrolled) were all written inside `if (req.user)`, so sending no
 * credentials at all skipped every one of them. A check that only runs for
 * people who identified themselves is not a check.
 */

checklistRouter.get('/config', authMiddleware, async (req: Request, res: Response) => {
  const repo = getRepo();
  const wagonType = req.query?.wagonType || req.query?.wagon_type;

  const configs = repo.getChecklistConfig(wagonType);

  res.status(200).json({
    success: true,
    data: configs,
    meta: {
      wagonType: wagonType || 'ALL',
      totalRules: configs.length,
      timestamp: new Date().toISOString()
    }
  });
});

// -------------------------------------------------------------------------
// 2. Set / Update Mandatory Rule for Wagon Type
// -------------------------------------------------------------------------

checklistRouter.post('/config', authMiddleware, requireRole('SUPERVISOR'), async (req: Request, res: Response) => {
  const repo = getRepo();
  const { wagonType, category, partName, bogiePosition, isMandatory, standardReference } = req.body;

  if (!wagonType || !category || !partName) {
    res.status(400).json({
      success: false,
      error: 'MISSING_REQUIRED_FIELDS',
      message: 'wagonType, category, and partName are required fields',
      statusCode: 400,
      timestamp: new Date().toISOString()
    });
    return;
  }

  try {
    repo.setChecklistConfig({
      wagonType,
      category,
      partName,
      bogiePosition: bogiePosition || 'NONE',
      isMandatory: Boolean(isMandatory),
      standardReference: standardReference || null
    });

    res.status(200).json({
      success: true,
      message: `Checklist rule for ${partName} (${wagonType}) updated successfully.`,
      meta: { timestamp: new Date().toISOString() }
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: 'CONFIG_UPDATE_FAILED',
      message: err.message || 'Failed to update checklist config',
      statusCode: 500,
      timestamp: new Date().toISOString()
    });
  }
});

// -------------------------------------------------------------------------
// 3. Record Voice-Dictated Inspection Action (Milestone 3 Hands-Free UI)
// -------------------------------------------------------------------------

/*
 * Authentication required. A voice action writes a PASS or CONDEMNED verdict
 * against a component and an entry into the audit chain.
 *
 * Verified exploitable before this change: an unauthenticated POST created a
 * checklist item with status PASS attributed to usr_insp_001 as "Voice
 * Inspector", and logged CHECKLIST_ITEM_INSPECTED against that real
 * inspector's id and role. The audit chain then protected the fabrication
 * faithfully.
 *
 * Spoken input is the least deliberate way to record a verdict, which makes
 * it the last place that should have accepted an unnamed one.
 */
checklistRouter.post('/voice-action', authMiddleware, async (req: Request, res: Response) => {
  const repo = getRepo();
  const {
    wagonNumber,
    wagonId,
    inspectionId,
    itemId,
    itemName,
    category,
    bogiePosition,
    status,
    defectNotes,
    repairAction,
    repairNotes,
    transcript,
    language = 'en-IN',
    confidence = 1.0,
    timestamp = new Date().toISOString()
  }: VoiceActionRequest = req.body || {};

  // 1. Validations
  if (!wagonNumber || typeof wagonNumber !== 'string' || !wagonNumber.trim()) {
    res.status(400).json({
      success: false,
      error: 'MISSING_WAGON_NUMBER',
      message: 'wagonNumber is required for voice action logging',
      statusCode: 400,
      timestamp: new Date().toISOString()
    });
    return;
  }

  if (!status || typeof status !== 'string') {
    res.status(400).json({
      success: false,
      error: 'MISSING_STATUS',
      message: 'status is required (PASS, CONDEMNED, REPAIRED, REPLACED, FAIL)',
      statusCode: 400,
      timestamp: new Date().toISOString()
    });
    return;
  }

  const validStatuses: PartInspectionStatus[] = ['PASS', 'CONDEMNED', 'REPAIRED', 'REPLACED', 'FAIL'];
  const normalizedStatus = status.trim().toUpperCase() as PartInspectionStatus;
  if (!validStatuses.includes(normalizedStatus)) {
    res.status(400).json({
      success: false,
      error: 'INVALID_STATUS',
      message: `Invalid status "${status}". Allowed values: ${validStatuses.join(', ')}`,
      statusCode: 400,
      timestamp: new Date().toISOString()
    });
    return;
  }

  if (!transcript || typeof transcript !== 'string' || !transcript.trim()) {
    res.status(400).json({
      success: false,
      error: 'MISSING_TRANSCRIPT',
      message: 'transcript string is required to record voice audit log',
      statusCode: 400,
      timestamp: new Date().toISOString()
    });
    return;
  }

  const normalizedWagonNumber = wagonNumber.trim().toUpperCase();
  // From the token only. There is no such person as "Voice Inspector", and a
  // verdict recorded against a name nobody holds is unattributable.
  const inspectorId = (req as AuthenticatedRequest).user!.id;
  const inspectorName =
    (req as AuthenticatedRequest).user?.name ||
    (req as AuthenticatedRequest).user?.username ||
    'Inspector';
  const userRole = (req as AuthenticatedRequest).user?.role || 'INSPECTOR';

  try {
    // 2. Locate or resolve checklist item
    let targetItem: any = null;
    if (itemId) {
      targetItem = repo.getChecklistItemById(itemId);
    }

    if (!targetItem && (itemName || category)) {
      const checklistData = repo.getChecklistItems(normalizedWagonNumber);
      const allItems: any[] = checklistData?.allItems || [];

      if (itemName) {
        const cleanTargetName = itemName.toLowerCase().replace(/[^a-z0-9]/g, '');
        targetItem = allItems.find((it: any) => {
          const cleanName = it.partName.toLowerCase().replace(/[^a-z0-9]/g, '');
          return cleanName.includes(cleanTargetName) || cleanTargetName.includes(cleanName);
        });
      }

      if (!targetItem && category) {
        targetItem = allItems.find((it: any) => it.category === category);
      }
    }

    let updatedItem: any = null;

    if (targetItem) {
      let effectiveRepairAction = repairAction || targetItem.repairAction || null;
      if (normalizedStatus === 'REPAIRED' && !effectiveRepairAction) {
        effectiveRepairAction = 'REPAIRED';
      } else if (normalizedStatus === 'REPLACED' && !effectiveRepairAction) {
        effectiveRepairAction = 'REPLACED_NEW';
      }

      updatedItem = repo.updateChecklistItem(targetItem.id, {
        status: normalizedStatus,
        conditionNotes: defectNotes !== undefined ? defectNotes : targetItem.conditionNotes,
        repairAction: effectiveRepairAction,
        repairNotes: repairNotes !== undefined ? repairNotes : targetItem.repairNotes,
        reinspectedStatus: ['REPAIRED', 'REPLACED'].includes(normalizedStatus) ? 'PASS' : null
      });
    } else {
      const effectiveCategory: CASNUBCategory = (category as CASNUBCategory) || 'SPRINGS';
      const effectivePartName = itemName || `Component (${effectiveCategory})`;

      updatedItem = repo.upsertChecklistItem({
        wagonNumber: normalizedWagonNumber,
        category: effectiveCategory,
        partName: effectivePartName,
        bogiePosition: (bogiePosition as any) || 'BOGIE_1',
        status: normalizedStatus,
        conditionNotes: defectNotes || null,
        repairAction: normalizedStatus === 'REPAIRED' ? 'REPAIRED' : (normalizedStatus === 'REPLACED' ? 'REPLACED_NEW' : null),
        repairNotes: repairNotes || null,
        inspectorId,
        inspectorName
      });
    }

    // 3. Insert into immutable audit log
    const db = getDatabase();
    const auditId = `audit_voice_${crypto.randomUUID().replace(/-/g, '')}`;
    const auditPayload = {
      wagonNumber: normalizedWagonNumber,
      wagonId: wagonId || updatedItem.wagonId || null,
      itemId: updatedItem.id,
      itemName: updatedItem.partName,
      category: updatedItem.category,
      status: normalizedStatus,
      defectNotes: defectNotes || null,
      repairAction: updatedItem.repairAction || null,
      transcript,
      language,
      confidence: typeof confidence === 'number' ? confidence : 1.0,
      inputSource: 'VOICE_DICTATION',
      recordedAt: timestamp
    };

    logAuditEvent(db, {
      id: auditId,
      inspectionId: inspectionId || null,
      eventType: 'CHECKLIST_ITEM_INSPECTED' as any,
      userId: inspectorId,
      userRole,
      payload: auditPayload,
      createdAt: timestamp
    });

    const statusMapEn: Record<PartInspectionStatus, string> = {
      PASS: 'PASS',
      CONDEMNED: 'CONDEMNED',
      REPAIRED: 'REPAIRED',
      REPLACED: 'REPLACED',
      FAIL: 'FAIL'
    };

    const statusMapHi: Record<PartInspectionStatus, string> = {
      PASS: 'पास',
      CONDEMNED: 'कंडम',
      REPAIRED: 'मरम्मत किया',
      REPLACED: 'नया लगाया',
      FAIL: 'दोषपूर्ण'
    };

    const responseData: VoiceActionResponse = {
      success: true,
      message: `Voice action logged for ${updatedItem.partName} as ${statusMapEn[normalizedStatus]}.`,
      messageHi: `${updatedItem.partName} के लिए स्थिति ${statusMapHi[normalizedStatus]} के साथ ध्वनि निरीक्षण दर्ज किया गया।`,
      data: {
        item: updatedItem,
        auditLogId: auditId,
        actionRecorded: {
          wagonNumber: normalizedWagonNumber,
          itemId: updatedItem.id,
          itemName: updatedItem.partName,
          category: updatedItem.category,
          status: normalizedStatus,
          defectNotes: defectNotes || null,
          transcript,
          language,
          confidence: typeof confidence === 'number' ? confidence : 1.0,
          timestamp
        }
      },
      meta: {
        timestamp,
        source: 'VOICE_DICTATION'
      }
    };

    res.status(200).json(responseData);
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: 'VOICE_ACTION_FAILED',
      message: err.message || 'Failed to record voice inspection action',
      statusCode: 500,
      timestamp: new Date().toISOString()
    });
  }
});

// -------------------------------------------------------------------------
// 3. Inspect by exception — clear all remaining PENDING items in one action
//
// The largest single reduction in manual effort in the app. See
// WagonRepository.bulkClearPendingItems for the safety properties that keep
// this an inspection shortcut rather than a rubber stamp.
// -------------------------------------------------------------------------
checklistRouter.post(
  '/bulk-clear',
  authMiddleware,
  requireRole('SUPERVISOR', 'ADMIN'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { wagonNumber, attestation, excludeCategories } = req.body || {};

      if (!wagonNumber) {
        res.status(400).json({
          success: false,
          error: 'MISSING_WAGON_NUMBER',
          message: 'wagonNumber is required',
          statusCode: 400,
          timestamp: new Date().toISOString()
        });
        return;
      }

      const result = getRepo().bulkClearPendingItems(wagonNumber, {
        attestation: String(attestation || ''),
        userId: req.user!.id,
        userRole: req.user?.role,
        excludeCategories: Array.isArray(excludeCategories) ? excludeCategories : undefined
      });

      res.status(200).json({
        success: true,
        data: result,
        message:
          `${result.clearedCount} item(s) cleared by exception. ` +
          `${result.skippedCategories.join(', ')} excluded — those require individual verdicts.`,
        meta: { timestamp: new Date().toISOString() }
      });
    } catch (err: any) {
      const status = err?.name === 'ValidationError' ? 400 : 500;
      res.status(status).json({
        success: false,
        error: err?.name === 'ValidationError' ? 'VALIDATION_ERROR' : 'BULK_CLEAR_FAILED',
        message: err?.message || 'Could not clear items',
        statusCode: status,
        timestamp: new Date().toISOString()
      });
    }
  }
);

// -------------------------------------------------------------------------
// 4. Suggested statuses from this part's own inspection history
//
// Advisory prompts derived from data the workshop already produced. Works
// offline, costs nothing to run, and decides nothing on its own.
// -------------------------------------------------------------------------
checklistRouter.get(
  '/suggestions/:wagonNumber',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const wagonNumber = req.params?.wagonNumber;
      if (!wagonNumber) {
        res.status(400).json({
          success: false,
          error: 'MISSING_WAGON_NUMBER',
          message: 'wagonNumber is required',
          statusCode: 400,
          timestamp: new Date().toISOString()
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: getRepo().suggestChecklistStatuses(wagonNumber),
        meta: { timestamp: new Date().toISOString() }
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: 'SUGGESTIONS_FAILED',
        message: err?.message || 'Could not compute suggestions',
        statusCode: 500,
        timestamp: new Date().toISOString()
      });
    }
  }
);
