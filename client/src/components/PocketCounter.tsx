/**
 * Pocket counter — a person marks each spring they can see on one frame
 * Indian Railways WRS Raipur
 *
 * The photograph is the evidence. This screen is how a person reads it:
 * tap each spring, by kind, and the taps are the count. Nothing here knows
 * how many there should be — the expected figure is withheld until the
 * count is submitted, so the counter counts what is in the frame rather
 * than what the wagon type says ought to be. The comparison comes back
 * from the server, from the registry, and a match comes back as nothing
 * to say. A second person's recount is blind for the same reason.
 *
 * There is no model here today (shared/assembly/pocketCount.ts says so).
 * If one is ever earned, it will produce taps like these, be measured
 * against these, and be allowed the same thing: to raise a question.
 */

import React, { useEffect, useRef, useState } from 'react';
import { api } from '../services/api.ts';
import { POCKET_KINDS, type PocketKind, type PocketTap } from '../../../shared/assembly/pocketCount.ts';
import type { WagonPhotoRecord } from '../../../shared/types.ts';

interface Props {
  photo: WagonPhotoRecord;
  lang: 'en' | 'hi';
  onClose: () => void;
  onCounted?: () => void;
}

const KIND_COLOUR: Record<PocketKind, string> = { OUTER: '#38bdf8', INNER: '#facc15', SNUBBER: '#f472b6' };

export const PocketCounter: React.FC<Props> = ({ photo, lang, onClose, onCounted }) => {
  const isHi = lang === 'hi';
  const t = (en: string, hi: string) => (isHi ? hi : en);
  const [state, setState] = useState<any>(null);
  const [kind, setKind] = useState<PocketKind>('OUTER');
  const [taps, setTaps] = useState<PocketTap[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    api.getPocketCounts(photo.id).then((r) => setState(r.data)).catch((e: any) => setError(e?.message || 'Could not load'));
  }, [photo.id]);

  const place = (e: React.MouseEvent<HTMLDivElement>) => {
    if (result || busy) return;
    const box = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - box.left) / box.width;
    const y = (e.clientY - box.top) / box.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    setTaps((tp) => [...tp, { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000, kind }]);
  };

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api.recordPocketCount(photo.id, taps);
      setResult(r.data);
      onCounted?.();
    } catch (e: any) {
      setError(e?.message || 'Could not record the count');
    } finally { setBusy(false); }
  };

  const tally = (k: PocketKind) => taps.filter((x) => x.kind === k).length;
  const canCount = state && (state.turn === 'FIRST' || state.turn === 'BLIND_RECOUNT');
  const where = state ? `${state.frame.bogie.replace('_', ' ')} · ${state.frame.side.replace('_', ' ')}` : '';

  return (
    <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-2 sm:p-4" data-testid="pocket-counter">
      <div className="bg-surface border border-line rounded-panel w-full max-w-3xl max-h-[95vh] overflow-y-auto">
        <div className="px-5 py-3 border-b border-line flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-ink-body">{t('Count the springs in this frame', 'इस फ़्रेम में स्प्रिंग गिनें')}</h3>
            <p className="text-[11px] text-ink-muted mt-0.5">{photo.wagonNumber} · {state?.frame?.designation} · {where}</p>
          </div>
          <button type="button" onClick={onClose} className="text-xs text-ink-muted hover:text-ink-body" data-testid="pocket-close">{t('Close', 'बंद करें')}</button>
        </div>

        <div className="p-5 space-y-4">
          {error && <p className="text-xs text-danger-ink" data-testid="pocket-error">{error}</p>}

          {state && !canCount && !result && (
            <div className="text-xs text-ink-body space-y-2" data-testid="pocket-already">
              {state.turn === 'SAME_PERSON' && <p>{t('You counted this frame. The recount must be by someone else, who has not seen your marks.', 'आपने यह फ़्रेम गिना है। दोबारा गिनती किसी और को करनी होगी, जिसने आपके निशान न देखे हों।')}</p>}
              {state.turn === 'DONE' && <Done state={state} t={t} />}
            </div>
          )}

          {canCount && !result && (
            <>
              <p className="text-[11px] text-ink-muted leading-snug">
                {state.turn === 'BLIND_RECOUNT'
                  ? t(`${state.first?.countedByName || 'Someone'} has counted this frame. Their count is not shown to you: count what you see, and the two are compared afterwards.`, `${state.first?.countedByName || 'किसी'} ने यह फ़्रेम गिना है। उनकी गिनती आपको नहीं दिखाई जाती: जो दिखे उसे गिनें, बाद में दोनों की तुलना होगी।`)
                  : t('Tap each spring you can see, by kind. How many there should be is not shown — count what is in the photograph.', 'हर दिखने वाली स्प्रिंग पर उसके प्रकार से टैप करें। कितनी होनी चाहिए यह नहीं दिखाया जाता — जो फ़ोटो में है उसे गिनें।')}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {POCKET_KINDS.map((k) => (
                  <button key={k} type="button" onClick={() => setKind(k)} data-testid={`pocket-kind-${k}`}
                    className={`px-3 py-1.5 rounded-control text-xs font-bold border ${kind === k ? 'border-white text-white' : 'border-line text-ink-muted'}`}
                    style={{ background: kind === k ? KIND_COLOUR[k] + '33' : undefined }}>
                    <span className="inline-block w-2.5 h-2.5 rounded-full mr-1.5 align-middle" style={{ background: KIND_COLOUR[k] }} />
                    {k.toLowerCase()} <span className="tabular-nums" data-testid={`pocket-tally-${k}`}>{tally(k)}</span>
                  </button>
                ))}
                <button type="button" onClick={() => setTaps((tp) => tp.slice(0, -1))} disabled={taps.length === 0} className="ml-auto text-xs text-ink-muted disabled:opacity-40" data-testid="pocket-undo">{t('Undo last', 'आख़िरी हटाएँ')}</button>
              </div>
            </>
          )}

          <div className="relative select-none bg-black rounded-control overflow-hidden" onClick={place} data-testid="pocket-frame" style={{ cursor: canCount && !result ? 'crosshair' : 'default' }}>
            <img ref={imgRef} src={photo.imageData || photo.imageBase64} alt="" className="w-full max-h-[60vh] object-contain block" draggable={false} />
            {(result ? result.row.taps : taps).map((tp: PocketTap, i: number) => (
              <span key={i} className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white text-[10px] font-black text-black flex items-center justify-center"
                style={{ left: `${tp.x * 100}%`, top: `${tp.y * 100}%`, width: 22, height: 22, background: KIND_COLOUR[tp.kind] }} data-testid="pocket-tap">{i + 1}</span>
            ))}
          </div>

          {canCount && !result && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-ink-muted tabular-nums" data-testid="pocket-total">{t(`${taps.length} marked`, `${taps.length} चिह्नित`)}</span>
              <button type="button" onClick={submit} disabled={busy || taps.length === 0} data-testid="pocket-submit"
                className="min-h-[40px] px-4 rounded-control bg-accent text-white text-xs font-bold disabled:opacity-50">
                {t('Record this count', 'यह गिनती दर्ज करें')}
              </button>
            </div>
          )}

          {result && <Outcome result={result} t={t} />}
        </div>
      </div>
    </div>
  );
};

