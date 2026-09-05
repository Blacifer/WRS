/**
 * Hands-Free Voice Inspection Toolbar ("Greasy Gloves" Solution)
 * Indian Railways WRS Raipur — Component Quality Control System
 *
 * Implements browser Web Speech API recognition, Web Audio sound cues,
 * SpeechSynthesis TTS confirmation, continuous listening, simulation test chips,
 * and live transcript feedback.
 */

import React, { useState, useEffect, useRef } from 'react';

import { decideRetry } from '../../../shared/voice/retryPolicy.ts';
import type {
  CASNUBCategory,
  ChecklistItem,
  VoiceParseResult,
  VoiceLanguageCode,
  VoiceSimulationChip
} from '../../../shared/types.ts';
import { parseVoiceCommand, getCategoryLabelEn, getCategoryLabelHi } from '../utils/voiceCommandParser.ts';
import { playPassChime, playCondemnedBuzz, playActionTap } from '../utils/audioFeedback.ts';
import { useI18n } from '../i18n/index.ts';
import { AlertTriangleIcon, CheckCircleIcon, MicIcon } from './Icons.tsx';

export interface VoiceInspectionToolbarProps {
  wagonNumber?: string;
  currentCategory?: CASNUBCategory;
  items?: ChecklistItem[];
  onCommandParsed: (result: VoiceParseResult) => void;
  onCategoryChange?: (category: CASNUBCategory) => void;
  onUndo?: () => void;
  lang?: 'en' | 'hi';
}

export type MicStatus = 'IDLE' | 'LISTENING' | 'PROCESSING' | 'ERROR' | 'SIMULATION';

// TTS Voice announcement helper
export function speakAnnouncement(
  text: string,
  lang: VoiceLanguageCode = 'en-IN',
  enabled: boolean = true
) {
  if (!enabled || typeof window === 'undefined' || !window.speechSynthesis) return;
  try {
    window.speechSynthesis.cancel(); // cancel pending speech
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang === 'hi-IN' || lang === 'hi' ? 'hi-IN' : 'en-IN';
    utterance.rate = 1.05;
    utterance.pitch = 1.0;

    const voices = window.speechSynthesis.getVoices();
    const targetVoice = voices.find(
      (v) => v.lang === utterance.lang || v.lang.startsWith(utterance.lang.slice(0, 2))
    );
    if (targetVoice) {
      utterance.voice = targetVoice;
    }

    window.speechSynthesis.speak(utterance);
  } catch (err) {
    console.debug('[TTS Skipped]', err);
  }
}

