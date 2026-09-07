/**
 * The shop's own checklist
 * Indian Railways WRS Raipur
 *
 * WHY THIS EXISTS
 * ---------------
 * On 22 August fourteen MANDATORY coupler checks were added to this system
 * from photographs of the shop's Mark-50 gauge boards. On 27 August they were
 * withdrawn: WRS Raipur does not overhaul MK-50 any more and holds none of
 * those gauges. Every one of the fourteen was permanently incompletable, so
 * every wagon's exit gate was permanently blocked, and the only way past would
 * have been a supervisor clearing the whole list — which turns the exception
 * into the normal path and hollows out the gate entirely.
 *
 * For five days the only remedy was a code change. That is the real fault: a
 * safety checklist has to be correctable by the people who do the work, on the
 * day they discover it is wrong. The API to do that has existed from the
 * beginning and had no screen at all.
 *
 * WHY A SOURCE IS COMPULSORY
 * --------------------------
 * A cited source does not make a check correct. It makes it answerable —
 * somebody can go and read the clause, and disagree with it. A check nobody
 * can trace is a check nobody can challenge, and on a safety list that is
 * worse than not having it. The board on the wall was real; what it did not
 * say was whether the shop still does that work.
 */

import { useEffect, useState } from 'react';
import { api } from '../services/api.ts';

interface ChecklistConfigPageProps {
  lang: 'en' | 'hi';
}

interface ConfigRow {
  id: string;
  wagon_type: string;
  category: string;
  part_name: string;
  bogie_position: string;
  is_mandatory: number;
  standard_reference: string | null;
  /** Present only on rows served from the code template rather than the table. */
  is_default?: number;
}

const CATEGORIES = [
  'SPRINGS', 'WHEELS_AXLES', 'BEARINGS', 'BRAKE_SYSTEM',
  'COUPLERS_DRAFT_GEAR', 'BOGIE_FRAME_BOLSTER', 'BODY_UNDERFRAME', 'GENERAL_WAGON'
];

const POSITIONS = ['BOGIE_1', 'BOGIE_2', 'UNDERFRAME', 'BODY', 'NONE'];

const WAGON_TYPES = ['BOXNHL', 'BOXN', 'BCNHL', 'BOBRN', 'BOSTHS', 'BRN'];

