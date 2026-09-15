/**
 * The wagon passport, on the wagon's page
 * Indian Railways WRS Raipur
 *
 * Two directions. OUT: once this shop has finished with a wagon, the sealed
 * file it will carry to its next overhaul — every stage timestamp, spring
 * height, verdict, part off and on, photograph hash, the signoff and the
 * certificate's own signature — hash-linked and signed by this shop's key.
 * IN: a wagon arriving with the file its last shop sealed. It is verified
 * on this server against the key inside it, kept whole, and shown here as
 * the previous shop's record beside this shop's. Nothing is merged.
 *
 * Whether the key is that shop's is a question this screen answers only
 * half of: it says whether it is THIS server's key. For another shop's,
 * compare the fingerprint with the one that shop publishes.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api.ts';
import { can } from '../../../shared/auth/permissions.ts';

interface Props { wagonNumber: string; released: boolean; lang: 'en' | 'hi' }

const KIND_LABEL: Record<string, [string, string]> = {
  REGISTERED: ['Registered', 'दर्ज'],
  STAGE_TRANSITION: ['Stage', 'चरण'],
  SPRING_INSPECTION: ['Spring', 'स्प्रिंग'],
  CHECKLIST_VERDICT: ['Verdict', 'निर्णय'],
  PART_EVENT: ['Part', 'पुर्जा'],
  SINGLE_WAGON_TEST: ['Brake test', 'ब्रेक परीक्षण'],
  PHOTO: ['Photograph', 'फ़ोटो'],
  GATE_SIGNOFF: ['Gate sign-off', 'द्वार हस्ताक्षर'],
  CERTIFICATE: ['Certificate', 'प्रमाणपत्र']
};

function summarise(e: any): string {
  const p = e.payload || {};
  switch (e.kind) {
    case 'REGISTERED': return `${p.wagonType} · ${p.owningRailway}`;
    case 'STAGE_TRANSITION': return `${p.fromStage} → ${p.toStage} (${p.performerName})`;
    case 'SPRING_INSPECTION': return `${p.springPosition} ${p.measuredHeightMm} mm → ${p.classifiedBand || ''} ${p.status} (${p.inspectorName})`;
    case 'CHECKLIST_VERDICT': return `${p.partName} · ${p.status}${p.repairAction ? ` · ${p.repairAction}` : ''}${p.verdictBy ? ` (${p.verdictBy})` : ''}`;
    case 'PART_EVENT': return `${p.event} · ${p.partName}${p.reason ? ` — ${p.reason}` : ''}`;
    case 'SINGLE_WAGON_TEST': return `${p.passed ? 'PASS' : 'FAIL'} · ${p.pipeType}/${p.loadCondition}${p.failedRefs?.length ? ` · failed ${p.failedRefs.join(',')}` : ''}`;
    case 'PHOTO': return `${p.partName || ''} · ${p.evidenceStage || ''} · sha256 ${String(p.sha256 || '').slice(0, 12)}`;
    case 'GATE_SIGNOFF': return `${p.certificateNumber} · ${p.supervisorName}`;
    case 'CERTIFICATE': return `${p.certificateNumber} · ${p.algorithm}`;
    default: return JSON.stringify(p).slice(0, 80);
  }
}

export const WagonPassport: React.FC<Props> = ({ wagonNumber, released, lang }) => {
  const isHi = lang === 'hi';
  const t = (en: string, hi: string) => (isHi ? hi : en);
  const role = api.getUser()?.role;
  const mayExport = can(role, 'certificate.export');
  const mayImport = can(role, 'wagon.release');
  const [passports, setPassports] = useState<any[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setPassports((await api.getWagonPassports(wagonNumber)).data); } catch { setPassports([]); }
  }, [wagonNumber]);
  useEffect(() => { void load(); }, [load]);

  const exportPassport = async () => {
    try {
      const jsonl = await api.exportWagonPassport(wagonNumber);
      const url = URL.createObjectURL(new Blob([jsonl], { type: 'application/x-ndjson' }));
      const a = document.createElement('a'); a.href = url; a.download = `${wagonNumber.replace(/[^A-Za-z0-9]+/g, '_')}.passport.jsonl`; a.click();
      URL.revokeObjectURL(url);
      setNote(t(`Passport exported: ${jsonl.split('\n').filter(Boolean).length - 2} events, sealed by this shop's key. Verify it anywhere at /verify.html.`, `पासपोर्ट निर्यात हुआ। /verify.html पर कहीं भी सत्यापित करें।`));
    } catch (e: any) { setNote(e?.message || 'Could not export.'); }
  };

  const importPassport = async () => {
    if (!text.trim()) return;
    try {
      const r = await api.importWagonPassport(text);
      const d = r.data;
      setNote(d.alreadyImported
        ? t('This passport was already imported.', 'यह पासपोर्ट पहले से आयातित है।')
        : t(`Verified and kept: ${d.events} events from ${d.issuer}, key ${d.keyFingerprint}${d.issuedByThisServer ? ' (this shop\'s own key)' : ' — compare this fingerprint with the one that shop publishes'}.`,
            `सत्यापित और सुरक्षित: ${d.events} घटनाएँ, ${d.issuer} से।`));
      setText('');
      await load();
    } catch (e: any) { setNote(e?.message || 'Not imported.'); }
  };

  return (
    <section className="space-y-4" data-testid="wagon-passport">
      <div className="bg-card border border-line rounded-card p-5 space-y-3">
        <h3 className="text-base font-black text-white">{t('Passport', 'पासपोर्ट')}</h3>
        <p className="text-[11px] text-ink-muted">
          {t('A file the wagon carries to its next overhaul: everything this shop recorded, hash-linked and signed by this shop\'s key, verifiable by anyone at /verify.html without this server. No photograph bytes travel — only their hashes.',
             'एक फ़ाइल जो वैगन अगली ओवरहॉल तक ले जाता है: इस दुकान का पूरा रिकॉर्ड, हैश-श्रृंखलित और हस्ताक्षरित; /verify.html पर बिना सर्वर के सत्यापन योग्य।')}
        </p>
        {mayExport && (
          <button onClick={exportPassport} data-testid="passport-export" className="px-4 py-2 rounded-control bg-accent text-white text-xs font-bold">
            {released ? t('Export the passport', 'पासपोर्ट निर्यात करें') : t('Export the passport so far', 'अब तक का पासपोर्ट निर्यात करें')}
          </button>
        )}
        {note && <p className="text-xs font-bold text-ink-body" data-testid="passport-note">{note}</p>}
      </div>

      {mayImport && (
        <div className="bg-card border border-line rounded-card p-5 space-y-2">
          <h3 className="text-base font-black text-white">{t('Arrived with a passport?', 'पासपोर्ट के साथ आया?')}</h3>
          <p className="text-[11px] text-ink-muted">{t('Paste the file\'s text, or open it. It is verified against the key inside it before anything is kept, and refused with every reason if it does not verify.', 'फ़ाइल का पाठ चिपकाएँ या खोलें। रखने से पहले इसके अंदर की कुंजी से सत्यापित किया जाता है।')}</p>
          <input type="file" accept=".jsonl,.txt,.json" className="text-xs text-ink-body" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); }} />
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} data-testid="passport-import-text" placeholder='{"type":"PASSPORT",…' className="w-full bg-raised border border-line rounded-lg px-3 py-2 text-[11px] font-mono text-white" />
          <button onClick={importPassport} disabled={!text.trim()} data-testid="passport-import" className="px-4 py-2 rounded-control border border-line text-ink-body hover:bg-raised text-xs font-bold disabled:opacity-50">
            {t('Verify and keep', 'सत्यापित करें और रखें')}
          </button>
        </div>
      )}

      <div className="bg-card border border-line rounded-card p-5 space-y-3" data-testid="previous-shops">
        <h3 className="text-base font-black text-white">{t('What previous shops recorded', 'पिछली दुकानों ने क्या दर्ज किया')}</h3>
        {passports === null ? null : passports.length === 0 ? (
          <p className="text-xs text-ink-muted">{t('No passport has been imported for this wagon.', 'इस वैगन के लिए कोई पासपोर्ट आयात नहीं हुआ।')}</p>
        ) : passports.map((p) => (
          <div key={p.id} className="border border-line rounded-control p-3 text-xs">
            <button type="button" onClick={() => setOpen(open === p.id ? null : p.id)} className="w-full text-left">
              <div className="font-bold text-white">{p.issuer} · {p.events.length} {t('events', 'घटनाएँ')} · {t('exported', 'निर्यात')} {String(p.exportedAt).slice(0, 10)}</div>
              <div className="text-[11px] text-ink-muted mt-0.5">
                {t('Key', 'कुंजी')} <code>{p.keyFingerprint}</code>{p.issuedByThisServer ? t(' — this shop\'s own key', ' — इसी दुकान की कुंजी') : t(' — another shop\'s; compare with what they publish', ' — दूसरी दुकान की')} ·
                {p.verifiesNow ? t(' verifies now', ' अभी सत्यापित') : t(' DOES NOT VERIFY NOW', ' अभी सत्यापित नहीं')} · {t('imported by', 'आयातकर्ता')} {p.importedBy}
              </div>
            </button>
            {open === p.id && (
              <table className="mt-2 w-full text-[11px]">
                <tbody>
                  {p.events.map((e: any) => (
                    <tr key={e.seq} className="border-t border-line/60">
                      <td className="py-1 pr-2 text-ink-faint">{e.seq}</td>
                      <td className="py-1 pr-2 text-ink-muted whitespace-nowrap">{String(e.at).replace('T', ' ').slice(0, 16)}</td>
                      <td className="py-1 pr-2 text-white font-bold whitespace-nowrap">{KIND_LABEL[e.kind]?.[isHi ? 1 : 0] || e.kind}</td>
                      <td className="py-1 text-ink-body">{summarise(e)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}
      </div>
    </section>
  );
};
