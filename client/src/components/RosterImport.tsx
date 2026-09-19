/**
 * Roster import — the shop's list of people, pasted from a spreadsheet
 * Indian Railways WRS Raipur
 *
 * Forty names in Excel should be one confirmation, not forty. The
 * administrator pastes the columns (name, employee ID, role, and optionally
 * a username), sees exactly what will be created, confirms with the same
 * one-time code a single account needs, and gets a slip per person to print
 * and hand over. Passwords are generated on the server, shown once here,
 * and never stored in the clear.
 */

import React, { useMemo, useState } from 'react';
import { api } from '../services/api.ts';
import { ActionConfirm } from './ActionConfirm.tsx';

interface Row { fullName: string; employeeId: string; role: string; username?: string }
interface Created extends Row { username: string; password: string; line: number }

const ROLE_WORDS: Record<string, string> = {
  inspector: 'INSPECTOR', insp: 'INSPECTOR', 'निरीक्षक': 'INSPECTOR',
  supervisor: 'SUPERVISOR', sup: 'SUPERVISOR', sse: 'SUPERVISOR', 'पर्यवेक्षक': 'SUPERVISOR',
  drm: 'DRM', cwm: 'DRM', officer: 'DRM',
  admin: 'ADMIN', administrator: 'ADMIN', 'प्रशासक': 'ADMIN'
};

/** Tab-, comma- or semicolon-separated lines → rows. A header line is skipped if it looks like one. */
export function parseRoster(text: string): { rows: Row[]; skipped: string[] } {
  const rows: Row[] = []; const skipped: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim(); if (!line) continue;
    const cells = line.split(/\t|,|;/).map((c) => c.trim().replace(/^"|"$/g, ''));
    if (cells.length < 3) { skipped.push(line); continue; }
    if (/^(name|full ?name|नाम)$/i.test(cells[0])) continue;
    const roleKey = cells[2].toLowerCase();
    const role = ROLE_WORDS[roleKey] || (['INSPECTOR', 'SUPERVISOR', 'DRM', 'ADMIN'].includes(cells[2].toUpperCase()) ? cells[2].toUpperCase() : '');
    if (!role) { skipped.push(line); continue; }
    rows.push({ fullName: cells[0], employeeId: cells[1].toUpperCase(), role, username: cells[3] ? cells[3].toLowerCase() : undefined });
  }
  return { rows, skipped };
}

