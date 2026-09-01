/**
 * Responsive Mobile-First Header Component
 * Indian Railways WRS Raipur
 */

import React, { useState, useEffect } from 'react';
import type { User, NavigationTab } from '../../../shared/types.ts';
import type { SyncConflict } from '../services/offlineDb.ts';
import { getDictionary } from '../i18n/index.ts';
import type { LanguageCode } from '../i18n/index.ts';
import { offlineDb } from '../services/offlineDb.ts';
import { api } from '../services/api.ts';
import { GlobeIcon, RefreshCwIcon, LogOutIcon, ShieldIcon } from './Icons.tsx';
import { TotpEnrolment } from './TotpEnrolment.tsx';
import { isInPilotNav } from '../config/pilotScope.ts';
import { canAccessTab } from '../../../shared/types.ts';
import { can } from '../../../shared/auth/permissions.ts';

export type { NavigationTab };

interface HeaderProps {
  user: User | null;
  currentLang: LanguageCode;
  onToggleLang: () => void;
  onLogout: () => void;
  activeTab: NavigationTab;
  onSelectTab: (tab: NavigationTab) => void;
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
  /*
   * Offline judgements the server refused, held until the inspector dismisses
   * them.
   *
   * The server has always built these, with a plain-language reason for each,
   * "so the device can tell the inspector which of their offline judgements
   * were not applied". Nothing on the device ever read them. The most
   * important case is a queued PASS refused over another inspector's
   * CONDEMNED — exactly the finding that must not disappear quietly — and it
   * disappeared quietly.
   */
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);

  /* Whether this person already has an authenticator, for the header marker. */
  const [isTotpOpen, setIsTotpOpen] = useState(false);
  const [enrolled, setEnrolled] = useState(false);

  useEffect(() => {
    if (!user) return;
    let live = true;
    api.getTotpStatus()
      .then(r => { if (live) setEnrolled(Boolean(r.data?.enrolled)); })
      .catch(() => { /* the marker is a convenience; its absence is not an error */ });
    return () => { live = false; };
  }, [user, isTotpOpen]);

  /*
   * Draining belongs here, because the header is the one thing always on screen.
   *
   * The sorting queue used to drain only from inside the sorting page's own
   * effect. That is fine while somebody is standing on that screen, and wrong
   * everywhere else: sort a dozen springs with the network down, let the
   * tablet sleep or the tab reload, come back into signal on the home screen,
   * and nothing ever tried to send them. The queue survived perfectly and was
   * simply never drained — the count sat at twelve through a reconnect, and
   * nothing said so.
   *
   * Both queues, on mount, when the network returns, and on a slow poll —
   * because navigator.onLine flips the moment the wifi associates, which in a
   * shed is well before anything is actually reachable. Sending is idempotent
   * (the server dedupes on the device's own sync id), so the sorting page
   * draining at the same time cannot double-count a spring.
   */
  useEffect(() => {
    let cancelled = false;

    const drainAll = async () => {
      if (cancelled || !offlineDb.isOnline()) return;
      const token = localStorage.getItem('wrs_token') || undefined;
      if (!token) return;
      try {
        await offlineDb.syncPendingBatch('/api', token);
        await offlineDb.syncPendingSorting('/api', token);
      } catch {
        // A failed drain is not an error to show anybody; the next tick tries
        // again and the work stays queued in the meantime.
      }
    };

    const handleOnline = () => { setIsOnline(true); drainAll(); };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    const drainTimer = window.setInterval(drainAll, 15000);
    drainAll();

    const unsubscribe = offlineDb.onPendingCountChange(setPendingCount);
    // Refusals arrive from whichever sync found them — including the
    // automatic one that runs when the network returns, which is the one that
    // actually happens in a shed.
    const unsubscribeConflicts = offlineDb.onSyncConflicts((incoming) =>
      setConflicts((prev) => [...prev, ...incoming])
    );

    return () => {
      cancelled = true;
      window.clearInterval(drainTimer);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      unsubscribe();
      unsubscribeConflicts();
    };
  }, []);

  const handleManualSync = async () => {
    if (isSyncing || pendingCount === 0) return;
    setIsSyncing(true);
    try {
      const token = localStorage.getItem('wrs_token') || undefined;
      // Both queues, so the button means what it says. It used to send the
      // inspections queue only, and leave sorted springs sitting there.
      await offlineDb.syncPendingBatch('/api', token);
      await offlineDb.syncPendingSorting('/api', token);
      // Conflicts arrive through the subscription above, so a manual sync and
      // an automatic one behave identically.
    } finally {
      setIsSyncing(false);
    }
  };

  const roleUpper = user?.role?.toUpperCase();
  const isInspector = roleUpper === 'INSPECTOR';

  /*
   * Nav visibility is asked as a capability, not as a list of role names.
   *
   * The list of names was the bug: a DRM matched none of these branches and
   * fell through to a screen with almost nothing on it, because every entry
   * was gated on being a supervisor or an admin. Adding an oversight role
   * should not mean auditing every conditional in a nav bar.
   *
   * `shows` also defers to canAccessTab, so what the bar offers and what the
   * app will actually open cannot drift apart — a nav item leading to a screen
   * that bounces you is worse than no nav item.
   */
  const shows = (tab: NavigationTab) => canAccessTab(user?.role, tab, false);

  return (
    <header className="sticky top-0 z-40 bg-[#0a0a0a]/80 backdrop-blur-md border-b border-white/10 text-white select-none">
      {/* Top Branding Bar */}
      {/*
        Wraps rather than overflowing, for the same reason the nav row below
        does. The right-hand cluster only overflows once there is something to
        sync, so it stayed hidden until the sorting queue started contributing
        to the pending count — and sorting is the workflow most likely to be
        offline, on the narrowest device, with the most in the queue.
      */}
      <div className="max-w-7xl mx-auto px-3 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-2">
        {/* Left: Indian Railways Branding */}
        <div 
          onClick={() => onSelectTab(isInspector ? 'inspector_home' : 'wagons')}
          className="flex items-center gap-3 cursor-pointer group min-w-0"
        >
          <div className="w-10 h-10 rounded-lg bg-blue-700 border border-blue-500 flex items-center justify-center font-black text-white text-lg shadow-inner group-hover:scale-105 transition-transform">
            IR
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-sm sm:text-base tracking-tight text-white group-hover:text-blue-300 transition-colors">
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
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3 min-w-0">
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
              {/* The count is the part that matters and is always shown; the
                  word for it is dropped on the narrowest screens rather than
                  pushing the row off the edge. */}
              <span className="hidden sm:inline">
                {isSyncing ? dict.app.syncing : `${pendingCount} ${dict.app.syncQueue}`}
              </span>
              <span className="sm:hidden tabular-nums">
                {isSyncing ? '…' : pendingCount}
              </span>
            </button>
          )}

          {/* Language Toggle Button (Touch Target >= 48px) */}
          <button
            onClick={onToggleLang}
            className="min-w-[48px] min-h-[48px] px-3 py-2 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-200 hover:text-white border border-slate-700 rounded-lg flex items-center justify-center gap-1.5 font-bold text-sm transition-all shadow-sm"
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
              {/*
                * The authenticator, reachable by the people who need it.
                *
                * Enrolment was built, tested and working, and rendered in
                * exactly one place: the User Accounts screen, which only an
                * administrator can open. Since it enrols whoever is signed
                * in, that meant an administrator could set up their own
                * authenticator and nobody else could set up anything — least
                * of all a supervisor, who is the one signing wagons onto the
                * line and the whole reason a second factor matters here.
                */}
              <button
                onClick={() => setIsTotpOpen(true)}
                title={enrolled
                  ? 'Authenticator app — enrolled'
                  : 'Set up an authenticator app'}
                data-testid="header-totp"
                className={`min-w-[44px] min-h-[44px] p-2 rounded-lg transition-colors flex items-center justify-center ${
                  enrolled
                    ? 'text-emerald-400 hover:bg-emerald-950/40'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                <ShieldIcon size={18} />
              </button>
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

      {isTotpOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center p-4 overflow-y-auto"
          onClick={() => setIsTotpOpen(false)}
        >
          <div className="mt-16 w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <TotpEnrolment lang={currentLang} onClose={() => setIsTotpOpen(false)} />
          </div>
        </div>
      )}

      {/* Navigation Tabs Bar (Touch Targets >= 48px) */}
      <nav className="bg-transparent px-4">
        {/* Wraps rather than scrolling horizontally. This row used to be a
            centred overflow-x-auto with the scrollbar hidden, which meant that
            once the items no longer fitted, the ends spilled off BOTH sides with
            nothing on screen suggesting it could scroll — and centred overflow is
            not reliably scrollable back to the left in any case. Adding one more
            nav item was enough to push "Wagons Pipeline" off the left edge at
            1400px, and a shop tablet is narrower than that. Hidden horizontal
            scroll is also the wrong affordance for a gloved hand. */}
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-start sm:justify-center gap-x-3 sm:gap-x-6 gap-y-1 py-2">
          {/* 1. INSPECTOR ROLE: Ultra-Simple Shop-Floor Essentials ONLY */}
          {isInspector ? (
            <>
              <button
                data-testid="nav-inspector-home"
                onClick={() => onSelectTab('inspector_home')}
                className={`min-h-[44px] px-4 py-2 text-sm font-extrabold rounded-xl flex items-center gap-2 whitespace-nowrap transition-all ${
                  activeTab === 'inspector_home'
                    ? 'bg-blue-600/40 text-blue-300 border border-blue-500/60 shadow-md'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                }`}
              >
                <span>🏠</span>
                <span>{currentLang === 'hi' ? 'होम / कार्य' : 'Tasks / Home'}</span>
              </button>

              <button
                data-testid="nav-manual"
                onClick={() => onSelectTab('manual')}
                className={`min-h-[44px] px-4 py-2 text-sm font-extrabold rounded-xl flex items-center gap-2 whitespace-nowrap transition-all ${
                  activeTab === 'manual'
                    ? 'bg-teal-600/40 text-teal-300 border border-teal-500/60 shadow-md'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                }`}
              >
                <span>📖</span>
                <span>{currentLang === 'hi' ? 'मैनुअल' : 'Manual'}</span>
              </button>

              <button
                data-testid="nav-inspection"
                onClick={() => onSelectTab('inspection')}
                className={`min-h-[44px] px-4 py-2 text-sm font-extrabold rounded-xl flex items-center gap-2 whitespace-nowrap transition-all ${
                  activeTab === 'inspection'
                    ? 'bg-purple-600/40 text-purple-300 border border-purple-500/60 shadow-md'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                }`}
              >
                <span>🌀</span>
                <span>{dict.nav.inspection}</span>
              </button>

              <button
                data-testid="nav-smart-vision"
                onClick={() => onSelectTab('smart_vision')}
                className={`min-h-[44px] px-4 py-2 text-sm font-extrabold rounded-xl flex items-center gap-2 whitespace-nowrap transition-all ${
                  activeTab === 'smart_vision'
                    ? 'bg-emerald-600/40 text-emerald-300 border border-emerald-500/60 shadow-md'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                }`}
              >
                <span>🔬</span>
                <span>{currentLang === 'hi' ? 'स्प्रिंग बैच' : 'Spring Batch'}</span>
              </button>
            </>
          ) : (
            /* 2. SUPERVISOR / ADMIN ROLES: Full Pipeline, Inventory, Analytics & Admin */
            <>
              <button
                data-testid="nav-wagons"
                onClick={() => onSelectTab('wagons')}
                className={`min-h-[40px] px-2 py-1 text-sm font-medium rounded-md flex items-center gap-2 whitespace-nowrap transition-colors ${
                  activeTab === 'wagons'
                    ? 'text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                🚂 {dict.nav.wagons || 'Wagons Pipeline'}
              </button>


              {/* Recording a spring is shop-floor work. An administrator and
                  the DRM hold no spring.record capability, so the entries that
                  lead there are not offered to them — they were, and they led
                  to a screen the app would have bounced them off. */}
              {shows('inspection') && (
              <button
                data-testid="nav-inspection"
                onClick={() => onSelectTab('inspection')}
                className={`min-h-[40px] px-2 py-1 text-sm font-medium rounded-md flex items-center gap-2 whitespace-nowrap transition-colors ${
                  activeTab === 'inspection'
                    ? 'text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                🌀 {dict.nav.inspection}
              </button>
              )}

              {shows('smart_vision') && (
              <button
                data-testid="nav-smart-vision"
                onClick={() => onSelectTab('smart_vision')}
                className={`min-h-[40px] px-2 py-1 text-sm font-medium rounded-md flex items-center gap-2 whitespace-nowrap transition-colors ${
                  activeTab === 'smart_vision'
                    ? 'text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                🔬 {currentLang === 'hi' ? 'स्प्रिंग बैच' : 'Spring Batch'}
              </button>
              )}

              {/* The two things the DRM actually asked for come first: the
                  wagon pipeline and the spring flows. What follows the rule is
                  the surrounding workshop machinery — useful, but it was
                  leading the navigation and making the app read as inventory
                  software rather than as a QC tool. */}
              <span aria-hidden="true" className="hidden sm:inline-block w-px h-5 bg-slate-700 mx-1 self-center"></span>

              {shows('dashboard') && isInPilotNav('dashboard', user?.role) && (
                <button
                  data-testid="nav-dashboard"
                  onClick={() => onSelectTab('dashboard')}
                  className={`min-h-[40px] px-2 py-1 text-sm font-medium rounded-md flex items-center gap-2 whitespace-nowrap transition-colors ${
                    activeTab === 'dashboard'
                      ? 'text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  📊 {dict.nav.dashboard || 'DRM Dashboard'}
                </button>
              )}
                  {shows('inventory') && isInPilotNav('inventory', user?.role) && (
                  <button
                    data-testid="nav-inventory"
                    onClick={() => onSelectTab('inventory')}
                    className={`min-h-[40px] px-2 py-1 text-sm font-medium rounded-md flex items-center gap-2 whitespace-nowrap transition-colors ${
                      activeTab === 'inventory'
                        ? 'text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    📦 {dict.nav.inventory || 'Stores & Inventory'}
                  </button>
                  )}
                  {shows('passports') && isInPilotNav('passports', user?.role) && (
                  <button
                    data-testid="nav-passports"
                    onClick={() => onSelectTab('passports')}
                    className={`min-h-[40px] px-2 py-1 text-sm font-medium rounded-md flex items-center gap-2 whitespace-nowrap transition-colors ${
                      activeTab === 'passports'
                        ? 'text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    🪪 {dict.nav.passports || 'Component Passports'}
                  </button>
                  )}

              {shows('history') && isInPilotNav('history', user?.role) && (
                <button
                  data-testid="nav-history"
                  onClick={() => onSelectTab('history')}
                  className={`min-h-[40px] px-2 py-1 text-sm font-medium rounded-md flex items-center gap-2 whitespace-nowrap transition-colors ${
                    activeTab === 'history'
                      ? 'text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {dict.nav.history}
                </button>
              )}

              {shows('analytics') && isInPilotNav('analytics', user?.role) && (
                <button
                  data-testid="nav-analytics"
                  onClick={() => onSelectTab('analytics')}
                  className={`min-h-[40px] px-2 py-1 text-sm font-medium rounded-md flex items-center gap-2 whitespace-nowrap transition-colors ${
                    activeTab === 'analytics'
                      ? 'text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {dict.nav.analytics}
                </button>
              )}

              {can(user?.role, 'certificate.export') && isInPilotNav('admin', user?.role) && (
                <button
                  data-testid="nav-admin"
                  onClick={() => onSelectTab('admin')}
                  className={`min-h-[40px] px-2 py-1 text-sm font-medium rounded-md flex items-center gap-2 whitespace-nowrap transition-colors ${
                    activeTab === 'admin'
                      ? 'text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <ShieldIcon size={16} className="text-amber-400" />
                  {dict.nav.admin}
                </button>
              )}

              <button
                data-testid="nav-manual-sup"
                onClick={() => onSelectTab('manual')}
                className={`min-h-[40px] px-2 py-1 text-sm font-medium rounded-md flex items-center gap-2 whitespace-nowrap transition-colors ${
                  activeTab === 'manual'
                    ? 'text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                📖 {dict.nav.manual || 'Ask the Manual'}
              </button>

              {shows('learning') && isInPilotNav('learning', user?.role) && (
                <button
                  data-testid="nav-learning"
                  onClick={() => onSelectTab('learning')}
                  className={`min-h-[40px] px-2 py-1 text-sm font-medium rounded-md flex items-center gap-2 whitespace-nowrap transition-colors ${
                    activeTab === 'learning'
                      ? 'text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  🧠 {dict.nav.learning || 'System Learning'}
                </button>
              )}

              {shows('audit') && (
                <button
                  data-testid="nav-audit"
                  onClick={() => onSelectTab('audit')}
                  className={`min-h-[40px] px-2 py-1 text-sm font-medium rounded-md flex items-center gap-2 whitespace-nowrap transition-colors ${
                    activeTab === 'audit'
                      ? 'text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  🔗 {dict.nav.audit || 'Audit Chain'}
                </button>
              )}

              {shows('users') && isInPilotNav('users', user?.role) && (
                <button
                  data-testid="nav-users"
                  onClick={() => onSelectTab('users')}
                  className={`min-h-[40px] px-2 py-1 text-sm font-medium rounded-md flex items-center gap-2 whitespace-nowrap transition-colors ${
                    activeTab === 'users'
                      ? 'text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  👤 {dict.nav.users || 'User Accounts'}
                </button>
              )}
            </>
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

      {/*
        Work the server refused, shown until it is acknowledged.

        Deliberately not a toast. A verdict that was recorded on the shop
        floor and then rejected is the one thing in this system an inspector
        must not miss, and something that fades after four seconds is
        something that gets missed. It stays until they dismiss it.
      */}
      {conflicts.length > 0 && (
        <div
          data-testid="sync-conflicts"
          className="bg-amber-950/70 border-t border-amber-800 px-4 py-3"
        >
          <div className="max-w-7xl mx-auto space-y-2">
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs font-extrabold text-amber-200 uppercase tracking-wide">
                {currentLang === 'hi'
                  ? `${conflicts.length} ऑफ़लाइन प्रविष्टि लागू नहीं हुई`
                  : `${conflicts.length} offline ${conflicts.length === 1 ? 'entry was' : 'entries were'} not applied`}
              </p>
              <button
                onClick={() => setConflicts([])}
                className="min-h-[32px] px-2.5 text-[11px] font-bold text-amber-300 hover:text-white border border-amber-800 rounded-md"
              >
                {currentLang === 'hi' ? 'समझ गया' : 'Got it'}
              </button>
            </div>
            <ul className="space-y-1.5">
              {conflicts.map((c, i) => (
                <li key={c.clientTempId || i} className="text-xs text-amber-100/90 leading-snug">
                  {c.wagonNumber && (
                    <b className="text-amber-200">{c.wagonNumber}</b>
                  )}{' '}
                  {c.reason}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </header>
  );
};
