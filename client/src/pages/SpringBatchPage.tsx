/**
 * Spring Batch Inspection Queue
 * Indian Railways WRS Raipur (RDSO G-95 Rev-II)
 *
 * Rapid-entry flow for high-throughput spring QC (~900 springs/day):
 * pick a wagon + bogie type/condition once, then cycle through the 6
 * required spring positions (Outer/Inner/Snubber x Bogie 1/2) with a
 * single OCR-first capture -> instant classification -> auto-save ->
 * auto-advance loop per spring, instead of re-filling a form each time.
 */

import React, { useEffect, useMemo, useState } from 'react';
import type {
  BogieType,
  SpringCondition,
  SpringPosition,
  DamageType,
  ClassificationResult,
  User
} from '../../../shared/types.ts';
import { getDictionary, getBogieTypeText, getPositionText, getConditionText } from '../i18n/index.ts';
import type { LanguageCode } from '../i18n/index.ts';
import { CaliperCamera } from '../components/CaliperCamera.tsx';
import { ClassificationBadge } from '../components/ClassificationBadge.tsx';
import { DefectSelector } from '../components/DefectSelector.tsx';
import { DefectPhotoCapture } from '../components/DefectPhotoCapture.tsx';
import { classifySpringLocally, getRDSOTable } from '../services/classification.ts';
import { getReplacementGuidance } from '../../../shared/classification/nestGrouping.ts';
import {
  getSpringCountOptions,
  getSpringCount,
  buildSpringQueue,
  totalPerBogie
} from '../../../shared/classification/springCounts.ts';
import {
  requiresManualCounts,
  isPlausibleCount,
  MANUAL_COUNT_LIMITS
} from '../../../shared/classification/springCounts.ts';
import type { AxleLoad, QueuedSpring, SpringCount } from '../../../shared/classification/springCounts.ts';
import { api } from '../services/api.ts';
import { offlineDb } from '../services/offlineDb.ts';
import { CheckCircleIcon, AlertTriangleIcon, RefreshCwIcon } from '../components/Icons.tsx';
import { playPassChime, playCondemnedBuzz } from '../utils/audioFeedback.ts';

/**
 * Paint colours for the physical band applied to each spring, per RDSO
 * WMM 2.0's "coloured band should be provided for easy identification of
 * group height". WHITE is rendered slightly off-white so it stays visible
 * against the app's dark surface.
 */
const BAND_PAINT_HEX: Record<string, string> = {
  BLUE: '#2563eb',
  GREEN: '#16a34a',
  YELLOW: '#eab308',
  ORANGE: '#ea580c',
  WHITE: '#f1f5f9',
  RED: '#dc2626'
};

const BAND_LABEL_HI: Record<string, string> = {
  BLUE: 'नीला',
  GREEN: 'हरा',
  YELLOW: 'पीला',
  ORANGE: 'नारंगी',
  WHITE: 'सफ़ेद',
  RED: 'लाल'
};

interface SpringBatchPageProps {
  lang: LanguageCode;
  user: User | null;
  onClose: () => void;
}

// The queue is derived from the bogie's actual spring count (WMM 2.0 §601),
// not a fixed six. See shared/classification/springCounts.ts.
type QueueStep = QueuedSpring;

interface CompletedStep extends QueueStep {
  measuredHeight: number;
  status: 'PASS' | 'CONDEMNED';
  band: ClassificationResult['band'];
}

const BOGIE_TYPES: BogieType[] = ['CASNUB_22_NLB', 'CASNUB_22_HS', 'CASNUB_22_RFT'];
const SPRING_CONDITIONS: SpringCondition[] = ['USED', 'NEW'];

