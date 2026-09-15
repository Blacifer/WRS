/**
 * The shadow run — the app beside the register, and whether to trust it
 * Indian Railways WRS Raipur
 *
 * docs/SHADOW_MODE_FORMS.md as a screen. The two forms are the two forms;
 * what changes is that the app's half of every figure is already filled in
 * from its own records, so the supervisor writes only what the app cannot
 * know — what the register said, who was right, why, and the minutes on
 * paper. The verdict at the top is the same arithmetic the rollout document
 * asks the supervisor and the DRM to do at the end of the week.
 *
 * "Who was right" is the important column. The app being wrong is a defect
 * to fix; the app being right is the case for using it. A log that only
 * captured the app's failures would quietly argue against itself.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api.ts';
import { can } from '../../../shared/auth/permissions.ts';
import { DISCREPANCY_CAUSES, WHO_WAS_RIGHT, VERDICT_WORDS } from '../../../shared/analysis/shadowRun.ts';
import type { User } from '../../../shared/types.ts';

interface Props { lang: 'en' | 'hi'; user: User | null }

const CAUSE_LABEL: Record<string, [string, string]> = {
  BAND_MISREAD: ['Band misread', 'बैंड गलत पढ़ा'],
  WRONG_SPRING: ['Wrong spring', 'गलत स्प्रिंग'],
  OFF_STRIP_JUDGEMENT: ['Off-strip judgement', 'स्ट्रिप से बाहर निर्णय'],
  CONFIGURATION: ['Configuration', 'विन्यास'],
  NEST_GROUPING: ['Nest grouping', 'नेस्ट समूहन'],
  APP_COULD_NOT_ANSWER: ['App could not answer', 'ऐप उत्तर नहीं दे सका'],
  DEVICE: ['Device', 'उपकरण'],
  OTHER: ['Other', 'अन्य']
};
const WHO_LABEL: Record<string, [string, string]> = {
  APP: ['The app', 'ऐप'],
  REGISTER: ['The register', 'रजिस्टर'],
  BOTH_WRONG: ['Both wrong', 'दोनों गलत'],
  UNRESOLVED: ['Unresolved', 'अनसुलझा']
};
const today = () => new Date().toISOString().slice(0, 10);
const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);
const rate = (r: { perHour: number | null; plausible: boolean }, hi: boolean) =>
  r.perHour === null ? '—' : r.plausible ? `${r.perHour} per hour` : (hi ? 'व्यक्ति की गति नहीं' : 'not a person\'s rate');

export const ShadowModePage: React.FC<Props> = ({ lang, user }) => {
  const isHi = lang === 'hi';
  const t = (en: string, hi: string) => (isHi ? hi : en);
  const mayRecord = can(user?.role, 'shadow.record');

  const [days, setDays] = useState(7);
  const [report, setReport] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const r = await api.getShadowReport(days);
      setReport(r.data);
    } catch (e: any) {
      setError(e?.message || 'Could not load the shadow run.');
    }
  }, [days]);
  useEffect(() => { void load(); }, [load]);

  // -- form 1: one line of the discrepancy log ---------------------------------
  const [d, setD] = useState<Record<string, any>>({ occurredOn: today(), shift: 'A', inspectorName: '', wagonNumber: '', location: '', registerSays: '', appSays: '', registerVerdict: 'PASS', appVerdict: 'PASS', whoWasRight: '', cause: '', why: '', wouldHaveStoppedAWagon: false });
  const setField = (k: string, v: any) => setD((x) => ({ ...x, [k]: v }));
  const submitDiscrepancy = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setNote(null);
    try {
      await api.recordShadowDiscrepancy(d);
      setNote(t('Recorded. It cannot be edited; a correction is another line pointing at this one.', 'दर्ज किया गया। इसे बदला नहीं जा सकता; सुधार एक नई पंक्ति है।'));
      setD((x) => ({ ...x, wagonNumber: '', location: '', registerSays: '', appSays: '', whoWasRight: '', cause: '', why: '', wouldHaveStoppedAWagon: false }));
      await load();
    } catch (err: any) {
      setNote(err?.message || 'Not recorded.');
    } finally { setSaving(false); }
  };

  // -- form 2: the shift summary ------------------------------------------------
  const [s, setS] = useState<Record<string, any>>({ summaryDate: today(), shift: 'A', registerMinutesOneWagon: '', appMinutesOneWagon: '', transcriptionErrorsBoxMissed: 0, whatAppGotWrong: '', whatAppCaught: '', whatSlowed: '', wouldHaveStoppedAWagon: '' });
  const setSum = (k: string, v: any) => setS((x) => ({ ...x, [k]: v }));
  const submitSummary = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setNote(null);
    try {
      await api.recordShadowSummary(s);
      setNote(t('Shift summary recorded.', 'शिफ्ट सारांश दर्ज।'));
      await load();
    } catch (err: any) {
      setNote(err?.message || 'Not recorded.');
    } finally { setSaving(false); }
  };

  const download = async () => {
    const csv = await api.exportShadowRun(60);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a'); a.href = url; a.download = `wrs-shadow-run-${today()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  if (error) return <div className="p-6 text-warn-ink text-sm">{error}</div>;
  if (!report) return <div className="p-6 text-ink-muted text-sm">{t('Loading the shadow run…', 'लोड हो रहा है…')}</div>;

  const v = report.verdict;
  const input = 'w-full bg-raised border border-line rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent-hover';
  const label = 'block text-[11px] font-semibold text-ink-body mb-1';

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6" data-testid="shadow-page">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-white">{t('Shadow run', 'छाया संचालन')}</h1>
          <p className="text-xs text-ink-muted mt-1 max-w-2xl">
            {t('The app beside the register. The register still governs; nothing the app says releases a wagon during this period. The app\'s half of every figure below is from its own records; the supervisor writes what it cannot know.',
               'रजिस्टर के साथ-साथ ऐप। इस अवधि में रजिस्टर ही मान्य है। नीचे ऐप का आधा हिस्सा उसके अपने रिकॉर्ड से है; पर्यवेक्षक वह लिखता है जो ऐप नहीं जान सकता।')}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <label className="text-ink-muted">{t('Last', 'पिछले')}</label>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="bg-raised border border-line rounded px-2 py-1 text-white">
            {[7, 14, 30, 60].map((n) => <option key={n} value={n}>{n} {t('days', 'दिन')}</option>)}
          </select>
          <button onClick={download} className="px-3 py-1.5 rounded-control border border-line text-ink-body hover:bg-raised font-semibold" data-testid="shadow-export">
            {t('Export the logs (CSV)', 'लॉग निर्यात (CSV)')}
          </button>
        </div>
      </header>

      {/* The verdict */}
      <section className={`rounded-card border p-5 ${v.blocking ? 'border-bad bg-bad-soft' : 'border-line bg-card'}`} data-testid="shadow-verdict">
        <h2 className="text-lg font-black text-white">{t('Reading the log', 'लॉग पढ़ना')}</h2>
        <p className="text-sm mt-1 font-bold text-white">
          {v.blocking
            ? t(`${v.appPassedRegisterCondemned} case(s) where the app said PASS and the register condemned. This alone blocks going live.`, `${v.appPassedRegisterCondemned} मामले जहाँ ऐप ने PASS कहा और रजिस्टर ने कंडम किया। यही अकेले लाइव जाने से रोकता है।`)
            : t('Zero cases where the app passed a spring the register condemned — the one non-negotiable.', 'शून्य मामले जहाँ ऐप ने रजिस्टर द्वारा कंडम स्प्रिंग को पास किया — एकमात्र अनिवार्य शर्त।')}
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 text-xs">
          <Stat label={t('Discrepancies', 'विसंगतियाँ')} value={String(v.discrepancies.total)} sub={t(`app right ${v.discrepancies.appRight} · register right ${v.discrepancies.registerRight} · both wrong ${v.discrepancies.bothWrong} · unresolved ${v.discrepancies.unresolved}`, `ऐप सही ${v.discrepancies.appRight} · रजिस्टर सही ${v.discrepancies.registerRight}`)} />
          <Stat label={t('Week on week', 'सप्ताह दर सप्ताह')} value={v.trend.previous7 === 0 ? `${v.trend.latest7}` : `${v.trend.previous7} → ${v.trend.latest7}`} sub={v.trend.falling === null ? t('no previous week yet', 'पिछला सप्ताह नहीं') : v.trend.falling ? t('falling', 'घट रहा') : t('not falling', 'नहीं घट रहा')} />
          <Stat label={t('Amber box answered', 'एम्बर बॉक्स उत्तरित')} value={pct(v.amber.answeredShare)} sub={t(`${v.amber.raised} raised · ${v.amber.reMeasured} re-measured · ${v.amber.stands} stands · ${v.amber.unanswered} unanswered`, `${v.amber.raised} उठे · ${v.amber.reMeasured} पुनः मापे · ${v.amber.stands} कायम · ${v.amber.unanswered} अनुत्तरित`)} />
          <Stat label={t('One wagon, both ways', 'एक वैगन, दोनों तरीके')} value={v.timing.pairs === 0 ? '—' : `${v.timing.medianRegisterMinutes} → ${v.timing.medianAppMinutes} min`} sub={v.timing.note} />
        </div>
        {v.findings.length > 0 && (
          <ul className="mt-4 space-y-1 text-xs text-ink-body list-disc pl-5">
            {v.findings.map((f: string, i: number) => <li key={i}>{f}</li>)}
          </ul>
        )}
        {report.anyImplausible && (
          <p className="mt-3 text-[11px] text-warn-ink font-bold">
            {t('At least one rate below is faster than a person can work: this database holds seeded or test records. Do not put these numbers in front of the DRM.', 'नीचे कम से कम एक दर व्यक्ति की क्षमता से तेज़ है: यह डेटाबेस परीक्षण रिकॉर्ड रखता है।')}
          </p>
        )}
      </section>

      {/* The app's half, day by day */}
      <section className="bg-card border border-line rounded-card p-5">
        <h2 className="text-lg font-black text-white">{t('What the app recorded, day by day', 'ऐप ने क्या दर्ज किया, दिन प्रति दिन')}</h2>
        <p className="text-[11px] text-ink-muted">{t(`Worked time excludes idle gaps over ${report.idleGapMinutes} minutes, and is an upper bound on effort.`, `${report.idleGapMinutes} मिनट से अधिक के अंतराल कार्य समय में नहीं गिने गए।`)}</p>
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-xs" data-testid="shadow-days">
            <thead><tr className="text-ink-muted text-[10px] uppercase tracking-wide">
              {[t('Day', 'दिन'), t('Wagons swept', 'वैगन'), t('Springs', 'स्प्रिंग'), t('Condemned', 'कंडम'), t('Nests flagged', 'नेस्ट'), t('Bench min', 'बेंच मिनट'), t('Springs/h', 'स्प्रिंग/घं'), t('Verdicts', 'निर्णय'), t('Amber raised', 'एम्बर'), t('Answered', 'उत्तरित'), t('Discrepancies', 'विसंगति')].map((h) => <th key={h} className="text-right first:text-left py-1.5 pr-2">{h}</th>)}
            </tr></thead>
            <tbody>
              {report.days.map((day: any) => (
                <tr key={day.date} className="border-t border-line tabular-nums">
                  <td className="py-1.5 pr-2 text-left text-white font-bold">{day.date}</td>
                  <td className="py-1.5 pr-2 text-right">{day.wagonsSwept}</td>
                  <td className="py-1.5 pr-2 text-right">{day.springsRecorded}</td>
                  <td className="py-1.5 pr-2 text-right">{day.springsCondemned}</td>
                  <td className="py-1.5 pr-2 text-right">{day.nestsFlagged}</td>
                  <td className="py-1.5 pr-2 text-right">{day.bench.workedMinutes}</td>
                  <td className={`py-1.5 pr-2 text-right ${day.bench.springsPerHour.plausible ? '' : 'text-warn-ink'}`}>{rate(day.bench.springsPerHour, isHi)}</td>
                  <td className="py-1.5 pr-2 text-right">{day.checklists.verdicts}</td>
                  <td className="py-1.5 pr-2 text-right">{day.amber.raised}</td>
                  <td className="py-1.5 pr-2 text-right">{day.amber.reMeasured + day.amber.stands}</td>
                  <td className="py-1.5 pr-2 text-right">{day.discrepanciesLogged}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {note && <p className="text-xs font-bold text-ink-body" data-testid="shadow-note">{note}</p>}

      {/* Form 1 */}
      <section className="bg-card border border-line rounded-card p-5">
        <h2 className="text-lg font-black text-white">{t('Form 1 — Discrepancy log', 'फ़ॉर्म 1 — विसंगति लॉग')}</h2>
        <p className="text-[11px] text-ink-muted">{t('One line per disagreement, written when it happens. "Who was right" is the important column.', 'प्रति असहमति एक पंक्ति। "कौन सही था" महत्वपूर्ण स्तंभ है।')}</p>
        {mayRecord && (
          <form onSubmit={submitDiscrepancy} className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3" data-testid="discrepancy-form">
            <div><label className={label}>{t('Date', 'तिथि')}</label><input type="date" className={input} value={d.occurredOn} onChange={(e) => setField('occurredOn', e.target.value)} required /></div>
            <div><label className={label}>{t('Shift', 'शिफ्ट')}</label><input className={input} value={d.shift} onChange={(e) => setField('shift', e.target.value)} required /></div>
            <div><label className={label}>{t('Inspector', 'निरीक्षक')}</label><input className={input} value={d.inspectorName} onChange={(e) => setField('inspectorName', e.target.value)} required /></div>
            <div><label className={label}>{t('Wagon', 'वैगन')}</label><input className={input} value={d.wagonNumber} onChange={(e) => setField('wagonNumber', e.target.value)} placeholder="SECR/BOXNHL/…" /></div>
            <div className="col-span-2"><label className={label}>{t('Bogie / position / spring no.', 'बोगी / स्थिति / स्प्रिंग सं.')}</label><input className={input} value={d.location} onChange={(e) => setField('location', e.target.value)} /></div>
            <div><label className={label}>{t('Register says', 'रजिस्टर कहता है')}</label><input className={input} value={d.registerSays} onChange={(e) => setField('registerSays', e.target.value)} required /></div>
            <div><label className={label}>{t('App says', 'ऐप कहता है')}</label><input className={input} value={d.appSays} onChange={(e) => setField('appSays', e.target.value)} required /></div>
            <div><label className={label}>{t('Register verdict', 'रजिस्टर निर्णय')}</label>
              <select className={input} value={d.registerVerdict} onChange={(e) => setField('registerVerdict', e.target.value)}>{VERDICT_WORDS.map((w) => <option key={w} value={w}>{w}</option>)}</select></div>
            <div><label className={label}>{t('App verdict', 'ऐप निर्णय')}</label>
              <select className={input} value={d.appVerdict} onChange={(e) => setField('appVerdict', e.target.value)}>{VERDICT_WORDS.map((w) => <option key={w} value={w}>{w}</option>)}</select></div>
            <div><label className={label}>{t('Who was right', 'कौन सही था')}</label>
              <select className={input} value={d.whoWasRight} onChange={(e) => setField('whoWasRight', e.target.value)} required data-testid="who-was-right">
                <option value="">{t('— choose —', '— चुनें —')}</option>
                {WHO_WAS_RIGHT.map((w) => <option key={w} value={w}>{WHO_LABEL[w][isHi ? 1 : 0]}</option>)}
              </select></div>
            <div><label className={label}>{t('Why they differed', 'क्यों भिन्न')}</label>
              <select className={input} value={d.cause} onChange={(e) => setField('cause', e.target.value)} required>
                <option value="">{t('— choose —', '— चुनें —')}</option>
                {DISCREPANCY_CAUSES.map((c) => <option key={c} value={c}>{CAUSE_LABEL[c][isHi ? 1 : 0]}</option>)}
              </select></div>
            <div className="col-span-2 md:col-span-3"><label className={label}>{t('Notes', 'टिप्पणी')}</label><input className={input} value={d.why} onChange={(e) => setField('why', e.target.value)} /></div>
            <div className="flex items-end gap-2">
              <label className="flex items-center gap-2 text-xs text-ink-body"><input type="checkbox" checked={d.wouldHaveStoppedAWagon} onChange={(e) => setField('wouldHaveStoppedAWagon', e.target.checked)} />{t('Would have stopped a wagon', 'वैगन रोक देता')}</label>
            </div>
            <div className="col-span-2 md:col-span-4 flex justify-end">
              <button type="submit" disabled={saving} className="px-4 py-2 rounded-control bg-accent text-white text-xs font-bold" data-testid="discrepancy-submit">{t('Record the discrepancy', 'विसंगति दर्ज करें')}</button>
            </div>
          </form>
        )}
        <div className="overflow-x-auto mt-4">
          <table className="w-full text-xs" data-testid="discrepancy-table">
            <thead><tr className="text-ink-muted text-[10px] uppercase tracking-wide">
              {[t('Date', 'तिथि'), t('Shift', 'शिफ्ट'), t('Inspector', 'निरीक्षक'), t('Wagon', 'वैगन'), t('Where', 'कहाँ'), t('Register', 'रजिस्टर'), t('App', 'ऐप'), t('Who was right', 'कौन सही'), t('Why', 'क्यों'), t('Stops a wagon', 'रोकता')].map((h) => <th key={h} className="text-left py-1.5 pr-2">{h}</th>)}
            </tr></thead>
            <tbody>
              {report.discrepancies.length === 0 && <tr><td colSpan={10} className="py-3 text-ink-muted">{t('Nothing logged yet.', 'अभी कुछ दर्ज नहीं।')}</td></tr>}
              {report.discrepancies.map((r: any) => (
                <tr key={r.id} className={`border-t border-line ${r.appVerdict === 'PASS' && r.registerVerdict === 'CONDEMNED' ? 'bg-bad-soft' : ''}`}>
                  <td className="py-1.5 pr-2">{r.occurredOn}</td><td className="py-1.5 pr-2">{r.shift}</td><td className="py-1.5 pr-2">{r.inspectorName}</td>
                  <td className="py-1.5 pr-2">{r.wagonNumber || '—'}</td><td className="py-1.5 pr-2">{r.location || '—'}</td>
                  <td className="py-1.5 pr-2">{r.registerSays} <span className="text-ink-faint">({r.registerVerdict})</span></td>
                  <td className="py-1.5 pr-2">{r.appSays} <span className="text-ink-faint">({r.appVerdict})</span></td>
                  <td className="py-1.5 pr-2 font-bold text-white">{WHO_LABEL[r.whoWasRight]?.[isHi ? 1 : 0] || r.whoWasRight}</td>
                  <td className="py-1.5 pr-2">{CAUSE_LABEL[r.cause]?.[isHi ? 1 : 0] || r.cause}{r.why ? ` — ${r.why}` : ''}</td>
                  <td className="py-1.5 pr-2">{r.wouldHaveStoppedAWagon ? t('yes', 'हाँ') : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Form 2 */}
      <section className="bg-card border border-line rounded-card p-5">
        <h2 className="text-lg font-black text-white">{t('Form 2 — Shift summary', 'फ़ॉर्म 2 — शिफ्ट सारांश')}</h2>
        <p className="text-[11px] text-ink-muted">{t('The app\'s counts for the day are in the table above. Write the register\'s half here. Time the register, not the app — the app\'s minutes come from its own timestamps.', 'ऐप की गिनती ऊपर की तालिका में है। यहाँ रजिस्टर का आधा लिखें।')}</p>
        {mayRecord && (
          <form onSubmit={submitSummary} className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3" data-testid="summary-form">
            <div><label className={label}>{t('Date', 'तिथि')}</label><input type="date" className={input} value={s.summaryDate} onChange={(e) => setSum('summaryDate', e.target.value)} required /></div>
            <div><label className={label}>{t('Shift', 'शिफ्ट')}</label><input className={input} value={s.shift} onChange={(e) => setSum('shift', e.target.value)} required /></div>
            <div><label className={label}>{t('Register: one wagon, minutes', 'रजिस्टर: एक वैगन, मिनट')}</label><input type="number" min={0} className={input} value={s.registerMinutesOneWagon} onChange={(e) => setSum('registerMinutesOneWagon', e.target.value)} /></div>
            <div><label className={label}>{t('App: same wagon, minutes (if timed by hand)', 'ऐप: वही वैगन, मिनट')}</label><input type="number" min={0} className={input} value={s.appMinutesOneWagon} onChange={(e) => setSum('appMinutesOneWagon', e.target.value)} /></div>
            <div className="col-span-2"><label className={label}>{t('Transcription errors the paper diff caught that the amber box did NOT raise', 'लिखने की त्रुटियाँ जो कागज़ ने पकड़ीं पर एम्बर बॉक्स ने नहीं')}</label><input type="number" min={0} className={input} value={s.transcriptionErrorsBoxMissed} onChange={(e) => setSum('transcriptionErrorsBoxMissed', e.target.value)} /></div>
            <div className="col-span-2 md:col-span-4"><label className={label}>{t('1. What did the app get wrong today?', '1. आज ऐप ने क्या गलत किया?')}</label><input className={input} value={s.whatAppGotWrong} onChange={(e) => setSum('whatAppGotWrong', e.target.value)} /></div>
            <div className="col-span-2 md:col-span-4"><label className={label}>{t('2. What did the app catch that the register would have missed?', '2. ऐप ने क्या पकड़ा जो रजिस्टर चूक जाता?')}</label><input className={input} value={s.whatAppCaught} onChange={(e) => setSum('whatAppCaught', e.target.value)} /></div>
            <div className="col-span-2 md:col-span-4"><label className={label}>{t('3. What slowed anyone down?', '3. किसी को क्या धीमा किया?')}</label><input className={input} value={s.whatSlowed} onChange={(e) => setSum('whatSlowed', e.target.value)} /></div>
            <div className="col-span-2 md:col-span-4"><label className={label}>{t('Anything that would have stopped a wagon leaving, and did not', 'कुछ ऐसा जो वैगन को जाने से रोकता, और नहीं रोका')}</label><input className={input} value={s.wouldHaveStoppedAWagon} onChange={(e) => setSum('wouldHaveStoppedAWagon', e.target.value)} /></div>
            <div className="col-span-2 md:col-span-4 flex justify-end">
              <button type="submit" disabled={saving} className="px-4 py-2 rounded-control bg-accent text-white text-xs font-bold" data-testid="summary-submit">{t('Record the shift summary', 'शिफ्ट सारांश दर्ज करें')}</button>
            </div>
          </form>
        )}
        <ul className="mt-4 space-y-2 text-xs" data-testid="summary-list">
          {report.summaries.length === 0 && <li className="text-ink-muted">{t('No shift summary yet.', 'अभी कोई शिफ्ट सारांश नहीं।')}</li>}
          {report.summaries.map((x: any) => (
            <li key={x.id} className="border border-line rounded-control p-3">
              <div className="font-bold text-white">{x.summaryDate} · {t('shift', 'शिफ्ट')} {x.shift} · {x.supervisorName || x.supervisorId}</div>
              <div className="text-ink-body mt-1">
                {t('Register', 'रजिस्टर')}: {x.registerMinutesOneWagon ?? '—'} min · {t('App', 'ऐप')}: {x.appMinutesOneWagon ?? '—'} min · {t('missed by the box', 'बॉक्स से छूटे')}: {x.transcriptionErrorsBoxMissed}
              </div>
              {x.whatAppGotWrong && <div className="text-ink-muted mt-1">1. {x.whatAppGotWrong}</div>}
              {x.whatAppCaught && <div className="text-ink-muted">2. {x.whatAppCaught}</div>}
              {x.whatSlowed && <div className="text-ink-muted">3. {x.whatSlowed}</div>}
              {x.wouldHaveStoppedAWagon && <div className="text-warn-ink font-bold mt-1">{x.wouldHaveStoppedAWagon}</div>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string; sub?: string }> = ({ label, value, sub }) => (
  <div className="rounded-control border border-line bg-raised p-3">
    <div className="text-[10px] uppercase tracking-wide text-ink-muted">{label}</div>
    <div className="text-xl font-black text-white tabular-nums mt-0.5">{value}</div>
    {sub && <div className="text-[10.5px] text-ink-faint mt-0.5">{sub}</div>}
  </div>
);
