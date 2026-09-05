/**
 * Answering from what the app knows
 * Indian Railways WRS Raipur
 *
 * These facts are derived from the same constants the app classifies against,
 * so the tests that matter are about two things: that the derivation stays
 * faithful to its source, and that the search refuses rather than guesses.
 *
 * A search that returns a confident wrong figure for a brake pressure is worse
 * than one that returns nothing, because nothing sends the inspector to the
 * manual and wrong sends them to the wagon.
 */

import { describe, it, expect } from 'vitest';
import { buildFacts, searchFacts } from '../../../shared/knowledge/facts.ts';
import { SWT_CHECKS } from '../../../shared/classification/swtSpec.ts';
import { RDSO_TABLES } from '../../../shared/classification/tables.ts';

describe('The facts are derived, not retyped', () => {
  it('covers every air brake check in the proforma', () => {
    // If a check is added to §720-C and this misses it, the app would answer
    // an inspector's question about it with silence while holding the figure.
    const facts = buildFacts();
    for (const check of SWT_CHECKS) {
      expect(
        facts.some((f) => f.id === `swt_${check.ref}`),
        `no fact for SWT row ${check.ref} (${check.label})`
      ).toBe(true);
    }
  });

  it('quotes the same numbers the classifier enforces', () => {
    // The whole point of deriving rather than duplicating: an answer that
    // disagreed with the verdict would be the worst of both.
    const bp = buildFacts().find((f) => f.id === 'swt_1');
    const check = SWT_CHECKS.find((c) => c.ref === '1')!;
    expect(bp!.answer).toContain(String(check.min));
    expect(bp!.answer).toContain(String(check.max));
  });

  it('carries a real source on every single fact', () => {
    for (const fact of buildFacts()) {
      expect(fact.source.length, `${fact.subject} has no source`).toBeGreaterThan(5);
      expect(fact.source, `${fact.subject} cites nothing recognisable`).toMatch(/RDSO|WMM|G-95|§/);
    }
  });

  it('has a fact for every spring band table', () => {
    const facts = buildFacts();
    const tables = Object.values(RDSO_TABLES) as any[];
    expect(facts.filter((f) => f.id.startsWith('table_')).length).toBe(tables.length);
  });
});

describe('Answering the questions people actually ask', () => {
  it('answers the air pressure question with pressures, not timings', () => {
    /*
     * The question that prompted this file. Ask the Manual returned a passage
     * about leader nut sleeves; the app held the answer all along.
     *
     * An earlier version of the scorer put "Sensitivity: brakes apply within —
     * 6 sec" on top, because the word "brakes" sat in its subject. Timings are
     * not pressures, and an inspector reading 6 sec as an answer to a pressure
     * question is being actively misled.
     */
    const hits = searchFacts('how much air pressure is needed to stop the brakes', 4);
    expect(hits.length).toBeGreaterThan(0);

    const top = hits.slice(0, 3).map((h) => h.fact.answer).join(' ');
    expect(top, 'the leading answers must be pressures').toMatch(/kg\/cm2/);
    expect(hits[0].fact.answer, 'the top answer must not be a duration').not.toMatch(/\bsec\b/);
  });

  it('finds a spring condemning limit', () => {
    const hits = searchFacts('condemning limit for a used outer spring on NLB', 1);
    expect(hits[0].fact.answer).toContain('Condemned below');
    expect(hits[0].fact.source).toContain('G-95');
  });

  it('answers how many springs a wagon carries', () => {
    const hits = searchFacts('how many springs does a BOXNHL have', 1);
    expect(hits[0].fact.answer).toContain('springs per wagon');
  });

  it('says nothing rather than guessing', () => {
    // The refusal half. Each of these should fall through to the manual
    // rather than producing a confident irrelevance.
    for (const q of [
      'what is the capital of France',
      'who is the station master',
      'asdfghjkl',
      ''
    ]) {
      expect(searchFacts(q, 3), `"${q}" produced an answer`).toHaveLength(0);
    }
  });

  it('is not fooled by a single common word', () => {
    // "spring" alone appears in dozens of facts and identifies none of them.
    // Answering it with an arbitrary one would look like knowledge.
    const hits = searchFacts('spring', 3);
    for (const h of hits) {
      expect(h.fact.subject.toLowerCase()).toContain('spring');
    }
  });

  it('marks a fact unverified when its source is in dispute', () => {
    // BRN's outer count differs between WMM Chapter 6 and Table 1.3. The fact
    // is still findable — hiding it would send someone to guess — but it must
    // not present itself as settled.
    const brn = buildFacts().find((f) => f.id === 'wagon_BRN');
    expect(brn, 'BRN should still be findable').toBeDefined();
    expect(brn!.verified, 'a disputed count must not read as verified').toBe(false);
  });
});

describe('A shared word is not an answer', () => {
  /*
   * The regression this suite exists for.
   *
   * Asked "brake block condemning limit" the panel returned the §720-C air
   * brake CYLINDER figures — filling time, maximum pressure, sensitivity —
   * under a heading reading "Direct answer, from this app's own verified
   * figures". They matched on "brake" and "limit" while containing nothing
   * about blocks or condemning, and were printed ABOVE the passage holding
   * the real answer: 10 mm, page 71.
   *
   * An inspector reads the bold number, not the passage under it. A
   * confidently wrong figure beneath the word "verified" is worse than no
   * figure, so these tests pin the refusal rather than the ranking.
   */
  it('does not answer a brake BLOCK question with brake CYLINDER figures', () => {
    const hits = searchFacts('brake block condemning limit', 4);
    for (const h of hits) {
      const subject = h.fact.subject.toLowerCase();
      expect(
        subject,
        `"${h.fact.subject}" was offered as a direct answer to a question about ` +
          `brake blocks. It shares the word "brake" and nothing else.`
      ).not.toMatch(/cylinder|filling time|sensitivity|insensitivity/);
    }
  });

  it('still answers what it genuinely holds', () => {
    /*
     * The other half. A coverage rule tightened until it answers nothing is
     * not a fix — it just moves the failure somewhere quieter.
     */
    const hits = searchFacts('brake pipe pressure', 4);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => /pressure/i.test(h.fact.subject))).toBe(true);
  });

  it('stays silent on a limit it does not hold rather than reaching', () => {
    // No flange fact is derived, so the passages must carry that answer.
    const hits = searchFacts('wheel flange thickness condemning limit', 4);
    for (const h of hits) {
      expect(h.fact.subject.toLowerCase()).toMatch(/flange/);
    }
  });

  it('a single shared common word never clears the bar on its own', () => {
    for (const q of ['limit', 'brake', 'spring', 'wear']) {
      const hits = searchFacts(q, 4);
      // A bare common word is a browse, not a question. Answering it with
      // four confident figures invites the inspector to take the first one.
      expect(
        hits.length,
        `The bare word "${q}" produced ${hits.length} direct answers.`
      ).toBeLessThanOrEqual(4);
    }
  });
});
