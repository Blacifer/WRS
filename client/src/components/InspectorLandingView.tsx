/**
 * InspectorLandingView.tsx
 * Ultra-Clean Shop-Floor Touch-Friendly Landing View for INSPECTOR Role
 * Indian Railways WRS Raipur (Bogie & Wagon QC Section)
 *
 * Designed specifically for shop floor touchscreens and tablets:
 * - Touch targets >= 96px with high contrast and rugged industrial styling
 * - 4 Primary prominent CTA Action Cards
 * - Active wagon inspection resume card
 * - Zero analytics charts, zero pipeline tables, zero admin clutter
 */

import React, { useState, useEffect } from 'react';
import type { User, LanguageCode } from '../../../shared/types.ts';
import { getDictionary } from '../i18n/index.ts';
import { offlineDb } from '../services/offlineDb.ts';
import { CameraIcon, RefreshCwIcon, GlobeIcon, CheckCircleIcon, ShieldIcon } from './Icons.tsx';

export interface InspectorLandingViewProps {
  user: User;
  currentLang: LanguageCode;
  onToggleLang: () => void;
  activeWagonNumber: string | null;
  onSelectWagon: (wagonNumber: string) => void;
  onOpenVoiceInspection: () => void;
  onOpenSmartVision: () => void;
  onOpenSpringQC: () => void;
  onOpenQRScanner: () => void;
  onContinueChecklist: (wagonNumber: string) => void;
  onLogout?: () => void;
}

// Preset workshop wagons for quick 1-tap testing & shop floor selection
const WORKSHOP_WAGONS = [
  { wagonNumber: 'SECR-BOXN-101', type: 'BOXN', railway: 'SECR', stage: 'COMPONENT_INSPECTION', bay: 'Bay 3' },
  { wagonNumber: 'SECR/BOXNHL/2024/9910', type: 'BOXNHL', railway: 'SECR', stage: 'COMPONENT_INSPECTION', bay: 'Bay 2' },
  { wagonNumber: 'SECR/BCN/2023/5041', type: 'BCN', railway: 'SECR', stage: 'DISMANTLING', bay: 'Bay 1' },
  { wagonNumber: 'SECR/BOXNHL/44202', type: 'BOXNHL', railway: 'SECR', stage: 'REASSEMBLY', bay: 'Bay 4' }
];

