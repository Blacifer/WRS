/**
 * RDSO Color Band Badge Component
 * Indian Railways WRS Raipur
 */

import React from 'react';
import type { BandColor, BandRoman, InspectionStatus } from '../../../shared/types.ts';
import { getBandText } from '../i18n/index.ts';
import type { LanguageCode } from '../i18n/index.ts';

interface ClassificationBadgeProps {
  band: BandColor | null;
  bandRoman?: BandRoman | null;
  status: InspectionStatus;
  lang?: LanguageCode;
  isOverridden?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const BAND_STYLES: Record<string, { bg: string; text: string; border: string; label: string }> = {
  BLUE: { bg: 'bg-blue-600', text: 'text-white', border: 'border-blue-700', label: 'BLUE' },
  GREEN: { bg: 'bg-emerald-600', text: 'text-white', border: 'border-emerald-700', label: 'GREEN' },
  YELLOW: { bg: 'bg-yellow-400', text: 'text-yellow-950 font-black', border: 'border-yellow-500', label: 'YELLOW' },
  ORANGE: { bg: 'bg-orange-500', text: 'text-white', border: 'border-orange-600', label: 'ORANGE' },
  WHITE: { bg: 'bg-slate-100', text: 'text-slate-900 border-2 border-slate-400 font-black', border: 'border-slate-300', label: 'WHITE' },
  RED: { bg: 'bg-red-600', text: 'text-white', border: 'border-red-700', label: 'RED' },
  CONDEMNED: { bg: 'bg-rose-950', text: 'text-rose-200 border-2 border-rose-600 font-bold', border: 'border-rose-800', label: 'CONDEMNED' }
};

export const ClassificationBadge: React.FC<ClassificationBadgeProps> = ({
  band,
  bandRoman,
  status,
  lang = 'en',
  isOverridden = false,
  size = 'md'
}) => {
  const isCondemned = status === 'CONDEMNED' || !band;
  const key = isCondemned ? 'CONDEMNED' : band;
  const style = BAND_STYLES[key] || BAND_STYLES.CONDEMNED;
  const translatedName = isCondemned ? getBandText('CONDEMNED', lang) : getBandText(band, lang);

  const sizeClasses = {
    sm: 'px-2.5 py-1 text-xs font-semibold rounded',
    md: 'px-4 py-2 text-sm font-bold rounded-lg shadow-sm',
    lg: 'px-6 py-4 text-xl font-extrabold rounded-xl shadow-md'
  }[size];

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <div className={`inline-flex items-center gap-2 ${style.bg} ${style.text} ${style.border} ${sizeClasses}`}>
        <span className="w-3 h-3 rounded-full bg-current opacity-80 inline-block"></span>
        <span>{translatedName}</span>
        {bandRoman && !isCondemned && (
          <span className="opacity-90 font-mono text-xs uppercase px-1.5 py-0.5 rounded bg-black/20">
            {bandRoman}
          </span>
        )}
        {isOverridden && (
          <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 bg-purple-700 text-white rounded">
            OVERRIDDEN
          </span>
        )}
      </div>
    </div>
  );
};
