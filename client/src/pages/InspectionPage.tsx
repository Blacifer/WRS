/**
 * Main Mobile-First Bogie Spring Inspection Page
 * Indian Railways WRS Raipur (RDSO G-95 Rev-II)
 */

import React, { useState, useEffect, useMemo } from 'react';
import type {
  BogieType,
  SpringCondition,
  SpringPosition,
  DamageType,
  BandColor,
  ClassificationResult,
  User,
  InspectionRecord
} from '../../../shared/types.ts';
import { getDictionary, getBogieTypeText, getPositionText, getConditionText } from '../i18n/index.ts';
import type { LanguageCode } from '../i18n/index.ts';
import { CaliperCamera } from '../components/CaliperCamera.tsx';
import { ClassificationBadge } from '../components/ClassificationBadge.tsx';
import { DefectSelector } from '../components/DefectSelector.tsx';
import { SupervisorOverrideModal } from '../components/SupervisorOverrideModal.tsx';
import { VoiceInspectionToolbar } from '../components/VoiceInspectionToolbar.tsx';
import { classifySpringLocally } from '../services/classification.ts';
import { api } from '../services/api.ts';
import { offlineDb } from '../services/offlineDb.ts';
import { ShieldIcon, CheckCircleIcon, AlertTriangleIcon, RefreshCwIcon, Volume2Icon, VolumeXIcon } from '../components/Icons.tsx';
import { playPassChime, playCondemnedBuzz } from '../utils/audioFeedback.ts';
import type { VoiceParseResult } from '../../../shared/types.ts';
import { can } from '../../../shared/auth/permissions.ts';


interface InspectionPageProps {
  lang: LanguageCode;
  user: User | null;
}

const BOGIE_TYPES: BogieType[] = ['CASNUB_22_NLB', 'CASNUB_22_HS', 'CASNUB_22_RFT'];
const SPRING_CONDITIONS: SpringCondition[] = ['USED', 'NEW'];
const SPRING_POSITIONS: SpringPosition[] = ['OUTER', 'INNER', 'SNUBBER'];

