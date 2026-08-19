/**
 * Main Application Root Component (Phase 1 & Phase 2)
 * Indian Railways WRS Raipur Quality Control System
 */

import React, { useState } from 'react';
import type { User } from '../../shared/types.ts';
import type { LanguageCode } from './i18n/index.ts';
import { api } from './services/api.ts';
import { Header } from './components/Header.tsx';
import { InspectionPage } from './pages/InspectionPage.tsx';
import { HistoryPage } from './pages/HistoryPage.tsx';
import { AnalyticsPage } from './pages/AnalyticsPage.tsx';
import { LoginPage } from './pages/LoginPage.tsx';
import { AdminExportModal } from './components/AdminExportModal.tsx';
import { WagonsListPage } from './pages/WagonsListPage.tsx';
import { WagonDetailPage } from './pages/WagonDetailPage.tsx';
import { DashboardPage } from './pages/DashboardPage.tsx';
import { StoresInventoryPage } from './pages/StoresInventoryPage.tsx';
import { ComponentPassportsPage } from './pages/ComponentPassportsPage.tsx';

export const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(() => api.getUser());
  const [currentLang, setCurrentLang] = useState<LanguageCode>(() => {
    if (typeof localStorage !== 'undefined') {
      return (localStorage.getItem('wrs_lang') as LanguageCode) || 'en';
    }
    return 'en';
  });
  const [activeTab, setActiveTab] = useState<'wagons' | 'dashboard' | 'inventory' | 'passports' | 'inspection' | 'history' | 'analytics' | 'admin'>('wagons');
  const [selectedWagonNumber, setSelectedWagonNumber] = useState<string | null>(null);
  const [isAdminExportOpen, setIsAdminExportOpen] = useState<boolean>(false);

  const handleToggleLang = () => {
    const nextLang: LanguageCode = currentLang === 'en' ? 'hi' : 'en';
    setCurrentLang(nextLang);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('wrs_lang', nextLang);
    }
  };

  const handleLoginSuccess = (loggedInUser: User) => {
    setUser(loggedInUser);
    setActiveTab('wagons');
  };

  const handleLogout = () => {
    api.clearSession();
    setUser(null);
  };

  const handleSelectTab = (tab: 'inspection' | 'wagons' | 'dashboard' | 'inventory' | 'passports' | 'history' | 'analytics' | 'admin') => {
    if (tab === 'admin') {
      setIsAdminExportOpen(true);
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
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      <Header
        user={user}
        currentLang={currentLang}
        onToggleLang={handleToggleLang}
        onLogout={handleLogout}
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        {activeTab === 'wagons' && !selectedWagonNumber && (
          <WagonsListPage onSelectWagon={(wNum) => setSelectedWagonNumber(wNum)} />
        )}
        {activeTab === 'wagons' && selectedWagonNumber && (
          <WagonDetailPage
            wagonNumber={selectedWagonNumber}
            onBack={() => setSelectedWagonNumber(null)}
          />
        )}
        {activeTab === 'dashboard' && <DashboardPage />}
        {activeTab === 'inventory' && <StoresInventoryPage />}
        {activeTab === 'passports' && (
          <ComponentPassportsPage
            onNavigateToWagon={(wNum) => {
              setSelectedWagonNumber(wNum);
              setActiveTab('wagons');
            }}
          />
        )}
        {activeTab === 'inspection' && <InspectionPage lang={currentLang} user={user} />}
        {activeTab === 'history' && <HistoryPage lang={currentLang} />}
        {activeTab === 'analytics' && <AnalyticsPage lang={currentLang} user={user} />}
      </main>

      {/* Admin Export Dialog */}
      <AdminExportModal
        isOpen={isAdminExportOpen}
        onClose={() => setIsAdminExportOpen(false)}
        lang={currentLang}
      />
    </div>
  );
};

export default App;
