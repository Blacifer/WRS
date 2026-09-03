/**
 * Main Application Root Component (Phase 1, 2 & 3)
 * Indian Railways WRS Raipur Quality Control System
 */

import React, { useState, useEffect, Suspense, lazy } from 'react';
import type { User, NavigationTab } from '../../shared/types.ts';
import { isUserInspector, isUserSupervisorOrAdmin, canAccessTab } from '../../shared/types.ts';
import type { LanguageCode } from './i18n/index.ts';
import { api } from './services/api.ts';
import { Header } from './components/Header.tsx';
import { InspectionPage } from './pages/InspectionPage.tsx';
import { SpringBatchPage } from './pages/SpringBatchPage.tsx';
import { SpringSortingPage } from './pages/SpringSortingPage.tsx';
import { LoginPage } from './pages/LoginPage.tsx';
import { AdminExportModal } from './components/AdminExportModal.tsx';
import { WagonsListPage } from './pages/WagonsListPage.tsx';
import { WagonDetailPage } from './pages/WagonDetailPage.tsx';
import { InspectorLandingView } from './components/InspectorLandingView.tsx';
import { PassportQRScannerModal } from './components/PassportQRScannerModal.tsx';
import { ManualSearchPage } from './pages/ManualSearchPage.tsx';

/*
 * Screens split out of the first download.
 *
 * The whole app arrived as one 1.26 MB chunk, so an inspector opening the
 * sorting screen on shop wifi was also fetching the charting library for the
 * DRM's dashboard, the OCR engine, and the QR scanner for component passports
 * — none of which their role can even reach. The pilot navigation is narrowed
 * to three jobs; the download was not.
 *
 * Split by who can open the screen rather than by how big it is. Everything an
 * inspector touches — the landing view, sorting, a wagon and its checklist,
 * single inspection, the manual — stays eagerly imported and in the first
 * chunk, because putting a loading state in front of the ~700-a-shift job to
 * save bytes on a screen they never open is a bad trade.
 *
 * These are the divisional and administrative screens. They fetch when opened,
 * which for a DRM on an office connection is unnoticeable, and never for
 * anyone else.
 */
const DashboardPage = lazy(() =>
  import('./pages/DashboardPage.tsx').then((m) => ({ default: m.DashboardPage }))
);
const StoresInventoryPage = lazy(() =>
  import('./pages/StoresInventoryPage.tsx').then((m) => ({ default: m.StoresInventoryPage }))
);
const ComponentPassportsPage = lazy(() =>
  import('./pages/ComponentPassportsPage.tsx').then((m) => ({ default: m.ComponentPassportsPage }))
);
const UserManagementPage = lazy(() =>
  import('./pages/UserManagementPage.tsx').then((m) => ({ default: m.UserManagementPage }))
);
const LearningDashboardPage = lazy(() =>
  import('./pages/LearningDashboardPage.tsx').then((m) => ({ default: m.LearningDashboardPage }))
);
const AuditVerificationPage = lazy(() =>
  import('./pages/AuditVerificationPage.tsx').then((m) => ({ default: m.AuditVerificationPage }))
);
const HistoryPage = lazy(() =>
  import('./pages/HistoryPage.tsx').then((m) => ({ default: m.HistoryPage }))
);
const AnalyticsPage = lazy(() =>
  import('./pages/AnalyticsPage.tsx').then((m) => ({ default: m.AnalyticsPage }))
);

export { isUserInspector, isUserSupervisorOrAdmin, canAccessTab };

/**
 * The screen a role opens on.
 *
 * This decision was written out separately in four places — the initial state,
 * the route guard, the login handler and the forbidden-tab fallback — and they
 * did not agree. Fixing only the first one meant the DRM still landed on the
 * wagons pipeline after signing in, because signing in went through a
 * different branch. One function now, so there is one answer.
 *
 * An inspector starts at their own home screen; a supervisor starts at the
 * pipeline, which is their work; an administrator and the DRM start at the
 * divisional dashboard rather than having to go and find the screen named
 * after them.
 */
export function landingTabFor(role: string | undefined | null): NavigationTab {
  if (isUserInspector(role)) return 'inspector_home';
  const r = String(role || '').trim().toUpperCase();
  if (r === 'DRM' || r === 'ADMIN') return 'dashboard';
  return 'wagons';
}

