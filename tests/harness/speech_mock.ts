/**
 * Speech Recognition & Vernacular Voice Command Parser Mock Harness
 * Indian Railways WRS Raipur (Phase 3 - M3 / R1 Hands-Free Voice UI)
 *
 * Simulates Web Speech API (SpeechRecognition / webkitSpeechRecognition)
 * and provides bilingual English/Hindi voice parsing for CASNUB checklist items.
 */

import type { CASNUBCategory, PartInspectionStatus, BandColor } from '../../shared/types.ts';

export interface VoiceCommandResult {
  matched: boolean;
  transcript: string;
  confidence: number;
  intent: 'UPDATE_STATUS' | 'NAVIGATE_CATEGORY' | 'UNDO' | 'CLASSIFY_SPRING' | 'UNKNOWN';
  targetCategory?: CASNUBCategory;
  targetPartName?: string;
  status?: PartInspectionStatus;
  measuredHeight?: number;
  bandColor?: BandColor;
  notes?: string;
  feedbackMessage: string;
  feedbackMessageHi?: string;
}

export interface MockSpeechRecognitionEvent {
  resultIndex: number;
  results: Array<Array<{ transcript: string; confidence: number }> & { isFinal: boolean }>;
}

export interface MockSpeechRecognitionErrorEvent {
  error: 'not-allowed' | 'no-speech' | 'audio-capture' | 'network' | 'aborted' | 'service-not-allowed';
  message?: string;
}

export class MockSpeechRecognition {
  public continuous: boolean = true;
  public interimResults: boolean = true;
  public lang: string = 'en-IN';
  public maxAlternatives: number = 1;
  public isListening: boolean = false;

  public onstart: (() => void) | null = null;
  public onend: (() => void) | null = null;
  public onresult: ((event: MockSpeechRecognitionEvent) => void) | null = null;
  public onerror: ((event: MockSpeechRecognitionErrorEvent) => void) | null = null;
  public onspeechend: (() => void) | null = null;

  public start(): void {
    if (this.isListening) return;
    this.isListening = true;
    if (this.onstart) {
      this.onstart();
    }
  }

  public stop(): void {
    if (!this.isListening) return;
    this.isListening = false;
    if (this.onspeechend) {
      this.onspeechend();
    }
    if (this.onend) {
      this.onend();
    }
  }

  public abort(): void {
    this.isListening = false;
    if (this.onerror) {
      this.onerror({ error: 'aborted', message: 'Speech recognition aborted' });
    }
    if (this.onend) {
      this.onend();
    }
  }

  public dispatchResult(transcript: string, isFinal: boolean = true, confidence: number = 0.95): void {
    if (!this.isListening) {
      this.start();
    }

    const alt = { transcript, confidence };
    const resItem = Object.assign([alt], { isFinal });
    const event: MockSpeechRecognitionEvent = {
      resultIndex: 0,
      results: [resItem]
    };

    if (this.onresult) {
      this.onresult(event);
    }
  }

  public dispatchError(
    errorType: 'not-allowed' | 'no-speech' | 'audio-capture' | 'network' | 'aborted' | 'service-not-allowed',
    message?: string
  ): void {
    this.isListening = false;
    if (this.onerror) {
      this.onerror({ error: errorType, message: message || `Speech error: ${errorType}` });
    }
    if (this.onend) {
      this.onend();
    }
  }
}

/**
 * High-precision bilingual English & Hindi voice command parser for CASNUB 22 bogie inspections
 */