export const VoiceInspectionToolbar: React.FC<VoiceInspectionToolbarProps> = ({
  wagonNumber,
  currentCategory,
  items = [],
  onCommandParsed,
  onCategoryChange,
  onUndo,
  lang: initialLang = 'en'
}) => {
  // useI18n() exposes `lang`; `currentLang` never existed, so this silently
  // resolved to undefined and Hindi speech recognition fell back to English
  // whenever the lang prop was not explicitly passed.
  const { t, lang: currentLang } = useI18n();
  const effectiveLang = initialLang || currentLang;

  // Recognition Language State
  const [voiceLang, setVoiceLang] = useState<VoiceLanguageCode>(
    effectiveLang === 'hi' ? 'hi-IN' : 'en-IN'
  );

  // Mic and Listening State
  const [isListening, setIsListening] = useState<boolean>(false);
  const [micStatus, setMicStatus] = useState<MicStatus>('IDLE');
  const [isSupported, setIsSupported] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Live Transcript & Result Feedback
  const [liveTranscript, setLiveTranscript] = useState<string>('');
  const [lastParsedResult, setLastParsedResult] = useState<VoiceParseResult | null>(null);
  const [manualInput, setManualInput] = useState<string>('');
  const [ttsEnabled, setTtsEnabled] = useState<boolean>(true);
  const [showHelp, setShowHelp] = useState<boolean>(false);

  // Refs for Web Speech Recognition instance and persistent listening
  const recognitionRef = useRef<any>(null);
  const shouldKeepListeningRef = useRef<boolean>(false);
  const transcriptDebounceRef = useRef<any>(null);
  /*
   * Consecutive failures, and the pending restart timer.
   *
   * Web Speech restarts itself on every `onend` while listening. With no
   * counter and no delay, one persistent error becomes a tight infinite loop:
   * start → error → end → start. Observed in the field as ~150 "[Web Speech
   * Error] network" lines in a couple of seconds, which on a tablet is a
   * flat battery and a hammered endpoint rather than a cosmetic annoyance.
   */
  const consecutiveErrorsRef = useRef<number>(0);
  const lastErrorRef = useRef<string | null>(null);
  const restartTimerRef = useRef<any>(null);

  // Simulation test chips (English & Hindi)
  const simulationChips: VoiceSimulationChip[] = [
    {
      id: 'chip_outer_pass',
      label: 'Outer Spring Fit',
      labelHi: 'आउटर स्प्रिंग पास',
      phrase: 'Outer spring 1 fit',
      intent: 'UPDATE_STATUS',
      category: 'SPRINGS',
      expectedStatus: 'PASS'
    },
    {
      id: 'chip_wedge_condemn',
      label: 'Friction Wedge Condemn (deep crack)',
      labelHi: 'घर्षण वेज कंडम (गहरी दरार)',
      phrase: 'Friction wedge condemn deep crack',
      intent: 'UPDATE_STATUS',
      category: 'FRICTION_WEDGES',
      expectedStatus: 'CONDEMNED'
    },
    {
      id: 'chip_inner_repaired',
      label: 'Inner Spring Repaired',
      labelHi: 'इनर स्प्रिंग मरम्मत',
      phrase: 'Inner spring 1 repaired and tested',
      intent: 'UPDATE_STATUS',
      category: 'SPRINGS',
      expectedStatus: 'REPAIRED'
    },
    {
      id: 'chip_ctrb_replaced',
      label: 'CTRB Bearing Replaced',
      labelHi: 'सीटीआरबी बेयरिंग नया लगाया',
      phrase: 'CTRB bearing replaced with new',
      intent: 'UPDATE_STATUS',
      category: 'BEARINGS',
      expectedStatus: 'REPLACED'
    },
    {
      id: 'chip_show_brakes',
      label: 'Show Brake System',
      labelHi: 'ब्रेक सिस्टम दिखाएं',
      phrase: 'Open brake system',
      intent: 'SWITCH_CATEGORY',
      category: 'BRAKE_SYSTEM'
    },
    {
      id: 'chip_undo',
      label: 'Undo Last Action',
      labelHi: 'पूर्ववत (Undo)',
      phrase: 'Undo',
      intent: 'UNDO'
    }
  ];

  // Initialize Web Speech Recognition
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const SpeechRecognitionClass =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionClass) {
      setIsSupported(false);
      setMicStatus('SIMULATION');
      return;
    }

    try {
      const recognition = new SpeechRecognitionClass();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = voiceLang;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        setIsListening(true);
        setMicStatus('LISTENING');
        setErrorMessage(null);
      };

      recognition.onresult = (event: any) => {
        let interim = '';
        let finalized = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const res = event.results[i];
          const text = res[0]?.transcript || '';
          if (res.isFinal) {
            finalized += text;
          } else {
            interim += text;
          }
        }

        const currentText = (finalized || interim).trim();
        if (currentText) {
          setLiveTranscript(currentText);

          // If finalized or debounced speech, execute parser
          if (finalized) {
            handleProcessTranscript(finalized);
          } else {
            // Debounce interim speech to give rapid feedback
            if (transcriptDebounceRef.current) {
              clearTimeout(transcriptDebounceRef.current);
            }
            transcriptDebounceRef.current = setTimeout(() => {
              handleProcessTranscript(currentText);
            }, 750);
            // Speech came through, so whatever was failing has recovered.
            consecutiveErrorsRef.current = 0;
          }
        }
      };

      recognition.onerror = (event: any) => {
        console.warn('[Web Speech Error]', event.error);
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          setErrorMessage('Microphone access denied. Test simulation chips remain fully functional.');
          setMicStatus('ERROR');
          setIsListening(false);
          shouldKeepListeningRef.current = false;
        } else {
          // What to do about it is decided in onend by the retry policy, which
          // is shared and tested. Here we only record what went wrong.
          lastErrorRef.current = event.error;
        }
      };

      recognition.onend = () => {
        const decision = decideRetry(
          consecutiveErrorsRef.current,
          lastErrorRef.current,
          shouldKeepListeningRef.current
        );
        if (decision.countsAsFailure) consecutiveErrorsRef.current += 1;
        lastErrorRef.current = null;

        clearTimeout(restartTimerRef.current);

        if (decision.shouldRetry) {
          restartTimerRef.current = setTimeout(() => {
            if (!shouldKeepListeningRef.current) return;
            try {
              recognition.start();
            } catch {
              // Already active — harmless.
            }
          }, decision.delayMs);
          return;
        }

        shouldKeepListeningRef.current = false;
        setIsListening(false);
        if (decision.giveUpMessage) {
          setMicStatus('ERROR');
          setErrorMessage(decision.giveUpMessage);
        } else {
          setMicStatus('IDLE');
        }
      };

      recognitionRef.current = recognition;
    } catch (err: any) {
      console.warn('[Speech Init Failed]', err);
      setIsSupported(false);
      setMicStatus('SIMULATION');
    }

    return () => {
      shouldKeepListeningRef.current = false;
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {}
      }
      if (transcriptDebounceRef.current) {
        clearTimeout(transcriptDebounceRef.current);
      }
      /*
       * The pending restart must go too. shouldKeepListening is already false
       * above and the timer checks it before starting, so this is belt and
       * braces — but a timer that outlives its component is how a screen the
       * inspector has left keeps holding the microphone.
       */
      if (restartTimerRef.current) {
        clearTimeout(restartTimerRef.current);
      }
      consecutiveErrorsRef.current = 0;
    };
  }, [voiceLang]);

  // Execute parser, play feedback audio, and notify parent
  const handleProcessTranscript = (text: string) => {
    if (!text || !text.trim()) return;

    setMicStatus('PROCESSING');
    const result = parseVoiceCommand(text, currentCategory, items);
    setLastParsedResult(result);

    if (result.matched) {
      // 1. Play Web Audio tone cue
      if (result.status === 'CONDEMNED' || result.status === 'FAIL') {
        playCondemnedBuzz();
      } else if (
        result.status === 'PASS' ||
        result.status === 'REPAIRED' ||
        result.status === 'REPLACED' ||
        result.actionType === 'UNDO' ||
        result.actionType === 'SWITCH_CATEGORY'
      ) {
        playPassChime();
      }

      // 2. Play SpeechSynthesis confirmation
      const announcement =
        voiceLang.startsWith('hi') && result.feedbackMessageHi
          ? result.feedbackMessageHi
          : result.feedbackMessage;
      speakAnnouncement(announcement, voiceLang, ttsEnabled);

      // 3. Handle Category Switching Callback
      if (result.actionType === 'SWITCH_CATEGORY' && result.categoryToSwitch && onCategoryChange) {
        onCategoryChange(result.categoryToSwitch);
      }

      // 4. Handle Undo Callback
      if (result.actionType === 'UNDO' && onUndo) {
        onUndo();
      }

      // 5. Notify Page integration callback
      onCommandParsed(result);
    }

    setTimeout(() => {
      if (shouldKeepListeningRef.current) {
        setMicStatus('LISTENING');
      } else {
        setMicStatus('IDLE');
      }
    }, 1200);
  };

  const handleToggleListening = () => {
    playActionTap();
    if (isListening) {
      shouldKeepListeningRef.current = false;
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {}
      }
      setIsListening(false);
      setMicStatus('IDLE');
    } else {
      shouldKeepListeningRef.current = true;
      setErrorMessage(null);
      if (recognitionRef.current) {
        try {
          // A fresh start is a fresh run: an earlier failing session must not
          // leave this one already partway to its ceiling.
          consecutiveErrorsRef.current = 0;
          lastErrorRef.current = null;
          recognitionRef.current.start();
          setIsListening(true);
          setMicStatus('LISTENING');
        } catch {
          // Restart if needed
          setIsListening(true);
          setMicStatus('LISTENING');
        }
      } else {
        // Fallback simulation mode
        setMicStatus('SIMULATION');
      }
    }
  };

  const handleRunSimulationChip = (chip: VoiceSimulationChip) => {
    playActionTap();
    const text = voiceLang.startsWith('hi') ? chip.phrase : chip.phrase;
    setLiveTranscript(text);
    handleProcessTranscript(text);
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualInput.trim()) return;
    playActionTap();
    setLiveTranscript(manualInput);
    handleProcessTranscript(manualInput);
    setManualInput('');
  };

  return (
    <div className="bg-white/5 border border-white/10 backdrop-blur-md rounded-control p-5 space-y-4">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pb-3 border-b border-line">
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-control flex items-center justify-center text-lg font-extrabold transition-all duration-300 ${
              micStatus === 'LISTENING'
                ? 'bg-bad-soft text-bad-ink ring-2 ring-rose-500/50 animate-pulse'
                : micStatus === 'PROCESSING'
                ? 'bg-warn-soft text-warn-ink ring-2 ring-amber-500/50'
                : 'bg-white/10 text-white'
            }`}
          >
            {null}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-extrabold text-white">
                {t('voice.title') || 'Hands-Free Voice Inspection'}
              </h3>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-[0.07em] bg-accent-soft text-accent-ink border border-accent-line">
                {t('voice.badge') || 'Greasy-Gloves Mode'}
              </span>
            </div>
            <p className="text-xs text-ink-muted">
              {micStatus === 'LISTENING'
                ? (t('voice.listening') || 'Listening continuously for component & status...')
                : micStatus === 'PROCESSING'
                ? 'Processing spoken command...'
                : (t('voice.tryCommand') || 'Speak: "Outer spring passes", "Condemn friction wedge", "Undo"')}
            </p>
          </div>
        </div>

        {/* Top Controls: Language Switch, TTS Toggle, Help */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Language Selector */}
          <div className="flex bg-page p-1 rounded-control border border-line">
            <button
              onClick={() => { playActionTap(); setVoiceLang('en-IN'); }}
              className={`px-3 py-1.5 rounded-control text-xs font-bold transition ${
                voiceLang === 'en-IN'
                  ? 'bg-accent text-white shadow'
                  : 'text-ink-muted hover:text-ink-body'
              }`}
            >
              EN (India)
            </button>
            <button
              onClick={() => { playActionTap(); setVoiceLang('hi-IN'); }}
              className={`px-3 py-1.5 rounded-control text-xs font-bold transition ${
                voiceLang === 'hi-IN'
                  ? 'bg-accent text-white shadow'
                  : 'text-ink-muted hover:text-ink-body'
              }`}
            >
              हिन्दी (hi-IN)
            </button>
          </div>

          {/* TTS Audio Readback Toggle */}
          <button
            onClick={() => { playActionTap(); setTtsEnabled(!ttsEnabled); }}
            title={ttsEnabled ? 'Mute Voice Readback' : 'Enable Voice Readback'}
            className={`p-2.5 rounded-control border text-xs font-bold transition flex items-center gap-1.5 min-h-[38px] ${
              ttsEnabled
                ? 'bg-good-soft border-good-line text-good-ink'
                : 'bg-raised border-line text-ink-faint'
            }`}
          >
            <span>{ttsEnabled ? '' : ''}</span>
            <span className="hidden md:inline">{ttsEnabled ? 'TTS ON' : 'TTS OFF'}</span>
          </button>

          {/* Quick Guide Button */}
          <button
            onClick={() => { playActionTap(); setShowHelp(!showHelp); }}
            className="p-2.5 bg-raised hover:bg-selected border border-line text-ink-body rounded-control text-xs font-bold transition flex items-center gap-1 min-h-[38px]"
          >
            <span></span>
            <span className="hidden md:inline">{t('voice.helpBtn') || 'Guide'}</span>
          </button>
        </div>
      </div>

      {/* Main Microphone Action Bar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center gap-4">
        {/* Big Start / Stop Button (>=48px touch target) */}
        <button
          onClick={handleToggleListening}
          className={`px-6 py-3.5 rounded-control font-bold text-sm transition flex items-center justify-center gap-3 min-h-[52px] ${
            isListening
              ? 'bg-bad hover:bg-bad text-white shadow-sm animate-pulse'
              : 'bg-white text-slate-900 hover:bg-slate-100 shadow-sm'
          }`}
        >
          <span className="text-xl"><MicIcon size={20} /></span>
          <span>{isListening ? (t('voice.stop') || 'Stop Voice Inspection') : (t('voice.start') || 'Start Voice Inspection')}</span>
          {isListening && (
            <span className="flex h-3 w-3 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-white"></span>
            </span>
          )}
        </button>

        {/* Live Floating Transcript Pill */}
        <div className="flex-1 bg-page border border-line rounded-control px-4 py-2.5 flex items-center justify-between min-h-[52px]">
          <div className="flex items-center gap-3 overflow-hidden">
            <span className={`text-base ${isListening ? 'text-bad-ink animate-bounce' : 'text-ink-faint'}`}>
              
            </span>
            <div className="truncate">
              {liveTranscript ? (
                <span className="text-sm font-bold text-ink italic">“{liveTranscript}”</span>
              ) : (
                <span className="text-xs text-ink-faint">
                  {isListening
                    ? (t('voice.listeningPill') || 'Listening for speech input...')
                    : (t('voice.noSpeechYet') || 'No voice command spoken yet. Press microphone or click simulation chips.')}
                </span>
              )}
            </div>
          </div>

          {/* Matched Result Badges */}
          {lastParsedResult && lastParsedResult.matched && (
            <div className="flex items-center gap-2 shrink-0 ml-3">
              {lastParsedResult.actionType === 'UPDATE_STATUS' && (
                <span
                  className={`px-2.5 py-1 rounded-control text-xs font-extrabold tracking-wide uppercase ${
                    lastParsedResult.status === 'CONDEMNED' || lastParsedResult.status === 'FAIL'
                      ? 'bg-bad-soft text-bad-ink border border-bad-line'
                      : 'bg-good-soft text-good-ink border border-good-line'
                  }`}
                >
                   {lastParsedResult.status}
                </span>
              )}
              {lastParsedResult.actionType === 'SWITCH_CATEGORY' && (
                <span className="px-2.5 py-1 rounded-control text-xs font-bold bg-accent-soft text-accent-ink border border-accent-line">
                   {lastParsedResult.categoryToSwitch}
                </span>
              )}
              {lastParsedResult.actionType === 'UNDO' && (
                <span className="px-2.5 py-1 rounded-control text-xs font-bold bg-accent-soft text-accent-ink border border-accent-line">
                  ↩ UNDO
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Spoken Feedback Alert Toast / Banner */}
      {lastParsedResult && (
        <div
          className={`p-3.5 rounded-control border text-xs flex items-center justify-between transition-all duration-300 ${
            lastParsedResult.matched
              ? lastParsedResult.status === 'CONDEMNED' || lastParsedResult.status === 'FAIL'
                ? 'bg-bad-soft border-bad-line text-bad-ink'
                : 'bg-good-soft border-good-line text-good-ink'
              : 'bg-raised border-line text-warn-ink'
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="text-base">{lastParsedResult.matched ? <CheckCircleIcon size={16} /> : <AlertTriangleIcon size={16} />}</span>
            <span className="font-semibold">
              {voiceLang.startsWith('hi') && lastParsedResult.feedbackMessageHi
                ? lastParsedResult.feedbackMessageHi
                : lastParsedResult.feedbackMessage}
            </span>
          </div>
          {lastParsedResult.confidence !== undefined && (
            <span className="text-[10px] opacity-75 font-mono">
              Conf: {(lastParsedResult.confidence * 100).toFixed(0)}%
            </span>
          )}
        </div>
      )}

      {/* Error / Fallback Notice */}
      {errorMessage && (
        <div className="bg-warn-soft border border-warn-line p-3 rounded-control text-xs text-warn-ink flex items-center gap-2">
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Help Modal Reference */}
      {showHelp && (
        <div className="bg-page p-4 rounded-control border border-line space-y-3 text-xs text-ink-body">
          <div className="flex justify-between items-center pb-2 border-b border-line">
            <h4 className="font-bold text-white flex items-center gap-2">
              <span></span>
              {t('voice.help.title') || 'Hands-Free Voice Command Reference'}
            </h4>
            <button
              onClick={() => setShowHelp(false)}
              className="text-ink-muted hover:text-white font-bold"
            >
              
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1 bg-card p-3 rounded-control border border-slate-850">
              <p className="font-bold text-good-ink">1. PASS / Fit Actions:</p>
              <p className="text-[11px] text-ink-muted">
                • "Outer spring passes" / "आउटर स्प्रिंग पास"<br />
                • "Inner spring 1 fit" / "इनर स्प्रिंग ठीक है"<br />
                • "CTRB bearing serviceable" / "सीटीआरबी फिट"
              </p>
            </div>

            <div className="space-y-1 bg-card p-3 rounded-control border border-slate-850">
              <p className="font-bold text-bad-ink">2. CONDEMNED / Scrap Actions:</p>
              <p className="text-[11px] text-ink-muted">
                • "Condemn friction wedge" / "घर्षण वेज कंडम"<br />
                • "Friction wedge reject deep crack"<br />
                • "Outer spring scrap broken coil"
              </p>
            </div>

            <div className="space-y-1 bg-card p-3 rounded-control border border-slate-850">
              <p className="font-bold text-warn-ink">3. Repaired & Replaced:</p>
              <p className="text-[11px] text-ink-muted">
                • "Brake beam repaired and tested" / "मरम्मत किया"<br />
                • "CTRB bearing replaced with new" / "नया लगाया"
              </p>
            </div>

            <div className="space-y-1 bg-card p-3 rounded-control border border-slate-850">
              <p className="font-bold text-accent-ink">4. Category Navigation & Undo:</p>
              <p className="text-[11px] text-ink-muted">
                • "Show bearings" / "Open brake system" / "स्प्रिंग्स खोलो"<br />
                • "Undo" / "Piche lo" / "वापस लो"
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
