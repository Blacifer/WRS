/**
 * Wheel readings — the chalk on the wheel disc, typed once and judged
 * Indian Railways WRS Raipur
 *
 * On the floor the tread diameter is chalked on the wheel ("980.65 / 24")
 * and recorded nowhere else. This is the same number, typed once per wheel,
 * judged as it is typed against the limits for this wagon's wheel family
 * (shared/classification/wheelLimits.ts — the same code the server runs) and
 * then recorded with the verdict it earned. The inspector types what the
 * gauge read; the limit is never on the screen as something to choose.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api.ts';
import { judgeWheel, judgeWheelSet, WHEEL_DIAMETER_LIMITS, WHEEL_PROFILE_LIMITS, type WheelFamily } from '../../../shared/classification/wheelLimits.ts';

interface Props { wagonNumber: string; lang: 'en' | 'hi'; canRecord: boolean; onRecorded?: () => void }

const AXLES = [1, 2, 3, 4] as const;
const SIDES = ['L', 'R'] as const;

export const WheelReadings: React.FC<Props> = ({ wagonNumber, lang, canRecord, onRecorded }) => {
  const isHi = lang === 'hi';
  const t = (en: string, hi: string) => (isHi ? hi : en);
  const [summary, setSummary] = useState<any>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(() => { api.getWheelReadings(wagonNumber).then((r) => setSummary(r.data)).catch(() => setSummary(null)); }, [wagonNumber]);
  useEffect(() => { load(); }, [load]);

  if (!summary) return null;
  const family: WheelFamily | null = summary.family;
  const limits = family ? WHEEL_DIAMETER_LIMITS[family] : null;
  const wheelsByKey = new Map<string, any>((summary.wheels || []).map((w: any) => [`${w.axle}${w.side}`, w]));
  const num = (k: string) => { const v = form[k]; if (v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
  const live = num('treadDiameterMm') !== null
    ? judgeWheel(family, { treadDiameterMm: num('treadDiameterMm')!, flangeThicknessMm: num('flangeThicknessMm'), flangeHeightMm: num('flangeHeightMm'), rootRadiusMm: num('rootRadiusMm'), flatMm: num('flatMm'), hollowMm: num('hollowMm') })
    : null;
  const set = judgeWheelSet(family, (summary.wheels || []).map((w: any) => ({ axle: w.axle, side: w.side, treadDiameterMm: w.treadDiameterMm })));

  const submit = async () => {
    if (!open) return;
    const [axle, side] = [Number(open[0]), open[1] as 'L' | 'R'];
    setBusy(true); setError(null);
    try {
      await api.recordWheelReading(wagonNumber, { axle, side, treadDiameterMm: num('treadDiameterMm')!, flangeThicknessMm: num('flangeThicknessMm'), flangeHeightMm: num('flangeHeightMm'), rootRadiusMm: num('rootRadiusMm'), flatMm: num('flatMm'), hollowMm: num('hollowMm'), instrument: form.instrument || null });
      setOpen(null); setForm({}); load(); onRecorded?.();
    } catch (e: any) { setError(e?.message || 'Could not record the reading'); } finally { setBusy(false); }
  };

  const verdictClass = (v: string) => v === 'CONDEMN' ? 'text-bad-ink' : v === 'BELOW_SHOP_ISSUE' ? 'text-warn-ink' : 'text-good-ink';
  const verdictLabel = (v: string) => v === 'CONDEMN' ? t('condemn', 'कंडम') : v === 'BELOW_SHOP_ISSUE' ? t('below issue limit', 'इश्यू सीमा से नीचे') : t('within limits', 'सीमा के भीतर');

  return (
    <div className="bg-card border border-line rounded-card p-5 space-y-3" data-testid="wheel-readings">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-bold text-white">{t('Wheels — what the gauge read', 'पहिये — गेज ने क्या पढ़ा')}</h4>
          <p className="text-[11px] text-ink-muted mt-1 max-w-2xl">
            {limits
              ? t(`${limits.label}: new ${limits.newMm} mm, may not leave a POH below ${limits.lastShopIssueMm} mm, condemned below ${limits.condemnMm} mm (${limits.drawing}). Diameters on one axle within ${limits.variation.sameAxle} mm, one bogie ${limits.variation.sameBogie} mm, the wagon ${limits.variation.sameWagon} mm.`,
                  `${limits.label}: नया ${limits.newMm} मिमी, ${limits.lastShopIssueMm} मिमी से नीचे POH से नहीं जा सकता, ${limits.condemnMm} मिमी से नीचे कंडम (${limits.drawing})। एक धुरी पर अंतर ${limits.variation.sameAxle} मिमी, एक बोगी ${limits.variation.sameBogie}, वैगन ${limits.variation.sameWagon} मिमी के भीतर।`)
              : t(`No diameter table is held for ${summary.bogieDescription || 'this bogie'}: readings are recorded, not judged.`, `${summary.bogieDescription || 'इस बोगी'} के लिए व्यास तालिका नहीं है: रीडिंग दर्ज होती है, जाँची नहीं जाती।`)}
            {' '}{t(WHEEL_PROFILE_LIMITS.diameterMeasuredAt, 'व्यास रिम फ़ेस से 66.5 मिमी पर मापा जाता है।')}
          </p>
        </div>
        <span className="text-[10px] text-ink-faint max-w-xs text-right">{t('Diameters, flat, thin and sharp flange: Wagon Maintenance Manual Ch.6 (RDSO WD-88089/S-1). Deep flange, root radius, hollow tyre and bogie/wagon variation: IRIMEE notes — the manual refers these to IRCA Part III cl. 2.8.14.2; confirm that page.', 'व्यास, फ़्लैट, पतला व नुकीला फ़्लैंज: वैगन रखरखाव मैनुअल अध्याय 6 (RDSO WD-88089/S-1)। गहरा फ़्लैंज, रूट त्रिज्या, खोखला टायर व बोगी/वैगन अंतर: IRIMEE नोट्स — मैनुअल इन्हें IRCA भाग III cl. 2.8.14.2 को सौंपता है; वह पृष्ठ मिलाएँ।')}</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {AXLES.map((axle) => (
          <div key={axle} className="rounded-control border border-line bg-raised p-2 space-y-1.5">
            <div className="text-[10px] uppercase tracking-wide text-ink-muted">{t(`Axle ${axle}`, `धुरी ${axle}`)} · {axle <= 2 ? t('bogie 1', 'बोगी 1') : t('bogie 2', 'बोगी 2')}</div>
            {SIDES.map((side) => {
              const key = `${axle}${side}`; const w = wheelsByKey.get(key);
              return (
                <button key={side} type="button" disabled={!canRecord} onClick={() => { setOpen(key); setForm({}); setError(null); }}
                  className="w-full text-left rounded px-2 py-1.5 border border-line/60 hover:border-line-strong disabled:cursor-default" data-testid={`wheel-${key}`}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-ink-body font-semibold">{side === 'L' ? t('Left', 'बायाँ') : t('Right', 'दायाँ')}</span>
                    {w ? <span className={`font-bold tabular-nums ${verdictClass(w.verdict)}`}>{w.treadDiameterMm} mm</span> : <span className="text-ink-faint">{t('not read', 'नहीं पढ़ा')}</span>}
                  </div>
                  {w && <div className={`text-[10px] ${verdictClass(w.verdict)}`}>{verdictLabel(w.verdict)}{w.flangeThicknessMm !== null ? ` · ${t('flange', 'फ़्लैंज')} ${w.flangeThicknessMm}` : ''}</div>}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {set.variations.length > 0 && (
        <div className="text-[11px] space-y-0.5" data-testid="wheel-variation">
          {set.variations.filter((v) => !v.ok || showAll).map((v) => (
            <div key={v.scope} className={v.ok ? 'text-ink-muted' : 'text-bad-ink font-semibold'}>
              {t(`Diameters on ${v.scope} differ by ${v.spreadMm} mm (limit ${v.limitMm} mm)`, `${v.scope} पर व्यास अंतर ${v.spreadMm} मिमी (सीमा ${v.limitMm})`)}{v.ok ? '' : ` — ${t('will not run true; pair the wheel sets', 'सही नहीं चलेगा; पहिया सेट मिलाएँ')}`}
            </div>
          ))}
          {set.variations.every((v) => v.ok) && !showAll && <div className="text-ink-muted">{t(`${set.wheelsRead} of 8 wheels read; every variation within its limit.`, `8 में से ${set.wheelsRead} पहिये पढ़े; हर अंतर सीमा के भीतर।`)} <button type="button" className="underline" onClick={() => setShowAll(true)}>{t('show', 'दिखाएँ')}</button></div>}
          {set.missing.length > 0 && <div className="text-ink-faint">{t('Not yet read', 'अभी नहीं पढ़े')}: {set.missing.join(', ')}</div>}
        </div>
      )}

      {open && (
        <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="rounded-control border border-accent-line bg-accent-soft/40 p-3 space-y-2" data-testid="wheel-form">
          <div className="text-xs font-bold text-white">{t(`Axle ${open[0]}, ${open[1] === 'L' ? 'left' : 'right'} wheel`, `धुरी ${open[0]}, ${open[1] === 'L' ? 'बायाँ' : 'दायाँ'} पहिया`)}</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {([
              ['treadDiameterMm', t('Tread diameter (mm)', 'ट्रेड व्यास (मिमी)'), true],
              ['flangeThicknessMm', t('Flange thickness (mm)', 'फ़्लैंज मोटाई (मिमी)'), false],
              ['flangeHeightMm', t('Flange height (mm)', 'फ़्लैंज ऊँचाई (मिमी)'), false],
              ['rootRadiusMm', t('Root radius (mm)', 'रूट त्रिज्या (मिमी)'), false],
              ['flatMm', t('Flat, if any (mm)', 'फ़्लैट, यदि हो (मिमी)'), false],
              ['hollowMm', t('Hollow, if any (mm)', 'हॉलो, यदि हो (मिमी)'), false]
            ] as Array<[string, string, boolean]>).map(([k, label, req]) => (
              <label key={k} className="text-[11px] text-ink-muted flex flex-col gap-1">{label}
                <input inputMode="decimal" required={req} value={form[k] || ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} data-testid={`wheel-${k}`}
                  className="min-h-[40px] px-2 bg-card border border-line rounded-control text-sm text-white tabular-nums" />
              </label>
            ))}
            <label className="text-[11px] text-ink-muted flex flex-col gap-1">{t('Instrument', 'उपकरण')}
              <input value={form.instrument || ''} onChange={(e) => setForm({ ...form, instrument: e.target.value })} placeholder={t('e.g. wheel dia gauge WDG-1', 'जैसे WDG-1')} className="min-h-[40px] px-2 bg-card border border-line rounded-control text-sm text-white" /></label>
          </div>
          {live && (
            <div className="text-[11px] space-y-0.5" data-testid="wheel-live">
              <div className={`font-bold ${verdictClass(live.verdict)}`}>{verdictLabel(live.verdict)}</div>
              {live.findings.map((f) => <div key={f.dimension} className={f.verdict === 'PASS' ? 'text-ink-muted' : verdictClass(f.verdict)}>{f.dimension.replace(/Mm$/, '')} {f.value} — {f.limit}</div>)}
            </div>
          )}
          {error && <p className="text-xs text-bad-ink">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={busy || num('treadDiameterMm') === null} className="min-h-[40px] px-4 rounded-control bg-accent text-white text-xs font-bold disabled:opacity-50" data-testid="wheel-save">{t('Record reading', 'रीडिंग दर्ज करें')}</button>
            <button type="button" onClick={() => setOpen(null)} className="min-h-[40px] px-4 rounded-control border border-line text-xs font-bold text-ink-body">{t('Cancel', 'रद्द करें')}</button>
          </div>
        </form>
      )}
    </div>
  );
};

export default WheelReadings;
