/**
 * Zapheit — where a model earns its place, and where it must not go
 * Indian Railways WRS Raipur
 *
 * THE RULE
 * --------
 * The model FINDS. The manual STATES.
 *
 * Nothing here may ever produce a number, a band, a condemning limit or a
 * verdict. Those come from the RDSO tables and from deterministic code,
 * because an inspector has to be able to defend a condemnation to an auditor
 * and "the model said so" is not a defence. What a model is genuinely good at
 * is working out which clause somebody meant, and turning a sentence spoken
 * over a running shop into structured fields. Both of those are search and
 * parsing problems, and neither invents a figure.
 *
 * WHY EVERY PATH FALLS BACK
 * -------------------------
 * This application's core property is that it works with no network. A
 * workshop LAN may have no route to the internet at all, and the manual is
 * needed most by somebody standing at a wagon holding a component — which is
 * exactly when a cloud call is least likely to succeed.
 *
 * So there is no configuration in which this makes the app worse. Unset key,
 * refused request, timeout, malformed answer: every one returns null, and
 * every caller then does what it already did — full-text search over the
 * indexed manual, or the existing voice parser. A feature that degrades to
 * the previous behaviour cannot be a regression.
 *
 * The timeout is deliberately short. An inspector will not wait, and a slow
 * answer on a shop floor is a worse outcome than no answer, because the person
 * has already given up and gone back to the board on the wall.
 */

import { config } from '../config/index.ts';

/** Long enough for a small model, short enough that nobody stands waiting. */
const TIMEOUT_MS = 6000;

export function isZapheitConfigured(): boolean {
  return Boolean(config.zapheitApiKey);
}

/**
 * Asks the model for a short, plain-text answer.
 *
 * Returns null on absolutely any failure — unconfigured, network, timeout,
 * non-2xx, unparseable body. Callers must treat null as "carry on without it"
 * rather than as an error to report, because on a shop floor it is the
 * ordinary case rather than the exceptional one.
 */
