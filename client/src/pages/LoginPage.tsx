/**
 * Workshop Login Page
 * Indian Railways WRS Raipur
 */

import React, { useState } from 'react';
import type { User } from '../../../shared/types.ts';
import { getDictionary } from '../i18n/index.ts';
import type { LanguageCode } from '../i18n/index.ts';
import { api } from '../services/api.ts';
import { GlobeIcon, AlertTriangleIcon, RefreshCwIcon } from '../components/Icons.tsx';
import { Button, Chip, Field, Note, inputClass } from '../components/ui/index.tsx';

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
  const isHi = lang === 'hi';
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

  return (
    <div className="min-h-screen bg-page text-ink flex flex-col select-none">
      {/* Language first, and reachable before anything is read: somebody who
          cannot read the English form should not have to find the toggle
          underneath it. */}
      <div className="w-full max-w-md mx-auto px-6 pt-4 flex justify-end">
        <Button size="md" variant="secondary" onClick={onToggleLang} aria-label="Toggle language">
          <GlobeIcon size={18} className="text-accent-ink" />
          <span>{isHi ? 'EN' : 'हिंदी'}</span>
        </Button>
      </div>

      <div className="w-full max-w-md mx-auto px-6 pt-6">
        <div className="w-[60px] h-[60px] rounded-touch bg-railway-blue border border-accent-hover flex items-center justify-center text-[22px] font-extrabold text-white">
          IR
        </div>

        <h1 className="mt-6 text-[30px] leading-[1.15] font-extrabold tracking-[-0.032em] text-ink">
          {dict.app.title}
        </h1>
        <p className="mt-2 text-sm font-medium text-ink-muted leading-relaxed">{dict.app.subtitle}</p>

        <div className="mt-4">
          <Chip tone="accent">
            {/* The fallback said "AI-Powered" too, so replacing the dictionary
                entry alone would have left the old claim showing whenever the
                dictionary failed to load. */}
            {dict.loginTagline ||
              (isHi
                ? 'आरडीएसओ जी-95 वर्गीकरण एवं शून्य-दोष रिलीज़ नियंत्रण'
                : 'RDSO G-95 Classification & Zero-Defect Release Control')}
          </Chip>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="w-full max-w-md mx-auto px-6 pt-8 space-y-4">
        {error && (
          <div
            role="alert"
            className="flex items-center gap-2.5 px-4 py-3 rounded-control bg-bad-soft border border-bad-line text-bad-ink text-xs font-bold"
          >
            <AlertTriangleIcon size={16} />
            <span>{error}</span>
          </div>
        )}

        <Field label={isHi ? 'कर्मचारी आईडी' : 'Staff ID'} htmlFor="login-username">
          <input
            id="login-username"
            type="text"
            required
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label={isHi ? 'पासवर्ड' : 'Password'} htmlFor="login-password">
          <input
            id="login-password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
        </Field>

        <Button type="submit" variant="primary" size="touch" block disabled={isLoading} className="!mt-6">
          {isLoading ? <RefreshCwIcon size={20} className="animate-spin" /> : null}
          <span>{isLoading ? dict.app.syncing : dict.actions.login}</span>
        </Button>
      </form>

      {/*
        Said here rather than discovered in a shed.
        The offline queue is the single most important thing about this app for
        the people using it, and nothing on the way in mentioned it.
      */}
      <div className="w-full max-w-md mx-auto px-6 pt-6">
        <Note tone="warn">
          <span>
            <span className="block text-[13px] font-bold text-warn-ink">
              {isHi ? 'नेटवर्क के बिना भी चलता है' : 'Works without a network'}
            </span>
            <span className="block mt-1 font-medium">
              {isHi
                ? 'शॉप वाईफ़ाई पर एक बार साइन इन करें। उसके बाद ऐप शेड में भी चलता रहता है और सिग्नल लौटने पर दर्ज कार्य भेज देता है।'
                : 'Sign in once on shop wifi. After that the app keeps working in the shed and sends what you record when signal returns.'}
            </span>
          </span>
        </Note>
      </div>

      <div className="mt-auto w-full max-w-md mx-auto px-6 py-6 border-t border-line">
        <Note>RDSO Technical Pamphlet G-95 Revision-II · Indian Railways</Note>
      </div>
    </div>
  );
};
