/**
 * What the app already knows, made askable
 * Indian Railways WRS Raipur
 *
 * THE PROBLEM THIS SOLVES
 * -----------------------
 * Someone asked the app "how much air pressure is needed to stop the brakes".
 * Ask the Manual searched 659 pages of PDF text and returned a passage about
 * leader nut sleeves and a test-rig regulator setting. Useless.
 *
 * Meanwhile the app already held the answer, verified and sourced: brake pipe
 * pressure 4.9–5.1 kg/cm², BP reduction for full service 1.3–1.6, maximum
 * brake cylinder pressure 3.7–3.9, all from WMM 2.0 §720-C.
 *
 * The gap was never that we needed a language model to read the manual. It was
 * that the app could not search its own knowledge. Full-text search over a PDF
 * finds documents that contain your words; it does not find answers, and the
 * best answers here are not in prose at all — they are in the tables this
 * system was built from.
 *
 * WHAT THIS IS AND IS NOT
 * -----------------------
 * Every fact here is DERIVED from the constants the app already classifies
 * against. Nothing is retyped. If a tolerance changes, the fact changes with
 * it, because they are the same data read two ways. A second copy of the
 * numbers would drift, and a search index that disagrees with the classifier
 * is worse than no search at all.
 *
 * It answers only what it actually knows, and says so plainly when it does
 * not. That leaves the long tail — procedures, failure modes, "what do I do
 * if" — to the manual passages, which is what full-text search is genuinely
 * good for.
 */

import { SWT_CHECKS, PISTON_STROKE_MM } from '../classification/swtSpec.ts';
import { RDSO_TABLES } from '../classification/tables.ts';
import { WAGON_SPRING_CONFIGS, springsPerWagon } from '../classification/wagonTypes.ts';

export interface Fact {
  id: string;
  /** What this is about, as a person would name it. */
  subject: string;
  /** The answer, already phrased for reading. */
  answer: string;
  /** Where it comes from. Every fact has one; that is the point. */
  source: string;
  /** Words that should find this fact, beyond those already in the subject. */
  terms: string[];
  /**
   * False when the underlying figure is not signed off. Such facts are still
   * findable — hiding them would just send someone to guess — but they say so.
   */
  verified: boolean;
}

/** kg/cm², seconds, mm — rendered as the shop would say it. */
function range(min: number | undefined, max: number | undefined, unit: string): string {
  if (min !== undefined && max !== undefined) return `${min}–${max} ${unit}`;
  if (max !== undefined) return `not more than ${max} ${unit}`;
  if (min !== undefined) return `at least ${min} ${unit}`;
  return `— ${unit}`;
}

/**
 * Builds the fact list from the app's own constants.
 *
 * Rebuilt on each call rather than cached: it is a few hundred small objects,
 * and a stale cache is exactly how a search index starts disagreeing with the
 * classifier it was derived from.
 */
