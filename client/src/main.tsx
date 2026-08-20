/**
 * PWA Client Entry Point & Service Worker Registration
 * Indian Railways WRS Raipur
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.tsx';
import './index.css';

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

// Register Service Worker for Offline PWA support via vite-plugin-pwa
import { registerSW } from 'virtual:pwa-register';

if ('serviceWorker' in navigator) {
  registerSW({
    onNeedRefresh() {
      console.log('[PWA] App update available');
    },
    onOfflineReady() {
      console.log('[PWA] App ready for offline use');
    },
  });
}