export const SpringBatchPage: React.FC<SpringBatchPageProps> = ({ lang, user, onClose }) => {
  const dict = getDictionary(lang);
  const isHi = lang === 'hi';

  const [wagonNumber, setWagonNumber] = useState<string>('');
  const [bogieType, setBogieType] = useState<BogieType>('CASNUB_22_NLB');
  const [condition, setCondition] = useState<SpringCondition>('USED');
  const [axleLoad, setAxleLoad] = useState<AxleLoad>('20.32t');
  // Counts entered by hand for bogie types with no documented configuration.
  const [manualCounts, setManualCounts] = useState<SpringCount>({ outer: 12, inner: 8, snubber: 4 });
  const [wagonLocked, setWagonLocked] = useState<boolean>(false);

  const [stepIndex, setStepIndex] = useState<number>(0);
  const [completed, setCompleted] = useState<CompletedStep[]>([]);

  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null);
  const [measurementSource, setMeasurementSource] = useState<'OCR' | 'MANUAL'>('MANUAL');
  const [ocrConfidence, setOcrConfidence] = useState<number | undefined>(undefined);
  // What OCR proposed before any human edit — used to feed the learning loop.
  const [ocrProposedHeight, setOcrProposedHeight] = useState<number | null>(null);
  const [ocrProposedConfidence, setOcrProposedConfidence] = useState<number | undefined>(undefined);
  const [damageType, setDamageType] = useState<DamageType>('NONE');
  const [damageNotes, setDamageNotes] = useState<string>('');
  const [showDefectPanel, setShowDefectPanel] = useState<boolean>(false);
  // Evidence for a condemnation. Required before a CONDEMNED spring can be
  // saved — it is both the proof behind the verdict and a labelled training
  // sample for future automatic defect detection.
  const [defectPhoto, setDefectPhoto] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Available axle-load configurations depend on the bogie type.
  const countOptions = useMemo(() => getSpringCountOptions(bogieType), [bogieType]);
  const needsManualCounts = useMemo(() => requiresManualCounts(bogieType), [bogieType]);
  const manualCountsValid = useMemo(() => isPlausibleCount(manualCounts), [manualCounts]);

  const activeCount = useMemo(() => {
    if (needsManualCounts) {
      return manualCountsValid
        ? {
            axleLoad,
            counts: manualCounts,
            source: 'Counted on the bogie by the inspector — no published figure for this type.',
            verified: false
          }
        : null;
    }
    return getSpringCount(bogieType, axleLoad) || countOptions[0] || null;
  }, [needsManualCounts, manualCountsValid, manualCounts, bogieType, axleLoad, countOptions]);

  const QUEUE: QueueStep[] = useMemo(
    () => (activeCount ? buildSpringQueue(activeCount.counts) : []),
    [activeCount]
  );

  // A full sweep is forty-eight springs — twenty minutes or more of work. A
  // locked phone, a backgrounded browser or an accidental reload used to
  // discard all of it, and an inspector who has to start over may simply not.
  // The saved readings are already safe on the server or in the offline queue;
  // what is restored here is the inspector's place in the queue.
  const PROGRESS_KEY = 'wrs_spring_batch_progress_v1';

  useEffect(() => {
    if (!wagonLocked) return;
    try {
      localStorage.setItem(
        PROGRESS_KEY,
        JSON.stringify({ wagonNumber, bogieType, condition, axleLoad, manualCounts, stepIndex, completed })
      );
    } catch {
      // Storage unavailable (private window, blocked site data) — the sweep
      // still works, it just will not survive a reload.
    }
  }, [wagonLocked, wagonNumber, bogieType, condition, axleLoad, manualCounts, stepIndex, completed]);

  const [resumable, setResumable] = useState<null | {
    wagonNumber: string;
    stepIndex: number;
    total: number;
  }>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PROGRESS_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (saved?.wagonNumber && saved.stepIndex > 0) {
        setResumable({
          wagonNumber: saved.wagonNumber,
          stepIndex: saved.stepIndex,
          total: Array.isArray(saved.completed) ? saved.stepIndex : saved.stepIndex
        });
      }
    } catch {
      /* ignore malformed state */
    }
  }, []);

  const resumeSweep = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}');
      setWagonNumber(saved.wagonNumber || '');
      setBogieType(saved.bogieType || 'CASNUB_22_NLB');
      setCondition(saved.condition || 'USED');
      setAxleLoad(saved.axleLoad || '20.32t');
      if (saved.manualCounts) setManualCounts(saved.manualCounts);
      setCompleted(Array.isArray(saved.completed) ? saved.completed : []);
      setStepIndex(saved.stepIndex || 0);
      setWagonLocked(true);
      setResumable(null);
    } catch {
      setResumable(null);
    }
  };

  const discardSweep = () => {
    try { localStorage.removeItem(PROGRESS_KEY); } catch { /* ignore */ }
    setResumable(null);
  };

  const currentStep = stepIndex < QUEUE.length ? QUEUE[stepIndex] : null;
  const batchDone = QUEUE.length > 0 && stepIndex >= QUEUE.length;

  const classification: ClassificationResult | null = useMemo(() => {
    if (!currentStep || measuredHeight === null || isNaN(measuredHeight)) return null;
    return classifySpringLocally({
      bogieType,
      condition,
      position: currentStep.position,
      measuredHeight,
      damageType,
      damageNotes
    });
  }, [currentStep, bogieType, condition, measuredHeight, damageType, damageNotes]);

  // When a spring is condemned, work out what its replacement has to be.
  // The manual says to replace defective springs "such that variation in the
  // height of springs in the same group" stays within limit — so the
  // replacement is not just any serviceable spring, it has to sit inside the
  // window the rest of the nest already defines. That is the part an inspector
  // cannot judge by eye, and getting it wrong recreates the mismatched nest
  // the grouping rule exists to prevent.
  const replacementGuidance = useMemo(() => {
    if (!currentStep || classification?.status !== 'CONDEMNED') return null;

    const sameNest = completed
      .filter(
        (c) =>
          c.bogiePosition === currentStep.bogiePosition &&
          c.position === currentStep.position
      )
      .map((c, i) => ({
        id: `done_${i}`,
        springPosition: c.position,
        condition,
        measuredFreeHeight: c.measuredHeight,
        status: c.status
      }));

    const table = getRDSOTable(bogieType, condition, currentStep.position);
    const bandLookup = (h: number) => {
      const b = table?.bands.find((x) =>
        x.isHighestBand ? h >= x.minHeight && h <= x.maxHeight : h >= x.minHeight && h < x.maxHeight
      );
      return b ? b.band : null;
    };

    return getReplacementGuidance(sameNest, bandLookup);
  }, [currentStep, classification, completed, bogieType, condition]);

  const handleMeasurementChange = (height: number, source: 'OCR' | 'MANUAL', confidence?: number) => {
    setMeasuredHeight(height);
    setMeasurementSource(source);
    setOcrConfidence(confidence);
    // Remember what OCR first proposed, so that if the inspector overrides it
    // we can tell the difference between "machine was right" and "machine was
    // corrected". That comparison is the training signal the learning loop
    // runs on — without capturing it here, OCR can never improve.
    if (source === 'OCR') {
      setOcrProposedHeight(height);
      setOcrProposedConfidence(confidence);
    }
  };

  const resetStepInputs = () => {
    setMeasuredHeight(null);
    setOcrConfidence(undefined);
    setOcrProposedHeight(null);
    setOcrProposedConfidence(undefined);
    setDamageType('NONE');
    setDamageNotes('');
    setShowDefectPanel(false);
    setDefectPhoto(null);
    setSaveError(null);
  };

  // A condemnation must carry evidence. Blocking here rather than nagging
  // later is what makes the dataset accumulate at all.
  const needsDefectPhoto = classification?.status === 'CONDEMNED' && !defectPhoto;

  const handleConfirmAndNext = async () => {
    if (!currentStep || !classification || measuredHeight === null) return;
    if (!wagonNumber.trim()) {
      setSaveError(isHi ? 'कृपया वैगन नंबर दर्ज करें' : 'Please enter a wagon number');
      return;
    }
    if (needsDefectPhoto) {
      setSaveError(
        isHi
          ? 'कंडम स्प्रिंग के लिए दोष फ़ोटो आवश्यक है'
          : 'A defect photo is required before condemning this spring'
      );
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    const now = new Date().toISOString();

    const inspectionPayload = {
      wagonNumber: wagonNumber.trim().toUpperCase(),
      bogieType,
      condition,
      position: currentStep.position,
      // Which bogie this spring came off. Without it the server cannot tell
      // Bogie 1's outer spring from Bogie 2's, and one measurement would
      // satisfy both checklist items.
      bogiePosition: currentStep.bogiePosition,
      nestIndex: currentStep.indexInNest,
      measuredHeight,
      measuredFreeHeight: measuredHeight,
      damageType,
      damageNotes: damageNotes.trim() || undefined,
      measurementSource,
      ocrConfidence,
      clientTimestamp: now,
      inspectorId: user?.id || 'usr_insp_001',
      inspectorName: user?.name || 'Workshop Operator'
    };

    try {
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        await api.createInspection(inspectionPayload);
      } else {
        await offlineDb.enqueueInspection({
          wagonNumber: inspectionPayload.wagonNumber,
          bogieType: inspectionPayload.bogieType,
          condition: inspectionPayload.condition,
          springPosition: inspectionPayload.position,
          bogiePosition: inspectionPayload.bogiePosition,
          nestIndex: inspectionPayload.nestIndex,
          measuredFreeHeight: inspectionPayload.measuredFreeHeight,
          classifiedBand: classification.band,
          bandRoman: classification.bandRoman,
          status: classification.status,
          damageType: inspectionPayload.damageType,
          damageNotes: inspectionPayload.damageNotes,
          tableReference: classification.tableReference,
          inspectorId: inspectionPayload.inspectorId,
          inspectorName: inspectionPayload.inspectorName,
          isOverridden: false,
          timestamp: now,
          measurementSource: inspectionPayload.measurementSource,
          ocrConfidence: inspectionPayload.ocrConfidence
        });
      }
    } catch (err) {
      console.warn('[SpringBatch] Server write failed, saving to offline queue:', err);
      try {
        await offlineDb.enqueueInspection({
          wagonNumber: inspectionPayload.wagonNumber,
          bogieType: inspectionPayload.bogieType,
          condition: inspectionPayload.condition,
          springPosition: inspectionPayload.position,
          bogiePosition: inspectionPayload.bogiePosition,
          nestIndex: inspectionPayload.nestIndex,
          measuredFreeHeight: inspectionPayload.measuredFreeHeight,
          classifiedBand: classification.band,
          bandRoman: classification.bandRoman,
          status: classification.status,
          damageType: inspectionPayload.damageType,
          damageNotes: inspectionPayload.damageNotes,
          tableReference: classification.tableReference,
          inspectorId: inspectionPayload.inspectorId,
          inspectorName: inspectionPayload.inspectorName,
          isOverridden: false,
          timestamp: now,
          measurementSource: inspectionPayload.measurementSource,
          ocrConfidence: inspectionPayload.ocrConfidence
        });
      } catch (offlineErr) {
        console.error('[SpringBatch] Offline enqueue also failed:', offlineErr);
        setSaveError(isHi ? 'सेव नहीं हो सका। पुनः प्रयास करें।' : 'Could not save this reading. Please try again.');
        setIsSaving(false);
        return;
      }
    }

    // Attach the condemnation evidence. Best-effort and after the record is
    // safely saved — a photo upload failure must never cost the inspector
    // their measurement. The defect type travels as a tag so the image is a
    // labelled sample rather than an anonymous picture.
    if (defectPhoto && classification.status === 'CONDEMNED') {
      api
        .uploadPhoto({
          wagonNumber: inspectionPayload.wagonNumber,
          partCategory: 'SPRINGS',
          partName: `${currentStep.position} Spring (${currentStep.bogiePosition.replace('_', ' ')})`,
          imageBase64: defectPhoto,
          tags: [
            'DEFECT_EVIDENCE',
            `DAMAGE_${damageType}`,
            `POSITION_${currentStep.position}`,
            `BOGIE_TYPE_${bogieType}`,
            `BAND_${classification.band || 'CONDEMNED'}`,
            `HEIGHT_${measuredHeight}`
          ]
        })
        .catch((e) => console.warn('[SpringBatch] defect photo not uploaded:', e));
    }

    // Feed the learning loop: did the inspector keep what OCR read, or fix it?
    // Best-effort and non-blocking — a failure here must never cost the
    // inspector their reading, which is already safely saved above.
    if (ocrProposedHeight !== null) {
      const delta = Math.abs(measuredHeight - ocrProposedHeight);
      // Sub-0.01mm differences are float noise, not a human correction.
      const wasCorrected = delta >= 0.01;
      api
        .recordLearningOutcome({
          subsystem: 'OCR_CALIPER',
          wagonNumber: inspectionPayload.wagonNumber,
          machineOutput: { measuredFreeHeight: ocrProposedHeight },
          machineConfidence: ocrProposedConfidence,
          humanOutput: { measuredFreeHeight: measuredHeight },
          wasCorrected,
          correctionMagnitude: delta,
          context: {
            componentTarget: `${currentStep.position}_SPRING`,
            bogieType,
            springCondition: condition,
            finalSource: measurementSource
          }
        })
        .catch((e) => console.warn('[SpringBatch] learning outcome not recorded:', e));
    }

    if (classification.status === 'CONDEMNED') {
      playCondemnedBuzz();
    } else {
      playPassChime();
    }

    setCompleted((prev) => [
      ...prev,
      { ...currentStep, measuredHeight, status: classification.status, band: classification.band }
    ]);
    setWagonLocked(true);
    setIsSaving(false);
    resetStepInputs();
    setStepIndex((i) => i + 1);
  };

  const handleStartNextWagon = () => {
    // The sweep is finished, so the saved place is no longer meaningful.
    try { localStorage.removeItem(PROGRESS_KEY); } catch { /* ignore */ }
    setWagonNumber('');
    setWagonLocked(false);
    setCompleted([]);
    setStepIndex(0);
    resetStepInputs();
  };

  const passCount = completed.filter((c) => c.status === 'PASS').length;
  const condemnedCount = completed.filter((c) => c.status === 'CONDEMNED').length;

  return (
    <div className="max-w-2xl mx-auto px-3 sm:px-6 py-6 space-y-5 pb-20">
      {/* Header / Close */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-extrabold text-white">
            {isHi ? 'स्प्रिंग बैच निरीक्षण' : 'Spring Batch Inspection'}
          </h1>
          <p className="text-xs text-slate-400">
            {isHi ? 'तेज़ प्रोसेसिंग — एक के बाद एक स्प्रिंग' : 'Rapid processing — one spring after another'}
          </p>
        </div>
        <button
          onClick={onClose}
          className="min-h-[40px] px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-sm font-bold border border-slate-700"
        >
          {isHi ? 'बंद करें' : 'Close'}
        </button>
      </div>

      {/* Wagon / Bogie / Condition — set once per wagon */}
      <div className="glass-panel rounded-2xl p-5 space-y-4">
        <div className="space-y-1.5">
          <label className="block text-xs font-bold text-slate-300">{dict.form.wagonNumber}</label>
          <input
            type="text"
            value={wagonNumber}
            disabled={wagonLocked}
            onChange={(e) => setWagonNumber(e.target.value.toUpperCase())}
            placeholder={dict.form.wagonPlaceholder}
            className="w-full bg-transparent border-b border-white/20 focus:border-white py-2.5 text-white font-mono text-lg outline-none transition-colors uppercase placeholder:text-neutral-600 disabled:opacity-60"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-300">{dict.form.bogieType}</label>
            <div className="grid grid-cols-1 gap-2">
              {BOGIE_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  disabled={wagonLocked}
                  onClick={() => setBogieType(type)}
                  className={`px-3 py-2 rounded-full border text-xs font-medium transition-all disabled:opacity-60 ${
                    bogieType === type
                      ? 'bg-white text-black border-white'
                      : 'bg-transparent border-white/10 text-neutral-400 hover:text-white hover:border-white/30'
                  }`}
                >
                  {getBogieTypeText(type, lang)}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-300">{dict.form.condition}</label>
            <div className="grid grid-cols-2 gap-2">
              {SPRING_CONDITIONS.map((c) => (
                <button
                  key={c}
                  type="button"
                  disabled={wagonLocked}
                  onClick={() => setCondition(c)}
                  className={`px-3 py-2 rounded-full border text-xs font-medium transition-all disabled:opacity-60 ${
                    condition === c
                      ? 'bg-white text-black border-white'
                      : 'bg-transparent border-white/10 text-neutral-400 hover:text-white hover:border-white/30'
                  }`}
                >
                  {getConditionText(c, lang)}
                </button>
              ))}
            </div>
          </div>

          {/* Axle load decides how many springs the bogie carries (WMM 2.0
              §601), so it decides the length of this queue. Hidden for types
              with no published configuration — those are counted by hand. */}
          <div className={`space-y-1.5 ${needsManualCounts ? 'hidden' : ''}`}>
            <label className="block text-xs font-bold text-slate-300">
              {isHi ? 'एक्सल भार' : 'Axle Load'}
            </label>
            <div className="grid grid-cols-2 gap-2">
              {countOptions.map((o) => (
                <button
                  key={o.axleLoad}
                  type="button"
                  disabled={wagonLocked}
                  onClick={() => setAxleLoad(o.axleLoad)}
                  className={`px-3 py-2 rounded-full border text-xs font-medium transition-all disabled:opacity-60 ${
                    axleLoad === o.axleLoad
                      ? 'bg-white text-black border-white'
                      : 'bg-transparent border-white/10 text-neutral-400 hover:text-white hover:border-white/30'
                  }`}
                >
                  {o.axleLoad}
                </button>
              ))}
            </div>
          </div>

          {/* No published count for this bogie type — ask rather than guess.
              Defaulting it to another type's numbers would produce a
              confident, wrong completeness check at the exit gate. */}
          {needsManualCounts && (
            <div className="sm:col-span-2 rounded-xl border border-amber-800/70 bg-amber-950/20 px-3.5 py-3 space-y-2.5">
              <div>
                <p className="text-xs font-black text-amber-300">
                  {isHi ? 'इस बोगी के स्प्रिंग गिनें' : 'Count the springs on this bogie'}
                </p>
                <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                  {isHi
                    ? 'इस प्रकार की स्प्रिंग संख्या आरडीएसओ दस्तावेज़ में प्रकाशित नहीं है। अनुमान लगाने के बजाय, कृपया बोगी पर गिनकर दर्ज करें।'
                    : 'The spring count for this bogie type is not published in RDSO documentation. Rather than assume another type’s figures, count them on the bogie and enter them here — one bogie only.'}
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {([
                  ['outer', isHi ? 'बाहरी' : 'Outer'],
                  ['inner', isHi ? 'भीतरी' : 'Inner'],
                  ['snubber', isHi ? 'स्नबर' : 'Snubber']
                ] as const).map(([key, label]) => (
                  <label key={key} className="block">
                    <span className="block text-[11px] font-bold text-slate-300 mb-1">{label}</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={MANUAL_COUNT_LIMITS.min}
                      max={MANUAL_COUNT_LIMITS.max}
                      disabled={wagonLocked}
                      value={manualCounts[key]}
                      onChange={(e) =>
                        setManualCounts((c) => ({ ...c, [key]: Number(e.target.value) }))
                      }
                      className="w-full min-h-[44px] bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white text-center font-mono focus:border-amber-500 focus:outline-none disabled:opacity-60"
                    />
                  </label>
                ))}
              </div>
              {!manualCountsValid && (
                <p className="text-[11px] text-rose-400 font-semibold">
                  {isHi
                    ? `प्रत्येक संख्या ${MANUAL_COUNT_LIMITS.min}–${MANUAL_COUNT_LIMITS.max} के बीच होनी चाहिए।`
                    : `Each count must be a whole number between ${MANUAL_COUNT_LIMITS.min} and ${MANUAL_COUNT_LIMITS.max}.`}
                </p>
              )}
            </div>
          )}

          {/* State plainly how many springs this configuration means, so the
              inspector knows the size of the job before starting. */}
          {activeCount && (
            <div className="sm:col-span-2 rounded-xl border border-slate-800 bg-slate-950/60 px-3.5 py-3">
              <p className="text-xs text-slate-300">
                <span className="font-bold text-white">
                  {activeCount.counts.outer} {isHi ? 'बाहरी' : 'outer'} ·{' '}
                  {activeCount.counts.inner} {isHi ? 'भीतरी' : 'inner'} ·{' '}
                  {activeCount.counts.snubber} {isHi ? 'स्नबर' : 'snubber'}
                </span>{' '}
                {isHi ? 'प्रति बोगी' : 'per bogie'} —{' '}
                <span className="font-bold text-white">
                  {totalPerBogie(activeCount.counts) * 2} {isHi ? 'स्प्रिंग कुल' : 'springs total'}
                </span>{' '}
                {isHi ? 'इस वैगन के लिए' : 'for this wagon'}
              </p>
              <p className="text-[10px] text-slate-500 mt-1">{activeCount.source}</p>
              {!activeCount.verified && (
                <p className="text-[11px] text-amber-400 font-semibold mt-1.5">
                  {isHi
                    ? '⚠ यह संख्या आरडीएसओ दस्तावेज़ से पुष्ट नहीं है — कृपया ड्राइंग से जाँचें।'
                    : '⚠ This count is not confirmed in RDSO documentation — verify against the drawing before relying on it.'}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Progress. A bogie can carry 24+ springs, so one bar per spring is
          unreadable — show overall progress plus a per-nest tally instead. */}
      <div className="space-y-2">
        <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
          <div
            className="h-full bg-blue-500 transition-all"
            style={{ width: `${QUEUE.length ? (stepIndex / QUEUE.length) * 100 : 0}%` }}
          />
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400 tabular-nums">
          <span>
            {isHi ? 'पूर्ण' : 'Done'}: <span className="text-white font-bold">{stepIndex}</span> / {QUEUE.length}
          </span>
          <span className="text-emerald-400">
            {isHi ? 'उत्तीर्ण' : 'Pass'}: {completed.filter((c) => c.status === 'PASS').length}
          </span>
          <span className="text-rose-400">
            {isHi ? 'कंडम' : 'Condemned'}: {completed.filter((c) => c.status === 'CONDEMNED').length}
          </span>
        </div>
      </div>

      {/* An unfinished sweep from a previous session. Readings already taken
          are safely recorded — this only restores the inspector's place. */}
      {resumable && !wagonLocked && (
        <div className="rounded-2xl border border-blue-700/60 bg-blue-950/25 p-4 space-y-3">
          <div>
            <p className="text-sm font-black text-white">
              {isHi ? 'अधूरा निरीक्षण मिला' : 'Unfinished sweep found'}
            </p>
            <p className="text-xs text-slate-300 mt-1">
              {resumable.wagonNumber} — {resumable.stepIndex}{' '}
              {isHi ? 'स्प्रिंग पहले ही दर्ज' : 'springs already recorded'}
            </p>
            <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
              {isHi
                ? 'दर्ज की गई रीडिंग सुरक्षित हैं। जारी रखने पर आप वहीं से शुरू करेंगे जहाँ छोड़ा था।'
                : 'Those readings are already saved. Continuing picks up from where you stopped.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={resumeSweep}
              className="min-h-[44px] px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition"
            >
              {isHi ? 'जारी रखें' : 'Continue'}
            </button>
            <button
              type="button"
              onClick={discardSweep}
              className="min-h-[44px] px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold border border-slate-700 transition"
            >
              {isHi ? 'नया शुरू करें' : 'Start fresh'}
            </button>
          </div>
        </div>
      )}

      {!batchDone && currentStep && (
        <>
          <div className="text-center">
            <span className="text-xs font-mono text-blue-400 bg-blue-950/50 border border-blue-800 px-3 py-1 rounded-full">
              {currentStep.bogiePosition === 'BOGIE_1' ? (isHi ? 'बोगी 1' : 'Bogie 1') : (isHi ? 'बोगी 2' : 'Bogie 2')}
              {' · '}
              {getPositionText(currentStep.position, lang)}
              {' '}
              <span className="text-white font-bold">
                {currentStep.indexInNest} / {currentStep.nestSize}
              </span>
            </span>
          </div>

          <CaliperCamera
            key={stepIndex}
            lang={lang}
            measuredHeight={measuredHeight}
            onMeasurementChange={handleMeasurementChange}
            initialTarget={
              currentStep.position === 'INNER'
                ? 'INNER_SPRING'
                : currentStep.position === 'SNUBBER'
                ? 'SNUBBER_SPRING'
                : 'OUTER_SPRING'
            }
            // Springs are measured with a manual gauge here — there is no
            // caliper LCD to photograph, so opening the camera would just
            // cost a tap and a permission prompt on every spring.
            defaultMode="manual"
            // Springs at Raipur are gauged by hand. The OCR reads digits off a
            // digital display, so there is nothing here for a camera to read —
            // and offering one implies photographing the spring identifies it,
            // which no camera can do.
            hideCamera
          />

          {classification && (
            <div
              className={`p-4 rounded-2xl border-2 space-y-3 transition-all ${
                classification.status === 'CONDEMNED'
                  ? 'bg-rose-950/60 border-rose-600'
                  : 'bg-emerald-950/40 border-emerald-500'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  {classification.status === 'CONDEMNED' ? (
                    <AlertTriangleIcon size={22} className="text-rose-400 shrink-0" />
                  ) : (
                    <CheckCircleIcon size={22} className="text-emerald-400 shrink-0" />
                  )}
                  <ClassificationBadge
                    band={classification.band}
                    bandRoman={classification.bandRoman}
                    status={classification.status}
                    lang={lang}
                    size="lg"
                  />
                </div>
                <span className="text-[11px] font-mono text-slate-400">{classification.tableReference}</span>
              </div>
              {classification.status === 'CONDEMNED' && classification.condemnationReason && (
                <p className="text-xs font-semibold text-rose-300">{classification.condemnationReason}</p>
              )}

              {/* Physical paint-band instruction.
                  RDSO WMM 2.0: "Coloured band should be provided for easy
                  identification of group height." The band is not just a
                  software label — it is paint applied to the spring so the
                  fitter can match a nest by eye at assembly. The app computed
                  the band and then said nothing about what to do with it. */}
              {classification.status === 'PASS' && classification.band && (
                <div className="flex items-center gap-3 pt-2.5 mt-1 border-t border-white/10">
                  <span
                    aria-hidden="true"
                    className="w-9 h-9 rounded-lg shrink-0 border-2 border-white/30 shadow-inner"
                    style={{ backgroundColor: BAND_PAINT_HEX[classification.band] || '#94a3b8' }}
                  />
                  <div className="leading-tight">
                    <p className="text-xs font-black text-white tracking-wide">
                      {isHi ? 'स्प्रिंग पर रंग पट्टी लगाएँ' : 'Paint the colour band on this spring'}
                    </p>
                    <p className="text-[11px] text-slate-300">
                      {isHi
                        ? `रंग: ${BAND_LABEL_HI[classification.band] || classification.band} — ताकि असेंबली के समय नेस्ट मिलान आँख से हो सके`
                        : `${classification.band} — so the nest can be matched by eye at assembly`}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Optional defect flag — collapsed by default to keep the queue fast */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setShowDefectPanel((v) => !v)}
              className="text-xs font-bold text-slate-400 hover:text-white underline underline-offset-2"
            >
              {showDefectPanel
                ? (isHi ? 'दोष पैनल छुपाएं' : 'Hide defect panel')
                : damageType !== 'NONE'
                ? (isHi ? `दोष: ${damageType}` : `Defect flagged: ${damageType}`)
                : (isHi ? '+ दृश्य दोष जोड़ें' : '+ Flag a visible defect')}
            </button>
            {showDefectPanel && (
              <DefectSelector
                lang={lang}
                selectedDamage={damageType}
                onSelectDamage={setDamageType}
                damageNotes={damageNotes}
                onDamageNotesChange={setDamageNotes}
              />
            )}
          </div>

          {/* What to do about it. A verdict without an action leaves the
              inspector to work out the replacement band themselves. */}
          {classification?.status === 'CONDEMNED' && replacementGuidance && (
            <div className="rounded-xl border border-amber-700/60 bg-amber-950/20 p-3.5 space-y-2">
              <div className="flex items-start gap-2.5">
                <span className="text-amber-400 text-lg leading-none shrink-0">→</span>
                <div className="min-w-0">
                  <p className="text-xs font-black text-amber-300 mb-1">
                    {isHi ? 'क्या करें' : 'What to do'}
                  </p>
                  <p className="text-xs text-slate-200 leading-relaxed">
                    {replacementGuidance.message}
                  </p>
                  {replacementGuidance.targetRange && (
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      <span className="text-[11px] font-mono text-white bg-slate-950 border border-slate-700 rounded px-2 py-1 tabular-nums">
                        {replacementGuidance.targetRange.min.toFixed(1)}–
                        {replacementGuidance.targetRange.max.toFixed(1)} mm
                      </span>
                      {replacementGuidance.targetBand && (
                        <span
                          className="text-[11px] font-black rounded px-2 py-1 border"
                          style={{
                            color: BAND_PAINT_HEX[replacementGuidance.targetBand] || '#e2e8f0',
                            borderColor: BAND_PAINT_HEX[replacementGuidance.targetBand] || '#334155'
                          }}
                        >
                          {isHi
                            ? BAND_LABEL_HI[replacementGuidance.targetBand] || replacementGuidance.targetBand
                            : replacementGuidance.targetBand}
                        </span>
                      )}
                    </div>
                  )}
                  <p className="text-[10px] text-slate-500 mt-1.5">{replacementGuidance.reference}</p>
                </div>
              </div>
            </div>
          )}

          {/* Evidence is mandatory for a condemnation — shown the moment the
              verdict turns CONDEMNED, not buried behind the optional defect panel. */}
          {classification?.status === 'CONDEMNED' && (
            <DefectPhotoCapture
              lang={lang}
              damageType={damageType}
              imageBase64={defectPhoto}
              onPhotoChange={setDefectPhoto}
            />
          )}

          {saveError && (
            <div className="p-3 bg-rose-950/70 border border-rose-600 rounded-xl text-rose-200 text-xs font-bold">
              {saveError}
            </div>
          )}

          <button
            type="button"
            onClick={handleConfirmAndNext}
            disabled={!classification || isSaving || needsDefectPhoto}
            className="w-full min-h-[56px] px-6 py-3.5 bg-white hover:bg-neutral-200 disabled:opacity-40 text-black font-extrabold text-base rounded-2xl flex items-center justify-center gap-2 transition-transform active:scale-95"
          >
            {isSaving ? (
              <RefreshCwIcon size={18} className="animate-spin" />
            ) : (
              <CheckCircleIcon size={18} />
            )}
            <span>
              {isSaving
                ? dict.app.syncing
                : stepIndex === QUEUE.length - 1
                ? (isHi ? 'सेव करें व समाप्त करें' : 'Save & Finish Bogie')
                : (isHi ? 'सेव करें व अगला स्प्रिंग' : 'Save & Next Spring')}
            </span>
          </button>
        </>
      )}

      {batchDone && (
        <div className="glass-panel rounded-2xl p-6 space-y-5 text-center">
          <CheckCircleIcon size={40} className="text-emerald-400 mx-auto" />
          <div>
            <h2 className="text-lg font-extrabold text-white">
              {isHi ? 'बोगी नेस्ट पूर्ण' : 'Bogie Nest Complete'}
            </h2>
            <p className="text-sm text-slate-400 mt-1">
              {wagonNumber} — {QUEUE.length} {isHi ? 'स्प्रिंग दर्ज किए गए' : 'springs recorded'}
            </p>
          </div>
          <div className="flex items-center justify-center gap-6">
            <div>
              <div className="text-2xl font-black text-emerald-400">{passCount}</div>
              <div className="text-[11px] text-slate-400 uppercase tracking-wide">{isHi ? 'उत्तीर्ण' : 'Pass'}</div>
            </div>
            <div>
              <div className="text-2xl font-black text-rose-400">{condemnedCount}</div>
              <div className="text-[11px] text-slate-400 uppercase tracking-wide">{isHi ? 'कंडम' : 'Condemned'}</div>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <button
              type="button"
              onClick={handleStartNextWagon}
              className="flex-1 min-h-[52px] px-6 py-3 bg-white hover:bg-neutral-200 text-black font-extrabold rounded-2xl transition-transform active:scale-95"
            >
              {isHi ? 'अगला वैगन शुरू करें' : 'Start Next Wagon'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 min-h-[52px] px-6 py-3 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold rounded-2xl border border-slate-700 transition-transform active:scale-95"
            >
              {isHi ? 'समाप्त' : 'Done'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
