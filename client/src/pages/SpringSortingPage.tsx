/**
 * Spring Sorting — bulk grouping of dismantled springs
 * Indian Railways WRS Raipur
 *
 * WHY THIS EXISTS
 * ---------------
 * Springs arrive at WRS Raipur already dismantled, in bulk, and are sorted
 * against the strip into groups — around 900 a day. The wagon they came off is
 * frequently not known at that point.
 *
 * The wagon sweep screen could not represent that work at all: it opens by
 * demanding a wagon number and then walks a fixed queue of that wagon's
 * springs. Sorting has no wagon and no queue — it has a pile, and it ends when
 * the pile does.
 *
 * So this screen asks for nothing but the spring in the inspector's hand: what
 * kind it is, and which band the strip shows. One tap per spring. What it adds
 * is the running picture nobody has on a shop floor — how the pile is
 * splitting across groups, and how many complete matched nests that actually
 * amounts to.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../services/api.ts';
import { getBandOptions } from '../../../shared/classification/bandEntry.ts';
import { listWagonDesignations, getWagonSpringConfig } from '../../../shared/classification/wagonTypes.ts';
import type { BogieType, SpringCondition, SpringPosition } from '../../../shared/types.ts';
import { playPassChime, playCondemnedBuzz } from '../utils/audioFeedback.ts';
import { readThroughput, DAILY_PILE } from '../../../shared/sorting/throughput.ts';

const BAND_HEX: Record<string, string> = {
  BLUE: '#2563eb',
  GREEN: '#16a34a',
  YELLOW: '#eab308',
  ORANGE: '#ea580c',
  WHITE: '#e2e8f0',
  RED: '#dc2626'
};

const BAND_LABEL_HI: Record<string, string> = {
  BLUE: 'नीला', GREEN: 'हरा', YELLOW: 'पीला', ORANGE: 'नारंगी', WHITE: 'सफ़ेद', RED: 'लाल'
};

interface Props {
  lang: 'en' | 'hi';
  onClose: () => void;
}

interface Tally { band: string; springPosition: string; count: number }
interface Capacity {
  springPosition: string; band: string; available: number;
  requiredPerNest: number; completeNests: number;
}

export function SpringSortingPage({ lang, onClose }: Props) {
  const isHi = lang === 'hi';

  const [bogieType, setBogieType] = useState<BogieType>('CASNUB_22_NLB');
  const [condition, setCondition] = useState<SpringCondition>('USED');
  const [position, setPosition] = useState<SpringPosition>('OUTER');
  const [forWagon, setForWagon] = useState<string>('BOXN');

  // The batch is created on the device, so a session survives a dropped
  // connection and still reconciles as one batch when it syncs.
  const [batchId] = useState<string>(
    () => `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  );

  const [tallies, setTallies] = useState<Tally[]>([]);
  const [capacity, setCapacity] = useState<Capacity[]>([]);
  const [totals, setTotals] = useState({ total: 0, passed: 0, condemned: 0 });
  // Today's total across every session, which is the figure the DRM quoted as
  // ~900 and the one worth watching against it.
  const [today, setToday] = useState<
    { total: number; passed: number; condemned: number; firstAt: string | null; lastAt: string | null } | null
  >(null);
  const [lastRecorded, setLastRecorded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bandOptions = useMemo(
    () => getBandOptions(bogieType, condition, position),
    [bogieType, condition, position]
  );

  const wagonOptions = useMemo(() => listWagonDesignations(), []);
  const wagonConfig = useMemo(() => getWagonSpringConfig(forWagon), [forWagon]);

  const refresh = useCallback(async () => {
    try {
      const [batch, stock, throughput] = await Promise.all([
        api.getSortingBatch(batchId),
        api.getSortingStock(bogieType, condition, forWagon),
        api.getSortingThroughput()
      ]);
      setToday(throughput.data);
      setTotals({
        total: batch.data.total,
        passed: batch.data.passed,
        condemned: batch.data.condemned
      });
      setTallies(stock.data.stock || []);
      setCapacity(stock.data.capacity || []);
    } catch {
      // A failed refresh must never block recording — the tallies are a view,
      // the records are the work.
    }
  }, [batchId, bogieType, condition, forWagon]);

  useEffect(() => { refresh(); }, [refresh]);

  const record = async (height: number, band: string | null, condemned: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.recordSortedSpring({
        batchId,
        bogieType,
        condition,
        springPosition: position,
        measuredFreeHeight: height,
        heightIsApproximate: true
      });
      if (res.data.status === 'CONDEMNED') playCondemnedBuzz();
      else playPassChime();
      setLastRecorded(
        res.data.status === 'CONDEMNED'
          ? (isHi ? 'कंडम' : 'Condemned')
          : `${res.data.band}`
      );
      await refresh();
    } catch (e: any) {
      setError(e?.message || (isHi ? 'दर्ज नहीं हो सका' : 'Could not record that spring'));
    } finally {
      setBusy(false);
    }
  };

  /*
   * Correcting the last spring.
   *
   * One tap per spring, ~700 a shift, means a wrong tap is a certainty rather
   * than a risk — and without a way to fix one, an inspector either stops
   * trusting the tally or keeps corrections on paper.
   *
   * Nothing is deleted. The server appends a superseding record and both
   * survive, so the correction is itself part of the trail.
   */
  const undoLast = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.undoLastSortedSpring(batchId);
      if (!res.data.corrected) {
        setError(res.data.message || (isHi ? 'पूर्ववत करने के लिए कुछ नहीं है' : 'Nothing to undo yet.'));
      } else {
        setLastRecorded(isHi ? 'हटाया गया' : 'Removed');
      }
      await refresh();
    } catch (e: any) {
      setError(e?.message || (isHi ? 'पूर्ववत नहीं हो सका' : 'Could not undo that spring'));
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setBusy(true);
    try {
      await api.closeSortingBatch(batchId);
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Could not close the batch');
    } finally {
      setBusy(false);
    }
  };

  const positionTallies = tallies.filter((t) => t.springPosition === position);
  const positionCapacity = capacity.filter((c) => c.springPosition === position);

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="rounded-2xl border border-slate-700 bg-slate-900 p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-extrabold text-white">
              {isHi ? 'स्प्रिंग छँटाई' : 'Spring Sorting'}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {isHi
                ? 'खुले स्प्रिंग — वैगन नंबर की आवश्यकता नहीं'
                : 'Loose springs — no wagon number needed'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 text-xs font-bold hover:bg-slate-800"
          >
            {isHi ? 'बंद करें' : 'Close'}
          </button>
        </div>

        {/* What kind of spring is in hand */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="block">
            <span className="block text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-1">
              {isHi ? 'बोगी प्रकार' : 'Bogie type'}
            </span>
            <select
              value={bogieType}
              onChange={(e) => setBogieType(e.target.value as BogieType)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
            >
              <option value="CASNUB_22_NLB">CASNUB 22 NLB</option>
              <option value="CASNUB_22_HS">CASNUB 22 HS</option>
              <option value="CASNUB_22_RFT">CASNUB 22 RFT</option>
            </select>
          </label>

          <label className="block">
            <span className="block text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-1">
              {isHi ? 'स्थिति' : 'Condition'}
            </span>
            <select
              value={condition}
              onChange={(e) => setCondition(e.target.value as SpringCondition)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
            >
              <option value="USED">{isHi ? 'पुराना (6 बैंड)' : 'Used (6 bands)'}</option>
              <option value="NEW">{isHi ? 'नया (3 बैंड)' : 'New (3 bands)'}</option>
            </select>
          </label>

          <label className="block">
            <span className="block text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-1">
              {isHi ? 'स्प्रिंग स्थान' : 'Spring position'}
            </span>
            <select
              value={position}
              onChange={(e) => setPosition(e.target.value as SpringPosition)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
            >
              <option value="OUTER">{isHi ? 'बाहरी' : 'Outer'}</option>
              <option value="INNER">{isHi ? 'भीतरी' : 'Inner'}</option>
              <option value="SNUBBER">{isHi ? 'स्नबर' : 'Snubber'}</option>
            </select>
          </label>
        </div>

        {/* Running totals for this session */}
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm border-t border-slate-800 pt-3">
          <span className="text-slate-400">
            {isHi ? 'इस सत्र में' : 'This session'}:{' '}
            <b className="text-white tabular-nums">{totals.total}</b>
          </span>
          <span className="text-emerald-400">
            {isHi ? 'उत्तीर्ण' : 'Passed'}: <b className="tabular-nums">{totals.passed}</b>
          </span>
          <span className="text-red-400">
            {isHi ? 'कंडम' : 'Condemned'}: <b className="tabular-nums">{totals.condemned}</b>
          </span>
          {lastRecorded && (
            <span className="text-slate-300">
              {isHi ? 'अंतिम' : 'Last'}: <b>{lastRecorded}</b>
            </span>
          )}
          {today && (
            <span className="text-slate-400 border-l border-slate-700 pl-6">
              {isHi ? 'आज कुल' : 'Today, all sessions'}:{' '}
              <b className="text-white tabular-nums">{today.total.toLocaleString()}</b>
              {today.condemned > 0 && (
                <span className="text-red-400"> ({today.condemned} {isHi ? 'कंडम' : 'condemned'})</span>
              )}
            </span>
          )}
        </div>
      </div>

      {/* Pace.
          The shop gets through around 900 springs a day and has never had a
          way to see how that is going while it happens. This is the one
          number the DRM asked about, so it is worth showing — and worth
          refusing to show when there is not yet enough to support it. The
          rules for that live in shared/sorting/throughput.ts, tested, rather
          than in this component. */}
      {today && (() => {
        const pace = readThroughput(today);
        return (
          <div className="rounded-2xl border border-slate-700 bg-slate-900 px-5 py-4">
            {pace.canQuoteRate ? (
              <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
                <div>
                  <span className="text-3xl font-extrabold text-white tabular-nums">
                    {pace.springsPerHour!.toLocaleString()}
                  </span>
                  <span className="text-sm text-slate-400 ml-2">
                    {isHi ? 'स्प्रिंग / घंटा' : 'springs per hour'}
                  </span>
                </div>

                {pace.hoursForDailyPile !== undefined && (
                  <div className="text-sm text-slate-300">
                    {isHi
                      ? `इस रफ़्तार से ${DAILY_PILE.toLocaleString()} स्प्रिंग में `
                      : `At this rate, ${DAILY_PILE.toLocaleString()} springs takes `}
                    <b className="text-white tabular-nums">{pace.hoursForDailyPile}</b>
                    {isHi ? ' घंटे' : ' hours'}
                  </div>
                )}

                <div className="text-xs text-slate-500">
                  {isHi
                    ? `${pace.activeMinutes} मिनट में ${today.total.toLocaleString()} स्प्रिंग`
                    : `measured over ${pace.activeMinutes} min of sorting, ${today.total.toLocaleString()} springs`}
                </div>
              </div>
            ) : (
              <div className="flex items-baseline gap-3">
                <span className="text-sm text-slate-400">{pace.reason}</span>
                {pace.activeMinutes > 0 && (
                  <span className="text-xs text-slate-500">
                    {isHi ? `${pace.activeMinutes} मिनट से` : `${pace.activeMinutes} min so far`}
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* Correcting the last tap. Placed with the work rather than in a menu:
          it is needed in the second after a mistake, not later. */}
      {totals.total > 0 && (
        <div className="flex justify-end">
          <button
            data-testid="undo-last-spring"
            onClick={undoLast}
            disabled={busy}
            className="min-h-[44px] px-4 rounded-xl border border-slate-600 text-slate-300 hover:bg-slate-800 text-sm font-bold disabled:opacity-40"
          >
            ↩ {isHi ? 'पिछला हटाएँ' : 'Undo last spring'}
          </button>
        </div>
      )}

      {/* The work itself: one tap per spring */}
      <div className="rounded-2xl border border-slate-700 bg-slate-900 p-5 space-y-3">
        <p className="text-sm font-bold text-white">
          {isHi
            ? 'पट्टी पर कौन-सा बैंड दिखता है?'
            : 'Which band does the strip show?'}
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {bandOptions.map((b) => (
            <button
              key={b.band}
              disabled={busy}
              onClick={() => record(b.midpoint, b.band, false)}
              className="min-h-[68px] rounded-xl border-2 border-white/15 px-3 py-2.5 text-left disabled:opacity-40 active:scale-95 transition-transform"
              style={{ backgroundColor: BAND_HEX[b.band] || '#475569' }}
            >
              <span className={`block text-base font-black ${b.band === 'WHITE' ? 'text-slate-900' : 'text-white'}`}>
                {isHi ? BAND_LABEL_HI[b.band] || b.band : b.band}
              </span>
              <span className={`block text-[11px] font-semibold tabular-nums ${b.band === 'WHITE' ? 'text-slate-700' : 'text-white/85'}`}>
                {b.maxHeight}–{b.minHeight} mm
              </span>
            </button>
          ))}
        </div>

        <button
          disabled={busy}
          onClick={() => record(200, null, true)}
          className="w-full min-h-[52px] rounded-xl border-2 border-red-700 bg-red-950/50 text-red-200 font-bold text-sm disabled:opacity-40 active:scale-95 transition-transform"
        >
          {isHi ? 'पट्टी से बाहर — कंडम' : 'Off the strip — condemn'}
        </button>

        {error && (
          <p className="text-xs font-semibold text-red-300 bg-red-950/40 border border-red-800 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
      </div>

      {/* What the pile adds up to */}
      <div className="rounded-2xl border border-slate-700 bg-slate-900 p-5 space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-sm font-extrabold text-white">
              {isHi ? 'भंडार — समूह अनुसार' : 'Stock on hand — by group'}
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {isHi
                ? 'एक नेस्ट एक ही समूह से आना चाहिए'
                : 'A nest must come from one group, so the split is what matters'}
            </p>
          </div>
          <label className="block">
            <span className="block text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-1">
              {isHi ? 'किस वैगन के लिए' : 'Building for'}
            </span>
            <select
              value={forWagon}
              onChange={(e) => setForWagon(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white"
            >
              {wagonOptions.map((w) => (
                <option key={w.designation} value={w.designation}>
                  {w.designation} ({w.counts.outer}/{w.counts.inner}/{w.counts.snubber})
                </option>
              ))}
            </select>
          </label>
        </div>

        {wagonConfig && !wagonConfig.bogieType && (
          <p className="text-[11px] text-amber-300 bg-amber-950/40 border border-amber-800 rounded-lg px-3 py-2">
            {isHi
              ? `${wagonConfig.designation} की बोगी (${wagonConfig.bogieDescription}) के लिए G-95 बैंड तालिका उपलब्ध नहीं — स्प्रिंग गिने जा सकते हैं, वर्गीकृत नहीं।`
              : `${wagonConfig.designation} runs on ${wagonConfig.bogieDescription}, for which no G-95 band table is held here. Its springs can be counted but not classified.`}
          </p>
        )}

        {positionTallies.length === 0 ? (
          <p className="text-xs text-slate-500">
            {isHi ? 'अभी कोई स्प्रिंग दर्ज नहीं।' : 'Nothing sorted for this position yet.'}
          </p>
        ) : (
          <div className="space-y-2">
            {positionTallies.map((t) => {
              const cap = positionCapacity.find((c) => c.band === t.band);
              return (
                <div key={t.band} className="flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="w-4 h-4 rounded shrink-0 border border-white/25"
                    style={{ backgroundColor: BAND_HEX[t.band] || '#475569' }}
                  />
                  <span className="text-sm font-bold text-white w-20">{t.band}</span>
                  <span className="text-sm text-slate-300 tabular-nums w-24">
                    {t.count} {isHi ? 'स्प्रिंग' : t.count === 1 ? 'spring' : 'springs'}
                  </span>
                  {cap && (
                    <span className="text-xs text-slate-400 tabular-nums">
                      {isHi
                        ? `= ${cap.completeNests} पूर्ण नेस्ट (${cap.requiredPerNest}/नेस्ट)`
                        : `= ${cap.completeNests} complete nest${cap.completeNests === 1 ? '' : 's'} (${cap.requiredPerNest} per nest)`}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <button
        onClick={finish}
        disabled={busy || totals.total === 0}
        className="w-full min-h-[52px] rounded-xl bg-white text-black font-extrabold text-sm disabled:opacity-40 active:scale-95 transition-transform"
      >
        {isHi ? 'सत्र समाप्त करें' : 'Finish sorting session'}
      </button>
    </div>
  );
}
