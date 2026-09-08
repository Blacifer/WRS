/**
 * Read a spring photograph blind
 * Indian Railways WRS Raipur
 *
 * WHY THIS EXISTS
 * ---------------
 * Before any model is trained, one question decides whether the DRM's camera
 * is possible at all: can a PERSON read the band from the stored photograph
 * without seeing what the bench recorded? If they cannot, no model can. If
 * they can, the agreement rate is the bar a model must clear — measured
 * before it exists, from the same three weeks of photographs.
 *
 * The server sends the picture and nothing else. The label is compared on
 * the server, from the row the reader never saw. Readers are never offered
 * their own photographs: they would be reading their memory, not the image.
 */

import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api.ts';
import { can } from '../../../shared/auth/permissions.ts';
import { Button } from './ui/index.tsx';

interface Props { lang: 'en' | 'hi'; }
type Img = { id: string; bogieType: string; springPosition: string; imageData: string; mimeType: string };
const BANDS = ['BLUE', 'GREEN', 'YELLOW', 'ORANGE', 'RED', 'WHITE'];

export const BlindSpringRead: React.FC<Props> = ({ lang }) => {
  const isHi = lang === 'hi';
  const [img, setImg] = useState<Img | null | undefined>(undefined);
  const [band, setBand] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const next = useCallback(async () => {
    setError(null); setBand(null);
    try { const r = await api.getNextBlindImage(); setImg(r.data); }
    catch (e: any) { setError(e?.message || 'Could not fetch a photograph.'); setImg(null); }
  }, []);
  useEffect(() => { next(); }, [next]);

  if (!can(api.getUser()?.role, 'spring.record')) return null;

  const submit = async (status: 'PASS' | 'CONDEMNED' | 'CANNOT_TELL') => {
    if (!img) return;
    setBusy(true); setError(null);
    try {
      await api.recordBlindRead({ imageId: img.id, band: status === 'CANNOT_TELL' ? null : band, status });
      setDone((n) => n + 1);
      await next();
    } catch (e: any) { setError(e?.message || 'Could not record the reading.'); }
    finally { setBusy(false); }
  };

  return (
    <section className="bg-card border border-line rounded-card p-5 space-y-3" data-testid="blind-read">
      <div>
        <h3 className="text-sm font-black text-white">{isHi ? 'फ़ोटो को बिना जाने पढ़ें' : 'Read a photograph blind'}</h3>
        <p className="text-[11px] text-ink-muted leading-snug">
          {isHi
            ? 'यह किसी और की फ़ोटो है। बेंच ने क्या दर्ज किया, वह आपको नहीं दिखेगा। जो बैंड आप देखते हैं, वही चुनें — यही तय करेगा कि कैमरा संभव है या नहीं।'
            : 'Somebody else’s photograph. What the bench recorded is not shown. Pick the band you can see — this is what decides whether the camera is possible at all.'}
        </p>
      </div>

      {error && <p className="text-xs font-bold text-bad-ink">{error}</p>}

      {img === null && (
        <p className="text-xs text-ink-muted" data-testid="blind-read-empty">
          {isHi ? 'अभी कोई फ़ोटो नहीं है जिसे आपने न पढ़ा हो।' : 'No photograph left that you have not read.'}
          {done > 0 && ` ${isHi ? `आपने ${done} पढ़ीं।` : `You read ${done}.`}`}
        </p>
      )}

      {img && (
        <div className="space-y-3" data-testid="blind-read-card">
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-ink-muted">
            <span>{img.bogieType}</span><span>·</span><span>{img.springPosition}</span>
            {done > 0 && <span className="ml-auto">{isHi ? `${done} पढ़ीं` : `${done} read`}</span>}
          </div>
          <img src={img.imageData} alt="" className="w-full max-h-80 object-contain rounded-control border border-line bg-black" />
          <div className="flex flex-wrap gap-1.5" data-testid="blind-read-bands">
            {BANDS.map((b) => (
              <button key={b} onClick={() => setBand(b)} disabled={busy}
                className={`min-h-[40px] px-3 rounded-control border text-xs font-black ${band === b ? 'border-accent-line bg-accent-soft text-accent-ink' : 'border-line bg-raised text-ink-body'}`}>
                {b}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => submit('PASS')} disabled={busy || !band} data-testid="blind-read-pass">{isHi ? 'पास' : 'Pass'}</Button>
            <Button onClick={() => submit('CONDEMNED')} disabled={busy || !band} data-testid="blind-read-condemn">{isHi ? 'निंदित' : 'Condemned'}</Button>
            <Button onClick={() => submit('CANNOT_TELL')} disabled={busy} data-testid="blind-read-cannot">{isHi ? 'बता नहीं सकता' : 'Cannot tell from this photo'}</Button>
          </div>
        </div>
      )}
    </section>
  );
};

export default BlindSpringRead;
