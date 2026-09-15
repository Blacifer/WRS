/**
 * Ask the records
 * Indian Railways WRS Raipur
 *
 * A sentence in, an answer out — with the rows it came from and the query
 * that produced it, because a figure nobody can check is not a figure this
 * system reports. The sentence is read first by a plain matcher (no model,
 * offline); a model, if one is configured, only gets a turn when the
 * matcher cannot tell, and only to pick the question — the number is always
 * the server's arithmetic. When nothing can tell, the list is offered.
 */

import React, { useEffect, useState } from 'react';
import { api } from '../services/api.ts';

interface Props { lang: 'en' | 'hi' }

export const AskRecordsPage: React.FC<Props> = ({ lang }) => {
  const isHi = lang === 'hi';
  const t = (en: string, hi: string) => (isHi ? hi : en);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<any>(null);
  const [catalogue, setCatalogue] = useState<Array<{ id: string; describe: string; params: string[] }>>([]);
  const [posture, setPosture] = useState<{ configured: boolean; local: boolean; baseUrl: string | null } | null>(null);
  const [showHow, setShowHow] = useState(false);
  const [pick, setPick] = useState<{ id: string; params: Record<string, string> } | null>(null);

  useEffect(() => {
    api.getAskCatalogue(lang).then((r) => setCatalogue(r.data)).catch(() => setCatalogue([]));
    api.getAskPosture().then((r) => setPosture(r.data)).catch(() => setPosture(null));
  }, [lang]);

  const run = async (body: Record<string, unknown>) => {
    setBusy(true); setShowHow(false);
    try { setAnswer((await api.askRecords(body)).data); }
    catch (e: any) { setAnswer({ answered: false, reason: e?.message || 'Could not ask.', catalogue }); }
    finally { setBusy(false); }
  };

  const submit = (e: React.FormEvent) => { e.preventDefault(); if (question.trim()) void run({ question: question.trim(), lang }); };

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-5" data-testid="ask-page">
      <header>
        <h1 className="text-2xl font-black text-white">{t('Ask the records', 'रिकॉर्ड से पूछें')}</h1>
        <p className="text-xs text-ink-muted mt-1 max-w-2xl">
          {t('A question about this shop\'s own records, answered by fixed arithmetic over rows you can see. No model writes a number here.', 'इस दुकान के अपने रिकॉर्ड के बारे में एक प्रश्न, तय गणना से उत्तरित। कोई मॉडल यहाँ संख्या नहीं लिखता।')}
          {posture && (
            <span className="block mt-1 text-[11px] text-ink-faint">
              {!posture.configured
                ? t('No model is configured: the matcher alone reads your sentence, offline.', 'कोई मॉडल नहीं: केवल मैचर आपका वाक्य पढ़ता है, ऑफ़लाइन।')
                : posture.local
                  ? t('A model on this PC helps pick the question when the matcher cannot; your sentence does not leave the machine.', 'इस PC पर एक मॉडल प्रश्न चुनने में मदद करता है; आपका वाक्य मशीन से बाहर नहीं जाता।')
                  : t(`A model at ${posture.baseUrl} helps pick the question when the matcher cannot; only your sentence and the list of questions are sent — never a record.`, `${posture.baseUrl} पर एक मॉडल प्रश्न चुनने में मदद करता है; केवल आपका वाक्य भेजा जाता है — कोई रिकॉर्ड नहीं।`)}
            </span>
          )}
        </p>
      </header>

      <form onSubmit={submit} className="flex gap-2">
        <input value={question} onChange={(e) => setQuestion(e.target.value)} data-testid="ask-input"
          placeholder={t('e.g. which wagon type condemns the most snubbers this quarter', 'जैसे: इस तिमाही में किस वैगन प्रकार में सबसे अधिक स्नबर कंडम हुए')}
          className="flex-1 bg-raised border border-line rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-accent-hover" />
        <button type="submit" disabled={busy || !question.trim()} data-testid="ask-submit" className="px-4 py-2 rounded-control bg-ink text-canvas text-xs font-bold disabled:opacity-50">{t('Ask', 'पूछें')}</button>
      </form>

      {answer && answer.answered === false && (
        <section className="bg-card border border-warn-line rounded-card p-5 space-y-3" data-testid="ask-no-answer">
          <p className="text-sm font-bold text-white">{answer.reason}</p>
          <p className="text-[11px] text-ink-muted">{t('Pick a question instead:', 'इसके बजाय एक प्रश्न चुनें:')}</p>
          <Picker catalogue={answer.catalogue || catalogue} onPick={(id, params) => { setPick({ id, params }); void run({ id, params, question: question.trim() || id, lang }); }} isHi={isHi} />
        </section>
      )}

      {answer && answer.answered !== false && (
        <section className="bg-card border border-line rounded-card p-5 space-y-4" data-testid="ask-answer">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-ink-muted">{answer.describe}</p>
              <p className="text-sm font-bold text-white mt-1" data-testid="ask-sentence">{answer.sentence}</p>
            </div>
            <span className="text-[10px] text-ink-faint whitespace-nowrap">
              {answer.matchedBy === 'MODEL' ? t('question picked by the model', 'प्रश्न मॉडल ने चुना') : t('question matched offline', 'प्रश्न ऑफ़लाइन मिला')}
            </span>
          </div>
          {answer.figures?.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {answer.figures.slice(0, 12).map((f: any, i: number) => (
                <div key={i} className="rounded-control border border-line bg-raised px-3 py-2 text-xs">
                  <div className="text-[10px] text-ink-muted">{f.label}</div>
                  <div className="font-black text-white tabular-nums">{String(f.value)}{typeof f.n === 'number' ? <span className="text-ink-faint font-normal"> · n={f.n}</span> : null}</div>
                </div>
              ))}
            </div>
          )}
          {answer.rows?.length > 0 && (
            <div className="overflow-x-auto max-h-80 overflow-y-auto">
              <table className="w-full text-[11px]" data-testid="ask-rows">
                <thead><tr className="text-ink-muted text-[10px] uppercase tracking-wide">{answer.columns.map((c: string) => <th key={c} className="text-left py-1 pr-2">{c}</th>)}</tr></thead>
                <tbody>{answer.rows.slice(0, 200).map((r: any, i: number) => <tr key={i} className="border-t border-line/60">{answer.columns.map((c: string) => <td key={c} className="py-1 pr-2 text-ink-body tabular-nums">{r[c] === null || r[c] === undefined ? '—' : String(r[c])}</td>)}</tr>)}</tbody>
              </table>
              {answer.rows.length > 200 && <p className="text-[10px] text-ink-faint">{t(`${answer.rows.length} rows; the first 200 are shown.`, `${answer.rows.length} पंक्तियाँ; पहली 200 दिखाई गईं।`)}</p>}
            </div>
          )}
          {answer.caveats?.length > 0 && <ul className="text-[11px] text-ink-muted list-disc pl-4">{answer.caveats.map((c: string) => <li key={c}>{c}</li>)}</ul>}
          <button type="button" onClick={() => setShowHow(!showHow)} className="text-[11px] text-accent-ink font-semibold" data-testid="ask-how">
            {showHow ? t('Hide how this was computed', 'गणना छिपाएँ') : t('How this was computed', 'यह कैसे गणना की गई')}
          </button>
          {showHow && (
            <div className="space-y-2" data-testid="ask-citations">
              {answer.citations.map((c: any, i: number) => (
                <div key={i} className="text-[11px]">
                  <div className="text-ink-body">{t('Source', 'स्रोत')}: {c.source}{c.ids ? ` · ${c.ids.length} ${t('row id(s)', 'पंक्ति')}` : ''}</div>
                  {c.query && <pre className="mt-1 bg-raised border border-line rounded p-2 text-[10.5px] text-ink-muted whitespace-pre-wrap">{c.query.replace(/\s+/g, ' ').trim()}{c.params ? `\n-- ${JSON.stringify(c.params)}` : ''}</pre>}
                  {c.ids && <div className="text-ink-faint break-all">{c.ids.slice(0, 40).join(', ')}{c.ids.length > 40 ? ' …' : ''}</div>}
                </div>
              ))}
              <div className="text-[10.5px] text-ink-faint">{t('Parameters', 'पैरामीटर')}: {JSON.stringify(answer.params)}</div>
            </div>
          )}
        </section>
      )}

      {!answer && (
        <section className="bg-card border border-line rounded-card p-5 space-y-2">
          <p className="text-[11px] text-ink-muted">{t('Or pick a question:', 'या एक प्रश्न चुनें:')}</p>
          <Picker catalogue={catalogue} onPick={(id, params) => { setPick({ id, params }); void run({ id, params, question: id, lang }); }} isHi={isHi} />
          {pick && <span className="hidden">{pick.id}</span>}
        </section>
      )}
    </div>
  );
};

