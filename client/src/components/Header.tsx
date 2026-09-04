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
import {
  GlobeIcon, RefreshCwIcon, LogOutIcon, ShieldIcon,
  HomeIcon, TrainIcon, CoilIcon, CaliperIcon, BookIcon, LinkIcon, UserIcon, IdCardIcon,
  CpuIcon, BarChartIcon, PackageIcon, HistoryIcon, ActivityIcon, SparklesIcon
} from './Icons.tsx';
import { TotpEnrolment } from './TotpEnrolment.tsx';
import { isInPilotNav } from '../config/pilotScope.ts';
import { canAccessTab } from '../../../shared/types.ts';
import { can } from '../../../shared/auth/permissions.ts';
import { Button, Chip, IconButton } from './ui/index.tsx';

export type { NavigationTab };

interface HeaderProps {
  user: User | null;
  currentLang: LanguageCode;
  onToggleLang: () => void;
  onLogout: () => void;
  activeTab: NavigationTab;
  onSelectTab: (tab: NavigationTab) => void;
}

/** One entry in the navigation row. */
interface NavItem {
  tab: NavigationTab;
  testId: string;
  label: string;
  icon: React.ReactNode;
  /** Drawn before this item, to separate the job from the machinery. */
  dividerBefore?: boolean;
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
  const isHi = currentLang === 'hi';
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

  /*
   * The bar as data rather than as twelve near-identical buttons.
   *
   * Every entry used to be written out by hand with its own copy of the
   * active/inactive class string, and they had drifted: the inspector's items
   * were 44px tall with one set of colours, the supervisor's 40px with
   * another, and one of them had lost its icon entirely. Building from a list
   * means an item cannot be styled differently from its neighbours by
   * accident, and adding a screen is one line.
   */
  const inspectorNav: NavItem[] = [
    { tab: 'inspector_home', testId: 'nav-inspector-home', label: isHi ? 'होम / कार्य' : 'Tasks / Home', icon: <HomeIcon size={18} /> },
    { tab: 'spring_sorting', testId: 'nav-spring-sorting', label: isHi ? 'छँटाई' : 'Sorting', icon: <CoilIcon size={18} /> },
    { tab: 'inspection', testId: 'nav-inspection', label: dict.nav.inspection, icon: <CaliperIcon size={18} /> },
    { tab: 'smart_vision', testId: 'nav-smart-vision', label: isHi ? 'स्प्रिंग बैच' : 'Spring Batch', icon: <CpuIcon size={18} /> },
    { tab: 'manual', testId: 'nav-manual', label: isHi ? 'मैनुअल' : 'Manual', icon: <BookIcon size={18} /> }
  ];

  /*
   * The two things the DRM actually asked for come first: the wagon pipeline
   * and the spring flows. What follows the divider is the surrounding
   * workshop machinery — useful, but it was leading the navigation and making
   * the app read as inventory software rather than as a QC tool.
   */
  const staffNav: NavItem[] = [
    { tab: 'wagons', testId: 'nav-wagons', label: dict.nav.wagons || 'Wagons Pipeline', icon: <TrainIcon size={18} /> },
    { tab: 'inspection', testId: 'nav-inspection', label: dict.nav.inspection, icon: <CaliperIcon size={18} /> },
    { tab: 'smart_vision', testId: 'nav-smart-vision', label: isHi ? 'स्प्रिंग बैच' : 'Spring Batch', icon: <CpuIcon size={18} /> },
    { tab: 'dashboard', testId: 'nav-dashboard', label: dict.nav.dashboard || 'DRM Dashboard', icon: <BarChartIcon size={18} />, dividerBefore: true },
    { tab: 'inventory', testId: 'nav-inventory', label: dict.nav.inventory || 'Stores & Inventory', icon: <PackageIcon size={18} /> },
    { tab: 'passports', testId: 'nav-passports', label: dict.nav.passports || 'Component Passports', icon: <IdCardIcon size={18} /> },
    { tab: 'history', testId: 'nav-history', label: dict.nav.history, icon: <HistoryIcon size={18} /> },
    { tab: 'analytics', testId: 'nav-analytics', label: dict.nav.analytics, icon: <ActivityIcon size={18} /> },
    { tab: 'manual', testId: 'nav-manual-sup', label: dict.nav.manual || 'Ask the Manual', icon: <BookIcon size={18} /> },
    { tab: 'learning', testId: 'nav-learning', label: dict.nav.learning || 'System Learning', icon: <SparklesIcon size={18} /> },
    { tab: 'audit', testId: 'nav-audit', label: dict.nav.audit || 'Audit Chain', icon: <LinkIcon size={18} /> },
    { tab: 'users', testId: 'nav-users', label: dict.nav.users || 'User Accounts', icon: <UserIcon size={18} /> }
  ];

