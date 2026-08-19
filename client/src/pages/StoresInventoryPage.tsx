/**
 * Stores Depot Inventory & Material Management Page
 * Indian Railways WRS Raipur (Phase 3 - M1 / R5)
 */

import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api.ts';
import { useI18n } from '../i18n/index.ts';
import type { StoresPart, InventoryReservation, InventoryStats, CASNUBCategory } from '../../../shared/types.ts';
import { CASNUB_CATEGORIES } from '../../../shared/types.ts';
import {
  PackageIcon,
  SearchIcon,
  RefreshCwIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
  CpuIcon,
  PlusCircleIcon,
  FilterIcon
} from '../components/Icons.tsx';

const CATEGORY_NAMES: Record<CASNUBCategory, { en: string; hi: string }> = {
  SPRINGS: { en: 'Coil & Snubber Springs', hi: 'कॉइल एवं स्नबर स्प्रिंग्स' },
  WHEELS_AXLES: { en: 'Wheels & Axles', hi: 'पहिए एवं धुरा' },
  BEARINGS: { en: 'CTRB Bearings', hi: 'सीटीआरबी बेयरिंग' },
  BRAKE_SYSTEM: { en: 'Brake System & DV', hi: 'ब्रेक प्रणाली एवं डीवी' },
  COUPLERS_DRAFT_GEAR: { en: 'Coupler & Draft Gear', hi: 'कप्लर एवं ड्राफ्ट गियर' },
  BOGIE_FRAME_BOLSTER: { en: 'Bogie Frame & Bolster', hi: 'बोगी फ्रेम व बोल्स्टर' },
  FRICTION_WEDGES: { en: 'Friction Wedges', hi: 'घर्षण वेज' },
  BODY_UNDERFRAME: { en: 'Body & Underframe', hi: 'बॉडी एवं अंडरफ्रेम' }
};

