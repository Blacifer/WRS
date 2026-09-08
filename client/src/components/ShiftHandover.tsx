/**
 * The shift, written down
 * Indian Railways WRS Raipur
 *
 * WHY THIS EXISTS
 * ---------------
 * The handover between shifts is a conversation at a bench, and what it
 * carries depends on who is tired. The records already exist — every spring,
 * every verdict, every override — and nobody reads them at six in the morning.
 *
 * This drafts a few plain sentences from those records. A model writes them
 * when one is reachable; a fixed template when not, so the note exists on a
 * LAN with no route out. Either way the supervisor reads it, changes what
 * they like, and records it under their own name. The draft is never stored.
 *
 * WHY THE FACTS ARE SHOWN BESIDE THE WORDS
 * ----------------------------------------
 * So the reader can check the sentence against the count without leaving the
 * screen. And when the model used a number the records do not contain, the
 * draft is thrown away, the template used, and this panel says so — a note
 * that quietly rounded nine condemned springs up to twelve is the failure
 * this feature must never commit.
 */

import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api.ts';
import { can } from '../../../shared/auth/permissions.ts';
import { Button } from './ui/index.tsx';

interface ShiftHandoverProps { lang: 'en' | 'hi'; }

type Draft = { shiftDate: string; facts: Record<string, number | string>; draft: string; source: 'MODEL' | 'TEMPLATE'; rejectedNumbers: string[] };
type Past = { id: string; shiftDate: string; body: string; draftSource: string; edited: boolean; recordedByName: string; createdAt: string };

const FACT_LABELS: Record<string, [string, string]> = {
  springsSorted: ['Springs sorted', 'स्प्रिंग छाँटे'],
  springsCondemned: ['Condemned', 'निंदित'],
  sortingInspectors: ['Inspectors at the bench', 'बेंच पर निरीक्षक'],
  checklistVerdicts: ['Checklist verdicts', 'चेकलिस्ट निर्णय'],
  wagonsTouched: ['Wagons touched', 'वैगन छुए'],
  defectsFound: ['Defects found', 'दोष मिले'],
  supervisorOverrides: ['Supervisor overrides', 'पर्यवेक्षक ओवरराइड'],
  acousticDefects: ['Acoustic defects', 'ध्वनि दोष'],
  gateSignoffs: ['Gate sign-offs', 'गेट हस्ताक्षर'],
  wagonsReleased: ['Wagons released', 'वैगन जारी']
};