const Counts: React.FC<{ c: any }> = ({ c }) => <span className="tabular-nums">{c.outer}/{c.inner}/{c.snubber} (= {c.total})</span>;

const Outcome: React.FC<{ result: any; t: (en: string, hi: string) => string }> = ({ result, t }) => {
  const cmp = result.comparison;
  return (
    <div className="space-y-2 text-xs" data-testid="pocket-outcome">
      <p className="text-ink-body">
        {t('You counted', 'आपने गिना')} <Counts c={result.row.counted} /> · {t('this wagon type carries', 'इस वैगन प्रकार में होती हैं')} <Counts c={cmp.expected} /> {t('per side (outer / inner / snubber)', 'प्रति साइड (बाहरी / भीतरी / स्नबर)')}
      </p>
      {cmp.verdict === 'MATCH' && (
        <p className="text-ink-muted" data-testid="pocket-match">
          {t('The count matches the registry. Nothing is raised — a count is a reading of the photograph, not proof the pockets were full; the photograph stays the evidence.', 'गिनती रजिस्ट्री से मेल खाती है। कुछ नहीं उठाया गया — गिनती फ़ोटो का पठन है, पॉकेट भरे होने का प्रमाण नहीं; फ़ोटो ही साक्ष्य है।')}
        </p>
      )}
      {cmp.verdict !== 'MATCH' && (
        <p className={cmp.verdict === 'SHORT' ? 'text-warn-ink font-semibold' : 'text-ink-body font-semibold'} data-testid={`pocket-${cmp.verdict.toLowerCase()}`}>{cmp.message}</p>
      )}
      {cmp.verdict === 'SHORT' && <p className="text-ink-muted">{t('This reaches the exit gate as an advisory the supervisor must acknowledge by name.', 'यह निकास द्वार पर सलाह के रूप में पहुँचेगा जिसे पर्यवेक्षक को नाम से स्वीकार करना होगा।')}</p>}
      {result.agreesWithFirst !== null && (
        <p className="text-ink-body" data-testid="pocket-agree">
          {result.agreesWithFirst ? t('Your recount agrees with the first count.', 'आपकी दोबारा गिनती पहली गिनती से मेल खाती है।') : t('Your recount differs from the first count. Both are on record; the frame decides.', 'आपकी दोबारा गिनती पहली से अलग है। दोनों दर्ज हैं; फ़्रेम तय करेगा।')}
        </p>
      )}
    </div>
  );
};

const Done: React.FC<{ state: any; t: (en: string, hi: string) => string }> = ({ state, t }) => (
  <div className="space-y-1">
    <p>{t('First count', 'पहली गिनती')}: <Counts c={state.first.counted} /> — {state.first.countedByName}</p>
    <p>{t('Blind recount', 'दोबारा गिनती')}: <Counts c={state.recount.counted} /> — {state.recount.countedByName}</p>
    <p>{t('Expected per side', 'प्रति साइड अपेक्षित')}: <Counts c={state.expected} /></p>
    <p className={state.agree ? 'text-ink-muted' : 'text-warn-ink'}>{state.agree ? t('The two counts agree.', 'दोनों गिनतियाँ मेल खाती हैं।') : t('The two counts disagree — look at the frame.', 'दोनों गिनतियाँ अलग हैं — फ़्रेम देखें।')}</p>
    {state.comparison?.verdict !== 'MATCH' && <p className="text-warn-ink">{state.comparison?.message}</p>}
  </div>
);

export default PocketCounter;
