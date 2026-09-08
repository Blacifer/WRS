/**
 * What a camera could tell an inspector, and how far off it is
 * Indian Railways WRS Raipur
 *
 * WHY THIS EXISTS
 * ---------------
 * The DRM asked for a camera that looks at a spring and says which kind it is,
 * which band, and whether it is rusted or damaged. Three of those four things
 * are reachable and one is not, and the difference is not a matter of effort.
 * Until now the only answer available was a conversation.
 *
 * This panel replaces that conversation with the shop's own numbers: how many
 * labelled photographs exist, of what, and what each count unlocks. Nothing
 * here is a projection — every figure is a count of images already taken on
 * this bench and labelled by the inspector who tapped the band.
 *
 * WHERE THE LABELS COME FROM, AND WHY THAT MATTERS
 * ------------------------------------------------
 * Sorting already asks the inspector for the answer: the position from the
 * selector at the top, the band from the strip, pass or condemned from the
 * verdict. Turning on "Photograph springs while sorting" saves a frame against
 * that answer. So the labelling is free — it is the work being done anyway —
 * and every shift the camera is left on produces a few hundred examples that
 * cost nobody a tap.
 *
 * That is the whole route from where this is now to what was asked for. It is
 * why the toggle matters more than any model does today.
 */

import { useEffect, useState } from 'react';
import { api } from '../services/api.ts';

interface VisionReadinessProps {
  lang: 'en' | 'hi';
}

interface Capability {
  /** What the DRM asked for, in his words. */
  ask: string;
  /** Whether a photograph can ever answer it. */
  reachable: boolean;
  /** Images labelled for this specific question. */
  have: number;
  /** Enough to attempt something and score it honestly. */
  attemptAt: number;
  /** Enough to depend on, given class balance. */
  trustAt: number;
  /** The honest sentence about this capability. */
  note: string;
}

/*
 * Thresholds match the ones already used by /api/photos/dataset, so the two
 * places that talk about readiness cannot disagree with each other.
 */
const ATTEMPT_AT = 200;
const TRUST_AT = 1000;

/** The row ceiling GET /photos/dataset/assembly enforces. */
const ASSEMBLY_LIMIT = 2000;

