/**
 * InspectorLandingView.tsx
 * The inspector's home screen
 * Indian Railways WRS Raipur (Bogie & Wagon QC Section)
 *
 * One question per screen, one primary action.
 *
 * This screen used to open with a wall of eight gradient cards, each with an
 * emoji in a 64px tile, and its own copies of the language toggle and the exit
 * button that the header already carries. Everything was the same size, so
 * nothing was the answer to "what do I do next" — and the ~900-a-day job was
 * the fourth card down.
 *
 * Now the work mode decides what the screen is about, and whichever mode is
 * chosen gets exactly one large primary action with the rest subordinate to
 * it.
 */

import React, { useState, useEffect } from 'react';
import type { User, LanguageCode, WagonRecord } from '../../../shared/types.ts';
import { offlineDb } from '../services/offlineDb.ts';
import { api } from '../services/api.ts';
import {
  CameraIcon, CoilIcon, CaliperIcon, CpuIcon, MicIcon, BookIcon, SearchIcon, RefreshCwIcon
} from './Icons.tsx';
import { WagonNumberCamera } from './WagonNumberCamera.tsx';
import { Button, Card, Chip, IconButton, Note, inputClass } from './ui/index.tsx';

export interface InspectorLandingViewProps {
  user: User;
  currentLang: LanguageCode;
  onToggleLang: () => void;
  activeWagonNumber: string | null;
  onSelectWagon: (wagonNumber: string) => void;
  onOpenVoiceInspection: () => void;
  onOpenSmartVision: () => void;
  onOpenSpringSorting: () => void;
  onOpenSpringQC: () => void;
  onOpenQRScanner: () => void;
  onContinueChecklist: (wagonNumber: string) => void;
  onLogout?: () => void;
}

