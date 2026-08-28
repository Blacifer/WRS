/**
 * Ask the Manual
 * Indian Railways WRS Raipur
 *
 * 658 pages nobody reads, made answerable in seconds by the person actually
 * holding the component.
 *
 * Results are the manual's own words with the page number attached — never
 * paraphrased, never generated. For a safety limit that distinction is the
 * whole point: a wrong number confidently worded is worse than no answer.
 */

import React, { useState, useCallback, useEffect } from 'react';
import { api } from '../services/api.ts';
import type { LanguageCode } from '../i18n/index.ts';

interface ManualSearchPageProps {
  lang: LanguageCode;
}

interface Hit {
  page: number;
  chapter: string | null;
  heading: string | null;
  snippet: string;
  text: string;
  citation: string;
}

interface Answer {
  subject: string;
  answer: string;
  source: string;
  verified: boolean;
}

/** Questions inspectors actually need answered, as one-tap starting points. */
const COMMON_QUESTIONS: { en: string; hi: string }[] = [
  { en: 'brake block condemning limit', hi: 'ब्रेक ब्लॉक कंडमिंग सीमा' },
  { en: 'wear limit for friction wedge slope surface', hi: 'घर्षण वेज ढलान सतह घिसाव सीमा' },
  { en: 'spring free height variation same group', hi: 'स्प्रिंग मुक्त ऊंचाई भिन्नता समूह' },
  { en: 'centre pivot wear limit', hi: 'सेंटर पिवट घिसाव सीमा' },
  { en: 'thin and sharp flange', hi: 'पतला और तीखा फ्लैंज' },
  { en: 'CTRB bearing end cap screws torque', hi: 'सीटीआरबी एंड कैप स्क्रू टॉर्क' }
];

/** Renders FTS5's «» match markers as highlights. */
const Highlighted: React.FC<{ text: string }> = ({ text }) => (
  <>
    {text.split(/(«[^»]*»)/g).map((part, i) =>
      part.startsWith('«') && part.endsWith('»') ? (
        <mark key={i} className="bg-amber-400/25 text-amber-200 rounded px-0.5 not-italic">
          {part.slice(1, -1)}
        </mark>
      ) : (
        <span key={i}>{part}</span>
      )
    )}
  </>
);