export function parseVoiceCommand(transcript: string, locale: 'en' | 'hi' = 'en'): VoiceCommandResult {
  const clean = transcript.trim();
  const lower = clean.toLowerCase();

  // 1. Check for UNDO intent
  if (
    lower.includes('undo') ||
    lower.includes('revert') ||
    lower.includes('पूर्ववत') ||
    lower.includes('वापस लो') ||
    lower.includes('गलत हो गया')
  ) {
    return {
      matched: true,
      transcript: clean,
      confidence: 0.98,
      intent: 'UNDO',
      feedbackMessage: 'Last action undone',
      feedbackMessageHi: 'पिछली कार्रवाई पूर्ववत कर दी गई'
    };
  }

  // 2. Check for Navigation intent (Category tabs)
  const categoryNavigationRules: Array<{
    keywords: string[];
    category: CASNUBCategory;
    nameEn: string;
    nameHi: string;
  }> = [
    {
      keywords: ['springs', 'spring', 'स्प्रिंग', 'कमानी'],
      category: 'SPRINGS',
      nameEn: 'Springs',
      nameHi: 'स्प्रिंग्स'
    },
    {
      keywords: ['wheels', 'axles', 'wheelset', 'पहिया', 'पहिए', 'धुरी'],
      category: 'WHEELS_AXLES',
      nameEn: 'Wheels & Axles',
      nameHi: 'पहिए और धुरी'
    },
    {
      keywords: ['bearing', 'bearings', 'ctrb', 'बेयरिंग'],
      category: 'BEARINGS',
      nameEn: 'Bearings',
      nameHi: 'बेयरिंग'
    },
    {
      keywords: ['brake', 'brakes', 'brake system', 'ब्रेक', 'ब्रेक प्रणाली'],
      category: 'BRAKE_SYSTEM',
      nameEn: 'Brake System',
      nameHi: 'ब्रेक प्रणाली'
    },
    {
      keywords: ['coupler', 'draft gear', 'cb coupler', 'कपलर', 'ड्राफ्ट गियर'],
      category: 'COUPLERS_DRAFT_GEAR',
      nameEn: 'Couplers & Draft Gear',
      nameHi: 'कपलर और ड्राफ्ट गियर'
    },
    {
      keywords: ['bogie frame', 'bolster', 'frame', 'बोगी फ्रेम', 'बोल्स्टर'],
      category: 'BOGIE_FRAME_BOLSTER',
      nameEn: 'Bogie Frame & Bolster',
      nameHi: 'बोगी फ्रेम और बोल्स्टर'
    },
    {
      keywords: ['friction wedge', 'wedge', 'वेज', 'घर्षण वेज'],
      category: 'FRICTION_WEDGES',
      nameEn: 'Friction Wedges',
      nameHi: 'घर्षण वेज'
    },
    {
      keywords: ['body', 'underframe', 'बॉडी', 'अंडरफ्रेम'],
      category: 'BODY_UNDERFRAME',
      nameEn: 'Body & Underframe',
      nameHi: 'बॉडी और अंडरफ्रेम'
    }
  ];

  if (
    lower.startsWith('go to') ||
    lower.startsWith('navigate to') ||
    lower.startsWith('open') ||
    lower.includes('पर जाओ') ||
    lower.includes('खोलो') ||
    lower.includes('दिखाओ')
  ) {
    for (const rule of categoryNavigationRules) {
      if (rule.keywords.some(kw => lower.includes(kw))) {
        return {
          matched: true,
          transcript: clean,
          confidence: 0.95,
          intent: 'NAVIGATE_CATEGORY',
          targetCategory: rule.category,
          feedbackMessage: `Navigated to ${rule.nameEn}`,
          feedbackMessageHi: `${rule.nameHi} पर ले जाया गया`
        };
      }
    }
  }

  // 3. Check for Spring Classification command with dimension (e.g. "Snubber spring 245 mm band green" / "स्नबर स्प्रिंग 245 मिमी हरा बैंड")
  const springDimMatch = lower.match(/(outer|inner|snubber|बाहरी|भीतरी|स्नबर).+?(\d{2,3}(?:\.\d+)?)\s*(?:mm|मिमी)?/i);
  if (springDimMatch) {
    const rawPos = springDimMatch[1];
    const height = parseFloat(springDimMatch[2]);
    let targetPartName = 'Outer Spring';
    let bandColor: BandColor | undefined = undefined;

    if (rawPos.includes('inner') || rawPos.includes('भीतरी')) {
      targetPartName = 'Inner Spring';
    } else if (rawPos.includes('snubber') || rawPos.includes('स्नबर')) {
      targetPartName = 'Snubber Spring';
    }

    if (lower.includes('green') || lower.includes('हरा')) bandColor = 'GREEN';
    else if (lower.includes('blue') || lower.includes('नीला')) bandColor = 'BLUE';
    else if (lower.includes('yellow') || lower.includes('पीला')) bandColor = 'YELLOW';
    else if (lower.includes('orange') || lower.includes('नारंगी')) bandColor = 'ORANGE';
    else if (lower.includes('white') || lower.includes('सफेद')) bandColor = 'WHITE';
    else if (lower.includes('red') || lower.includes('लाल')) bandColor = 'RED';

    const status: PartInspectionStatus = height < 245 ? 'CONDEMNED' : 'PASS';

    return {
      matched: true,
      transcript: clean,
      confidence: 0.94,
      intent: 'CLASSIFY_SPRING',
      targetCategory: 'SPRINGS',
      targetPartName,
      status,
      measuredHeight: height,
      bandColor,
      feedbackMessage: `${targetPartName} classified: ${height} mm (${status}${bandColor ? `, ${bandColor}` : ''})`,
      feedbackMessageHi: `${targetPartName} का वर्गीकरण: ${height} मिमी (${status})`
    };
  }

  // 4. Checklist Item Part Mapping
  const partDictionary: Array<{
    keywords: string[];
    partName: string;
    category: CASNUBCategory;
  }> = [
    { keywords: ['outer spring', 'outer coil', 'बाहरी स्प्रिंग', 'बाहरी कमानी'], partName: 'Outer Spring', category: 'SPRINGS' },
    { keywords: ['inner spring', 'inner coil', 'भीतरी स्प्रिंग', 'भीतरी कमानी'], partName: 'Inner Spring', category: 'SPRINGS' },
    { keywords: ['snubber spring', 'snubber coil', 'स्नबर स्प्रिंग', 'स्नबर'], partName: 'Snubber Spring', category: 'SPRINGS' },
    { keywords: ['friction wedge', 'wedge block', 'घर्षण वेज', 'वेज'], partName: 'Friction Wedge', category: 'FRICTION_WEDGES' },
    { keywords: ['brake block', 'brake shoe', 'ब्रेक ब्लॉक', 'ब्रेक शू'], partName: 'Brake Block', category: 'BRAKE_SYSTEM' },
    { keywords: ['brake beam', 'ब्रेक बीम'], partName: 'Brake Beam', category: 'BRAKE_SYSTEM' },
    { keywords: ['brake cylinder', 'ब्रेक सिलेंडर'], partName: 'Brake Cylinder', category: 'BRAKE_SYSTEM' },
    { keywords: ['ctrb', 'bearing', 'cartridge bearing', 'बेयरिंग', 'सीटीआरबी'], partName: 'Cartridge Tapered Roller Bearing', category: 'BEARINGS' },
    { keywords: ['wheel profile', 'wheel flange', 'पहिया प्रोफाइल', 'पहिया फ्लैंज'], partName: 'Wheel Profile', category: 'WHEELS_AXLES' },
    { keywords: ['axle journal', 'journal', 'धुरी जर्नल', 'जर्नल'], partName: 'Axle Journal', category: 'WHEELS_AXLES' },
    { keywords: ['coupler body', 'cb coupler', 'कपलर बॉडी', 'कपलर'], partName: 'Coupler Body', category: 'COUPLERS_DRAFT_GEAR' },
    { keywords: ['draft gear', 'ड्राफ्ट गियर'], partName: 'Draft Gear', category: 'COUPLERS_DRAFT_GEAR' },
    { keywords: ['bogie side frame', 'side frame', 'साइड फ्रेम', 'बोगी साइड फ्रेम'], partName: 'Side Frame', category: 'BOGIE_FRAME_BOLSTER' },
    { keywords: ['bolster', 'bogie bolster', 'बोल्स्टर', 'बोगी बोल्स्टर'], partName: 'Bolster', category: 'BOGIE_FRAME_BOLSTER' },
    { keywords: ['center pivot', 'सेंटर पिवट'], partName: 'Center Pivot', category: 'BOGIE_FRAME_BOLSTER' },
    { keywords: ['underframe sole bar', 'sole bar', 'सोल बार', 'अंडरफ्रेम'], partName: 'Sole Bar', category: 'BODY_UNDERFRAME' }
  ];

  // 5. Status Matching Rules
  let targetStatus: PartInspectionStatus | undefined = undefined;
  let notes: string | undefined = undefined;

  if (
    lower.includes('condemn') ||
    lower.includes('condemned') ||
    lower.includes('कंडम') ||
    lower.includes('अस्वीकृत') ||
    lower.includes('खारिज') ||
    lower.includes('खराब')
  ) {
    targetStatus = 'CONDEMNED';
  } else if (
    lower.includes('pass') ||
    lower.includes('passes') ||
    lower.includes('passed') ||
    lower.includes('ok') ||
    lower.includes('fit') ||
    lower.includes('पास') ||
    lower.includes('ठीक है') ||
    lower.includes('सही है')
  ) {
    targetStatus = 'PASS';
  } else if (
    lower.includes('repaired') ||
    lower.includes('repair') ||
    lower.includes('मरम्मत') ||
    lower.includes('सुधार') ||
    lower.includes('ठीक किया')
  ) {
    targetStatus = 'REPAIRED';
  } else if (
    lower.includes('replaced') ||
    lower.includes('replace') ||
    lower.includes('बदला') ||
    lower.includes('प्रतिस्थापित')
  ) {
    targetStatus = 'REPLACED';
  } else if (
    lower.includes('fail') ||
    lower.includes('failed') ||
    lower.includes('फेल') ||
    lower.includes('दोष')
  ) {
    targetStatus = 'FAIL';
  }

  // Extract defect notes if mentioned (e.g. "with severe crack" or "दरार के साथ")
  const notesMatch = lower.match(/(?:with|due to|reason|having|कारण|के साथ)\s+([a-z0-9\s\u0900-\u097F]+)/i);
  if (notesMatch) {
    notes = notesMatch[1].trim();
  }

  // Match target part
  for (const part of partDictionary) {
    if (part.keywords.some(kw => lower.includes(kw))) {
      if (targetStatus) {
        return {
          matched: true,
          transcript: clean,
          confidence: 0.96,
          intent: 'UPDATE_STATUS',
          targetCategory: part.category,
          targetPartName: part.partName,
          status: targetStatus,
          notes,
          feedbackMessage: `${part.partName} marked as ${targetStatus}${notes ? ` (${notes})` : ''}`,
          feedbackMessageHi: `${part.partName} को ${targetStatus} चिह्नित किया गया`
        };
      }
    }
  }

  // If no match found
  return {
    matched: false,
    transcript: clean,
    confidence: 0.35,
    intent: 'UNKNOWN',
    feedbackMessage: `Command not recognized: "${clean}". Please repeat command.`,
    feedbackMessageHi: `आदेश नहीं पहचाना गया: "${clean}"`
  };
}
