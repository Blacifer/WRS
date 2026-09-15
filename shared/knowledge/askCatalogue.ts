/**
 * Ask the records — the questions this shop's records can answer, as a closed list
 * Indian Railways WRS Raipur
 *
 * "Which wagon type condemns the most snubbers this quarter, out of how
 * many?" is a question the DRM asks and the records can answer. What no
 * model may do is answer it: a language model that writes SQL, or reads a
 * table and reports a figure, produces a number nobody can check, and this
 * system does not deal in those.
 *
 * So the questions are a closed catalogue. Each has a fixed query on the
 * server, a set of parameters with allowlisted values, and an answer that
 * is arithmetic over the rows it cites. What is left for anything clever
 * to do is to work out WHICH catalogue question a sentence means and with
 * which parameters — and that is done first by a plain matcher over the
 * phrasings and synonyms below (bilingual, offline, always available), and
 * only if that fails by a model, which sees the sentence and this catalogue
 * and nothing else, replies with an id and parameters, and is checked
 * against the same allowlists as everyone else.
 *
 * The model, if one is configured, can therefore be the one on the shop
 * PC: the client already speaks the OpenAI shape, so ZAPHEIT_BASE_URL
 * pointed at http://localhost:11434/v1 (Ollama) keeps the question on the
 * machine. Either way, no record ever leaves it — the model never sees one.
 */

export type ParamKind = 'wagonType' | 'springPosition' | 'stage' | 'period' | 'wagonNumber' | 'partName' | 'band';

export interface AskParamSpec {
  kind: ParamKind;
  required: boolean;
  /** Default for optional parameters, in the same vocabulary the allowlist uses. */
  default?: string;
}

export interface AskQuestion {
  id: string;
  /** What the answer will be, in one sentence, for the picker and the model. */
  describe: { en: string; hi: string };
  /** Words that, together, mean this question. Lowercase, stemmed by hand. */
  keywords: string[];
  /** Optional words that add weight but are not required. */
  hints?: string[];
  params: Record<string, AskParamSpec>;
}

/** Periods a person says, resolved to a number of days on the server. */
export const PERIODS: Record<string, number> = {
  today: 1, yesterday: 2, 'this week': 7, week: 7, 'last week': 14, fortnight: 14, month: 30, 'this month': 30, 'last month': 60,
  quarter: 91, 'this quarter': 91, 'last quarter': 182, year: 365, 'this year': 365, 'last year': 730, 'all time': 3650, ever: 3650
};

export const SPRING_POSITIONS = ['OUTER', 'INNER', 'SNUBBER'] as const;
export const STAGES = ['ENTRY_REGISTRATION', 'DISMANTLING', 'COMPONENT_INSPECTION', 'REPAIR_REPLACEMENT', 'REASSEMBLY', 'FINAL_QC_GATE', 'RELEASE'] as const;
export const BANDS = ['BLUE', 'GREEN', 'YELLOW', 'ORANGE', 'WHITE', 'RED'] as const;