export const ManualSearchPage: React.FC<ManualSearchPageProps> = ({ lang }) => {
  const isHi = lang === 'hi';

  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  /*
   * Direct answers from the app's own verified figures, shown above the
   * manual passages. Asked about brake air pressure, searching the PDF
   * returned a passage about leader nut sleeves while the app held the
   * answer — 4.9-5.1 kg/cm2, from §720-C — in the table it classifies
   * against. These are that table, made askable.
   */
  const [answers, setAnswers] = useState<Answer[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [status, setStatus] = useState<any>(null);

  useEffect(() => {
    api
      .getManualStatus()
      .then((r) => setStatus(r.data))
      .catch(() => setStatus(null));
  }, []);

  const search = useCallback(async (q: string) => {
    if (q.trim().length < 2) return;
    setLoading(true);
    setError(null);
    setExpanded(null);
    try {
      const res = await api.searchManual(q.trim());
      setHits(res.data.hits);
      setAnswers(res.data.answers || []);
    } catch (e: any) {
      setError(e?.message || 'Search failed');
      setHits(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const manualMissing = status && status.indexed === false;

  return (
    <div className="space-y-5 max-w-4xl mx-auto">
      {/* Header */}
      <div className="p-5 bg-gradient-to-r from-slate-900 via-slate-900 to-teal-950/40 border border-teal-500/30 rounded-2xl shadow-xl">
        <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">
          {isHi ? 'मैनुअल से पूछें' : 'Ask the Manual'}
        </h1>
        <p className="text-xs text-slate-400 mt-1 leading-relaxed max-w-2xl">
          {isHi
            ? 'आरडीएसओ वैगन रखरखाव मैनुअल में सीधे खोजें। उत्तर मैनुअल के अपने शब्दों में, पृष्ठ संख्या सहित।'
            : 'Search the RDSO Wagon Maintenance Manual directly. Answers come back in the manual’s own words with the page number — nothing is paraphrased or generated.'}
        </p>
        {status?.indexed && (
          <p className="text-[11px] text-teal-400/80 mt-2 font-mono">
            {status.passageCount?.toLocaleString()} passages · {status.pageCount} pages
          </p>
        )}
      </div>

      {manualMissing && (
        <div className="p-4 bg-amber-950/30 border border-amber-800 rounded-xl text-xs text-amber-200 leading-relaxed">
          {isHi
            ? 'इस सर्वर पर मैनुअल अभी अनुक्रमित नहीं है। व्यवस्थापक को "npm run index-manual" चलाना होगा।'
            : 'The manual has not been indexed on this server yet. An administrator needs to run “npm run index-manual”.'}
        </div>
      )}

      {/* Search box */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          search(query);
        }}
        className="flex flex-col sm:flex-row gap-2"
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            isHi ? 'उदा. ब्रेक ब्लॉक कंडमिंग सीमा' : 'e.g. what is the brake block condemning limit'
          }
          className="flex-1 min-h-[48px] bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 focus:border-teal-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={loading || query.trim().length < 2}
          className="min-h-[48px] px-6 py-3 bg-teal-600 hover:bg-teal-500 disabled:opacity-40 text-white rounded-xl text-sm font-bold transition shrink-0"
        >
          {loading ? (isHi ? 'खोज रहे…' : 'Searching…') : isHi ? 'खोजें' : 'Search'}
        </button>
      </form>

      {/* One-tap common questions */}
      {!hits && !loading && (
        <div className="space-y-2">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
            {isHi ? 'सामान्य प्रश्न' : 'Common questions'}
          </p>
          <div className="flex flex-wrap gap-2">
            {COMMON_QUESTIONS.map((q) => (
              <button
                key={q.en}
                onClick={() => {
                  const text = isHi ? q.hi : q.en;
                  setQuery(text);
                  search(text);
                }}
                className="min-h-[44px] px-3 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-xl text-xs text-slate-300 hover:text-white transition text-left"
              >
                {isHi ? q.hi : q.en}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="p-4 bg-rose-950/40 border border-rose-800 rounded-xl text-sm text-rose-300">
          {error}
        </div>
      )}

      {/* Results */}
      {hits && hits.length === 0 && !loading && (
        <div className="p-6 bg-slate-900 border border-slate-800 rounded-2xl text-center">
          <p className="text-sm font-bold text-white">
            {isHi ? 'कोई मिलान नहीं मिला' : 'Nothing matched'}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            {isHi
              ? 'अलग शब्दों से प्रयास करें — जैसे पुर्जे का नाम और "सीमा"।'
              : 'Try different words — the component name plus “limit” or “wear” usually works.'}
          </p>
        </div>
      )}

      {answers && answers.length > 0 && (
        <div className="space-y-2 mb-5">
          <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-400">
            {isHi ? 'सीधा उत्तर — इसी ऐप के सत्यापित आँकड़ों से' : 'Direct answer — from this app’s own verified figures'}
          </p>
          {answers.map((a, idx) => (
            <div
              key={idx}
              className="rounded-xl border border-emerald-800/70 bg-emerald-950/25 px-4 py-3"
            >
              <p className="text-[11px] text-emerald-300/80">{a.subject}</p>
              <p className="text-lg font-bold text-white mt-0.5">{a.answer}</p>
              <p className="text-[11px] text-slate-400 mt-1.5 font-mono">{a.source}</p>
              {!a.verified && (
                <p className="text-[11px] text-amber-300 mt-1">
                  {isHi
                    ? 'यह आँकड़ा अभी पुष्टि के अधीन है — उपयोग से पहले जाँच लें।'
                    : 'This figure is not settled — sources disagree. Confirm before relying on it.'}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {hits && hits.length > 0 && (
        <div className="space-y-3">
          <p className="text-[11px] text-slate-500">
            {isHi
              ? 'मैनुअल से शब्दशः — हमेशा उद्धृत पृष्ठ से पुष्टि करें।'
              : 'Reproduced verbatim from the manual — always confirm against the cited page.'}
          </p>

          {hits.map((h, idx) => (
            <div
              key={idx}
              className={`bg-slate-900 border rounded-2xl p-4 space-y-2.5 ${
                idx === 0 ? 'border-teal-700/60' : 'border-slate-800'
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                {idx === 0 && (
                  <span className="text-[9px] font-black px-2 py-0.5 rounded bg-teal-500/20 text-teal-300">
                    {isHi ? 'सर्वश्रेष्ठ मिलान' : 'BEST MATCH'}
                  </span>
                )}
                <span className="text-[11px] font-mono text-slate-400">
                  {isHi ? 'पृष्ठ' : 'Page'} {h.page}
                </span>
                {h.chapter && (
                  <span className="text-[11px] text-slate-500 truncate">{h.chapter}</span>
                )}
              </div>

              <p className="text-sm text-slate-200 leading-relaxed font-mono">
                <Highlighted text={h.snippet} />
              </p>

              <button
                onClick={() => setExpanded(expanded === idx ? null : idx)}
                className="text-[11px] font-bold text-teal-400 hover:text-teal-300 underline underline-offset-2"
              >
                {expanded === idx
                  ? isHi
                    ? 'संदर्भ छिपाएँ'
                    : 'Hide full passage'
                  : isHi
                  ? 'पूरा अनुच्छेद देखें'
                  : 'Show full passage'}
              </button>

              {expanded === idx && (
                <pre className="text-[11px] text-slate-300 bg-slate-950 border border-slate-800 rounded-xl p-3 overflow-x-auto whitespace-pre-wrap leading-relaxed">
                  {h.text}
                </pre>
              )}

              <p className="text-[10px] text-slate-500 italic">{h.citation}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ManualSearchPage;
