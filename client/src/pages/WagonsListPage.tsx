/**
 * Wagons Pipeline & Registration List Page (Phase 2 - R1)
 * Indian Railways WRS Raipur
 */

import React, { useEffect, useState } from 'react';
import { api } from '../services/api.ts';
import { offlineDb } from '../services/offlineDb.ts';
import { useI18n } from '../i18n/index.ts';
import { WagonNumberCamera } from '../components/WagonNumberCamera.tsx';
import type { WagonRecord, LifecycleStage } from '../../../shared/types.ts';

interface WagonsListPageProps {
  onSelectWagon: (wagonNumber: string) => void;
}

export const WagonsListPage: React.FC<WagonsListPageProps> = ({ onSelectWagon }) => {
  const { t, lang } = useI18n();
  const isHi = lang === 'hi';
  const [wagons, setWagons] = useState<WagonRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [stageFilter, setStageFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [pipelineCounts, setPipelineCounts] = useState<Record<string, number>>({});

  // Register Modal State
  const [showRegisterModal, setShowRegisterModal] = useState<boolean>(false);
  // Reads the number painted on the wagon rather than having it typed.
  const [showNumberCamera, setShowNumberCamera] = useState(false);
  const [showSearchCamera, setShowSearchCamera] = useState(false);
  const [newWagonNumber, setNewWagonNumber] = useState<string>('');
  const [newWagonType, setNewWagonType] = useState<string>('BOXNHL');
  const [newOwningRailway, setNewOwningRailway] = useState<string>('SECR');
  const [newEntryNotes, setNewEntryNotes] = useState<string>('');
  const [registering, setRegistering] = useState<boolean>(false);
  const [registerError, setRegisterError] = useState<string | null>(null);

  const stages: Array<{ key: LifecycleStage | 'ALL'; label: string; icon: string }> = [
    { key: 'ALL', label: 'All Wagons', icon: '🚂' },
    { key: 'ENTRY_REGISTRATION', label: '1. Registration', icon: '📝' },
    { key: 'DISMANTLING', label: '2. Dismantling', icon: '🔧' },
    { key: 'COMPONENT_INSPECTION', label: '3. Inspection', icon: '🔍' },
    { key: 'REPAIR_REPLACEMENT', label: '4. Repair', icon: '⚙️' },
    { key: 'REASSEMBLY', label: '5. Reassembly', icon: '🏗️' },
    { key: 'FINAL_QC_GATE', label: '6. QC Gate', icon: '🛡️' },
    { key: 'RELEASE', label: '7. Released', icon: '✅' }
  ];

  useEffect(() => {
    loadWagons();
  }, [stageFilter, searchQuery]);

  const loadWagons = async () => {
    try {
      setLoading(true);
      if (navigator.onLine) {
        const res = await api.queryWagons({
          stage: stageFilter === 'ALL' ? undefined : stageFilter,
          search: searchQuery || undefined,
          limit: 100
        });
        setWagons(res.data);
        await offlineDb.cacheWagons(res.data);

        // Load pipeline summary
        const pipeRes = await api.getAnalyticsPipeline();
        setPipelineCounts(pipeRes.data.counts || {});
      } else {
        const cached = await offlineDb.getCachedWagons();
        setWagons(cached);
      }
    } catch (err: any) {
      console.warn('Failed loading wagons online, falling back to cache:', err);
      const cached = await offlineDb.getCachedWagons();
      setWagons(cached);
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWagonNumber.trim()) {
      setRegisterError('Wagon number is required');
      return;
    }

    setRegistering(true);
    setRegisterError(null);

    try {
      if (navigator.onLine) {
        await api.registerWagon({
          wagonNumber: newWagonNumber.trim().toUpperCase(),
          wagonType: newWagonType,
          owningRailway: newOwningRailway,
          entryNotes: newEntryNotes
        });
      } else {
        // Offline registration
        await offlineDb.enqueueChecklistItem({
          wagonNumber: newWagonNumber.trim().toUpperCase(),
          category: 'SPRINGS',
          partName: 'Intake Inspection',
          status: 'PENDING'
        });
      }

      setShowRegisterModal(false);
      setNewWagonNumber('');
      setNewEntryNotes('');
      loadWagons();
    } catch (err: any) {
      setRegisterError(err.message || 'Failed to register wagon');
    } finally {
      setRegistering(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner / Actions */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-slate-900/80 p-6 rounded-2xl border border-slate-800 shadow-xl">
        <div>
          <h2 className="text-xl font-black text-white flex items-center gap-2">
            <span>🚂</span> {t('lifecycle.title')}
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            WRS Raipur POH Overhaul Pipeline & Real-Time Workshop Tracking
          </p>
        </div>

        <button
          onClick={() => setShowRegisterModal(true)}
          className="px-5 py-3 bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white rounded-xl text-sm font-bold shadow-lg shadow-orange-600/30 transition flex items-center gap-2 min-h-[48px]"
        >
          <span>➕</span> {t('actions.registerWagon')}
        </button>
      </div>

      {/* 7-Stage Pipeline Visualizer Pills */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        {stages.map((stg) => {
          const count = stg.key === 'ALL' ? wagons.length : pipelineCounts[stg.key] || 0;
          const isSelected = stageFilter === stg.key;

          return (
            <button
              key={stg.key}
              onClick={() => setStageFilter(stg.key)}
              className={`p-3 rounded-xl border text-left transition min-h-[48px] flex flex-col justify-between ${
                isSelected
                  ? 'bg-orange-600/20 border-orange-500 ring-1 ring-orange-500 text-white'
                  : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
              }`}
            >
              <div className="text-xs font-semibold flex items-center gap-1">
                <span>{stg.icon}</span>
                <span className="truncate">{stg.label}</span>
              </div>
              <div className="text-lg font-black text-white mt-2">{count}</div>
            </button>
          );
        })}
      </div>

      {/* Search & Filter Bar */}
      <div className="flex gap-4">
        <div className="flex-1 relative">
          <input
            type="text"
            placeholder={isHi ? 'वैगन संख्या, रेलवे, प्रकार खोजें...' : 'Search wagon number, railway, type...'}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-4 pr-14 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-orange-500 min-h-[48px]"
          />
          {/*
            Scanning to FIND a wagon, which is the common case. The camera used
            to exist only inside the Register New Wagon form — a rare action —
            so in practice nobody could reach it: an inspector never opens that
            form, and a supervisor opens it a few times a month.
          */}
          <button
            type="button"
            onClick={() => setShowSearchCamera(true)}
            title={isHi ? 'वैगन पर लिखा नंबर पढ़ें' : 'Read the number painted on the wagon'}
            aria-label={isHi ? 'वैगन नंबर स्कैन करें' : 'Scan a wagon number'}
            className="absolute right-2 top-1/2 -translate-y-1/2 min-h-[40px] min-w-[40px] px-2 rounded-lg border border-amber-600 text-amber-300 hover:bg-amber-950/50 text-base"
          >
            📷
          </button>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-3.5 text-slate-400 hover:text-white"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Wagons List Cards / Table */}
      {loading ? (
        <div className="text-center py-20 bg-slate-900/40 rounded-2xl border border-slate-800 text-slate-400">
          <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
          <p className="text-sm">Loading workshop wagon records...</p>
        </div>
      ) : wagons.length === 0 ? (
        <div className="text-center py-20 bg-slate-900/40 rounded-2xl border border-slate-800 text-slate-400 space-y-3">
          <div className="text-4xl">📋</div>
          <p className="text-base font-bold text-slate-300">{isHi ? 'कोई वैगन नहीं मिला' : 'No wagons found'}</p>
          <p className="text-xs text-slate-500">
            Register a new wagon into Stage 1 (Entry Registration) to begin tracking.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {wagons.map((wagon) => {
            const isReleased = wagon.currentStage === 'RELEASE';
            const isQCGate = wagon.currentStage === 'FINAL_QC_GATE';

            return (
              <div
                key={wagon.id}
                onClick={() => onSelectWagon(wagon.wagonNumber)}
                className="bg-slate-900 border border-slate-800 hover:border-orange-500/60 rounded-2xl p-5 shadow-lg transition duration-200 cursor-pointer space-y-4 group hover:shadow-orange-500/10"
              >
                {/* Wagon Top Header */}
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-base font-black text-white group-hover:text-orange-400 transition">
                      {wagon.wagonNumber}
                    </h3>
                    <p className="text-xs text-slate-400">
                      {wagon.owningRailway} • {wagon.wagonType}
                    </p>
                  </div>

                  <span
                    className={`px-2.5 py-1 rounded-full text-[10px] font-black tracking-wide ${
                      isReleased
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                        : isQCGate
                        ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                        : 'bg-blue-500/20 text-blue-400 border border-blue-500/40'
                    }`}
                  >
                    {wagon.currentStage}
                  </span>
                </div>

                {/* Stage Progress Visual Bar */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] text-slate-400 font-medium">
                    <span>{t(`lifecycle.stages.${wagon.currentStage}` as any) || wagon.currentStage}</span>
                    <span>{wagon.totalElapsedHours ? `${wagon.totalElapsedHours}h dwell` : 'Active'}</span>
                  </div>
                  <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        isReleased ? 'bg-emerald-500' : isQCGate ? 'bg-amber-500' : 'bg-orange-500'
                      }`}
                      style={{
                        width: `${Math.min(
                          100,
                          wagon.currentStage === 'ENTRY_REGISTRATION'
                            ? 15
                            : wagon.currentStage === 'DISMANTLING'
                            ? 30
                            : wagon.currentStage === 'COMPONENT_INSPECTION'
                            ? 48
                            : wagon.currentStage === 'REPAIR_REPLACEMENT'
                            ? 65
                            : wagon.currentStage === 'REASSEMBLY'
                            ? 82
                            : wagon.currentStage === 'FINAL_QC_GATE'
                            ? 92
                            : 100
                        )}%`
                      }}
                    />
                  </div>
                </div>

                {/* Footer Notes & Action */}
                <div className="text-[11px] text-slate-500 flex justify-between items-center border-t border-slate-800/80 pt-3">
                  <span>Intake: {new Date(wagon.entryDate).toLocaleDateString()}</span>
                  <span className="text-orange-400 font-bold text-xs flex items-center gap-1 group-hover:translate-x-1 transition">
                    Open Detail →
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Scanning to FIND a wagon, which is the common case. The camera used
          to exist only inside the Register New Wagon form — a rare action — so
          in practice nobody could reach it. */}
      {showSearchCamera && (
        <WagonNumberCamera
          lang={isHi ? 'hi' : 'en'}
          onRead={(num) => {
            setSearchQuery(num);
            setShowSearchCamera(false);
          }}
          onClose={() => setShowSearchCamera(false)}
        />
      )}

      {/* Register Wagon Modal */}
      {showNumberCamera && (
        <WagonNumberCamera
          lang={isHi ? 'hi' : 'en'}
          onRead={(num) => {
            setNewWagonNumber(num);
            setShowNumberCamera(false);
          }}
          onClose={() => setShowNumberCamera(false)}
        />
      )}

      {showRegisterModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-800 flex justify-between items-center bg-slate-850">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>📝</span> {t('actions.registerWagon')} (Stage 1 Intake)
              </h3>
              <button
                onClick={() => setShowRegisterModal(false)}
                className="text-slate-400 hover:text-white p-1 text-lg"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleRegister} className="p-6 space-y-4">
              {registerError && (
                <div className="p-3 bg-rose-950/40 border border-rose-800 rounded-lg text-rose-300 text-xs">
                  {registerError}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  {t('form.wagonNumber')} *
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    required
                    placeholder="e.g. NR/BOXNHL/12345 or SECR/BOXN/99021"
                    value={newWagonNumber}
                    onChange={(e) => setNewWagonNumber(e.target.value)}
                    className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white font-mono uppercase focus:outline-none focus:border-orange-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNumberCamera(true)}
                    title="Read the number painted on the wagon"
                    className="px-3 rounded-lg border border-amber-600 text-amber-300 hover:bg-amber-950/50 text-xs font-bold whitespace-nowrap"
                  >
                    📷 {t('actions.scan') || 'Scan'}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    {t('form.wagonType')}
                  </label>
                  <select
                    value={newWagonType}
                    onChange={(e) => setNewWagonType(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-orange-500"
                  >
                    <option value="BOXNHL">{isHi ? 'BOXNHL (उच्च एक्सल भार)' : 'BOXNHL (High Axle Load)'}</option>
                    <option value="BOXN">{isHi ? 'BOXN (मानक खुला)' : 'BOXN (Standard Open)'}</option>
                    <option value="BCNHL">{isHi ? 'BCNHL (ढका हुआ)' : 'BCNHL (Covered Bogie)'}</option>
                    <option value="BOBRN">{isHi ? 'BOBRN (त्वरित हॉपर)' : 'BOBRN (Rapid Hopper)'}</option>
                    <option value="BTPN">{isHi ? 'BTPN (टैंक वैगन)' : 'BTPN (Tank Wagon)'}</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    {t('form.owningRailway')}
                  </label>
                  <select
                    value={newOwningRailway}
                    onChange={(e) => setNewOwningRailway(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-orange-500"
                  >
                    <option value="SECR">{isHi ? 'SECR (दक्षिण पूर्व मध्य)' : 'SECR (South East Central)'}</option>
                    <option value="ECoR">{isHi ? 'ECoR (पूर्व तट)' : 'ECoR (East Coast)'}</option>
                    <option value="SER">{isHi ? 'SER (दक्षिण पूर्व)' : 'SER (South Eastern)'}</option>
                    <option value="CR">{isHi ? 'CR (मध्य रेलवे)' : 'CR (Central Railway)'}</option>
                    <option value="WR">{isHi ? 'WR (पश्चिम रेलवे)' : 'WR (Western Railway)'}</option>
                    <option value="NR">{isHi ? 'NR (उत्तर रेलवे)' : 'NR (Northern Railway)'}</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  {t('form.entryNotes')}
                </label>
                <textarea
                  rows={3}
                  value={newEntryNotes}
                  onChange={(e) => setNewEntryNotes(e.target.value)}
                  placeholder={t('form.entryNotesPlaceholder')}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
                />
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowRegisterModal(false)}
                  className="px-4 py-2 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 text-xs font-semibold transition"
                >
                  {t('actions.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={registering}
                  className="px-5 py-2 rounded-lg bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold shadow-lg transition"
                >
                  {registering ? 'Registering...' : t('actions.registerWagon')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