export const RosterImport: React.FC<{ lang: 'en' | 'hi'; onImported: () => void }> = ({ lang, onImported }) => {
  const isHi = lang === 'hi';
  const t = (en: string, hi: string) => (isHi ? hi : en);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<Array<{ line: number; message: string }>>([]);
  const [created, setCreated] = useState<Created[] | null>(null);
  const parsed = useMemo(() => parseRoster(text), [text]);

  const submit = async (otpToken: string) => {
    setBusy(true); setError(null); setProblems([]);
    try {
      const r = await api.importRoster(parsed.rows, otpToken);
      setCreated(r.data.created); setConfirming(false); setText(''); onImported();
    } catch (e: any) {
      setConfirming(false);
      if (e?.problems) setProblems(e.problems);
      setError(e?.message || 'The roster could not be imported.');
    } finally { setBusy(false); }
  };

  if (created) {
    return (
      <div className="rounded-card border border-good-line bg-card p-5 space-y-3 print:border-0" data-testid="roster-slips">
        <div className="flex items-start justify-between gap-3 print:hidden">
          <div>
            <h3 className="text-sm font-extrabold text-white">{t(`${created.length} accounts created`, `${created.length} खाते बने`)}</h3>
            <p className="text-[11px] text-ink-muted">{t('Each password is shown once. Print this page, cut the slips, hand each to its person. Closing this loses them.', 'हर पासवर्ड एक बार दिखता है। यह पृष्ठ प्रिंट करें, पर्चियाँ काटें, हर व्यक्ति को दें। बंद करने पर ये चले जाएँगे।')}</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => window.print()} className="min-h-[40px] px-4 rounded-control bg-accent text-white text-xs font-bold" data-testid="roster-print">{t('Print slips', 'पर्चियाँ प्रिंट करें')}</button>
            <button type="button" onClick={() => setCreated(null)} className="min-h-[40px] px-4 rounded-control border border-line text-xs font-bold text-ink-body">{t('Done', 'हो गया')}</button>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 print:grid-cols-2 gap-3">
          {created.map((c) => (
            <div key={c.username} className="rounded-control border border-dashed border-line-strong p-3 text-xs print:text-black print:border-black" data-testid="roster-slip">
              <div className="font-bold text-white print:text-black">{c.fullName} · {c.employeeId}</div>
              <div className="text-ink-muted print:text-black">{t('Role', 'भूमिका')}: {c.role}</div>
              <div className="mt-1 font-mono text-white print:text-black">{t('Username', 'उपयोगकर्ता नाम')}: <strong>{c.username}</strong></div>
              <div className="font-mono text-white print:text-black">{t('Password', 'पासवर्ड')}: <strong className="tracking-wider">{c.password}</strong></div>
              <div className="mt-1 text-[10px] text-ink-faint print:text-black">{t('Change it on first sign-in (key icon, top right).', 'पहली बार साइन-इन पर बदलें (ऊपर दाईं ओर चाबी)।')}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-card border border-line bg-card p-5 space-y-3" data-testid="roster-import">
      {confirming && (
        <ActionConfirm action="USER_MGMT" lang={lang}
          title={t(`Confirm creating ${parsed.rows.length} accounts`, `${parsed.rows.length} खाते बनाने की पुष्टि`)}
          description={t('Creating accounts grants access, so it needs the same confirmation a release does. Nothing is written until every row has been checked.', 'खाते बनाना अधिकार देना है, इसलिए पुष्टि आवश्यक है। हर पंक्ति की जाँच से पहले कुछ नहीं लिखा जाता।')}
          onConfirmed={submit} onCancel={() => setConfirming(false)} />
      )}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-extrabold text-white">{t('Import a roster', 'सूची से खाते बनाएँ')}</h3>
          <p className="text-[11px] text-ink-muted">{t('Three ways to create accounts: one at a time with the form above; paste the roster from a spreadsheet here (name, employee ID, role, optional username — one person per line); or open the CSV file the office keeps. Roles: inspector, supervisor, DRM, admin.', 'खाते बनाने के तीन तरीके: ऊपर के फ़ॉर्म से एक-एक; स्प्रेडशीट से सूची यहाँ चिपकाएँ (नाम, कर्मचारी आईडी, भूमिका, चाहें तो उपयोगकर्ता नाम — एक व्यक्ति प्रति पंक्ति); या दफ़्तर की CSV फ़ाइल खोलें।')}</p>
        </div>
        <button type="button" onClick={() => setOpen(!open)} className="min-h-[40px] px-4 rounded-control border border-accent-line bg-accent-soft text-accent-ink text-xs font-bold" data-testid="roster-toggle">{open ? t('Close', 'बंद करें') : t('Paste roster', 'सूची चिपकाएँ')}</button>
      </div>
      {open && (
        <>
          {/* Two ways in: paste from the spreadsheet, or open the CSV/TSV the office already keeps. One account at a time is the form above this panel. */}
          <label className="text-[11px] text-ink-muted flex flex-wrap items-center gap-2">
            {t('Or open a CSV / TSV / text file exported from Excel:', 'या Excel से निर्यात की गई CSV / TSV फ़ाइल खोलें:')}
            <input type="file" accept=".csv,.tsv,.txt" data-testid="roster-file" className="text-xs text-ink-body"
              onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setText(await f.text()); setOpen(true); } }} />
          </label>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} data-testid="roster-text"
            placeholder={'Ramesh Kumar\tWRS-INSP-1042\tinspector\nS. K. Verma\tWRS-SUP-2019\tsupervisor'}
            className="w-full bg-raised border border-line rounded-control px-3 py-2 text-xs font-mono text-white" />
          {parsed.rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]" data-testid="roster-preview">
                <thead><tr className="text-ink-muted text-left"><th className="py-1 pr-3">#</th><th className="py-1 pr-3">{t('Name', 'नाम')}</th><th className="py-1 pr-3">{t('Employee ID', 'कर्मचारी आईडी')}</th><th className="py-1 pr-3">{t('Role', 'भूमिका')}</th><th className="py-1">{t('Username', 'उपयोगकर्ता नाम')}</th></tr></thead>
                <tbody>{parsed.rows.map((r, i) => (
                  <tr key={i} className={`border-t border-line/60 ${problems.some((p) => p.line === i + 1) ? 'text-bad-ink' : 'text-ink-body'}`}>
                    <td className="py-1 pr-3">{i + 1}</td><td className="py-1 pr-3">{r.fullName}</td><td className="py-1 pr-3 font-mono">{r.employeeId}</td><td className="py-1 pr-3">{r.role}</td><td className="py-1 font-mono">{r.username || t('(from the name)', '(नाम से)')}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {parsed.skipped.length > 0 && <p className="text-[11px] text-warn-ink">{t(`${parsed.skipped.length} line(s) could not be read (need name, employee ID and a role):`, `${parsed.skipped.length} पंक्ति पढ़ी नहीं जा सकी:`)} {parsed.skipped.slice(0, 3).join(' · ')}</p>}
          {problems.length > 0 && <ul className="text-[11px] text-bad-ink list-disc pl-4" data-testid="roster-problems">{problems.map((p) => <li key={p.line}>{t('Line', 'पंक्ति')} {p.line}: {p.message}</li>)}</ul>}
          {error && <p className="text-xs text-bad-ink">{error}</p>}
          <button type="button" disabled={busy || parsed.rows.length === 0} onClick={() => setConfirming(true)} className="min-h-[40px] px-4 rounded-control bg-accent text-white text-xs font-bold disabled:opacity-50" data-testid="roster-create">
            {t(`Create ${parsed.rows.length} account(s)`, `${parsed.rows.length} खाते बनाएँ`)}
          </button>
        </>
      )}
    </div>
  );
};

export default RosterImport;
