/**
 * Workshop Login Page
 * Indian Railways WRS Raipur
 */

import React, { useState } from 'react';
import type { User } from '../../../shared/types.ts';
import { getDictionary } from '../i18n/index.ts';
import type { LanguageCode } from '../i18n/index.ts';
import { api } from '../services/api.ts';
import { GlobeIcon, AlertTriangleIcon, RefreshCwIcon, ShieldIcon } from '../components/Icons.tsx';

interface LoginPageProps {
  lang: LanguageCode;
  onToggleLang: () => void;
  onLoginSuccess: (user: User) => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({
  lang,
  onToggleLang,
  onLoginSuccess
}) => {
  const dict = getDictionary(lang);
  const [username, setUsername] = useState<string>('inspector1');
  const [password, setPassword] = useState<string>('password123');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const res = await api.login({ username, password });
      if (res.user) {
        onLoginSuccess(res.user);
      }
    } catch (err: any) {
      setError(err.message || dict.messages.loginFailed);
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickFill = (u: string, p: string) => {
    setUsername(u);
    setPassword(p);
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-between p-4 sm:p-6 text-white select-none">
      {/* Top Header */}
      <div className="max-w-md w-full mx-auto flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded bg-blue-700 font-black text-white flex items-center justify-center text-sm">
            IR
          </div>
          <span className="font-extrabold text-sm text-slate-200">WRS Raipur</span>
        </div>

        <button
          onClick={onToggleLang}
          className="min-h-[44px] px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs font-bold text-slate-300 flex items-center gap-1.5"
        >
          <GlobeIcon size={16} className="text-blue-400" />
          <span>{lang === 'en' ? 'हिंदी' : 'English'}</span>
        </button>
      </div>

      {/* Center Login Card */}
      <div className="max-w-md w-full mx-auto my-8 bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl space-y-6">
        <div className="text-center space-y-1.5">
          <div className="w-14 h-14 rounded-2xl bg-blue-600/20 border border-blue-500/40 flex items-center justify-center mx-auto text-blue-400 mb-3 shadow-inner">
            <ShieldIcon size={28} />
          </div>
          <h1 className="text-xl font-black tracking-tight text-white">{dict.app.title}</h1>
          <p className="text-xs text-slate-400 font-medium">{dict.app.subtitle}</p>
          <div className="pt-2 flex justify-center">
            <span className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-gradient-to-r from-blue-950 via-slate-900 to-blue-950 border border-blue-600/50 rounded-full text-xs font-bold text-blue-300 shadow-md">
              <span className="text-amber-400">⚡</span>
              <span>{dict.loginTagline || (lang === 'hi' ? 'भारतीय रेल हेतु एआई-संचालित गुणवत्ता नियंत्रण' : 'AI-Powered Quality Control for Indian Railways')}</span>
            </span>
          </div>
        </div>

        {error && (
          <div className="p-3 bg-rose-950/80 border border-rose-700 rounded-xl text-rose-200 text-xs font-semibold flex items-center gap-2">
            <AlertTriangleIcon size={16} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-300">
              {lang === 'hi' ? 'उपयोगकर्ता नाम (Username)' : 'Username'}
            </label>
            <input
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full min-h-[48px] px-4 py-2.5 bg-slate-950 border border-slate-700 focus:border-blue-500 rounded-xl text-white font-bold text-sm outline-none"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-300">
              {lang === 'hi' ? 'पासवर्ड (Password)' : 'Password'}
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full min-h-[48px] px-4 py-2.5 bg-slate-950 border border-slate-700 focus:border-blue-500 rounded-xl text-white font-bold text-sm outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full min-h-[52px] px-4 py-3 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-black text-base rounded-xl shadow-lg flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
          >
            {isLoading ? <RefreshCwIcon size={20} className="animate-spin" /> : null}
            <span>{isLoading ? dict.app.syncing : dict.actions.login}</span>
          </button>
        </form>

        {/* Demo Fast Login Chips for Workshop Operators */}
        <div className="pt-2 border-t border-slate-800 space-y-2">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block text-center">
            {lang === 'hi' ? 'त्वरित डेमो लॉगिन (Quick Role Select)' : 'Quick Demo Role Selection'}
          </span>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => handleQuickFill('inspector1', 'password123')}
              className="min-h-[44px] p-2 bg-slate-950 hover:bg-slate-800 border border-slate-800 rounded-lg text-center"
            >
              <div className="text-xs font-extrabold text-blue-400">Inspector</div>
              <div className="text-[10px] text-slate-500">inspector1</div>
            </button>

            <button
              type="button"
              onClick={() => handleQuickFill('supervisor1', 'password123')}
              className="min-h-[44px] p-2 bg-slate-950 hover:bg-slate-800 border border-slate-800 rounded-lg text-center"
            >
              <div className="text-xs font-extrabold text-purple-400">Supervisor</div>
              <div className="text-[10px] text-slate-500">supervisor1</div>
            </button>

            <button
              type="button"
              onClick={() => handleQuickFill('admin1', 'password123')}
              className="min-h-[44px] p-2 bg-slate-950 hover:bg-slate-800 border border-slate-800 rounded-lg text-center"
            >
              <div className="text-xs font-extrabold text-amber-400">Admin</div>
              <div className="text-[10px] text-slate-500">admin1</div>
            </button>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="text-center text-xs text-slate-500">
        RDSO Technical Pamphlet G-95 Revision-II • Indian Railways
      </div>
    </div>
  );
};
