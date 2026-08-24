/**
 * Inspection Audit History & Search Page
 * Indian Railways WRS Raipur
 */

import React, { useState, useEffect } from 'react';
import type { InspectionRecord, InspectionFilter, BandColor, BogieType, InspectionStatus } from '../../../shared/types.ts';
import { getDictionary, getBogieTypeText, getPositionText } from '../i18n/index.ts';
import type { LanguageCode } from '../i18n/index.ts';
import { ClassificationBadge } from '../components/ClassificationBadge.tsx';
import { api } from '../services/api.ts';
import { offlineDb } from '../services/offlineDb.ts';
import { HistoryIcon, RefreshCwIcon, ShieldIcon } from '../components/Icons.tsx';

interface HistoryPageProps {
  lang: LanguageCode;
}

const BANDS: BandColor[] = ['BLUE', 'GREEN', 'YELLOW', 'ORANGE', 'WHITE', 'RED'];
const BOGIE_TYPES: BogieType[] = ['CASNUB_22_NLB', 'CASNUB_22_HS', 'CASNUB_22_RFT'];

export const HistoryPage: React.FC<HistoryPageProps> = ({ lang }) => {
  const isHi = lang === 'hi';
  const dict = getDictionary(lang);

  const [records, setRecords] = useState<InspectionRecord[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [filterWagon, setFilterWagon] = useState<string>('');
  const [filterBand, setFilterBand] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterBogie, setFilterBogie] = useState<string>('');
  const [selectedRecord, setSelectedRecord] = useState<InspectionRecord | null>(null);

  const loadRecords = async () => {
    setIsLoading(true);
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        const filter: InspectionFilter = {
          wagonNumber: filterWagon || undefined,
          band: (filterBand as BandColor) || undefined,
          status: (filterStatus as InspectionStatus) || undefined,
          bogieType: (filterBogie as BogieType) || undefined,
          limit: 100
        };
        const res = await api.queryInspections(filter);
        setRecords(res.records);
        setTotalCount(res.totalCount);
        await offlineDb.cacheInspections(res.records);
      } else {
        const cached = await offlineDb.getCachedInspections();
        setRecords(cached);
        setTotalCount(cached.length);
      }
    } catch (err) {
      console.warn('[History] Query failed, falling back to local cache:', err);
      const cached = await offlineDb.getCachedInspections();
      setRecords(cached);
      setTotalCount(cached.length);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadRecords();
  }, [filterBand, filterStatus, filterBogie]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loadRecords();
  };

  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-6 py-6 space-y-6 pb-20 text-white">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-white flex items-center gap-2">
            <HistoryIcon size={24} className="text-blue-400" />
            <span>{dict.nav.history}</span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-400">
            {lang === 'hi' ? 'आरडीएसओ जी-95 अपरिवर्तनीय ऑडिट ट्रेल' : 'RDSO G-95 Immutable Cryptographic Audit Log'}
          </p>
        </div>

        <button
          onClick={loadRecords}
          disabled={isLoading}
          className="min-h-[44px] px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl flex items-center justify-center gap-2 border border-slate-700 transition-all self-start sm:self-auto"
        >
          <RefreshCwIcon size={16} className={isLoading ? 'animate-spin' : ''} />
          <span>{lang === 'hi' ? 'रिफ्रेश करें' : 'Refresh Logs'}</span>
        </button>
      </div>

      {/* Multi-Criteria Filters (Glove-Friendly Touch Inputs) */}
      <form onSubmit={handleSearchSubmit} className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Wagon Search */}
          <div>
            <label className="block text-xs font-bold text-slate-400 mb-1">
              {dict.form.wagonNumber}
            </label>
            <input
              type="text"
              value={filterWagon}
              onChange={(e) => setFilterWagon(e.target.value)}
              placeholder="e.g. SECR-BOXN-101"
              className="w-full min-h-[44px] px-3 py-2 bg-slate-950 border border-slate-700 focus:border-blue-500 rounded-lg text-white font-mono text-sm uppercase outline-none"
            />
          </div>

          {/* Band Filter */}
          <div>
            <label className="block text-xs font-bold text-slate-400 mb-1">
              {lang === 'hi' ? 'आरडीएसओ बैंड' : 'RDSO Band'}
            </label>
            <select
              value={filterBand}
              onChange={(e) => setFilterBand(e.target.value)}
              className="w-full min-h-[44px] px-3 py-2 bg-slate-950 border border-slate-700 focus:border-blue-500 rounded-lg text-white text-sm outline-none"
            >
              <option value="">{lang === 'hi' ? 'सभी बैंड (All Bands)' : 'All Bands'}</option>
              {BANDS.map((b) => (
                <option key={b} value={b}>{dict.bands[b]}</option>
              ))}
            </select>
          </div>

          {/* Status Filter */}
          <div>
            <label className="block text-xs font-bold text-slate-400 mb-1">
              {lang === 'hi' ? 'स्थिति (Status)' : 'Status'}
            </label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="w-full min-h-[44px] px-3 py-2 bg-slate-950 border border-slate-700 focus:border-blue-500 rounded-lg text-white text-sm outline-none"
            >
              <option value="">{lang === 'hi' ? 'सभी स्थितियाँ (All Statuses)' : 'All Statuses'}</option>
              <option value="PASS">PASS / SERVICEABLE</option>
              <option value="CONDEMNED">CONDEMNED / SCRAP</option>
            </select>
          </div>

          {/* Bogie Filter */}
          <div>
            <label className="block text-xs font-bold text-slate-400 mb-1">
              {dict.form.bogieType}
            </label>
            <select
              value={filterBogie}
              onChange={(e) => setFilterBogie(e.target.value)}
              className="w-full min-h-[44px] px-3 py-2 bg-slate-950 border border-slate-700 focus:border-blue-500 rounded-lg text-white text-sm outline-none"
            >
              <option value="">{lang === 'hi' ? 'सभी बोगी प्रकार (All Bogies)' : 'All Bogies'}</option>
              {BOGIE_TYPES.map((bg) => (
                <option key={bg} value={bg}>{getBogieTypeText(bg, lang)}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={() => {
              setFilterWagon('');
              setFilterBand('');
              setFilterStatus('');
              setFilterBogie('');
              loadRecords();
            }}
            className="min-h-[40px] px-4 py-1.5 text-xs font-bold text-slate-400 hover:text-white"
          >
            {dict.actions.resetFilter}
          </button>
          <button
            type="submit"
            className="min-h-[40px] px-5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-lg"
          >
            {dict.actions.filter}
          </button>
        </div>
      </form>

      {/* Record Cards List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs text-slate-400 font-semibold px-1">
          <span>{lang === 'hi' ? `कुल रिकॉर्ड: ${totalCount}` : `Total Logs: ${totalCount}`}</span>
        </div>

        {records.length === 0 ? (
          <div className="p-8 text-center bg-slate-900 border border-slate-800 rounded-xl text-slate-400">
            <p className="text-sm font-semibold">{lang === 'hi' ? 'कोई निरीक्षण रिकॉर्ड नहीं मिला' : 'No inspection records found'}</p>
          </div>
        ) : (
          records.map((r) => (
            <div
              key={r.id}
              onClick={() => setSelectedRecord(r)}
              className="p-4 bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl shadow-md space-y-3 cursor-pointer transition-all active:scale-[0.99]"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs font-bold text-slate-400 bg-slate-950 px-2 py-1 rounded border border-slate-800">
                    #{r.sequenceNumber || r.id.slice(0, 8)}
                  </span>
                  <span className="font-mono font-extrabold text-base text-white">{r.wagonNumber}</span>
                  <span className="text-xs text-slate-400 font-medium">({getBogieTypeText(r.bogieType, lang)})</span>
                </div>

                <div className="flex items-center gap-2">
                  <ClassificationBadge
                    band={r.classifiedBand}
                    bandRoman={r.bandRoman}
                    status={r.status}
                    lang={lang}
                    isOverridden={r.isOverridden}
                    size="sm"
                  />
                  <span className="font-mono font-black text-emerald-400 text-sm">
                    {r.measuredFreeHeight?.toFixed(2)} mm
                  </span>
                </div>
              </div>

              {/* Metadata Row */}
              <div className="flex flex-wrap items-center gap-y-1 gap-x-4 text-xs text-slate-400 pt-1 border-t border-slate-800/60">
                <span>Position: <strong className="text-slate-200">{getPositionText(r.springPosition, lang)}</strong></span>
                <span>Inspector: <strong className="text-slate-200">{r.inspectorName || r.inspectorId}</strong></span>
                <span>Time: <strong className="text-slate-200">{new Date(r.timestamp).toLocaleString()}</strong></span>
                {r.auditHash && (
                  <span className="font-mono text-[10px] text-slate-500 truncate max-w-[160px]" title={r.auditHash}>
                    Hash: {r.auditHash.slice(0, 16)}...
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Inspection Detail Modal */}
      {selectedRecord && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
            <div className="px-5 py-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
              <h3 className="font-extrabold text-white text-base">
                Inspection #{selectedRecord.sequenceNumber || selectedRecord.id}
              </h3>
              <button
                onClick={() => setSelectedRecord(null)}
                className="text-slate-400 hover:text-white text-xl font-bold p-1"
              >
                &times;
              </button>
            </div>

            <div className="p-5 space-y-3 text-xs sm:text-sm">
              <div className="grid grid-cols-2 gap-2 p-3 bg-slate-950 rounded-xl border border-slate-800">
                <div>
                  <span className="text-slate-400">Wagon:</span> <strong className="text-white font-mono">{selectedRecord.wagonNumber}</strong>
                </div>
                <div>
                  <span className="text-slate-400">Bogie:</span> <strong className="text-white">{selectedRecord.bogieType}</strong>
                </div>
                <div>
                  <span className="text-slate-400">Position:</span> <strong className="text-white">{selectedRecord.springPosition}</strong>
                </div>
                <div>
                  <span className="text-slate-400">Height:</span> <strong className="text-emerald-400 font-mono">{selectedRecord.measuredFreeHeight} mm</strong>
                </div>
              </div>

              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Classification:</span>
                  <ClassificationBadge
                    band={selectedRecord.classifiedBand}
                    bandRoman={selectedRecord.bandRoman}
                    status={selectedRecord.status}
                    lang={lang}
                    isOverridden={selectedRecord.isOverridden}
                    size="sm"
                  />
                </div>
                <div className="text-slate-400">
                  Table: <span className="text-white font-mono">{selectedRecord.tableReference}</span>
                </div>
              </div>

              {selectedRecord.isOverridden && (
                <div className="p-3 bg-purple-950/60 border border-purple-800 rounded-xl space-y-1 text-purple-200">
                  <div className="font-bold flex items-center gap-1.5">
                    <ShieldIcon size={14} className="text-purple-400" />
                    <span>{isHi ? 'पर्यवेक्षक ओवरराइड कारण' : 'Supervisor Override Justification'}</span>
                  </div>
                  <p>{selectedRecord.overrideReason}</p>
                </div>
              )}

              {selectedRecord.auditHash && (
                <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 font-mono text-[11px] break-all">
                  <span className="text-slate-400">Cryptographic SHA-256 Hash:</span>
                  <div className="text-slate-300 mt-1">{selectedRecord.auditHash}</div>
                </div>
              )}
            </div>

            <div className="px-5 py-3 bg-slate-950 border-t border-slate-800 flex justify-end">
              <button
                onClick={() => setSelectedRecord(null)}
                className="min-h-[44px] px-5 py-2 bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs rounded-xl"
              >
                {dict.actions.close}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
