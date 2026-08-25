/**
 * Wagon Detail, 7-Stage Progression, CASNUB Checklist & Exit Gate Page
 * Indian Railways WRS Raipur (Phase 2 - R1, R2, R3, R5)
 */

import React, { useEffect, useState } from 'react';
import { api } from '../services/api.ts';
import { offlineDb } from '../services/offlineDb.ts';
import { useI18n } from '../i18n/index.ts';
import { PhotoCaptureModal } from '../components/PhotoCaptureModal.tsx';
import { PhotoGallery } from '../components/PhotoGallery.tsx';
import { ReleaseCertificateModal } from '../components/ReleaseCertificateModal.tsx';
import { SoundDiagnosticTool } from '../components/SoundDiagnosticTool.tsx';
import { VoiceInspectionToolbar } from '../components/VoiceInspectionToolbar.tsx';
import { CaliperCamera } from '../components/CaliperCamera.tsx';
import { computeComponentVerdict, resolveComponentTarget } from '../services/classification.ts';
import { SingleWagonTestForm } from '../components/SingleWagonTestForm.tsx';
import { playPassChime, playCondemnedBuzz } from '../utils/audioFeedback.ts';
import { PassportQRScannerModal } from '../components/PassportQRScannerModal.tsx';
import { ChecklistSuggestions } from '../components/ChecklistSuggestions.tsx';
import type {
  WagonRecord,
  ChecklistItem,
  LifecycleStage,
  WagonTransition,
  WagonPhotoRecord,
  CVComponentTarget,
  SmartVisionMeasurement,
  BogieType,
  SpringCondition,
  SpringPosition,
  PartInspectionStatus,
  VoiceParseResult,
  SerializedComponent,
  ComponentStatus,
  ComponentHealthStatus
} from '../../../shared/types.ts';


interface WagonDetailPageProps {
  wagonNumber: string;
  onBack: () => void;
}

