/**
 * Main Application Root Component (Phase 1, 2 & 3)
 * Indian Railways WRS Raipur Quality Control System
 */

import React, { useState, useEffect } from 'react';
import type { User, NavigationTab } from '../../shared/types.ts';
import { isUserInspector, isUserSupervisorOrAdmin, canAccessTab } from '../../shared/types.ts';
import type { LanguageCode } from './i18n/index.ts';
import { api } from './services/api.ts';
import { Header } from './components/Header.tsx';
import { InspectionPage } from './pages/InspectionPage.tsx';
import { SpringBatchPage } from './pages/SpringBatchPage.tsx';
import { HistoryPage } from './pages/HistoryPage.tsx';
import { AnalyticsPage } from './pages/AnalyticsPage.tsx';
import { LoginPage } from './pages/LoginPage.tsx';
import { AdminExportModal } from './components/AdminExportModal.tsx';
import { WagonsListPage } from './pages/WagonsListPage.tsx';
import { WagonDetailPage } from './pages/WagonDetailPage.tsx';
import { DashboardPage } from './pages/DashboardPage.tsx';
import { StoresInventoryPage } from './pages/StoresInventoryPage.tsx';
import { ComponentPassportsPage } from './pages/ComponentPassportsPage.tsx';
import { InspectorLandingView } from './components/InspectorLandingView.tsx';
import { PassportQRScannerModal } from './components/PassportQRScannerModal.tsx';

export { isUserInspector, isUserSupervisorOrAdmin, canAccessTab };

export const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(() => api.getUser());
  const [currentLang, setCurrentLang] = useState<LanguageCode>(() => {
    if (typeof localStorage !== 'undefined') {
      return (localStorage.getItem('wrs_lang') as LanguageCode) || 'en';
    }
    return 'en';
  });

  const [activeTab, setActiveTab] = useState<NavigationTab>(() => {
    const initialUser = api.getUser();
    if (initialUser && isUserInspector(initialUser.role)) {
      return 'inspector_home';
    }
    return 'wagons';
  });

  const [selectedWagonNumber, setSelectedWagonNumber] = useState<string | null>(null);
  const [isAdminExportOpen, setIsAdminExportOpen] = useState<boolean>(false);
  const [isQRScannerModalOpen, setIsQRScannerModalOpen] = useState<boolean>(false);

  const isInspector = isUserInspector(user?.role);

  // Route Guard: enforce strict role-based tab access
  useEffect(() => {
    if (user && !canAccessTab(user.role, activeTab, !!selectedWagonNumber)) {
      setActiveTab(isInspector ? 'inspector_home' : 'wagons');
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
    if (isUserInspector(loggedInUser.role)) {
      setActiveTab('inspector_home');
    } else {
      setActiveTab('wagons');
    }
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
      setActiveTab(isInspector ? 'inspector_home' : 'wagons');
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
              // Voice inspection happens on a wagon's checklist — if none is
              // active yet, prompt a scan instead of fabricating a wagon number.
              if (selectedWagonNumber) {
                setActiveTab('wagons');
              } else {
                setIsQRScannerModalOpen(true);
              }
            }}
            onOpenSmartVision={() => {
              setActiveTab('smart_vision');
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
        {activeTab === 'inspection' && <InspectionPage lang={currentLang} user={user} />}
        {activeTab === 'history' && !isInspector && <HistoryPage lang={currentLang} />}
        {activeTab === 'analytics' && !isInspector && <AnalyticsPage lang={currentLang} user={user} />}
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