export const StoresInventoryPage: React.FC = () => {
  const { t, lang } = useI18n();

  const [parts, setParts] = useState<StoresPart[]>([]);
  const [stats, setStats] = useState<InventoryStats | null>(null);
  const [reservations, setReservations] = useState<InventoryReservation[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  // Tabs & Filters
  const [activeTab, setActiveTab] = useState<'catalog' | 'reservations'>('catalog');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [reservationStatusFilter, setReservationStatusFilter] = useState<string>('ALL');

  // Modals
  const [restockModalPart, setRestockModalPart] = useState<StoresPart | null>(null);
  const [restockQuantity, setRestockQuantity] = useState<number>(10);
  const [issueModalReservation, setIssueModalReservation] = useState<InventoryReservation | null>(null);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 4000);
  };

  const loadData = useCallback(async (showSpinner: boolean = true) => {
    if (showSpinner) setLoading(true);
    try {
      const [inventoryRes, statsRes, reservationsRes] = await Promise.all([
        api.getInventory(),
        api.getInventoryStats(),
        api.getInventoryReservations()
      ]);

      if (inventoryRes.success) setParts(inventoryRes.data);
      if (statsRes.success) setStats(statsRes.data);
      if (reservationsRes.success) setReservations(reservationsRes.data);
    } catch (err: any) {
      console.error('Failed to load stores inventory:', err);
      showToast(err.message || 'Failed to load inventory data.', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData(true);
  }, [loadData]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadData(false);
  };

  const handleRestockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!restockModalPart) return;
    setActionLoading(true);
    try {
      const res = await api.restockPart({
        partCode: restockModalPart.partCode,
        quantity: Number(restockQuantity)
      });
      if (res.success) {
        showToast(`Successfully restocked ${restockQuantity} units of ${restockModalPart.partCode}. New stock: ${res.data.stockQuantity}`);
        setRestockModalPart(null);
        setRestockQuantity(10);
        await loadData(false);
      }
    } catch (err: any) {
      showToast(err.message || 'Restock failed', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleIssueSubmit = async (reservationId: string) => {
    setActionLoading(true);
    try {
      const res = await api.issuePart(reservationId);
      if (res.success) {
        showToast(`Issued ${res.data.reservation.quantity}x ${res.data.reservation.partCode} to shop floor for wagon ${res.data.reservation.wagonNumber}.`);
        setIssueModalReservation(null);
        await loadData(false);
      }
    } catch (err: any) {
      showToast(err.message || 'Issuing part failed', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  // Filtered Parts
  const filteredParts = parts.filter((part) => {
    const matchesCat = selectedCategory === 'ALL' || part.category === selectedCategory;
    const query = searchQuery.trim().toLowerCase();
    const matchesSearch =
      query === '' ||
      part.partCode.toLowerCase().includes(query) ||
      part.partName.toLowerCase().includes(query) ||
      part.binLocation.toLowerCase().includes(query) ||
      part.supplierName.toLowerCase().includes(query);
    return matchesCat && matchesSearch;
  });

  // Filtered Reservations
  const filteredReservations = reservations.filter((res) => {
    const matchesStatus =
      reservationStatusFilter === 'ALL' || res.status === reservationStatusFilter;
    const query = searchQuery.trim().toLowerCase();
    const matchesSearch =
      query === '' ||
      res.wagonNumber.toLowerCase().includes(query) ||
      res.partCode.toLowerCase().includes(query) ||
      (res.predictedDefect && res.predictedDefect.toLowerCase().includes(query)) ||
      (res.partName && res.partName.toLowerCase().includes(query));
    return matchesStatus && matchesSearch;
  });

  const formatInr = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(amount);
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Toast Notification */}
      {toastMessage && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-5 py-3 rounded-xl shadow-2xl flex items-center gap-3 border text-sm font-bold backdrop-blur-md animate-bounce ${
            toastMessage.type === 'success'
              ? 'bg-emerald-950/90 text-emerald-200 border-emerald-700'
              : 'bg-rose-950/90 text-rose-200 border-rose-700'
          }`}
        >
          {toastMessage.type === 'success' ? (
            <CheckCircleIcon size={20} className="text-emerald-400" />
          ) : (
            <AlertTriangleIcon size={20} className="text-rose-400" />
          )}
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* Page Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-slate-900 border border-slate-800 p-5 sm:p-6 rounded-2xl shadow-xl">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400 shadow-inner">
            <PackageIcon size={28} />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight flex items-center gap-2.5">
              <span>{t('inventory.title', 'Stores Depot Inventory & Material Management')}</span>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-blue-950 text-blue-400 border border-blue-800 font-bold uppercase tracking-wider">
                CASNUB R5
              </span>
            </h1>
            <p className="text-xs sm:text-sm text-slate-400 font-medium mt-0.5">
              {t('inventory.subtitle', 'WRS Raipur CASNUB Parts Stock, Auto-Reservations & Shop Floor Issuing')}
            </p>
          </div>
        </div>

        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="min-h-[44px] px-4 py-2 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-200 font-bold text-xs rounded-xl flex items-center gap-2 border border-slate-700 shadow transition-all self-end sm:self-auto"
        >
          <RefreshCwIcon size={16} className={refreshing ? 'animate-spin text-blue-400' : 'text-slate-400'} />
          <span>{refreshing ? t('app.syncing', 'Syncing...') : 'Refresh Stock'}</span>
        </button>
      </div>

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Parts */}
        <div className="bg-slate-900 border border-slate-800 p-4 sm:p-5 rounded-2xl shadow-lg relative overflow-hidden">
          <div className="flex items-center justify-between text-slate-400 text-xs font-bold uppercase tracking-wider">
            <span>{t('inventory.totalParts', 'Total Catalog Parts')}</span>
            <PackageIcon size={18} className="text-blue-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-black text-white font-mono">
              {stats?.totalParts ?? parts.length}
            </span>
            <span className="text-xs text-slate-400 font-medium">Standard CASNUB SKUs</span>
          </div>
          <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/5 rounded-full blur-xl pointer-events-none"></div>
        </div>

        {/* Low Stock Alerts */}
        <div className="bg-slate-900 border border-slate-800 p-4 sm:p-5 rounded-2xl shadow-lg relative overflow-hidden">
          <div className="flex items-center justify-between text-slate-400 text-xs font-bold uppercase tracking-wider">
            <span>{t('inventory.lowStock', 'Low Stock Alerts')}</span>
            <AlertTriangleIcon size={18} className={(stats?.lowStockCount ?? 0) > 0 ? 'text-amber-400' : 'text-slate-500'} />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className={`text-2xl sm:text-3xl font-black font-mono ${
              (stats?.lowStockCount ?? 0) > 0 ? 'text-amber-400' : 'text-emerald-400'
            }`}>
              {stats?.lowStockCount ?? 0}
            </span>
            <span className="text-xs text-slate-400 font-medium">Below reorder limit</span>
          </div>
          <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/5 rounded-full blur-xl pointer-events-none"></div>
        </div>

        {/* Active Reservations */}
        <div className="bg-slate-900 border border-slate-800 p-4 sm:p-5 rounded-2xl shadow-lg relative overflow-hidden">
          <div className="flex items-center justify-between text-slate-400 text-xs font-bold uppercase tracking-wider">
            <span>{t('inventory.activeReservations', 'Active Reservations')}</span>
            <CpuIcon size={18} className="text-purple-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-black text-purple-400 font-mono">
              {stats?.totalReservedCount ?? reservations.filter(r => r.status === 'RESERVED').length}
            </span>
            <span className="text-xs text-purple-300/80 font-medium">Auto-Reserved / OMRS</span>
          </div>
          <div className="absolute top-0 right-0 w-24 h-24 bg-purple-500/5 rounded-full blur-xl pointer-events-none"></div>
        </div>

        {/* Stock Valuation */}
        <div className="bg-slate-900 border border-slate-800 p-4 sm:p-5 rounded-2xl shadow-lg relative overflow-hidden">
          <div className="flex items-center justify-between text-slate-400 text-xs font-bold uppercase tracking-wider">
            <span>{t('inventory.totalValuation', 'Depot Stock Valuation')}</span>
            <span className="text-emerald-400 font-bold text-sm">₹</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-xl sm:text-2xl font-black text-emerald-400 font-mono truncate">
              {stats?.totalValuationInr ? formatInr(stats.totalValuationInr) : '₹0'}
            </span>
          </div>
          <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 rounded-full blur-xl pointer-events-none"></div>
        </div>
      </div>

      {/* Main Tabs Navigation */}
      <div className="flex border-b border-slate-800">
        <button
          onClick={() => setActiveTab('catalog')}
          className={`min-h-[48px] px-6 py-3 font-bold text-sm border-b-2 flex items-center gap-2 transition-all ${
            activeTab === 'catalog'
              ? 'border-blue-500 text-blue-400 bg-blue-500/5'
              : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
          }`}
        >
          <PackageIcon size={18} />
          <span>{t('inventory.partsTab', 'Stores Catalog & Stock Levels')}</span>
          <span className="ml-1.5 px-2 py-0.5 text-xs font-mono font-bold bg-slate-800 text-slate-300 rounded-full">
            {parts.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('reservations')}
          className={`min-h-[48px] px-6 py-3 font-bold text-sm border-b-2 flex items-center gap-2 transition-all ${
            activeTab === 'reservations'
              ? 'border-blue-500 text-blue-400 bg-blue-500/5'
              : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
          }`}
        >
          <CpuIcon size={18} />
          <span>{t('inventory.reservationsTab', 'Active Reservations & Pre-Arrival Allocations')}</span>
          <span className="ml-1.5 px-2 py-0.5 text-xs font-mono font-bold bg-purple-950 text-purple-300 border border-purple-800 rounded-full">
            {reservations.length}
          </span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <SearchIcon size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={
              activeTab === 'catalog'
                ? t('inventory.searchPlaceholder', 'Search part code, name, bin location...')
                : 'Search wagon number, part code, defect...'
            }
            className="w-full pl-10 pr-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
          />
        </div>

        {activeTab === 'catalog' && (
          <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto no-scrollbar pb-1 sm:pb-0">
            <FilterIcon size={16} className="text-slate-500 shrink-0 hidden sm:inline" />
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="px-3 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-xs font-bold text-slate-300 focus:outline-none focus:border-blue-500"
            >
              <option value="ALL">All 8 RDSO Categories</option>
              {CASNUB_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {CATEGORY_NAMES[cat]?.[lang] || cat}
                </option>
              ))}
            </select>
          </div>
        )}

        {activeTab === 'reservations' && (
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <select
              value={reservationStatusFilter}
              onChange={(e) => setReservationStatusFilter(e.target.value)}
              className="px-3 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-xs font-bold text-slate-300 focus:outline-none focus:border-blue-500"
            >
              <option value="ALL">All Reservation Statuses</option>
              <option value="RESERVED">RESERVED</option>
              <option value="ALLOCATED">ALLOCATED</option>
              <option value="ISSUED_TO_FLOOR">ISSUED_TO_FLOOR</option>
            </select>
          </div>
        )}
      </div>

      {/* Tab 1: Stores Catalog Table */}
      {activeTab === 'catalog' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          {loading ? (
            <div className="p-12 text-center text-slate-400 font-medium">
              <RefreshCwIcon size={24} className="animate-spin text-blue-500 mx-auto mb-3" />
              Loading stores inventory catalog...
            </div>
          ) : filteredParts.length === 0 ? (
            <div className="p-12 text-center text-slate-500 font-medium">
              No parts matched the selected search or filter criteria.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs sm:text-sm">
                <thead>
                  <tr className="bg-slate-950/80 border-b border-slate-800 text-slate-400 font-bold uppercase tracking-wider text-[11px]">
                    <th className="py-3.5 px-4">{t('inventory.partCode', 'Part Code')}</th>
                    <th className="py-3.5 px-4">{t('inventory.partName', 'Part Name & Category')}</th>
                    <th className="py-3.5 px-4 text-center">{t('inventory.stockLevel', 'Stock / Reserved / Available')}</th>
                    <th className="py-3.5 px-4 text-center">{t('inventory.status', 'Stock Status')}</th>
                    <th className="py-3.5 px-4">{t('inventory.unitCost', 'Unit Cost (₹)')}</th>
                    <th className="py-3.5 px-4">{t('inventory.binLocation', 'Bin Location')}</th>
                    <th className="py-3.5 px-4 text-right">{t('inventory.actions', 'Actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredParts.map((part) => {
                    const isLow = part.stockQuantity <= part.reorderThreshold;
                    const isCritical = part.availableQuantity === 0;

                    return (
                      <tr key={part.id} className="hover:bg-slate-800/40 transition-colors">
                        {/* Part Code */}
                        <td className="py-3.5 px-4 font-mono font-bold text-blue-400 whitespace-nowrap">
                          {part.partCode}
                        </td>

                        {/* Part Name & Category */}
                        <td className="py-3.5 px-4">
                          <div className="font-bold text-white leading-tight">{part.partName}</div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-medium">
                              {CATEGORY_NAMES[part.category]?.[lang] || part.category}
                            </span>
                            <span className="text-[10px] text-slate-500 truncate max-w-[200px]">
                              {part.supplierName}
                            </span>
                          </div>
                        </td>

                        {/* Stock breakdown */}
                        <td className="py-3.5 px-4 text-center font-mono">
                          <div className="flex items-center justify-center gap-2">
                            <span className="font-bold text-white" title="Total in Stock">
                              {part.stockQuantity}
                            </span>
                            <span className="text-slate-600">/</span>
                            <span className="text-purple-400 font-semibold" title="Reserved Quantity">
                              {part.reservedQuantity}
                            </span>
                            <span className="text-slate-600">/</span>
                            <span className="font-bold text-emerald-400" title="Available to Issue">
                              {part.availableQuantity}
                            </span>
                            <span className="text-[10px] text-slate-500 font-sans">{part.unitOfMeasure}</span>
                          </div>
                        </td>

                        {/* Status Badge */}
                        <td className="py-3.5 px-4 text-center whitespace-nowrap">
                          {isCritical ? (
                            <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-950 text-rose-300 border border-rose-800">
                              {t('inventory.criticalStock', 'Critical')}
                            </span>
                          ) : isLow ? (
                            <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-950 text-amber-300 border border-amber-800">
                              {t('inventory.lowStockBadge', 'Low Stock')}
                            </span>
                          ) : (
                            <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800">
                              {t('inventory.inStock', 'In Stock')}
                            </span>
                          )}
                        </td>

                        {/* Unit Cost */}
                        <td className="py-3.5 px-4 font-mono text-slate-300 whitespace-nowrap">
                          {formatInr(part.unitCostInr)}
                        </td>

                        {/* Bin Location */}
                        <td className="py-3.5 px-4 font-mono text-xs text-slate-400 whitespace-nowrap">
                          <span className="px-2 py-1 rounded bg-slate-950 border border-slate-800">
                            {part.binLocation}
                          </span>
                        </td>

                        {/* Actions */}
                        <td className="py-3.5 px-4 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => setRestockModalPart(part)}
                              className="px-3 py-1.5 bg-blue-900/40 hover:bg-blue-800/60 text-blue-300 border border-blue-700/50 rounded-lg text-xs font-bold flex items-center gap-1 transition-all"
                            >
                              <PlusCircleIcon size={14} />
                              <span>{t('inventory.restockBtn', 'Restock')}</span>
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
      )}

      {/* Tab 2: Active Reservations Table */}
      {activeTab === 'reservations' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          {loading ? (
            <div className="p-12 text-center text-slate-400 font-medium">
              <RefreshCwIcon size={24} className="animate-spin text-blue-500 mx-auto mb-3" />
              Loading active inventory reservations...
            </div>
          ) : filteredReservations.length === 0 ? (
            <div className="p-12 text-center text-slate-500 font-medium">
              {t('inventory.noReservations', 'No active inventory reservations found.')}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs sm:text-sm">
                <thead>
                  <tr className="bg-slate-950/80 border-b border-slate-800 text-slate-400 font-bold uppercase tracking-wider text-[11px]">
                    <th className="py-3.5 px-4">{t('inventory.wagonNumber', 'Wagon Number')}</th>
                    <th className="py-3.5 px-4">{t('inventory.partCode', 'Part Code & Name')}</th>
                    <th className="py-3.5 px-4">{t('inventory.source', 'Source / Reason')}</th>
                    <th className="py-3.5 px-4 text-center">{t('inventory.confidence', 'AI Confidence')}</th>
                    <th className="py-3.5 px-4 text-center">{t('inventory.resStatus', 'Status')}</th>
                    <th className="py-3.5 px-4 text-right">{t('inventory.actions', 'Actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredReservations.map((res) => {
                    const isOMRS = res.source === 'OMRS_AI_TRIAGE';
                    const isIssued = res.status === 'ISSUED_TO_FLOOR';

                    return (
                      <tr key={res.id} className="hover:bg-slate-800/40 transition-colors">
                        {/* Wagon Number */}
                        <td className="py-3.5 px-4 font-mono font-bold text-orange-400 whitespace-nowrap">
                          {res.wagonNumber}
                        </td>

                        {/* Part Code & Name */}
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-blue-400">{res.partCode}</span>
                            <span className="px-1.5 py-0.5 text-xs font-mono font-bold bg-slate-800 text-slate-300 rounded">
                              x{res.quantity}
                            </span>
                          </div>
                          {res.partName && (
                            <div className="text-xs text-slate-400 mt-0.5 truncate max-w-[280px]">
                              {res.partName}
                            </div>
                          )}
                        </td>

                        {/* Source / Defect */}
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-2">
                            {isOMRS ? (
                              <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-purple-950 text-purple-300 border border-purple-800 flex items-center gap-1">
                                <CpuIcon size={12} />
                                {t('inventory.omrsTriageBadge', 'OMRS AI Triage')}
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-slate-800 text-slate-300">
                                {res.source}
                              </span>
                            )}
                          </div>
                          {res.predictedDefect && (
                            <div className="text-xs font-medium text-slate-300 mt-1">
                              {res.predictedDefect}
                            </div>
                          )}
                        </td>

                        {/* Confidence Score */}
                        <td className="py-3.5 px-4 text-center">
                          {res.confidenceScore !== null && res.confidenceScore !== undefined ? (
                            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-950 border border-slate-800 text-xs font-mono font-bold text-emerald-400">
                              <span>{(res.confidenceScore * 100).toFixed(0)}%</span>
                            </div>
                          ) : (
                            <span className="text-slate-600 font-mono">—</span>
                          )}
                        </td>

                        {/* Status */}
                        <td className="py-3.5 px-4 text-center whitespace-nowrap">
                          {isIssued ? (
                            <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-800 text-slate-400 border border-slate-700 flex items-center justify-center gap-1 mx-auto max-w-fit">
                              <CheckCircleIcon size={12} className="text-emerald-400" />
                              {t('inventory.issuedBadge', 'Issued to Floor')}
                            </span>
                          ) : (
                            <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-purple-950 text-purple-300 border border-purple-800 animate-pulse flex items-center justify-center gap-1 mx-auto max-w-fit">
                              <span className="w-1.5 h-1.5 rounded-full bg-purple-400"></span>
                              {res.status}
                            </span>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="py-3.5 px-4 text-right whitespace-nowrap">
                          {!isIssued ? (
                            <button
                              onClick={() => handleIssueSubmit(res.id)}
                              disabled={actionLoading}
                              className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-slate-950 font-bold text-xs rounded-lg shadow flex items-center gap-1.5 ml-auto transition-all active:scale-95"
                            >
                              <CheckCircleIcon size={14} />
                              <span>{t('inventory.issueBtn', 'Issue to Floor')}</span>
                            </button>
                          ) : (
                            <span className="text-xs text-slate-500 font-medium">
                              {res.allocatedAt ? new Date(res.allocatedAt).toLocaleDateString() : 'Allocated'}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Restock Modal Dialog */}
      {restockModalPart && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden">
            <div className="p-5 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-blue-600/20 text-blue-400 flex items-center justify-center">
                  <PlusCircleIcon size={20} />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base leading-tight">
                    {t('inventory.restockTitle', 'Restock Material Inventory')}
                  </h3>
                  <p className="text-xs text-slate-400 font-mono mt-0.5">{restockModalPart.partCode}</p>
                </div>
              </div>
              <button
                onClick={() => setRestockModalPart(null)}
                className="text-slate-400 hover:text-white text-lg font-bold p-1"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleRestockSubmit} className="p-5 space-y-4">
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Part Description</p>
                <p className="text-sm font-semibold text-white">{restockModalPart.partName}</p>
                <p className="text-xs text-slate-400 mt-1">
                  Current Stock: <span className="font-mono font-bold text-white">{restockModalPart.stockQuantity}</span> | Reorder Threshold: <span className="font-mono font-bold text-amber-400">{restockModalPart.reorderThreshold}</span>
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1">
                  {t('inventory.restockQuantity', 'Restock Quantity')} ({restockModalPart.unitOfMeasure})
                </label>
                <input
                  type="number"
                  min="1"
                  max="10000"
                  required
                  value={restockQuantity}
                  onChange={(e) => setRestockQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white font-mono font-bold text-base focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setRestockModalPart(null)}
                  className="px-4 py-2.5 text-xs font-bold text-slate-400 hover:text-white rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl shadow flex items-center gap-2"
                >
                  {actionLoading && <RefreshCwIcon size={14} className="animate-spin" />}
                  <span>{t('inventory.restockConfirm', 'Confirm Restock')}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