export const InspectionPage: React.FC<InspectionPageProps> = ({ lang, user }) => {
  const dict = getDictionary(lang);

  // Form State
  const [wagonNumber, setWagonNumber] = useState<string>('SECR-BOXN-101');
  const [bogieType, setBogieType] = useState<BogieType>('CASNUB_22_NLB');
  const [condition, setCondition] = useState<SpringCondition>('USED');
  const [position, setPosition] = useState<SpringPosition>('OUTER');
  // Which bogie the spring came off. Required for the measurement to link to
  // the correct checklist item — without it the spring is recorded but the
  // wagon's checklist cannot know which of its two bogies was verified.
  const [bogiePosition, setBogiePosition] = useState<'BOGIE_1' | 'BOGIE_2'>('BOGIE_1');
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(260.00);
  const [measurementSource, setMeasurementSource] = useState<'OCR' | 'MANUAL'>('OCR');
  const [ocrConfidence, setOcrConfidence] = useState<number | undefined>(0.99);
  const [damageType, setDamageType] = useState<DamageType>('NONE');
  const [damageNotes, setDamageNotes] = useState<string>('');

  // Override State
  const [isOverrideModalOpen, setIsOverrideModalOpen] = useState<boolean>(false);
  const [overrideBand, setOverrideBand] = useState<BandColor | null>(null);
  const [overrideReason, setOverrideReason] = useState<string | null>(null);
  const [otpTokenRef, setOtpTokenRef] = useState<string | null>(null);

  // Submission State
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [lastSavedRecord, setLastSavedRecord] = useState<InspectionRecord | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // Sound & Visual Feedback State (R5)
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const lastClassificationRef = React.useRef<string>('');

  // Compute live classification result instantaneously
  const classification: ClassificationResult | null = useMemo(() => {
    if (measuredHeight === null || isNaN(measuredHeight)) return null;
    return classifySpringLocally({
      bogieType,
      condition,
      position,
      measuredHeight,
      damageType,
      damageNotes
    });
  }, [bogieType, condition, position, measuredHeight, damageType, damageNotes]);

  // Audio synthesizer & visual feedback trigger on classification result change
  useEffect(() => {
    if (!classification) return;
    const currentKey = `${classification.status}-${overrideBand || classification.band}-${measuredHeight}-${damageType}`;
    if (lastClassificationRef.current !== currentKey) {
      lastClassificationRef.current = currentKey;
      if (soundEnabled) {
        if (classification.status === 'CONDEMNED') {
          playCondemnedBuzz();
        } else {
          playPassChime();
        }
      }
    }
  }, [classification, overrideBand, measuredHeight, damageType, soundEnabled]);

  const handleReplayAudio = () => {
    if (!classification) return;
    if (classification.status === 'CONDEMNED') {
      playCondemnedBuzz();
    } else {
      playPassChime();
    }
  };

  // Handle measurement update from camera OCR or manual input
  const handleMeasurementChange = (height: number, source: 'OCR' | 'MANUAL' | 'SMART_VISION', confidence?: number, autoDetect?: any) => {
    setMeasuredHeight(height);
    setMeasurementSource(source === 'SMART_VISION' ? 'OCR' : source);
    setOcrConfidence(confidence);
    setOverrideBand(null); // reset override on new measurement
    setOverrideReason(null);
    setOtpTokenRef(null);
    
    // AI Auto-Detection
    if (autoDetect) {
      if (autoDetect.detectedBogieType) setBogieType(autoDetect.detectedBogieType);
      if (autoDetect.detectedCondition) setCondition(autoDetect.detectedCondition);
      if (autoDetect.detectedPosition) setPosition(autoDetect.detectedPosition);
    }
  };

  const handleApplyOverride = (band: BandColor, reason: string, otpToken: string) => {
    setOverrideBand(band);
    setOverrideReason(reason);
    setOtpTokenRef(otpToken);
  };

  // Submit and log inspection record
  const handleSaveInspection = async () => {
    if (!wagonNumber || wagonNumber.trim().length === 0) {
      setFormError('Please enter a valid Wagon Number');
      return;
    }
    if (measuredHeight === null || isNaN(measuredHeight) || measuredHeight < 100 || measuredHeight > 500) {
      setFormError(dict.messages.invalidMeasurement);
      return;
    }

    setFormError(null);
    setIsSaving(true);
    const now = new Date().toISOString();

    const inspectionPayload = {
      wagonNumber: wagonNumber.trim().toUpperCase(),
      bogieType,
      condition,
      position,
      bogiePosition,
      measuredHeight,
      measuredFreeHeight: measuredHeight,
      damageType,
      damageNotes: damageNotes.trim() || undefined,
      measurementSource,
      ocrConfidence,
      overrideBand: overrideBand || undefined,
      overrideReason: overrideReason || undefined,
      otpToken: otpTokenRef || undefined,
      clientTimestamp: now,
      inspectorId: user?.id || 'usr_insp_001',
      inspectorName: user?.name || 'Workshop Operator'
    };

    try {
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        // Online: Save directly to server API
        const saved = await api.createInspection(inspectionPayload);
        setLastSavedRecord(saved);
        setSuccessMessage(`${dict.messages.classificationSuccess} (Seq #${saved.sequenceNumber || saved.id})`);
      } else {
        // Offline: Enqueue in local IndexedDB store
        const tempId = await offlineDb.enqueueInspection({
          wagonNumber: inspectionPayload.wagonNumber,
          bogieType: inspectionPayload.bogieType,
          condition: inspectionPayload.condition,
          springPosition: inspectionPayload.position,
          measuredFreeHeight: inspectionPayload.measuredFreeHeight,
          classifiedBand: overrideBand || classification?.band || null,
          bandRoman: classification?.bandRoman || null,
          status: classification?.status || 'PASS',
          damageType: inspectionPayload.damageType,
          damageNotes: inspectionPayload.damageNotes,
          tableReference: classification?.tableReference || 'RDSO G-95',
          inspectorId: inspectionPayload.inspectorId,
          inspectorName: inspectionPayload.inspectorName,
          isOverridden: Boolean(overrideBand),
          overrideBand: overrideBand || null,
          overrideReason: overrideReason || null,
          timestamp: now,
          measurementSource: inspectionPayload.measurementSource,
          ocrConfidence: inspectionPayload.ocrConfidence
        });
        setSuccessMessage(`${dict.messages.offlineSaved} (ID: ${tempId})`);
      }

      // Reset for next spring in bogie nest
      setDamageType('NONE');
      setDamageNotes('');
      setOverrideBand(null);
      setOverrideReason(null);
      setOtpTokenRef(null);
    } catch (err: any) {
      // If server error, fallback to offline enqueue
      console.warn('[Inspection] Server write failed, saving to offline DB:', err);
      const tempId = await offlineDb.enqueueInspection({
        wagonNumber: inspectionPayload.wagonNumber,
        bogieType: inspectionPayload.bogieType,
        condition: inspectionPayload.condition,
        springPosition: inspectionPayload.position,
        measuredFreeHeight: inspectionPayload.measuredFreeHeight,
        classifiedBand: overrideBand || classification?.band || null,
        bandRoman: classification?.bandRoman || null,
        status: classification?.status || 'PASS',
        damageType: inspectionPayload.damageType,
        damageNotes: inspectionPayload.damageNotes,
        tableReference: classification?.tableReference || 'RDSO G-95',
        inspectorId: inspectionPayload.inspectorId,
        inspectorName: inspectionPayload.inspectorName,
        isOverridden: Boolean(overrideBand),
        overrideBand: overrideBand || null,
        overrideReason: overrideReason || null,
        timestamp: now,
        measurementSource: inspectionPayload.measurementSource,
        ocrConfidence: inspectionPayload.ocrConfidence
      });
      setSuccessMessage(`${dict.messages.offlineSaved} (ID: ${tempId})`);
    } finally {
      setIsSaving(false);
    }
  };

  // Gates the supervisor override. An override is an act of authority over a
  // classification, so it is asked for by name — an administrator no longer
  // qualifies simply by outranking a supervisor.
  const canOverride = can(user?.role, 'wagon.override');

  const handleVoiceCommand = (result: VoiceParseResult) => {
    if (result.actionType === 'CLASSIFY_SPRING' && result.springParams) {
      const p = result.springParams;
      if (p.measuredHeight) {
        handleMeasurementChange(p.measuredHeight, 'MANUAL');
      }
      if (p.bogieType) {
        setBogieType(p.bogieType);
      }
      if (p.position) {
        setPosition(p.position);
      }
      if (p.condition) {
        setCondition(p.condition);
      }
      if (p.isSaveCommand) {
        handleSaveInspection();
      }
    } else if (result.actionType === 'UPDATE_STATUS') {
      if (result.status === 'CONDEMNED' || result.status === 'FAIL') {
        setDamageType('CRACK');
      } else if (result.status === 'PASS') {
        setDamageType('NONE');
      }
      if (result.defectNotes) {
        setDamageNotes(result.defectNotes);
      }
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-3 sm:px-6 py-6 space-y-6 pb-20">
      {/* Hands-Free Voice Inspection Toolbar */}
      <VoiceInspectionToolbar
        wagonNumber={wagonNumber}
        currentCategory="SPRINGS"
        onCommandParsed={handleVoiceCommand}
        lang={lang}
      />

      {/* Success Notification Banner */}
      {successMessage && (
        <div className="p-4 bg-good-soft border-2 border-good-line rounded-control text-good-ink text-sm font-bold flex items-center justify-between animate-fadeIn">
          <div className="flex items-center gap-2.5">
            <CheckCircleIcon size={22} className="text-good-ink shrink-0" />
            <span>{successMessage}</span>
          </div>
          <button
            onClick={() => setSuccessMessage(null)}
            className="text-good-ink hover:text-white font-extrabold text-lg p-1"
          >
            &times;
          </button>
        </div>
      )}

      {/* Form Error Banner */}
      {formError && (
        <div className="p-4 bg-bad-soft border-2 border-bad-line rounded-control text-bad-ink text-sm font-bold flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <AlertTriangleIcon size={22} className="text-bad-ink shrink-0" />
            <span>{formError}</span>
          </div>
          <button
            onClick={() => setFormError(null)}
            className="text-bad-ink hover:text-white font-extrabold text-lg p-1"
          >
            &times;
          </button>
        </div>
      )}

      {/* Section 1: Wagon Identification & Nest Details */}
      <div className="glass-panel rounded-card p-6 space-y-8">
        <h2 className="text-sm font-medium text-neutral-400 tracking-wide flex items-center gap-3">
          <span className="w-5 h-5 rounded-full border border-white/20 flex items-center justify-center text-[10px]">1</span>
          <span>{lang === 'hi' ? 'वैगन व बोगी विवरण' : 'Wagon & Bogie Assembly Details'}</span>
        </h2>

        {/* Wagon Number Input */}
        <div className="space-y-1.5">
          <label className="block text-xs font-bold text-ink-body">
            {dict.form.wagonNumber}
          </label>
          <input
            type="text"
            value={wagonNumber}
            onChange={(e) => setWagonNumber(e.target.value.toUpperCase())}
            placeholder={dict.form.wagonPlaceholder}
            className="w-full bg-transparent border-b border-white/20 focus:border-white py-3 text-white font-mono text-xl outline-none transition-colors uppercase placeholder:text-neutral-600"
          />
        </div>

        {/* Bogie Type Selector (Touch targets >= 48px) */}
        <div className="space-y-1.5">
          <label className="block text-xs font-bold text-ink-body">
            {dict.form.bogieType}
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {BOGIE_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setBogieType(type)}
                className={`min-h-tap px-4 py-2 rounded-control border text-sm font-semibold transition-colors ${
                  bogieType === type
                    ? 'bg-selected text-ink border-accent-line'
                    : 'bg-card border-line text-ink-muted hover:text-ink hover:border-line-strong'
                }`}
              >
                {getBogieTypeText(type, lang)}
              </button>
            ))}
          </div>
        </div>

        {/* Condition & Position Selectors */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
          {/* Spring Condition (Used 6 Bands / New 3 Bands) */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-ink-body">
              {dict.form.condition}
            </label>
            <div className="grid grid-cols-2 gap-2">
              {SPRING_CONDITIONS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCondition(c)}
                  className={`min-h-tap px-4 py-2 rounded-control border text-sm font-semibold transition-colors ${
                    condition === c
                      ? 'bg-selected text-ink border-accent-line'
                      : 'bg-card border-line text-ink-muted hover:text-ink hover:border-line-strong'
                  }`}
                >
                  {getConditionText(c, lang)}
                </button>
              ))}
            </div>
          </div>

          {/* Spring Position (Outer / Inner / Snubber) */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-ink-body">
              {dict.form.position}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {SPRING_POSITIONS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPosition(p)}
                  className={`min-h-tap px-4 py-2 rounded-control border text-sm font-semibold transition-colors ${
                    position === p
                      ? 'bg-selected text-ink border-accent-line'
                      : 'bg-card border-line text-ink-muted hover:text-ink hover:border-line-strong'
                  }`}
                >
                  {getPositionText(p, lang)}
                </button>
              ))}
            </div>
          </div>

          {/* Which bogie — needed to link this reading to the right checklist item */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-ink-body">
              {lang === 'hi' ? 'बोगी' : 'Bogie'}
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(['BOGIE_1', 'BOGIE_2'] as const).map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => setBogiePosition(b)}
                  className={`min-h-tap px-4 py-2 rounded-control border text-sm font-semibold transition-colors ${
                    bogiePosition === b
                      ? 'bg-selected text-ink border-accent-line'
                      : 'bg-card border-line text-ink-muted hover:text-ink hover:border-line-strong'
                  }`}
                >
                  {lang === 'hi' ? (b === 'BOGIE_1' ? 'बोगी 1' : 'बोगी 2') : b === 'BOGIE_1' ? 'Bogie 1' : 'Bogie 2'}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>


      {/* Section 2: Caliper Camera & OCR Pipeline */}
      <div className="space-y-2">
        <h2 className="text-sm font-extrabold text-ink-body uppercase tracking-[0.07em] flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-accent text-white flex items-center justify-center text-xs">2</span>
          <span>{lang === 'hi' ? 'मुक्त ऊंचाई माप' : 'Free Height Measurement'}</span>
        </h2>
        <CaliperCamera
          lang={lang}
          measuredHeight={measuredHeight}
          onMeasurementChange={handleMeasurementChange}
          // This screen is also a spring measurement, gauged by hand at
          // Raipur, so there is no digital display for the OCR to read.
          hideCamera
        />
      </div>

      {/* Section 3: Instant Classification Result Card (Visual & Audio Feedback R5) */}
      {classification && (
        <div
          className={`p-5 rounded-card border-2 space-y-4 transition-all duration-300 ${
            classification.status === 'CONDEMNED'
              ? 'ring-4 ring-rose-600/60 bg-bad-soft border-bad-line animate-bounce'
              : 'ring-4 ring-emerald-500/50 bg-good-soft border-good-line animate-pulse'
          }`}
        >
          {/* Header Bar with Visual Status Icon, Badges & Audio Controls */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              {classification.status === 'CONDEMNED' ? (
                <div className="w-11 h-11 rounded-card bg-bad-soft border border-bad-line flex items-center justify-center text-bad-ink shrink-0">
                  <AlertTriangleIcon size={26} />
                </div>
              ) : (
                <div className="w-11 h-11 rounded-card bg-good-soft border border-good-line flex items-center justify-center text-good-ink shrink-0">
                  <CheckCircleIcon size={26} />
                </div>
              )}

              <div>
                <span className="text-[11px] uppercase tracking-[0.07em] font-extrabold text-ink-body">
                  {lang === 'hi' ? 'आरडीएसओ वर्गीकरण परिणाम' : 'RDSO G-95 Classification Result'}
                </span>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <ClassificationBadge
                    band={overrideBand || classification.band}
                    bandRoman={classification.bandRoman}
                    status={classification.status}
                    lang={lang}
                    isOverridden={Boolean(overrideBand)}
                    size="lg"
                  />
                  {classification.status === 'CONDEMNED' ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-bad-soft border border-bad-line text-bad-ink text-xs font-extrabold rounded-control uppercase tracking-wide">
                      <AlertTriangleIcon size={14} className="text-bad-ink" />
                      {lang === 'hi' ? 'कंडम / स्क्रैप' : 'CONDEMNED / SCRAP'}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-good-soft border border-good-line text-good-ink text-xs font-extrabold rounded-control uppercase tracking-wide">
                      <CheckCircleIcon size={14} className="text-good-ink" />
                      {lang === 'hi' ? 'उत्तीर्ण / सेवा योग्य' : 'PASS / SERVICEABLE'}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Audio Feedback Controller & Reference */}
            <div className="flex items-start sm:items-end flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleReplayAudio}
                  title="Replay Audio Feedback (Web Audio API Synthesizer)"
                  className="px-2.5 py-1 bg-card hover:bg-raised border border-line rounded-control text-xs font-bold text-ink-body flex items-center gap-1.5 shadow transition active:scale-95"
                >
                  <Volume2Icon size={14} className={classification.status === 'CONDEMNED' ? 'text-bad-ink' : 'text-good-ink'} />
                  <span>{lang === 'hi' ? 'ध्वनि पुनः बजाएं' : 'Replay Tone'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSoundEnabled(!soundEnabled)}
                  title={soundEnabled ? 'Disable Audio Feedback' : 'Enable Audio Feedback'}
                  className={`p-1.5 rounded-control border text-xs font-bold transition active:scale-95 ${
                    soundEnabled
                      ? 'bg-accent-soft border-accent-line text-accent-ink'
                      : 'bg-raised border-line text-ink-faint'
                  }`}
                >
                  {soundEnabled ? <Volume2Icon size={14} /> : <VolumeXIcon size={14} />}
                </button>
              </div>

              <div className="text-left sm:text-right">
                <span className="text-[11px] text-ink-muted font-semibold">
                  {lang === 'hi' ? 'आरडीएसओ संदर्भ' : 'RDSO Reference'}:
                </span>{' '}
                <span className="text-xs font-extrabold text-white font-mono">{classification.tableReference}</span>
                <span className="text-[11px] text-ink-muted block">
                  [{classification.validRange.min} - {classification.validRange.max} mm]
                </span>
              </div>
            </div>
          </div>

          {/* Condemnation Alert Warning Flash */}
          {classification.status === 'CONDEMNED' && (
            <div className="p-3.5 bg-bad-soft border-2 border-bad-line rounded-control text-rose-100 text-xs sm:text-sm font-bold flex items-start gap-2.5">
              <AlertTriangleIcon size={22} className="shrink-0 text-bad-ink mt-0.5" />
              <div>
                <p className="font-extrabold text-bad-ink">{dict.messages.condemnedAlert}</p>
                {classification.condemnationReason && (
                  <p className="font-medium text-bad-ink mt-1">{classification.condemnationReason}</p>
                )}
              </div>
            </div>
          )}

          {/* PASS Clearance Reassurance */}
          {classification.status === 'PASS' && (
            <div className="p-3 bg-good-soft border border-good-line rounded-control text-good-ink text-xs font-bold flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircleIcon size={18} className="text-good-ink" />
                <span>
                  {lang === 'hi'
                    ? 'स्प्रिंग विनिर्देशों के अनुरूप है — बोगी नेस्ट असेंबली हेतु अनुशंसित'
                    : 'Spring height within RDSO limits — Certified for Bogie Nest Assembly'}
                </span>
              </div>
              <span className="font-mono text-[10px] text-good-ink uppercase tracking-[0.07em] bg-good-soft px-2 py-0.5 rounded border border-good-line">
                RDSO G-95 Rev-II
              </span>
            </div>
          )}

          {/* Supervisor Override Applied Badge */}
          {overrideBand && (
            <div className="p-3 bg-accent-soft border border-accent-line rounded-control text-accent-ink text-xs font-semibold flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldIcon size={16} className="text-accent-ink" />
                <span>Override: {overrideReason}</span>
              </div>
              <span className="font-mono text-[10px] text-accent-ink">{lang === 'hi' ? 'ओटीपी सत्यापित' : 'OTP Auth Valid'}</span>
            </div>
          )}
        </div>
      )}

      {/* Section 4: Physical Defect Assessment */}
      <div className="space-y-2">
        <h2 className="text-sm font-extrabold text-ink-body uppercase tracking-[0.07em] flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-accent text-white flex items-center justify-center text-xs">3</span>
          <span>{lang === 'hi' ? 'भौतिक क्षति एवं दोष जांच' : 'Visual Defect & Damage Inspection'}</span>
        </h2>
        <DefectSelector
          lang={lang}
          selectedDamage={damageType}
          onSelectDamage={setDamageType}
          damageNotes={damageNotes}
          onDamageNotesChange={setDamageNotes}
        />
      </div>

      <div className="pt-6 flex flex-col sm:flex-row items-center gap-4 justify-end border-t border-white/10 mt-8">
        {canOverride && (
          <button
            type="button"
            onClick={() => setIsOverrideModalOpen(true)}
            className="px-6 py-3 bg-transparent text-neutral-400 font-medium text-sm rounded-full border border-white/10 hover:text-white transition-colors flex items-center gap-2"
          >
            <ShieldIcon size={16} />
            <span>{dict.actions.override}</span>
          </button>
        )}

        <button
          type="button"
          onClick={handleSaveInspection}
          disabled={isSaving}
          className="min-h-touch px-8 bg-accent hover:bg-accent-hover border border-accent-hover text-white font-bold text-base rounded-touch flex items-center justify-center gap-2 transition-colors active:scale-[0.98]"
        >
          {isSaving ? <RefreshCwIcon size={16} className="animate-spin" /> : <CheckCircleIcon size={16} />}
          <span>{isSaving ? dict.app.syncing : dict.actions.saveInspection}</span>
        </button>
      </div>

      {/* Supervisor Override Modal */}
      <SupervisorOverrideModal
        isOpen={isOverrideModalOpen}
        onClose={() => setIsOverrideModalOpen(false)}
        lang={lang}
        originalBand={classification?.band || null}
        onApplyOverride={handleApplyOverride}
      />
    </div>
  );
};