  /*
   * `wagons`, `inspection` and `smart_vision` lead the bar and are gated by
   * canAccessTab alone. Everything after the divider is also subject to the
   * pilot's narrowed scope, exactly as before.
   */
  const alwaysOffered: NavigationTab[] = ['wagons', 'inspection', 'smart_vision'];
  const visibleStaffNav = staffNav.filter((item) => {
    if (!shows(item.tab)) return false;
    if (alwaysOffered.includes(item.tab)) return true;
    if (item.tab === 'audit') return true;
    if (item.tab === 'manual') return true;
    return isInPilotNav(item.tab as any, user?.role);
  });

  const navItems = isInspector ? inspectorNav.filter((i) => shows(i.tab)) : visibleStaffNav;

  const navButton = (item: NavItem) => {
    const active = activeTab === item.tab;
    return (
      <React.Fragment key={item.testId + item.tab}>
        {item.dividerBefore ? (
          <span aria-hidden="true" className="hidden sm:inline-block w-px h-6 bg-line-strong mx-1 self-center" />
        ) : null}
        <button
          data-testid={item.testId}
          onClick={() => onSelectTab(item.tab)}
          aria-current={active ? 'page' : undefined}
          className={[
            'min-h-tap px-3 rounded-control inline-flex items-center gap-2 whitespace-nowrap',
            'text-[13px] font-bold transition-colors',
            active
              ? 'bg-selected text-ink'
              : 'text-ink-muted hover:text-ink hover:bg-raised'
          ].join(' ')}
        >
          <span className={active ? 'text-accent-ink' : 'text-ink-faint'}>{item.icon}</span>
          <span>{item.label}</span>
        </button>
      </React.Fragment>
    );
  };