export const ChecklistConfigPage: React.FC<ChecklistConfigPageProps> = ({ lang }) => {
  const isHi = lang === 'hi';
  const t = (en: string, hi: string) => (isHi ? hi : en);

  const [wagonType, setWagonType] = useState('BOXNHL');
  const [rows, setRows] = useState<ConfigRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [draft, setDraft] = useState({
    category: 'COUPLERS_DRAFT_GEAR',
    partName: '',
    bogiePosition: 'BODY',
    isMandatory: true,
    standardReference: ''
  });

  const load = async (type: string) => {
    setError(null);
    try {
      const res = await api.getChecklistConfig(type);
      setRows(res.data || []);
    } catch (err: any) {
      setError(err.message || 'Could not load the checklist');
      setRows([]);
    }
  };

  useEffect(() => { void load(wagonType); }, [wagonType]);

  const save = async () => {
    if (!draft.partName.trim()) {
      setError(t('Name the part.', 'पुर्जे का नाम दें।'));
      return;
    }
    if (!draft.standardReference.trim()) {
      setError(t(
        'Cite where this check comes from — the manual clause, the RDSO specification, or the gauge board.',
        'यह जाँच कहाँ से आई है, वह लिखें — मैनुअल का खंड, RDSO विनिर्देश, या गेज बोर्ड।'
      ));
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.upsertChecklistConfig({
        wagonType,
        category: draft.category,
        partName: draft.partName.trim(),
        bogiePosition: draft.bogiePosition,
        isMandatory: draft.isMandatory,
        standardReference: draft.standardReference.trim()
      });
      setNotice(t(
        `"${draft.partName.trim()}" saved. Wagons registered from now on will be checked against it.`,
        `"${draft.partName.trim()}" सहेजा गया।`
      ));
      setDraft({ ...draft, partName: '', standardReference: '' });
      await load(wagonType);
    } catch (err: any) {
      setError(err.message || 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const retire = async (row: ConfigRow) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.retireChecklistConfig({
        wagonType: row.wagon_type,
        category: row.category,
        partName: row.part_name,
        bogiePosition: row.bogie_position
      });
      setNotice(res.message);
      await load(wagonType);
    } catch (err: any) {
      setError(err.message || 'Could not retire that item');
    } finally {
      setBusy(false);
    }
  };

  if (!rows) return null;

  /*
   * Whether this wagon type is still on the standard template, or the shop has
   * taken it over. It matters: until the first edit the list comes from the
   * application, and after it the list is the shop's and no longer changes
   * when the application does.
   */
  const onTemplate = rows.length > 0 && rows.every((r) => r.is_default === 1);

  return (
    <div className="space-y-5">
      <section className="bg-card border border-line rounded-card p-6 space-y-3">
        <h2 className="text-xl font-black text-white">
          {t('The checklist for this wagon type', 'इस वैगन प्रकार की जाँच सूची')}
        </h2>
        <p className="text-xs text-ink-muted leading-relaxed max-w-3xl">
          {t(
            'This is what every wagon of this type is checked against when it is registered. Change it here when the shop\'s work changes — when a component stops being overhauled, or a new gauge arrives — rather than waiting for a software update.',
            'पंजीकरण के समय इस प्रकार के हर वैगन की जाँच इसी सूची से होती है। जब शॉप का काम बदले, तब इसे यहीं बदलें।'
          )}
        </p>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {WAGON_TYPES.map((wt) => (
            <button
              key={wt}
              onClick={() => setWagonType(wt)}
              className={`min-h-[40px] px-3 rounded-control border text-xs font-bold transition ${
                wagonType === wt
                  ? 'border-accent-line bg-accent-soft text-accent-ink'
                  : 'border-line bg-raised text-ink-muted hover:text-ink-body'
              }`}
            >
              {wt}
            </button>
          ))}
        </div>

        <div className={`rounded-control border p-3 ${onTemplate ? 'border-line bg-raised' : 'border-good-line bg-good-soft'}`}>
          <p className="text-xs font-bold text-white">
            {onTemplate
              ? t(`${rows.length} items, from the standard template.`, `${rows.length} मद, मानक टेम्पलेट से।`)
              : t(`${rows.length} items — this list belongs to the shop.`, `${rows.length} मद — यह सूची शॉप की है।`)}
          </p>
          <p className="text-[11px] text-ink-body mt-1 leading-snug">
            {onTemplate
              ? t(
                  'The first item you add copies this template in, so the whole list becomes yours to edit. Nothing is lost by editing — but from then on the list no longer changes when the application does.',
                  'आपका पहला मद जोड़ते ही यह पूरी सूची शॉप की हो जाती है।'
                )
              : t(
                  'Standard items can now be retired as well as added. Wagons already registered keep the checklist they were given.',
                  'अब मानक मद भी हटाए जा सकते हैं। पहले से पंजीकृत वैगन अपनी सूची रखते हैं।'
                )}
          </p>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="bg-card border border-line rounded-card p-6 space-y-3">
        <h3 className="text-sm font-black text-white">{t('Add a check', 'जाँच जोड़ें')}</h3>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="text-[11px] font-bold text-ink-muted">{t('Category', 'श्रेणी')}</span>
            <select
              value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value })}
              className="w-full min-h-[44px] mt-1 bg-raised border border-line rounded-control px-3 text-sm text-white"
            >
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>

          <label className="block">
            <span className="text-[11px] font-bold text-ink-muted">{t('Position', 'स्थिति')}</span>
            <select
              value={draft.bogiePosition}
              onChange={(e) => setDraft({ ...draft, bogiePosition: e.target.value })}
              className="w-full min-h-[44px] mt-1 bg-raised border border-line rounded-control px-3 text-sm text-white"
            >
              {POSITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>

          <label className="block md:col-span-2">
            <span className="text-[11px] font-bold text-ink-muted">{t('Part', 'पुर्जा')}</span>
            <input
              data-testid="config-part-name"
              value={draft.partName}
              onChange={(e) => setDraft({ ...draft, partName: e.target.value })}
              placeholder={t('e.g. Draft Gear Housing Wall Thickness', 'जैसे ड्राफ्ट गियर हाउसिंग')}
              className="w-full min-h-[44px] mt-1 bg-raised border border-line rounded-control px-3 text-sm text-white"
            />
          </label>

          <label className="block md:col-span-2">
            <span className="text-[11px] font-bold text-ink-muted">
              {t('Where this comes from — required', 'यह कहाँ से आया — आवश्यक')}
            </span>
            <input
              data-testid="config-source"
              value={draft.standardReference}
              onChange={(e) => setDraft({ ...draft, standardReference: e.target.value })}
              placeholder={t('e.g. RDSO STR 49-BD-08, or WMM 2.0 §720-C', 'जैसे RDSO STR 49-BD-08')}
              className="w-full min-h-[44px] mt-1 bg-raised border border-line rounded-control px-3 text-sm text-white"
            />
            <span className="text-[10.5px] text-ink-muted mt-1 block leading-snug">
              {t(
                'A source does not make a check right. It makes it answerable — somebody can read the clause and disagree with it.',
                'स्रोत जाँच को सही नहीं बनाता — वह उसे जवाबदेह बनाता है।'
              )}
            </span>
          </label>
        </div>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={draft.isMandatory}
            onChange={(e) => setDraft({ ...draft, isMandatory: e.target.checked })}
            className="w-4 h-4"
          />
          <span className="text-xs text-ink-body">
            {t('Mandatory — a wagon cannot be released with this outstanding', 'अनिवार्य — इसके बिना वैगन रिलीज़ नहीं होगा')}
          </span>
        </label>

        {error && (
          <div className="rounded-control border border-bad-line bg-bad-soft px-3 py-2">
            <p className="text-xs font-bold text-bad-ink">{error}</p>
          </div>
        )}
        {notice && (
          <div className="rounded-control border border-good-line bg-good-soft px-3 py-2">
            <p className="text-xs font-bold text-good-ink">{notice}</p>
          </div>
        )}

        <button
          data-testid="config-save"
          onClick={() => void save()}
          disabled={busy}
          className="min-h-[44px] px-5 rounded-control bg-accent hover:bg-accent-hover text-white text-sm font-bold disabled:opacity-50"
        >
          {busy ? t('Saving…', 'सहेजा जा रहा है…') : t('Save this check', 'यह जाँच सहेजें')}
        </button>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="bg-card border border-line rounded-card p-6 space-y-3">
        <h3 className="text-sm font-black text-white">
          {t(`What a ${wagonType} is checked against`, `${wagonType} की जाँच सूची`)}
        </h3>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-ink-muted text-[10px] uppercase tracking-wide">
                <th className="text-left py-1.5">{t('Part', 'पुर्जा')}</th>
                <th className="text-left py-1.5">{t('Category', 'श्रेणी')}</th>
                <th className="text-left py-1.5">{t('Position', 'स्थिति')}</th>
                <th className="text-left py-1.5">{t('Source', 'स्रोत')}</th>
                <th className="text-right py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="py-1.5 pr-3">
                    <span className="font-bold text-white">{r.part_name}</span>
                    {!r.is_mandatory && (
                      <span className="ml-2 text-[9px] font-mono uppercase text-ink-muted">
                        {t('advisory', 'सलाह')}
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-3 text-ink-body font-mono text-[10px]">{r.category}</td>
                  <td className="py-1.5 pr-3 text-ink-muted font-mono text-[10px]">{r.bogie_position}</td>
                  <td className="py-1.5 pr-3 text-ink-body">
                    {r.standard_reference || (
                      <span className="text-warn-ink">{t('no source recorded', 'स्रोत दर्ज नहीं')}</span>
                    )}
                  </td>
                  <td className="py-1.5 text-right">
                    {r.is_default ? (
                      <span className="text-[10px] text-ink-muted">{t('template', 'टेम्पलेट')}</span>
                    ) : (
                      <button
                        onClick={() => void retire(r)}
                        disabled={busy}
                        className="text-[11px] font-bold text-bad-ink hover:underline disabled:opacity-50"
                      >
                        {t('Retire', 'हटाएँ')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-[11px] text-ink-muted leading-relaxed border-t border-line pt-3">
          {t(
            'Retiring a check stops it appearing on wagons registered afterwards. Wagons already in the shop keep the checklist they were given — a wagon is inspected against the rules that applied when it arrived.',
            'हटाई गई जाँच आगे पंजीकृत वैगनों पर नहीं आएगी। पहले से मौजूद वैगन अपनी सूची रखते हैं।'
          )}
        </p>
      </section>
    </div>
  );
};

export default ChecklistConfigPage;