export const VisionReadiness: React.FC<VisionReadinessProps> = ({ lang }) => {
  const isHi = lang === 'hi';
  const [caps, setCaps] = useState<Capability[] | null>(null);
  const [total, setTotal] = useState(0);
  const [thinnest, setThinnest] = useState<string | null>(null);
  /*
   * The A0 number. Whether a second person can read the band from the stored
   * photograph decides the camera before any model exists, and the decision
   * rule was fixed in the plan before there was data to bend it toward.
   */
  const [blind, setBlind] = useState<{ bandRead: number; bandAgreementPct: number | null; cannotTell: number; readers: number; verdict: string; minReads: number } | null>(null);
  /*
   * Assembly coverage is fetched separately and allowed to fail on its own.
   * A shop that has photographed springs but never a bogie is the normal
   * starting state, and it must not blank the spring figures beside it.
   */
  const [assembly, setAssembly] = useState<{
    completeBogies: number;
    partialBogies: number;
    totalPhotos: number;
    unusablePhotos: number;
    readiness: string;
    negativesWarning: string;
    capped: boolean;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    api.getSortingDataset()
      .then((res: any) => {
        if (cancelled) return;
        const data = res?.data || {};
        const byLabel: any[] = data.byLabel || [];
        setTotal(data.total || 0);

        const sum = (pred: (r: any) => boolean) =>
          byLabel.filter(pred).reduce((n, r) => n + (r.count || 0), 0);

        /*
         * Class balance decides readiness far more than the total does, so the
         * thinnest position is reported rather than hidden inside a sum. A set
         * of two thousand outer springs and eleven snubbers trains a model
         * that has never really seen a snubber.
         */
        const positions = ['OUTER', 'INNER', 'SNUBBER'];
        const perPosition = positions.map((p) => ({
          position: p,
          count: sum((r) => r.springPosition === p)
        }));
        const weakest = perPosition.reduce((a, b) => (b.count < a.count ? b : a));
        setThinnest(perPosition.some((p) => p.count > 0) ? `${weakest.position} (${weakest.count})` : null);

        setCaps([
          {
            ask: isHi ? 'यह कौन सा स्प्रिंग है — आउटर, इनर या स्नबर' : 'Which spring this is — outer, inner or snubber',
            reachable: true,
            // A classifier is only as ready as its thinnest class.
            have: weakest.count,
            attemptAt: ATTEMPT_AT,
            trustAt: TRUST_AT,
            note: isHi
              ? 'तीनों दिखने में अलग हैं — व्यास, फेरे, तार की मोटाई। यह सबसे आसान हिस्सा है।'
              : 'The three differ visibly — diameter, coil count, wire thickness. This is the easy one, and the count shown is the thinnest class, not the total.'
          },
          {
            ask: isHi ? 'जंग या क्षति है या नहीं' : 'Whether it is rusted or damaged',
            reachable: true,
            have: sum((r) => r.status === 'CONDEMNED'),
            attemptAt: ATTEMPT_AT,
            trustAt: TRUST_AT,
            note: isHi
              ? 'दरार और जंग दिखते हैं। हर निंदा एक उदाहरण जोड़ती है।'
              : 'Cracks and corrosion are visible things, so this is learnable. Every condemnation adds a labelled example; the count here is condemned springs photographed.'
          },
          {
            ask: isHi ? 'कौन सा बैंड' : 'Which band it falls in',
            reachable: false,
            have: sum((r) => !!r.band),
            attemptAt: ATTEMPT_AT,
            trustAt: TRUST_AT,
            note: isHi
              ? 'नंगी फ़ोटो से कभी नहीं — बैंड 3 मिमी का होता है और फ़ोटो में पैमाना नहीं होता। लेकिन गेज को देखकर पढ़ना सम्भव है।'
              : 'Never from a photograph of the spring alone: a band is 3 mm on a 260 mm component and a photograph carries no scale. But a fixed camera watching the GAUGE — reading where the spring sits against the marked post — is a different and solvable problem. That is the route, if this one is wanted.'
          }
        ]);
      })
      .catch(() => { if (!cancelled) setCaps([]); });

    /*
     * ASSEMBLY_LIMIT is the ceiling the route itself enforces. Coverage is
     * summarised over the rows actually fetched, so asking for fewer would
     * quietly understate how many bogies are covered. When the count comes
     * back at the ceiling the figures are a floor, not a total, and the panel
     * says so rather than letting a truncated number read as complete.
     */
    api.getBlindReadAgreement()
      .then((res) => { if (!cancelled && res?.data) setBlind(res.data); })
      .catch(() => { /* nothing read yet, or not permitted — say nothing */ });

    api.getAssemblyDataset(ASSEMBLY_LIMIT)
      .then((res: any) => {
        if (cancelled) return;
        const d = res?.data;
        if (!d) return;
        setAssembly({
          completeBogies: d.completeBogies || 0,
          partialBogies: d.partialBogies || 0,
          totalPhotos: d.totalPhotos || 0,
          unusablePhotos: d.unusablePhotos || 0,
          readiness: d.readiness || '',
          negativesWarning: d.negativesWarning || '',
          capped: (d.totalPhotos || 0) + (d.unusablePhotos || 0) >= ASSEMBLY_LIMIT
        });
      })
      .catch(() => { /* no assembly evidence yet, or not permitted — say nothing */ });

    return () => { cancelled = true; };
  }, [isHi]);

  if (!caps) return null;

  return (
    <section className="bg-card border border-line rounded-card p-6 space-y-4">
      <div>
        <h2 className="text-xl font-black text-white flex items-center gap-2">
          <span>📷</span> {isHi ? 'कैमरा क्या बता सकेगा' : 'What a camera could tell an inspector'}
        </h2>
        <p className="text-xs text-ink-muted mt-1">
          {isHi
            ? `इस बेंच पर ली गई ${total} लेबल की गई तस्वीरें। कोई अनुमान नहीं — सब गिनती है।`
            : `${total} labelled photographs taken on this bench. Not a projection — every figure is a count.`}
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {caps.map((c, i) => {
          const pct = Math.min(100, Math.round((c.have / c.trustAt) * 100));
          const state = !c.reachable
            ? 'stop'
            : c.have >= c.trustAt ? 'good'
            : c.have >= c.attemptAt ? 'watch' : 'neutral';
          const tone = {
            good: 'border-good-line bg-good-soft',
            watch: 'border-warn-line bg-warn-soft',
            stop: 'border-bad-line bg-bad-soft',
            neutral: 'border-line bg-raised'
          }[state];

          return (
            <div key={i} className={`rounded-control border p-4 flex flex-col gap-2 ${tone}`}>
              <p className="text-[11px] font-mono uppercase tracking-wide text-ink-muted leading-snug">{c.ask}</p>

              {c.reachable ? (
                <>
                  <p className="text-2xl font-black text-white tabular-nums leading-none">
                    {c.have}
                    <span className="text-xs font-bold text-ink-muted"> / {c.attemptAt}</span>
                  </p>
                  <div className="h-1.5 bg-page rounded-full overflow-hidden">
                    <div className="h-full bg-sky-500" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-[11px] font-bold text-ink-body">
                    {c.have >= c.trustAt
                      ? (isHi ? 'भरोसे लायक मात्रा' : 'Enough to depend on')
                      : c.have >= c.attemptAt
                      ? (isHi ? 'प्रयास के लायक' : 'Worth attempting and scoring')
                      : (isHi ? `${c.attemptAt - c.have} और चाहिए` : `${c.attemptAt - c.have} more before this is worth attempting`)}
                  </p>
                </>
              ) : (
                <p className="text-lg font-black text-bad-ink leading-tight">
                  {isHi ? 'नंगी फ़ोटो से नहीं' : 'Not from a photograph alone'}
                </p>
              )}

              <p className="text-[11px] text-ink-muted leading-snug mt-auto">{c.note}</p>
            </div>
          );
        })}
      </div>

      <div className="rounded-control border border-line bg-raised p-4 space-y-1.5">
        <p className="text-sm font-bold text-white">
          {isHi ? 'इसे आगे बढ़ाने का एक ही तरीका' : 'There is one thing that moves all of this'}
        </p>
        <p className="text-xs text-ink-body leading-relaxed">
          {isHi
            ? 'छँटाई स्क्रीन पर "छँटाई के साथ फ़ोटो लें" चालू रखें। इंस्पेक्टर पहले से ही उत्तर बता रहा है — स्थिति, बैंड, पास या निंदा — तो हर फ़ोटो अपने आप लेबल हो जाती है। कोई अतिरिक्त टैप नहीं।'
            : 'Leave "Photograph springs while sorting" switched on. The inspector is already giving the answer — position, band, pass or condemned — so every frame is labelled for free, at no extra tap. A shift with the camera on is a few hundred examples; without it, none.'}
        </p>
        {thinnest && (
          <p className="text-[11px] font-mono text-ink-muted pt-1">
            {isHi ? 'सबसे कम: ' : 'Thinnest class: '}{thinnest}
          </p>
        )}
      </div>

      {blind && blind.bandRead > 0 && (
        <div className="rounded-control border border-line bg-raised p-4 space-y-1.5" data-testid="blind-read-agreement">
          <p className="text-sm font-bold text-white">
            {isHi ? 'क्या फ़ोटो से बैंड पढ़ा जा सकता है — लोगों का उत्तर' : 'Can the band be read from a photograph — the people’s answer'}
          </p>
          <p className="text-2xl font-black text-white tabular-nums leading-none">
            {blind.bandAgreementPct}%
            <span className="text-xs font-bold text-ink-muted"> {isHi ? `सहमति, ${blind.bandRead} पढ़ाई, ${blind.readers} पाठक` : `agreement over ${blind.bandRead} blind reads by ${blind.readers} reader(s)`}</span>
          </p>
          <p className="text-[11px] text-ink-body leading-snug">
            {blind.verdict === 'INSUFFICIENT'
              ? (isHi ? `निर्णय के लिए कम से कम ${blind.minReads} पढ़ाई चाहिए।` : `No verdict yet — at least ${blind.minReads} blind reads are needed before this number means anything.`)
              : blind.verdict === 'ASSIST'
                ? (isHi ? 'लोग बैंड पढ़ सकते हैं। कैमरा बैंड सुझा सकता है; व्यक्ति पुष्टि करता है।' : 'People can read the band from these photographs. A camera may propose a band; the person confirms.')
                : blind.verdict === 'FLAG_ONLY'
                  ? (isHi ? 'आंशिक। कैमरा केवल “अलग दिखता है” का झंडा उठा सकता है, बैंड नहीं सुझा सकता।' : 'Partial. A camera may only flag a spring as unlike the others — it may not propose a band.')
                  : (isHi ? 'नहीं। इन फ़ोटो से बैंड नहीं पढ़ा जा सकता — यही DRM को बताने की बात है।' : 'No. The band cannot be read from these photographs, and that is the result to report — not a failure to try.')}
            {blind.cannotTell > 0 && ` ${isHi ? `${blind.cannotTell} बार “बता नहीं सकता”।` : `“Cannot tell” ${blind.cannotTell} time(s).`}`}
          </p>
        </div>
      )}

      {/*
        * A second, different question, kept visibly separate from the three
        * above. Those ask what a photograph can say about ONE SPRING. This asks
        * whether a pocket was left empty, and it is counted per bogie rather
        * than per photograph — one side of a CASNUB cannot answer it, so a
        * bogie shot from one side is a partial, not a sample.
        *
        * Rendered only once some assembly evidence exists. A row of zeroes on
        * a shop that has not started this capture teaches nobody anything.
        */}
      {assembly && assembly.totalPhotos > 0 && (
        <div className="rounded-control border border-line bg-raised p-4 space-y-1.5" data-testid="assembly-coverage">
          <p className="text-sm font-bold text-white">
            {isHi ? 'बोगी असेंबली — कितनी बोगी पूरी तरह फ़ोटो में हैं' : 'Bogie assembly — how many bogies are covered from every side'}
          </p>
          <p className="text-2xl font-black text-white tabular-nums leading-none">
            {assembly.completeBogies}
            <span className="text-xs font-bold text-ink-muted">
              {isHi ? ' पूरी' : ' complete'}
            </span>
            <span className="text-xs font-bold text-ink-muted">
              {' · '}{assembly.partialBogies}{isHi ? ' अधूरी' : ' partial'}
            </span>
          </p>
          {/*
            * The server's own sentence, not a second opinion computed here.
            * Two places deciding what a count means is how they end up
            * disagreeing in front of the person who has to act on it.
            */}
          <p className="text-xs text-ink-body leading-relaxed">{assembly.readiness}</p>
          <p className="text-[11px] text-warn-ink leading-snug">{assembly.negativesWarning}</p>
          {assembly.unusablePhotos > 0 && (
            <p className="text-[11px] font-mono text-ink-muted">
              {isHi
                ? `${assembly.unusablePhotos} तस्वीरें टैग अधूरा होने से गिनी नहीं गईं`
                : `${assembly.unusablePhotos} photograph(s) carry the marker tag but are missing a field, so they are not counted as samples`}
            </p>
          )}
          {assembly.capped && (
            <p className="text-[11px] font-mono text-ink-muted">
              {isHi
                ? `सबसे हाल की ${ASSEMBLY_LIMIT} तस्वीरों पर आधारित — यह न्यूनतम है, कुल नहीं।`
                : `Counted over the most recent ${ASSEMBLY_LIMIT} photographs — these figures are a floor, not a total.`}
            </p>
          )}
        </div>
      )}
    </section>
  );
};

export default VisionReadiness;