export async function askZapheit(
  system: string,
  user: string,
  opts: { maxTokens?: number } = {}
): Promise<string | null> {
  if (!config.zapheitApiKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${config.zapheitBaseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.zapheitApiKey}`
      },
      body: JSON.stringify({
        model: config.zapheitModel,
        // Low temperature: this is comprehension, not composition. A model
        // asked to be imaginative about which clause governs a brake block is
        // a model doing the wrong job.
        temperature: 0,
        max_tokens: opts.maxTokens ?? 200,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ]
      })
    });

    if (!res.ok) return null;

    const body: any = await res.json().catch(() => null);
    const text = body?.choices?.[0]?.message?.content;
    return typeof text === 'string' && text.trim() ? text.trim() : null;
  } catch {
    // Aborted, offline, DNS failure, TLS failure — all the same answer.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// 1. Which clause did they mean?
// ---------------------------------------------------------------------------

/**
 * Turns a question asked in plain speech into search terms the manual index
 * can actually match.
 *
 * The index is FTS5 over 2,341 passages and it matches words. An inspector
 * asks "what's the throw-out size on a brake block"; the manual says
 * "condemning limit" and "brake block thickness". That gap is a vocabulary
 * problem, which is the one thing a language model is unambiguously suited to.
 *
 * It returns SEARCH TERMS, never an answer. The passage that comes back is the
 * manual's own words, and the citation with it is what the inspector reads.
 */
export async function suggestManualQuery(question: string): Promise<string | null> {
  const terms = await askZapheit(
    'You convert a railway workshop question into search keywords for a full-text ' +
      'index of the Indian Railways Wagon Maintenance Manual. Reply with 3 to 8 ' +
      'keywords separated by spaces. No punctuation, no explanation, no numbers ' +
      'unless the question itself contained one. If unsure, echo the important ' +
      'nouns from the question.',
    question,
    { maxTokens: 40 }
  );

  if (!terms) return null;

  /*
   * Whatever comes back is treated as untrusted text on its way into a query:
   * stripped to words, capped in length. It is not shown to anybody and it
   * cannot become part of an answer — it only decides which passages are
   * fetched, and the passages speak for themselves.
   */
  const cleaned = terms
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
    .join(' ')
    .trim();

  return cleaned.length >= 3 ? cleaned : null;
}

// ---------------------------------------------------------------------------
// 2. What did they just say?
// ---------------------------------------------------------------------------

export interface ParsedVoiceIntent {
  partName?: string;
  status?: 'PASS' | 'FAIL' | 'CONDEMNED' | 'REPAIRED' | 'REPLACED';
  bogiePosition?: 'BOGIE_1' | 'BOGIE_2';
  defectNotes?: string;
}

const STATUSES = ['PASS', 'FAIL', 'CONDEMNED', 'REPAIRED', 'REPLACED'];

/**
 * Reads a spoken instruction into the fields the checklist already uses.
 *
 * The existing parser handles clean phrasing. This handles how people actually
 * talk with their hands on a gauge — "the second inner on bogie two looks
 * cracked" — and emits nothing the existing path does not already accept.
 *
 * Every field is validated against a closed list before it is returned. A
 * status the system does not recognise is dropped rather than passed on, so a
 * model cannot invent a verdict by inventing a word for one. The transcript is
 * recorded separately and unaltered, which is what an auditor reads.
 */
export async function parseVoiceIntent(transcript: string): Promise<ParsedVoiceIntent | null> {
  const raw = await askZapheit(
    'You extract fields from a spoken wagon inspection instruction. Reply with ONLY ' +
      'a JSON object, no prose. Keys, all optional: partName (string), status (one of ' +
      'PASS, FAIL, CONDEMNED, REPAIRED, REPLACED), bogiePosition (BOGIE_1 or BOGIE_2), ' +
      'defectNotes (string, what was observed). Never guess a measurement, a band or a ' +
      'limit. If the instruction does not clearly say something, omit that key.',
    transcript,
    { maxTokens: 160 }
  );

  if (!raw) return null;

  let parsed: any;
  try {
    // Models like to wrap JSON in prose or fences however firmly they are
    // asked not to. Take the first object and ignore the rest.
    const match = raw.match(/\{[\s\S]*\}/);
    parsed = match ? JSON.parse(match[0]) : null;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const out: ParsedVoiceIntent = {};

  if (typeof parsed.partName === 'string' && parsed.partName.trim()) {
    out.partName = parsed.partName.trim().slice(0, 120);
  }
  if (typeof parsed.status === 'string' && STATUSES.includes(parsed.status.toUpperCase())) {
    out.status = parsed.status.toUpperCase() as ParsedVoiceIntent['status'];
  }
  if (parsed.bogiePosition === 'BOGIE_1' || parsed.bogiePosition === 'BOGIE_2') {
    out.bogiePosition = parsed.bogiePosition;
  }
  if (typeof parsed.defectNotes === 'string' && parsed.defectNotes.trim()) {
    out.defectNotes = parsed.defectNotes.trim().slice(0, 500);
  }

  return Object.keys(out).length > 0 ? out : null;
}

// ---------------------------------------------------------------------------
// 3. Write the shift down
// ---------------------------------------------------------------------------

export interface ShiftFacts {
  shiftDate: string;
  springsSorted: number;
  springsCondemned: number;
  sortingInspectors: number;
  checklistVerdicts: number;
  wagonsTouched: number;
  defectsFound: number;
  supervisorOverrides: number;
  acousticDefects: number;
  wagonsReleased: number;
  gateSignoffs: number;
}

/**
 * Every whole number the facts contain, plus the parts of the date.
 *
 * The draft is allowed to use these and nothing else. A narrative that says
 * "twelve springs were condemned" when the records say nine is not a style
 * problem, it is a false statement in a handover note that somebody will act
 * on at 6 a.m. So the guard is not "does it sound right" but "does every
 * figure in it exist in the facts".
 */
export function permittedNumbers(facts: ShiftFacts): Set<string> {
  const out = new Set<string>();
  for (const [k, v] of Object.entries(facts)) {
    if (typeof v === 'number') out.add(String(v));
    if (k === 'shiftDate') for (const part of String(v).split(/[-T:. ]/)) if (/^\d+$/.test(part)) out.add(String(Number(part)));
  }
  return out;
}

/**
 * The numbers a draft actually used that the facts do not contain.
 *
 * Necessary, not sufficient. This catches an invented FIGURE — "twelve" when
 * the records say nine. It cannot catch an invented PAIRING: a permitted "1"
 * attached to a field whose true value is zero reads as fine here, and was
 * seen live on the first real draft. That is why the counts are shown beside
 * the words and a person records the note, not the model. The guard removes
 * the class of error a reader could not check; the reader removes the rest.
 */
export function foreignNumbers(draft: string, facts: ShiftFacts): string[] {
  const allowed = permittedNumbers(facts);
  const found = draft.match(/\d+/g) || [];
  return [...new Set(found.map((n) => String(Number(n))))].filter((n) => !allowed.has(n));
}

/**
 * A handover note written from the facts, in plain words, by a model.
 *
 * Null when unconfigured, unreachable, or when the draft used a number the
 * facts do not contain. Callers fall back to the template, which cannot lie
 * because it only ever prints the figures it was given.
 */
export async function draftShiftHandover(facts: ShiftFacts): Promise<{ text: string } | { rejected: string[] } | null> {
  const raw = await askZapheit(
    'You write the end-of-shift handover note for a railway wagon overhaul workshop, for the ' +
      'supervisor taking over. Plain English, three to six sentences, no headings, no bullet points. ' +
      'Use ONLY the numbers given. Do not invent, round, or estimate any figure. Do not add ' +
      'recommendations, verdicts or judgements about parts. If a figure is zero, say so or omit it.',
    JSON.stringify(facts),
    { maxTokens: 260 }
  );
  if (!raw) return null;
  const text = raw.replace(/\s+/g, ' ').trim();
  const rejected = foreignNumbers(text, facts);
  if (rejected.length > 0) return { rejected };
  return { text };
}

/**
 * The note the system writes when the model cannot or must not.
 *
 * Deliberately dull. It prints the figures it was given in fixed sentences,
 * which is exactly why it can be trusted on a LAN with no route out.
 */
export function templateShiftHandover(f: ShiftFacts): string {
  const s: string[] = [];
  s.push(`Shift of ${f.shiftDate}.`);
  s.push(
    f.springsSorted > 0
      ? `${f.springsSorted} springs were sorted by ${f.sortingInspectors} inspector(s); ${f.springsCondemned} were condemned.`
      : 'No springs were sorted.'
  );
  s.push(
    f.checklistVerdicts > 0
      ? `${f.checklistVerdicts} checklist verdicts were recorded across ${f.wagonsTouched} wagon(s), with ${f.defectsFound} defect(s) found.`
      : 'No checklist verdicts were recorded.'
  );
  if (f.acousticDefects > 0) s.push(`${f.acousticDefects} acoustic defect(s) were logged.`);
  if (f.supervisorOverrides > 0) s.push(`${f.supervisorOverrides} supervisor override(s) were recorded.`);
  s.push(
    f.wagonsReleased > 0 || f.gateSignoffs > 0
      ? `${f.gateSignoffs} gate sign-off(s) were completed and ${f.wagonsReleased} wagon(s) released.`
      : 'No wagons were released.'
  );
  return s.join(' ');
}
