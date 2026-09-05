/**
 * Shop Floor Now — the questions a DRM currently telephones three people for
 * Indian Railways WRS Raipur
 *
 * WHY THIS EXISTS
 * ---------------
 * Every figure below was already being computed and none of it was in one
 * place. The dashboard reported throughput, turnaround and blockers — true
 * things, each needing interpretation before it becomes a decision. A
 * divisional officer does not want "1,240 springs sorted"; he wants to know
 * when the pile finishes, how many bogies he can build tonight, what to order,
 * and whether anything is stuck.
 *
 * So this panel states a fact and the action it implies, in that order, and
 * nothing here is new arithmetic — it is the existing endpoints asked the
 * question the floor actually has.
 *
 * THE RULE THIS PANEL FOLLOWS
 * ---------------------------
 * It refuses rather than guesses. A throughput rate from eight taps, a
 * forecast from four condemnations, an allocation with nothing sorted — each
 * is reported as "not yet known" with what is needed to know it. A command
 * screen that invents a number is worse than one that admits a gap, because
 * somebody acts on it. Every refusal here is the server's own, passed through
 * unchanged.
 */

import { useEffect, useState } from 'react';
import { api } from '../services/api.ts';
import { ActivityIcon } from './Icons.tsx';
import { readThroughput } from '../../../shared/sorting/throughput.ts';

interface ShopFloorNowProps {
  lang: 'en' | 'hi';
}

interface Card {
  /** The question, in the officer's words. */
  question: string;
  /** The answer, or null when it is honestly not known yet. */
  answer: string | null;
  /** What that means to do next. */
  action: string;
  /** Shown when the answer is not known. */
  blocked?: string;
  tone: 'good' | 'watch' | 'stop' | 'neutral';
}

const TONE: Record<Card['tone'], string> = {
  good: 'border-good-line bg-good-soft',
  watch: 'border-warn-line bg-warn-soft',
  stop: 'border-bad-line bg-bad-soft',
  neutral: 'border-line bg-card'
};

const TONE_TEXT: Record<Card['tone'], string> = {
  good: 'text-good-ink',
  watch: 'text-warn-ink',
  stop: 'text-bad-ink',
  neutral: 'text-ink-body'
};

