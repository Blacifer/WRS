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

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { api } from '../services/api.ts';
import { getBandOptions } from '../../../shared/classification/bandEntry.ts';
import {
  SORTING_BOGIES,
  isBandedBogie,
  judgeSortedSpring
} from '../../../shared/classification/springJudgement.ts';
import type { SortingBogie } from '../../../shared/classification/springJudgement.ts';
import { listWagonDesignations, getWagonSpringConfig } from '../../../shared/classification/wagonTypes.ts';
import type { BogieType, SpringCondition, SpringPosition } from '../../../shared/types.ts';
import { playPassChime, playCondemnedBuzz } from '../utils/audioFeedback.ts';
import { readThroughput, DAILY_PILE } from '../../../shared/sorting/throughput.ts';
import { offlineDb } from '../services/offlineDb.ts';
import { SpringEvidenceCamera } from '../components/SpringEvidenceCamera.tsx';
import type { SpringEvidenceHandle } from '../components/SpringEvidenceCamera.tsx';
import type { PendingSortedSpring } from '../services/offlineDb.ts';

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

  const [bogieType, setBogieType] = useState<SortingBogie>('CASNUB_22_NLB');
  /*
   * LWLH25 and LCCF20 have no band table — WMM 2.0 §309C gives a nominal and
   * a condemning height and nothing between — so there is no strip to read
   * and nothing to tap. Those springs are measured, and the screen has to ask
   * a different question. BOXNS rides LWLH25 and is 369 wagons a year here.
   */
  const banded = isBandedBogie(bogieType);
  const [heightInput, setHeightInput] = useState('');


  /*
   * Photographing what is being sorted.
   *
   * Off unless the inspector turns it on, and it never gates a tap: the
   * record is the work, the photograph is evidence attached to it. The frame
   * is grabbed at the moment the band is tapped, so the workflow does not
   * change and no spring costs an extra action.
   */
  const [capturePhotos, setCapturePhotos] = useState(false);
  const cameraRef = useRef<SpringEvidenceHandle | null>(null);
  /*
   * How much labelled evidence exists so far.
   *
   * Shown to the person taking the photographs, because otherwise they are
   * being asked to do something with no visible result. It is also the honest
   * answer to "when will the camera be able to do this by itself" — that
   * question is answered by the count in the thinnest band, not by an opinion.
   */
  const [dataset, setDataset] = useState<{ total: number; bands: number } | null>(null);
  /*
   * The photographs, so they can actually be looked at.
   *
   * They were captured, stored and counted, and no screen could open one — so
   * an inspector had no way to check their photographs were landing and a
   * supervisor had no way to see the evidence behind a condemnation. The
   * count is now the way in rather than the whole story.
   */
  const [gallery, setGallery] = useState<Array<{
    id: string; band: string | null; status: string; springPosition: string;
    measuredHeight: number | null; imageData: string; createdAt: string;
  }> | null>(null);
  const [galleryBusy, setGalleryBusy] = useState(false);

  const openGallery = async () => {
    setGalleryBusy(true);
    try {
      const res = await api.getSpringImages({ limit: 24 });
      setGallery(res.data);
    } catch {
      setError(isHi ? 'फ़ोटो नहीं खुल सकीं' : 'Could not open the photographs.');
    } finally {
      setGalleryBusy(false);
    }
  };
  const [condition, setCondition] = useState<SpringCondition>('USED');
  const [position, setPosition] = useState<SpringPosition>('OUTER');

  /*
   * Which gauge is in the inspector's hand.
   *
   * Every reading named the person and the wagon and no instrument at all,
   * which is the one thing an auditor asks about a measurement. The register
   * carries the shop's own gauges — SSG-02 among them, whose calibration
   * label has both date fields blank — and the reading is stamped with
   * whatever that gauge's calibration was worth at the moment it was taken.
   */
  const [gauges, setGauges] = useState<Array<{
    gaugeCode: string; description: string;
    calibrationState: 'VALID' | 'EXPIRED' | 'UNRECORDED' | 'NO_GAUGE_NAMED';
    calibrationSummary: string;
  }>>([]);
  const [gaugeCode, setGaugeCode] = useState<string>(() => {
    try { return sessionStorage.getItem('wrs-gauge') || ''; } catch { return ''; }
  });

  useEffect(() => {
    let live = true;
    api.getGauges()
      .then(r => {
        if (!live) return;
        const list = r.data.gauges;
        setGauges(list);
        // One gauge on the bench is the common case; pre-select it rather
        // than making somebody choose from a list of one every session.
        setGaugeCode(prev => prev || (list.length === 1 ? list[0].gaugeCode : ''));
      })
      .catch(() => { /* the picker is degradable; sorting must not stop for it */ });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    try {
      if (gaugeCode) sessionStorage.setItem('wrs-gauge', gaugeCode);
      else sessionStorage.removeItem('wrs-gauge');
    } catch { /* not worth an error on the shop floor */ }
  }, [gaugeCode]);

  const selectedGauge = gauges.find(g => g.gaugeCode === gaugeCode) || null;

  /*
   * Why a spring was condemned, not merely that it was.
   *
   * Two independent things condemn a spring on this floor: the height is off
   * the strip, or somebody sees a crack. The screen had one button for both,
   * and on a banded bogie it was labelled "Off the strip" — so a spring that
   * measured perfectly well and was thrown out for a crack went into the
   * record as a height failure. The reason was wrong in the one place anybody
   * would later go looking for it.
   *
   * A pass stays one tap. A condemnation costs a second tap, which is the
   * right trade at roughly nine hundred springs a shift: passes are the
   * common case and stay instant, and the rare rejection is the one worth
   * describing.
   */
  const [condemnReasonOpen, setCondemnReasonOpen] = useState(false);
  /*
   * Keep the chosen position possible for the chosen bogie.
   *
   * Only LWLH25 splits the snubber, so switching away from it with
   * "Snubber — Inner" selected would leave a position no table covers, and
   * the next tap would be refused with an error the inspector did not cause.
   */
  useEffect(() => {
    if (bogieType === 'LWLH25' && position === 'SNUBBER') {
      setPosition('SNUBBER_OUTER');
    } else if (bogieType !== 'LWLH25' && (position === 'SNUBBER_OUTER' || position === 'SNUBBER_INNER')) {
      setPosition('SNUBBER');
    }
  }, [bogieType, position]);
  const [forWagon, setForWagon] = useState<string>('BOXN');

  /*
   * The batch is created on the device, so a session survives a dropped
   * connection and still reconciles as one batch when it syncs.
   *
   * Held in sessionStorage as well, because a refresh used to mint a new one
   * and quietly split a shift's sorting into two batches — the tally reset to
   * zero and the springs already queued belonged to a batch the screen no
   * longer knew about. It survives a reload and not a shift, which is the
   * same rule the active screen and the chosen gauge follow.
   */
  const [batchId] = useState<string>(() => {
    try {
      const saved = sessionStorage.getItem('wrs-sorting-batch');
      if (saved) return saved;
    } catch { /* private windows fall through to a fresh batch */ }
    const fresh = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    try { sessionStorage.setItem('wrs-sorting-batch', fresh); } catch { }
    return fresh;
  });
  const [tallies, setTallies] = useState<Tally[]>([]);
  const [capacity, setCapacity] = useState<Capacity[]>([]);
  const [totals, setTotals] = useState({ total: 0, passed: 0, condemned: 0 });
  // Today's total across every session, which is the figure the DRM quoted as
  // ~900 and the one worth watching against it.
  const [today, setToday] = useState<
    { total: number; passed: number; condemned: number; firstAt: string | null; lastAt: string | null } | null
  >(null);
  const [lastRecorded, setLastRecorded] = useState<string | null>(null);
  /*
   * What the last undo actually did.
   *
   * Undo worked; nothing said so. Pressing it emptied the session, which
   * removed the button, and the only feedback was the word "Removed" tucked
   * into the totals row — so it read as the button having failed and then
   * vanished. It was reported as "undo only happening once".
   */
  const [undoNotice, setUndoNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * Springs tapped on this device that have not reached the server yet.
   *
   * Held separately from the server's totals rather than folded into them,
   * because the two are different claims. The server's figure is what is
   * recorded; this is what is on the tablet and still owed. The screen adds
   * them for the running count — an inspector counts the pile they have
   * sorted, not the pile the server has heard about — and says plainly how
   * many are still waiting.
   */
  const [pending, setPending] = useState<PendingSortedSpring[]>([]);
  const [online, setOnline] = useState<boolean>(() => offlineDb.isOnline());

  const readPending = useCallback(async () => {
    setPending(await offlineDb.getPendingSorting(batchId));
  }, [batchId]);

  const bandOptions = useMemo(
    () => (isBandedBogie(bogieType) ? getBandOptions(bogieType, condition, position) : []),
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

  useEffect(() => { refresh(); readPending(); }, [refresh, readPending]);

  const readDataset = useCallback(async () => {
    try {
      const res = await api.getSpringDataset();
      setDataset({
        total: res.data.total,
        bands: new Set(res.data.byLabel.map((r) => `${r.springPosition}:${r.band ?? r.status}`)).size
      });
    } catch {
      // A missing count never matters enough to interrupt sorting.
    }
  }, []);

  useEffect(() => { readDataset(); }, [readDataset, totals.total]);

  /*
   * Draining the queue.
   *
   * The browser's online event is the trigger, and a slow poll backs it up:
   * `navigator.onLine` goes true the moment the wifi associates, which on a
   * shop floor is well before anything is actually reachable, so a single
   * attempt on that event is not enough.
   */
  useEffect(() => {
    let cancelled = false;

    const drain = async () => {
      if (cancelled || !offlineDb.isOnline()) return;
      /*
       * Everything queued, not merely this session's share of it.
       *
       * This asked getPendingSorting(batchId), and the batch id is minted
       * fresh on every mount. So the sequence the shop floor will actually
       * produce — sort offline, the tablet sleeps or the tab reloads, come
       * back into signal — found an empty queue for the new batch, returned
       * here, and left the previous session's springs in IndexedDB for good.
       * Twelve springs sorted offline stayed at "12 pending" through a
       * reconnect, and nothing said so.
       *
       * syncPendingSorting drains the whole store regardless, so scoping the
       * question to one batch only ever gated the answer wrongly.
       */
      const queued = await offlineDb.getPendingSorting();
      if (queued.length === 0) return;
      const token = localStorage.getItem('wrs_token') || undefined;
      const result = await offlineDb.syncPendingSorting('/api', token);
      if (cancelled) return;
      await readPending();
      if (result.synced > 0) await refresh();
    };

    const goOnline = () => { setOnline(true); drain(); };
    const goOffline = () => setOnline(false);

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    const timer = window.setInterval(drain, 15000);
    drain();

    return () => {
      cancelled = true;
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      window.clearInterval(timer);
    };
  }, [batchId, readPending, refresh]);

  /**
   * Records one spring.
   *
   * The tap is never lost. If the server cannot be reached — or simply fails
   * — the spring goes into the device's queue and syncs later, because a
   * dropped connection on shop wifi must not cost an inspector a spring they
   * have already measured and put down.
   *
   * The band the inspector tapped drives the sound and the label, so the
   * feedback is immediate either way. It is not the verdict: the stored
   * classification is always the server's, computed from the height, online
   * or on replay.
   */
  const record = async (
    height: number,
    band: string | null,
    condemned: boolean,
    damageType: string | null = null
  ) => {
    setBusy(true);
    setError(null);
    setUndoNotice(null);

    /*
     * What to say and play before the server answers.
     *
     * For a banded bogie the inspector tapped the band, so that IS the local
     * answer. For a non-banded one they entered a height, and the verdict has
     * to be computed — §309C is deterministic, so the local answer matches
     * what the server will store. Without this the feedback for a BOXNS
     * spring would be a chime with no verdict behind it.
     */
    const localVerdict = (() => {
      if (banded || condemned) return null;
      try {
        return judgeSortedSpring({
          bogieType, condition, position, measuredHeight: height
        });
      } catch {
        return null;
      }
    })();
    const localStatus = condemned ? 'CONDEMNED' : localVerdict?.status ?? 'PASS';
    const localLabel = condemned
      ? (isHi ? 'कंडम' : 'Condemned')
      : banded
        ? `${band}`
        : localStatus === 'CONDEMNED'
          ? (isHi ? `कंडम — ${height}mm` : `Condemned — ${height}mm`)
          : (isHi ? `ठीक — ${height}mm` : `Serviceable — ${height}mm`);

    const queueIt = async (why: string | null) => {
      await offlineDb.enqueueSortedSpring({
        batchId,
        bogieType,
        condition,
        springPosition: position,
        measuredFreeHeight: height,
        heightIsApproximate: true,
        tappedBand: band,
        condemned: condemned || localStatus === 'CONDEMNED',
        damageType: damageType ?? undefined,
        gaugeCode: gaugeCode || null
      });
      await readPending();
      if (condemned || localStatus === 'CONDEMNED') playCondemnedBuzz();
      else playPassChime();
      setLastRecorded(localLabel);
      if (why) setError(null);
    };

    try {
      if (!offlineDb.isOnline()) {
        setOnline(false);
        await queueIt(null);
        return;
      }

      /*
       * Grabbed BEFORE the request, so the frame is the spring the inspector
       * was looking at when they decided — not whatever has drifted into
       * view by the time the server answers.
       */
      const frame = capturePhotos ? cameraRef.current?.grab() ?? null : null;

      const res = await api.recordSortedSpring({
        batchId,
        bogieType,
        condition,
        springPosition: position,
        measuredFreeHeight: height,
        heightIsApproximate: true,
        damageType: damageType ?? undefined,
        gaugeCode: gaugeCode || null
      });
      if (res.data.status === 'CONDEMNED') playCondemnedBuzz();
      else playPassChime();
      setLastRecorded(
        res.data.status === 'CONDEMNED'
          ? (isHi ? 'कंडम' : 'Condemned')
          // No band table means no colour to show. Printing the band here
          // unconditionally would render the word "null" for every LWLH25
          // spring an inspector records.
          : res.data.band
            ? `${res.data.band}`
            : (isHi ? `ठीक — ${height}mm` : `Serviceable — ${height}mm`)
      );

      /*
       * Deliberately not awaited and deliberately swallowed. The spring is
       * already recorded; a failed photograph is not worth an error message
       * to somebody holding the next one.
       */
      if (frame) {
        api.attachSpringImage(res.data.id, {
          batchId,
          bogieType,
          condition,
          springPosition: position,
          band: res.data.band ?? null,
          status: res.data.status,
          measuredFreeHeight: height,
          imageData: frame.imageData,
          width: frame.width,
          height: frame.height
        }).catch(() => undefined);
      }

      await refresh();
    } catch {
      // The request failed rather than the device being flagged offline —
      // a dead tunnel, a sleeping server, a dropped packet. Same answer:
      // keep the spring.
      try {
        await queueIt('failed');
      } catch {
        setError(isHi ? 'दर्ज नहीं हो सका' : 'Could not record that spring');
      }
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
      /*
       * Undo takes back the LAST tap, and while springs are queued the last
       * tap is a queued one. Going to the server first would withdraw an
       * older spring that was recorded correctly and leave the mistap sitting
       * in the queue, waiting to sync — the inspector would watch the wrong
       * spring disappear and the wrong one arrive.
       *
       * A queued spring was never recorded anywhere, so removing it from the
       * queue is the whole correction. No void row is needed, and none is
       * written: there is nothing on the server to supersede.
       */
      const queued = await offlineDb.getPendingSorting(batchId);
      if (queued.length > 0) {
        const taken = queued[queued.length - 1];
        await offlineDb.removePendingSorting(taken.clientTempId);
        await readPending();
        setUndoNotice(
          isHi
            ? `वापस लिया: ${taken.tappedBand || taken.measuredFreeHeight + 'mm'}`
            : `Took back: ${taken.tappedBand || taken.measuredFreeHeight + 'mm'}`
        );
        return;
      }

      if (!offlineDb.isOnline()) {
        setError(
          isHi
            ? 'ऑफ़लाइन — पहले से दर्ज स्प्रिंग नेटवर्क लौटने पर ही हटाई जा सकती है।'
            : 'Offline — a spring already sent can only be taken back once the network is available.'
        );
        return;
      }

      const res = await api.undoLastSortedSpring(batchId);
      if (!res.data.corrected) {
        setError(res.data.message || (isHi ? 'पूर्ववत करने के लिए कुछ नहीं है' : 'Nothing to undo yet.'));
      } else {
        const left = (res.data.summary?.total ?? Math.max(0, totals.total - 1));

        /*
         * Name the spring that came off, not just the new total.
         *
         * The count alone left the question "did it take the right one back?"
         * unanswered, which is the whole reason somebody taps undo. Asked for
         * as "it will be a good thing that it shows as to what it has undone".
         * Falls back to the plain count if an older server does not send it.
         */
        const w = (res.data as any).withdrew;
        /*
         * The colour is what the inspector actually tapped, so it leads. The
         * roman numeral is stored already prefixed ("Band II"), so it is used
         * as it stands rather than prefixed again.
         */
        const describe = w
          ? [w.band, w.bandRoman, w.measuredHeight ? `${w.measuredHeight} mm` : null]
              .filter(Boolean).join(' · ')
          : null;

        setUndoNotice(
          left === 0
            ? (isHi
                ? `वापस ली${describe ? ` — ${describe}` : ''}। इस सत्र में अब कुछ नहीं बचा।`
                : `Took back${describe ? ` ${describe}` : ' the last spring'} — nothing left in this session.`)
            : (isHi
                ? `वापस ली${describe ? ` — ${describe}` : ''}। अब ${left} बची हैं।`
                : `Took back${describe ? ` ${describe}` : ' one spring'}. ${left} left in this session.`)
        );
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

  /*
   * What the inspector has sorted, which is the server's count plus whatever
   * is still on the tablet. Anything less would show a number smaller than
   * the pile in front of them the moment the wifi drops.
   */
  const pendingCount = pending.length;
  const sessionTotal = totals.total + pendingCount;
  const sessionPassed = totals.passed + pending.filter((p) => !p.condemned).length;
  const sessionCondemned = totals.condemned + pending.filter((p) => p.condemned).length;

  const positionTallies = tallies.filter((t) => t.springPosition === position);
  const positionCapacity = capacity.filter((c) => c.springPosition === position);

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {/*
        ORDER ON THIS PAGE
        ------------------
        The work comes first. It used to be sixth: an inspector tapping seven
        hundred times a shift scrolled past the settings, the running totals,
        the pace readout, the undo button and a camera panel before reaching
        the band buttons, which on a laptop sat at the bottom of the screen.
        It was reported simply as confusing, and it was — the page was
        arranged as a dashboard when it is a tool.

        So: what you are sorting, then the bands, then undo directly beneath
        where the mistake was made. Everything that is watched rather than
        used — pace, photographs, stock, finishing — sits below that.
      */}
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
              onChange={(e) => setBogieType(e.target.value as SortingBogie)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
            >
              {SORTING_BOGIES.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
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
              {/* The band counts belong to the G-95 tables, not to the spring's
                  age, so they are only mentioned for a bogie that has them.
                  "Used (6 bands)" under an LWLH25 heading promised a
                  classification the published data cannot support. */}
              <option value="USED">
                {banded ? (isHi ? 'पुराना (6 बैंड)' : 'Used (6 bands)') : (isHi ? 'पुराना' : 'Used')}
              </option>
              <option value="NEW">
                {banded ? (isHi ? 'नया (3 बैंड)' : 'New (3 bands)') : (isHi ? 'नया' : 'New')}
              </option>
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
              {/*
                LWLH25 carries two different snubbers — RDSO G-112 Table 26
                gives its group as "4 (2SO & 2SI)" — and they condemn at
                different heights, 266mm for the outer and 274mm for the
                inner. Offering one undifferentiated "Snubber" here would mean
                judging half of them against the wrong number, which is what
                this app did until the pamphlet arrived.
              */}
              {bogieType === 'LWLH25' ? (
                <>
                  <option value="SNUBBER_OUTER">{isHi ? 'स्नबर — बाहरी (SO)' : 'Snubber — Outer (SO)'}</option>
                  <option value="SNUBBER_INNER">{isHi ? 'स्नबर — भीतरी (SI)' : 'Snubber — Inner (SI)'}</option>
                </>
              ) : (
                <option value="SNUBBER">{isHi ? 'स्नबर' : 'Snubber'}</option>
              )}
            </select>
          </label>
        </div>

        {/* Running totals for this session */}
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm border-t border-slate-800 pt-3">
          <span className="text-slate-400">
            {isHi ? 'इस सत्र में' : 'This session'}:{' '}
            <b className="text-white tabular-nums" data-testid="session-total">{sessionTotal}</b>
          </span>
          <span className="text-emerald-400">
            {isHi ? 'उत्तीर्ण' : 'Passed'}: <b className="tabular-nums">{sessionPassed}</b>
          </span>
          <span className="text-red-400">
            {isHi ? 'कंडम' : 'Condemned'}: <b className="tabular-nums">{sessionCondemned}</b>
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

        {/*
          Springs on the tablet and not yet on the server.

          Said plainly rather than hidden behind a spinner. An inspector whose
          wifi has dropped needs to know two things: that their taps are being
          kept, and that they are not finished until the count clears. Silence
          on either point is what sends someone back to paper.
        */}
        {pendingCount > 0 && (
          <div
            data-testid="pending-sync-banner"
            className="rounded-xl border border-amber-700/60 bg-amber-950/40 px-4 py-2.5 text-xs text-amber-200"
          >
            <b className="tabular-nums">{pendingCount}</b>{' '}
            {isHi
              ? 'स्प्रिंग इस टैबलेट पर सुरक्षित हैं और नेटवर्क लौटते ही अपने आप भेज दी जाएँगी। कुछ खोया नहीं है।'
              : pendingCount === 1
                ? 'spring is held on this tablet and will send itself when the network is back. Nothing is lost.'
                : 'springs are held on this tablet and will send themselves when the network is back. Nothing is lost.'}
            {!online && (
              <span className="ml-1 font-bold">
                {isHi ? 'अभी ऑफ़लाइन।' : 'Offline right now.'}
              </span>
            )}
          </div>
        )}
      </div>

      {/* The work itself: one tap per spring */}
      <div className="rounded-2xl border border-slate-700 bg-slate-900 p-5 space-y-3">
        <p className="text-sm font-bold text-white">
          {banded
            ? isHi
              ? 'पट्टी पर कौन-सा बैंड दिखता है?'
              : 'Which band does the strip show?'
            : isHi
              ? 'मुक्त ऊँचाई कितनी है? (मिमी)'
              : 'What is the free height? (mm)'}
        </p>

        {/*
          No band table for this bogie, so no strip and nothing to tap.
          WMM 2.0 §309C gives these a nominal and a condemning height and
          nothing between, so the spring is measured and gets a verdict with
          no colour. Six bands could be manufactured by dividing the range and
          would look identical on screen to a real G-95 classification while
          being invented, so they are not.
        */}
        {!banded && (
          <div className="space-y-3">
            <p className="text-xs text-amber-300/90 bg-amber-950/30 border border-amber-800/50 rounded-lg px-3 py-2">
              {isHi
                ? 'इस बोगी के लिए कोई बैंड तालिका प्रकाशित नहीं है — केवल ठीक / कंडम।'
                : 'No colour band is published for this bogie — only serviceable or condemned.'}{' '}
              <span className="text-amber-400/80">
                {SORTING_BOGIES.find((b) => b.value === bogieType)?.source}
              </span>
            </p>
            <div className="flex gap-2.5">
              <input
                data-testid="free-height-input"
                type="number"
                inputMode="decimal"
                step="0.5"
                value={heightInput}
                onChange={(e) => setHeightInput(e.target.value)}
                placeholder={isHi ? 'मिमी' : 'mm'}
                className="flex-1 min-h-[68px] bg-slate-800 border-2 border-slate-700 rounded-xl px-4 text-2xl font-black text-white tabular-nums"
              />
              <button
                data-testid="record-measured-spring"
                disabled={busy || !Number.isFinite(Number(heightInput)) || heightInput.trim() === ''}
                onClick={async () => {
                  const h = Number(heightInput);
                  await record(h, null, false);
                  setHeightInput('');
                }}
                className="min-h-[68px] px-6 rounded-xl bg-white text-black font-extrabold text-sm disabled:opacity-40 active:scale-95 transition-transform"
              >
                {isHi ? 'दर्ज करें' : 'Record'}
              </button>
            </div>
          </div>
        )}

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

        {!condemnReasonOpen ? (
          <button
            disabled={busy}
            onClick={() => setCondemnReasonOpen(true)}
            className="w-full min-h-[52px] rounded-xl border-2 border-red-700 bg-red-950/50 text-red-200 font-bold text-sm disabled:opacity-40 active:scale-95 transition-transform"
            data-testid="condemn-open"
          >
            {isHi ? 'कंडम करें' : 'Condemn this spring'}
          </button>
        ) : (
          <div
            className="rounded-xl border-2 border-red-700 bg-red-950/40 p-3 space-y-2"
            data-testid="condemn-reasons"
          >
            <p className="text-xs font-bold text-red-200">
              {isHi ? 'क्या देखा गया?' : 'What did you see?'}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {/* Height first: on a banded bogie it is much the commonest
                  reason, so it sits where the thumb already is. */}
              {banded && (
                <button
                  disabled={busy}
                  onClick={() => { setCondemnReasonOpen(false); record(200, null, true, 'NONE'); }}
                  className="min-h-[52px] rounded-lg border border-red-600 bg-red-900/50 text-red-100 font-bold text-xs active:scale-95 transition-transform disabled:opacity-40"
                  data-testid="condemn-height"
                >
                  {isHi ? 'पट्टी से बाहर (ऊँचाई)' : 'Off the strip (height)'}
                </button>
              )}
              {([
                ['CRACK', isHi ? 'दरार' : 'Crack'],
                ['CORROSION', isHi ? 'जंग' : 'Corrosion'],
                ['DEFORMATION', isHi ? 'विकृति' : 'Deformation'],
                ['OTHER', isHi ? 'अन्य' : 'Something else']
              ] as const).map(([code, label]) => (
                <button
                  key={code}
                  disabled={busy}
                  onClick={() => { setCondemnReasonOpen(false); record(200, null, true, code); }}
                  className="min-h-[52px] rounded-lg border border-red-600 bg-red-900/50 text-red-100 font-bold text-xs active:scale-95 transition-transform disabled:opacity-40"
                  data-testid={`condemn-${code.toLowerCase()}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              onClick={() => setCondemnReasonOpen(false)}
              className="w-full min-h-[40px] rounded-lg bg-slate-800 text-slate-300 text-xs font-bold"
              data-testid="condemn-cancel"
            >
              {isHi ? 'वापस' : 'Back'}
            </button>
          </div>
        )}

        {/*
          * The gauge, with the work rather than in a settings screen.
          *
          * An inspector picks it up once at the start of a session and it
          * stays picked for the rest of it, so this is small and quiet — but
          * it is here, next to the bands, because that is where somebody
          * would notice they had grabbed the wrong instrument. A gauge whose
          * calibration is not established says so plainly rather than being
          * silently accepted: the reading is still recorded, and recorded as
          * having been taken with an unverified gauge.
          */}
        {gauges.length > 0 && (
          <div className="rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2.5" data-testid="gauge-picker">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <label className="text-[11px] font-bold uppercase tracking-wide text-slate-400 sm:min-w-[5.5rem]">
                {isHi ? 'गेज' : 'Gauge'}
              </label>
              <select
                value={gaugeCode}
                onChange={e => setGaugeCode(e.target.value)}
                className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-sm text-white"
                data-testid="gauge-select"
              >
                <option value="">{isHi ? 'कोई गेज नहीं चुना' : 'No gauge named'}</option>
                {gauges.map(g => (
                  <option key={g.gaugeCode} value={g.gaugeCode}>
                    {g.gaugeCode} — {g.description}
                  </option>
                ))}
              </select>
            </div>

            {selectedGauge && selectedGauge.calibrationState !== 'VALID' && (
              <p className="text-[11px] text-amber-300/90 mt-1.5 font-semibold" data-testid="gauge-calibration-warning">
                {selectedGauge.calibrationSummary}
              </p>
            )}
            {!gaugeCode && (
              <p className="text-[11px] text-slate-400 mt-1.5" data-testid="gauge-none-note">
                {isHi
                  ? 'बिना गेज के दर्ज की गई रीडिंग रिकॉर्ड में ऐसी ही दिखेगी।'
                  : 'Readings recorded without naming a gauge are marked that way in the record.'}
              </p>
            )}
          </div>
        )}

        {error && (
          <p className="text-xs font-semibold text-red-300 bg-red-950/40 border border-red-800 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
      </div>

      {/* Correcting the last tap. Placed with the work rather than in a menu:
          it is needed in the second after a mistake, not later. */}
      {undoNotice && (
        <div
          data-testid="undo-notice"
          className="rounded-xl border border-sky-800/60 bg-sky-950/40 px-4 py-2.5 text-sm text-sky-200 flex items-center justify-between gap-3"
        >
          <span>↩ {undoNotice}</span>
          <button
            onClick={() => setUndoNotice(null)}
            className="text-xs font-bold text-sky-400 hover:text-white px-2 min-h-[32px]"
          >
            {isHi ? 'ठीक है' : 'OK'}
          </button>
        </div>
      )}

      {sessionTotal > 0 && (
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

      {/*
        Photographing the pile.

        Off by default and one tap to turn on for the whole session, not per
        spring. At ~700 a shift, a feature costing one tap each costs 700 and
        gets switched off by lunchtime.
      */}
      <div className="rounded-2xl border border-slate-700 bg-slate-900 p-4 space-y-3">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            data-testid="toggle-spring-photos"
            checked={capturePhotos}
            onChange={(e) => setCapturePhotos(e.target.checked)}
            className="mt-0.5 w-5 h-5 accent-sky-500 shrink-0"
          />
          <span>
            <span className="block text-sm font-bold text-white">
              {isHi ? 'छँटाई के साथ फ़ोटो लें' : 'Photograph springs while sorting'}
            </span>
            <span className="block text-[11px] text-slate-400 mt-0.5 leading-snug">
              {isHi
                ? 'हर स्प्रिंग की फ़ोटो उसी बैंड के साथ सुरक्षित होगी जो आप दबाते हैं। कोई अतिरिक्त टैप नहीं। कैमरा बैंड तय नहीं करता — वह आप तय करते हैं।'
                : 'Each photo is saved against the band you tap. No extra taps. The camera does not decide anything — you do.'}
            </span>
          </span>
        </label>
        <SpringEvidenceCamera
          ref={cameraRef}
          lang={lang}
          active={capturePhotos}
          onUnavailable={() => { /* sorting is unaffected; the component says so */ }}
        />
        {dataset && dataset.total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p data-testid="evidence-count" className="text-[11px] text-slate-400">
              {isHi
                ? `अब तक ${dataset.total.toLocaleString()} लेबल-युक्त फ़ोटो, ${dataset.bands} समूहों में।`
                : `${dataset.total.toLocaleString()} labelled photographs so far, across ${dataset.bands} ${dataset.bands === 1 ? 'group' : 'groups'}.`}
            </p>
            <button
              data-testid="view-photographs"
              onClick={() => (gallery ? setGallery(null) : openGallery())}
              disabled={galleryBusy}
              className="min-h-[36px] px-3 rounded-lg border border-slate-600 text-slate-300 text-xs font-bold hover:bg-slate-800 disabled:opacity-40"
            >
              {gallery
                ? (isHi ? 'फ़ोटो छिपाएँ' : 'Hide photographs')
                : (isHi ? 'फ़ोटो देखें' : 'View photographs')}
            </button>
          </div>
        )}

        {gallery && (
          <div className="space-y-2">
            {gallery.length === 0 ? (
              <p className="text-[11px] text-slate-500">
                {isHi ? 'अभी कोई फ़ोटो नहीं।' : 'No photographs yet.'}
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {gallery.map((g) => (
                  <figure key={g.id} className="rounded-lg overflow-hidden border border-slate-700 bg-slate-950">
                    <img src={g.imageData} alt="" className="w-full h-24 object-cover" />
                    <figcaption className="px-2 py-1.5 text-[10px] leading-tight">
                      <span
                        className={`font-black ${g.status === 'CONDEMNED' ? 'text-red-400' : 'text-emerald-400'}`}
                      >
                        {g.band || (g.status === 'CONDEMNED' ? (isHi ? 'कंडम' : 'Condemned') : (isHi ? 'ठीक' : 'Serviceable'))}
                      </span>
                      <span className="block text-slate-500">
                        {g.springPosition}{g.measuredHeight ? ` · ${g.measuredHeight}mm` : ''}
                      </span>
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
            <p className="text-[10px] text-slate-500">
              {isHi
                ? 'लेबल वही है जो निरीक्षक ने दबाया था — कैमरा कुछ तय नहीं करता।'
                : 'The label under each photograph is what the inspector tapped. The camera decided none of it.'}
            </p>
          </div>
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
            {/* The stock figures come from the server, so while springs are
                queued they are behind by exactly that many. Saying so is
                better than showing a number that quietly under-counts. */}
            {pendingCount > 0 && (
              <p className="text-[11px] text-amber-400/90 mt-1">
                {isHi
                  ? `पिछले सिंक तक — ${pendingCount} स्प्रिंग अभी गिनी नहीं गई`
                  : `As of the last sync — ${pendingCount} not counted here yet`}
              </p>
            )}
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
        disabled={busy || sessionTotal === 0 || pendingCount > 0}
        className="w-full min-h-[52px] rounded-xl bg-white text-black font-extrabold text-sm disabled:opacity-40 active:scale-95 transition-transform"
      >
        {pendingCount > 0
          ? isHi
            ? `${pendingCount} स्प्रिंग भेजी जानी बाकी — प्रतीक्षा करें`
            : `${pendingCount} still to send — waiting for the network`
          : isHi
            ? 'सत्र समाप्त करें'
            : 'Finish sorting session'}
      </button>
    </div>
  );
}