export function buildFacts(): Fact[] {
  const facts: Fact[] = [];

  // ------------------------------------------------ air brake, §720-C ------
  for (const check of SWT_CHECKS) {
    const answer = check.observational
      ? `${check.expected ?? 'Observed behaviour — no numeric limit.'}`
      : range(check.min, check.max, check.unit);

    facts.push({
      id: `swt_${check.ref}`,
      subject: check.label,
      answer,
      source: `${check.source} — single wagon test, row ${check.ref}`,
      terms: [
        'air', 'brake', 'pressure', 'single wagon test', 'swt', '720',
        check.unit, check.labelHi ?? ''
      ],
      verified: true
    });
  }

  for (const [wagonType, stroke] of Object.entries(PISTON_STROKE_MM)) {
    facts.push({
      id: `stroke_${wagonType}`,
      subject: `Piston stroke — ${wagonType}`,
      answer:
        `Empty ${stroke.empty[0]}–${stroke.empty[1]} mm` +
        (stroke.loaded ? `, loaded ${stroke.loaded[0]}–${stroke.loaded[1]} mm` : ', no loaded figure published'),
      source: 'WMM 2.0 §308B',
      terms: ['piston', 'stroke', 'brake cylinder', wagonType, 'mm'],
      verified: true
    });
  }

  // ------------------------------------------- spring bands, G-95 ----------
  for (const table of Object.values(RDSO_TABLES) as any[]) {
    const bogie = String(table.bogieType).replace(/_/g, ' ');
    facts.push({
      id: `table_${table.tableNumber}_${table.position}`.replace(/\s+/g, '_'),
      subject: `${bogie} ${String(table.condition).toLowerCase()} ${String(table.position).toLowerCase()} spring — free height`,
      answer:
        `Nominal ${table.nominalFreeHeight} mm. Condemned below ${table.condemningMinHeight} mm. ` +
        `${table.bands.length} bands: ` +
        table.bands.map((b: any) => `${b.band} ${b.minHeight}–${b.maxHeight}`).join(', ') + ' mm.',
      source: `RDSO G-95 Rev-II ${table.tableNumber}`,
      terms: [
        'spring', 'free height', 'band', 'condemning', 'condemn', 'colour', 'color',
        String(table.position).toLowerCase(), String(table.condition).toLowerCase(),
        bogie.toLowerCase(), 'mm'
      ],
      verified: true
    });
  }

  // ------------------------------------------- springs per wagon -----------
  for (const w of WAGON_SPRING_CONFIGS) {
    facts.push({
      id: `wagon_${w.designation}`.replace(/[^A-Za-z0-9_]/g, '_'),
      subject: `${w.designation} — springs and bogie`,
      answer:
        `${w.bogieDescription} at ${w.axleLoad}. Per bogie: ${w.counts.outer} outer, ` +
        `${w.counts.inner} inner, ${w.counts.snubber} snubber. ` +
        `${springsPerWagon(w)} springs per wagon.` +
        (w.bogieType ? '' : ' No G-95 band table held for this bogie — springs are counted, not classified.'),
      source: w.tableRef,
      terms: [
        w.designation.toLowerCase(), 'wagon', 'springs', 'how many', 'count',
        'bogie', w.bogieDescription.toLowerCase(), w.axleLoad
      ],
      verified: !w.notes?.includes('CONFLICT')
    });
  }

  return facts;
}

/**
 * Strips a trailing plural 's' so "brakes" and "brake" are the same word.
 *
 * Crude, and deliberately so — this is a fixed technical vocabulary, not
 * English at large. It matters more than it looks: without it, "brakes" is a
 * rare token (it appears in two facts) while "brake" is a common one, so
 * rarity weighting rewards the coincidence instead of discounting it. The
 * first version of this scorer put a timing check above the pressure figures
 * for exactly that reason.
 */
function singularise(word: string): string {
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

/** Lowercase and singularise every word, so haystacks match tokens. */
function normaliseText(text: string): string {
  return text.toLowerCase().split(/([^a-z0-9.§-]+)/).map(singularise).join('');
}

/** A query token that is worth matching on. */
function tokenise(text: string): string[] {
  /*
   * Filler carries no information about which fact is wanted, and since
   * coverage is now measured over what survives here, a stray "have" or
   * "stop" would count against every fact equally and suppress a good answer.
   * Anything domain-bearing — "limit", "block", "condemning" — stays, because
   * failing to match those is exactly what should suppress an answer.
   */
  const STOP = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'for', 'of', 'to', 'in', 'on', 'at',
    'how', 'much', 'many', 'what', 'which', 'do', 'does', 'we', 'i', 'need',
    'needed', 'required', 'and', 'or', 'be', 'it', 'its', 'with',
    'have', 'has', 'had', 'should', 'must', 'can', 'will', 'would', 'there',
    'any', 'get', 'give', 'tell', 'me', 'my', 'you', 'your', 'us', 'our',
    'stop', 'use', 'when', 'where', 'why', 'carry', 'carries',
    'about', 'from', 'that', 'this', 'these', 'those', 'per'
  ]);
  return text
    .toLowerCase()
    .split(/[^a-z0-9.§-]+/)
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map(singularise);
}

