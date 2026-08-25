/**
 * Serialized Component Health Passports & Serialization Ledger Page
 * Indian Railways WRS Raipur (Phase 3 - Feature R4)
 *
 * Full-scale rolling stock component lifecycle tracking:
 * - Summary KPI cards (Fleet health, In-service, Stores stock, Condemned)
 * - Multi-criteria registry search, filter, and pagination
 * - Multi-wagon provenance history timeline
 * - QR code scanning and serialization manifest management
 * - Component registration, wagon mounting assignment, stores return, and POH overhauls
 */

import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api.ts';
import { useI18n } from '../i18n/index.ts';
import { PassportQRScannerModal } from '../components/PassportQRScannerModal.tsx';
import type {
  SerializedComponent,
  SerializedComponentType,
  ComponentStatus,
  ComponentHealthStatus,
  ComponentHistoryEvent,
  ComponentStats,
  RegisterComponentRequest,
  AssignComponentRequest,
  UnassignComponentRequest,
  CASNUBCategory
} from '../../../shared/types.ts';

interface ComponentPassportsPageProps {
  onNavigateToWagon?: (wagonNumber: string) => void;
}

export const ComponentPassportsPage: React.FC<ComponentPassportsPageProps> = ({ onNavigateToWagon }) => {
  const { t, lang } = useI18n();
  const isHi = lang === 'hi';

  // Data state
  const [components, setComponents] = useState<SerializedComponent[]>([]);
  const [stats, setStats] = useState<ComponentStats | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [healthFilter, setHealthFilter] = useState<string>('ALL');
  const [wagonFilter, setWagonFilter] = useState<string>('');

  // Modals & Selected items
  const [isQRScannerOpen, setIsQRScannerOpen] = useState<boolean>(false);
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState<boolean>(false);
  const [selectedComponent, setSelectedComponent] = useState<SerializedComponent | null>(null);
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);
  const [componentHistory, setComponentHistory] = useState<ComponentHistoryEvent[]>([]);

  // Assign / Unassign modal state
  const [assigningComponent, setAssigningComponent] = useState<SerializedComponent | null>(null);
  const [assignForm, setAssignForm] = useState<{ wagonNumber: string; bogiePosition: 'BOGIE_1' | 'BOGIE_2' | 'UNDERFRAME' | 'BODY' | 'NONE'; notes: string }>({
    wagonNumber: '',
    bogiePosition: 'BOGIE_1',
    notes: ''
  });

  const [unassigningComponent, setUnassigningComponent] = useState<SerializedComponent | null>(null);
  const [unassignForm, setUnassignForm] = useState<{ targetStatus: ComponentStatus; reason: string; notes: string }>({
    targetStatus: 'AVAILABLE_IN_STORES',
    reason: 'Routine Maintenance / POH Cycle',
    notes: ''
  });

  // Health / Overhaul update state
  const [healthUpdateComponent, setHealthUpdateComponent] = useState<SerializedComponent | null>(null);
  const [healthForm, setHealthForm] = useState<{ healthScore: number; notes: string }>({
    healthScore: 100,
    notes: ''
  });

  // New Registration form state
  const [regForm, setRegForm] = useState<RegisterComponentRequest>({
    serialNumber: '',
    componentType: 'WHEELSET',
    category: 'WHEELS_AXLES',
    partName: 'CASNUB Wheelset Assembly 1000mm',
    manufacturer: 'RWF Yelahanka',
    manufacturingDate: new Date().toISOString().split('T')[0],
    initialStatus: 'AVAILABLE_IN_STORES',
    rfidTag: '',
    binLocation: 'BAY-1-RACK-A',
    healthScore: 100
  });

  // Load Component Registry & KPI Stats
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [listRes, statsRes] = await Promise.all([
        api.getComponents({
          search: searchQuery || undefined,
          componentType: typeFilter !== 'ALL' ? typeFilter : undefined,
          status: statusFilter !== 'ALL' ? statusFilter : undefined,
          healthStatus: healthFilter !== 'ALL' ? healthFilter : undefined,
          wagonNumber: wagonFilter || undefined,
          limit: 100
        }),
        api.getComponentStats()
      ]);

      if (listRes.success && listRes.data) {
        setComponents(listRes.data);
      }
      if (statsRes.success && statsRes.data) {
        setStats(statsRes.data);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load component passports.');
    } finally {
      setLoading(false);
    }
  }, [searchQuery, typeFilter, statusFilter, healthFilter, wagonFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Load history when a component is selected for detailed inspection
  const handleSelectComponent = async (comp: SerializedComponent) => {
    setSelectedComponent(comp);
    setHistoryLoading(true);
    try {
      const detailRes = await api.getComponentBySerial(comp.serialNumber);
      if (detailRes.success && detailRes.data) {
        setSelectedComponent(detailRes.data);
        setComponentHistory(detailRes.data.history || []);
      } else {
        setComponentHistory(comp.history || []);
      }
    } catch {
      setComponentHistory(comp.history || []);
    } finally {
      setHistoryLoading(false);
    }
  };

  // QR Scan callback
  const handleQRScanned = (scanned: SerializedComponent) => {
    handleSelectComponent(scanned);
  };

  // Handle Component Registration
  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regForm.serialNumber.trim()) return;

    try {
      const res = await api.registerComponent(regForm);
      if (res.success && res.data) {
        setIsRegisterModalOpen(false);
        setRegForm({
          serialNumber: '',
          componentType: 'WHEELSET',
          category: 'WHEELS_AXLES',
          partName: 'CASNUB Wheelset Assembly 1000mm',
          manufacturer: 'RWF Yelahanka',
          manufacturingDate: new Date().toISOString().split('T')[0],
          initialStatus: 'AVAILABLE_IN_STORES',
          rfidTag: '',
          binLocation: 'BAY-1-RACK-A',
          healthScore: 100
        });
        loadData();
        handleSelectComponent(res.data);
      }
    } catch (err: any) {
      alert(`Registration Error: ${err.message}`);
    }
  };

  // Handle Assign Component
  const handleAssignSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assigningComponent || !assignForm.wagonNumber.trim()) return;

    try {
      const res = await api.assignComponent(assigningComponent.serialNumber, {
        wagonNumber: assignForm.wagonNumber.trim().toUpperCase(),
        bogiePosition: assignForm.bogiePosition,
        notes: assignForm.notes
      });
      if (res.success && res.data) {
        setAssigningComponent(null);
        loadData();
        if (selectedComponent?.serialNumber === assigningComponent.serialNumber) {
          handleSelectComponent(res.data);
        }
      }
    } catch (err: any) {
      alert(`Assignment Error: ${err.message}`);
    }
  };

  // Handle Unassign Component
  const handleUnassignSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!unassigningComponent) return;

    try {
      const res = await api.unassignComponent(unassigningComponent.serialNumber, {
        targetStatus: unassignForm.targetStatus,
        reason: unassignForm.reason,
        notes: unassignForm.notes
      });
      if (res.success && res.data) {
        setUnassigningComponent(null);
        loadData();
        if (selectedComponent?.serialNumber === unassigningComponent.serialNumber) {
          handleSelectComponent(res.data);
        }
      }
    } catch (err: any) {
      alert(`Unassignment Error: ${err.message}`);
    }
  };

  // Handle Health Score Update
  const handleHealthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!healthUpdateComponent) return;

    try {
      const res = await api.updateComponentHealth(healthUpdateComponent.serialNumber, {
        healthScore: Number(healthForm.healthScore),
        notes: healthForm.notes
      });
      if (res.success && res.data) {
        setHealthUpdateComponent(null);
        loadData();
        if (selectedComponent?.serialNumber === healthUpdateComponent.serialNumber) {
          handleSelectComponent(res.data);
        }
      }
    } catch (err: any) {
      alert(`Health Update Error: ${err.message}`);
    }
  };

  // Badge helpers
  const getHealthBadge = (healthStatus: ComponentHealthStatus, score: number) => {
    switch (healthStatus) {
      case 'EXCELLENT':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-emerald-950 text-emerald-300 border border-emerald-500/50 flex items-center gap-1.5 shadow-sm">
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            {score}% {isHi ? 'उत्कृष्ट' : 'EXCELLENT'}
          </span>
        );
      case 'GOOD':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-blue-950 text-blue-300 border border-blue-500/50 flex items-center gap-1.5 shadow-sm">
            <span className="w-2 h-2 rounded-full bg-blue-400"></span>
            {score}% {isHi ? 'अच्छा' : 'GOOD'}
          </span>
        );
      case 'FAIR':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-amber-950 text-amber-300 border border-amber-500/50 flex items-center gap-1.5 shadow-sm">
            <span className="w-2 h-2 rounded-full bg-amber-400"></span>
            {score}% {isHi ? 'ठीक' : 'FAIR'}
          </span>
        );
      case 'ATTENTION_REQUIRED':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-orange-950 text-orange-300 border border-orange-500/50 flex items-center gap-1.5 shadow-sm">
            <span className="w-2 h-2 rounded-full bg-orange-400 animate-pulse"></span>
            {score}% {isHi ? 'ध्यान दें' : 'ATTENTION'}
          </span>
        );
      case 'CRITICAL':
      default:
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-rose-950 text-rose-300 border border-rose-500/50 flex items-center gap-1.5 shadow-sm">
            <span className="w-2 h-2 rounded-full bg-rose-400 animate-ping"></span>
            {score}% {isHi ? 'गंभीर' : 'CRITICAL'}
          </span>
        );
    }
  };

  const getStatusBadge = (status: ComponentStatus) => {
    switch (status) {
      case 'IN_SERVICE':
        return <span className="px-2 py-0.5 text-[11px] font-bold rounded bg-emerald-950/70 text-emerald-400 border border-emerald-800">{isHi ? 'सेवा में' : 'IN SERVICE'}</span>;
      case 'AVAILABLE_IN_STORES':
        return <span className="px-2 py-0.5 text-[11px] font-bold rounded bg-cyan-950/70 text-cyan-400 border border-cyan-800">{isHi ? 'स्टोर्स डिपो' : 'STORES DEPOT'}</span>;
      case 'UNDER_MAINTENANCE':
        return <span className="px-2 py-0.5 text-[11px] font-bold rounded bg-amber-950/70 text-amber-400 border border-amber-800">{isHi ? 'अनुरक्षण' : 'MAINTENANCE'}</span>;
      case 'RECONDITIONED':
        return <span className="px-2 py-0.5 text-[11px] font-bold rounded bg-purple-950/70 text-purple-400 border border-purple-800">{isHi ? 'पुनर्निर्मित' : 'RECONDITIONED'}</span>;
      case 'CONDEMNED':
        return <span className="px-2 py-0.5 text-[11px] font-bold rounded bg-rose-950/70 text-rose-400 border border-rose-800">{isHi ? 'कंडम' : 'CONDEMNED'}</span>;
      default:
        return <span className="px-2 py-0.5 text-[11px] font-bold rounded bg-slate-800 text-slate-300">{status}</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Actions */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-5 bg-gradient-to-r from-slate-900 via-slate-900 to-cyan-950/40 border border-cyan-500/30 rounded-2xl shadow-xl">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-xl bg-cyan-500/20 border border-cyan-500/50 flex items-center justify-center text-cyan-300 text-2xl font-black shadow-inner">
            🪪
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">{isHi ? 'घटक हेल्थ पासपोर्ट व क्रमांकन' : 'Component Health Passports & Serialization'}</h1>
              <span className="px-2 py-0.5 text-[10px] font-extrabold uppercase bg-cyan-950 text-cyan-300 border border-cyan-800 rounded">
                RDSO G-95 Rev-II
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              {isHi ? 'यूनिक क्यूआर/आरएफआईडी क्रमांकन, बहु-वैगन उत्पत्ति ट्रैकिंग एवं पीओएच ओवरहॉल जीवनचक्र लेखा' : 'Unique QR/RFID serialization, multi-wagon provenance tracking, and POH overhaul lifecycle ledger'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 w-full md:w-auto">
          <button
            onClick={() => setIsQRScannerOpen(true)}
            className="flex-1 md:flex-none min-h-[44px] px-4 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-cyan-950/50 flex items-center justify-center gap-2 transition active:scale-95 border border-cyan-400/30"
          >
            <span>📷</span>
            <span>{isHi ? 'क्यूआर पासपोर्ट स्कैन करें' : 'Scan QR Passport'}</span>
          </button>

          <button
            onClick={() => setIsRegisterModalOpen(true)}
            className="flex-1 md:flex-none min-h-[44px] px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs rounded-xl border border-slate-700 flex items-center justify-center gap-1.5 transition active:scale-95"
          >
            <span>+</span>
            <span>{isHi ? 'घटक पंजीकृत करें' : 'Register Component'}</span>
          </button>
        </div>
      </div>

      {/* KPI Stats Banner */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          <div className="p-3.5 bg-slate-900/80 border border-slate-800 rounded-xl">
            <p className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">{isHi ? 'कुल ट्रैक किए गए' : 'Total Tracked'}</p>
            <p className="text-xl font-black text-white mt-1">{stats.totalComponents}</p>
            <p className="text-[10px] text-cyan-400 mt-0.5">{isHi ? 'क्रमांकित इकाइयाँ' : 'Serialized Units'}</p>
          </div>

          <div className="p-3.5 bg-slate-900/80 border border-slate-800 rounded-xl">
            <p className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">{isHi ? 'सेवा में' : 'In Service'}</p>
            <p className="text-xl font-black text-emerald-400 mt-1">{stats.inService}</p>
            <p className="text-[10px] text-emerald-400/80 mt-0.5">{isHi ? 'वैगनों पर लगे' : 'Mounted on Wagons'}</p>
          </div>

          <div className="p-3.5 bg-slate-900/80 border border-slate-800 rounded-xl">
            <p className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">{isHi ? 'स्टोर्स डिपो' : 'Stores Depot'}</p>
            <p className="text-xl font-black text-cyan-400 mt-1">{stats.availableInStores}</p>
            <p className="text-[10px] text-cyan-400/80 mt-0.5">{isHi ? 'जारी करने हेतु तैयार' : 'Ready for Issue'}</p>
          </div>

          <div className="p-3.5 bg-slate-900/80 border border-slate-800 rounded-xl">
            <p className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">{isHi ? 'अनुरक्षण' : 'Maintenance'}</p>
            <p className="text-xl font-black text-amber-400 mt-1">{stats.underMaintenance}</p>
            <p className="text-[10px] text-amber-400/80 mt-0.5">{isHi ? 'कारखाना बे में' : 'In Workshop Bay'}</p>
          </div>

          <div className="p-3.5 bg-slate-900/80 border border-slate-800 rounded-xl">
            <p className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">{isHi ? 'पुनर्निर्मित' : 'Reconditioned'}</p>
            <p className="text-xl font-black text-purple-400 mt-1">{stats.reconditioned}</p>
            <p className="text-[10px] text-purple-400/80 mt-0.5">{isHi ? 'पीओएच ओवरहॉल किए' : 'POH Overhauled'}</p>
          </div>

          <div className="p-3.5 bg-slate-900/80 border border-slate-800 rounded-xl">
            <p className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">{isHi ? 'औसत स्वास्थ्य' : 'Avg Health'}</p>
            <p className="text-xl font-black text-white mt-1">{Math.round(stats.averageHealthScore)}%</p>
            <p className="text-[10px] text-emerald-400 mt-0.5">{isHi ? 'बेड़ा सूचकांक' : 'Fleet Index'}</p>
          </div>

          <div className="p-3.5 bg-slate-900/80 border border-slate-800 rounded-xl">
            <p className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">{isHi ? 'गंभीर चेतावनी' : 'Critical Alert'}</p>
            <p className="text-xl font-black text-rose-400 mt-1">{stats.criticalHealthCount}</p>
            <p className="text-[10px] text-rose-400/80 mt-0.5">{isHi ? 'ध्यान आवश्यक' : 'Needs Attention'}</p>
          </div>
        </div>
      )}

      {/* Filter & Search Bar */}
      <div className="p-4 bg-slate-900/70 border border-slate-800 rounded-xl space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {/* Search */}
          <div className="lg:col-span-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={isHi ? 'क्रम संख्या, पुर्जा, निर्माता, आरएफआईडी खोजें...' : 'Search serial no, part name, manufacturer, RFID...'}
              className="w-full px-3.5 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono"
            />
          </div>

          {/* Component Type Filter */}
          <div>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-cyan-500"
            >
              <option value="ALL">{isHi ? 'सभी घटक प्रकार' : 'All Component Types'}</option>
              <option value="WHEELSET">{isHi ? 'व्हीलसेट' : 'Wheelsets'}</option>
              <option value="BEARING">{isHi ? 'बेयरिंग (CTRB)' : 'Bearings (CTRB)'}</option>
              <option value="DRAFT_GEAR">{isHi ? 'ड्राफ्ट गियर' : 'Draft Gears'}</option>
              <option value="BOGIE_FRAME_BOLSTER">{isHi ? 'बोल्स्टर व फ्रेम' : 'Bolsters & Frames'}</option>
              <option value="BRAKE_VALVE">{isHi ? 'डिस्ट्रीब्यूटर वाल्व' : 'Distributor Valves'}</option>
              <option value="COUPLER">{isHi ? 'कपलर (CBC)' : 'Couplers (CBC)'}</option>
              <option value="FRICTION_WEDGE">{isHi ? 'घर्षण वेज' : 'Friction Wedges'}</option>
            </select>
          </div>

          {/* Status Filter */}
          <div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-cyan-500"
            >
              <option value="ALL">{isHi ? 'सभी स्थितियाँ' : 'All Statuses'}</option>
              <option value="AVAILABLE_IN_STORES">{isHi ? 'स्टोर्स डिपो' : 'Stores Depot'}</option>
              <option value="IN_SERVICE">In Service (Mounted)</option>
              <option value="UNDER_MAINTENANCE">{isHi ? 'अनुरक्षण में' : 'Under Maintenance'}</option>
              <option value="RECONDITIONED">{isHi ? 'पुनर्निर्मित' : 'Reconditioned'}</option>
              <option value="CONDEMNED">{isHi ? 'कंडम' : 'Condemned'}</option>
            </select>
          </div>

          {/* Health Filter */}
          <div>
            <select
              value={healthFilter}
              onChange={(e) => setHealthFilter(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-cyan-500"
            >
              <option value="ALL">{isHi ? 'सभी स्वास्थ्य श्रेणियाँ' : 'All Health Tiers'}</option>
              <option value="EXCELLENT">{isHi ? 'उत्कृष्ट (≥90%)' : 'Excellent (≥90%)'}</option>
              <option value="GOOD">{isHi ? 'अच्छा (≥75%)' : 'Good (≥75%)'}</option>
              <option value="FAIR">{isHi ? 'ठीक (≥60%)' : 'Fair (≥60%)'}</option>
              <option value="ATTENTION_REQUIRED">{isHi ? 'ध्यान दें (≥40%)' : 'Attention (≥40%)'}</option>
              <option value="CRITICAL">{isHi ? 'गंभीर (&lt;40%)' : 'Critical (&lt;40%)'}</option>
            </select>
          </div>
        </div>
      </div>

      {/* Main Content Layout: Table & Selected Detail Drawer */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Component Registry List */}
        <div className={`space-y-3 ${selectedComponent ? 'lg:col-span-2' : 'lg:col-span-3'}`}>
          {loading ? (
            <div className="p-12 text-center text-slate-400 bg-slate-900/40 rounded-xl border border-slate-800">
              <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
              <p className="text-xs font-mono">Loading Component Health Passports...</p>
            </div>
          ) : error ? (
            <div className="p-4 bg-rose-950/60 border border-rose-500/50 rounded-xl text-rose-300 text-xs">
              ⚠️ {error}
            </div>
          ) : components.length === 0 ? (
            <div className="p-12 text-center text-slate-400 bg-slate-900/40 rounded-xl border border-slate-800">
              <p className="text-base font-bold text-slate-300">{isHi ? 'कोई क्रमांकित घटक नहीं मिला' : 'No Serialized Components Found'}</p>
              <p className="text-xs text-slate-500 mt-1">Try adjusting your filters or register a new component.</p>
            </div>
          ) : (
            <div className="overflow-x-auto bg-slate-900/70 border border-slate-800 rounded-xl shadow-lg">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-950/80 border-b border-slate-800 text-[11px] text-slate-400 uppercase tracking-wider font-semibold">
                    <th className="p-3 sm:p-4">{isHi ? 'क्रम संख्या व प्रकार' : 'Serial Number & Type'}</th>
                    <th className="p-3 sm:p-4">{isHi ? 'स्थान / बोगी' : 'Placement / Bogie'}</th>
                    <th className="p-3 sm:p-4">{isHi ? 'स्वास्थ्य स्कोर' : 'Health Score'}</th>
                    <th className="p-3 sm:p-4">{isHi ? 'स्थिति' : 'Status'}</th>
                    <th className="p-3 sm:p-4">{isHi ? 'निर्माण / ओवरहॉल' : 'Mfg / Overhauls'}</th>
                    <th className="p-3 sm:p-4 text-right">{isHi ? 'क्रियाएँ' : 'Actions'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-xs">
                  {components.map((comp) => {
                    const isSelected = selectedComponent?.serialNumber === comp.serialNumber;
                    return (
                      <tr
                        key={comp.id || comp.serialNumber}
                        onClick={() => handleSelectComponent(comp)}
                        className={`cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-cyan-950/40 border-l-4 border-l-cyan-500'
                            : 'hover:bg-slate-800/50'
                        }`}
                      >
                        {/* Serial & Type */}
                        <td className="p-3 sm:p-4">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-cyan-300 text-sm">
                              {comp.serialNumber}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                              QR
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-300 font-medium truncate max-w-[200px]">
                            {comp.partName}
                          </p>
                        </td>

                        {/* Current Placement */}
                        <td className="p-3 sm:p-4">
                          {comp.currentWagonNumber ? (
                            <div>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (onNavigateToWagon && comp.currentWagonNumber) {
                                    onNavigateToWagon(comp.currentWagonNumber);
                                  }
                                }}
                                className="text-orange-400 hover:text-orange-300 font-mono font-bold hover:underline flex items-center gap-1"
                              >
                                <span>🚂</span>
                                <span>{comp.currentWagonNumber}</span>
                              </button>
                              <span className="text-[10px] text-slate-400 font-semibold block">
                                Pos: {comp.currentBogiePosition}
                              </span>
                            </div>
                          ) : (
                            <div>
                              <span className="text-slate-400 font-medium">{isHi ? 'डिपो स्टोर्स' : 'Depot Stores'}</span>
                              <span className="text-[10px] text-cyan-400 block font-mono">
                                {comp.binLocation || 'Unassigned'}
                              </span>
                            </div>
                          )}
                        </td>

                        {/* Health Score */}
                        <td className="p-3 sm:p-4">
                          {getHealthBadge(comp.healthStatus, comp.healthScore)}
                        </td>

                        {/* Status */}
                        <td className="p-3 sm:p-4">
                          {getStatusBadge(comp.status)}
                        </td>

                        {/* Mfg / Overhauls */}
                        <td className="p-3 sm:p-4 text-slate-400">
                          <p className="truncate max-w-[140px]">{comp.manufacturer}</p>
                          <p className="text-[10px] text-slate-500">
                            POH: {comp.overhaulCount} | {comp.totalKmTravelled.toLocaleString()} km
                          </p>
                          {/*
                            For a bearing, how many end cap screws are painted
                            yellow. WMM 2.0 Chapter 6 requires every bearing
                            under one wagon to carry the same scheme, so this
                            is the number a fitter has to match — shown here
                            rather than counted off the screws at the wagon.
                          */}
                          {comp.componentType === 'BEARING' && (
                            <p className="text-[10px] text-amber-400/90 font-semibold">
                              {isHi ? 'ROH चक्र' : 'ROH cycles'}: {(comp as any).rohCyclesSincePoh ?? 0}
                              {' '}
                              <span className="text-amber-500/70">
                                ({(comp as any).rohCyclesSincePoh ? `${(comp as any).rohCyclesSincePoh} ${isHi ? 'पेंटेड स्क्रू' : 'painted'}` : (isHi ? 'बिना पेंट' : 'unpainted')})
                              </span>
                            </p>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="p-3 sm:p-4 text-right">
                          <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                            {comp.componentType === 'BEARING' && ((comp as any).rohCyclesSincePoh ?? 0) < 3 && (
                              <button
                                onClick={async () => {
                                  try {
                                    await api.recordComponentRoh(comp.serialNumber, 'ROH recorded at depot');
                                    await loadData();
                                  } catch (e: any) {
                                    setError(e?.message || 'Could not record ROH');
                                  }
                                }}
                                title={isHi ? 'नियमित ओवरहॉल दर्ज करें' : 'Record a routine overhaul (one more painted screw)'}
                                className="px-2.5 py-1 bg-amber-700/80 hover:bg-amber-600 text-white rounded text-[11px] font-bold transition shadow"
                              >
                                {isHi ? 'ROH' : 'ROH'}
                              </button>
                            )}
                            {comp.status === 'AVAILABLE_IN_STORES' || comp.status === 'RECONDITIONED' ? (
                              <button
                                onClick={() => {
                                  setAssigningComponent(comp);
                                  setAssignForm({ wagonNumber: '', bogiePosition: 'BOGIE_1', notes: '' });
                                }}
                                className="px-2.5 py-1 bg-cyan-700/80 hover:bg-cyan-600 text-white rounded text-[11px] font-bold transition shadow"
                              >
                                {isHi ? 'लगाएँ' : 'Mount'}
                              </button>
                            ) : comp.status === 'IN_SERVICE' ? (
                              <button
                                onClick={() => {
                                  setUnassigningComponent(comp);
                                  setUnassignForm({ targetStatus: 'AVAILABLE_IN_STORES', reason: 'POH Service', notes: '' });
                                }}
                                className="px-2.5 py-1 bg-amber-700/80 hover:bg-amber-600 text-white rounded text-[11px] font-bold transition shadow"
                              >{isHi ? 'हटाएँ' : 'Unassign'}</button>
                            ) : null}

                            <button
                              onClick={() => handleSelectComponent(comp)}
                              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-[11px] font-semibold transition"
                            >
                              {isHi ? 'पासपोर्ट ↗' : 'Passport ↗'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Selected Component Health Passport Detailed Drawer */}
        {selectedComponent && (
          <div className="bg-slate-900 border border-cyan-500/40 rounded-xl p-5 space-y-5 shadow-2xl flex flex-col h-fit">
            {/* Passport Header */}
            <div className="flex items-start justify-between border-b border-slate-800 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse"></span>
                  <span className="text-[11px] font-bold uppercase text-cyan-400 tracking-wider">{isHi ? 'डिजिटल हेल्थ पासपोर्ट' : 'Digital Health Passport'}</span>
                </div>
                <h3 className="text-lg font-black text-white font-mono mt-1">
                  {selectedComponent.serialNumber}
                </h3>
                <p className="text-xs text-slate-300 font-medium">{selectedComponent.partName}</p>
              </div>
              <button
                onClick={() => setSelectedComponent(null)}
                className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center font-bold text-xs"
              >
                ✕
              </button>
            </div>

            {/* Health Score Gauge */}
            <div className="p-3.5 bg-slate-950/70 border border-slate-800 rounded-xl space-y-2">
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-400 font-semibold">Degradation & Health Index:</span>
                {getHealthBadge(selectedComponent.healthStatus, selectedComponent.healthScore)}
              </div>
              <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 ${
                    selectedComponent.healthScore >= 90
                      ? 'bg-emerald-500'
                      : selectedComponent.healthScore >= 75
                      ? 'bg-blue-500'
                      : selectedComponent.healthScore >= 60
                      ? 'bg-amber-500'
                      : selectedComponent.healthScore >= 40
                      ? 'bg-orange-500'
                      : 'bg-rose-500'
                  }`}
                  style={{ width: `${selectedComponent.healthScore}%` }}
                />
              </div>
            </div>

            {/* Key Specs Card */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 bg-slate-950/60 rounded-lg border border-slate-800">
                <span className="text-[10px] text-slate-500 font-bold uppercase block">{isHi ? 'स्थिति' : 'Status'}</span>
                {getStatusBadge(selectedComponent.status)}
              </div>

              <div className="p-2.5 bg-slate-950/60 rounded-lg border border-slate-800">
                <span className="text-[10px] text-slate-500 font-bold uppercase block">{isHi ? 'वर्तमान स्थान' : 'Current Location'}</span>
                <span className="font-bold text-white font-mono">
                  {selectedComponent.currentWagonNumber
                    ? `${selectedComponent.currentWagonNumber} (${selectedComponent.currentBogiePosition})`
                    : selectedComponent.binLocation || 'Stores'}
                </span>
              </div>

              <div className="p-2.5 bg-slate-950/60 rounded-lg border border-slate-800">
                <span className="text-[10px] text-slate-500 font-bold uppercase block">{isHi ? 'निर्माता' : 'Manufacturer'}</span>
                <span className="font-medium text-slate-200 truncate block">
                  {selectedComponent.manufacturer}
                </span>
              </div>

              <div className="p-2.5 bg-slate-950/60 rounded-lg border border-slate-800">
                <span className="text-[10px] text-slate-500 font-bold uppercase block">{isHi ? 'निर्माण तिथि' : 'Mfg Date'}</span>
                <span className="font-medium text-slate-200 font-mono">
                  {selectedComponent.manufacturingDate}
                </span>
              </div>

              <div className="p-2.5 bg-slate-950/60 rounded-lg border border-slate-800">
                <span className="text-[10px] text-slate-500 font-bold uppercase block">{isHi ? 'कुल ओडोमीटर' : 'Total Odometer'}</span>
                <span className="font-bold text-cyan-300 font-mono">
                  {selectedComponent.totalKmTravelled.toLocaleString()} km
                </span>
              </div>

              <div className="p-2.5 bg-slate-950/60 rounded-lg border border-slate-800">
                <span className="text-[10px] text-slate-500 font-bold uppercase block">{isHi ? 'पीओएच ओवरहॉल' : 'POH Overhauls'}</span>
                <span className="font-bold text-purple-300 font-mono">
                  {selectedComponent.overhaulCount} Cycles
                </span>
              </div>
            </div>

            {/* QR Verification Code String */}
            <div className="p-2.5 bg-slate-950/80 rounded-lg border border-slate-800 font-mono text-[11px] break-all text-cyan-400">
              <span className="text-[10px] text-slate-500 uppercase block font-sans font-bold">QR Protocol URI:</span>
              {selectedComponent.qrCode}
            </div>

            {/* Action Bar */}
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setHealthUpdateComponent(selectedComponent);
                  setHealthForm({ healthScore: selectedComponent.healthScore, notes: '' });
                }}
                className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-lg border border-slate-700 transition"
              >
                ⚙️ Adjust Health
              </button>

              {selectedComponent.status === 'AVAILABLE_IN_STORES' || selectedComponent.status === 'RECONDITIONED' ? (
                <button
                  onClick={() => {
                    setAssigningComponent(selectedComponent);
                    setAssignForm({ wagonNumber: '', bogiePosition: 'BOGIE_1', notes: '' });
                  }}
                  className="flex-1 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold rounded-lg transition shadow"
                >
                  Mount to Wagon
                </button>
              ) : selectedComponent.status === 'IN_SERVICE' ? (
                <button
                  onClick={() => {
                    setUnassigningComponent(selectedComponent);
                    setUnassignForm({ targetStatus: 'AVAILABLE_IN_STORES', reason: 'POH Cycle', notes: '' });
                  }}
                  className="flex-1 py-2 bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold rounded-lg transition shadow"
                >{isHi ? 'हटाएँ' : 'Unassign'}</button>
              ) : null}
            </div>

            {/* Multi-Wagon Lifecycle History Timeline */}
            <div className="space-y-2.5 pt-3 border-t border-slate-800">
              <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center justify-between">
                <span>📜 Multi-Wagon Provenance Ledger</span>
                <span className="text-[10px] text-slate-500">{isHi ? 'अपरिवर्तनीय ऑडिट ट्रेल' : 'Immutable Audit Trail'}</span>
              </h4>

              {historyLoading ? (
                <div className="p-4 text-center text-slate-500 text-xs font-mono">Loading history...</div>
              ) : componentHistory.length === 0 ? (
                <div className="p-3 text-center text-slate-500 text-xs bg-slate-950/40 rounded-lg">
                  Initial registration recorded. No subsequent transitions.
                </div>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {componentHistory.map((ev, idx) => (
                    <div
                      key={ev.id || idx}
                      className="p-2.5 bg-slate-950/70 border border-slate-800/80 rounded-lg text-xs space-y-1"
                    >
                      <div className="flex justify-between items-center text-[10px]">
                        <span className="font-bold text-cyan-400">{ev.eventType}</span>
                        <span className="text-slate-500 font-mono">
                          {new Date(ev.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-slate-300 text-[11px] leading-relaxed">{ev.actionDetails}</p>
                      <div className="flex justify-between items-center text-[10px] text-slate-400">
                        {ev.wagonNumber && (
                          <span className="text-orange-400 font-mono">Wagon: {ev.wagonNumber}</span>
                        )}
                        <span>By: {ev.performerName}</span>
                      </div>
                      {ev.notes && (
                        <p className="text-[10px] text-slate-400 italic">Notes: {ev.notes}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* QR Scanner Modal */}
      <PassportQRScannerModal
        isOpen={isQRScannerOpen}
        onClose={() => setIsQRScannerOpen(false)}
        onComponentScanned={handleQRScanned}
      />

      {/* Register Component Modal */}
      {isRegisterModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-cyan-500/40 rounded-2xl p-6 max-w-lg w-full shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white">{isHi ? 'नया क्रमांकित घटक पंजीकृत करें' : 'Register New Serialized Component'}</h3>
              <button
                onClick={() => setIsRegisterModalOpen(false)}
                className="text-slate-400 hover:text-white font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleRegisterSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Serial Number *</label>
                <input
                  type="text"
                  required
                  value={regForm.serialNumber}
                  onChange={(e) => setRegForm({ ...regForm, serialNumber: e.target.value.toUpperCase() })}
                  placeholder="e.g. WRS-WS-2026-099"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">{isHi ? 'घटक प्रकार' : 'Component Type'}</label>
                  <select
                    value={regForm.componentType}
                    onChange={(e) => setRegForm({ ...regForm, componentType: e.target.value as SerializedComponentType })}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
                  >
                    <option value="WHEELSET">{isHi ? 'व्हीलसेट' : 'Wheelset'}</option>
                    <option value="BEARING">{isHi ? 'बेयरिंग (CTRB)' : 'Bearing (CTRB)'}</option>
                    <option value="DRAFT_GEAR">{isHi ? 'ड्राफ्ट गियर' : 'Draft Gear'}</option>
                    <option value="BOGIE_FRAME_BOLSTER">{isHi ? 'बोगी बोल्स्टर' : 'Bogie Bolster'}</option>
                    <option value="BRAKE_VALVE">{isHi ? 'ब्रेक वाल्व' : 'Brake Valve'}</option>
                    <option value="COUPLER">{isHi ? 'कपलर (CBC)' : 'Coupler (CBC)'}</option>
                    <option value="FRICTION_WEDGE">{isHi ? 'घर्षण वेज' : 'Friction Wedge'}</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">{isHi ? 'निर्माता' : 'Manufacturer'}</label>
                  <input
                    type="text"
                    value={regForm.manufacturer}
                    onChange={(e) => setRegForm({ ...regForm, manufacturer: e.target.value })}
                    placeholder="e.g. RWF Yelahanka"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">{isHi ? 'निर्माण तिथि' : 'Manufacturing Date'}</label>
                  <input
                    type="date"
                    value={regForm.manufacturingDate}
                    onChange={(e) => setRegForm({ ...regForm, manufacturingDate: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white font-mono"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">{isHi ? 'बिन स्थान' : 'Bin Location'}</label>
                  <input
                    type="text"
                    value={regForm.binLocation}
                    onChange={(e) => setRegForm({ ...regForm, binLocation: e.target.value })}
                    placeholder="BAY-1-RACK-A"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">{isHi ? 'आरएफआईडी टैग (वैकल्पिक)' : 'RFID Tag (Optional)'}</label>
                <input
                  type="text"
                  value={regForm.rfidTag}
                  onChange={(e) => setRegForm({ ...regForm, rfidTag: e.target.value })}
                  placeholder="RFID-HEX-..."
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white font-mono"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsRegisterModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 text-slate-300 rounded-lg font-bold"
                >{isHi ? 'रद्द करें' : 'Cancel'}</button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-bold shadow"
                >{isHi ? 'घटक पंजीकृत करें' : 'Register Component'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Assign to Wagon Modal */}
      {assigningComponent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-cyan-500/40 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white">
                Mount Component to Wagon: {assigningComponent.serialNumber}
              </h3>
              <button onClick={() => setAssigningComponent(null)} className="text-slate-400 hover:text-white font-bold">
                ✕
              </button>
            </div>

            <form onSubmit={handleAssignSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Target Wagon Number *</label>
                <input
                  type="text"
                  required
                  value={assignForm.wagonNumber}
                  onChange={(e) => setAssignForm({ ...assignForm, wagonNumber: e.target.value.toUpperCase() })}
                  placeholder="e.g. SECR/BOXNHL/90011"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">{isHi ? 'बोगी स्थान' : 'Bogie Position'}</label>
                <select
                  value={assignForm.bogiePosition}
                  onChange={(e) => setAssignForm({ ...assignForm, bogiePosition: e.target.value as any })}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
                >
                  <option value="BOGIE_1">Bogie 1 (Leading)</option>
                  <option value="BOGIE_2">Bogie 2 (Trailing)</option>
                  <option value="UNDERFRAME">{isHi ? 'अंडरफ्रेम असेंबली' : 'Underframe Assembly'}</option>
                  <option value="BODY">{isHi ? 'वैगन बॉडी' : 'Wagon Body'}</option>
                  <option value="NONE">{isHi ? 'सामान्य स्थान' : 'General Placement'}</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">{isHi ? 'स्थापना टिप्पणी' : 'Mounting Notes'}</label>
                <textarea
                  value={assignForm.notes}
                  onChange={(e) => setAssignForm({ ...assignForm, notes: e.target.value })}
                  placeholder={isHi ? 'ओवरहॉल विवरण, टॉर्क जाँच...' : 'Overhaul details, torque check...'}
                  rows={2}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setAssigningComponent(null)}
                  className="px-4 py-2 bg-slate-800 text-slate-300 rounded-lg font-bold"
                >{isHi ? 'रद्द करें' : 'Cancel'}</button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-bold shadow"
                >{isHi ? 'स्थापना की पुष्टि करें' : 'Confirm Mount'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Unassign Component Modal */}
      {unassigningComponent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-amber-500/40 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white">
                Unassign Component: {unassigningComponent.serialNumber}
              </h3>
              <button onClick={() => setUnassigningComponent(null)} className="text-slate-400 hover:text-white font-bold">
                ✕
              </button>
            </div>

            <form onSubmit={handleUnassignSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">{isHi ? 'लक्ष्य स्थिति' : 'Target Status'}</label>
                <select
                  value={unassignForm.targetStatus}
                  onChange={(e) => setUnassignForm({ ...unassignForm, targetStatus: e.target.value as ComponentStatus })}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
                >
                  <option value="AVAILABLE_IN_STORES">{isHi ? 'स्टोर्स डिपो (उपलब्ध)' : 'Stores Depot (Available)'}</option>
                  <option value="RECONDITIONED">{isHi ? 'पुनर्निर्मित' : 'Reconditioned'}</option>
                  <option value="UNDER_MAINTENANCE">{isHi ? 'अनुरक्षण में' : 'Under Maintenance'}</option>
                  <option value="CONDEMNED">{isHi ? 'कंडम' : 'Condemned'}</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Reason for Removal</label>
                <input
                  type="text"
                  required
                  value={unassignForm.reason}
                  onChange={(e) => setUnassignForm({ ...unassignForm, reason: e.target.value })}
                  placeholder="e.g. Wheel flange wear, scheduled POH"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">{isHi ? 'निरीक्षण टिप्पणी' : 'Inspection Notes'}</label>
                <textarea
                  value={unassignForm.notes}
                  onChange={(e) => setUnassignForm({ ...unassignForm, notes: e.target.value })}
                  placeholder={isHi ? 'उतारते समय स्थिति टिप्पणी...' : 'Condition notes upon unmounting...'}
                  rows={2}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setUnassigningComponent(null)}
                  className="px-4 py-2 bg-slate-800 text-slate-300 rounded-lg font-bold"
                >{isHi ? 'रद्द करें' : 'Cancel'}</button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-bold shadow"
                >{isHi ? 'स्टोर्स में वापस' : 'Return to Stores'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Adjust Health Modal */}
      {healthUpdateComponent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-cyan-500/40 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white">
                Update Health Score: {healthUpdateComponent.serialNumber}
              </h3>
              <button onClick={() => setHealthUpdateComponent(null)} className="text-slate-400 hover:text-white font-bold">
                ✕
              </button>
            </div>

            <form onSubmit={handleHealthSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  Health Score (0 - 100%): <span className="text-cyan-400 font-bold">{healthForm.healthScore}%</span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={healthForm.healthScore}
                  onChange={(e) => setHealthForm({ ...healthForm, healthScore: Number(e.target.value) })}
                  className="w-full"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">{isHi ? 'मूल्यांकन कारण' : 'Evaluation Justification'}</label>
                <textarea
                  value={healthForm.notes}
                  onChange={(e) => setHealthForm({ ...healthForm, notes: e.target.value })}
                  placeholder={isHi ? 'स्कोर अद्यतन का कारण / अल्ट्रासोनिक दोष जाँच...' : 'Reason for score update / ultrasonic flaw check...'}
                  rows={2}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setHealthUpdateComponent(null)}
                  className="px-4 py-2 bg-slate-800 text-slate-300 rounded-lg font-bold"
                >{isHi ? 'रद्द करें' : 'Cancel'}</button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-bold shadow"
                >{isHi ? 'स्वास्थ्य स्कोर सुरक्षित करें' : 'Save Health Score'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
