/**
 * Defect & Damage Type Selector Component
 * Indian Railways WRS Raipur
 */

import React from 'react';
import type { DamageType } from '../../../shared/types.ts';
import { getDictionary, getDamageText } from '../i18n/index.ts';
import type { LanguageCode } from '../i18n/index.ts';
import { AlertTriangleIcon } from './Icons.tsx';

interface DefectSelectorProps {
  lang: LanguageCode;
  selectedDamage: DamageType;
  onSelectDamage: (type: DamageType) => void;
  damageNotes: string;
  onDamageNotesChange: (notes: string) => void;
}

const DAMAGE_OPTIONS: DamageType[] = ['NONE', 'CRACK', 'CORROSION', 'DEFORMATION', 'OTHER'];

export const DefectSelector: React.FC<DefectSelectorProps> = ({
  lang,
  selectedDamage,
  onSelectDamage,
  damageNotes,
  onDamageNotesChange
}) => {
  const dict = getDictionary(lang);

  return (
    <div className="bg-card border border-line rounded-control p-4 sm:p-5 space-y-4">
      <div className="flex items-center justify-between">
        <label className="text-sm font-bold text-ink-body">
          {dict.form.damageAssessment}
        </label>
        {selectedDamage !== 'NONE' && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-bad-soft text-bad-ink border border-bad-line">
            <AlertTriangleIcon size={12} />
            <span>CONDEMNS SPRING</span>
          </span>
        )}
      </div>

      {/* Touch-Friendly Defect Buttons (>= 48px height) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
        {DAMAGE_OPTIONS.map((type) => {
          const isSelected = selectedDamage === type;
          const isDefect = type !== 'NONE';

          return (
            <button
              key={type}
              type="button"
              onClick={() => onSelectDamage(type)}
              className={`min-h-[48px] px-3 py-2.5 rounded-control border text-left flex items-center justify-between text-xs sm:text-sm font-bold transition-all active:scale-[0.98] ${
                isSelected
                  ? isDefect
                    ? 'bg-bad-soft border-bad-line text-white shadow-sm'
                    : 'bg-good-soft border-good-line text-white shadow-sm'
                  : 'bg-page border-line text-ink-body hover:border-line'
              }`}
            >
              <span>{getDamageText(type, lang)}</span>
              {isSelected && (
                <span className={`w-2.5 h-2.5 rounded-full ${isDefect ? 'bg-rose-400' : 'bg-emerald-400'}`}></span>
              )}
            </button>
          );
        })}
      </div>

      {/* Optional Damage Remarks / Notes Textarea */}
      <div className="space-y-1.5 pt-2">
        <label className="block text-xs font-semibold text-ink-muted">
          {dict.form.damageNotes}
        </label>
        <textarea
          rows={2}
          value={damageNotes}
          onChange={(e) => onDamageNotesChange(e.target.value)}
          placeholder={dict.form.damageNotesPlaceholder}
          className="w-full px-3 py-2.5 bg-page border border-line focus:border-accent-line focus:ring-1 focus:ring-blue-500 rounded-control text-ink-body text-xs sm:text-sm outline-none transition-all"
        />
      </div>
    </div>
  );
};