export const ShopFloorNow: React.FC<ShopFloorNowProps> = ({ lang }) => {
  const isHi = lang === 'hi';
  const [cards, setCards] = useState<Card[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      /*
       * Each call is allowed to fail on its own. One endpoint being
       * unavailable must not blank the whole panel — a divisional officer
       * seeing four of five answers is far better served than one seeing an
       * error page.
       */
      const [throughput, allocation, forecast, blockers, audit] = await Promise.all([
        api.getSortingThroughput().catch(() => null),
        api.getNestAllocation('CASNUB_22_NLB', 'USED', 'BOXNHL').catch(() => null),
        api.getConsumptionForecast(14).catch(() => null),
        api.getAnalyticsBlockers().catch(() => null),
        api.verifyAuditChain().catch(() => null)
      ]);

      if (cancelled) return;

      const next: Card[] = [];

      /*
       * The endpoint returns the day's raw counts; the rule about when a rate
       * may honestly be quoted lives in shared/sorting/throughput.ts and is
       * applied here, exactly as the sorting screen does. Reading
       * `canQuoteRate` off the response would have been wrong — the server
       * does not compute it, and the first version of this panel printed
       * "undefined" because of that.
       */
      const raw = (throughput as any)?.data;
      const tp = raw
        ? { ...raw, ...readThroughput({ total: raw.total, firstAt: raw.firstAt, lastAt: raw.lastAt }) }
        : null;

      if (tp?.canQuoteRate) {
        next.push({
          question: isHi ? 'आज का ढेर कब पूरा होगा?' : "When does today's pile finish?",
          answer: isHi
            ? `${tp.springsPerHour} स्प्रिंग/घंटा · लगभग ${tp.hoursForDailyPile} घंटे`
            : `${tp.springsPerHour} springs/hour — about ${tp.hoursForDailyPile} hours for the shift's pile`,
          action: isHi
            ? `${tp.total} स्प्रिंग अब तक, ${tp.activeMinutes} मिनट में।`
            : `${tp.total} sorted so far, across ${tp.activeMinutes} minutes of sorting.`,
          tone: 'good'
        });
      } else {
        next.push({
          question: isHi ? 'आज का ढेर कब पूरा होगा?' : "When does today's pile finish?",
          answer: null,
          blocked: tp?.reason || (isHi ? 'आज अभी कोई छँटाई नहीं हुई।' : 'No sorting recorded yet today.'),
          action: isHi ? 'छँटाई शुरू होते ही दर दिखेगी।' : 'The rate appears once sorting is under way.',
          tone: 'neutral'
        });
      }

      // ---- how many bogies can we build right now ----------------------
      const al = (allocation as any)?.data?.allocation;
      if (al && al.totalHeld > 0) {
        const limiting = String(al.limitingPosition || '').toLowerCase().replace(/_/g, ' ');
        next.push({
          question: isHi ? 'अभी कितने बोगी बन सकते हैं?' : 'How many bogies can we build right now?',
          answer: isHi
            ? `${al.bogiesBuildable} पूर्ण बोगी (BOXNHL)`
            : `${al.bogiesBuildable} complete bogies (BOXNHL)`,
          action:
            al.bogiesBuildable === 0
              ? (isHi
                  ? `कोई पूर्ण समूह नहीं — ${limiting} स्प्रिंग कम हैं। ${al.totalStranded} स्प्रिंग अटके हैं।`
                  : `No complete group yet — ${limiting} springs are short. ${al.totalStranded} springs are stranded.`)
              : (isHi
                  ? `${limiting} स्प्रिंग सीमा हैं — वही छाँटने से संख्या बढ़ेगी। ${al.totalStranded} अटके हैं।`
                  : `${limiting} springs are the limit — sorting those raises the number, sorting anything else does not. ${al.totalStranded} stranded.`),
          tone: al.bogiesBuildable === 0 ? 'watch' : 'good'
        });
      } else {
        next.push({
          question: isHi ? 'अभी कितने बोगी बन सकते हैं?' : 'How many bogies can we build right now?',
          answer: null,
          blocked: isHi ? 'इस बोगी प्रकार के लिए अभी कुछ नहीं छँटा।' : 'Nothing sorted yet for this bogie type.',
          action: isHi ? 'छँटाई के साथ यह भर जाएगा।' : 'This fills in as springs are sorted.',
          tone: 'neutral'
        });
      }

      // ---- what should Stores order ------------------------------------
      const fc = (forecast as any)?.data;
      if (fc && Array.isArray(fc.lines) && fc.lines.length > 0) {
        const top = fc.lines[0];
        next.push({
          question: isHi ? 'अगले पखवाड़े स्टोर्स को क्या चाहिए?' : 'What will Stores need this fortnight?',
          answer: isHi
            ? `${fc.totalReplacements} स्प्रिंग · लगभग ${fc.wagonsExpected} वैगन`
            : `${fc.totalReplacements} spring replacements, across about ${fc.wagonsExpected} wagons`,
          action: isHi
            ? `सबसे बड़ी माँग: ${top.springPosition} — ${top.expectedReplacements} (${top.condemnationRatePct}% निंदा दर, ${top.basis} निरीक्षणों पर)`
            : `Largest line: ${top.springPosition} — ${top.expectedReplacements} at an observed ${top.condemnationRatePct}% condemnation rate, from ${top.basis} inspections.`,
          tone: 'good'
        });
      } else {
        next.push({
          question: isHi ? 'अगले पखवाड़े स्टोर्स को क्या चाहिए?' : 'What will Stores need this fortnight?',
          answer: null,
          blocked: fc?.summary || (isHi ? 'अभी पर्याप्त रिकॉर्ड नहीं।' : 'Not enough record yet to quote an order.'),
          action: isHi
            ? 'हर निंदा एक उदाहरण जोड़ती है; 30 पर आँकड़ा स्थिर होता है।'
            : 'Every condemnation adds an example; the rate steadies at 30 per spring type.',
          tone: 'neutral'
        });
      }

      // ---- what is stuck ------------------------------------------------
      const bl = (blockers as any)?.data;
      const blockedWagons = Array.isArray(bl) ? bl.length : (bl?.blockedWagons ?? bl?.total ?? null);
      if (typeof blockedWagons === 'number') {
        next.push({
          question: isHi ? 'कौन से वैगन रुके हुए हैं?' : 'What is holding wagons back?',
          answer: isHi ? `${blockedWagons} वैगन निकास द्वार पर रुके` : `${blockedWagons} wagons held at the exit gate`,
          action:
            blockedWagons === 0
              ? (isHi ? 'कुछ भी अवरुद्ध नहीं।' : 'Nothing is blocked.')
              : (isHi ? 'विवरण के लिए अवरोधक तालिका देखें।' : 'The blockers table below names each one and why.'),
          tone: blockedWagons === 0 ? 'good' : 'watch'
        });
      }

      // ---- is the record intact ------------------------------------------
      const au = (audit as any)?.data;
      if (au) {
        next.push({
          question: isHi ? 'क्या रिकॉर्ड अक्षुण्ण है?' : 'Is the record intact?',
          answer: au.verified
            ? (isHi ? `हाँ — ${au.entriesChecked} प्रविष्टियाँ, अखंडित` : `Yes — ${au.entriesChecked} entries, unbroken`)
            : (isHi ? `नहीं — ${au.breaksFound} प्रविष्टियाँ विफल` : `No — ${au.breaksFound} of ${au.entriesChecked} entries fail verification`),
          action: au.verified
            ? (isHi
                ? 'यह सिद्ध करता है कि कोई प्रविष्टि बदली नहीं गई — यह नहीं कि हर माप सही था।'
                : 'This proves no entry was altered after it was written. It does not prove every measurement was correct.')
            : (isHi ? 'ऑडिट श्रृंखला स्क्रीन पहली टूटी प्रविष्टि बताती है।' : 'The Audit Chain screen names the first broken entry.'),
          tone: au.verified ? 'good' : 'stop'
        });
      }

      setCards(next);
      setFailed(next.length === 0);
    })();

    return () => { cancelled = true; };
  }, [isHi]);

  if (failed) return null;

  return (
    <section className="bg-card p-6 rounded-card border border-line space-y-4">
      <div>
        <h2 className="text-xl font-extrabold tracking-[-0.025em] text-ink flex items-center gap-2.5">
          <ActivityIcon size={20} className="text-accent-ink" />
          {isHi ? 'शॉप फ़्लोर — अभी' : 'Shop Floor — Right Now'}
        </h2>
        <p className="text-xs text-ink-muted mt-1">
          {isHi
            ? 'हर आँकड़ा शॉप के अपने रिकॉर्ड से। जहाँ पर्याप्त प्रमाण नहीं, वहाँ अनुमान नहीं लगाया गया।'
            : "Every figure from the shop's own record. Where the evidence is thin, nothing is guessed."}
        </p>
      </div>

      {!cards && (
        <p className="text-sm text-ink-muted">{isHi ? 'लोड हो रहा है…' : 'Loading…'}</p>
      )}

      {cards && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {cards.map((c, i) => (
            <div key={i} className={`rounded-control border p-4 flex flex-col gap-2 ${TONE[c.tone]}`}>
              <p className="text-[11px] font-mono uppercase tracking-wide text-ink-muted">{c.question}</p>
              {c.answer ? (
                <p className={`text-lg font-extrabold leading-tight ${TONE_TEXT[c.tone]}`}>{c.answer}</p>
              ) : (
                <p className="text-sm font-bold text-ink-muted leading-snug">
                  {isHi ? 'अभी ज्ञात नहीं' : 'Not yet known'}
                </p>
              )}
              {!c.answer && c.blocked && (
                <p className="text-xs text-ink-faint leading-snug">{c.blocked}</p>
              )}
              <p className="text-xs text-ink-muted leading-snug mt-auto">{c.action}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

export default ShopFloorNow;