export const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(() => api.getUser());
  const [currentLang, setCurrentLang] = useState<LanguageCode>(() => {
    if (typeof localStorage !== 'undefined') {
      return (localStorage.getItem('wrs_lang') as LanguageCode) || 'en';
    }
    return 'en';
  });

  /*
   * Where you were, kept across a reload.
   *
   * A refresh dropped you on the home screen, so a supervisor halfway through
   * a forty-item checklist had to find their wagon and their category again —
   * and a refresh is exactly what somebody does when a screen looks stuck.
   * Reported as "when refreshed it took me to the homepage and had to come
   * back to the same page".
   *
   * sessionStorage rather than localStorage: it should survive a reload, not
   * a shift. Coming back tomorrow to yesterday's wagon would be its own kind
   * of wrong. The route guard still runs afterwards, so a restored tab a role
   * may not open is bounced exactly as a freshly chosen one would be.
   */
  const [activeTab, setActiveTab] = useState<NavigationTab>(() => {
    const initialUser = api.getUser();
    try {
      const saved = sessionStorage.getItem('wrs-active-tab');
      if (saved && initialUser && canAccessTab(initialUser.role, saved as NavigationTab, true)) {
        return saved as NavigationTab;
      }
    } catch { /* private windows and blocked storage fall through */ }
    return landingTabFor(initialUser?.role);
  });

  const [selectedWagonNumber, setSelectedWagonNumber] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem('wrs-active-wagon');
    } catch {
      return null;
    }
  });

  // Remember both as they change, so the next reload lands where this one was.
  useEffect(() => {
    try {
      sessionStorage.setItem('wrs-active-tab', activeTab);
      if (selectedWagonNumber) sessionStorage.setItem('wrs-active-wagon', selectedWagonNumber);
      else sessionStorage.removeItem('wrs-active-wagon');
    } catch { /* nothing here is worth an error on the shop floor */ }
  }, [activeTab, selectedWagonNumber]);
  const [isAdminExportOpen, setIsAdminExportOpen] = useState<boolean>(false);
  const [isQRScannerModalOpen, setIsQRScannerModalOpen] = useState<boolean>(false);

  const isInspector = isUserInspector(user?.role);

  // Route Guard: enforce strict role-based tab access
  useEffect(() => {
    if (user && !canAccessTab(user.role, activeTab, !!selectedWagonNumber)) {
      setActiveTab(landingTabFor(user.role));
    }
  }, [user, activeTab, selectedWagonNumber, isInspector]);

  const handleToggleLang = () => {
    const nextLang: LanguageCode = currentLang === 'en' ? 'hi' : 'en';
    setCurrentLang(nextLang);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('wrs_lang', nextLang);
    }
  };

  const handleLoginSuccess = (loggedInUser: User) => {
    setUser(loggedInUser);
    setActiveTab(landingTabFor(loggedInUser.role));
  };

  const handleLogout = () => {
    api.clearSession();
    setUser(null);
  };

  const handleSelectTab = (tab: NavigationTab) => {
    if (tab === 'admin') {
      if (isInspector) {
        // Forbidden for inspector
        setActiveTab('inspector_home');
        return;
      }
      setIsAdminExportOpen(true);
      return;
    }

    if (!canAccessTab(user?.role, tab, false)) {
      setActiveTab(landingTabFor(user?.role));
      return;
    }

    setSelectedWagonNumber(null);
    setActiveTab(tab);
  };

  // If not logged in, show workshop login page
  if (!user) {
    return (
      <LoginPage
        lang={currentLang}
        onToggleLang={handleToggleLang}
        onLoginSuccess={handleLoginSuccess}
      />
    );
  }

  return (
    <div className="min-h-screen bg-transparent text-neutral-100 flex flex-col">
      <Header
        user={user}
        currentLang={currentLang}
        onToggleLang={handleToggleLang}
        onLogout={handleLogout}
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        {/*
          * One boundary around every screen rather than one per lazy page.
          * The eager screens never suspend, so this is only ever seen when a
          * divisional screen is opened for the first time in a session.
          */}
        <Suspense
          fallback={
            <div className="flex items-center justify-center py-24 text-slate-400" role="status">
              <div
                className="h-6 w-6 mr-3 rounded-full border-2 border-slate-600 border-t-sky-400 animate-spin"
                aria-hidden="true"
              />
              {currentLang === 'hi' ? 'स्क्रीन खोली जा रही है…' : 'Opening…'}
            </div>
          }
        >
        {/* 1. INSPECTOR LANDING VIEW */}
        {activeTab === 'inspector_home' && (
          <InspectorLandingView
            user={user}
            currentLang={currentLang}
            onToggleLang={handleToggleLang}
            activeWagonNumber={selectedWagonNumber}
            onSelectWagon={(wNum) => {
              setSelectedWagonNumber(wNum);
            }}
            onOpenVoiceInspection={() => {
              // Requires a wagon; InspectorLandingView opens its own picker
              // first when none is selected.
              setActiveTab('wagons');
            }}
            onOpenSmartVision={() => {
              setActiveTab('smart_vision');
            }}
            onOpenSpringSorting={() => {
              setActiveTab('spring_sorting');
            }}
            onOpenSpringQC={() => {
              setActiveTab('inspection');
            }}
            onOpenQRScanner={() => {
              setIsQRScannerModalOpen(true);
            }}
            onContinueChecklist={(wNum) => {
              setSelectedWagonNumber(wNum);
              setActiveTab('wagons');
            }}
            onLogout={handleLogout}
          />
        )}

        {/* 2. WAGONS LIST PIPELINE (Restricted from Inspector) */}
        {activeTab === 'wagons' && !selectedWagonNumber && (
          isInspector ? (
            <InspectorLandingView
              user={user}
              currentLang={currentLang}
              onToggleLang={handleToggleLang}
              activeWagonNumber={selectedWagonNumber}
              onSelectWagon={(wNum) => setSelectedWagonNumber(wNum)}
              onOpenVoiceInspection={() => setActiveTab('wagons')}
              onOpenSmartVision={() => setActiveTab('smart_vision')}
              onOpenSpringSorting={() => setActiveTab('spring_sorting')}
              onOpenSpringQC={() => setActiveTab('inspection')}
              onOpenQRScanner={() => setIsQRScannerModalOpen(true)}
              onContinueChecklist={(wNum) => {
                setSelectedWagonNumber(wNum);
                setActiveTab('wagons');
              }}
              onLogout={handleLogout}
            />
          ) : (
            <WagonsListPage onSelectWagon={(wNum) => setSelectedWagonNumber(wNum)} />
          )
        )}

        {/* 3. WAGON DETAIL & 7-STAGE CHECKLIST */}
        {activeTab === 'wagons' && selectedWagonNumber && (
          <WagonDetailPage
            wagonNumber={selectedWagonNumber}
            onBack={() => {
              setSelectedWagonNumber(null);
              if (isInspector) {
                setActiveTab('inspector_home');
              }
            }}
          />
        )}

        {/* 4. SMART VISION AR CAM */}
        {activeTab === 'smart_vision' && (
          <div className="max-w-4xl mx-auto space-y-4">
            <div className="flex items-center justify-between">
              <button
                onClick={() => setActiveTab(isInspector ? 'inspector_home' : 'wagons')}
                className="min-h-[44px] px-4 py-2 bg-slate-800 hover:bg-slate-700 active:bg-slate-900 text-slate-200 rounded-xl text-sm font-bold flex items-center gap-2 border border-slate-700 transition-all"
              >
                <span>←</span>
                <span>{currentLang === 'hi' ? 'मुख्य पृष्ठ पर लौटें' : 'Back to Home'}</span>
              </button>
            </div>
            <SpringBatchPage
              lang={currentLang}
              user={user}
              onClose={() => setActiveTab(isInspector ? 'inspector_home' : 'wagons')}
            />
          </div>
        )}

        {/* 4b. SPRING SORTING — loose springs, no wagon */}
        {activeTab === 'spring_sorting' && (
          <div className="max-w-4xl mx-auto space-y-4">
            <div className="flex items-center justify-between">
              <button
                onClick={() => setActiveTab(isInspector ? 'inspector_home' : 'wagons')}
                className="min-h-[44px] px-4 py-2 bg-slate-800 hover:bg-slate-700 active:bg-slate-900 text-slate-200 rounded-xl text-sm font-bold flex items-center gap-2 border border-slate-700 transition-all"
              >
                <span>←</span>
                <span>{currentLang === 'hi' ? 'मुख्य पृष्ठ पर लौटें' : 'Back to Home'}</span>
              </button>
            </div>
            <SpringSortingPage
              lang={currentLang}
              onClose={() => setActiveTab(isInspector ? 'inspector_home' : 'wagons')}
            />
          </div>
        )}

        {/* 5. ADMINISTRATIVE & SUPERVISORY TABS (Protected with Route Guards) */}
        {activeTab === 'dashboard' && !isInspector && <DashboardPage />}
        {activeTab === 'inventory' && !isInspector && <StoresInventoryPage />}
        {activeTab === 'passports' && !isInspector && (
          <ComponentPassportsPage
            onNavigateToWagon={(wNum) => {
              setSelectedWagonNumber(wNum);
              setActiveTab('wagons');
            }}
          />
        )}
        {activeTab === 'learning' && !isInspector && <LearningDashboardPage lang={currentLang} user={user} />}
        {activeTab === 'manual' && <ManualSearchPage lang={currentLang} />}
        {activeTab === 'audit' && !isInspector && <AuditVerificationPage lang={currentLang} />}
        {activeTab === 'inspection' && <InspectionPage lang={currentLang} user={user} />}
        {activeTab === 'history' && !isInspector && <HistoryPage lang={currentLang} />}
        {activeTab === 'analytics' && !isInspector && <AnalyticsPage lang={currentLang} user={user} />}
        {activeTab === 'users' && user.role?.toUpperCase() === 'ADMIN' && <UserManagementPage lang={currentLang} />}
        </Suspense>
      </main>

      {/* Admin Export Dialog (Guarded from Inspector) */}
      {!isInspector && (
        <AdminExportModal
          isOpen={isAdminExportOpen}
          onClose={() => setIsAdminExportOpen(false)}
          lang={currentLang}
        />
      )}

      {/* Global QR Scanner Modal */}
      <PassportQRScannerModal
        isOpen={isQRScannerModalOpen}
        onClose={() => setIsQRScannerModalOpen(false)}
        onComponentScanned={(comp) => {
          setIsQRScannerModalOpen(false);
          if (comp.currentWagonNumber) {
            setSelectedWagonNumber(comp.currentWagonNumber);
            setActiveTab('wagons');
          }
        }}
        title={currentLang === 'hi' ? 'वैगन / पासपोर्ट क्यूआर कोड स्कैन करें' : 'Scan Wagon / Component Passport QR'}
      />
    </div>
  );
};

export default App;
