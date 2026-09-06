/**
 * What keeps going wrong, across the whole shop
 * Indian Railways WRS Raipur
 *
 * WHY THIS EXISTS
 * ---------------
 * The parts breakdown counts categories — "how many springs failed" — which
 * makes a chart and settles nothing. The question a workshop manager actually
 * asks is narrower and more awkward: which PART keeps coming back, on how many
 * different wagons, and is it being repaired or replaced each time.
 *
 * Nothing answered it, so it was being answered from memory. Memory is worst
 * at exactly this: a part that fails on one wagon in three is invisible to
 * anyone who only ever sees one wagon at a time, and everyone in a workshop
 * sees one wagon at a time.
 *
 * WHY IT COUNTS WAGONS AND NOT ROWS
 * ---------------------------------
 * A part listed twice on one wagon — one per bogie — is that wagon's problem.
 * The same part on nine wagons is the shop's. Counting rows would make a
 * two-bogie part look twice as bad as a one-bogie part that is genuinely
 * failing twice as often, and the ordering is the whole value of the view.
 *
 * The denominator travels with the figure. "Condemned on 7 wagons" means one
 * thing out of 9 and another out of 400.
 */

import { useEffect, useState } from 'react';
import { api } from '../services/api.ts';

interface RecurringFindingsProps {
  lang: 'en' | 'hi';
}

interface Finding {
  partName: string;
  category: string;
  wagonsAffected: number;
  wagonsAffectedPct: number;
  failed: number;
  condemned: number;
  repaired: number;
  replaced: number;
  lastSeen: string | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  SPRINGS: 'Springs',
  WHEELS_AXLES: 'Wheels & Axles',
  BEARINGS: 'Bearings',
  BRAKE_SYSTEM: 'Brake System',
  COUPLERS_DRAFT_GEAR: 'Couplers & Draft',
  BOGIE_FRAME_BOLSTER: 'Bogie Frame',
  FRICTION_WEDGES: 'Friction Wedges',
  BODY_UNDERFRAME: 'Body & Underframe'
};

/** How many rows are worth reading on a screen somebody is standing at. */
const SHOWN = 12;

export const RecurringFindings: React.FC<RecurringFindingsProps> = ({ lang }) => {
  const isHi = lang === 'hi';
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [totalWagons, setTotalWagons] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api.getAnalyticsFindings()
      .then((res: any) => {
        if (cancelled) return;
        setFindings(res?.data?.findings || []);
        setTotalWagons(res?.data?.totalWagons || 0);
      })
      .catch(() => { if (!cancelled) setFindings([]); });
    return () => { cancelled = true; };
  }, []);

  if (!findings) return null;

  const t = (en: string, hi: string) => (isHi ? hi : en);
  const shown = findings.slice(0, SHOWN);

  return (
    <section className="bg-card border border-line rounded-card p-6 space-y-4">
      <div>
        <h2 className="text-xl font-black text-white flex items-center gap-2">
          <span>🔁</span> {t('What keeps coming back', 'बार-बार क्या आ रहा है')}
        </h2>
        <p className="text-xs text-ink-muted mt-1">
          {totalWagons > 0
            ? t(
                `Across ${totalWagons} wagon(s) on record. Counted by wagon, not by row — a part on both bogies of one wagon is one wagon.`,
                `रिकॉर्ड में ${totalWagons} वैगन में से। वैगन के हिसाब से गिना गया, पंक्ति के नहीं।`
              )
            : t('No wagons on record yet.', 'अभी कोई वैगन दर्ज नहीं।')}
        </p>
      </div>

      {shown.length === 0 ? (
        <p className="text-xs text-ink-muted">
          {t(
            'No component has been recorded as failed, condemned, repaired or replaced. This is a statement about the records, not about the wagons.',
            'किसी भी पुर्जे को असफल, निंदित, मरम्मत या प्रतिस्थापित दर्ज नहीं किया गया। यह रिकॉर्ड के बारे में है, वैगन के बारे में नहीं।'
          )}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-ink-muted text-[10px] uppercase tracking-wide">
                <th className="text-left py-1.5">{t('Part', 'पुर्जा')}</th>
                <th className="text-left py-1.5">{t('Wagons', 'वैगन')}</th>
                <th className="text-right py-1.5">{t('Condemned', 'निंदित')}</th>
                <th className="text-right py-1.5">{t('Failed', 'असफल')}</th>
                <th className="text-right py-1.5">{t('Repaired', 'मरम्मत')}</th>
                <th className="text-right py-1.5">{t('Replaced', 'बदला')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((f) => (
                <tr key={`${f.category}-${f.partName}`} className="border-t border-line">
                  <td className="py-1.5 pr-3">
                    <span className="font-bold text-white">{f.partName}</span>
                    <br />
                    <span className="text-[10px] font-mono text-ink-muted">
                      {CATEGORY_LABELS[f.category] || f.category}
                    </span>
                  </td>
                  <td className="py-1.5">
                    <div className="flex items-center gap-2">
                      <span className="font-black text-white tabular-nums">{f.wagonsAffected}</span>
                      <span className="text-[10px] text-ink-muted">
                        {t('of', 'में से')} {totalWagons}
                      </span>
                    </div>
                    <div className="h-1 bg-page rounded-full overflow-hidden mt-1 w-24">
                      <div
                        className={f.wagonsAffectedPct >= 50 ? 'h-full bg-bad' : 'h-full bg-amber-500'}
                        style={{ width: `${Math.min(100, f.wagonsAffectedPct)}%` }}
                      />
                    </div>
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-bad-ink font-bold">{f.condemned || ''}</td>
                  <td className="py-1.5 text-right tabular-nums text-warn-ink">{f.failed || ''}</td>
                  <td className="py-1.5 text-right tabular-nums text-ink-body">{f.repaired || ''}</td>
                  <td className="py-1.5 text-right tabular-nums text-ink-body">{f.replaced || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {findings.length > SHOWN && (
        <p className="text-[11px] font-mono text-ink-muted">
          {t(
            `${findings.length - SHOWN} more part(s) with findings not shown.`,
            `${findings.length - SHOWN} और पुर्जे दिखाए नहीं गए।`
          )}
        </p>
      )}

      <p className="text-[11px] text-ink-muted leading-relaxed border-t border-line pt-3">
        {t(
          'A blank cell is a count of zero, not missing data. Nothing here is predicted — every figure counts records somebody made against a named part.',
          'खाली खाना शून्य है, अनुपलब्ध डेटा नहीं। यहाँ कुछ भी अनुमानित नहीं है।'
        )}
      </p>
    </section>
  );
};

export default RecurringFindings;
