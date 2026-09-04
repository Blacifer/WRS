/**
 * Wagons Pipeline & Registration List Page (Phase 2 - R1)
 * Indian Railways WRS Raipur
 */

import React, { useEffect, useState } from 'react';
import { api } from '../services/api.ts';
import { offlineDb } from '../services/offlineDb.ts';
import { useI18n } from '../i18n/index.ts';
import { WagonNumberCamera } from '../components/WagonNumberCamera.tsx';
import { TrainIcon, CameraIcon, PlusCircleIcon } from '../components/Icons.tsx';
import { Button, Chip, inputClass } from '../components/ui/index.tsx';
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

  /*
   * The seven stages, in order, as the filter.
   *
   * The emoji that used to lead each pill (📝 🔧 🔍 ⚙️ 🏗️ 🛡️ ✅) said nothing
   * the stage number does not say better, and two of them rendered as a
   * fallback box on the workshop's Android tablets. The number is the label.
   */
  const stages: Array<{ key: LifecycleStage | 'ALL'; label: string; step: string }> = [
    { key: 'ALL', label: isHi ? 'सभी वैगन' : 'All wagons', step: '' },
    { key: 'ENTRY_REGISTRATION', label: isHi ? 'पंजीकरण' : 'Registration', step: '1' },
    { key: 'DISMANTLING', label: isHi ? 'खोलना' : 'Dismantling', step: '2' },
    { key: 'COMPONENT_INSPECTION', label: isHi ? 'पुर्जा निरीक्षण' : 'Inspection', step: '3' },
    { key: 'REPAIR_REPLACEMENT', label: isHi ? 'मरम्मत' : 'Repair', step: '4' },
    { key: 'REASSEMBLY', label: isHi ? 'पुनः जोड़ना' : 'Reassembly', step: '5' },
    { key: 'FINAL_QC_GATE', label: isHi ? 'अंतिम गेट' : 'QC gate', step: '6' },
    { key: 'RELEASE', label: isHi ? 'रिलीज़' : 'Released', step: '7' }
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
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-card p-6 rounded-card border border-line shadow-xl">
        <div className="flex items-start gap-3">
          <TrainIcon size={22} className="text-accent-ink mt-0.5 shrink-0" />
          <div>
            <h2 className="text-xl font-extrabold tracking-[-0.025em] text-ink">{t('lifecycle.title')}</h2>
            <p className="text-xs text-ink-muted mt-1">
              {isHi
                ? 'डब्ल्यूआरएस रायपुर पीओएच पाइपलाइन'
                : 'WRS Raipur POH overhaul pipeline'}
            </p>
          </div>
        </div>

        <Button variant="primary" size="md" onClick={() => setShowRegisterModal(true)}>
          <PlusCircleIcon size={18} />
          {t('actions.registerWagon')}
        </Button>
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
              aria-pressed={isSelected}
              className={`p-3 rounded-control border text-left transition-colors min-h-[76px] flex flex-col justify-between ${
                isSelected
                  ? 'bg-raised border-accent-line'
                  : 'bg-card border-line hover:border-line-strong'
              }`}
            >
              <div className="text-[10px] font-bold uppercase tracking-[0.07em] text-ink-faint">
                {stg.step ? (isHi ? `चरण ${stg.step}` : `Stage ${stg.step}`) : (isHi ? 'सभी' : 'Total')}
              </div>
              <div className={`text-2xl font-extrabold tracking-[-0.03em] tabular mt-1 ${isSelected ? 'text-accent-ink' : 'text-ink'}`}>
                {count}
              </div>
              <div className={`text-[11px] font-semibold mt-0.5 truncate ${isSelected ? 'text-ink-body' : 'text-ink-muted'}`}>
                {stg.label}
              </div>
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
            className={inputClass + ' pr-14'}
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
            className="absolute right-2 top-1/2 -translate-y-1/2 min-h-[40px] min-w-[40px] px-2 rounded-control border border-line-strong text-ink-muted hover:text-ink hover:bg-raised flex items-center justify-center"
          >
            <CameraIcon size={18} />
          </button>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-3.5 text-ink-muted hover:text-white"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Wagons List Cards / Table */}
      {loading ? (
        <div className="text-center py-20 bg-card rounded-card border border-line text-ink-muted">
          <div className="w-8 h-8 border-2 border-accent-hover border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
          <p className="text-sm">Loading workshop wagon records...</p>
        </div>
      ) : wagons.length === 0 ? (
        <div className="text-center py-20 bg-card rounded-card border border-line text-ink-muted space-y-3">
          <p className="text-base font-bold text-ink-body">{isHi ? 'कोई वैगन नहीं मिला' : 'No wagons found'}</p>
          <p className="text-xs text-ink-faint">
            {isHi
              ? 'ट्रैकिंग शुरू करने के लिए चरण 1 में एक वैगन पंजीकृत करें।'
              : 'Register a wagon into stage 1 to begin tracking.'}
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
                className="bg-card border border-line hover:border-line-strong rounded-card p-5 transition-colors cursor-pointer space-y-4 group"
              >
                {/* Wagon Top Header */}
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-base font-extrabold text-ink tabular group-hover:text-accent-ink transition-colors">
                      {wagon.wagonNumber}
                    </h3>
                    <p className="text-xs text-ink-muted">
                      {wagon.owningRailway} • {wagon.wagonType}
                    </p>
                  </div>

                  <Chip tone={isReleased ? 'good' : isQCGate ? 'warn' : 'accent'}>
                    {t(`lifecycle.stages.${wagon.currentStage}` as any) || wagon.currentStage}
                  </Chip>
                </div>

                {/* Stage Progress Visual Bar */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] text-ink-muted font-medium">
                    <span>{t(`lifecycle.stages.${wagon.currentStage}` as any) || wagon.currentStage}</span>
                    <span>{wagon.totalElapsedHours ? `${wagon.totalElapsedHours}h dwell` : 'Active'}</span>
                  </div>
                  <div className="w-full h-2 bg-selected rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        isReleased ? 'bg-good' : isQCGate ? 'bg-warn' : 'bg-accent'
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
                <div className="text-[11px] text-ink-faint flex justify-between items-center border-t border-line pt-3">
                  <span>Intake: {new Date(wagon.entryDate).toLocaleDateString()}</span>
                  <span className="text-accent-ink font-bold text-xs flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                    {isHi ? 'खोलें →' : 'Open →'}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-card border border-line rounded-card shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-line flex justify-between items-center bg-raised">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                {t('actions.registerWagon')}
              </h3>
              <button
                onClick={() => setShowRegisterModal(false)}
                className="text-ink-muted hover:text-white p-1 text-lg"
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
                <label className="block text-xs font-semibold text-ink-body mb-1">
                  {t('form.wagonNumber')} *
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    required
                    placeholder="e.g. NR/BOXNHL/12345 or SECR/BOXN/99021"
                    value={newWagonNumber}
                    onChange={(e) => setNewWagonNumber(e.target.value)}
                    className="flex-1 bg-raised border border-line rounded-lg px-3 py-2.5 text-sm text-white font-mono uppercase focus:outline-none focus:border-accent-hover"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNumberCamera(true)}
                    title="Read the number painted on the wagon"
                    className="px-3 rounded-control border border-line-strong text-ink-muted hover:text-ink hover:bg-raised text-xs font-bold whitespace-nowrap inline-flex items-center gap-1.5"
                  >
                    <CameraIcon size={16} />
                    {t('actions.scan') || 'Scan'}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-ink-body mb-1">
                    {t('form.wagonType')}
                  </label>
                  <select
                    value={newWagonType}
                    onChange={(e) => setNewWagonType(e.target.value)}
                    className="w-full bg-raised border border-line rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-accent-hover"
                  >
                    <option value="BOXNHL">{isHi ? 'BOXNHL (उच्च एक्सल भार)' : 'BOXNHL (High Axle Load)'}</option>
                    <option value="BOXN">{isHi ? 'BOXN (मानक खुला)' : 'BOXN (Standard Open)'}</option>
                    <option value="BCNHL">{isHi ? 'BCNHL (ढका हुआ)' : 'BCNHL (Covered Bogie)'}</option>
                    <option value="BOBRN">{isHi ? 'BOBRN (त्वरित हॉपर)' : 'BOBRN (Rapid Hopper)'}</option>
                    <option value="BTPN">{isHi ? 'BTPN (टैंक वैगन)' : 'BTPN (Tank Wagon)'}</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-ink-body mb-1">
                    {t('form.owningRailway')}
                  </label>
                  <select
                    value={newOwningRailway}
                    onChange={(e) => setNewOwningRailway(e.target.value)}
                    className="w-full bg-raised border border-line rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-accent-hover"
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
                <label className="block text-xs font-semibold text-ink-body mb-1">
                  {t('form.entryNotes')}
                </label>
                <textarea
                  rows={3}
                  value={newEntryNotes}
                  onChange={(e) => setNewEntryNotes(e.target.value)}
                  placeholder={t('form.entryNotesPlaceholder')}
                  className="w-full bg-raised border border-line rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent-hover"
                />
              </div>

              <div className="pt-3 border-t border-line flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowRegisterModal(false)}
                  className="px-4 py-2 rounded-lg border border-line text-ink-body hover:bg-raised text-xs font-semibold transition"
                >
                  {t('actions.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={registering}
                  className="px-5 py-2 rounded-control bg-accent hover:bg-accent-hover text-white text-xs font-bold transition-colors"
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