export const ASK_CATALOGUE: AskQuestion[] = [
  {
    id: 'condemnation_by_wagon_type',
    describe: { en: 'Which wagon types condemn the most springs of a position, over a period — condemned, out of how many measured.', hi: 'किस वैगन प्रकार में किसी स्थिति की सबसे अधिक स्प्रिंग कंडम होती हैं — कितनी में से।' },
    keywords: ['condemn', 'wagon type'],
    hints: ['most', 'which', 'spring', 'out of'],
    params: { springPosition: { kind: 'springPosition', required: false }, period: { kind: 'period', required: false, default: 'quarter' } }
  },
  {
    id: 'springs_sorted_per_day',
    describe: { en: 'How many springs the bench sorted each day over a period, and how many were condemned.', hi: 'बेंच ने प्रति दिन कितनी स्प्रिंग छाँटी, और कितनी कंडम हुईं।' },
    keywords: ['sorted'],
    hints: ['per day', 'each day', 'bench', 'how many', 'springs', 'daily'],
    params: { period: { kind: 'period', required: false, default: 'week' } }
  },
  {
    id: 'band_distribution',
    describe: { en: 'How the sorted springs of a position fell across the G-95 bands over a period.', hi: 'किसी स्थिति की छाँटी गई स्प्रिंग G-95 बैंडों में कैसे बँटीं।' },
    keywords: ['band'],
    hints: ['distribution', 'how many', 'blue', 'green', 'yellow', 'each', 'springs', 'colour'],
    params: { springPosition: { kind: 'springPosition', required: false }, period: { kind: 'period', required: false, default: 'month' } }
  },
  {
    id: 'part_fails_most',
    describe: { en: 'Which checklist part fails, is condemned or replaced on the most distinct wagons.', hi: 'कौन सा पुर्जा सबसे अधिक वैगनों पर असफल/कंडम/बदला जाता है।' },
    keywords: ['part'],
    hints: ['fail', 'most', 'keeps', 'coming back', 'which', 'component', 'replaced', 'often'],
    params: {}
  },
  {
    id: 'wagons_blocked',
    describe: { en: 'Which wagons the exit gate is holding right now, and why.', hi: 'निकास द्वार अभी किन वैगनों को रोक रहा है, और क्यों।' },
    keywords: ['block'],
    hints: ['gate', 'held', 'holding', 'stuck', 'why', 'wagons', 'cannot release'],
    params: {}
  },
  {
    id: 'stage_dwell',
    describe: { en: 'How long wagons of a type spend in each stage (median, p90, count), and which stage holds them longest.', hi: 'किसी प्रकार के वैगन हर चरण में कितना समय बिताते हैं।' },
    keywords: ['stage'],
    hints: ['how long', 'dwell', 'wait', 'bottleneck', 'median', 'takes', 'time', 'longest'],
    params: { wagonType: { kind: 'wagonType', required: false } }
  },
  {
    id: 'wagons_released',
    describe: { en: 'Which wagons were released over a period, with their turnaround.', hi: 'किसी अवधि में कौन से वैगन रिलीज़ हुए, कितने समय में।' },
    keywords: ['releas'],
    hints: ['wagons', 'how many', 'which', 'certif', 'out', 'left'],
    params: { period: { kind: 'period', required: false, default: 'month' }, wagonType: { kind: 'wagonType', required: false } }
  },
  {
    id: 'wagons_in_shop',
    describe: { en: 'How many wagons are in the shop now, by stage and by type.', hi: 'अभी दुकान में कितने वैगन हैं, चरण और प्रकार के हिसाब से।' },
    keywords: ['in the shop'],
    hints: ['now', 'how many', 'wagons', 'pipeline', 'currently', 'inside', 'on hand', 'by stage'],
    params: {}
  },
  {
    id: 'wagon_history',
    describe: { en: 'Everything recorded for one wagon: stages, springs, verdicts, parts, photographs, sign-off.', hi: 'एक वैगन के लिए दर्ज सब कुछ।' },
    keywords: ['wagon'],
    hints: ['history', 'what happened', 'record', 'show me', 'everything', 'tell me about'],
    params: { wagonNumber: { kind: 'wagonNumber', required: true } }
  },
  {
    id: 'parts_replaced_on_wagon',
    describe: { en: 'What was replaced, scrapped or refitted on one wagon, from the parts ledger.', hi: 'एक वैगन पर क्या बदला, स्क्रैप या पुनः लगाया गया।' },
    keywords: ['replac', 'wagon'],
    hints: ['scrap', 'refit', 'parts', 'what', 'on', 'ledger', 'changed'],
    params: { wagonNumber: { kind: 'wagonNumber', required: true } }
  },
  {
    id: 'inspector_condemnation',
    describe: { en: 'How often each inspector condemns, against the shop, with the counts behind each rate.', hi: 'हर निरीक्षक कितनी बार कंडम करता है, दुकान की तुलना में।' },
    keywords: ['inspector'],
    hints: ['condemn', 'rate', 'each', 'who', 'per', 'quality', 'most'],
    params: { period: { kind: 'period', required: false, default: 'quarter' } }
  },
  {
    id: 'overrides',
    describe: { en: 'Supervisor overrides recorded over a period — which wagons, which stages, by whom.', hi: 'किसी अवधि में पर्यवेक्षक ओवरराइड — कौन से वैगन, किसके द्वारा।' },
    keywords: ['override'],
    hints: ['supervisor', 'how many', 'who', 'wagons', 'skipped', 'forced'],
    params: { period: { kind: 'period', required: false, default: 'month' } }
  },
  {
    id: 'forecast_replacements',
    describe: { en: 'Expected spring replacements over the coming days, from the out-turn, RDSO counts and the observed condemnation rate.', hi: 'आने वाले दिनों में अपेक्षित स्प्रिंग प्रतिस्थापन।' },
    keywords: ['forecast'],
    hints: ['expect', 'order', 'stores', 'need', 'next', 'replacements', 'how many springs', 'coming'],
    params: { period: { kind: 'period', required: false, default: 'fortnight' } }
  },
  {
    id: 'wagons_of_type_received',
    describe: { en: 'How many wagons of a type came in over a period, and how many of them have left.', hi: 'किसी प्रकार के कितने वैगन किसी अवधि में आए, और कितने जा चुके।' },
    keywords: ['came in'],
    hints: ['received', 'arrived', 'how many', 'wagons', 'registered', 'entered', 'intake'],
    params: { wagonType: { kind: 'wagonType', required: false }, period: { kind: 'period', required: false, default: 'year' } }
  },
  {
    id: 'gauge_drift',
    describe: { en: 'Whether any gauge reads a millimetre or more from the shop\'s other gauges on the same kind of spring.', hi: 'क्या कोई गेज दुकान के अन्य गेज से एक मिलीमीटर या अधिक अलग पढ़ता है।' },
    keywords: ['gauge'],
    hints: ['drift', 'reads high', 'reads low', 'calibrat', 'wrong', 'instrument', 'master'],
    params: { period: { kind: 'period', required: false, default: 'quarter' } }
  }
];

