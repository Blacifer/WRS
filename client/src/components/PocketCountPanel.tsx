/**
 * Pocket counts on a wagon's assembly frames — what has been counted, by whom, and what it found
 * Indian Railways WRS Raipur
 *
 * One line per assembly photograph. A frame nobody has counted asks for a
 * count; a frame one person has counted asks for a blind recount by someone
 * else, and shows that person nothing of the first; a frame with two counts
 * says whether they agree. A short count is shown to whoever may see it.
 * A matching count is shown as a count, not as a tick.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api.ts';
import { parseAssemblyTags } from '../../../shared/assembly/assemblyCapture.ts';
import type { WagonPhotoRecord } from '../../../shared/types.ts';
import { PocketCounter } from './PocketCounter.tsx';

interface Props { wagonNumber: string; photos: WagonPhotoRecord[]; lang: 'en' | 'hi' }

export const PocketCountPanel: React.FC<Props> = ({ wagonNumber, photos, lang }) => {
  const isHi = lang === 'hi';
  const t = (en: string, hi: string) => (isHi ? hi : en);
  const [frames, setFrames] = useState<any[]>([]);
  const [open, setOpen] = useState<WagonPhotoRecord | null>(null);

  const load = useCallback(() => {
    api.getWagonPocketCounts(wagonNumber).then((r) => setFrames(r.data || [])).catch(() => setFrames([]));
  }, [wagonNumber]);
  useEffect(() => { load(); }, [load, photos.length]);

  const assemblyPhotos = photos
    .map((p) => ({ photo: p, capture: parseAssemblyTags(p.tags) }))
    .filter((x) => x.capture)
    .sort((a, b) => `${a.capture!.bogiePosition}${a.capture!.side}`.localeCompare(`${b.capture!.bogiePosition}${b.capture!.side}`));

  if (assemblyPhotos.length === 0) return null;

  // Fraction slash, not solidus: a template literal of nothing but slashes
  // reads as a route path to the reachability guard, and matches every route.
  const c = (x: any) => (x ? [x.outer, x.inner, x.snubber].join('\u2044') : '—');

  return (
    <div className="bg-card border border-line rounded-card p-4 space-y-2" data-testid="pocket-panel">
      <h4 className="text-sm font-bold text-ink-body">{t('Pocket counts', 'पॉकेट गिनती')}</h4>
      <p className="text-[11px] text-ink-muted">
        {t('A person counts the springs in each frame; a second person recounts without seeing the first. The expected number comes from the wagon type and is compared on the server. A short count reaches the exit gate; a matching count is a count, not a tick.', 'एक व्यक्ति हर फ़्रेम में स्प्रिंग गिनता है; दूसरा पहली गिनती देखे बिना दोबारा गिनता है। अपेक्षित संख्या वैगन प्रकार से आती है और सर्वर पर तुलना होती है।')}
      </p>
      <ul className="divide-y divide-line/60">
        {assemblyPhotos.map(({ photo, capture }) => {
          const f = frames.find((x) => x.photoId === photo.id);
          const at = `${capture!.bogiePosition.replace('_', ' ')} · ${capture!.side.replace('_', ' ')}`;
          let status: React.ReactNode;
          if (!f || !f.first) status = <span className="text-ink-muted">{t('Not counted yet', 'अभी गिना नहीं')}</span>;
          else if (f.blind) status = <span className="text-ink-muted">{t(`Counted by ${f.first.countedByName} — a blind recount by someone else is needed`, `${f.first.countedByName} ने गिना — किसी और की दोबारा गिनती चाहिए`)}</span>;
          else if (!f.recount) status = <span className="text-ink-body">{t(`Counted ${c(f.first.counted)} by ${f.first.countedByName} — recount pending`, `${f.first.countedByName} ने ${c(f.first.counted)} गिना — दोबारा गिनती बाकी`)}</span>;
          else status = <span className={f.agree ? 'text-ink-body' : 'text-warn-ink'}>{t(`${c(f.first.counted)} and ${c(f.recount.counted)} — ${f.agree ? 'agree' : 'disagree'}`, `${c(f.first.counted)} और ${c(f.recount.counted)} — ${f.agree ? 'मेल' : 'अलग'}`)}</span>;
          const worst = [f?.comparison, f?.recountComparison].find((x) => x && x.verdict !== 'MATCH');
          return (
            <li key={photo.id} className="py-2 flex flex-wrap items-center gap-2 text-xs" data-testid={`pocket-frame-${capture!.bogiePosition}-${capture!.side}`}>
              <span className="font-semibold text-ink-body w-40">{at}</span>
              <span className="flex-1 min-w-[12rem]">{status}{worst && <span className="block text-warn-ink mt-0.5" data-testid="pocket-frame-flag">{worst.message}</span>}</span>
              <button type="button" onClick={() => setOpen(photo)} className="min-h-[36px] px-3 rounded-control border border-line bg-raised text-ink-body font-bold" data-testid={`pocket-open-${capture!.bogiePosition}-${capture!.side}`}>
                {!f?.first ? t('Count', 'गिनें') : f.recount ? t('View', 'देखें') : t('Recount', 'दोबारा गिनें')}
              </button>
            </li>
          );
        })}
      </ul>
      {open && <PocketCounter photo={open} lang={lang} onClose={() => { setOpen(null); load(); }} onCounted={load} />}
    </div>
  );
};

export default PocketCountPanel;
