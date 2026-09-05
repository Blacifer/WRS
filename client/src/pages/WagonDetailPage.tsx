/**
 * Wagon Detail, 7-Stage Progression, CASNUB Checklist & Exit Gate Page
 * Indian Railways WRS Raipur (Phase 2 - R1, R2, R3, R5)
 */

import React, { useEffect, useState } from 'react';
import { api } from '../services/api.ts';
import { BanIcon, CaliperIcon, CameraIcon, ClipboardIcon, ClockIcon, CoilIcon, FileTextIcon, GearIcon, HeadphonesIcon, IdCardIcon, RefreshCwIcon, ShieldIcon, SparklesIcon, WindIcon, WrenchIcon } from '../components/Icons.tsx';
import { offlineDb } from '../services/offlineDb.ts';
import { useI18n } from '../i18n/index.ts';
import { PhotoCaptureModal } from '../components/PhotoCaptureModal.tsx';
import { PhotoGallery } from '../components/PhotoGallery.tsx';
import { ReleaseCertificateModal } from '../components/ReleaseCertificateModal.tsx';
import { SoundDiagnosticTool } from '../components/SoundDiagnosticTool.tsx';
import { VoiceInspectionToolbar } from '../components/VoiceInspectionToolbar.tsx';
import { CaliperCamera } from '../components/CaliperCamera.tsx';
import { readGatePanel } from '../services/gatePanel.ts';
import { readWagonProgress, canBulkClear } from '../services/wagonProgress.ts';
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
  /*
   * Which tab of THIS wagon, kept across a reload.
   *
   * The previous fix remembered the screen and the wagon and stopped there,
   * so opening Timeline, refreshing, and landing back on the checklist was
   * still exactly what happened — reported a second time, correctly. The tab
   * within the wagon is the part somebody is actually looking at.
   */
  const [activeTab, setActiveTab] = useState<'CHECKLIST' | 'GATE' | 'PHOTOS' | 'TIMELINE' | 'ACOUSTIC' | 'COMPONENTS' | 'SWT'>(() => {
    try {
      const saved = sessionStorage.getItem('wrs-wagon-tab');
      const known = ['CHECKLIST', 'GATE', 'PHOTOS', 'TIMELINE', 'ACOUSTIC', 'COMPONENTS', 'SWT'];
      if (saved && known.includes(saved)) return saved as any;
    } catch { /* private windows fall through to the checklist */ }
    return 'CHECKLIST';
  });

  useEffect(() => {
    try { sessionStorage.setItem('wrs-wagon-tab', activeTab); } catch { /* not worth an error */ }
  }, [activeTab]);

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

  // Camera-and-caliper modal state
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
  // Shown to the signer, never written into the field for them — releasing a
  // wagon should take a deliberate act.
  const [shownSignoffOtp, setShownSignoffOtp] = useState<string | null>(null);
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
  // Compared after normalising, like everywhere else. This line alone checked
  // only the uppercase spellings while AnalyticsPage and InspectionPage
  // checked both, so a user stored as "Supervisor" lost their supervisor
  // controls on this page and kept them on the other two.
  const normalisedRole = (user?.role || '').trim().toUpperCase();
  const isSupervisor = normalisedRole === 'SUPERVISOR' || normalisedRole === 'ADMIN';

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
        /*
         * Sent as typed, with no fallback.
         *
         * This read `overrideOtp || 'test_token_override'`, so leaving the
         * field blank quietly submitted a bypass token meant for the test
         * suite — clearing the supervisor gate on the one action that exists
         * to move a wagon past the rules. The same fallback was removed from
         * the release-signoff path already; this second copy was missed.
         */
        otpToken: overrideOtp || ''
      });
      setShowOverrideModal(false);
      loadWagonData();
    } catch (err: any) {
      setOverrideError(err.message || 'Override failed');
    }
  };

  /*
   * The reason a part was condemned.
   *
   * There was nowhere to type one. The status went to the server on its own,
   * so a condemnation carried a verdict and no evidence — while the database,
   * the API and the offline sync had all carried a notes field the whole
   * time, and the sync-conflict message quotes it back at people ("was
   * condemned by ... "). A supervisor could read the reason in a refusal they
   * had never been able to write.
   *
   * The verdict is saved first and the note second, so a spring is never held
   * hostage to somebody finishing a sentence — which on a shop floor is how
   * notes stop being written at all.
   */
  const [noteDraft, setNoteDraft] = useState<{ itemId: string; text: string } | null>(null);

  const saveNote = async (item: ChecklistItem, text: string) => {
    const trimmed = text.trim();
    setNoteDraft(null);
    if (!trimmed) return;
    try {
      if (navigator.onLine) {
        await api.updateChecklistItem(wagonNumber, item.id, { conditionNotes: trimmed });
      } else {
        await offlineDb.enqueueChecklistItem({
          wagonNumber,
          category: item.category,
          partName: item.partName,
          bogiePosition: item.bogiePosition,
          status: item.status,
          conditionNotes: trimmed
        });
      }
      loadWagonData();
    } catch {
      // The verdict is already recorded; a failed note must not undo it.
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
      // A verdict against the part needs a reason with it. Asked for only on
      // the verdicts where "why" is the whole point.
      if (newStatus === 'CONDEMNED' || newStatus === 'FAIL') {
        setNoteDraft({ itemId: item.id, text: '' });
      }
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
      // Shown, never filled in. Releasing a wagon should take a deliberate
      // act, and a pre-filled box is not one.
      if (res.devOtpCode) setShownSignoffOtp(res.devOtpCode);
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
          /*
             * What the record says happened.
             *
             * This wrote "Out of tolerance via Smart Vision AR" into the
             * stored note — a marketing name, for a camera reading four
             * digits off a caliper's own display, in an append-only record
             * somebody may have to defend to an auditor. The person still
             * took the measurement; the camera only read it.
             */
            damageNotes: measurement.status === 'CONDEMNED'
              ? 'Out of tolerance — caliper reading captured by camera'
              : undefined,
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
            partName: `${partName} (caliper read by camera)`,
            stage: wagon.currentStage,
            imageBase64: measurement.snapshotBase64,
            tags: ['SmartVision', 'AR_Caliper', measurement.status, measurement.componentType]
          });
        } else {
          await offlineDb.enqueuePhoto({
            wagonNumber,
            category: category as any,
            partName: `${partName} (caliper read by camera)`,
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
      <div className="text-center py-20 bg-card rounded-card border border-line text-ink-muted">
        <div className="w-8 h-8 border-2 border-accent-line border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
        <p className="text-sm">Loading wagon {wagonNumber}...</p>
      </div>
    );
  }

  // Derived in wagonProgress.ts, where it is tested. These were inline string
  // comparisons; the release stage in particular is RELEASE and not RELEASED,
  // and getting that wrong shows a released wagon as still in progress with no
  // error anywhere.
  const progress = readWagonProgress(wagon, checklist);
  const currentStageIndex = progress.currentStageIndex;
  const isReleased = progress.isReleased;
  const pendingCount = progress.pendingCount;

  const handleBulkClear = async () => {
    // The server enforces the same minimum; this is here to avoid a pointless
    // round trip and to be able to say why.
    if (!canBulkClear(bulkAttestation, pendingCount).allowed) return;
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
  const isQCGate = progress.isAtQcGate;

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <div className="bg-card border border-line rounded-card p-6 space-y-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <button
              onClick={onBack}
              className="text-xs font-semibold text-accent-ink hover:text-accent-ink flex items-center gap-1 mb-2"
            >
              ← Back to Wagons List
            </button>
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-extrabold text-white">{wagon?.wagonNumber}</h2>
              <span className="px-3 py-1 bg-raised border border-line rounded-control text-xs font-bold text-ink-body">
                {wagon?.wagonType}
              </span>
              <span className="px-3 py-1 bg-raised border border-line rounded-control text-xs font-bold text-ink-body">
                {wagon?.owningRailway}
              </span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-3">
            {isReleased ? (
              <button
                onClick={() => setShowCertificateModal(true)}
                className="px-5 py-2.5 bg-good hover:bg-good text-white rounded-control text-xs font-bold shadow-emerald-600/30 transition flex items-center gap-2 min-h-[48px]"
              >
                <FileTextIcon size={16} /> {t('actions.viewCertificate')}
              </button>
            ) : isQCGate ? (
              <button
                onClick={() => {
                  setActiveTab('GATE');
                  if (gateStatus?.canRelease) {
                    setShowSignoffModal(true);
                  }
                }}
                className={`px-6 py-2.5 rounded-control text-xs font-bold transition-colors flex items-center gap-2 min-h-[48px] border ${
                  gateStatus?.canRelease
                    ? 'bg-good hover:bg-good-ink border-good text-page'
                    : 'bg-accent hover:bg-accent-hover border-accent-hover text-white'
                }`}
              >
                <ShieldIcon size={16} /> {t('actions.signoffRelease')}
              </button>
            ) : (
              <button
                onClick={handleNextStage}
                className="px-6 py-2.5 bg-accent hover:bg-accent-hover text-white rounded-control text-xs font-bold  transition flex items-center gap-2 min-h-[48px]"
              >
                Advance to Next Stage →
              </button>
            )}

            {isSupervisor && !isReleased && (
              <button
                onClick={() => setShowOverrideModal(true)}
                className="px-4 py-2.5 bg-raised hover:bg-selected text-warn-ink border border-warn-line rounded-control text-xs font-bold transition flex items-center gap-1.5 min-h-[48px]"
              >
                <GearIcon size={16} /> {t('actions.overrideStage')}
              </button>
            )}
          </div>
        </div>

        {/* 7-Stage Horizontal Stepper */}
        <div className="pt-4 border-t border-line">
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
                        ? 'bg-accent border-accent-line text-white ring-4 ring-accent-hover'
                        : isPast
                        ? 'bg-good border-good-line text-white'
                        : 'bg-raised border-line text-ink-faint'
                    }`}
                  >
                    {isPast ? '✓' : idx + 1}
                  </div>
                  <span
                    className={`text-[10px] font-semibold truncate w-full ${
                      isCurrent ? 'text-accent-ink' : isPast ? 'text-ink-body' : 'text-ink-faint'
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
      <div className="flex border-b border-line gap-6">
        <button
          onClick={() => setActiveTab('CHECKLIST')}
          className={`pb-3 text-sm font-bold transition border-b-2 flex items-center gap-2 ${
            activeTab === 'CHECKLIST'
              ? 'border-accent-line text-accent-ink'
              : 'border-transparent text-ink-muted hover:text-ink-body'
          }`}
        >
          <ClipboardIcon size={16} /> {t('checklist.title')}
        </button>

        <button
          onClick={() => setActiveTab('GATE')}
          className={`pb-3 text-sm font-bold transition border-b-2 flex items-center gap-2 ${
            activeTab === 'GATE'
              ? 'border-accent-line text-accent-ink'
              : 'border-transparent text-ink-muted hover:text-ink-body'
          }`}
        >
          <ShieldIcon size={16} /> {t('exitGate.title')}
          {gateStatus && !gateStatus.canRelease && (
            <span className="w-2 h-2 rounded-full bg-bad animate-pulse"></span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('PHOTOS')}
          className={`pb-3 text-sm font-bold transition border-b-2 flex items-center gap-2 ${
            activeTab === 'PHOTOS'
              ? 'border-accent-line text-accent-ink'
              : 'border-transparent text-ink-muted hover:text-ink-body'
          }`}
        >
          <CameraIcon size={16} /> {t('photos.title')} ({photos.length})
        </button>

        <button
          onClick={() => setActiveTab('TIMELINE')}
          className={`pb-3 text-sm font-bold transition border-b-2 flex items-center gap-2 ${
            activeTab === 'TIMELINE'
              ? 'border-accent-line text-accent-ink'
              : 'border-transparent text-ink-muted hover:text-ink-body'
          }`}
        >
          <ClockIcon size={16} />{isHi ? 'समयरेखा व ठहराव अवधि' : 'Timeline & Dwell Times'}</button>



        <button
          onClick={() => setActiveTab('SWT')}
          className={`pb-3 text-sm font-bold transition border-b-2 flex items-center gap-2 ${
            activeTab === 'SWT'
              ? 'border-accent-line text-accent-ink'
              : 'border-transparent text-ink-muted hover:text-ink-body'
          }`}
        >
          <WindIcon size={16} />{isHi ? 'एकल वैगन परीक्षण (वायु ब्रेक)' : 'Single Wagon Test (Air Brake)'}
        </button>

        <button
          onClick={() => setActiveTab('ACOUSTIC')}
          className={`pb-3 text-sm font-bold transition border-b-2 flex items-center gap-2 ${
            activeTab === 'ACOUSTIC'
              ? 'border-accent-line text-accent-ink'
              : 'border-transparent text-ink-muted hover:text-ink-body'
          }`}
        >
          <HeadphonesIcon size={16} /> {t('acoustic.title', 'Acoustic Diagnostics')}
        </button>

        <button
          onClick={() => setActiveTab('COMPONENTS')}
          className={`pb-3 text-sm font-bold transition border-b-2 flex items-center gap-2 ${
            activeTab === 'COMPONENTS'
              ? 'border-accent-line text-accent-ink'
              : 'border-transparent text-ink-muted hover:text-ink-body'
          }`}
        >
          <IdCardIcon size={16} /> Serialized Passports ({wagonComponents.length})
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
            <div className="bg-card border border-accent-line rounded-card p-5 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h4 className="text-sm font-bold text-white flex items-center gap-2">
                    <SparklesIcon size={16} /> {isHi ? 'अपवाद द्वारा निरीक्षण' : 'Inspect by Exception'}
                  </h4>
                  <p className="text-[11px] text-ink-muted mt-1 max-w-xl leading-relaxed">
                    {isHi
                      ? `${pendingCount} मद अभी लंबित हैं। पहले ऊपर कोई भी दोषपूर्ण मद दर्ज करें, फिर शेष को एक ही क्रिया में सेवा-योग्य घोषित करें। स्प्रिंग तथा कोई भी दर्ज FAIL या CONDEMNED निर्णय कभी प्रभावित नहीं होते।`
                      : `${pendingCount} item${pendingCount === 1 ? '' : 's'} still pending. Log anything defective above first, then declare the remainder serviceable in one action. Springs and any recorded FAIL or CONDEMNED verdict are never affected.`}
                  </p>
                </div>
                {!showBulkPanel && (
                  <button
                    onClick={() => setShowBulkPanel(true)}
                    className="min-h-[44px] px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-control text-xs font-bold border border-accent-line transition shrink-0"
                  >
                    {isHi ? `शेष ${pendingCount} पूर्ण करें` : `Clear ${pendingCount} Remaining`}
                  </button>
                )}
              </div>

              {showBulkPanel && (
                <div className="space-y-3 pt-2 border-t border-line">
                  <label className="block">
                    <span className="text-[11px] font-bold text-ink-body">
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
                      className="mt-1.5 w-full bg-page border border-line rounded-control px-3 py-2 text-xs text-white placeholder-slate-600 focus:border-accent-line focus:outline-none"
                    />
                  </label>
                  <p className="text-[10px] text-warn-ink/90 leading-relaxed">
                    {isHi
                      ? 'यह प्रत्येक प्रभावित मद पर आपके नाम सहित दर्ज होता है और ऑडिट लॉग में लिखा जाता है। केवल वही घोषित करें जिसका आपने वास्तव में निरीक्षण किया है।'
                      : 'This is recorded against your name on every affected item and written to the audit log. Only declare what you actually inspected.'}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={handleBulkClear}
                      disabled={bulkAttestation.trim().length < 10 || isBulkClearing}
                      className="min-h-[44px] px-4 py-2 bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-control text-xs font-bold transition"
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
                      className="min-h-[44px] px-4 py-2 bg-raised hover:bg-selected text-ink-body rounded-control text-xs font-bold border border-line transition"
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
                  className={`min-h-tap px-4 py-2 rounded-control text-sm font-semibold transition-colors flex items-center gap-2 ${
                    isSelected
                      ? 'bg-selected text-ink'
                      : 'bg-transparent text-ink-muted hover:text-ink'
                  }`}
                >
                  <span>{t(`checklist.categories.${catKey}` as any) || catKey}</span>
                  {hasCondemned && <span className="w-2 h-2 rounded-full bg-bad"></span>}
                </button>
              );
            })}
          </div>

          {/* Spring Sync Banner for Category 1 */}
          {selectedCategory === 'SPRINGS' && (
            <div className="bg-accent-soft border border-accent-line p-4 rounded-control flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs text-accent-ink">
              <div className="flex items-center gap-3">
                <RefreshCwIcon size={24} className="text-ink-muted" />
                <div>
                  <p className="font-bold">{t('checklist.springSyncNotice')}</p>
                  <p className="text-[11px] text-accent-ink mt-0.5">
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
                className="min-h-[44px] px-4 py-2 bg-accent hover:bg-accent text-white rounded-control text-xs font-bold transition flex items-center gap-2 shrink-0 shadow-md"
              >
                <CaliperIcon size={16} /> {t('actions.openArCaliper') || 'Read the caliper'}
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
                          <span className="px-2 py-0.5 bg-bad-soft text-bad-ink border border-bad-line rounded text-[9px] font-extrabold tracking-wider">
                            {isHi ? 'अनिवार्य' : 'MANDATORY'}
                          </span>
                        )}
                        {item.bogiePosition && item.bogiePosition !== 'NONE' && (
                          <span className="text-[10px] text-ink-muted bg-raised px-2 py-0.5 rounded">
                            {item.bogiePosition}
                          </span>
                        )}
                      </div>
                      {item.conditionNotes && (
                        <p className="text-xs text-ink-muted italic">“{item.conditionNotes}”</p>
                      )}
                      {/* Appears the moment something is condemned or failed.
                          Not a modal: the verdict is already saved, so this can
                          be ignored without losing anything, and typing here
                          never blocks the next part. */}
                      {noteDraft?.itemId === item.id && (
                        <div className="flex flex-wrap items-center gap-2 mt-2">
                          <input
                            autoFocus
                            data-testid="condemn-note"
                            value={noteDraft.text}
                            onChange={(e) => setNoteDraft({ itemId: item.id, text: e.target.value })}
                            onKeyDown={(e) => { if (e.key === 'Enter') saveNote(item, noteDraft.text); }}
                            placeholder={isHi ? 'क्या दिखा? जैसे “दूसरे कॉइल पर दरार”' : 'What did you see? e.g. “crack near second coil”'}
                            className="flex-1 min-w-[240px] min-h-[44px] bg-raised border border-warn-line rounded-control px-3 text-sm text-white"
                          />
                          <button
                            onClick={() => saveNote(item, noteDraft.text)}
                            className="min-h-[44px] px-4 rounded-control bg-white text-black text-xs font-extrabold"
                          >
                            {isHi ? 'सहेजें' : 'Save reason'}
                          </button>
                          <button
                            onClick={() => setNoteDraft(null)}
                            className="min-h-[44px] px-3 rounded-control border border-line text-ink-muted text-xs font-bold"
                          >
                            {isHi ? 'छोड़ें' : 'Skip'}
                          </button>
                        </div>
                      )}
                      {/* A measurement that condemns a part somebody recorded
                          as serviceable. It is deliberately not applied — a
                          person who looked at the part is not overruled by a
                          number — but it blocks release, and this is the
                          screen where it can actually be reconciled. */}
                      {(item as any).measurementConflict && (
                        <p
                          data-testid="measurement-conflict"
                          className="text-xs text-warn-ink bg-warn-soft border border-warn-line rounded-md px-2 py-1.5 mt-1"
                        >
                          <b>{isHi ? 'मापन असहमत' : 'The measurement disagrees'}:</b>{' '}
                          {(item as any).measurementConflict.reason}
                        </p>
                      )}
                      {item.repairAction && (
                        <p className="text-xs text-good-ink">
                          <WrenchIcon size={13} className="inline align-[-2px] mr-1" />Action: {item.repairAction} ({item.repairNotes})
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
                                  ? 'bg-good-soft border-good-line text-good-ink'
                                  : st === 'FAIL' || st === 'CONDEMNED'
                                  ? 'bg-bad-soft border-bad-line text-bad-ink'
                                  : 'bg-white/10 border-white/20 text-white'
                                : 'bg-transparent border-transparent text-neutral-500 hover:text-neutral-300 hover:border-white/10'
                            }`}
                          >
                            {st}
                          </button>
                        );
                      })}

                      {/* Camera-reads-the-caliper button — only for items with a real digital tolerance spec */}
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
                          className="min-h-[48px] px-3 py-2 bg-accent-soft hover:bg-accent-soft border border-accent-line rounded-control text-xs text-accent-ink font-bold transition flex items-center gap-1.5 shadow-sm"
                          title="Read the caliper with the camera"
                        >
                          <SparklesIcon size={15} />
                          <span className="hidden sm:inline">{t('actions.smartVision') || 'Measure'}</span>
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
                        className="min-h-[48px] min-w-[48px] px-3 py-2 bg-raised hover:bg-selected border border-line rounded-control text-xs text-ink-body font-bold transition flex items-center justify-center"
                        title="Attach Photo Evidence"
                        aria-label="Attach Photo Evidence"
                      >
                        <CameraIcon size={18} />
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

      {/* Tab 2: Zero-Defect Exit Gate
          The readings below come from readGatePanel rather than being derived
          inline: this is the panel a supervisor reads before releasing a wagon,
          and the rules behind it belong somewhere they can be tested. */}
      {activeTab === 'GATE' && gateStatus && (() => {
        const gatePanel = readGatePanel(gateStatus, wagon, { isReleased });
        return (
        <div className="space-y-6">
          {/* Gate Overview Status Card */}
          <div
            className={`border rounded-card p-6 space-y-4 ${
              gateStatus.canRelease
                ? 'bg-good-soft border-good-line'
                : 'bg-bad-soft border-bad-line'
            }`}
          >
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <span
                  className={`px-3 py-1 rounded-full text-xs font-extrabold tracking-wider ${
                    gateStatus.canRelease
                      ? 'bg-good text-white'
                      : 'bg-bad text-white animate-pulse'
                  }`}
                >
                  {gatePanel.headline}
                </span>
                <h3 className="text-xl font-extrabold text-white mt-2">{t('exitGate.title')}</h3>
                <p className="text-xs text-ink-body mt-1">
                  {gateStatus.canRelease
                    ? 'All 4 verification tiers satisfied. Ready for supervisor digital sign-off.'
                    : 'Active quality blockers detected. Wagon cannot be certified or released until all blockers are resolved.'}
                </p>
              </div>

              {gatePanel.offerSignoff && (
                <button
                  onClick={() => setShowSignoffModal(true)}
                  className="px-6 py-3 bg-good hover:bg-good text-white rounded-control text-sm font-bold shadow-emerald-600/30 transition min-h-[48px] flex items-center gap-2"
                >
                  <ShieldIcon size={16} /> {t('exitGate.signAndReleaseBtn')}
                </button>
              )}
            </div>

            {/* 4-Tier Diagnostics Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-4 border-t border-line">
              <div className="bg-card p-4 rounded-control border border-line">
                <p className="text-[11px] text-ink-muted font-semibold">{t('exitGate.rule1')}</p>
                <p className="text-lg font-extrabold text-white mt-1">
                  {gatePanel.tiers[0].value}
                </p>
              </div>

              <div className="bg-card p-4 rounded-control border border-line">
                <p className="text-[11px] text-ink-muted font-semibold">{t('exitGate.rule2')}</p>
                <p className="text-lg font-extrabold text-white mt-1">
                  {gatePanel.tiers[1].value}
                </p>
              </div>

              <div className="bg-card p-4 rounded-control border border-line">
                <p className="text-[11px] text-ink-muted font-semibold">{t('exitGate.rule3')}</p>
                <p className="text-lg font-extrabold text-white mt-1">
                  {gatePanel.tiers[2].value}
                </p>
              </div>

              <div className="bg-card p-4 rounded-control border border-line">
                <p className="text-[11px] text-ink-muted font-semibold">{t('exitGate.rule4')}</p>
                <p className="text-lg font-extrabold text-white mt-1">
                  {gatePanel.tiers[3].value}
                </p>
              </div>
            </div>
          </div>

          {/* Active Blockers Breakdown */}
          {gateStatus.blockers && gateStatus.blockers.length > 0 && (
            <div className="bg-card border border-line rounded-card p-6 space-y-4">
              <h4 className="text-sm font-bold text-bad-ink flex items-center gap-2">
                <BanIcon size={16} /> {t('exitGate.activeBlockers')} ({gateStatus.blockers.length})
              </h4>
              <div className="space-y-2">
                {gateStatus.blockers.map((b: string, idx: number) => (
                  <div
                    key={idx}
                    className="p-3 bg-bad-soft border border-bad-line rounded-control text-xs text-bad-ink flex items-start gap-2.5"
                  >
                    <span className="text-bad-ink font-bold">•</span>
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
            <div className="bg-card border border-warn-line rounded-card p-6 space-y-4">
              <div>
                <h4 className="text-sm font-bold text-warn-ink flex items-center gap-2">
                  <CoilIcon size={16} />{' '}
                  {isHi ? 'स्प्रिंग नेस्ट समूहन' : 'Spring Nest Grouping'} ({gateStatus.advisories.length})
                </h4>
                <p className="text-[11px] text-ink-muted mt-1.5 leading-relaxed">
                  {isHi
                    ? 'केवल सलाहकारी — विमुक्ति नहीं रोकता। एक नेस्ट की सभी स्प्रिंग एक ही 3 मि.मी. बैंड में होनी चाहिए ताकि भार समान रूप से बँटे, भले ही प्रत्येक स्प्रिंग अलग-अलग उत्तीर्ण हो।'
                    : 'Advisory only — does not block release. Springs in one nest should sit within a single 3 mm band so they share load evenly, even when each spring passes on its own.'}
                </p>
              </div>
              <div className="space-y-2">
                {gateStatus.advisories.map((a: string, idx: number) => (
                  <div
                    key={idx}
                    className="p-3 bg-warn-soft border border-warn-line rounded-control text-xs text-warn-ink flex items-start gap-2.5"
                  >
                    <span className="text-warn-ink font-bold">•</span>
                    <span>{a}</span>
                  </div>
                ))}
              </div>

              {/* Per-group breakdown so the inspector can see which nest to re-group */}
              {Array.isArray(gateStatus.summary?.springNestCheck?.groups) &&
                gateStatus.summary.springNestCheck.groups.length > 0 && (
                  <div className="pt-3 border-t border-line space-y-1.5">
                    {gateStatus.summary.springNestCheck.groups.map((g: any) => (
                      <div
                        key={g.groupKey}
                        className="flex items-center justify-between gap-3 text-[11px] px-3 py-2 rounded-control bg-page border border-line"
                      >
                        <span className="font-bold text-ink-body">{g.groupKey}</span>
                        <span className="text-ink-muted tabular-nums">
                          {g.springCount} {isHi ? 'स्प्रिंग' : `spring${g.springCount === 1 ? '' : 's'}`} ·{' '}
                          {g.minHeight?.toFixed(1)}–{g.maxHeight?.toFixed(1)} mm
                        </span>
                        <span
                          className={`font-extrabold px-2 py-0.5 rounded ${
                            g.isMatched
                              ? 'text-good-ink bg-good-soft'
                              : 'text-warn-ink bg-warn-soft'
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
        );
      })()}

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
        <div className="bg-card border border-line rounded-card p-6 space-y-6">
          <h4 className="text-sm font-bold text-white flex items-center gap-2">
            <ClockIcon size={16} />{isHi ? 'कालानुक्रमिक चरण इतिहास व ठहराव अवधि' : 'Chronological Transition History & Dwell Times'}</h4>

          <div className="space-y-4">
            {timeline.map((tr, idx) => (
              <div
                key={tr.id || idx}
                className="p-4 bg-raised border border-line rounded-control space-y-2"
              >
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-white">
                      {tr.fromStage} → {tr.toStage}
                    </span>
                    {tr.isOverride && (
                      <span className="px-2 py-0.5 bg-warn-soft text-warn-ink border border-warn-line rounded text-[9px] font-bold">
                        {isHi ? 'ओवरराइड' : 'OVERRIDE'}
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-ink-muted">
                    {new Date(tr.timestamp).toLocaleString()}
                  </span>
                </div>

                <div className="text-xs text-ink-muted flex justify-between items-center">
                  <span>
                    By: {tr.performerName} ({tr.performerRole})
                  </span>
                  {tr.durationInStageHours !== undefined && (
                    <span className="font-mono text-accent-ink">Dwell: {tr.durationInStageHours}h</span>
                  )}
                </div>

                {tr.overrideReason && (
                  <p className="text-xs text-warn-ink/90 bg-warn-soft p-2 rounded border border-warn-line">
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
        <div className="bg-card border border-line rounded-card p-5">
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
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-5 bg-card border border-line rounded-card">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-control bg-accent-soft border border-accent-line flex items-center justify-center text-accent-ink shrink-0">
                <IdCardIcon size={20} />
              </div>
              <div>
                <h3 className="text-base sm:text-lg font-extrabold text-white">
                  Serialized Component Passports ({wagonNumber})
                </h3>
                <p className="text-xs text-ink-muted">
                  Track serialized wheelsets, CTRB bearings, draft gears, and bolsters assigned to bogie positions
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                onClick={() => setIsPassportScannerOpen(true)}
                className="flex-1 sm:flex-none px-3.5 py-2 bg-accent hover:bg-accent-hover border border-accent-hover text-white font-bold text-xs rounded-control transition-colors flex items-center justify-center gap-1.5"
              >
                <CameraIcon size={15} />
                <span>{isHi ? 'लगाने हेतु क्यूआर स्कैन करें' : 'Scan QR to Mount'}</span>
              </button>
              <button
                onClick={() => openAssignModal('BOGIE_1')}
                className="flex-1 sm:flex-none px-3.5 py-2 bg-raised hover:bg-selected text-ink-body font-bold text-xs rounded-control border border-line transition flex items-center justify-center gap-1.5"
              >
                <span>+</span>
                <span>{isHi ? 'घटक लगाएँ' : 'Mount Component'}</span>
              </button>
            </div>
          </div>

          {/* Bogie Positions Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Bogie 1 (Leading) */}
            <div className="p-5 bg-card border border-line rounded-card space-y-4">
              <div className="flex items-center justify-between border-b border-line pb-3">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-accent"></span>
                  <h4 className="text-sm font-extrabold text-white tracking-wide">
                    BOGIE 1 (Leading Bogie)
                  </h4>
                </div>
                <button
                  onClick={() => openAssignModal('BOGIE_1')}
                  className="px-2.5 py-1 bg-accent-soft text-accent-ink border border-accent-line hover:bg-accent-soft rounded-control text-xs font-bold transition"
                >
                  + Mount to Bogie 1
                </button>
              </div>

              {wagonComponents.filter((c) => c.currentBogiePosition === 'BOGIE_1').length === 0 ? (
                <div className="p-8 text-center bg-page rounded-control border border-dashed border-line text-ink-faint text-xs">
                  <p className="font-semibold text-ink-muted">No Serialized Components Mounted to Bogie 1</p>
                  <p className="mt-1">Click &quot;Mount to Bogie 1&quot; or scan a component QR code.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {wagonComponents
                    .filter((c) => c.currentBogiePosition === 'BOGIE_1')
                    .map((comp) => (
                      <div
                        key={comp.id || comp.serialNumber}
                        className="p-4 bg-page border border-accent-line hover:border-accent-line rounded-control space-y-2 transition shadow"
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-accent-ink text-sm">
                                {comp.serialNumber}
                              </span>
                              <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-raised text-ink-body border border-line">
                                {comp.componentType}
                              </span>
                            </div>
                            <p className="text-xs text-ink-body font-medium mt-0.5">{comp.partName}</p>
                          </div>

                          <div className="text-right">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold border ${
                                comp.healthScore >= 90
                                  ? 'bg-good-soft text-good-ink border-good-line'
                                  : comp.healthScore >= 75
                                  ? 'bg-accent-soft text-accent-ink border-accent-line'
                                  : comp.healthScore >= 60
                                  ? 'bg-warn-soft text-warn-ink border-warn-line'
                                  : 'bg-bad-soft text-bad-ink border-bad-line'
                              }`}
                            >
                              {comp.healthScore}% {comp.healthStatus}
                            </span>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px] text-ink-muted pt-1 border-t border-slate-850">
                          <div>
                            <span className="text-[9px] uppercase font-bold text-ink-faint block">{isHi ? 'निर्माता' : 'Manufacturer'}</span>
                            <span className="text-ink-body truncate block">{comp.manufacturer}</span>
                          </div>
                          <div>
                            <span className="text-[9px] uppercase font-bold text-ink-faint block">{isHi ? 'चली दूरी (कि.मी.)' : 'Km Travelled'}</span>
                            <span className="text-accent-ink font-mono">{comp.totalKmTravelled.toLocaleString()} km</span>
                          </div>
                          <div>
                            <span className="text-[9px] uppercase font-bold text-ink-faint block">{isHi ? 'पीओएच चक्र' : 'POH Cycles'}</span>
                            <span className="text-accent-ink font-mono">{comp.overhaulCount} Overhauls</span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-2 border-t border-slate-850">
                          <span className="font-mono text-[10px] text-ink-faint truncate max-w-[200px]">
                            {comp.qrCode}
                          </span>
                          <button
                            onClick={() => {
                              setUnassignTarget(comp);
                              setUnassignReason('Routine POH Service');
                              setUnassignTargetStatus('AVAILABLE_IN_STORES');
                            }}
                            className="px-2.5 py-1 bg-bad-soft hover:bg-bad-soft text-bad-ink border border-bad-line rounded text-xs font-bold transition"
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
            <div className="p-5 bg-card border border-line rounded-card space-y-4">
              <div className="flex items-center justify-between border-b border-line pb-3">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-blue-400"></span>
                  <h4 className="text-sm font-extrabold text-white tracking-wide">
                    BOGIE 2 (Trailing Bogie)
                  </h4>
                </div>
                <button
                  onClick={() => openAssignModal('BOGIE_2')}
                  className="px-2.5 py-1 bg-accent-soft text-accent-ink border border-accent-line hover:bg-accent-soft rounded-control text-xs font-bold transition"
                >
                  + Mount to Bogie 2
                </button>
              </div>

              {wagonComponents.filter((c) => c.currentBogiePosition === 'BOGIE_2').length === 0 ? (
                <div className="p-8 text-center bg-page rounded-control border border-dashed border-line text-ink-faint text-xs">
                  <p className="font-semibold text-ink-muted">No Serialized Components Mounted to Bogie 2</p>
                  <p className="mt-1">Click &quot;Mount to Bogie 2&quot; or scan a component QR code.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {wagonComponents
                    .filter((c) => c.currentBogiePosition === 'BOGIE_2')
                    .map((comp) => (
                      <div
                        key={comp.id || comp.serialNumber}
                        className="p-4 bg-page border border-accent-line hover:border-accent-line rounded-control space-y-2 transition shadow"
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-accent-ink text-sm">
                                {comp.serialNumber}
                              </span>
                              <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-raised text-ink-body border border-line">
                                {comp.componentType}
                              </span>
                            </div>
                            <p className="text-xs text-ink-body font-medium mt-0.5">{comp.partName}</p>
                          </div>

                          <div className="text-right">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold border ${
                                comp.healthScore >= 90
                                  ? 'bg-good-soft text-good-ink border-good-line'
                                  : comp.healthScore >= 75
                                  ? 'bg-accent-soft text-accent-ink border-accent-line'
                                  : comp.healthScore >= 60
                                  ? 'bg-warn-soft text-warn-ink border-warn-line'
                                  : 'bg-bad-soft text-bad-ink border-bad-line'
                              }`}
                            >
                              {comp.healthScore}% {comp.healthStatus}
                            </span>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px] text-ink-muted pt-1 border-t border-slate-850">
                          <div>
                            <span className="text-[9px] uppercase font-bold text-ink-faint block">{isHi ? 'निर्माता' : 'Manufacturer'}</span>
                            <span className="text-ink-body truncate block">{comp.manufacturer}</span>
                          </div>
                          <div>
                            <span className="text-[9px] uppercase font-bold text-ink-faint block">{isHi ? 'चली दूरी (कि.मी.)' : 'Km Travelled'}</span>
                            <span className="text-accent-ink font-mono">{comp.totalKmTravelled.toLocaleString()} km</span>
                          </div>
                          <div>
                            <span className="text-[9px] uppercase font-bold text-ink-faint block">{isHi ? 'पीओएच चक्र' : 'POH Cycles'}</span>
                            <span className="text-accent-ink font-mono">{comp.overhaulCount} Overhauls</span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-2 border-t border-slate-850">
                          <span className="font-mono text-[10px] text-ink-faint truncate max-w-[200px]">
                            {comp.qrCode}
                          </span>
                          <button
                            onClick={() => {
                              setUnassignTarget(comp);
                              setUnassignReason('Routine POH Service');
                              setUnassignTargetStatus('AVAILABLE_IN_STORES');
                            }}
                            className="px-2.5 py-1 bg-bad-soft hover:bg-bad-soft text-bad-ink border border-bad-line rounded text-xs font-bold transition"
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
            <div className="lg:col-span-2 p-5 bg-card border border-line rounded-card space-y-4">
              <div className="flex items-center justify-between border-b border-line pb-3">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-accent"></span>
                  <h4 className="text-sm font-extrabold text-white tracking-wide">{isHi ? 'अंडरफ्रेम, कपलर व ब्रेक असेंबली' : 'UNDERFRAME, COUPLERS & BRAKE ASSEMBLIES'}</h4>
                </div>
                <button
                  onClick={() => openAssignModal('UNDERFRAME')}
                  className="px-2.5 py-1 bg-accent-soft text-accent-ink border border-accent-line hover:bg-accent-soft rounded-control text-xs font-bold transition"
                >
                  + Mount to Underframe
                </button>
              </div>

              {wagonComponents.filter(
                (c) => c.currentBogiePosition === 'UNDERFRAME' || c.currentBogiePosition === 'BODY' || c.currentBogiePosition === 'NONE'
              ).length === 0 ? (
                <div className="p-8 text-center bg-page rounded-control border border-dashed border-line text-ink-faint text-xs">
                  <p className="font-semibold text-ink-muted">{isHi ? 'कोई ड्राफ्ट गियर, कपलर या वाल्व नहीं लगा' : 'No Draft Gears, Couplers, or Valves Mounted'}</p>
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
                        className="p-4 bg-page border border-accent-line hover:border-accent-line rounded-control space-y-2 transition shadow"
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-accent-ink text-sm">
                                {comp.serialNumber}
                              </span>
                              <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-raised text-ink-body border border-line">
                                {comp.componentType}
                              </span>
                            </div>
                            <p className="text-xs text-ink-body font-medium mt-0.5">{comp.partName}</p>
                          </div>

                          <div className="text-right">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold border ${
                                comp.healthScore >= 90
                                  ? 'bg-good-soft text-good-ink border-good-line'
                                  : comp.healthScore >= 75
                                  ? 'bg-accent-soft text-accent-ink border-accent-line'
                                  : comp.healthScore >= 60
                                  ? 'bg-warn-soft text-warn-ink border-warn-line'
                                  : 'bg-bad-soft text-bad-ink border-bad-line'
                              }`}
                            >
                              {comp.healthScore}%
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-2 border-t border-slate-850">
                          <span className="text-[11px] text-ink-muted">
                            Position: <span className="text-ink-body font-bold">{comp.currentBogiePosition}</span>
                          </span>
                          <button
                            onClick={() => {
                              setUnassignTarget(comp);
                              setUnassignReason('Routine POH Service');
                              setUnassignTargetStatus('AVAILABLE_IN_STORES');
                            }}
                            className="px-2.5 py-1 bg-bad-soft hover:bg-bad-soft text-bad-ink border border-bad-line rounded text-xs font-bold transition"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-page backdrop-blur-sm p-4">
          <div className="bg-card border border-accent-line rounded-card p-6 max-w-md w-full space-y-4">
            <div className="flex justify-between items-center border-b border-line pb-3">
              <h3 className="text-base font-bold text-white">
                Mount Serialized Component ({wagonNumber})
              </h3>
              <button
                onClick={() => setAssignModalOpen(false)}
                className="text-ink-muted hover:text-white font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAssignComponentSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block text-ink-body font-semibold mb-1">{isHi ? 'लक्ष्य बोगी स्थान' : 'Target Bogie Position'}</label>
                <select
                  value={assignBogiePos}
                  onChange={(e) => setAssignBogiePos(e.target.value as any)}
                  className="w-full px-3 py-2 bg-page border border-line rounded-control text-white font-medium"
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
                  <label className="block text-ink-body font-semibold mb-1">{isHi ? 'उपलब्ध स्टोर्स डिपो स्टॉक से चुनें' : 'Select from Available Stores Depot Stock'}</label>
                  <select
                    onChange={(e) => setAssignSerialInput(e.target.value)}
                    className="w-full px-3 py-2 bg-page border border-line rounded-control text-white font-mono"
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
                <label className="block text-ink-body font-semibold mb-1">Or Enter Serial Number Manually *</label>
                <input
                  type="text"
                  required
                  value={assignSerialInput}
                  onChange={(e) => setAssignSerialInput(e.target.value.toUpperCase())}
                  placeholder="e.g. WRS-WS-2026-001"
                  className="w-full px-3 py-2 bg-page border border-line rounded-control text-white font-mono"
                />
              </div>

              <div>
                <label className="block text-ink-body font-semibold mb-1">{isHi ? 'स्थापना टिप्पणी' : 'Mounting Notes'}</label>
                <textarea
                  value={assignNotes}
                  onChange={(e) => setAssignNotes(e.target.value)}
                  placeholder={isHi ? 'स्थापना टिप्पणी, टॉर्क जाँच...' : 'Installation notes, torque check...'}
                  rows={2}
                  className="w-full px-3 py-2 bg-page border border-line rounded-control text-white"
                />
              </div>

              <div className="flex justify-between items-center pt-3 border-t border-line">
                <button
                  type="button"
                  onClick={() => {
                    setAssignModalOpen(false);
                    setIsPassportScannerOpen(true);
                  }}
                  className="px-3 py-1.5 bg-raised hover:bg-selected text-accent-ink rounded-control font-bold flex items-center gap-1"
                >
                  <CameraIcon size={16} />{isHi ? 'क्यूआर स्कैन करें' : 'Scan QR'}</button>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setAssignModalOpen(false)}
                    className="px-4 py-2 bg-raised text-ink-body rounded-control font-bold"
                  >{isHi ? 'रद्द करें' : 'Cancel'}</button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-control font-bold shadow"
                  >{isHi ? 'स्थापना की पुष्टि करें' : 'Confirm Mount'}</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Unassign Component Modal */}
      {unassignTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-page backdrop-blur-sm p-4">
          <div className="bg-card border border-warn-line rounded-card p-6 max-w-md w-full space-y-4">
            <div className="flex justify-between items-center border-b border-line pb-3">
              <h3 className="text-base font-bold text-white">
                Unassign Component: {unassignTarget.serialNumber}
              </h3>
              <button
                onClick={() => setUnassignTarget(null)}
                className="text-ink-muted hover:text-white font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleUnassignComponentSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block text-ink-body font-semibold mb-1">{isHi ? 'वापसी स्थिति' : 'Return Status'}</label>
                <select
                  value={unassignTargetStatus}
                  onChange={(e) => setUnassignTargetStatus(e.target.value as ComponentStatus)}
                  className="w-full px-3 py-2 bg-page border border-line rounded-control text-white"
                >
                  <option value="AVAILABLE_IN_STORES">{isHi ? 'स्टोर्स डिपो (उपलब्ध)' : 'Stores Depot (Available)'}</option>
                  <option value="RECONDITIONED">{isHi ? 'पुनर्निर्मित' : 'Reconditioned'}</option>
                  <option value="UNDER_MAINTENANCE">Under Maintenance / Bay</option>
                  <option value="CONDEMNED">{isHi ? 'कंडम' : 'Condemned'}</option>
                </select>
              </div>

              <div>
                <label className="block text-ink-body font-semibold mb-1">Reason for Removal *</label>
                <input
                  type="text"
                  required
                  value={unassignReason}
                  onChange={(e) => setUnassignReason(e.target.value)}
                  placeholder="e.g. Scheduled overhaul, flange wear..."
                  className="w-full px-3 py-2 bg-page border border-line rounded-control text-white"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-line">
                <button
                  type="button"
                  onClick={() => setUnassignTarget(null)}
                  className="px-4 py-2 bg-raised text-ink-body rounded-control font-bold"
                >{isHi ? 'रद्द करें' : 'Cancel'}</button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-bad hover:bg-bad text-white rounded-control font-bold shadow"
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

      {/* Caliper viewfinder */}
      {smartVisionModalTarget && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-2 sm:p-4">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-page backdrop-blur-sm" onClick={() => setSmartVisionModalTarget(null)} />
          
          {/* Modal Container */}
          <div className="relative w-full max-w-2xl bg-card border border-line rounded-card overflow-hidden flex flex-col max-h-[95vh]">
            <CaliperCamera
              lang={lang || 'en'}
              wagonNumber={wagonNumber}
              bogieType={(wagon?.wagonType?.includes('HS') ? 'CASNUB_22_HS' : 'CASNUB_22_NLB') as BogieType}
              condition="USED"
              initialTarget={smartVisionModalTarget.initialTarget || 'OUTER_SPRING'}
              measuredHeight={null}
              /*
               * Same as SpringBatchPage, which already had these and this call
               * site did not: springs at Raipur are gauged by hand against a
               * calibrated go/no-go post, not read off a digital display. The
               * camera path exists to photograph a caliper LCD, so on this
               * bench it asked the supervisor to "align caliper LCD here" in
               * front of an instrument that has no display at all — which is
               * how the shop's own officer found it.
               */
              defaultMode="manual"
              hideCamera
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-page backdrop-blur-sm p-4">
          <div className="bg-card border border-line rounded-card w-full max-w-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-line flex justify-between items-center bg-raised">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <GearIcon size={16} /> {t('actions.overrideStage')}
              </h3>
              <button
                onClick={() => setShowOverrideModal(false)}
                className="text-ink-muted hover:text-white p-1 text-lg"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleExecuteOverride} className="p-6 space-y-4">
              {overrideError && (
                <div className="p-3 bg-bad-soft border border-bad-line rounded-control text-bad-ink text-xs">
                  {overrideError}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-ink-body mb-1">{isHi ? 'लक्ष्य चरण' : 'Target Stage'}</label>
                {/* Says so explicitly. Every stage is listed, earlier ones
                    included, but nothing on this screen said a wagon could go
                    back — so a supervisor concluded it could not. */}
                <p className="text-[11px] text-ink-muted mb-2 leading-snug">
                  {isHi
                    ? 'कोई भी चरण चुना जा सकता है — पिछला भी, यदि वैगन को वापस भेजना हो। कारण के साथ यह स्थायी रूप से दर्ज होता है।'
                    : 'Any stage, including an earlier one if the wagon has to go back. The move and your reason are recorded permanently against this wagon.'}
                </p>
                <select
                  value={overrideTargetStage}
                  onChange={(e) => setOverrideTargetStage(e.target.value as LifecycleStage)}
                  className="w-full bg-raised border border-line rounded-control px-3 py-2.5 text-sm text-white focus:outline-none focus:border-accent-line"
                >
                  {stageList.map((stg) => (
                    <option key={stg} value={stg}>
                      {stg.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-ink-body mb-1">
                  Technical Justification (min 10 characters) *
                </label>
                <textarea
                  rows={3}
                  required
                  value={overrideJustification}
                  onChange={(e) => setOverrideJustification(e.target.value)}
                  placeholder={isHi ? 'ओवरराइड हेतु विस्तृत तकनीकी कारण दर्ज करें...' : 'Enter detailed technical justification for override...'}
                  className="w-full bg-raised border border-line rounded-control px-3 py-2 text-sm text-white focus:outline-none focus:border-accent-line"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-ink-body mb-1">{isHi ? 'पर्यवेक्षक क्रिया ओटीपी' : 'Supervisor Action OTP'}</label>
                <input
                  type="text"
                  placeholder="e.g. 123456"
                  value={overrideOtp}
                  onChange={(e) => setOverrideOtp(e.target.value)}
                  className="w-full bg-raised border border-line rounded-control px-3 py-2 text-sm text-white focus:outline-none focus:border-accent-line"
                />
              </div>

              <div className="pt-3 border-t border-line flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowOverrideModal(false)}
                  className="px-4 py-2 rounded-control border border-line text-ink-body hover:bg-raised text-xs font-semibold"
                >{isHi ? 'रद्द करें' : 'Cancel'}</button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-control bg-warn hover:bg-warn text-white text-xs font-bold"
                >{isHi ? 'ओवरराइड की पुष्टि करें' : 'Confirm Override'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Supervisor Digital Sign-off Modal */}
      {showSignoffModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-page backdrop-blur-sm p-4">
          <div className="bg-card border border-line rounded-card w-full max-w-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-line flex justify-between items-center bg-raised">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <ShieldIcon size={16} />{isHi ? 'पर्यवेक्षक डिजिटल विमुक्ति हस्ताक्षर' : 'Supervisor Digital Release Sign-off'}</h3>
              <button
                onClick={() => setShowSignoffModal(false)}
                className="text-ink-muted hover:text-white p-1 text-lg"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleGateSignoff} className="p-6 space-y-4">
              {signoffError && (
                <div className="p-3 bg-bad-soft border border-bad-line rounded-control text-bad-ink text-xs">
                  {signoffError}
                </div>
              )}

              <div className="p-3 bg-good-soft border border-good-line rounded-control text-xs text-good-ink">
                ✓ Zero-defect verification cleared. Ready for cryptographic signing and release certificate issuance.
              </div>

              <div>
                <label className="block text-xs font-semibold text-ink-body mb-1">{isHi ? 'हस्ताक्षर टिप्पणी व प्रमाणपत्र नोट' : 'Sign-off Remarks & Certificate Notes'}</label>
                <textarea
                  rows={3}
                  value={signoffNotes}
                  onChange={(e) => setSignoffNotes(e.target.value)}
                  className="w-full bg-raised border border-line rounded-control px-3 py-2 text-sm text-white focus:outline-none focus:border-good-line"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-ink-body mb-1">{isHi ? 'पर्यवेक्षक क्रिया ओटीपी टोकन' : 'Supervisor Action OTP Token'}</label>
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
                          className="flex-1 bg-raised border border-line rounded-control px-3 py-2 text-sm text-white font-mono tracking-widest focus:outline-none focus:border-good-line"
                        />
                        <button
                          type="button"
                          onClick={handleVerifyAuthenticator}
                          disabled={signoffOtpBusy || signoffOtp.trim().length !== 6}
                          className="px-4 py-2 rounded-control border border-good-line text-good-ink hover:bg-good-soft disabled:opacity-40 text-xs font-bold whitespace-nowrap"
                        >
                          {signoffOtpBusy ? '…' : (isHi ? 'सत्यापित करें' : 'Verify')}
                        </button>
                      </div>
                      <p className="text-[11px] text-good-ink/80">
                        {isHi ? 'प्रमाणक ऐप से — इंटरनेट की आवश्यकता नहीं' : 'From your authenticator app — no network needed'}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <div className="flex gap-2">
                        {shownSignoffOtp && (
                          <p className="w-full text-xs text-warn-ink bg-warn-soft border border-warn-line rounded-control px-3 py-2 mb-2 leading-snug">
                            {isHi ? 'पुष्टि कोड' : 'Confirmation code'}:{' '}
                            <strong className="font-mono tracking-widest text-warn-ink">{shownSignoffOtp}</strong>
                            <span className="block text-warn-ink/80 mt-1">
                              {isHi
                                ? 'इसे नीचे टाइप करें। यह कहीं भेजा नहीं गया — यह एक सोच-समझकर लिया गया दूसरा कदम है, दूसरा कारक नहीं।'
                                : 'Type it below. It is shown here rather than sent anywhere — a deliberate second step on releasing a wagon, not a second factor.'}
                            </span>
                          </p>
                        )}
                        <input
                          type="text"
                          inputMode="numeric"
                          placeholder={isHi ? '6-अंकीय कोड दर्ज करें' : 'Type the 6-digit code'}
                          value={signoffOtp}
                          onChange={(e) => setSignoffOtp(e.target.value)}
                          disabled={!signoffOtpId}
                          className="flex-1 bg-raised border border-line rounded-control px-3 py-2 text-sm text-white disabled:opacity-50 focus:outline-none focus:border-good-line"
                        />
                        <button
                          type="button"
                          onClick={signoffOtpId ? handleVerifySignoffOtp : handleRequestSignoffOtp}
                          disabled={signoffOtpBusy}
                          className="px-4 py-2 rounded-control border border-good-line text-good-ink hover:bg-good-soft disabled:opacity-40 text-xs font-bold whitespace-nowrap"
                        >
                          {signoffOtpBusy
                            ? '…'
                            : signoffOtpId
                              ? (isHi ? 'ओटीपी सत्यापित करें' : 'Verify OTP')
                              : (isHi ? 'ओटीपी भेजें' : 'Send OTP')}
                        </button>
                      </div>
                      <p className="text-[11px] text-warn-ink/90">
                        {isHi
                          ? 'कोई प्रमाणक सेट नहीं — यह कोड सर्वर देता है, इसलिए यह दूसरा प्रमाण नहीं है। खाता स्क्रीन से सेटअप करें।'
                          : 'No authenticator set up. This code is issued by the server, so it confirms intent but is not a second factor. Set one up from the User Accounts screen.'}
                      </p>
                    </div>
                  )
                ) : (
                  <p className="text-xs font-bold text-good-ink">
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
                <div className="rounded-control border border-warn-line bg-warn-soft p-3 space-y-2">
                  <p className="text-xs font-bold text-warn-ink uppercase tracking-wide">
                    {isHi ? 'सलाहकार निष्कर्ष — स्वीकृति आवश्यक' : 'Advisory findings — your acceptance required'}
                  </p>
                  <p className="text-[11px] text-warn-ink/80">
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

              <div className="pt-3 border-t border-line flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowSignoffModal(false)}
                  className="px-4 py-2 rounded-control border border-line text-ink-body hover:bg-raised text-xs font-semibold"
                >{isHi ? 'रद्द करें' : 'Cancel'}</button>
                <button
                  type="submit"
                  disabled={
                    signoffSubmitting ||
                    !signoffOtpToken ||
                    (gateStatus?.advisoryDetails || []).some((a: any) => !acknowledgedAdvisories.includes(a.id))
                  }
                  className="px-5 py-2 rounded-control bg-good hover:bg-good disabled:opacity-40 text-white text-xs font-bold"
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
