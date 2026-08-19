/**
 * Responsive Mobile-First Header Component
 * Indian Railways WRS Raipur
 */

import React, { useState, useEffect } from 'react';
import type { User } from '../../../shared/types.ts';
import { getDictionary } from '../i18n/index.ts';
import type { LanguageCode } from '../i18n/index.ts';
import { offlineDb } from '../services/offlineDb.ts';
import { GlobeIcon, RefreshCwIcon, LogOutIcon, ShieldIcon } from './Icons.tsx';

interface HeaderProps {
  user: User | null;
  currentLang: LanguageCode;
  onToggleLang: () => void;
  onLogout: () => void;
  activeTab: 'inspection' | 'wagons' | 'dashboard' | 'inventory' | 'passports' | 'history' | 'analytics' | 'admin';
  onSelectTab: (tab: 'inspection' | 'wagons' | 'dashboard' | 'inventory' | 'passports' | 'history' | 'analytics' | 'admin') => void;
}

export const Header: React.FC<HeaderProps> = ({
  user,
  currentLang,
  onToggleLang,
  onLogout,
  activeTab,
  onSelectTab
}) => {
  const dict = getDictionary(currentLang);
  const [isOnline, setIsOnline] = useState<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);

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

  const handleManualSync = async () => {
    if (isSyncing || pendingCount === 0) return;
    setIsSyncing(true);
    try {
      const token = localStorage.getItem('wrs_token') || undefined;
      await offlineDb.syncPendingBatch('/api', token);
    } finally {
      setIsSyncing(false);
    }
  };

  const isSupervisorOrAdmin = user?.role === 'SUPERVISOR' || user?.role === 'ADMIN' || user?.role === 'Supervisor' || user?.role === 'Admin';
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'Admin';

  return (
    <header className="sticky top-0 z-40 bg-slate-900 border-b border-slate-800 text-white shadow-lg select-none">
      {/* Top Branding Bar */}
      <div className="max-w-7xl mx-auto px-3 sm:px-6 py-2.5 flex items-center justify-between gap-2">
        {/* Left: Indian Railways Branding */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-700 border border-blue-500 flex items-center justify-center font-black text-white text-lg shadow-inner">
            IR
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-sm sm:text-base tracking-tight text-white">
                WRS Raipur
              </span>
              <span className="hidden sm:inline-block px-2 py-0.5 text-[11px] font-bold uppercase bg-blue-950 text-blue-300 border border-blue-800 rounded">
                RDSO G-95 Rev-II
              </span>
            </div>
            <p className="text-[11px] sm:text-xs text-slate-400 font-medium truncate max-w-[200px] sm:max-w-none">
              {dict.app.workshop}
            </p>
          </div>
        </div>

        {/* Right Controls: Connectivity, Pending Sync, Language Toggle, User & Logout */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Online/Offline Status */}
          <div className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${
            isOnline ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800' : 'bg-amber-950/60 text-amber-300 border-amber-800'
          }`}>
            <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`}></span>
            <span>{isOnline ? dict.app.online : dict.app.offline}</span>
          </div>

          {/* Pending Sync Button / Badge */}
          {pendingCount > 0 && (
            <button
              onClick={handleManualSync}
              disabled={isSyncing}
              title={dict.app.syncNow}
              className="min-h-[44px] px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-lg flex items-center gap-1.5 shadow transition-all active:scale-95"
            >
              <RefreshCwIcon size={14} className={isSyncing ? 'animate-spin' : ''} />
              <span>{isSyncing ? dict.app.syncing : `${pendingCount} ${dict.app.syncQueue}`}</span>
            </button>
          )}

          {/* Language Toggle Button (Touch Target >= 48px) */}
          <button
            onClick={onToggleLang}
            className="min-w-[48px] min-h-[48px] px-3 py-2 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-200 hover:text-white border border-slate-700 rounded-lg flex items-center justify-center gap-1.5 font-bold text-sm transition-all"
            aria-label="Toggle language between English and Hindi"
          >
            <GlobeIcon size={18} className="text-blue-400" />
            <span>{currentLang === 'en' ? 'हिंदी' : 'EN'}</span>
          </button>

          {/* User Profile & Role Badge */}
          {user && (
            <div className="hidden md:flex items-center gap-2 pl-2 border-l border-slate-800">
              <div className="text-right">
                <p className="text-xs font-bold text-slate-200 leading-tight">{user.name}</p>
                <span className="text-[10px] font-semibold text-blue-400 uppercase tracking-wider">
                  {dict.roles[user.role as keyof typeof dict.roles] || user.role}
                </span>
              </div>
              <button
                onClick={onLogout}
                title={dict.nav.logout}
                className="min-w-[44px] min-h-[44px] p-2 text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 rounded-lg transition-colors flex items-center justify-center"
              >
                <LogOutIcon size={18} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Navigation Tabs Bar (Touch Targets >= 48px) */}
      <nav className="bg-slate-950 px-2 border-t border-slate-800/80">
        <div className="max-w-7xl mx-auto flex items-center justify-start sm:justify-center overflow-x-auto no-scrollbar gap-1 sm:gap-2 py-1">
          <button
            onClick={() => onSelectTab('wagons')}
            className={`min-h-[48px] px-4 py-2 text-sm font-bold rounded-md flex items-center gap-2 whitespace-nowrap transition-colors ${
              activeTab === 'wagons'
                ? 'bg-orange-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            🚂 {dict.nav.wagons || 'Wagons Pipeline'}
          </button>

          {isAdmin && (
            <button
              onClick={() => onSelectTab('dashboard')}
              className={`min-h-[48px] px-4 py-2 text-sm font-bold rounded-md flex items-center gap-2 whitespace-nowrap transition-colors ${
                activeTab === 'dashboard'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              📊 {dict.nav.dashboard || 'DRM Dashboard'}
            </button>
          )}

          {isSupervisorOrAdmin && (
            <>
              <button
                onClick={() => onSelectTab('inventory')}
                className={`min-h-[48px] px-4 py-2 text-sm font-bold rounded-md flex items-center gap-2 whitespace-nowrap transition-colors ${
                  activeTab === 'inventory'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                📦 {dict.nav.inventory || 'Stores & Inventory'}
              </button>

              <button
                onClick={() => onSelectTab('passports')}
                className={`min-h-[48px] px-4 py-2 text-sm font-bold rounded-md flex items-center gap-2 whitespace-nowrap transition-colors ${
                  activeTab === 'passports'
                    ? 'bg-cyan-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                🪪 {dict.nav.passports || 'Component Passports'}
              </button>
            </>
          )}

          <button
            onClick={() => onSelectTab('inspection')}
            className={`min-h-[48px] px-4 py-2 text-sm font-bold rounded-md flex items-center gap-2 whitespace-nowrap transition-colors ${
              activeTab === 'inspection'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            🌀 {dict.nav.inspection}
          </button>

          {isSupervisorOrAdmin && (
            <button
              onClick={() => onSelectTab('history')}
              className={`min-h-[48px] px-4 py-2 text-sm font-bold rounded-md flex items-center gap-2 whitespace-nowrap transition-colors ${
                activeTab === 'history'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              {dict.nav.history}
            </button>
          )}

          {isAdmin && (
            <button
              onClick={() => onSelectTab('analytics')}
              className={`min-h-[48px] px-4 py-2 text-sm font-bold rounded-md flex items-center gap-2 whitespace-nowrap transition-colors ${
                activeTab === 'analytics'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              {dict.nav.analytics}
            </button>
          )}

          {isSupervisorOrAdmin && (
            <button
              onClick={() => onSelectTab('admin')}
              className={`min-h-[48px] px-4 py-2 text-sm font-bold rounded-md flex items-center gap-2 whitespace-nowrap transition-colors ${
                activeTab === 'admin'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <ShieldIcon size={16} className="text-amber-400" />
              {dict.nav.admin}
            </button>
          )}

          {user && (
            <button
              onClick={onLogout}
              className="md:hidden min-h-[48px] px-3 py-2 text-sm font-bold text-rose-400 hover:bg-rose-950/30 rounded-md flex items-center gap-1.5 ml-auto"
            >
              <LogOutIcon size={16} />
              <span>{dict.nav.logout}</span>
            </button>
          )}
        </div>
      </nav>
    </header>
  );
};