export const ShiftHandover: React.FC<ShiftHandoverProps> = ({ lang }) => {
  const isHi = lang === 'hi';
  const [draft, setDraft] = useState<Draft | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [past, setPast] = useState<Past[]>([]);

  const loadPast = useCallback(() => {
    api.getShiftHandovers(5).then((r) => setPast(r.data || [])).catch(() => setPast([]));
  }, []);
  useEffect(() => { loadPast(); }, [loadPast]);

  const role = api.getUser()?.role;
  const mayRecord = can(role, 'wagon.release');
  if (!can(role, 'wagon.view')) return null;

  const makeDraft = async () => {
    setBusy(true); setError(null); setSaved(null);
    try {
      const r = await api.draftShiftHandover();
      setDraft(r.data);
      setText(r.data.draft);
    } catch (err: any) {
      setError(err?.message || (isHi ? 'ड्राफ़्ट नहीं बन सका।' : 'The draft could not be made.'));
    } finally { setBusy(false); }
  };

  const record = async () => {
    if (!draft) return;
    setBusy(true); setError(null);
    try {
      await api.recordShiftHandover({
        shiftDate: draft.shiftDate, body: text.trim(), draftSource: draft.source, edited: text.trim() !== draft.draft.trim()
      });
      setSaved(draft.shiftDate);
      setDraft(null); setText('');
      loadPast();
    } catch (err: any) {
      setError(err?.message || (isHi ? 'दर्ज नहीं हो सका।' : 'It could not be recorded.'));
    } finally { setBusy(false); }
  };

  return (
    <section className="bg-card border border-line rounded-card p-5 space-y-4" data-testid="shift-handover">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-black text-white">{isHi ? 'शिफ़्ट हैंडओवर' : 'Shift handover'}</h2>
          <p className="text-xs text-ink-muted mt-0.5">
            {isHi
              ? 'आज के रिकॉर्ड से कुछ वाक्य। पढ़ें, बदलें, अपने नाम से दर्ज करें।'
              : 'A few sentences from today’s own records. Read it, change it, record it under your name.'}
          </p>
        </div>
        {mayRecord && (
          <Button variant="primary" onClick={makeDraft} disabled={busy} data-testid="handover-draft">
            {busy && !draft ? (isHi ? 'लिखा जा रहा है…' : 'Drafting…') : (isHi ? 'आज का ड्राफ़्ट बनाएँ' : 'Draft from today’s records')}
          </Button>
        )}
      </div>

      {error && <div className="rounded-control border border-bad-line bg-bad-soft p-3 text-xs font-bold text-bad-ink">{error}</div>}
      {saved && (
        <div className="rounded-control border border-good-line bg-good-soft p-3 text-xs font-bold text-good-ink" data-testid="handover-saved">
          {isHi ? `${saved} का हैंडओवर दर्ज हो गया।` : `Handover for ${saved} recorded.`}
        </div>
      )}

      {draft && (
        <div className="space-y-3" data-testid="handover-editor">
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-ink-muted">
            <span>{draft.shiftDate}</span>
            <span className="px-2 py-0.5 rounded bg-raised border border-line">
              {draft.source === 'MODEL'
                ? (isHi ? 'मॉडल ने लिखा — जाँचें' : 'Drafted by the model — check it')
                : (isHi ? 'टेम्पलेट से — केवल दिए गए आँकड़े' : 'From the template — only the figures given')}
            </span>
          </div>

          {draft.rejectedNumbers.length > 0 && (
            <div className="rounded-control border border-warn-line bg-warn-soft p-3 text-[11px] text-warn-ink" data-testid="handover-guard">
              {isHi
                ? `मॉडल के ड्राफ़्ट में ऐसे अंक थे जो रिकॉर्ड में नहीं हैं (${draft.rejectedNumbers.join(', ')}), इसलिए उसे हटाकर टेम्पलेट रखा गया।`
                : `The model’s draft used figures the records do not contain (${draft.rejectedNumbers.join(', ')}). It was discarded and the template used instead.`}
            </div>
          )}

          {/* The counts, beside the words, so a sentence can be checked without leaving. */}
          <dl className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {Object.entries(FACT_LABELS).map(([k, [en, hi]]) => (
              <div key={k} className="rounded-control border border-line bg-raised px-3 py-2">
                <dt className="text-[10px] uppercase tracking-wide text-ink-faint">{isHi ? hi : en}</dt>
                <dd className="text-base font-black text-white tabular-nums">{String(draft.facts[k] ?? 0)}</dd>
              </div>
            ))}
          </dl>

          <textarea
            data-testid="handover-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            className="w-full bg-page border border-line rounded-control px-3 py-2 text-sm text-white leading-relaxed"
          />
          <div className="flex gap-2">
            <Button variant="primary" onClick={record} disabled={busy || text.trim().length < 20} data-testid="handover-record">
              {isHi ? 'हैंडओवर दर्ज करें' : 'Record handover'}
            </Button>
            <Button onClick={() => { setDraft(null); setText(''); }} disabled={busy}>{isHi ? 'रद्द' : 'Discard'}</Button>
          </div>
        </div>
      )}

      {past.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-line">
          <p className="text-[11px] font-bold uppercase tracking-wide text-ink-muted">{isHi ? 'पिछले हैंडओवर' : 'Previous handovers'}</p>
          {past.map((p) => (
            <div key={p.id} className="rounded-control border border-line bg-raised p-3" data-testid="handover-past">
              <div className="flex flex-wrap justify-between gap-2 text-[10px] font-mono text-ink-faint">
                <span>{p.shiftDate} · {p.recordedByName}</span>
                <span>{p.draftSource === 'MODEL' ? (isHi ? 'मॉडल' : 'model') : (isHi ? 'टेम्पलेट' : 'template')}{p.edited ? (isHi ? ' · संपादित' : ' · edited') : ''}</span>
              </div>
              <p className="text-xs text-ink-body mt-1 leading-relaxed">{p.body}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

export default ShiftHandover;