export interface FactHit {
  fact: Fact;
  score: number;
}

/**
 * Finds facts that answer the question.
 *
 * Where a token matches still matters — the subject counts for more than the
 * supporting terms — but each token is also weighted by how rare it is across
 * the whole fact set.
 *
 * That second part is not decoration. Asked "how much air pressure is needed
 * to stop the brakes", a purely positional score put "Sensitivity: brakes
 * apply within — not more than 6 sec" above "Pressure in BP — 4.9–5.1
 * kg/cm²", because the word "brakes" happened to sit in the first one's
 * subject. But almost every fact in a brake system mentions brakes, so
 * matching it says nothing; "pressure" appears in few subjects, so matching
 * that says a great deal. Rare tokens carry the meaning of a question, and
 * weighting by rarity is the standard way to say so rather than a tweak aimed
 * at one query.
 *
 * Returns nothing rather than a weak guess when nothing matches well. The
 * caller then falls through to the manual passages, which is the right place
 * for a question this cannot answer.
 */
export function searchFacts(query: string, limit = 5): FactHit[] {
  const tokens = tokenise(query);
  if (tokens.length === 0) return [];

  const facts = buildFacts();

  // Haystacks once, rather than per token per fact.
  const indexed = facts.map((fact) => ({
    fact,
    subject: normaliseText(fact.subject),
    terms: normaliseText(fact.terms.join(' ')),
    answer: normaliseText(fact.answer)
  }));

  // How rare is each query token across the whole set.
  const idf = new Map<string, number>();
  for (const t of tokens) {
    const df = indexed.filter(
      (i) => i.subject.includes(t) || i.terms.includes(t) || i.answer.includes(t)
    ).length;
    // +1 keeps a token that matches everything from scoring exactly zero, and
    // a token that matches nothing from dividing by zero.
    idf.set(t, Math.log((indexed.length + 1) / (df + 1)) + 0.2);
  }

  /*
   * Total distinctiveness of the question, so a fact can be asked how much of
   * it it actually addresses rather than only how well it scored.
   */
  const totalIdf = tokens.reduce((sum, t) => sum + (idf.get(t) ?? 0), 0);

  const hits: FactHit[] = [];
  for (const i of indexed) {
    let score = 0;
    let coveredIdf = 0;

    for (const t of tokens) {
      const weight = idf.get(t) ?? 0;
      if (i.subject.includes(t)) { score += 3 * weight; coveredIdf += weight; }
      else if (i.terms.includes(t)) { score += 2 * weight; coveredIdf += weight; }
      else if (i.answer.includes(t)) { score += 1 * weight; coveredIdf += weight; }
    }

    /*
     * A fact must address most of what was asked, not merely share a word
     * with it.
     *
     * Asked "brake block condemning limit", this returned the §720-C air
     * brake cylinder figures — filling time, maximum pressure, sensitivity —
     * under a heading reading "Direct answer, from this app's own verified
     * figures". They matched on "brake" and "limit" while containing nothing
     * about blocks or condemning, scored 3.7 against the 2.0 floor, and were
     * printed above the passage that held the real answer: 10 mm, page 71.
     *
     * A confidently wrong figure under the word "verified" is far worse than
     * no figure at all — an inspector reads the bold number, not the passage
     * below it. So the absolute floor is not enough on its own: what matters
     * is whether the distinctive words of the question were matched, and
     * "block" and "condemning" carry that question, not "brake".
     */
    const coverage = totalIdf > 0 ? coveredIdf / totalIdf : 0;
    if (score >= 2.0 && coverage >= 0.6) {
      hits.push({ fact: i.fact, score: Math.round(score * 100) / 100 });
    }
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
