/**
 * Internationalization (i18n) Engine
 * Indian Railways WRS Raipur
 */

import React, { useState, useEffect, useCallback } from 'react';
import { en } from './en.ts';
import { hi } from './hi.ts';
import type { BandColor, InspectionStatus, DamageType, BogieType, SpringCondition, SpringPosition } from '../../../shared/types.ts';

export type LanguageCode = 'en' | 'hi';

export const dictionaries = { en, hi };

export function getDictionary(lang: LanguageCode = 'en') {
  return dictionaries[lang] || dictionaries.en;
}

export function useI18n() {
  const [lang, setLangState] = useState<LanguageCode>(() => {
    if (typeof localStorage !== 'undefined') {
      return (localStorage.getItem('wrs_lang') as LanguageCode) || 'en';
    }
    return 'en';
  });

  useEffect(() => {
    const handleStorage = () => {
      const stored = localStorage.getItem('wrs_lang') as LanguageCode;
      if (stored && (stored === 'en' || stored === 'hi')) {
        setLangState(stored);
      }
    };
    window.addEventListener('storage', handleStorage);
    window.addEventListener('wrs_lang_change', handleStorage);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('wrs_lang_change', handleStorage);
    };
  }, []);

  const setLang = useCallback((newLang: LanguageCode) => {
    setLangState(newLang);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('wrs_lang', newLang);
      window.dispatchEvent(new CustomEvent('wrs_lang_change', { detail: newLang }));
    }
  }, []);

  const t = useCallback((path: string, fallback?: string): string => {
    const dict = getDictionary(lang);
    const parts = path.split('.');
    let curr: any = dict;
    for (const p of parts) {
      if (curr && typeof curr === 'object' && p in curr) {
        curr = curr[p];
      } else {
        return fallback ?? path;
      }
    }
    return typeof curr === 'string' ? curr : (fallback ?? path);
  }, [lang]);

  return { t, lang, setLang };
}

export function getBandText(band: BandColor | 'CONDEMNED', lang: LanguageCode = 'en'): string {
  const dict = getDictionary(lang);
  return dict.bands[band] || band;
}

export function getStatusText(status: InspectionStatus, lang: LanguageCode = 'en'): string {
  const dict = getDictionary(lang);
  return dict.statuses[status] || status;
}

export function getDamageText(damage: DamageType, lang: LanguageCode = 'en'): string {
  const dict = getDictionary(lang);
  return dict.damages[damage] || damage;
}

export function getBogieTypeText(bogie: BogieType, lang: LanguageCode = 'en'): string {
  const dict = getDictionary(lang);
  return dict.bogieTypes[bogie] || bogie;
}

export function getPositionText(pos: SpringPosition, lang: LanguageCode = 'en'): string {
  const dict = getDictionary(lang);
  return dict.positions[pos] || pos;
}

export function getConditionText(cond: SpringCondition, lang: LanguageCode = 'en'): string {
  const dict = getDictionary(lang);
  return dict.conditions[cond] || cond;
}