const Picker: React.FC<{ catalogue: Array<{ id: string; describe: string; params: string[] }>; onPick: (id: string, params: Record<string, string>) => void; isHi: boolean }> = ({ catalogue, onPick, isHi }) => {
  const [values, setValues] = useState<Record<string, Record<string, string>>>({});
  const hint: Record<string, string> = { wagonType: 'BOXNHL', springPosition: 'OUTER / INNER / SNUBBER', period: 'week / month / quarter / year / 30 days', wagonNumber: 'SECR/BOXNHL/12345', stage: 'REPAIR_REPLACEMENT', band: 'BLUE', partName: isHi ? 'पुर्जे का नाम' : 'part name' };
  return (
    <ul className="space-y-1.5" data-testid="ask-picker">
      {catalogue.map((q) => (
        <li key={q.id} className="flex flex-wrap items-center gap-2 text-xs">
          <button type="button" onClick={() => onPick(q.id, values[q.id] || {})} className="text-left font-semibold text-white hover:text-accent-ink" data-testid={`ask-pick-${q.id}`}>{q.describe}</button>
          {q.params.map((p) => (
            <input key={p} placeholder={`${p} (${hint[p] || ''})`} value={values[q.id]?.[p] || ''} onChange={(e) => setValues((v) => ({ ...v, [q.id]: { ...(v[q.id] || {}), [p]: e.target.value } }))}
              className="bg-raised border border-line rounded px-2 py-1 text-[11px] text-white w-52" />
          ))}
        </li>
      ))}
    </ul>
  );
};