/**
 * Synonyms folded into the matcher's vocabulary, both languages.
 *
 * Built with Unicode-aware boundaries rather than \b, which in JavaScript
 * only knows ASCII letters — a Devanagari word has no \b around it, so the
 * Hindi synonyms never matched at all until this was written the long way.
 */
const word = (alternatives: string) => new RegExp(`(?<!\\p{L})(?:${alternatives})(?!\\p{L})`, 'giu');

export const SYNONYMS: Array<[RegExp, string]> = [
  [word('scrapped?|rejected|unfit|condemned?|condemnation|कंडम|निंदित|अस्वीकृत'), 'condemn'],
  [word('released?|release|certified|certificate|रिलीज़|रिलीज|प्रमाणपत्र'), 'releas'],
  [word('replaced?|replacement|बदला|बदले|प्रतिस्थापित'), 'replac'],
  [word('overrides?|overridden|ओवरराइड'), 'override'],
  [word('sorting|sort|sorted|छाँट|छँटाई|छांट|छाँटी'), 'sorted'],
  [word('gauges?|गेज|गॉज'), 'gauge'],
  [word('inspectors?|निरीक्षक|इंस्पेक्टर'), 'inspector'],
  [word('forecast|predict|projection|expected|पूर्वानुमान|अनुमान'), 'forecast'],
  [word('stages?|चरण|स्टेज'), 'stage'],
  [word('bands?|बैंड'), 'band'],
  [word('blocked|blockers?|held up|holding|stuck|रुके|अटके|ब्लॉक'), 'block'],
  [word('parts?|component|पुर्जा|पुर्जे|कंपोनेंट'), 'part'],
  [word('in the shop|in shop|on hand|in the pipeline|दुकान में|अभी'), 'in the shop'],
  [word('came in|arrived|received|registered|intake|आए|आया|प्रवेश'), 'came in'],
  [word('wagon type|type of wagon|designation|वैगन प्रकार'), 'wagon type'],
  [word('snubbers?|स्नबर'), 'SNUBBER'],
  [word('outers?|बाहरी'), 'OUTER'],
  [word('inners?|भीतरी|अंदरूनी'), 'INNER'],
  [word('इस सप्ताह|this week'), 'this week'],
  [word('इस महीने|this month'), 'this month'],
  [word('इस तिमाही|this quarter'), 'this quarter'],
  [word('इस साल|इस वर्ष|this year'), 'this year'],
  [word('स्प्रिंग|स्प्रिंगें'), 'springs'],
  [word('प्रति दिन|हर दिन|रोज़'), 'per day'],
  [word('कितनी|कितने|कितना'), 'how many'],
  [word('किस|कौन सा|कौन से'), 'which'],
  [word('सबसे अधिक|सबसे ज़्यादा'), 'most']
];
