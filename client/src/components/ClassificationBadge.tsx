/**
 * RDSO Color Band Badge Component
 * Indian Railways WRS Raipur
 *
 * WHY THE COLOURS ARE NOT TAILWIND CLASSES
 * ----------------------------------------
 * They were — bg-blue-600, bg-emerald-600, bg-red-600 and so on — and that is
 * exactly the problem. Those look like ordinary interface colours, so a sweep
 * that folded the application's blues into one accent rewrote BLUE and ORANGE
 * to the same token and this badge started drawing two different RDSO bands
 * identically. Band III and Band IV are already the hardest pair on this
 * screen to tell apart; silently merging two more is the kind of change that
 * ends with mixed bands in a nest.
 *
 * So the fill comes from COLOR_HEX_MAP — RDSO's own values, one copy, shared
 * with the sorting screen and the classification service — applied as an
 * inline style where no class-level find-and-replace can reach it.
 *
 * The band NUMBER is always drawn alongside the colour for the same reason
 * the sorting buttons carry it: Yellow and Orange separate by ΔE 2.9 under
 * deuteranopia, which is well below the threshold at which a person can tell
 * two fills apart. Colour is never the only thing saying which band this is.
 */

import React from 'react';
import type { BandColor, BandRoman, InspectionStatus } from '../../../shared/types.ts';
import { COLOR_HEX_MAP } from '../../../shared/classification/tables.ts';
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

/**
 * Black or white ink on a given fill, decided by relative luminance rather
 * than by a hand-maintained list — so a band whose published colour is ever
 * revised keeps readable text without anyone remembering to update this.
 */
function inkOn(hex: string): string {
  const v = hex.replace('#', '');
  const rgb = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
  const lin = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  const L = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  // Contrast against white vs against near-black; take whichever is greater.
  return (1.05 / (L + 0.05)) >= ((L + 0.05) / 0.05) ? '#ffffff' : '#0a0a0a';
}

const CONDEMNED_HEX = '#f43f5e';

export const ClassificationBadge: React.FC<ClassificationBadgeProps> = ({
  band,
  bandRoman,
  status,
  lang = 'en',
  isOverridden = false,
  size = 'md'
}) => {
  const isCondemned = status === 'CONDEMNED' || !band;
  const hex = isCondemned ? CONDEMNED_HEX : (COLOR_HEX_MAP[band as BandColor] || '#71717a');
  const translatedName = isCondemned ? getBandText('CONDEMNED', lang) : getBandText(band as BandColor, lang);

  const sizeClasses = {
    sm: 'px-2.5 py-1 text-xs font-semibold rounded-chip gap-1.5',
    md: 'px-4 py-2 text-sm font-bold rounded-control gap-2',
    lg: 'px-6 py-4 text-xl font-extrabold rounded-card gap-2.5'
  }[size];

  if (isCondemned) {
    return (
      <span
        className={`inline-flex items-center border ${sizeClasses}`}
        style={{ backgroundColor: 'rgba(244,63,94,0.12)', borderColor: 'rgba(244,63,94,0.45)', color: '#fb7185' }}
      >
        <span className="w-2.5 h-2.5 rounded-full bg-current opacity-90 inline-block" aria-hidden="true" />
        <span>{translatedName}</span>
      </span>
    );
  }

  const ink = inkOn(hex);

  return (
    <span
      className={`inline-flex items-center border ${sizeClasses}`}
      style={{ backgroundColor: hex, borderColor: 'rgba(255,255,255,0.22)', color: ink }}
    >
      <span className="w-2.5 h-2.5 rounded-full bg-current opacity-80 inline-block" aria-hidden="true" />
      <span>{translatedName}</span>
      {/* Never colour alone. */}
      {bandRoman && (
        <span
          className="font-mono text-[11px] uppercase font-bold px-1.5 py-0.5 rounded-chip"
          style={{ backgroundColor: ink === '#ffffff' ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.28)' }}
        >
          {bandRoman}
        </span>
      )}
      {isOverridden && (
        <span
          className="text-[10px] uppercase font-bold tracking-[0.06em] px-1.5 py-0.5 rounded-chip"
          style={{ backgroundColor: ink === '#ffffff' ? 'rgba(0,0,0,0.28)' : 'rgba(255,255,255,0.32)' }}
        >
          {lang === 'hi' ? 'ओवरराइड किया' : 'OVERRIDDEN'}
        </span>
      )}
    </span>
  );
};
