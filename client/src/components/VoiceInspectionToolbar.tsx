/**
 * Hands-Free Voice Inspection Toolbar ("Greasy Gloves" Solution)
 * Indian Railways WRS Raipur — Component Quality Control System
 *
 * Implements browser Web Speech API recognition, Web Audio sound cues,
 * SpeechSynthesis TTS confirmation, continuous listening, simulation test chips,
 * and live transcript feedback.
 */

import React, { useState, useEffect, useRef } from 'react';
import type {
  CASNUBCategory,
  ChecklistItem,
  VoiceParseResult,
  VoiceLanguageCode,
  VoiceSimulationChip
} from '../../../shared/types.ts';
import { parseVoiceCommand, getCategoryLabelEn, getCategoryLabelHi } from '../utils/voiceCommandParser.ts';
import { playPassChime, playCondemnedBuzz } from '../utils/audioFeedback.ts';
import { useI18n } from '../i18n/index.ts';

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
  const { t, currentLang } = useI18n();
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
        } else if (event.error === 'no-speech') {
          // Normal timeout on silence; will auto-restart if continuous
        } else {
          setErrorMessage(`Speech recognition notice: ${event.error}`);
        }
      };

      recognition.onend = () => {
        if (shouldKeepListeningRef.current) {
          try {
            recognition.start();
          } catch {
            // Ignore if already active
          }
        } else {
          setIsListening(false);
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
    const text = voiceLang.startsWith('hi') ? chip.phrase : chip.phrase;
    setLiveTranscript(text);
    handleProcessTranscript(text);
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualInput.trim()) return;
    setLiveTranscript(manualInput);
    handleProcessTranscript(manualInput);
    setManualInput('');
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-2xl space-y-4">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pb-3 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg font-black transition-all duration-300 ${
              micStatus === 'LISTENING'
                ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/50 animate-pulse ring-4 ring-rose-500/30'
                : micStatus === 'PROCESSING'
                ? 'bg-amber-600 text-white shadow-lg shadow-amber-600/50 animate-bounce'
                : 'bg-slate-800 text-slate-300'
            }`}
          >
            {micStatus === 'LISTENING' ? '🎙️' : micStatus === 'PROCESSING' ? '⚙️' : '🎤'}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-black text-white">
                {t('voice.title') || 'Hands-Free Voice Inspection'}
              </h3>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-orange-500/20 text-orange-400 border border-orange-500/40">
                {t('voice.badge') || 'Greasy-Gloves Mode'}
              </span>
            </div>
            <p className="text-xs text-slate-400">
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
          <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => setVoiceLang('en-IN')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                voiceLang === 'en-IN'
                  ? 'bg-orange-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              EN (India)
            </button>
            <button
              onClick={() => setVoiceLang('hi-IN')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                voiceLang === 'hi-IN'
                  ? 'bg-orange-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              हिन्दी (hi-IN)
            </button>
          </div>

          {/* TTS Audio Readback Toggle */}
          <button
            onClick={() => setTtsEnabled(!ttsEnabled)}
            title={ttsEnabled ? 'Mute Voice Readback' : 'Enable Voice Readback'}
            className={`p-2.5 rounded-xl border text-xs font-bold transition flex items-center gap-1.5 min-h-[38px] ${
              ttsEnabled
                ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
                : 'bg-slate-800 border-slate-700 text-slate-500'
            }`}
          >
            <span>{ttsEnabled ? '🔊' : '🔇'}</span>
            <span className="hidden md:inline">{ttsEnabled ? 'TTS ON' : 'TTS OFF'}</span>
          </button>

          {/* Quick Guide Button */}
          <button
            onClick={() => setShowHelp(!showHelp)}
            className="p-2.5 bg-slate-800 hover:bg-slate-750 border border-slate-700 text-slate-300 rounded-xl text-xs font-bold transition flex items-center gap-1 min-h-[38px]"
          >
            <span>📖</span>
            <span className="hidden md:inline">{t('voice.helpBtn') || 'Guide'}</span>
          </button>
        </div>
      </div>

      {/* Main Microphone Action Bar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center gap-4">
        {/* Big Start / Stop Button (>=48px touch target) */}
        <button
          onClick={handleToggleListening}
          className={`px-6 py-3.5 rounded-xl font-bold text-sm transition flex items-center justify-center gap-3 shadow-xl min-h-[52px] ${
            isListening
              ? 'bg-rose-600 hover:bg-rose-500 text-white ring-4 ring-rose-600/30 animate-pulse'
              : 'bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white shadow-orange-600/30'
          }`}
        >
          <span className="text-xl">{isListening ? '🛑' : '🎙️'}</span>
          <span>{isListening ? (t('voice.stop') || 'Stop Voice Inspection') : (t('voice.start') || 'Start Voice Inspection')}</span>
          {isListening && (
            <span className="flex h-3 w-3 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-white"></span>
            </span>
          )}
        </button>

        {/* Live Floating Transcript Pill */}
        <div className="flex-1 bg-slate-950/80 border border-slate-800 rounded-xl px-4 py-2.5 flex items-center justify-between min-h-[52px]">
          <div className="flex items-center gap-3 overflow-hidden">
            <span className={`text-base ${isListening ? 'text-rose-500 animate-bounce' : 'text-slate-500'}`}>
              💬
            </span>
            <div className="truncate">
              {liveTranscript ? (
                <span className="text-sm font-bold text-slate-100 italic">“{liveTranscript}”</span>
              ) : (
                <span className="text-xs text-slate-500">
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
                  className={`px-2.5 py-1 rounded-lg text-xs font-black tracking-wide uppercase ${
                    lastParsedResult.status === 'CONDEMNED' || lastParsedResult.status === 'FAIL'
                      ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                      : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                  }`}
                >
                  ✓ {lastParsedResult.status}
                </span>
              )}
              {lastParsedResult.actionType === 'SWITCH_CATEGORY' && (
                <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-blue-500/20 text-blue-400 border border-blue-500/40">
                  📂 {lastParsedResult.categoryToSwitch}
                </span>
              )}
              {lastParsedResult.actionType === 'UNDO' && (
                <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-purple-500/20 text-purple-400 border border-purple-500/40">
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
          className={`p-3.5 rounded-xl border text-xs flex items-center justify-between transition-all duration-300 ${
            lastParsedResult.matched
              ? lastParsedResult.status === 'CONDEMNED' || lastParsedResult.status === 'FAIL'
                ? 'bg-rose-950/60 border-rose-500/40 text-rose-200'
                : 'bg-emerald-950/60 border-emerald-500/40 text-emerald-200'
              : 'bg-slate-800/80 border-slate-700 text-amber-300'
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="text-base">{lastParsedResult.matched ? '✅' : '⚠️'}</span>
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
        <div className="bg-amber-950/40 border border-amber-800/60 p-3 rounded-xl text-xs text-amber-300 flex items-center gap-2">
          <span>⚠️</span>
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Interactive Simulation Chips (For Hands-Free E2E Testing & Demo fallback) */}
      <div className="space-y-2 pt-2">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span className="font-bold flex items-center gap-1.5">
            <span>⚡</span>
            {t('voice.simulation.title') || 'Quick Voice Simulation Chips:'}
          </span>
          <span className="text-[10px] text-slate-500">1-click touch/E2E test simulation</span>
        </div>

        <div className="flex flex-wrap gap-2">
          {simulationChips.map((chip) => {
            const isPass = chip.expectedStatus === 'PASS';
            const isCondemn = chip.expectedStatus === 'CONDEMNED';
            const isNav = chip.intent === 'SWITCH_CATEGORY';
            const isUndo = chip.intent === 'UNDO';

            return (
              <button
                key={chip.id}
                onClick={() => handleRunSimulationChip(chip)}
                className={`px-3 py-2 rounded-xl text-xs font-bold border transition duration-150 flex items-center gap-1.5 min-h-[44px] ${
                  isCondemn
                    ? 'bg-rose-950/50 hover:bg-rose-900/70 border-rose-800/60 text-rose-300'
                    : isPass
                    ? 'bg-emerald-950/50 hover:bg-emerald-900/70 border-emerald-800/60 text-emerald-300'
                    : isNav
                    ? 'bg-blue-950/50 hover:bg-blue-900/70 border-blue-800/60 text-blue-300'
                    : isUndo
                    ? 'bg-purple-950/50 hover:bg-purple-900/70 border-purple-800/60 text-purple-300'
                    : 'bg-slate-800 hover:bg-slate-750 border-slate-700 text-slate-200'
                }`}
              >
                <span>
                  {isCondemn ? '❌' : isPass ? '✓' : isNav ? '📂' : isUndo ? '↩' : '🔧'}
                </span>
                <span>{voiceLang.startsWith('hi') ? chip.labelHi : chip.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Manual Text Simulation Input Bar */}
      <form onSubmit={handleManualSubmit} className="flex gap-2 pt-1">
        <input
          type="text"
          value={manualInput}
          onChange={(e) => setManualInput(e.target.value)}
          placeholder={
            voiceLang.startsWith('hi')
              ? 'सिम्युलेटेड वॉयस कमांड टाइप करें (जैसे: "आउटर स्प्रिंग पास", "घर्षण वेज कंडम")...'
              : 'Type spoken command simulation (e.g. "Outer spring passes", "Condemn friction wedge", "Undo")...'
          }
          className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500"
        />
        <button
          type="submit"
          disabled={!manualInput.trim()}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-750 disabled:opacity-50 text-orange-400 border border-slate-700 rounded-xl text-xs font-bold transition min-h-[40px]"
        >
          Execute
        </button>
      </form>

      {/* Help Modal Reference */}
      {showHelp && (
        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3 text-xs text-slate-300">
          <div className="flex justify-between items-center pb-2 border-b border-slate-800">
            <h4 className="font-bold text-white flex items-center gap-2">
              <span>📖</span>
              {t('voice.help.title') || 'Hands-Free Voice Command Reference'}
            </h4>
            <button
              onClick={() => setShowHelp(false)}
              className="text-slate-400 hover:text-white font-bold"
            >
              ✕
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1 bg-slate-900/60 p-3 rounded-lg border border-slate-850">
              <p className="font-bold text-emerald-400">1. PASS / Fit Actions:</p>
              <p className="text-[11px] text-slate-400">
                • "Outer spring passes" / "आउटर स्प्रिंग पास"<br />
                • "Inner spring 1 fit" / "इनर स्प्रिंग ठीक है"<br />
                • "CTRB bearing serviceable" / "सीटीआरबी फिट"
              </p>
            </div>

            <div className="space-y-1 bg-slate-900/60 p-3 rounded-lg border border-slate-850">
              <p className="font-bold text-rose-400">2. CONDEMNED / Scrap Actions:</p>
              <p className="text-[11px] text-slate-400">
                • "Condemn friction wedge" / "घर्षण वेज कंडम"<br />
                • "Friction wedge reject deep crack"<br />
                • "Outer spring scrap broken coil"
              </p>
            </div>

            <div className="space-y-1 bg-slate-900/60 p-3 rounded-lg border border-slate-850">
              <p className="font-bold text-amber-400">3. Repaired & Replaced:</p>
              <p className="text-[11px] text-slate-400">
                • "Brake beam repaired and tested" / "मरम्मत किया"<br />
                • "CTRB bearing replaced with new" / "नया लगाया"
              </p>
            </div>

            <div className="space-y-1 bg-slate-900/60 p-3 rounded-lg border border-slate-850">
              <p className="font-bold text-blue-400">4. Category Navigation & Undo:</p>
              <p className="text-[11px] text-slate-400">
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
