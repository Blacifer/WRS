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

import React, { useMemo, useState } from 'react';
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
import { classifySpringLocally } from '../services/classification.ts';
import { api } from '../services/api.ts';
import { offlineDb } from '../services/offlineDb.ts';
import { CheckCircleIcon, AlertTriangleIcon, RefreshCwIcon } from '../components/Icons.tsx';
import { playPassChime, playCondemnedBuzz } from '../utils/audioFeedback.ts';

interface SpringBatchPageProps {
  lang: LanguageCode;
  user: User | null;
  onClose: () => void;
}

interface QueueStep {
  bogiePosition: 'BOGIE_1' | 'BOGIE_2';
  position: SpringPosition;
}

interface CompletedStep extends QueueStep {
  measuredHeight: number;
  status: 'PASS' | 'CONDEMNED';
  band: ClassificationResult['band'];
}

const BOGIE_TYPES: BogieType[] = ['CASNUB_22_NLB', 'CASNUB_22_HS', 'CASNUB_22_RFT'];
const SPRING_CONDITIONS: SpringCondition[] = ['USED', 'NEW'];

const QUEUE: QueueStep[] = [
  { bogiePosition: 'BOGIE_1', position: 'OUTER' },
  { bogiePosition: 'BOGIE_1', position: 'INNER' },
  { bogiePosition: 'BOGIE_1', position: 'SNUBBER' },
  { bogiePosition: 'BOGIE_2', position: 'OUTER' },
  { bogiePosition: 'BOGIE_2', position: 'INNER' },
  { bogiePosition: 'BOGIE_2', position: 'SNUBBER' }
];

export const SpringBatchPage: React.FC<SpringBatchPageProps> = ({ lang, user, onClose }) => {
  const dict = getDictionary(lang);
  const isHi = lang === 'hi';

  const [wagonNumber, setWagonNumber] = useState<string>('');
  const [bogieType, setBogieType] = useState<BogieType>('CASNUB_22_NLB');
  const [condition, setCondition] = useState<SpringCondition>('USED');
  const [wagonLocked, setWagonLocked] = useState<boolean>(false);

  const [stepIndex, setStepIndex] = useState<number>(0);
  const [completed, setCompleted] = useState<CompletedStep[]>([]);

  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null);
  const [measurementSource, setMeasurementSource] = useState<'OCR' | 'MANUAL'>('OCR');
  const [ocrConfidence, setOcrConfidence] = useState<number | undefined>(undefined);
  // What OCR proposed before any human edit — used to feed the learning loop.
  const [ocrProposedHeight, setOcrProposedHeight] = useState<number | null>(null);
  const [ocrProposedConfidence, setOcrProposedConfidence] = useState<number | undefined>(undefined);
  const [damageType, setDamageType] = useState<DamageType>('NONE');
  const [damageNotes, setDamageNotes] = useState<string>('');
  const [showDefectPanel, setShowDefectPanel] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const currentStep = stepIndex < QUEUE.length ? QUEUE[stepIndex] : null;
  const batchDone = stepIndex >= QUEUE.length;

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
    setSaveError(null);
  };

  const handleConfirmAndNext = async () => {
    if (!currentStep || !classification || measuredHeight === null) return;
    if (!wagonNumber.trim()) {
      setSaveError(isHi ? 'कृपया वैगन नंबर दर्ज करें' : 'Please enter a wagon number');
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
        </div>
      </div>

      {/* Progress */}
      <div className="flex items-center gap-2">
        {QUEUE.map((step, i) => (
          <div
            key={i}
            className={`flex-1 h-1.5 rounded-full ${
              i < stepIndex ? (completed[i]?.status === 'CONDEMNED' ? 'bg-rose-500' : 'bg-emerald-500') : i === stepIndex ? 'bg-blue-500' : 'bg-slate-800'
            }`}
          />
        ))}
      </div>

      {!batchDone && currentStep && (
        <>
          <div className="text-center">
            <span className="text-xs font-mono text-blue-400 bg-blue-950/50 border border-blue-800 px-3 py-1 rounded-full">
              {isHi ? `स्प्रिंग ${stepIndex + 1} / ${QUEUE.length}` : `Spring ${stepIndex + 1} of ${QUEUE.length}`}
              {' — '}
              {currentStep.bogiePosition === 'BOGIE_1' ? (isHi ? 'बोगी 1' : 'Bogie 1') : (isHi ? 'बोगी 2' : 'Bogie 2')}
              {' · '}
              {getPositionText(currentStep.position, lang)}
            </span>
          </div>

          <CaliperCamera
            key={stepIndex}
            lang={lang}
            measuredHeight={measuredHeight}
            onMeasurementChange={handleMeasurementChange}
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

          {saveError && (
            <div className="p-3 bg-rose-950/70 border border-rose-600 rounded-xl text-rose-200 text-xs font-bold">
              {saveError}
            </div>
          )}

          <button
            type="button"
            onClick={handleConfirmAndNext}
            disabled={!classification || isSaving}
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