export const InspectorLandingView: React.FC<InspectorLandingViewProps> = ({
  user,
  currentLang,
  activeWagonNumber,
  onSelectWagon,
  onOpenVoiceInspection,
  onOpenSmartVision,
  onOpenSpringSorting,
  onOpenSpringQC,
  onOpenQRScanner,
  onContinueChecklist
}) => {
  const isHi = currentLang === 'hi';

  const [pendingCount, setPendingCount] = useState<number>(0);
  const [isOnline, setIsOnline] = useState<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [isWagonSelectorOpen, setIsWagonSelectorOpen] = useState<boolean>(false);
  const [manualInput, setManualInput] = useState<string>('');
  const [showNumberCamera, setShowNumberCamera] = useState(false);

  /*
   * Which job this person is doing.
   *
   * Springs and wagons are different work, done by different people, and
   * clubbing them made the spring screen open with "No Active Wagon — scan a
   * QR code or select a wagon to get started". For somebody whose whole shift
   * is sorting ~700 springs, that is the wrong question, asked first, in the
   * largest box on the screen.
   *
   * Remembered per device, because a person sorting springs today is almost
   * certainly sorting springs tomorrow, and asking every morning is its own
   * kind of noise. Changing it is one tap.
   */
  const [workMode, setWorkMode] = useState<'SPRINGS' | 'WAGON' | null>(() => {
    try {
      const saved = localStorage.getItem('wrs-work-mode');
      return saved === 'SPRINGS' || saved === 'WAGON' ? saved : null;
    } catch {
      return null;
    }
  });

  const chooseWorkMode = (mode: 'SPRINGS' | 'WAGON') => {
    setWorkMode(mode);
    try { localStorage.setItem('wrs-work-mode', mode); } catch { /* private windows */ }
  };

  const [activeWagonInfo, setActiveWagonInfo] = useState<WagonRecord | null>(null);
  const [activeWagonLoadFailed, setActiveWagonLoadFailed] = useState<boolean>(false);
  const [recentWagons, setRecentWagons] = useState<WagonRecord[]>([]);

  /*
   * Today's real figures, not a decorative number.
   *
   * The shop's own count for the day, from the same endpoint the sorting
   * screen reads. If it cannot be fetched the panel says so rather than
   * showing a zero, because a zero here would read as "you have done nothing
   * today" to somebody who has been sorting since seven.
   */
  const [today, setToday] = useState<{ total: number; condemned: number } | null>(null);
  const [todayFailed, setTodayFailed] = useState(false);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    const unsubscribe = offlineDb.onPendingCountChange(setPendingCount);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.getSortingThroughput()
      .then((res) => {
        if (cancelled) return;
        if (res?.data) setToday({ total: res.data.total ?? 0, condemned: res.data.condemned ?? 0 });
        else setTodayFailed(true);
      })
      .catch(() => { if (!cancelled) setTodayFailed(true); });
    return () => { cancelled = true; };
  }, []);

  // Look up the real record for the currently active wagon (if any) — never
  // fabricate placeholder data for a wagon that isn't actually in the system.
  useEffect(() => {
    let cancelled = false;
    if (!activeWagonNumber) {
      setActiveWagonInfo(null);
      setActiveWagonLoadFailed(false);
      return;
    }
    setActiveWagonLoadFailed(false);
    api.getWagonDetail(activeWagonNumber)
      .then((res) => {
        if (cancelled) return;
        setActiveWagonInfo(res?.data || null);
        if (!res?.data) setActiveWagonLoadFailed(true);
      })
      .catch(() => {
        if (!cancelled) setActiveWagonLoadFailed(true);
      });
    return () => { cancelled = true; };
  }, [activeWagonNumber]);

  // Real, currently in-progress wagons for the quick-pick switcher — not a
  // hardcoded demo list that would 404 the moment someone selects it.
  useEffect(() => {
    if (!isWagonSelectorOpen) return;
    api.queryWagons({ limit: 8 })
      .then((res) => setRecentWagons((res?.data || []).filter(w => w.currentStage !== 'RELEASE')))
      .catch(() => setRecentWagons([]));
  }, [isWagonSelectorOpen]);

  const handleManualWagonSelect = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualInput.trim()) {
      onSelectWagon(manualInput.trim().toUpperCase());
      setIsWagonSelectorOpen(false);
      setManualInput('');
    }
  };

  /* A large card that is the answer to "what do I do next". */
  const PrimaryAction: React.FC<{
    onClick: () => void;
    eyebrow: string;
    title: string;
    detail: string;
    icon: React.ReactNode;
    testId?: string;
  }> = ({ onClick, eyebrow, title, detail, icon, testId }) => (
    <button
      data-testid={testId}
      onClick={onClick}
      className="w-full text-left p-6 rounded-touch bg-accent border border-accent-hover
                 hover:bg-accent-hover transition-colors active:scale-[0.99]"
    >
      <div className="flex items-center justify-between gap-4">
        <span className="text-white">{icon}</span>
        <span className="text-[11px] font-bold uppercase tracking-[0.07em] text-white/70">{eyebrow}</span>
      </div>
      <div className="mt-4 text-2xl font-extrabold tracking-[-0.02em] text-white">{title}</div>
      <div className="mt-1 text-sm font-medium text-white/80">{detail}</div>
    </button>
  );

  /* Everything that is not the primary action. */
  const SecondaryAction: React.FC<{
    onClick: () => void;
    title: string;
    icon: React.ReactNode;
    testId?: string;
  }> = ({ onClick, title, icon, testId }) => (
    <button
      data-testid={testId}
      onClick={onClick}
      className="min-h-[112px] w-full text-left p-4 rounded-card bg-card border border-line
                 hover:border-line-strong hover:bg-raised transition-colors active:scale-[0.99]
                 flex flex-col items-start gap-3"
    >
      <span className="text-accent-ink">{icon}</span>
      <span className="text-[15px] font-bold text-ink-body leading-snug">{title}</span>
    </button>
  );

  return (
    <div data-testid="inspector-landing-view" className="w-full max-w-3xl mx-auto space-y-5 animate-fadeIn pb-10">

      {/* Who and where. The header already carries language and sign-out, so
          this no longer keeps its own duplicate pair of them. */}
      <div data-testid="inspector-hero-header" className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-muted">
            {isHi ? 'रेलवे क्यूसी निरीक्षक' : 'Railway QC Inspector'}
          </div>
          <h1 className="mt-1 text-[26px] font-extrabold tracking-[-0.025em] text-ink">
            {user.name || 'Inspector'}
          </h1>
          <p className="mt-1 text-[13px] font-medium text-ink-muted">
            {isHi
              ? 'बोगी असेंबली एवं स्प्रिंग ओवरहाल बे 3'
              : 'Bogie Assembly & Spring Overhaul Bay 3'}
            {' · '}
            {user.username || 'insp-01'}
          </p>
        </div>

        <div data-testid="sync-status-badge" className="text-right">
          <Chip tone={isOnline ? 'good' : 'warn'} dot>
            {isOnline
              ? (isHi ? 'ऑनलाइन' : 'Online')
              : (isHi ? 'ऑफ़लाइन मोड' : 'Offline mode')}
          </Chip>
          <div className="mt-1.5 text-[11px] font-semibold text-ink-faint tabular">
            {pendingCount === 0
              ? (isHi ? 'भेजने के लिए कुछ नहीं' : 'Nothing waiting to send')
              : `${pendingCount} ${isHi ? 'लंबित' : 'waiting to send'}`}
          </div>
        </div>
      </div>

      {/*
        Which job is on screen, and how to change it.

        This was a 12px underlined text link reading "Switch to a wagon",
        sitting on a page otherwise made of large colour cards — the faintest
        thing on screen was the only control that changed what the whole
        screen did. An inspector who had once chosen springs was reported as
        unable to find wagon work at all, and they were right to look at the
        top: the inspector's navigation bar carries no wagon entry, so the
        home screen is the only route there is.

        Both jobs are always visible as a pair, so the choice explains itself
        — you can see there IS a wagon side even while you are on the spring
        side — and both are full touch targets for a gloved hand.
      */}
      <div>
        <span className="block mb-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-muted">
          {workMode === null
            ? (isHi ? 'आज आप क्या कर रहे हैं?' : 'What are you working on today?')
            : (isHi ? 'आज का कार्य' : 'What you are working on')}
        </span>
        <div
          role="group"
          aria-label={isHi ? 'आज का कार्य' : 'What you are working on'}
          className="grid grid-cols-2 gap-1.5 p-1.5 bg-card border border-line rounded-touch"
        >
          {([
            { mode: 'SPRINGS' as const, en: 'Springs', hi: 'स्प्रिंग', testId: 'choose-springs' },
            { mode: 'WAGON' as const, en: 'A wagon', hi: 'वैगन', testId: 'choose-wagon' }
          ]).map((choice) => {
            const current = workMode === choice.mode;
            return (
              <button
                key={choice.mode}
                data-testid={workMode === null ? choice.testId : (current ? 'work-mode-current' : 'switch-work-mode')}
                aria-pressed={current}
                onClick={() => chooseWorkMode(choice.mode)}
                className={[
                  'min-h-[52px] px-4 rounded-control text-[15px] font-bold transition-colors',
                  current ? 'bg-selected text-ink' : 'text-ink-muted hover:text-ink hover:bg-raised'
                ].join(' ')}
              >
                {isHi ? choice.hi : choice.en}
              </button>
            );
          })}
        </div>
        {workMode === null && (
          <Note className="mt-2">
            {isHi
              ? 'बाद में कभी भी बदल सकते हैं — यह सिर्फ़ तय करता है कि यह स्क्रीन क्या दिखाए।'
              : 'You can change this any time — it just decides what this screen shows.'}
          </Note>
        )}
      </div>

      {/* ---------------------------------------------------------- SPRINGS */}
      {workMode === 'SPRINGS' && (
        <div className="space-y-3">
          <PrimaryAction
            onClick={onOpenSpringSorting}
            eyebrow={isHi ? 'आज का काम' : "Today's work"}
            title={isHi ? 'स्प्रिंग छँटाई' : 'Sort springs'}
            detail={isHi
              ? 'पट्टी से मिलाकर बैंड दबाएँ — खुले स्प्रिंग, वैगन नंबर नहीं चाहिए'
              : 'Tap the band against the strip — loose springs, no wagon number needed'}
            icon={<CoilIcon size={30} />}
          />

          {/* The shop's own count for today. */}
          <Card>
            <div className="px-5 py-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-muted">
                {isHi ? 'आज, सभी सत्र' : 'Today, all sessions'}
              </div>
              {today ? (
                <div className="flex items-baseline gap-6 mt-2">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[40px] leading-none font-extrabold tracking-[-0.035em] text-ink tabular">
                      {today.total}
                    </span>
                    <span className="text-sm font-semibold text-ink-muted">
                      {isHi ? 'छँटे' : 'sorted'}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-extrabold text-bad-ink tabular">{today.condemned}</span>
                    <span className="text-sm font-semibold text-ink-muted">
                      {isHi ? 'कंडम' : 'condemned'}
                    </span>
                  </div>
                </div>
              ) : (
                <Note className="mt-2">
                  {todayFailed
                    ? (isHi
                      ? 'आज की गिनती अभी नहीं मिली — छँटाई फिर भी दर्ज होती रहेगी।'
                      : "Today's count could not be fetched. Sorting still records normally.")
                    : (isHi ? 'गिनती लाई जा रही है…' : 'Fetching the count…')}
                </Note>
              )}
            </div>
          </Card>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <SecondaryAction
              testId="cta-spring-qc"
              onClick={onOpenSpringQC}
              title={isHi ? 'एक स्प्रिंग दर्ज करें' : 'Record one spring'}
              icon={<CaliperIcon size={24} />}
            />
            <SecondaryAction
              testId="cta-smart-vision"
              onClick={onOpenSmartVision}
              title={isHi ? 'स्प्रिंग बैच — पूरा वैगन' : 'Spring batch — whole wagon'}
              icon={<CpuIcon size={24} />}
            />
            <SecondaryAction
              onClick={() => setIsWagonSelectorOpen(true)}
              title={isHi ? 'वैगन चुनें' : 'Pick a wagon'}
              icon={<SearchIcon size={24} />}
            />
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------- WAGON */}
      {workMode === 'WAGON' && (
        <div className="space-y-3">
          <Card tone="accent" data-testid="active-wagon-card">
            <div className="px-5 py-5">
              {!activeWagonNumber ? (
                <>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-muted">
                    {isHi ? 'कोई सक्रिय वैगन नहीं' : 'No active wagon'}
                  </div>
                  <p className="mt-1.5 text-sm text-ink-body">
                    {isHi ? 'शुरू करने के लिए QR स्कैन करें या वैगन चुनें' : 'Scan a QR code or pick a wagon to get started'}
                  </p>
                  <div className="flex flex-wrap gap-3 mt-4">
                    <Button variant="primary" size="touch" onClick={onOpenQRScanner}>
                      <CameraIcon size={20} />
                      <span>{isHi ? 'QR स्कैन करें' : 'Scan QR'}</span>
                    </Button>
                    <Button
                      data-testid="btn-switch-wagon"
                      size="touch"
                      onClick={() => setIsWagonSelectorOpen(true)}
                    >
                      <SearchIcon size={20} />
                      <span>{isHi ? 'वैगन चुनें' : 'Pick a wagon'}</span>
                    </Button>
                  </div>
                </>
              ) : activeWagonLoadFailed ? (
                <>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-bad-ink">
                    {isHi ? 'वैगन नहीं मिला' : 'Wagon not found'}
                  </div>
                  <p className="mt-1.5 text-lg font-bold text-ink tabular">{activeWagonNumber}</p>
                  <Button
                    data-testid="btn-switch-wagon"
                    size="touch"
                    className="mt-4"
                    onClick={() => setIsWagonSelectorOpen(true)}
                  >
                    <RefreshCwIcon size={18} />
                    <span>{isHi ? 'वैगन बदलें' : 'Switch wagon'}</span>
                  </Button>
                </>
              ) : (
                <>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-muted">
                    {isHi ? 'सक्रिय वैगन' : 'Active wagon'}
                  </div>
                  <div
                    data-testid="active-wagon-number"
                    className="mt-1 text-2xl font-extrabold tracking-[-0.02em] text-ink tabular"
                  >
                    {activeWagonNumber}
                  </div>

                  {activeWagonInfo && (
                    <div className="flex flex-wrap items-center gap-2 mt-3">
                      <Chip>{activeWagonInfo.wagonType}</Chip>
                      <Chip>{activeWagonInfo.owningRailway}</Chip>
                      <Chip tone="warn">{activeWagonInfo.currentStage}</Chip>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-3 mt-5">
                    <Button
                      data-testid="btn-continue-checklist"
                      variant="primary"
                      size="touch"
                      onClick={() => onContinueChecklist(activeWagonNumber)}
                    >
                      {isHi ? 'चेकलिस्ट जारी रखें' : 'Continue checklist'}
                    </Button>
                    <Button
                      data-testid="btn-switch-wagon"
                      size="touch"
                      onClick={() => setIsWagonSelectorOpen(true)}
                    >
                      <RefreshCwIcon size={18} />
                      <span>{isHi ? 'वैगन बदलें' : 'Switch wagon'}</span>
                    </Button>
                  </div>
                </>
              )}
            </div>
          </Card>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <SecondaryAction
              testId="cta-scan-wagon-qr"
              onClick={onOpenQRScanner}
              title={isHi ? 'वैगन QR स्कैन करें' : 'Scan wagon QR'}
              icon={<CameraIcon size={24} />}
            />
            <SecondaryAction
              testId="cta-start-voice"
              onClick={() => {
                // A voice inspection needs a wagon. Without one this used to
                // hand the inspector a QR scanner, which is both a confusing
                // response to this button and useless at Raipur, where wagons
                // carry no QR codes yet. Open the wagon picker instead.
                if (activeWagonNumber) onOpenVoiceInspection();
                else setIsWagonSelectorOpen(true);
              }}
              title={isHi ? 'ध्वनि निरीक्षण' : 'Voice inspection'}
              icon={<MicIcon size={24} />}
            />
            <SecondaryAction
              onClick={onOpenSpringQC}
              title={isHi ? 'एक स्प्रिंग दर्ज करें' : 'Record one spring'}
              icon={<CaliperIcon size={24} />}
            />
          </div>

          <Note>
            {isHi
              ? 'वैगन QR कोड अभी कार्यशाला में नहीं लगे हैं — तब तक नंबर चुनें या टाइप करें।'
              : 'Wagon QR codes are not in place in the workshop yet — until they are, pick or type the number.'}
          </Note>
        </div>
      )}

      {/* The manual is reachable from either job. */}
      <Note className="pt-1">
        <span className="inline-flex items-center gap-2">
          <BookIcon size={14} />
          {isHi
            ? 'पुर्जा हाथ में हो और सीमा याद न आए — ऊपर मैनुअल खोलें।'
            : 'Holding a component and unsure of the limit — open the manual from the bar above.'}
        </span>
      </Note>

      {/* Wagon switcher / quick picker */}
      {isWagonSelectorOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4 animate-fadeIn"
          onClick={() => setIsWagonSelectorOpen(false)}
        >
          <Card className="w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-start gap-4 px-5 py-4 bg-raised border-b border-line">
              <div>
                <h3 className="text-base font-bold text-ink">
                  {isHi ? 'वैगन का चयन करें' : 'Select a wagon'}
                </h3>
                <p className="text-xs text-ink-muted mt-0.5">
                  {isHi ? 'कार्यशाला में सक्रिय वैगन, या नंबर दर्ज करें' : 'A wagon active in the shop, or type the number'}
                </p>
              </div>
              <IconButton
                variant="quiet"
                size="sm"
                label={isHi ? 'बंद करें' : 'Close'}
                onClick={() => setIsWagonSelectorOpen(false)}
              >
                <span className="text-lg leading-none">✕</span>
              </IconButton>
            </div>

            <div className="px-5 py-4 space-y-4">
              <div className="space-y-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-muted">
                  {isHi ? 'कार्यशाला में सक्रिय' : 'Active in the shop'}
                </span>
                <div className="grid grid-cols-1 gap-2 max-h-56 overflow-y-auto no-scrollbar">
                  {recentWagons.length === 0 && (
                    <Note>
                      {isHi ? 'कोई वैगन नहीं मिला — नीचे नंबर दर्ज करें' : 'No wagons found — enter a number below'}
                    </Note>
                  )}
                  {recentWagons.map(w => {
                    const current = w.wagonNumber === activeWagonNumber;
                    return (
                      <button
                        key={w.wagonNumber}
                        onClick={() => {
                          onSelectWagon(w.wagonNumber);
                          setIsWagonSelectorOpen(false);
                        }}
                        className={[
                          'min-h-[56px] px-4 py-2.5 rounded-control border text-left transition-colors',
                          'flex items-center justify-between gap-3',
                          current
                            ? 'bg-accent-soft border-accent-line'
                            : 'bg-sunken border-line hover:border-line-strong'
                        ].join(' ')}
                      >
                        <span className="min-w-0">
                          <span className="block text-sm font-bold text-ink tabular">{w.wagonNumber}</span>
                          <span className="block text-[11px] text-ink-faint mt-0.5">
                            {w.wagonType} · {w.owningRailway} · {w.currentStage}
                          </span>
                        </span>
                        {current && <Chip tone="accent">{isHi ? 'सक्रिय' : 'Active'}</Chip>}
                      </button>
                    );
                  })}
                </div>
              </div>

              <form onSubmit={handleManualWagonSelect} className="space-y-2 pt-3 border-t border-line">
                <label htmlFor="wagon-manual" className="block text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-muted">
                  {isHi ? 'या नंबर दर्ज करें' : 'Or enter the number'}
                </label>
                <div className="flex gap-2">
                  <input
                    id="wagon-manual"
                    type="text"
                    value={manualInput}
                    onChange={(e) => setManualInput(e.target.value)}
                    placeholder="e.g. SECR-BOXN-202"
                    className={inputClass + ' uppercase flex-1'}
                  />
                  {/*
                    An inspector had no way to read a wagon number with the
                    camera at all — it existed only inside the supervisor's
                    Register New Wagon form. Typing eleven digits with gloves
                    on, standing at the wagon, is exactly the task a camera is
                    for.
                  */}
                  <IconButton
                    label={isHi ? 'वैगन नंबर स्कैन करें' : 'Read the number painted on the wagon'}
                    onClick={() => setShowNumberCamera(true)}
                    type="button"
                  >
                    <CameraIcon size={20} />
                  </IconButton>
                  <Button type="submit" variant="primary" disabled={!manualInput.trim()}>
                    {isHi ? 'चुनें' : 'Select'}
                  </Button>
                </div>
              </form>

              {showNumberCamera && (
                <WagonNumberCamera
                  lang={isHi ? 'hi' : 'en'}
                  onRead={(num) => {
                    setManualInput(num);
                    setShowNumberCamera(false);
                  }}
                  onClose={() => setShowNumberCamera(false)}
                />
              )}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};
