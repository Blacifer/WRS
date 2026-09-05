/**
 * What the system has seen, and what it changed as a result
 * Indian Railways WRS Raipur
 *
 * WHY THIS EXISTS
 * ---------------
 * "How much information does it have, and what has it learned?" is the
 * question anyone senior asks of a system that claims to improve itself, and
 * the honest answer has to be available on a screen rather than assembled by
 * hand.
 *
 * Two rules govern what is shown here:
 *
 *   1. Nothing is inferred. Every figure is a count of something recorded.
 *   2. Having learned nothing is displayed as having learned nothing.
 *
 * The second matters more than the first. On day one this screen will say the
 * system has learned nothing, and that is the correct thing for it to say. A
 * learning display that looks impressive before any data exists is one nobody
 * should believe on the day it finally has something to report.
 *
 * WHAT COUNTS AS LEARNING HERE
 * ----------------------------
 * Only the correction ledger. The RDSO tables and the indexed manual are
 * knowledge the system was *given* — reference data, transcribed and verified.
 * Calling that "learned" would be the sort of overstatement this project has
 * spent its time removing.
 */

import { useState, useEffect } from 'react';
import { api } from '../services/api.ts';

interface Props {
  lang: 'en' | 'hi';
}

interface Observation {
  subsystem: string;
  total: number;
  corrected: number;
  accuracyPct: number | null;
  enoughToLearnFrom: boolean;
  firstSeen: string | null;
  lastSeen: string | null;
}

const SUBSYSTEM_LABEL: Record<string, { en: string; hi: string }> = {
  OCR_CALIPER: { en: 'Caliper reading (OCR)', hi: 'कैलिपर पठन (OCR)' },
  SPRING_CLASSIFICATION: { en: 'Spring classification', hi: 'स्प्रिंग वर्गीकरण' },
  VOICE_COMMAND: { en: 'Voice commands', hi: 'ध्वनि आदेश' },
  ACOUSTIC_DIAGNOSTIC: { en: 'Acoustic diagnostics', hi: 'ध्वनिक निदान' },
  DEFECT_SUGGESTION: { en: 'Defect suggestions', hi: 'दोष सुझाव' }
};