  return (
    <header className="sticky top-0 z-40 bg-page/90 backdrop-blur-md border-b border-line text-ink select-none">
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
        <button
          onClick={() => onSelectTab(isInspector ? 'inspector_home' : 'wagons')}
          className="flex items-center gap-3 min-w-0 text-left group"
        >
          <span className="w-9 h-9 rounded-control bg-railway-blue border border-accent-hover flex items-center justify-center font-extrabold text-white text-[13px] shrink-0">
            IR
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <span className="font-bold text-[15px] tracking-[-0.015em] text-ink group-hover:text-accent-ink transition-colors">
                WRS Raipur
              </span>
              <Chip tone="accent" className="hidden sm:inline-flex">RDSO G-95 Rev-II</Chip>
            </span>
            <span className="block text-[11px] text-ink-muted font-medium truncate max-w-[200px] sm:max-w-none">
              {dict.app.workshop}
            </span>
          </span>
        </button>

        {/* Right Controls: Connectivity, Pending Sync, Language Toggle, User & Logout */}
        <div className="flex flex-wrap items-center justify-end gap-2 min-w-0">
          {/* Online/Offline Status */}
          <Chip tone={isOnline ? 'good' : 'warn'} dot className="hidden sm:inline-flex">
            {isOnline ? dict.app.online : dict.app.offline}
          </Chip>

          {/* Pending Sync Button / Badge */}
          {pendingCount > 0 && (
            <Button
              size="md"
              onClick={handleManualSync}
              disabled={isSyncing}
              title={dict.app.syncNow}
              className="!bg-warn !border-warn !text-page hover:!bg-warn-ink"
            >
              <RefreshCwIcon size={16} className={isSyncing ? 'animate-spin' : ''} />
              {/* The count is the part that matters and is always shown; the
                  word for it is dropped on the narrowest screens rather than
                  pushing the row off the edge. */}
              <span className="hidden sm:inline">
                {isSyncing ? dict.app.syncing : `${pendingCount} ${dict.app.syncQueue}`}
              </span>
              <span className="sm:hidden tabular">{isSyncing ? '…' : pendingCount}</span>
            </Button>
          )}

          {/* Language Toggle */}
          <Button size="md" onClick={onToggleLang} aria-label="Toggle language between English and Hindi">
            <GlobeIcon size={18} className="text-accent-ink" />
            <span>{isHi ? 'EN' : 'हिंदी'}</span>
          </Button>

          {/* User Profile & Role Badge */}
          {user && (
            <div className="hidden md:flex items-center gap-2 pl-2 border-l border-line">
              <div className="text-right">
                <p className="text-xs font-bold text-ink-body leading-tight">{user.name}</p>
                <span className="text-[10px] font-semibold text-accent-ink uppercase tracking-[0.07em]">
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
              <IconButton
                variant="quiet"
                onClick={() => setIsTotpOpen(true)}
                label={enrolled ? 'Authenticator app — enrolled' : 'Set up an authenticator app'}
                data-testid="header-totp"
                className={enrolled ? '!text-good-ink' : ''}
              >
                <ShieldIcon size={18} />
              </IconButton>
              <IconButton
                variant="quiet"
                onClick={onLogout}
                label={dict.nav.logout}
                className="hover:!text-bad-ink"
              >
                <LogOutIcon size={18} />
              </IconButton>
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

      {/* Navigation Tabs Bar */}
      {/* Wraps rather than scrolling horizontally. This row used to be a
          centred overflow-x-auto with the scrollbar hidden, which meant that
          once the items no longer fitted, the ends spilled off BOTH sides with
          nothing on screen suggesting it could scroll — and centred overflow is
          not reliably scrollable back to the left in any case. Adding one more
          nav item was enough to push "Wagons Pipeline" off the left edge at
          1400px, and a shop tablet is narrower than that. Hidden horizontal
          scroll is also the wrong affordance for a gloved hand. */}
      <nav className="px-3 sm:px-6 border-t border-line">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center gap-1 py-1.5">
          {navItems.map(navButton)}

          {/* The export dialog is an action, not a screen, so it sits apart. */}
          {!isInspector && can(user?.role, 'certificate.export') && isInPilotNav('admin', user?.role) && (
            <button
              data-testid="nav-admin"
              onClick={() => onSelectTab('admin')}
              className="min-h-tap px-3 rounded-control inline-flex items-center gap-2 whitespace-nowrap text-[13px] font-bold text-ink-muted hover:text-ink hover:bg-raised transition-colors"
            >
              <ShieldIcon size={18} className="text-warn-ink" />
              <span>{dict.nav.admin}</span>
            </button>
          )}

          {user && (
            <button
              onClick={onLogout}
              className="md:hidden min-h-tap px-3 rounded-control inline-flex items-center gap-2 text-[13px] font-bold text-bad-ink hover:bg-bad-soft ml-auto"
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
          className="bg-warn-soft border-t border-warn-line px-4 py-3"
        >
          <div className="max-w-7xl mx-auto space-y-2">
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs font-extrabold text-warn-ink uppercase tracking-[0.07em]">
                {isHi
                  ? `${conflicts.length} ऑफ़लाइन प्रविष्टि लागू नहीं हुई`
                  : `${conflicts.length} offline ${conflicts.length === 1 ? 'entry was' : 'entries were'} not applied`}
              </p>
              <Button size="sm" variant="secondary" onClick={() => setConflicts([])} className="shrink-0">
                {isHi ? 'समझ गया' : 'Got it'}
              </Button>
            </div>
            <ul className="space-y-1.5">
              {conflicts.map((c, i) => (
                <li key={c.clientTempId || i} className="text-xs text-warn-ink/90 leading-snug">
                  {c.wagonNumber && <b className="text-warn-ink">{c.wagonNumber}</b>}{' '}
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