export const InspectorLandingView: React.FC<InspectorLandingViewProps> = ({
  user,
  currentLang,
  onToggleLang,
  activeWagonNumber,
  onSelectWagon,
  onOpenVoiceInspection,
  onOpenSmartVision,
  onOpenSpringQC,
  onOpenQRScanner,
  onContinueChecklist,
  onLogout
}) => {
  const dict = getDictionary(currentLang);
  const isHi = currentLang === 'hi';

  const [pendingCount, setPendingCount] = useState<number>(0);
  const [isOnline, setIsOnline] = useState<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [isWagonSelectorOpen, setIsWagonSelectorOpen] = useState<boolean>(false);
  const [manualInput, setManualInput] = useState<string>('');

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

  const currentWagonInfo = WORKSHOP_WAGONS.find(w => w.wagonNumber === activeWagonNumber) || {
    wagonNumber: activeWagonNumber || 'SECR-BOXN-101',
    type: 'BOXN',
    railway: 'SECR',
    stage: 'COMPONENT_INSPECTION',
    bay: 'Bay 3'
  };

  const handleManualWagonSelect = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualInput.trim()) {
      onSelectWagon(manualInput.trim().toUpperCase());
      setIsWagonSelectorOpen(false);
      setManualInput('');
    }
  };

  return (
    <div data-testid="inspector-landing-view" className="w-full max-w-6xl mx-auto space-y-6 animate-fadeIn select-none pb-12">
      {/* 1. Shop-Floor Hero Status Header */}
      <div data-testid="inspector-hero-header" className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-2xl backdrop-blur-xl">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-2xl shadow-inner shrink-0">
              👷
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-widest px-2.5 py-0.5 rounded-full bg-blue-950 text-blue-300 border border-blue-800">
                  {isHi ? 'रेलवे क्यूसी निरीक्षक' : 'Railway QC Inspector'}
                </span>
                <span className="text-xs text-slate-400 font-mono">
                  ID: {user.username || 'insp-01'}
                </span>
              </div>
              <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight mt-1">
                {user.name || 'Inspector'}
              </h1>
              <p className="text-xs sm:text-sm text-slate-400 font-medium flex items-center gap-1.5 mt-0.5">
                <span className="text-blue-400">📍</span>
                {isHi ? 'बोगी असेंबली एवं स्प्रिंग ओवरहाल बे 3 (रायपुर डब्लूआरएस)' : 'Bogie Assembly & Spring Overhaul Bay 3 (Raipur WRS)'}
              </p>
            </div>
          </div>

          {/* Status & Quick Bilingual Controls */}
          <div className="flex items-center gap-3 pt-2 md:pt-0 border-t md:border-t-0 border-slate-800">
            {/* Sync & Connectivity Status */}
            <div data-testid="sync-status-badge" className="flex flex-col items-start md:items-end">
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border bg-emerald-950/60 text-emerald-300 border-emerald-800">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                <span>{isOnline ? (isHi ? 'ऑनलाइन सिंक तैयार' : 'Offline Sync Ready') : (isHi ? 'ऑफ़लाइन मोड' : 'Offline Mode')}</span>
              </div>
              <span className="text-[11px] text-slate-400 font-mono mt-1 px-1">
                {pendingCount === 0 
                  ? (isHi ? '0 लंबित लॉग' : '0 Pending Logs') 
                  : `${pendingCount} ${isHi ? 'लंबित सिंक' : 'Pending Sync'}`}
              </span>
            </div>

            {/* Quick Language Toggle (Touch Target >= 48px) */}
            <button
              data-testid="btn-toggle-lang"
              onClick={onToggleLang}
              className="min-w-[48px] min-h-[48px] px-3.5 py-2 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-100 border border-slate-700 rounded-2xl flex items-center justify-center gap-1.5 font-bold text-sm shadow-md transition-all active:scale-95"
              aria-label="Toggle Language"
            >
              <GlobeIcon size={18} className="text-blue-400" />
              <span>{currentLang === 'en' ? 'हिंदी' : 'EN'}</span>
            </button>

            {onLogout && (
              <button
                data-testid="btn-logout"
                onClick={onLogout}
                title={isHi ? 'लॉग आउट' : 'Logout'}
                className="min-w-[48px] min-h-[48px] px-3 py-2 bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/60 rounded-2xl flex items-center justify-center font-bold text-xs shadow-md transition-all active:scale-95"
              >
                {isHi ? 'लॉगआउट' : 'Exit'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 2. Active Wagon Summary Card */}
      <div data-testid="active-wagon-card" className="bg-gradient-to-r from-blue-950/40 via-slate-900 to-indigo-950/30 border-2 border-blue-500/40 rounded-3xl p-5 sm:p-7 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/5 rounded-full blur-3xl pointer-events-none"></div>

        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6 relative z-10">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="px-3 py-1 rounded-full text-xs font-extrabold uppercase tracking-wider bg-blue-900/80 text-blue-200 border border-blue-600 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-blue-400 animate-ping"></span>
                {isHi ? 'सक्रिय निरीक्षण सत्र' : 'Active Inspection Session'}
              </span>
              <span className="text-xs text-slate-400 font-medium">
                {currentWagonInfo.bay}
              </span>
            </div>

            <div>
              <div className="text-xs text-slate-400 font-semibold uppercase tracking-wider">
                {isHi ? 'वर्तमान चयनित वैगन' : 'Current Active Wagon'}
              </div>
              <div data-testid="active-wagon-number" className="text-2xl sm:text-4xl font-black text-white font-mono tracking-wider text-glow-blue mt-0.5">
                {currentWagonInfo.wagonNumber}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-300">
              <span className="px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700">
                {isHi ? 'प्रकार:' : 'Type:'} <strong className="text-white">{currentWagonInfo.type}</strong>
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700">
                {isHi ? 'रेलवे:' : 'Zone:'} <strong className="text-white">{currentWagonInfo.railway}</strong>
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-blue-950 text-blue-300 border border-blue-800">
                {isHi ? 'चरण: घटक निरीक्षण' : 'Stage: Component Inspection'}
              </span>
            </div>
          </div>

          {/* Large Action Buttons on Active Wagon (>= 56px height, spacious touch target) */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <button
              data-testid="btn-continue-checklist"
              onClick={() => onContinueChecklist(currentWagonInfo.wagonNumber)}
              className="min-h-[56px] px-6 py-3 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-extrabold text-base rounded-2xl shadow-xl shadow-blue-900/30 flex items-center justify-center gap-2 transition-all active:scale-95 border border-blue-400"
            >
              <span>{isHi ? 'चेकलिस्ट जारी रखें' : 'Continue Checklist'}</span>
              <span className="text-xl">→</span>
            </button>

            <button
              data-testid="btn-switch-wagon"
              onClick={() => setIsWagonSelectorOpen(true)}
              className="min-h-[56px] px-4 py-3 bg-slate-800/90 hover:bg-slate-700 active:bg-slate-900 text-slate-200 hover:text-white font-bold text-sm rounded-2xl border border-slate-700 flex items-center justify-center gap-2 transition-all active:scale-95"
            >
              <span>🔄</span>
              <span>{isHi ? 'वैगन बदलें' : 'Switch Wagon'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* 3. 4 Primary Large Action Cards (Touch Target >= 96px, High Contrast) */}
      <div>
        <div className="flex items-center justify-between mb-3 px-1">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400">
            {isHi ? 'शॉप-फ्लोर त्वरित क्रियाएं' : 'Shop-Floor Primary Actions'}
          </h2>
          <span className="text-xs text-slate-500 font-mono">
            {isHi ? 'टच-अनुकूल नियंत्रण' : 'Touch-Optimized Controls'}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6">
          {/* Card 1: Scan Wagon QR Code (Orange/Amber) */}
          <button
            data-testid="cta-scan-wagon-qr"
            onClick={onOpenQRScanner}
            className="min-h-[120px] p-6 rounded-3xl border-2 border-amber-500/40 bg-gradient-to-br from-amber-950/40 via-slate-900 to-slate-950 hover:border-amber-400 hover:bg-amber-950/60 active:scale-[0.98] transition-all text-left shadow-xl flex items-center justify-between group cursor-pointer"
          >
            <div className="flex items-start gap-4">
              <div className="w-16 h-16 rounded-2xl bg-amber-500/20 border border-amber-500/50 flex items-center justify-center text-3xl shadow-inner shrink-0 group-hover:scale-105 transition-transform">
                📷
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-extrabold uppercase px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800">
                    QR / RFID
                  </span>
                </div>
                <h3 className="text-xl font-extrabold text-white group-hover:text-amber-300 transition-colors">
                  {isHi ? 'वैगन क्यूआर स्कैन करें' : 'Scan Wagon QR Code'}
                </h3>
                <p className="text-xs sm:text-sm text-slate-300 font-medium line-clamp-2">
                  {isHi 
                    ? 'त्वरित वैगन खोज, आरएफआईडी इनटेक और घटक पासपोर्ट लिंकिंग' 
                    : 'Instant wagon lookup, RFID intake & component passport linking'}
                </p>
              </div>
            </div>
            <div className="hidden sm:flex items-center justify-center w-10 h-10 rounded-xl bg-slate-800 text-amber-400 text-lg group-hover:bg-amber-500 group-hover:text-slate-950 transition-colors shrink-0 ml-2">
              ➔
            </div>
          </button>

          {/* Card 2: Start Voice Inspection (Cyan/Blue) */}
          <button
            data-testid="cta-start-voice"
            onClick={onOpenVoiceInspection}
            className="min-h-[120px] p-6 rounded-3xl border-2 border-cyan-500/40 bg-gradient-to-br from-cyan-950/40 via-slate-900 to-slate-950 hover:border-cyan-400 hover:bg-cyan-950/60 active:scale-[0.98] transition-all text-left shadow-xl flex items-center justify-between group cursor-pointer"
          >
            <div className="flex items-start gap-4">
              <div className="w-16 h-16 rounded-2xl bg-cyan-500/20 border border-cyan-500/50 flex items-center justify-center text-3xl shadow-inner shrink-0 group-hover:scale-105 transition-transform">
                🎙️
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-extrabold uppercase px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800">
                    {isHi ? 'हैंड्स-फ्री वॉयस' : 'Hands-Free Voice'}
                  </span>
                </div>
                <h3 className="text-xl font-extrabold text-white group-hover:text-cyan-300 transition-colors">
                  {isHi ? 'ध्वनि निरीक्षण शुरू करें' : 'Start Voice Inspection'}
                </h3>
                <p className="text-xs sm:text-sm text-slate-300 font-medium line-clamp-2">
                  {isHi 
                    ? 'ग्रीसी ग्लव्स द्विभाषी भाषण कमांड्स (कासनब चेकलिस्ट ऑटो-अपडेट)' 
                    : 'Hands-free "Greasy Gloves" bilingual speech commands for CASNUB checklist'}
                </p>
              </div>
            </div>
            <div className="hidden sm:flex items-center justify-center w-10 h-10 rounded-xl bg-slate-800 text-cyan-400 text-lg group-hover:bg-cyan-500 group-hover:text-slate-950 transition-colors shrink-0 ml-2">
              ➔
            </div>
          </button>

          {/* Card 3: Smart Vision AR Inspection (Emerald Green) */}
          <button
            data-testid="cta-smart-vision"
            onClick={onOpenSmartVision}
            className="min-h-[120px] p-6 rounded-3xl border-2 border-emerald-500/40 bg-gradient-to-br from-emerald-950/40 via-slate-900 to-slate-950 hover:border-emerald-400 hover:bg-emerald-950/60 active:scale-[0.98] transition-all text-left shadow-xl flex items-center justify-between group cursor-pointer"
          >
            <div className="flex items-start gap-4">
              <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 border border-emerald-500/50 flex items-center justify-center text-3xl shadow-inner shrink-0 group-hover:scale-105 transition-transform">
                🔬
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-extrabold uppercase px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800">
                    {isHi ? 'एआई संदर्भ फ़िल्टर' : 'Context Filter AR'}
                  </span>
                </div>
                <h3 className="text-xl font-extrabold text-white group-hover:text-emerald-300 transition-colors">
                  {isHi ? 'स्मार्ट विज़न एआर निरीक्षण' : 'Smart Vision AR Inspection'}
                </h3>
                <p className="text-xs sm:text-sm text-slate-300 font-medium line-clamp-2">
                  {isHi 
                    ? 'वास्तविक समय एआर कैलिपर्स — मानव एवं बैकग्राउंड शोर का स्वतः दमन' 
                    : 'Real-time AR calipers with AI noise & human background suppression'}
                </p>
              </div>
            </div>
            <div className="hidden sm:flex items-center justify-center w-10 h-10 rounded-xl bg-slate-800 text-emerald-400 text-lg group-hover:bg-emerald-500 group-hover:text-slate-950 transition-colors shrink-0 ml-2">
              ➔
            </div>
          </button>

          {/* Card 4: Quick Spring QC (RDSO G-95) (Purple/Indigo) */}
          <button
            data-testid="cta-spring-qc"
            onClick={onOpenSpringQC}
            className="min-h-[120px] p-6 rounded-3xl border-2 border-purple-500/40 bg-gradient-to-br from-purple-950/40 via-slate-900 to-slate-950 hover:border-purple-400 hover:bg-purple-950/60 active:scale-[0.98] transition-all text-left shadow-xl flex items-center justify-between group cursor-pointer"
          >
            <div className="flex items-start gap-4">
              <div className="w-16 h-16 rounded-2xl bg-purple-500/20 border border-purple-500/50 flex items-center justify-center text-3xl shadow-inner shrink-0 group-hover:scale-105 transition-transform">
                🌀
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-extrabold uppercase px-2 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-800">
                    RDSO G-95
                  </span>
                </div>
                <h3 className="text-xl font-extrabold text-white group-hover:text-purple-300 transition-colors">
                  {isHi ? 'त्वरित स्प्रिंग गुणवत्ता जांच' : 'Quick Spring QC (RDSO G-95)'}
                </h3>
                <p className="text-xs sm:text-sm text-slate-300 font-medium line-clamp-2">
                  {isHi 
                    ? '6-बैंड ऊंचाई वर्गीकरण, रंग कोडिंग एवं निंदा सीमा सत्यापन' 
                    : '6-Band height classifier, color coding & condemnation limits'}
                </p>
              </div>
            </div>
            <div className="hidden sm:flex items-center justify-center w-10 h-10 rounded-xl bg-slate-800 text-purple-400 text-lg group-hover:bg-purple-500 group-hover:text-slate-950 transition-colors shrink-0 ml-2">
              ➔
            </div>
          </button>
        </div>
      </div>

      {/* 4. Wagon Switcher / Quick Picker Modal */}
      {isWagonSelectorOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4 animate-fadeIn">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl p-6 shadow-2xl w-full max-w-lg space-y-5">
            <div className="flex justify-between items-center pb-3 border-b border-slate-800">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <span>🚂</span>
                  <span>{isHi ? 'वैगन का चयन करें' : 'Select Workshop Wagon'}</span>
                </h3>
                <p className="text-xs text-slate-400">
                  {isHi ? 'शॉप फ्लोर पर सक्रिय वैगन चुनें या नया नंबर दर्ज करें' : 'Select an active workshop wagon or enter wagon number'}
                </p>
              </div>
              <button
                onClick={() => setIsWagonSelectorOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center font-bold"
              >
                ✕
              </button>
            </div>

            {/* Quick 1-Tap Presets */}
            <div className="space-y-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                {isHi ? 'कार्यशाला में सक्रिय वैगन' : 'Active Workshop Wagons'}
              </span>
              <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto no-scrollbar">
                {WORKSHOP_WAGONS.map(w => (
                  <button
                    key={w.wagonNumber}
                    onClick={() => {
                      onSelectWagon(w.wagonNumber);
                      setIsWagonSelectorOpen(false);
                    }}
                    className={`min-h-[50px] p-3 rounded-xl border flex items-center justify-between text-left transition-all ${
                      w.wagonNumber === activeWagonNumber
                        ? 'bg-blue-950/60 border-blue-500 text-white font-bold'
                        : 'bg-slate-800/60 border-slate-700 text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <div>
                      <div className="font-mono font-bold text-sm">{w.wagonNumber}</div>
                      <div className="text-[11px] text-slate-400">{w.type} • {w.railway} • {w.bay}</div>
                    </div>
                    {w.wagonNumber === activeWagonNumber && (
                      <span className="text-xs font-bold text-blue-400 bg-blue-950 px-2 py-1 rounded border border-blue-700">
                        {isHi ? 'सक्रिय' : 'Active'}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Manual Entry Form */}
            <form onSubmit={handleManualWagonSelect} className="space-y-3 pt-2 border-t border-slate-800">
              <label className="text-xs font-bold text-slate-300 block">
                {isHi ? 'अन्य वैगन नंबर दर्ज करें' : 'Or Enter Wagon Number Manually'}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={manualInput}
                  onChange={(e) => setManualInput(e.target.value)}
                  placeholder="e.g. SECR-BOXN-202"
                  className="flex-1 min-h-[48px] px-4 rounded-xl bg-slate-950 border border-slate-700 text-white font-mono text-sm focus:outline-none focus:border-blue-500 uppercase"
                />
                <button
                  type="submit"
                  disabled={!manualInput.trim()}
                  className="min-h-[48px] px-5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-bold text-sm transition-all"
                >
                  {isHi ? 'चुनें' : 'Select'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
