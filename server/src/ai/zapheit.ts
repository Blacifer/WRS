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