export function LearningMemory({ lang }: Props) {
  const isHi = lang === 'hi';
  const [memory, setMemory] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getLearningMemory()
      .then((r) => setMemory(r.data))
      .catch((e) => setError(e?.message || 'Could not load'));
  }, []);

  if (error) {
    return (
      <p className="text-xs text-bad-ink bg-bad-soft border border-bad-line rounded-control px-3 py-2">{error}</p>
    );
  }
  if (!memory) {
    return <p className="text-xs text-ink-faint">{isHi ? 'लोड हो रहा है…' : 'Loading…'}</p>;
  }

  const observations: Observation[] = memory.observations || [];
  const applied = memory.changesApplied || [];
  const rejected = memory.changesRejected || [];
  const pending = memory.pendingProposals || [];

  const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString() : '—');

  return (
    <div className="space-y-5">
      {/* The plain-language answer, first, because it is what gets read aloud */}
      <div className="rounded-control border border-line bg-raised p-4">
        <p className="text-[11px] font-bold text-ink-muted uppercase tracking-wide mb-1">
          {isHi ? 'संक्षेप' : 'In short'}
        </p>
        <p className="text-sm text-white leading-relaxed">{memory.summary}</p>
      </div>

      {/* What it has seen */}
      <div>
        <h4 className="text-sm font-extrabold text-white mb-1">
          {isHi ? 'क्या देखा गया है' : 'What it has seen'}
        </h4>
        <p className="text-[11px] text-ink-muted mb-3">
          {isHi
            ? 'हर पंक्ति एक दर्ज किया गया निर्णय है, जहाँ मशीन ने सुझाव दिया और व्यक्ति ने उसे स्वीकारा या सुधारा।'
            : 'Each observation is a recorded judgement: the machine proposed something and a person either accepted it or corrected it.'}
        </p>

        <div className="overflow-x-auto rounded-control border border-line">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-raised text-ink-body">
                <th className="text-left px-3 py-2 font-bold">{isHi ? 'उपप्रणाली' : 'Subsystem'}</th>
                <th className="text-right px-3 py-2 font-bold">{isHi ? 'अवलोकन' : 'Observations'}</th>
                <th className="text-right px-3 py-2 font-bold">{isHi ? 'सुधारे गए' : 'Corrected'}</th>
                <th className="text-right px-3 py-2 font-bold">{isHi ? 'सटीकता' : 'Accuracy'}</th>
                <th className="text-left px-3 py-2 font-bold">{isHi ? 'अवधि' : 'Period'}</th>
              </tr>
            </thead>
            <tbody>
              {observations.map((o) => (
                <tr key={o.subsystem} className="border-t border-line">
                  <td className="px-3 py-2 text-ink-body">
                    {isHi ? SUBSYSTEM_LABEL[o.subsystem]?.hi : SUBSYSTEM_LABEL[o.subsystem]?.en}
                    {o.total > 0 && !o.enoughToLearnFrom && (
                      <span className="block text-[10px] text-warn-ink">
                        {isHi ? 'निष्कर्ष हेतु पर्याप्त नहीं' : 'not yet enough to draw a conclusion from'}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-white">{o.total.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-body">{o.corrected.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {o.accuracyPct === null ? (
                      // Deliberately not 0% and not 100%. A subsystem with no
                      // observations has no accuracy, and inventing one would
                      // be the most misleading number on this screen.
                      <span className="text-ink-faint">{isHi ? 'कोई डेटा नहीं' : 'no data'}</span>
                    ) : (
                      <span className="text-white">{o.accuracyPct}%</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-muted">
                    {o.total === 0 ? '—' : `${fmtDate(o.firstSeen)} – ${fmtDate(o.lastSeen)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* What it changed */}
      <div>
        <h4 className="text-sm font-extrabold text-white mb-1">
          {isHi ? 'क्या बदला गया' : 'What it changed'}
        </h4>
        <p className="text-[11px] text-ink-muted mb-3">
          {isHi
            ? 'कोई भी बदलाव स्वयं लागू नहीं होता — हर एक को नामित पर्यवेक्षक स्वीकारता है, और वह निर्णय स्थायी रूप से दर्ज रहता है।'
            : 'No change applies itself. Each one is accepted by a named supervisor, and that decision is kept permanently — including the ones that were turned down.'}
        </p>

        {applied.length === 0 && rejected.length === 0 ? (
          <p className="text-xs text-ink-faint border border-line rounded-control px-3 py-3">
            {isHi
              ? 'अब तक कोई सेटिंग नहीं बदली गई।'
              : 'No settings have been changed yet.'}
          </p>
        ) : (
          <div className="space-y-2">
            {[...applied, ...rejected].map((c: any) => (
              <div
                key={c.id}
                className={`rounded-control border px-3 py-2.5 ${
                  c.decision === 'APPROVED'
                    ? 'border-good-line bg-good-soft'
                    : 'border-line bg-raised'
                }`}
              >
                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                  <span className="font-mono text-xs text-ink-body">{c.param_key}</span>
                  <span className={`text-[11px] font-bold ${c.decision === 'APPROVED' ? 'text-good-ink' : 'text-ink-muted'}`}>
                    {c.decision === 'APPROVED'
                      ? (isHi ? 'लागू किया गया' : 'Applied')
                      : (isHi ? 'अस्वीकृत' : 'Turned down')}
                  </span>
                </div>
                <p className="text-sm text-white tabular-nums mt-0.5">
                  {c.previous_value}
                  {' → '}
                  {c.decision === 'APPROVED' ? c.applied_value : c.proposed_value}
                  {c.decision !== 'APPROVED' && (
                    <span className="text-[11px] text-ink-faint ml-1">
                      {isHi ? '(प्रस्तावित, लागू नहीं)' : '(proposed, not applied)'}
                    </span>
                  )}
                </p>
                {c.rationale && <p className="text-[11px] text-ink-muted mt-1">{c.rationale}</p>}
                <p className="text-[11px] text-ink-faint mt-1">
                  {c.sample_size
                    ? (isHi ? `${c.sample_size} अवलोकनों पर आधारित · ` : `Based on ${c.sample_size} observations · `)
                    : ''}
                  {c.decided_by_name || c.decided_by} · {new Date(c.decided_at).toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {pending.length > 0 && (
        <div className="rounded-control border border-warn-line bg-warn-soft px-3 py-2.5">
          <p className="text-xs font-bold text-warn-ink">
            {isHi
              ? `${pending.length} प्रस्ताव निर्णय की प्रतीक्षा में`
              : `${pending.length} proposal${pending.length === 1 ? '' : 's'} awaiting a decision`}
          </p>
        </div>
      )}

      {/* The distinction that stops the figures being overstated */}
      <p className="text-[11px] text-ink-faint border-t border-line pt-3 leading-relaxed">
        {isHi
          ? 'ध्यान दें: RDSO तालिकाएँ और अनुक्रमित मैनुअल “सीखा हुआ” नहीं है — वह संदर्भ जानकारी है जो प्रणाली को दी गई। यहाँ केवल वही गिना जाता है जो प्रणाली ने अपने काम से सुधारा।'
          : 'Note: the RDSO tables and the indexed manual are not “learned”. They are reference data the system was given, transcribed and checked. Only corrections made during real work are counted here.'}
      </p>
    </div>
  );
}
