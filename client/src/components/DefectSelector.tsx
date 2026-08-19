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
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5 shadow-lg space-y-4">
      <div className="flex items-center justify-between">
        <label className="text-sm font-bold text-slate-200">
          {dict.form.damageAssessment}
        </label>
        {selectedDamage !== 'NONE' && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-rose-950 text-rose-300 border border-rose-800">
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
              className={`min-h-[48px] px-3 py-2.5 rounded-lg border text-left flex items-center justify-between text-xs sm:text-sm font-bold transition-all active:scale-[0.98] ${
                isSelected
                  ? isDefect
                    ? 'bg-rose-900/60 border-rose-500 text-white shadow-sm'
                    : 'bg-emerald-900/60 border-emerald-500 text-white shadow-sm'
                  : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
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
        <label className="block text-xs font-semibold text-slate-400">
          {dict.form.damageNotes}
        </label>
        <textarea
          rows={2}
          value={damageNotes}
          onChange={(e) => onDamageNotesChange(e.target.value)}
          placeholder={dict.form.damageNotesPlaceholder}
          className="w-full px-3 py-2.5 bg-slate-950 border border-slate-800 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-lg text-slate-200 text-xs sm:text-sm outline-none transition-all"
        />
      </div>
    </div>
  );
};