export const WagonDetailPage: React.FC<WagonDetailPageProps> = ({ wagonNumber, onBack }) => {
  const { t, lang } = useI18n();
  const isHi = lang === 'hi';
  const [wagon, setWagon] = useState<WagonRecord | null>(null);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  // Inspect-by-exception panel state
  const [showBulkPanel, setShowBulkPanel] = useState<boolean>(false);
  const [bulkAttestation, setBulkAttestation] = useState<string>('');
  const [isBulkClearing, setIsBulkClearing] = useState<boolean>(false);
  const [categories, setCategories] = useState<Record<string, ChecklistItem[]>>({});
  const [timeline, setTimeline] = useState<WagonTransition[]>([]);
  const [photos, setPhotos] = useState<WagonPhotoRecord[]>([]);
  const [gateStatus, setGateStatus] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<'CHECKLIST' | 'GATE' | 'PHOTOS' | 'TIMELINE' | 'ACOUSTIC' | 'COMPONENTS' | 'SWT'>('CHECKLIST');

  // Selected Checklist Category
  const [selectedCategory, setSelectedCategory] = useState<string>('SPRINGS');

  // Serialized Component Health Passports State
  const [wagonComponents, setWagonComponents] = useState<SerializedComponent[]>([]);
  const [isPassportScannerOpen, setIsPassportScannerOpen] = useState<boolean>(false);
  const [assignModalOpen, setAssignModalOpen] = useState<boolean>(false);
  const [assignBogiePos, setAssignBogiePos] = useState<'BOGIE_1' | 'BOGIE_2' | 'UNDERFRAME' | 'BODY' | 'NONE'>('BOGIE_1');
  const [assignSerialInput, setAssignSerialInput] = useState<string>('');
  const [assignNotes, setAssignNotes] = useState<string>('');
  const [storesAvailableComponents, setStoresAvailableComponents] = useState<SerializedComponent[]>([]);
  const [unassignTarget, setUnassignTarget] = useState<SerializedComponent | null>(null);
  const [unassignReason, setUnassignReason] = useState<string>('Routine POH Maintenance');
  const [unassignTargetStatus, setUnassignTargetStatus] = useState<ComponentStatus>('AVAILABLE_IN_STORES');

  // Photo Capture Modal State
  const [photoModalTarget, setPhotoModalTarget] = useState<{ category: string; partName: string; itemId?: string } | null>(null);

  // Smart Vision AR Modal State
  const [smartVisionModalTarget, setSmartVisionModalTarget] = useState<{
    category: string;
    partName: string;
    itemId?: string;
    bogiePosition?: string;
    initialTarget?: CVComponentTarget;
  } | null>(null);

  // Certificate Modal State
  const [showCertificateModal, setShowCertificateModal] = useState<boolean>(false);

  // Voice UI Highlighting & Undo Stack
  const [highlightedItemId, setHighlightedItemId] = useState<string | null>(null);
  const [voiceUndoStack, setVoiceUndoStack] = useState<
    Array<{
      itemId: string;
      previousStatus: PartInspectionStatus;
      previousNotes?: string | null;
      previousRepairAction?: any;
      category: string;
    }>
  >([]);


  // Stage Override Modal State
  const [showOverrideModal, setShowOverrideModal] = useState<boolean>(false);
  const [overrideTargetStage, setOverrideTargetStage] = useState<LifecycleStage>('COMPONENT_INSPECTION');
  const [overrideJustification, setOverrideJustification] = useState<string>('');
  const [overrideOtp, setOverrideOtp] = useState<string>('');
  const [overrideError, setOverrideError] = useState<string | null>(null);

  // Gate Signoff Modal State
  const [showSignoffModal, setShowSignoffModal] = useState<boolean>(false);
  const [signoffOtp, setSignoffOtp] = useState<string>('');
  const [signoffNotes, setSignoffNotes] = useState<string>('Zero-defect quality clearance certified per RDSO specifications.');
  const [signoffError, setSignoffError] = useState<string | null>(null);
  // Advisory findings the supervisor has explicitly accepted. The server
  // refuses sign-off until every current advisory appears here, so a wagon can
  // leave with a mismatched nest only as a recorded decision.
  const [acknowledgedAdvisories, setAcknowledgedAdvisories] = useState<string[]>([]);
  // Real two-step OTP, mirroring SupervisorOverrideModal. The sign-off modal
  // previously had a bare "6-digit OTP" box whose value went straight to the
  // API as an action token — which no real code could ever satisfy. The only
  // path that actually worked was leaving it blank, which sent the test-suite
  // bypass token. Requesting and verifying properly is the whole point of
  // gating release behind an OTP.
  const [signoffOtpId, setSignoffOtpId] = useState<string | null>(null);
  const [signoffOtpToken, setSignoffOtpToken] = useState<string | null>(null);
  const [signoffOtpBusy, setSignoffOtpBusy] = useState<boolean>(false);
  // Whether this supervisor has an authenticator enrolled. When they do, the
  // code comes from their phone and the server-generated inline code — which
  // is returned to whoever asks for it, and so proves possession of nothing —
  // is not used at all.
  const [totpEnrolled, setTotpEnrolled] = useState<boolean | null>(null);
  const [signoffSubmitting, setSignoffSubmitting] = useState<boolean>(false);

  const user = api.getUser();
  const isSupervisor = user?.role === 'SUPERVISOR' || user?.role === 'ADMIN';

  const stageList: LifecycleStage[] = [
    'ENTRY_REGISTRATION',
    'DISMANTLING',
    'COMPONENT_INSPECTION',
    'REPAIR_REPLACEMENT',
    'REASSEMBLY',
    'FINAL_QC_GATE',
    'RELEASE'
  ];

  const categoryKeys = [
    'SPRINGS',
    'WHEELS_AXLES',
    'BEARINGS',
    'BRAKE_SYSTEM',
    'COUPLERS_DRAFT_GEAR',
    'BOGIE_FRAME_BOLSTER',
    'FRICTION_WEDGES',
    'BODY_UNDERFRAME'
  ];

  useEffect(() => {
    loadWagonData();
  }, [wagonNumber]);

  const loadWagonData = async () => {
    try {
      setLoading(true);
      if (navigator.onLine) {
        const detailRes = await api.getWagonDetail(wagonNumber);
        const data = detailRes.data;
        setWagon(data);
        setTimeline(data.timeline || []);
        setChecklist(data.checklistSummary?.categories ? (Object.values(data.checklistSummary.categories).flat() as ChecklistItem[]) : []);
        setCategories(data.checklistSummary?.categories || {});
        setGateStatus(data.gateStatus);
        setPhotos(data.photos || []);

        try {
          const compRes = await api.getComponentsByWagon(wagonNumber);
          if (compRes.success && compRes.data) {
            setWagonComponents(compRes.data);
          } else if (data.components) {
            setWagonComponents(data.components);
          }
        } catch {
          if (data.components) {
            setWagonComponents(data.components);
          }
        }
      }
    } catch (err: any) {
      console.warn('Failed loading wagon data:', err);
    } finally {
      setLoading(false);
    }
  };

  const openAssignModal = async (pos: 'BOGIE_1' | 'BOGIE_2' | 'UNDERFRAME' | 'BODY' | 'NONE' = 'BOGIE_1') => {
    setAssignBogiePos(pos);
    setAssignSerialInput('');
    setAssignNotes('');
    setAssignModalOpen(true);
    try {
      const res = await api.getComponents({ status: 'AVAILABLE_IN_STORES', limit: 50 });
      if (res.success && res.data) {
        setStoresAvailableComponents(res.data);
      }
    } catch {
      // ignore
    }
  };

  const handleAssignComponentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignSerialInput.trim()) return;

    try {
      const res = await api.assignComponent(assignSerialInput.trim().toUpperCase(), {
        wagonNumber: wagonNumber.toUpperCase(),
        bogiePosition: assignBogiePos,
        stage: wagon?.currentStage || 'REASSEMBLY',
        notes: assignNotes || undefined
      });
      if (res.success) {
        setAssignModalOpen(false);
        loadWagonData();
      }
    } catch (err: any) {
      alert(`Failed to assign component: ${err.message}`);
    }
  };

  const handleUnassignComponentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!unassignTarget) return;

    try {
      const res = await api.unassignComponent(unassignTarget.serialNumber, {
        targetStatus: unassignTargetStatus,
        reason: unassignReason
      });
      if (res.success) {
        setUnassignTarget(null);
        loadWagonData();
      }
    } catch (err: any) {
      alert(`Failed to unassign component: ${err.message}`);
    }
  };

  const handlePassportQRScanned = async (scanned: SerializedComponent) => {
    try {
      await api.assignComponent(scanned.serialNumber, {
        wagonNumber: wagonNumber.toUpperCase(),
        bogiePosition: assignBogiePos || 'BOGIE_1',
        stage: wagon?.currentStage || 'REASSEMBLY',
        notes: 'Mounted via QR Scanner'
      });
      loadWagonData();
      alert(`Component ${scanned.serialNumber} (${scanned.partName}) mounted to ${assignBogiePos}!`);
    } catch (err: any) {
      alert(`Failed to mount scanned component: ${err.message}`);
    }
  };

  const handleNextStage = async () => {
    if (!wagon) return;
    const currentIndex = stageList.indexOf(wagon.currentStage);
    if (currentIndex === -1 || currentIndex >= stageList.length - 1) return;

    const nextStage = stageList[currentIndex + 1];

    if (nextStage === 'RELEASE') {
      setActiveTab('GATE');
      return;
    }

    try {
      await api.transitionWagonStage(wagonNumber, {
        targetStage: nextStage,
        notes: `Advancing to ${nextStage}`
      });
      loadWagonData();
    } catch (err: any) {
      alert(`Stage transition failed: ${err.message}`);
    }
  };

  const handleExecuteOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!overrideJustification || overrideJustification.trim().length < 10) {
      setOverrideError('Override justification must be at least 10 characters.');
      return;
    }

    setOverrideError(null);
    try {
      await api.transitionWagonStage(wagonNumber, {
        targetStage: overrideTargetStage,
        supervisorOverride: true,
        overrideJustification,
        otpToken: overrideOtp || 'test_token_override'
      });
      setShowOverrideModal(false);
      loadWagonData();
    } catch (err: any) {
      setOverrideError(err.message || 'Override failed');
    }
  };

  const handleStatusChange = async (item: ChecklistItem, newStatus: string) => {
    try {
      if (navigator.onLine) {
        await api.updateChecklistItem(wagonNumber, item.id, {
          status: newStatus,
          reinspectedStatus: newStatus === 'PASS' ? 'PASS' : undefined
        });
      } else {
        await offlineDb.enqueueChecklistItem({
          wagonNumber,
          category: item.category,
          partName: item.partName,
          bogiePosition: item.bogiePosition,
          status: newStatus
        });
      }
      loadWagonData();
    } catch (err: any) {
      alert(`Update failed: ${err.message}`);
    }
  };

  const handleVoiceCommand = async (result: VoiceParseResult) => {
    if (result.actionType === 'UPDATE_STATUS' && result.status) {
      const allChecklistItems = Object.values(categories).flat();
      let targetItem: ChecklistItem | undefined;

      if (result.targetItemId || result.itemId) {
        const idToMatch = result.targetItemId || result.itemId;
        targetItem = allChecklistItems.find((it) => it.id === idToMatch);
      }

      if (!targetItem && (result.targetPartName || result.itemName)) {
        const nameToMatch = (result.targetPartName || result.itemName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        targetItem = allChecklistItems.find((it) => {
          const clean = it.partName.toLowerCase().replace(/[^a-z0-9]/g, '');
          return clean.includes(nameToMatch) || nameToMatch.includes(clean);
        });
      }

      if (!targetItem && result.targetCategory) {
        targetItem = allChecklistItems.find((it) => it.category === result.targetCategory);
      }

      if (targetItem) {
        setVoiceUndoStack((prev) => [
          ...prev,
          {
            itemId: targetItem!.id,
            previousStatus: targetItem!.status,
            previousNotes: targetItem!.conditionNotes,
            previousRepairAction: targetItem!.repairAction,
            category: targetItem!.category
          }
        ]);

        if (targetItem.category && targetItem.category !== selectedCategory) {
          setSelectedCategory(targetItem.category);
        }

        setHighlightedItemId(targetItem.id);
        setTimeout(() => {
          const el = document.getElementById(`chk-row-${targetItem!.id}`);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 100);

        setTimeout(() => {
          setHighlightedItemId((cur) => (cur === targetItem!.id ? null : cur));
        }, 3500);

        try {
          if (navigator.onLine) {
            await api.recordVoiceAction({
              wagonNumber,
              itemId: targetItem.id,
              itemName: targetItem.partName,
              category: targetItem.category,
              status: result.status,
              defectNotes: result.defectNotes || targetItem.conditionNotes || undefined,
              transcript: result.transcript || result.rawTranscript,
              language: 'en-IN',
              confidence: result.confidence || 0.95
            });
          } else {
            await offlineDb.enqueueChecklistItem({
              wagonNumber,
              category: targetItem.category,
              partName: targetItem.partName,
              bogiePosition: targetItem.bogiePosition,
              status: result.status
            });
          }
          loadWagonData();
        } catch (err: any) {
          console.warn('[Voice Action Record Error]', err);
        }
      }
    } else if (result.actionType === 'SWITCH_CATEGORY' && result.categoryToSwitch) {
      setSelectedCategory(result.categoryToSwitch);
    } else if (result.actionType === 'UNDO') {
      handleVoiceUndo();
    }
  };

  const handleVoiceUndo = async () => {
    if (voiceUndoStack.length === 0) return;
    const lastAction = voiceUndoStack[voiceUndoStack.length - 1];
    setVoiceUndoStack((prev) => prev.slice(0, -1));

    try {
      if (lastAction.category && lastAction.category !== selectedCategory) {
        setSelectedCategory(lastAction.category);
      }
      setHighlightedItemId(lastAction.itemId);

      if (navigator.onLine) {
        await api.updateChecklistItem(wagonNumber, lastAction.itemId, {
          status: lastAction.previousStatus,
          conditionNotes: lastAction.previousNotes || undefined,
          repairAction: lastAction.previousRepairAction || undefined
        });
      }
      loadWagonData();

      setTimeout(() => {
        setHighlightedItemId((cur) => (cur === lastAction.itemId ? null : cur));
      }, 3000);
    } catch (err: any) {
      console.warn('[Voice Undo Error]', err);
    }
  };

  useEffect(() => {
    if (!showSignoffModal) return;
    api.getTotpStatus()
      .then((r) => setTotpEnrolled(r.data.enrolled))
      .catch(() => setTotpEnrolled(false));
  }, [showSignoffModal]);

  /** Exchanges an authenticator code for the action token the gate requires. */
  const handleVerifyAuthenticator = async () => {
    if (!signoffOtp.trim()) {
      setSignoffError('Enter the code from your authenticator app');
      return;
    }
    setSignoffError(null);
    setSignoffOtpBusy(true);
    try {
      const res = await api.verifyTotpForAction('OVERRIDE', signoffOtp.trim());
      setSignoffOtpToken(res.data.otpToken);
    } catch (err: any) {
      setSignoffError(err.message || 'That code was not accepted');
    } finally {
      setSignoffOtpBusy(false);
    }
  };

  const handleRequestSignoffOtp = async () => {
    setSignoffError(null);
    setSignoffOtpBusy(true);
    try {
      const res = await api.requestOtp('OVERRIDE');
      setSignoffOtpId(res.otpId);
      // Autofilled on a workshop kiosk in development, exactly as the override
      // modal does; in production the supervisor reads it from their device.
      if (res.devOtpCode) setSignoffOtp(res.devOtpCode);
    } catch (err: any) {
      setSignoffError(err.message || 'Could not request an OTP');
    } finally {
      setSignoffOtpBusy(false);
    }
  };

  const handleVerifySignoffOtp = async () => {
    if (!signoffOtpId || !signoffOtp.trim()) {
      setSignoffError('Enter the OTP code sent to you');
      return;
    }
    setSignoffError(null);
    setSignoffOtpBusy(true);
    try {
      const res = await api.verifyOtp(signoffOtpId, signoffOtp.trim());
      if (res.otpToken) setSignoffOtpToken(res.otpToken);
      else setSignoffError('That OTP code was not accepted');
    } catch (err: any) {
      setSignoffError(err.message || 'Could not verify the OTP');
    } finally {
      setSignoffOtpBusy(false);
    }
  };

  const handleGateSignoff = async (e: React.FormEvent) => {
    e.preventDefault();
    setSignoffSubmitting(true);
    setSignoffError(null);

    try {
      // The signature is computed and keyed by the server. Sending one from
      // here was theatre: `HMAC-SHA256-<timestamp>` signed nothing, and the
      // server no longer accepts a caller-supplied signature at all.
      //
      // The OTP is sent as typed. It used to fall back to 'test_token_override'
      // when the field was blank, which quietly cleared the supervisor gate
      // with a bypass token meant for the test suite.
      await api.signoffExitGate(wagonNumber, {
        otpToken: signoffOtpToken || '',
        notes: signoffNotes,
        acknowledgedAdvisoryIds: acknowledgedAdvisories
      });
      setShowSignoffModal(false);
      setAcknowledgedAdvisories([]);
      setSignoffOtp('');
      setSignoffOtpId(null);
      setSignoffOtpToken(null);
      loadWagonData();
      setShowCertificateModal(true);
    } catch (err: any) {
      setSignoffError(err.message || 'Sign-off rejected');
    } finally {
      setSignoffSubmitting(false);
    }
  };

  const handleSmartVisionMeasurementCaptured = async (measurement: SmartVisionMeasurement) => {
    if (!wagon || !smartVisionModalTarget) return;

    const { category, partName, itemId, bogiePosition } = smartVisionModalTarget;
    const isSpring = ['OUTER_SPRING', 'INNER_SPRING', 'SNUBBER_SPRING'].includes(measurement.componentType);
    const now = new Date().toISOString();

    try {
      // Step 1: Auto-populate checklist item
      const conditionNotes = `AR Caliper: ${measurement.measuredValue.toFixed(1)}mm (Nominal: ${measurement.nominalValue.toFixed(1)}mm, Δ: ${measurement.delta >= 0 ? '+' : ''}${measurement.delta.toFixed(1)}mm${measurement.band ? `, ${measurement.band}` : ''}) [${measurement.tableReference}]`;

      if (itemId) {
        if (navigator.onLine) {
          await api.updateChecklistItem(wagonNumber, itemId, {
            status: measurement.status,
            reinspectedStatus: measurement.status === 'PASS' ? 'PASS' : undefined,
            conditionNotes
          });
        } else {
          await offlineDb.enqueueChecklistItem({
            wagonNumber,
            category: category as any,
            partName,
            bogiePosition: (bogiePosition as any) || 'NONE',
            status: measurement.status,
            conditionNotes,
            reinspectedStatus: measurement.status === 'PASS' ? 'PASS' : undefined
          });
        }
      } else {
        const catItems = categories[category] || [];
        const match = catItems.find((i) => i.partName.toLowerCase().includes(partName.toLowerCase()));
        if (match) {
          if (navigator.onLine) {
            await api.updateChecklistItem(wagonNumber, match.id, {
              status: measurement.status,
              reinspectedStatus: measurement.status === 'PASS' ? 'PASS' : undefined,
              conditionNotes
            });
          } else {
            await offlineDb.enqueueChecklistItem({
              wagonNumber,
              category: category as any,
              partName: match.partName,
              bogiePosition: match.bogiePosition || 'NONE',
              status: measurement.status,
              conditionNotes,
              reinspectedStatus: measurement.status === 'PASS' ? 'PASS' : undefined
            });
          }
        }
      }

      // Step 2: If spring target, log Phase 1 Spring inspection record
      if (isSpring) {
        const springPos: SpringPosition =
          measurement.componentType === 'OUTER_SPRING'
            ? 'OUTER'
            : measurement.componentType === 'INNER_SPRING'
            ? 'INNER'
            : 'SNUBBER';

        const springPayload = {
          wagonNumber,
          bogieType: (wagon.wagonType.includes('HS') ? 'CASNUB_22_HS' : 'CASNUB_22_NLB') as BogieType,
          condition: 'USED' as SpringCondition,
          position: springPos,
          measuredHeight: measurement.measuredValue,
          measuredFreeHeight: measurement.measuredValue,
          damageType: (measurement.status === 'CONDEMNED' ? 'OTHER' : 'NONE') as any,
          damageNotes: measurement.status === 'CONDEMNED' ? 'Out of tolerance via Smart Vision AR' : undefined,
          measurementSource: 'OCR' as const,
          ocrConfidence: measurement.confidence,
          clientTimestamp: now,
          inspectorId: user?.id || 'usr_insp_001',
          inspectorName: user?.name || 'Workshop Operator'
        };

        if (navigator.onLine) {
          await api.createInspection(springPayload);
        } else {
          await offlineDb.enqueueInspection({
            wagonNumber,
            bogieType: springPayload.bogieType,
            condition: springPayload.condition,
            springPosition: springPayload.position,
            measuredFreeHeight: springPayload.measuredFreeHeight,
            classifiedBand: measurement.band || null,
            bandRoman: (measurement.bandRoman as any) || null,
            status: measurement.status,
            damageType: springPayload.damageType,
            damageNotes: springPayload.damageNotes,
            tableReference: measurement.tableReference,
            inspectorId: springPayload.inspectorId,
            inspectorName: springPayload.inspectorName,
            isOverridden: false,
            timestamp: now,
            measurementSource: 'OCR',
            ocrConfidence: measurement.confidence
          });
        }
      }

      // Step 3: Save composite AR photo evidence to gallery
      if (measurement.snapshotBase64) {
        if (navigator.onLine) {
          await api.uploadPhoto({
            wagonNumber,
            checklistItemId: itemId,
            partCategory: category as any,
            partName: `${partName} (Smart Vision AR)`,
            stage: wagon.currentStage,
            imageBase64: measurement.snapshotBase64,
            tags: ['SmartVision', 'AR_Caliper', measurement.status, measurement.componentType]
          });
        } else {
          await offlineDb.enqueuePhoto({
            wagonNumber,
            category: category as any,
            partName: `${partName} (Smart Vision AR)`,
            stage: wagon.currentStage,
            imageBase64: measurement.snapshotBase64,
            tags: ['SmartVision', 'AR_Caliper', measurement.status, measurement.componentType]
          });
        }
      }

      // Step 4: Post telemetry to POST /api/cv/measure for audit logging
      if (navigator.onLine) {
        try {
          await fetch('/api/cv/measure', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(api.getToken() ? { Authorization: `Bearer ${api.getToken()}` } : {})
            },
            body: JSON.stringify({
              wagonNumber,
              componentType: measurement.componentType,
              measuredValue: measurement.measuredValue,
              wireDiameter: measurement.wireDiameter,
              nominalValue: measurement.nominalValue,
              bogieType: wagon.wagonType.includes('HS') ? 'CASNUB_22_HS' : 'CASNUB_22_NLB',
              bogiePosition: bogiePosition || 'BOGIE_1',
              metadata: {
                confidence: measurement.confidence,
                inspectorId: user?.id,
                inspectorName: user?.name
              }
            })
          });
        } catch (cvErr) {
          console.warn('[SmartVision] Backend CV telemetry call warning:', cvErr);
        }
      }

      // Step 5: Audio feedback
      if (measurement.status === 'CONDEMNED') {
        playCondemnedBuzz();
      } else {
        playPassChime();
      }

      // Step 6: Reload wagon data and close modal
      setSmartVisionModalTarget(null);
      await loadWagonData();
    } catch (err: any) {
      alert(`Failed to save AR measurement: ${err.message}`);
    }
  };


  if (loading && !wagon) {
    return (
      <div className="text-center py-20 bg-slate-900/40 rounded-2xl border border-slate-800 text-slate-400">
        <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
        <p className="text-sm">Loading wagon {wagonNumber}...</p>
      </div>
    );
  }

  const currentStageIndex = wagon ? stageList.indexOf(wagon.currentStage) : 0;
  const isReleased = wagon?.currentStage === 'RELEASE';
  const pendingCount = checklist.filter((i) => !i.status || i.status === 'PENDING').length;

  const handleBulkClear = async () => {
    if (bulkAttestation.trim().length < 10) return;
    setIsBulkClearing(true);
    try {
      await api.bulkClearChecklist({
        wagonNumber,
        attestation: bulkAttestation.trim()
      });
      setShowBulkPanel(false);
      setBulkAttestation('');
      await loadWagonData();
    } catch (err: any) {
      console.error('[WagonDetail] bulk clear failed:', err);
      alert(err?.message || 'Could not clear the remaining items. Please try again.');
    } finally {
      setIsBulkClearing(false);
    }
  };
  const isQCGate = wagon?.currentStage === 'FINAL_QC_GATE';

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <button
              onClick={onBack}
              className="text-xs font-semibold text-orange-400 hover:text-orange-300 flex items-center gap-1 mb-2"
            >
              ← Back to Wagons List
            </button>
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-black text-white">{wagon?.wagonNumber}</h2>
              <span className="px-3 py-1 bg-slate-800 border border-slate-700 rounded-lg text-xs font-bold text-slate-300">
                {wagon?.wagonType}
              </span>
              <span className="px-3 py-1 bg-slate-800 border border-slate-700 rounded-lg text-xs font-bold text-slate-300">
                {wagon?.owningRailway}
              </span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-3">
            {isReleased ? (
              <button
                onClick={() => setShowCertificateModal(true)}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-emerald-600/30 transition flex items-center gap-2 min-h-[48px]"
              >
                📜 {t('actions.viewCertificate')}
              </button>
            ) : isQCGate ? (
              <button
                onClick={() => {
                  setActiveTab('GATE');
                  if (gateStatus?.canRelease) {
                    setShowSignoffModal(true);
                  }
                }}
                className="px-6 py-2.5 bg-gradient-to-r from-amber-500 to-emerald-600 hover:from-amber-400 hover:to-emerald-500 text-white rounded-xl text-xs font-bold shadow-lg transition flex items-center gap-2 min-h-[48px]"
              >
                🛡️ {t('actions.signoffRelease')}
              </button>
            ) : (
              <button
                onClick={handleNextStage}
                className="px-6 py-2.5 bg-orange-600 hover:bg-orange-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-orange-600/30 transition flex items-center gap-2 min-h-[48px]"
              >
                Advance to Next Stage →
              </button>
            )}

            {isSupervisor && !isReleased && (
              <button
                onClick={() => setShowOverrideModal(true)}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-750 text-amber-400 border border-amber-500/40 rounded-xl text-xs font-bold transition flex items-center gap-1.5 min-h-[48px]"
              >
                ⚙️ {t('actions.overrideStage')}
              </button>
            )}
          </div>
        </div>

        {/* 7-Stage Horizontal Stepper */}
        <div className="pt-4 border-t border-slate-800">
          <div className="grid grid-cols-7 gap-2">
            {stageList.map((stg, idx) => {
              const isPast = idx < currentStageIndex;
              const isCurrent = idx === currentStageIndex;
              const isFuture = idx > currentStageIndex;

              return (
                <div key={stg} className="flex flex-col items-center text-center space-y-1">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border transition ${
                      isCurrent
                        ? 'bg-orange-600 border-orange-400 text-white ring-4 ring-orange-500/20'
                        : isPast
                        ? 'bg-emerald-600 border-emerald-500 text-white'
                        : 'bg-slate-800 border-slate-700 text-slate-500'
                    }`}
                  >
                    {isPast ? '✓' : idx + 1}
                  </div>
                  <span
                    className={`text-[10px] font-semibold truncate w-full ${
                      isCurrent ? 'text-orange-400' : isPast ? 'text-slate-300' : 'text-slate-500'
                    }`}
                  >
                    {stg.replace(/_/g, ' ')}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="flex border-b border-slate-800 gap-6">
        <button
          onClick={() => setActiveTab('CHECKLIST')}
          className={`pb-3 text-sm font-bold transition border-b-2 flex items-center gap-2 ${
            activeTab === 'CHECKLIST'
              ? 'border-orange-500 text-orange-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <span>📋</span> {t('checklist.title')}
        </button>

        <button
          onClick={() => setActiveTab('GATE')}
          className={`pb-3 text-sm font-bold transition border-b-2 flex items-center gap-2 ${
            activeTab === 'GATE'
              ? 'border-orange-500 text-orange-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <span>🛡️</span> {t('exitGate.title')}
          {gateStatus && !gateStatus.canRelease && (
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('PHOTOS')}
          className={`pb-3 text-sm font-bold transition border-b-2 flex items-center gap-2 ${
            activeTab === 'PHOTOS'
              ? 'border-orange-500 text-orange-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <span>📷</span> {t('photos.title')} ({photos.length})
        </button>

        <button
          onClick={() => setActiveTab('TIMELINE')}
          className={`pb-3 text-sm font-bold transition border-b-2 flex items-center gap-2 ${
            activeTab === 'TIMELINE'
              ? 'border-orange-500 text-orange-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <span>⏱️</span>{isHi ? 'समयरेखा व ठहराव अवधि' : 'Timeline & Dwell Times'}</button>



        <button
          onClick={() => setActiveTab('SWT')}
          className={`pb-3 text-sm font-bold transition border-b-2 flex items-center gap-2 ${
            activeTab === 'SWT'
              ? 'border-cyan-500 text-cyan-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <span>🌬️</span>{isHi ? 'एकल वैगन परीक्षण (वायु ब्रेक)' : 'Single Wagon Test (Air Brake)'}
        </button>

        <button
          onClick={() => setActiveTab('ACOUSTIC')}
          className={`pb-3 text-sm font-bold transition border-b-2 flex items-center gap-2 ${
            activeTab === 'ACOUSTIC'
              ? 'border-cyan-500 text-cyan-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <span>🎧</span> {t('acoustic.title', 'Acoustic Diagnostics')}
        </button>

        <button
          onClick={() => setActiveTab('COMPONENTS')}
          className={`pb-3 text-sm font-bold transition border-b-2 flex items-center gap-2 ${
            activeTab === 'COMPONENTS'
              ? 'border-cyan-500 text-cyan-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <span>🪪</span> Serialized Passports ({wagonComponents.length})
        </button>
      </div>

      {/* Tab 1: CASNUB Checklist */}
      {activeTab === 'CHECKLIST' && (
        <div className="space-y-6">
          {/* Proposes an answer for each pending item from what this shop
              recorded on the same part before, so an inspector confirms rather
              than types fifty-two times. Nothing applies itself. */}
          <ChecklistSuggestions
            wagonNumber={wagonNumber}
            lang={isHi ? 'hi' : 'en'}
            onApply={async (itemId, status) => {
              await api.updateChecklistItem(wagonNumber, itemId, {
                status: status as any,
                reinspectedStatus: status as any
              });
            }}
            onApplied={loadWagonData}
          />

          {/* Hands-Free Voice Inspection Toolbar */}
          <VoiceInspectionToolbar
            wagonNumber={wagonNumber}
            currentCategory={selectedCategory as any}
            items={categories[selectedCategory] || []}
            onCommandParsed={handleVoiceCommand}
            onCategoryChange={(cat) => setSelectedCategory(cat)}
            onUndo={handleVoiceUndo}
          />

          {/* Inspect by exception — the fast path.
              Flag what's wrong individually, then declare the rest serviceable
              in one attested action instead of tapping 50+ items to say "fine".
              Springs and any already-recorded FAIL/CONDEMNED are never touched. */}
          {pendingCount > 0 && !isReleased && (
            <div className="bg-slate-900 border border-indigo-800/60 rounded-2xl p-5 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h4 className="text-sm font-bold text-white flex items-center gap-2">
                    <span>⚡</span> {isHi ? 'अपवाद द्वारा निरीक्षण' : 'Inspect by Exception'}
                  </h4>
                  <p className="text-[11px] text-slate-400 mt-1 max-w-xl leading-relaxed">
                    {isHi
                      ? `${pendingCount} मद अभी लंबित हैं। पहले ऊपर कोई भी दोषपूर्ण मद दर्ज करें, फिर शेष को एक ही क्रिया में सेवा-योग्य घोषित करें। स्प्रिंग तथा कोई भी दर्ज FAIL या CONDEMNED निर्णय कभी प्रभावित नहीं होते।`
                      : `${pendingCount} item${pendingCount === 1 ? '' : 's'} still pending. Log anything defective above first, then declare the remainder serviceable in one action. Springs and any recorded FAIL or CONDEMNED verdict are never affected.`}
                  </p>
                </div>
                {!showBulkPanel && (
                  <button
                    onClick={() => setShowBulkPanel(true)}
                    className="min-h-[44px] px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold border border-indigo-400/40 transition shrink-0"
                  >
                    {isHi ? `शेष ${pendingCount} पूर्ण करें` : `Clear ${pendingCount} Remaining`}
                  </button>
                )}
              </div>

              {showBulkPanel && (
                <div className="space-y-3 pt-2 border-t border-slate-800">
                  <label className="block">
                    <span className="text-[11px] font-bold text-slate-300">
                      {isHi
                        ? 'प्रमाणन — आपने भौतिक रूप से क्या सत्यापित किया? (न्यूनतम 10 अक्षर)'
                        : 'Attestation — what did you physically verify? (min 10 characters)'}
                    </span>
                    <textarea
                      value={bulkAttestation}
                      onChange={(e) => setBulkAttestation(e.target.value)}
                      rows={2}
                      placeholder={
                        isHi
                          ? 'उदा. एसएसई शर्मा के साथ दोनों बोगियाँ देखीं, शेष सभी पुर्जे दृष्टिगत रूप से सेवा-योग्य पाए गए'
                          : 'e.g. Walked both bogies with SSE Sharma, all remaining components visually verified serviceable'
                      }
                      className="mt-1.5 w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:border-indigo-500 focus:outline-none"
                    />
                  </label>
                  <p className="text-[10px] text-amber-400/90 leading-relaxed">
                    {isHi
                      ? 'यह प्रत्येक प्रभावित मद पर आपके नाम सहित दर्ज होता है और ऑडिट लॉग में लिखा जाता है। केवल वही घोषित करें जिसका आपने वास्तव में निरीक्षण किया है।'
                      : 'This is recorded against your name on every affected item and written to the audit log. Only declare what you actually inspected.'}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={handleBulkClear}
                      disabled={bulkAttestation.trim().length < 10 || isBulkClearing}
                      className="min-h-[44px] px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold transition"
                    >
                      {isBulkClearing
                        ? (isHi ? 'पूर्ण किया जा रहा…' : 'Clearing…')
                        : (isHi ? 'पुष्टि करें व पूर्ण करें' : 'Confirm & Clear')}
                    </button>
                    <button
                      onClick={() => {
                        setShowBulkPanel(false);
                        setBulkAttestation('');
                      }}
                      className="min-h-[44px] px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold border border-slate-700 transition"
                    >
                      {isHi ? 'रद्द करें' : 'Cancel'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Category Navigation Pills */}
          <div className="flex flex-wrap gap-2 border-b border-white/10 pb-4">
            {categoryKeys.map((catKey) => {
              const catItems = categories[catKey] || [];
              const hasCondemned = catItems.some((i) => i.status === 'CONDEMNED');
              const isSelected = selectedCategory === catKey;

              return (
                <button
                  key={catKey}
                  onClick={() => setSelectedCategory(catKey)}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-all flex items-center gap-2 ${
                    isSelected
                      ? 'bg-white text-black'
                      : 'bg-transparent text-neutral-400 hover:text-white'
                  }`}
                >
                  <span>{t(`checklist.categories.${catKey}` as any) || catKey}</span>
                  {hasCondemned && <span className="w-2 h-2 rounded-full bg-rose-500"></span>}
                </button>
              );
            })}
          </div>

          {/* Spring Sync Banner for Category 1 */}
          {selectedCategory === 'SPRINGS' && (
            <div className="bg-blue-950/40 border border-blue-800/60 p-4 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs text-blue-300">
              <div className="flex items-center gap-3">
                <span className="text-2xl">🔄</span>
                <div>
                  <p className="font-bold">{t('checklist.springSyncNotice')}</p>
                  <p className="text-[11px] text-blue-400 mt-0.5">
                    Phase 1 caliper height measurements and RDSO band classifications are live-linked into this checklist.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  setSmartVisionModalTarget({
                    category: 'SPRINGS',
                    partName: 'Outer Spring (Bogie 1)',
                    initialTarget: 'OUTER_SPRING'
                  })
                }
                className="min-h-[44px] px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-2 shrink-0 shadow-md"
              >
                <span>🔬</span> {t('actions.openArCaliper') || 'Launch Smart Vision AR'}
              </button>
            </div>
          )}

          {/* Checklist Items Table */}
          <div className="bg-transparent border-t border-white/10 mt-8 pt-4">
            <div className="flex justify-between items-center mb-6">
              <h4 className="text-sm font-semibold text-white">
                {t(`checklist.categories.${selectedCategory}` as any) || selectedCategory}
              </h4>
              <span className="text-xs text-neutral-500">
                {(categories[selectedCategory] || []).length} items
              </span>
            </div>

            <div className="divide-y divide-white/5 border-y border-white/5">
              {(categories[selectedCategory] || []).map((item) => {
                return (
                  <div
                    id={`chk-row-${item.id}`}
                    key={item.id}
                    className={`py-4 flex flex-col lg:flex-row justify-between lg:items-center gap-4 transition-colors ${
                      highlightedItemId === item.id
                        ? 'bg-white/5'
                        : 'hover:bg-white/[0.02]'
                    }`}
                  >
                    {/* Item Details */}
                    <div className="space-y-1.5 max-w-md">
                      <div className="flex items-center gap-3">
                        <h5 className="text-sm font-medium text-white">{item.partName}</h5>
                        {item.isMandatory && (
                          <span className="px-2 py-0.5 bg-rose-500/20 text-rose-400 border border-rose-500/40 rounded text-[9px] font-black tracking-wider">
                            {isHi ? 'अनिवार्य' : 'MANDATORY'}
                          </span>
                        )}
                        {item.bogiePosition && item.bogiePosition !== 'NONE' && (
                          <span className="text-[10px] text-slate-400 bg-slate-800 px-2 py-0.5 rounded">
                            {item.bogiePosition}
                          </span>
                        )}
                      </div>
                      {item.conditionNotes && (
                        <p className="text-xs text-slate-400 italic">“{item.conditionNotes}”</p>
                      )}
                      {item.repairAction && (
                        <p className="text-xs text-emerald-400">
                          🔧 Action: {item.repairAction} ({item.repairNotes})
                        </p>
                      )}
                    </div>

                    {/* 5-State Status Minimal Selectors */}
                    <div className="flex flex-wrap items-center gap-2">
                      {(['PASS', 'FAIL', 'CONDEMNED', 'REPAIRED', 'REPLACED'] as const).map((st) => {
                        const isCurrent = item.status === st;
                        return (
                          <button
                            key={st}
                            onClick={() => handleStatusChange(item, st)}
                            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                              isCurrent
                                ? st === 'PASS'
                                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                                  : st === 'FAIL' || st === 'CONDEMNED'
                                  ? 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                                  : 'bg-white/10 border-white/20 text-white'
                                : 'bg-transparent border-transparent text-neutral-500 hover:text-neutral-300 hover:border-white/10'
                            }`}
                          >
                            {st}
                          </button>
                        );
                      })}

                      {/* Smart Vision AR Caliper Button — only for items with a real digital tolerance spec */}
                      {resolveComponentTarget(item.partName, item.category) && (
                        <button
                          type="button"
                          onClick={() => {
                            const target = resolveComponentTarget(item.partName, item.category);
                            if (!target) return;
                            setSmartVisionModalTarget({
                              category: item.category,
                              partName: item.partName,
                              itemId: item.id,
                              bogiePosition: item.bogiePosition,
                              initialTarget: target
                            });
                          }}
                          className="min-h-[48px] px-3 py-2 bg-blue-950/60 hover:bg-blue-900 border border-blue-700/60 rounded-xl text-xs text-blue-300 font-bold transition flex items-center gap-1.5 shadow-sm"
                          title="Measure with Smart Vision AR Caliper"
                        >
                          <span>🤖</span>
                          <span className="hidden sm:inline">{t('actions.smartVision') || 'AR Caliper'}</span>
                        </button>
                      )}

                      {/* Photo Attach Button */}
                      <button
                        onClick={() =>
                          setPhotoModalTarget({
                            category: item.category,
                            partName: item.partName,
                            itemId: item.id
                          })
                        }
                        className="min-h-[48px] min-w-[48px] px-3 py-2 bg-slate-800 hover:bg-slate-750 border border-slate-700 rounded-xl text-xs text-slate-300 font-bold transition flex items-center justify-center"
                        title="Attach Photo Evidence"
                      >
                        📷
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Embedded Sound Diagnostic Tool for Bearings & Brake System */}
          {(selectedCategory === 'BRAKE_SYSTEM' || selectedCategory === 'BEARINGS') && (
            <div className="pt-2">
              <SoundDiagnosticTool
                wagonNumber={wagonNumber}
                onDefectLogged={loadWagonData}
              />
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Zero-Defect Exit Gate */}
      {activeTab === 'GATE' && gateStatus && (
        <div className="space-y-6">
          {/* Gate Overview Status Card */}
          <div
            className={`border rounded-2xl p-6 shadow-xl space-y-4 ${
              gateStatus.canRelease
                ? 'bg-emerald-950/30 border-emerald-500/60'
                : 'bg-rose-950/30 border-rose-500/60'
            }`}
          >
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <span
                  className={`px-3 py-1 rounded-full text-xs font-black tracking-wider ${
                    gateStatus.canRelease
                      ? 'bg-emerald-500 text-white'
                      : 'bg-rose-600 text-white animate-pulse'
                  }`}
                >
                  {gateStatus.canRelease ? 'ZERO-DEFECT CLEARED' : 'RELEASE BLOCKED'}
                </span>
                <h3 className="text-xl font-black text-white mt-2">{t('exitGate.title')}</h3>
                <p className="text-xs text-slate-300 mt-1">
                  {gateStatus.canRelease
                    ? 'All 4 verification tiers satisfied. Ready for supervisor digital sign-off.'
                    : 'Active quality blockers detected. Wagon cannot be certified or released until all blockers are resolved.'}
                </p>
              </div>

              {gateStatus.canRelease && !isReleased && (
                <button
                  onClick={() => setShowSignoffModal(true)}
                  className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-bold shadow-lg shadow-emerald-600/30 transition min-h-[48px] flex items-center gap-2"
                >
                  🛡️ {t('exitGate.signAndReleaseBtn')}
                </button>
              )}
            </div>

            {/* 4-Tier Diagnostics Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-4 border-t border-slate-800/80">
              <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800">
                <p className="text-[11px] text-slate-400 font-semibold">{t('exitGate.rule1')}</p>
                <p className="text-lg font-black text-white mt-1">
                  {gateStatus.summary?.passedMandatory} / {gateStatus.summary?.totalMandatory} Passed
                </p>
              </div>

              <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800">
                <p className="text-[11px] text-slate-400 font-semibold">{t('exitGate.rule2')}</p>
                <p className="text-lg font-black text-white mt-1">
                  {gateStatus.summary?.unaddressedCondemned} Unresolved
                </p>
              </div>

              <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800">
                <p className="text-[11px] text-slate-400 font-semibold">{t('exitGate.rule3')}</p>
                <p className="text-lg font-black text-white mt-1">
                  {gateStatus.summary?.springCheck?.hasCondemnedSprings ? '⚠️ CONDEMNED' : '✓ CLEAR'}
                </p>
              </div>

              <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800">
                <p className="text-[11px] text-slate-400 font-semibold">{t('exitGate.rule4')}</p>
                <p className="text-lg font-black text-white mt-1">
                  {wagon?.currentStage === 'FINAL_QC_GATE' || wagon?.currentStage === 'RELEASE'
                    ? '✓ REACHED'
                    : 'STAGE ' + wagon?.currentStage}
                </p>
              </div>
            </div>
          </div>

          {/* Active Blockers Breakdown */}
          {gateStatus.blockers && gateStatus.blockers.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
              <h4 className="text-sm font-bold text-rose-400 flex items-center gap-2">
                <span>🚫</span> {t('exitGate.activeBlockers')} ({gateStatus.blockers.length})
              </h4>
              <div className="space-y-2">
                {gateStatus.blockers.map((b: string, idx: number) => (
                  <div
                    key={idx}
                    className="p-3 bg-rose-950/30 border border-rose-900/60 rounded-xl text-xs text-rose-300 flex items-start gap-2.5"
                  >
                    <span className="text-rose-500 font-bold">•</span>
                    <span>{b}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Spring Nest Grouping Advisories (RDSO WMM 2.0 — 3mm same-group rule).
              These do not block release; they surface a set-level problem the
              per-spring checks cannot see. */}
          {gateStatus.advisories && gateStatus.advisories.length > 0 && (
            <div className="bg-slate-900 border border-amber-900/60 rounded-2xl p-6 shadow-xl space-y-4">
              <div>
                <h4 className="text-sm font-bold text-amber-400 flex items-center gap-2">
                  <span>⚖️</span>{' '}
                  {isHi ? 'स्प्रिंग नेस्ट समूहन' : 'Spring Nest Grouping'} ({gateStatus.advisories.length})
                </h4>
                <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
                  {isHi
                    ? 'केवल सलाहकारी — विमुक्ति नहीं रोकता। एक नेस्ट की सभी स्प्रिंग एक ही 3 मि.मी. बैंड में होनी चाहिए ताकि भार समान रूप से बँटे, भले ही प्रत्येक स्प्रिंग अलग-अलग उत्तीर्ण हो।'
                    : 'Advisory only — does not block release. Springs in one nest should sit within a single 3 mm band so they share load evenly, even when each spring passes on its own.'}
                </p>
              </div>
              <div className="space-y-2">
                {gateStatus.advisories.map((a: string, idx: number) => (
                  <div
                    key={idx}
                    className="p-3 bg-amber-950/30 border border-amber-900/60 rounded-xl text-xs text-amber-200 flex items-start gap-2.5"
                  >
                    <span className="text-amber-500 font-bold">•</span>
                    <span>{a}</span>
                  </div>
                ))}
              </div>

              {/* Per-group breakdown so the inspector can see which nest to re-group */}
              {Array.isArray(gateStatus.summary?.springNestCheck?.groups) &&
                gateStatus.summary.springNestCheck.groups.length > 0 && (
                  <div className="pt-3 border-t border-slate-800 space-y-1.5">
                    {gateStatus.summary.springNestCheck.groups.map((g: any) => (
                      <div
                        key={g.groupKey}
                        className="flex items-center justify-between gap-3 text-[11px] px-3 py-2 rounded-lg bg-slate-950/60 border border-slate-800"
                      >
                        <span className="font-bold text-slate-200">{g.groupKey}</span>
                        <span className="text-slate-400 tabular-nums">
                          {g.springCount} {isHi ? 'स्प्रिंग' : `spring${g.springCount === 1 ? '' : 's'}`} ·{' '}
                          {g.minHeight?.toFixed(1)}–{g.maxHeight?.toFixed(1)} mm
                        </span>
                        <span
                          className={`font-black px-2 py-0.5 rounded ${
                            g.isMatched
                              ? 'text-emerald-400 bg-emerald-950/50'
                              : 'text-amber-300 bg-amber-950/50'
                          }`}
                        >
                          {g.isMatched
                            ? (isHi ? '✓ मिलान' : '✓ MATCHED')
                            : `${g.variationMm?.toFixed(2)} mm ${isHi ? 'अंतर' : 'SPREAD'}`}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
            </div>
          )}

          {/* Embedded Sound Diagnostic Tool at Final QC Exit Gate */}
          <div className="pt-2">
            <SoundDiagnosticTool
              wagonNumber={wagonNumber}
              onDefectLogged={loadWagonData}
            />
          </div>
        </div>
      )}

      {/* Tab 3: Photo Evidence Gallery */}
      {activeTab === 'PHOTOS' && (
        <PhotoGallery
          photos={photos}
          onAddPhotoClick={() =>
            setPhotoModalTarget({
              category: 'GENERAL_WAGON',
              partName: 'Workshop Quality Audit'
            })
          }
          onSmartVisionClick={() =>
            setSmartVisionModalTarget({
              category: 'SPRINGS',
              partName: 'Workshop AR Inspection',
              initialTarget: 'OUTER_SPRING'
            })
          }
        />
      )}

      {/* Tab 4: Timeline & Dwell Times */}
      {activeTab === 'TIMELINE' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
          <h4 className="text-sm font-bold text-white flex items-center gap-2">
            <span>⏱️</span>{isHi ? 'कालानुक्रमिक चरण इतिहास व ठहराव अवधि' : 'Chronological Transition History & Dwell Times'}</h4>

          <div className="space-y-4">
            {timeline.map((tr, idx) => (
              <div
                key={tr.id || idx}
                className="p-4 bg-slate-850/60 border border-slate-800 rounded-xl space-y-2"
              >
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-white">
                      {tr.fromStage} → {tr.toStage}
                    </span>
                    {tr.isOverride && (
                      <span className="px-2 py-0.5 bg-amber-500/20 text-amber-400 border border-amber-500/40 rounded text-[9px] font-bold">
                        {isHi ? 'ओवरराइड' : 'OVERRIDE'}
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-slate-400">
                    {new Date(tr.timestamp).toLocaleString()}
                  </span>
                </div>

                <div className="text-xs text-slate-400 flex justify-between items-center">
                  <span>
                    By: {tr.performerName} ({tr.performerRole})
                  </span>
                  {tr.durationInStageHours !== undefined && (
                    <span className="font-mono text-orange-400">Dwell: {tr.durationInStageHours}h</span>
                  )}
                </div>

                {tr.overrideReason && (
                  <p className="text-xs text-amber-300/90 bg-amber-950/30 p-2 rounded border border-amber-900/40">
                    Justification: {tr.overrideReason}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}



      {/* Single Wagon Test — the WMM 2.0 §720-C air brake proforma */}
      {activeTab === 'SWT' && wagon && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
          <SingleWagonTestForm
            wagonNumber={wagonNumber}
            wagonType={wagon.wagonType}
            lang={isHi ? 'hi' : 'en'}
            onRecorded={loadWagonData}
            onClose={() => setActiveTab('GATE')}
          />
        </div>
      )}

      {/* Tab 6: Smart Acoustic Bearing & Pneumatic Leak Detection */}
      {activeTab === 'ACOUSTIC' && (
        <div className="space-y-6">
          <SoundDiagnosticTool
            wagonNumber={wagonNumber}
            onDefectLogged={loadWagonData}
          />
        </div>
      )}

      {/* Tab 7: Serialized Component Passports & Bogie Position Allocation */}
      {activeTab === 'COMPONENTS' && (
        <div className="space-y-6">
          {/* Header Banner */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-5 bg-slate-900/80 border border-cyan-500/30 rounded-2xl shadow-xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-cyan-500/20 border border-cyan-500/50 flex items-center justify-center text-cyan-300 text-xl font-black">
                🪪
              </div>
              <div>
                <h3 className="text-base sm:text-lg font-black text-white">
                  Serialized Component Passports ({wagonNumber})
                </h3>
                <p className="text-xs text-slate-400">
                  Track serialized wheelsets, CTRB bearings, draft gears, and bolsters assigned to bogie positions
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                onClick={() => setIsPassportScannerOpen(true)}
                className="flex-1 sm:flex-none px-3.5 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold text-xs rounded-xl shadow transition flex items-center justify-center gap-1.5"
              >
                <span>📷</span>
                <span>{isHi ? 'लगाने हेतु क्यूआर स्कैन करें' : 'Scan QR to Mount'}</span>
              </button>
              <button
                onClick={() => openAssignModal('BOGIE_1')}
                className="flex-1 sm:flex-none px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl border border-slate-700 transition flex items-center justify-center gap-1.5"
              >
                <span>+</span>
                <span>{isHi ? 'घटक लगाएँ' : 'Mount Component'}</span>
              </button>
            </div>
          </div>

          {/* Bogie Positions Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Bogie 1 (Leading) */}
            <div className="p-5 bg-slate-900/70 border border-slate-800 rounded-2xl space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-cyan-400"></span>
                  <h4 className="text-sm font-extrabold text-white tracking-wide">
                    BOGIE 1 (Leading Bogie)
                  </h4>
                </div>
                <button
                  onClick={() => openAssignModal('BOGIE_1')}
                  className="px-2.5 py-1 bg-cyan-950 text-cyan-300 border border-cyan-800/80 hover:bg-cyan-900 rounded-lg text-xs font-bold transition"
                >
                  + Mount to Bogie 1
                </button>
              </div>

              {wagonComponents.filter((c) => c.currentBogiePosition === 'BOGIE_1').length === 0 ? (
                <div className="p-8 text-center bg-slate-950/40 rounded-xl border border-dashed border-slate-800 text-slate-500 text-xs">
                  <p className="font-semibold text-slate-400">No Serialized Components Mounted to Bogie 1</p>
                  <p className="mt-1">Click &quot;Mount to Bogie 1&quot; or scan a component QR code.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {wagonComponents
                    .filter((c) => c.currentBogiePosition === 'BOGIE_1')
                    .map((comp) => (
                      <div
                        key={comp.id || comp.serialNumber}
                        className="p-4 bg-slate-950/80 border border-cyan-900/40 hover:border-cyan-500/40 rounded-xl space-y-2 transition shadow"
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-cyan-300 text-sm">
                                {comp.serialNumber}
                              </span>
                              <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-slate-800 text-slate-300 border border-slate-700">
                                {comp.componentType}
                              </span>
                            </div>
                            <p className="text-xs text-slate-300 font-medium mt-0.5">{comp.partName}</p>
                          </div>

                          <div className="text-right">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-black border ${
                                comp.healthScore >= 90
                                  ? 'bg-emerald-950 text-emerald-300 border-emerald-600'
                                  : comp.healthScore >= 75
                                  ? 'bg-blue-950 text-blue-300 border-blue-600'
                                  : comp.healthScore >= 60
                                  ? 'bg-amber-950 text-amber-300 border-amber-600'
                                  : 'bg-rose-950 text-rose-300 border-rose-600'
                              }`}
                            >
                              {comp.healthScore}% {comp.healthStatus}
                            </span>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px] text-slate-400 pt-1 border-t border-slate-850">
                          <div>
                            <span className="text-[9px] uppercase font-bold text-slate-500 block">{isHi ? 'निर्माता' : 'Manufacturer'}</span>
                            <span className="text-slate-200 truncate block">{comp.manufacturer}</span>
                          </div>
                          <div>
                            <span className="text-[9px] uppercase font-bold text-slate-500 block">{isHi ? 'चली दूरी (कि.मी.)' : 'Km Travelled'}</span>
                            <span className="text-cyan-400 font-mono">{comp.totalKmTravelled.toLocaleString()} km</span>
                          </div>
                          <div>
                            <span className="text-[9px] uppercase font-bold text-slate-500 block">{isHi ? 'पीओएच चक्र' : 'POH Cycles'}</span>
                            <span className="text-purple-400 font-mono">{comp.overhaulCount} Overhauls</span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-2 border-t border-slate-850">
                          <span className="font-mono text-[10px] text-slate-500 truncate max-w-[200px]">
                            {comp.qrCode}
                          </span>
                          <button
                            onClick={() => {
                              setUnassignTarget(comp);
                              setUnassignReason('Routine POH Service');
                              setUnassignTargetStatus('AVAILABLE_IN_STORES');
                            }}
                            className="px-2.5 py-1 bg-rose-950/60 hover:bg-rose-900 text-rose-300 border border-rose-800 rounded text-xs font-bold transition"
                          >
                            Unassign ↗
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>

            {/* Bogie 2 (Trailing) */}
            <div className="p-5 bg-slate-900/70 border border-slate-800 rounded-2xl space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-blue-400"></span>
                  <h4 className="text-sm font-extrabold text-white tracking-wide">
                    BOGIE 2 (Trailing Bogie)
                  </h4>
                </div>
                <button
                  onClick={() => openAssignModal('BOGIE_2')}
                  className="px-2.5 py-1 bg-blue-950 text-blue-300 border border-blue-800/80 hover:bg-blue-900 rounded-lg text-xs font-bold transition"
                >
                  + Mount to Bogie 2
                </button>
              </div>

              {wagonComponents.filter((c) => c.currentBogiePosition === 'BOGIE_2').length === 0 ? (
                <div className="p-8 text-center bg-slate-950/40 rounded-xl border border-dashed border-slate-800 text-slate-500 text-xs">
                  <p className="font-semibold text-slate-400">No Serialized Components Mounted to Bogie 2</p>
                  <p className="mt-1">Click &quot;Mount to Bogie 2&quot; or scan a component QR code.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {wagonComponents
                    .filter((c) => c.currentBogiePosition === 'BOGIE_2')
                    .map((comp) => (
                      <div
                        key={comp.id || comp.serialNumber}
                        className="p-4 bg-slate-950/80 border border-blue-900/40 hover:border-blue-500/40 rounded-xl space-y-2 transition shadow"
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-blue-300 text-sm">
                                {comp.serialNumber}
                              </span>
                              <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-slate-800 text-slate-300 border border-slate-700">
                                {comp.componentType}
                              </span>
                            </div>
                            <p className="text-xs text-slate-300 font-medium mt-0.5">{comp.partName}</p>
                          </div>

                          <div className="text-right">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-black border ${
                                comp.healthScore >= 90
                                  ? 'bg-emerald-950 text-emerald-300 border-emerald-600'
                                  : comp.healthScore >= 75
                                  ? 'bg-blue-950 text-blue-300 border-blue-600'
                                  : comp.healthScore >= 60
                                  ? 'bg-amber-950 text-amber-300 border-amber-600'
                                  : 'bg-rose-950 text-rose-300 border-rose-600'
                              }`}
                            >
                              {comp.healthScore}% {comp.healthStatus}
                            </span>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px] text-slate-400 pt-1 border-t border-slate-850">
                          <div>
                            <span className="text-[9px] uppercase font-bold text-slate-500 block">{isHi ? 'निर्माता' : 'Manufacturer'}</span>
                            <span className="text-slate-200 truncate block">{comp.manufacturer}</span>
                          </div>
                          <div>
                            <span className="text-[9px] uppercase font-bold text-slate-500 block">{isHi ? 'चली दूरी (कि.मी.)' : 'Km Travelled'}</span>
                            <span className="text-blue-400 font-mono">{comp.totalKmTravelled.toLocaleString()} km</span>
                          </div>
                          <div>
                            <span className="text-[9px] uppercase font-bold text-slate-500 block">{isHi ? 'पीओएच चक्र' : 'POH Cycles'}</span>
                            <span className="text-purple-400 font-mono">{comp.overhaulCount} Overhauls</span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-2 border-t border-slate-850">
                          <span className="font-mono text-[10px] text-slate-500 truncate max-w-[200px]">
                            {comp.qrCode}
                          </span>
                          <button
                            onClick={() => {
                              setUnassignTarget(comp);
                              setUnassignReason('Routine POH Service');
                              setUnassignTargetStatus('AVAILABLE_IN_STORES');
                            }}
                            className="px-2.5 py-1 bg-rose-950/60 hover:bg-rose-900 text-rose-300 border border-rose-800 rounded text-xs font-bold transition"
                          >
                            Unassign ↗
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>

            {/* Underframe & Body Assemblies */}
            <div className="lg:col-span-2 p-5 bg-slate-900/70 border border-slate-800 rounded-2xl space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-purple-400"></span>
                  <h4 className="text-sm font-extrabold text-white tracking-wide">{isHi ? 'अंडरफ्रेम, कपलर व ब्रेक असेंबली' : 'UNDERFRAME, COUPLERS & BRAKE ASSEMBLIES'}</h4>
                </div>
                <button
                  onClick={() => openAssignModal('UNDERFRAME')}
                  className="px-2.5 py-1 bg-purple-950 text-purple-300 border border-purple-800/80 hover:bg-purple-900 rounded-lg text-xs font-bold transition"
                >
                  + Mount to Underframe
                </button>
              </div>

              {wagonComponents.filter(
                (c) => c.currentBogiePosition === 'UNDERFRAME' || c.currentBogiePosition === 'BODY' || c.currentBogiePosition === 'NONE'
              ).length === 0 ? (
                <div className="p-8 text-center bg-slate-950/40 rounded-xl border border-dashed border-slate-800 text-slate-500 text-xs">
                  <p className="font-semibold text-slate-400">{isHi ? 'कोई ड्राफ्ट गियर, कपलर या वाल्व नहीं लगा' : 'No Draft Gears, Couplers, or Valves Mounted'}</p>
                  <p className="mt-1">Click &quot;Mount to Underframe&quot; or scan a component QR code.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {wagonComponents
                    .filter(
                      (c) =>
                        c.currentBogiePosition === 'UNDERFRAME' ||
                        c.currentBogiePosition === 'BODY' ||
                        c.currentBogiePosition === 'NONE'
                    )
                    .map((comp) => (
                      <div
                        key={comp.id || comp.serialNumber}
                        className="p-4 bg-slate-950/80 border border-purple-900/40 hover:border-purple-500/40 rounded-xl space-y-2 transition shadow"
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-purple-300 text-sm">
                                {comp.serialNumber}
                              </span>
                              <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-slate-800 text-slate-300 border border-slate-700">
                                {comp.componentType}
                              </span>
                            </div>
                            <p className="text-xs text-slate-300 font-medium mt-0.5">{comp.partName}</p>
                          </div>

                          <div className="text-right">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-black border ${
                                comp.healthScore >= 90
                                  ? 'bg-emerald-950 text-emerald-300 border-emerald-600'
                                  : comp.healthScore >= 75
                                  ? 'bg-blue-950 text-blue-300 border-blue-600'
                                  : comp.healthScore >= 60
                                  ? 'bg-amber-950 text-amber-300 border-amber-600'
                                  : 'bg-rose-950 text-rose-300 border-rose-600'
                              }`}
                            >
                              {comp.healthScore}%
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-2 border-t border-slate-850">
                          <span className="text-[11px] text-slate-400">
                            Position: <span className="text-slate-200 font-bold">{comp.currentBogiePosition}</span>
                          </span>
                          <button
                            onClick={() => {
                              setUnassignTarget(comp);
                              setUnassignReason('Routine POH Service');
                              setUnassignTargetStatus('AVAILABLE_IN_STORES');
                            }}
                            className="px-2.5 py-1 bg-rose-950/60 hover:bg-rose-900 text-rose-300 border border-rose-800 rounded text-xs font-bold transition"
                          >
                            Unassign ↗
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Component Passport QR Scanner Modal */}
      {isPassportScannerOpen && (
        <PassportQRScannerModal
          isOpen={isPassportScannerOpen}
          onClose={() => setIsPassportScannerOpen(false)}
          onComponentScanned={handlePassportQRScanned}
          title={`Mount Component to Wagon: ${wagonNumber}`}
        />
      )}

      {/* Mount Component Modal */}
      {assignModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-cyan-500/40 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white">
                Mount Serialized Component ({wagonNumber})
              </h3>
              <button
                onClick={() => setAssignModalOpen(false)}
                className="text-slate-400 hover:text-white font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAssignComponentSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">{isHi ? 'लक्ष्य बोगी स्थान' : 'Target Bogie Position'}</label>
                <select
                  value={assignBogiePos}
                  onChange={(e) => setAssignBogiePos(e.target.value as any)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white font-medium"
                >
                  <option value="BOGIE_1">Bogie 1 (Leading Bogie)</option>
                  <option value="BOGIE_2">Bogie 2 (Trailing Bogie)</option>
                  <option value="UNDERFRAME">{isHi ? 'अंडरफ्रेम व कपलर' : 'Underframe & Couplers'}</option>
                  <option value="BODY">{isHi ? 'वैगन बॉडी' : 'Wagon Body'}</option>
                  <option value="NONE">{isHi ? 'सामान्य स्थान' : 'General Placement'}</option>
                </select>
              </div>

              {storesAvailableComponents.length > 0 && (
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">{isHi ? 'उपलब्ध स्टोर्स डिपो स्टॉक से चुनें' : 'Select from Available Stores Depot Stock'}</label>
                  <select
                    onChange={(e) => setAssignSerialInput(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white font-mono"
                    defaultValue=""
                  >
                    <option value="">-- Choose available component --</option>
                    {storesAvailableComponents.map((c) => (
                      <option key={c.serialNumber} value={c.serialNumber}>
                        {c.serialNumber} - {c.partName} ({c.healthScore}%)
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Or Enter Serial Number Manually *</label>
                <input
                  type="text"
                  required
                  value={assignSerialInput}
                  onChange={(e) => setAssignSerialInput(e.target.value.toUpperCase())}
                  placeholder="e.g. WRS-WS-2026-001"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">{isHi ? 'स्थापना टिप्पणी' : 'Mounting Notes'}</label>
                <textarea
                  value={assignNotes}
                  onChange={(e) => setAssignNotes(e.target.value)}
                  placeholder={isHi ? 'स्थापना टिप्पणी, टॉर्क जाँच...' : 'Installation notes, torque check...'}
                  rows={2}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
                />
              </div>

              <div className="flex justify-between items-center pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setAssignModalOpen(false);
                    setIsPassportScannerOpen(true);
                  }}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-400 rounded-lg font-bold flex items-center gap-1"
                >
                  <span>📷</span>{isHi ? 'क्यूआर स्कैन करें' : 'Scan QR'}</button>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setAssignModalOpen(false)}
                    className="px-4 py-2 bg-slate-800 text-slate-300 rounded-lg font-bold"
                  >{isHi ? 'रद्द करें' : 'Cancel'}</button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-bold shadow"
                  >{isHi ? 'स्थापना की पुष्टि करें' : 'Confirm Mount'}</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Unassign Component Modal */}
      {unassignTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-amber-500/40 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white">
                Unassign Component: {unassignTarget.serialNumber}
              </h3>
              <button
                onClick={() => setUnassignTarget(null)}
                className="text-slate-400 hover:text-white font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleUnassignComponentSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">{isHi ? 'वापसी स्थिति' : 'Return Status'}</label>
                <select
                  value={unassignTargetStatus}
                  onChange={(e) => setUnassignTargetStatus(e.target.value as ComponentStatus)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
                >
                  <option value="AVAILABLE_IN_STORES">{isHi ? 'स्टोर्स डिपो (उपलब्ध)' : 'Stores Depot (Available)'}</option>
                  <option value="RECONDITIONED">{isHi ? 'पुनर्निर्मित' : 'Reconditioned'}</option>
                  <option value="UNDER_MAINTENANCE">Under Maintenance / Bay</option>
                  <option value="CONDEMNED">{isHi ? 'कंडम' : 'Condemned'}</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Reason for Removal *</label>
                <input
                  type="text"
                  required
                  value={unassignReason}
                  onChange={(e) => setUnassignReason(e.target.value)}
                  placeholder="e.g. Scheduled overhaul, flange wear..."
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setUnassignTarget(null)}
                  className="px-4 py-2 bg-slate-800 text-slate-300 rounded-lg font-bold"
                >{isHi ? 'रद्द करें' : 'Cancel'}</button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg font-bold shadow"
                >{isHi ? 'हटाने की पुष्टि करें' : 'Confirm Removal'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Photo Capture Modal */}
      {photoModalTarget && (
        <PhotoCaptureModal
          wagonNumber={wagonNumber}
          checklistItemId={photoModalTarget.itemId}
          category={photoModalTarget.category}
          partName={photoModalTarget.partName}
          stage={wagon?.currentStage}
          onClose={() => setPhotoModalTarget(null)}
          onUploaded={() => {
            setPhotoModalTarget(null);
            loadWagonData();
          }}
        />
      )}

      {/* Smart Vision AR & Caliper OCR Viewfinder Modal */}
      {smartVisionModalTarget && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-2 sm:p-4">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" onClick={() => setSmartVisionModalTarget(null)} />
          
          {/* Modal Container */}
          <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-700 shadow-2xl rounded-2xl overflow-hidden flex flex-col max-h-[95vh]">
            <CaliperCamera
              lang={lang || 'en'}
              wagonNumber={wagonNumber}
              bogieType={(wagon?.wagonType?.includes('HS') ? 'CASNUB_22_HS' : 'CASNUB_22_NLB') as BogieType}
              condition="USED"
              initialTarget={smartVisionModalTarget.initialTarget || 'OUTER_SPRING'}
              measuredHeight={null}
              onClose={() => setSmartVisionModalTarget(null)}
              onMeasurementChange={(height, _source, confidence) => {
                const componentType = smartVisionModalTarget.initialTarget || 'OUTER_SPRING';
                const bogieType = (wagon?.wagonType?.includes('HS') ? 'CASNUB_22_HS' : 'CASNUB_22_NLB') as BogieType;
                const verdict = computeComponentVerdict(componentType, height, bogieType, 'USED');
                handleSmartVisionMeasurementCaptured({
                  componentType,
                  measuredValue: height,
                  nominalValue: verdict.nominalValue,
                  delta: verdict.delta,
                  status: verdict.status,
                  band: verdict.band,
                  bandRoman: verdict.bandRoman,
                  toleranceRange: verdict.validRange,
                  confidence: confidence ?? 1.0,
                  tableReference: verdict.tableReference,
                  timestamp: new Date().toISOString()
                });
              }}
            />
          </div>
        </div>
      )}

      {/* Release Certificate Modal */}
      {showCertificateModal && (
        <ReleaseCertificateModal
          wagonNumber={wagonNumber}
          onClose={() => setShowCertificateModal(false)}
        />
      )}

      {/* Supervisor Override Modal */}
      {showOverrideModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-800 flex justify-between items-center bg-slate-850">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>⚙️</span> {t('actions.overrideStage')}
              </h3>
              <button
                onClick={() => setShowOverrideModal(false)}
                className="text-slate-400 hover:text-white p-1 text-lg"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleExecuteOverride} className="p-6 space-y-4">
              {overrideError && (
                <div className="p-3 bg-rose-950/40 border border-rose-800 rounded-lg text-rose-300 text-xs">
                  {overrideError}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">{isHi ? 'लक्ष्य चरण' : 'Target Stage'}</label>
                <select
                  value={overrideTargetStage}
                  onChange={(e) => setOverrideTargetStage(e.target.value as LifecycleStage)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-orange-500"
                >
                  {stageList.map((stg) => (
                    <option key={stg} value={stg}>
                      {stg.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Technical Justification (min 10 characters) *
                </label>
                <textarea
                  rows={3}
                  required
                  value={overrideJustification}
                  onChange={(e) => setOverrideJustification(e.target.value)}
                  placeholder={isHi ? 'ओवरराइड हेतु विस्तृत तकनीकी कारण दर्ज करें...' : 'Enter detailed technical justification for override...'}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">{isHi ? 'पर्यवेक्षक क्रिया ओटीपी' : 'Supervisor Action OTP'}</label>
                <input
                  type="text"
                  placeholder="e.g. 123456"
                  value={overrideOtp}
                  onChange={(e) => setOverrideOtp(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
                />
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowOverrideModal(false)}
                  className="px-4 py-2 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 text-xs font-semibold"
                >{isHi ? 'रद्द करें' : 'Cancel'}</button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold shadow-lg"
                >{isHi ? 'ओवरराइड की पुष्टि करें' : 'Confirm Override'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Supervisor Digital Sign-off Modal */}
      {showSignoffModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-800 flex justify-between items-center bg-slate-850">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>🛡️</span>{isHi ? 'पर्यवेक्षक डिजिटल विमुक्ति हस्ताक्षर' : 'Supervisor Digital Release Sign-off'}</h3>
              <button
                onClick={() => setShowSignoffModal(false)}
                className="text-slate-400 hover:text-white p-1 text-lg"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleGateSignoff} className="p-6 space-y-4">
              {signoffError && (
                <div className="p-3 bg-rose-950/40 border border-rose-800 rounded-lg text-rose-300 text-xs">
                  {signoffError}
                </div>
              )}

              <div className="p-3 bg-emerald-950/40 border border-emerald-800/60 rounded-xl text-xs text-emerald-300">
                ✓ Zero-defect verification cleared. Ready for cryptographic signing and release certificate issuance.
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">{isHi ? 'हस्ताक्षर टिप्पणी व प्रमाणपत्र नोट' : 'Sign-off Remarks & Certificate Notes'}</label>
                <textarea
                  rows={3}
                  value={signoffNotes}
                  onChange={(e) => setSignoffNotes(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">{isHi ? 'पर्यवेक्षक क्रिया ओटीपी टोकन' : 'Supervisor Action OTP Token'}</label>
                {/*
                  An enrolled supervisor uses the code on their own phone. The
                  inline flow below is the fallback for anyone not yet enrolled,
                  and it is worth being honest on screen about the difference:
                  a code the server hands you is a confirmation step, not a
                  second factor.
                */}
                {!signoffOtpToken ? (
                  totpEnrolled ? (
                    <div className="space-y-1.5">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={6}
                          placeholder={isHi ? 'ऐप का 6-अंकीय कोड' : '6-digit code from your app'}
                          value={signoffOtp}
                          onChange={(e) => setSignoffOtp(e.target.value.replace(/\D/g, ''))}
                          className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono tracking-widest focus:outline-none focus:border-emerald-500"
                        />
                        <button
                          type="button"
                          onClick={handleVerifyAuthenticator}
                          disabled={signoffOtpBusy || signoffOtp.trim().length !== 6}
                          className="px-4 py-2 rounded-lg border border-emerald-600 text-emerald-300 hover:bg-emerald-950 disabled:opacity-40 text-xs font-bold whitespace-nowrap"
                        >
                          {signoffOtpBusy ? '…' : (isHi ? 'सत्यापित करें' : 'Verify')}
                        </button>
                      </div>
                      <p className="text-[11px] text-emerald-400/80">
                        {isHi ? 'प्रमाणक ऐप से — इंटरनेट की आवश्यकता नहीं' : 'From your authenticator app — no network needed'}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          inputMode="numeric"
                          placeholder={isHi ? '6-अंकीय ओटीपी दर्ज करें' : 'Enter 6-digit OTP'}
                          value={signoffOtp}
                          onChange={(e) => setSignoffOtp(e.target.value)}
                          disabled={!signoffOtpId}
                          className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white disabled:opacity-50 focus:outline-none focus:border-emerald-500"
                        />
                        <button
                          type="button"
                          onClick={signoffOtpId ? handleVerifySignoffOtp : handleRequestSignoffOtp}
                          disabled={signoffOtpBusy}
                          className="px-4 py-2 rounded-lg border border-emerald-600 text-emerald-300 hover:bg-emerald-950 disabled:opacity-40 text-xs font-bold whitespace-nowrap"
                        >
                          {signoffOtpBusy
                            ? '…'
                            : signoffOtpId
                              ? (isHi ? 'ओटीपी सत्यापित करें' : 'Verify OTP')
                              : (isHi ? 'ओटीपी भेजें' : 'Send OTP')}
                        </button>
                      </div>
                      <p className="text-[11px] text-amber-400/90">
                        {isHi
                          ? 'कोई प्रमाणक सेट नहीं — यह कोड सर्वर देता है, इसलिए यह दूसरा प्रमाण नहीं है। खाता स्क्रीन से सेटअप करें।'
                          : 'No authenticator set up. This code is issued by the server, so it confirms intent but is not a second factor. Set one up from the User Accounts screen.'}
                      </p>
                    </div>
                  )
                ) : (
                  <p className="text-xs font-bold text-emerald-400">
                    {isHi ? '✓ सत्यापित' : '✓ Verified'}
                  </p>
                )}
              </div>

              {/*
                Advisory findings do not block release — the manual words the
                nest grouping rule as a recommendation. They do have to be
                accepted by name, so releasing a wagon with a mismatched nest
                is a decision on the record rather than something nobody read.
              */}
              {(gateStatus?.advisoryDetails || []).length > 0 && (
                <div className="rounded-lg border border-amber-700/60 bg-amber-950/30 p-3 space-y-2">
                  <p className="text-xs font-bold text-amber-300 uppercase tracking-wide">
                    {isHi ? 'सलाहकार निष्कर्ष — स्वीकृति आवश्यक' : 'Advisory findings — your acceptance required'}
                  </p>
                  <p className="text-[11px] text-amber-200/80">
                    {isHi
                      ? 'ये विमुक्ति को नहीं रोकते, पर प्रमाणपत्र पर आपके नाम से दर्ज होंगे।'
                      : 'These do not block release, but accepting them is recorded on the certificate in your name.'}
                  </p>
                  {(gateStatus?.advisoryDetails || []).map((a: any) => {
                    const checked = acknowledgedAdvisories.includes(a.id);
                    return (
                      <label key={a.id} className="flex gap-2 items-start text-xs text-amber-100 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setAcknowledgedAdvisories((prev) =>
                              checked ? prev.filter((x) => x !== a.id) : [...prev, a.id]
                            )
                          }
                          className="mt-0.5 shrink-0"
                        />
                        <span>
                          <span className="font-semibold">{a.partName}</span> — {a.description}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowSignoffModal(false)}
                  className="px-4 py-2 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 text-xs font-semibold"
                >{isHi ? 'रद्द करें' : 'Cancel'}</button>
                <button
                  type="submit"
                  disabled={
                    signoffSubmitting ||
                    !signoffOtpToken ||
                    (gateStatus?.advisoryDetails || []).some((a: any) => !acknowledgedAdvisories.includes(a.id))
                  }
                  className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-bold shadow-lg"
                >
                  {signoffSubmitting ? 'Signing...' : 'Authorize & Issue Certificate'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
