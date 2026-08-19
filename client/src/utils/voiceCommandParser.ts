/**
 * Bilingual Voice Command Parser for Indian Railways WRS Raipur
 * Hands-Free "Greasy Gloves" Shopfloor Inspection System (RDSO G-95 & CASNUB Standards)
 *
 * Supports English, Devanagari Hindi, and Romanized Hinglish with robust regex & token matching.
 */

import type {
  CASNUBCategory,
  PartInspectionStatus,
  ChecklistItem,
  VoiceParseResult,
  VoiceCommandIntent,
  BogieType,
  SpringPosition,
  SpringCondition
} from '../../../shared/types.ts';

// -----------------------------------------------------------------------------
// 1. Language Detection & Normalization Utilities
// -----------------------------------------------------------------------------

export function detectLanguage(text: string): 'en' | 'hi' | 'mixed' {
  if (!text) return 'en';
  const devanagariRegex = /[\u0900-\u097F]/;
  const latinRegex = /[a-zA-Z]/;
  const hasDevanagari = devanagariRegex.test(text);
  const hasLatin = latinRegex.test(text);

  if (hasDevanagari && hasLatin) return 'mixed';
  if (hasDevanagari) return 'hi';
  return 'en';
}

export function normalizeTranscript(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/(?<=\d)\.(?=\d)/g, '___DECIMAL___') // preserve decimal point between digits
    .replace(/[,\.\?!:;\-\(\)\[\]"'/\\|\+]/g, ' ') // strip punctuation
    .replace(/___DECIMAL___/g, '.') // restore decimal point
    .replace(/\s+/g, ' ')
    .trim();
}

// Convert Devanagari numerals to Western digits (e.g. २६०.५ -> 260.5)
export function convertDevanagariDigits(text: string): string {
  const devanagariDigits = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'];
  let result = text;
  for (let i = 0; i < devanagariDigits.length; i++) {
    result = result.replaceAll(devanagariDigits[i], String(i));
  }
  return result;
}

// -----------------------------------------------------------------------------
// 2. Status Matchers (English, Hinglish, Devanagari Hindi)
// -----------------------------------------------------------------------------

export const STATUS_PATTERNS: Array<{
  status: PartInspectionStatus;
  regex: RegExp;
  labelEn: string;
  labelHi: string;
}> = [
  {
    status: 'CONDEMNED',
    regex: /(?:^|\s)(condemn(ed)?|condem|reject(ed)?|scrap(ped)?|unserviceable|unfit|kharab(\s+hai)?|khrab|bekar|toota(\s+hua)?|tuta(\s+hua)?|toota|tuta|chalne\s+layak\s+nahi|कंडम(\s+करो)?|अस्वीकृत|खराब(\s+है)?|स्क्रैप|बेकार|टूटा(\s+हुआ)?|निष्कासित)(?:$|\s)/i,
    labelEn: 'CONDEMNED',
    labelHi: 'कंडम'
  },
  {
    status: 'REPLACED',
    regex: /(?:^|\s)(replace(d|s)?|renewed|changed|swapped|badal\s+(diya|do|de)|badla|badlo|change\s+kiya|naya\s+(lagaya|dala|lagao|part|spring)|बदल(ा|\s+दिया|\s+दो)?|नया\s+(लगाया|डाला|भाग)|प्रतिस्थापित)(?:$|\s)/i,
    labelEn: 'REPLACED',
    labelHi: 'प्रतिस्थापित / नया लगाया'
  },
  {
    status: 'REPAIRED',
    regex: /(?:^|\s)(repair(ed|s)?|reconditioned|serviced|fixed|overhauled|rectified|repair\s+kiya|sudhar(a|\s+kiya|\s+diya)?|theek\s+kiya|thik\s+kiya|durust\s+kiya|मरम्मत(\s+किया)?|सुधार(ा|\s+दिया)?|ठीक\s+किया|पुनर्निर्मित)(?:$|\s)/i,
    labelEn: 'REPAIRED',
    labelHi: 'मरम्मत किया'
  },
  {
    status: 'FAIL',
    regex: /(?:^|\s)(fail(ed|s)?|defective|faulty|fail\s+hai|khot\s+hai|nuksan|दोषपूर्ण|फेल)(?:$|\s)/i,
    labelEn: 'FAIL',
    labelHi: 'दोषपूर्ण'
  },
  {
    status: 'PASS',
    regex: /(?:^|\s)(pass(ed|es)?|fit|ok(ay)?|good|serviceable|clear|fine|intact|theek(\s+hai)?|thik(\s+hai)?|sahi(\s+hai)?|chalega|durust|badhiya|saf|thik\s+thaak|ठीक(\s+है)?|पास|फिट|सही(\s+है)?|चलेगा|दुरुस्त|उत्तीर्ण)(?:$|\s)/i,
    labelEn: 'PASS',
    labelHi: 'पास'
  }
];

// -----------------------------------------------------------------------------
// 3. Category Navigation Keywords
// -----------------------------------------------------------------------------

export const CATEGORY_NAVIGATION_MAP: Record<CASNUBCategory, RegExp> = {
  SPRINGS: /(?:^|\s)(show|open|go\s+to|switch\s+to|view|dikhao|kholo|दिखाओ|खोलो)?\s*(springs?|coil|kamani|कमानी|स्प्रिंग(्स)?)(?:$|\s)/i,
  WHEELS_AXLES: /(?:^|\s)(show|open|go\s+to|switch\s+to|view|dikhao|kholo|दिखाओ|खोलो)?\s*(wheels?(\s*&\s*axles?)?|axles?|chakka|dhuri|पहिया|पहिए|धुरी)(?:$|\s)/i,
  BEARINGS: /(?:^|\s)(show|open|go\s+to|switch\s+to|view|dikhao|kholo|दिखाओ|खोलो)?\s*(bearings?|ctrb(\s+bearings?)?|रोलर\s+बेयरिंग|बेयरिंग|बेयरिंग्स)(?:$|\s)/i,
  BRAKE_SYSTEM: /(?:^|\s)(show|open|go\s+to|switch\s+to|view|dikhao|kholo|दिखाओ|खोलो)?\s*(brakes?(\s+system)?|breaks?|braking|ब्रेक(\s+सिस्टम|\s+प्रणाली)?)(?:$|\s)/i,
  COUPLERS_DRAFT_GEAR: /(?:^|\s)(show|open|go\s+to|switch\s+to|view|dikhao|kholo|दिखाओ|खोलो)?\s*(couplers?|draft\s+gear|cbc(\s+coupler)?|कपलर|ड्राफ्ट\s+गियर)(?:$|\s)/i,
  BOGIE_FRAME_BOLSTER: /(?:^|\s)(show|open|go\s+to|switch\s+to|view|dikhao|kholo|दिखाओ|खोलो)?\s*(bogie\s+frame|bolster|frame|side\s+frame|बोगी\s+फ्रेम|बोल्स्टर|फ्रेम)(?:$|\s)/i,
  FRICTION_WEDGES: /(?:^|\s)(show|open|go\s+to|switch\s+to|view|dikhao|kholo|दिखाओ|खोलो)?\s*(friction\s+wedges?|wedges?|wedge|friction|घर्षण\s+वेज|वेज|फ्रिक्शन\s+वेज)(?:$|\s)/i,
  BODY_UNDERFRAME: /(?:^|\s)(show|open|go\s+to|switch\s+to|view|dikhao|kholo|दिखाओ|खोलो)?\s*(body(\s+underframe)?|underframe|chassis|अंडरफ्रेम|बॉडी|ढांचा)(?:$|\s)/i
};

// -----------------------------------------------------------------------------
// 4. Undo Keywords
// -----------------------------------------------------------------------------

export const UNDO_REGEX = /(?:^|\s)(undo|revert|go\s+back|cancel\s+last|cancel|piche\s+lo|peeche\s+lo|wapas(\s+lo)?|pichla\s+hatao|radd\s+karo|पूर्ववत|पीछे\s+लो|वापस(\s+लो)?|रद्द\s+करो)(?:$|\s)/i;

// -----------------------------------------------------------------------------
// 5. CASNUB Master Component Alias Dictionary (Ordered from Most Specific to Generic)
// -----------------------------------------------------------------------------

export interface ComponentAliasMapping {
  canonicalPartName: string;
  category: CASNUBCategory;
  defaultPosition?: 'BOGIE_1' | 'BOGIE_2' | 'UNDERFRAME' | 'BODY' | 'NONE';
  aliases: string[];
  regex: RegExp;
}

export const COMPONENT_ALIASES: ComponentAliasMapping[] = [
  // 1. SPECIFIC SPRINGS (Bogie 1 & 2)
  {
    canonicalPartName: 'Outer Spring (Bogie 1)',
    category: 'SPRINGS',
    defaultPosition: 'BOGIE_1',
    aliases: ['outer spring bogie 1', 'outer spring 1', 'outer 1', 'bogie 1 outer', 'bahar ka spring 1', 'पहला आउटर स्प्रिंग', 'आउटर स्प्रिंग 1'],
    regex: /(?:^|\s)(outer\s+spring\s+(1|one|bogie\s+1)|outer\s+(1|one)|bogie\s+1\s+outer(\s+spring)?|bahar\s+ka\s+spring\s+1|पहला\s+आउटर\s+स्प्रिंग|आउटर\s+स्प्रिंग\s+1|आउटर\s+1)(?:$|\s)/i
  },
  {
    canonicalPartName: 'Outer Spring (Bogie 2)',
    category: 'SPRINGS',
    defaultPosition: 'BOGIE_2',
    aliases: ['outer spring bogie 2', 'outer spring 2', 'outer 2', 'bogie 2 outer', 'bahar ka spring 2', 'दूसरा आउटर स्प्रिंग', 'आउटर स्प्रिंग 2'],
    regex: /(?:^|\s)(outer\s+spring\s+(2|two|bogie\s+2)|outer\s+(2|two)|bogie\s+2\s+outer(\s+spring)?|bahar\s+ka\s+spring\s+2|दूसरा\s+आउटर\s+स्प्रिंग|आउटर\s+स्प्रिंग\s+2|आउटर\s+2)(?:$|\s)/i
  },
  {
    canonicalPartName: 'Inner Spring (Bogie 1)',
    category: 'SPRINGS',
    defaultPosition: 'BOGIE_1',
    aliases: ['inner spring bogie 1', 'inner spring 1', 'inner 1', 'bogie 1 inner', 'andar ka spring 1', 'पहला इनर स्प्रिंग', 'इनर स्प्रिंग 1'],
    regex: /(?:^|\s)(inner\s+spring\s+(1|one|bogie\s+1)|inner\s+(1|one)|bogie\s+1\s+inner(\s+spring)?|andar\s+ka\s+spring\s+1|पहला\s+इनर\s+स्प्रिंग|इनर\s+स्प्रिंग\s+1|इनर\s+1)(?:$|\s)/i
  },
  {
    canonicalPartName: 'Inner Spring (Bogie 2)',
    category: 'SPRINGS',
    defaultPosition: 'BOGIE_2',
    aliases: ['inner spring bogie 2', 'inner spring 2', 'inner 2', 'bogie 2 inner', 'andar ka spring 2', 'दूसरा इनर स्प्रिंग', 'इनर स्प्रिंग 2'],
    regex: /(?:^|\s)(inner\s+spring\s+(2|two|bogie\s+2)|inner\s+(2|two)|bogie\s+2\s+inner(\s+spring)?|andar\s+ka\s+spring\s+2|दूसरा\s+इनर\s+स्प्रिंग|इनर\s+स्प्रिंग\s+2|इनर\s+2)(?:$|\s)/i
  },
  {
    canonicalPartName: 'Snubber Spring (Bogie 1)',
    category: 'SPRINGS',
    defaultPosition: 'BOGIE_1',
    aliases: ['snubber spring 1', 'snubber 1', 'bogie 1 snubber', 'स्नबर स्प्रिंग 1'],
    regex: /(?:^|\s)(snubber\s+spring\s+(1|one|bogie\s+1)|snubber\s+(1|one)|bogie\s+1\s+snubber|स्नबर\s+स्प्रिंग\s+1|स्नबर\s+1)(?:$|\s)/i
  },
  {
    canonicalPartName: 'Snubber Spring (Bogie 2)',
    category: 'SPRINGS',
    defaultPosition: 'BOGIE_2',
    aliases: ['snubber spring 2', 'snubber 2', 'bogie 2 snubber', 'स्नबर स्प्रिंग 2'],
    regex: /(?:^|\s)(snubber\s+spring\s+(2|two|bogie\s+2)|snubber\s+(2|two)|bogie\s+2\s+snubber|स्नबर\s+स्प्रिंग\s+2|स्नबर\s+2)(?:$|\s)/i
  },
  {
    canonicalPartName: 'Outer Spring',
    category: 'SPRINGS',
    aliases: ['outer spring', 'outer', 'bahar ka spring', 'bahari spring', 'outer coil', 'bahar wali spring', 'आउटर स्प्रिंग', 'आउटर', 'बाहरी स्प्रिंग'],
    regex: /(?:^|\s)(outer\s+spring|outer\s+coil|outer|bahar(\s+ka|\s+wali)?\s+spring|bahari\s+spring|आउटर(\s+स्प्रिंग)?|बाहरी\s+स्प्रिंग)(?:$|\s)/i
  },
  {
    canonicalPartName: 'Inner Spring',
    category: 'SPRINGS',
    aliases: ['inner spring', 'inner', 'andar ka spring', 'andari spring', 'inner coil', 'andar wali spring', 'इनर स्प्रिंग', 'इनर', 'भीतरी स्प्रिंग'],
    regex: /(?:^|\s)(inner\s+spring|inner\s+coil|inner|andar(\s+ka|\s+wali)?\s+spring|andari\s+spring|इनर(\s+स्प्रिंग)?|भीतरी\s+स्प्रिंग)(?:$|\s)/i
  },
  {
    canonicalPartName: 'Snubber Spring',
    category: 'SPRINGS',
    aliases: ['snubber spring', 'snubber', 'snubber coil', 'damper spring', 'स्नबर स्प्रिंग', 'स्नबर'],
    regex: /(?:^|\s)(snubber(\s+spring|\s+coil)?|damper\s+spring|स्नबर(\s+स्प्रिंग)?)(?:$|\s)/i
  },

  // 2. FRICTION WEDGES
  {
    canonicalPartName: 'Wedge Vertical Face & Spigot Fit',
    category: 'FRICTION_WEDGES',
    aliases: ['vertical face', 'spigot fit', 'wedge vertical face', 'wedge spigot', 'वर्टिकल फेस', 'स्पिगॉट'],
    regex: /(?:^|\s)(vertical\s+face|spigot(\s+fit)?|wedge\s+vertical|वर्टिकल\s+फेस|स्पिगॉट)(?:$|\s)/i
  },
  {
    canonicalPartName: 'Wedge Main Slope Surface',
    category: 'FRICTION_WEDGES',
    aliases: ['friction wedge', 'wedge', 'friction slope', 'wedge slope', 'main slope', 'wedge main slope surface', 'घर्षण वेज', 'वेज', 'फ्रिक्शन वेज'],
    regex: /(?:^|\s)(friction\s+wedge|wedge(\s+slope|\s+main\s+slope)?|friction\s+shoe|घर्षण\s+वेज|फ्रिक्शन\s+वेज|वेज(\s+स्लोप)?)(?:$|\s)/i
  },

  // 3. BEARINGS
  {
    canonicalPartName: 'Axle Box Adapter Crown Wear',
    category: 'BEARINGS',
    aliases: ['adapter crown', 'axle box adapter', 'adapter wear', 'crown wear', 'adapter', 'एडाप्टर क्राउन', 'एक्सल बॉक्स एडाप्टर'],
    regex: /(?:^|\s)(adapter\s+crown(\s+wear)?|axle\s+box\s+adapter|adapter\s+wear|crown\s+wear|एडाप्टर(\s+क्राउन)?|एक्सल\s+बॉक्स\s+एडाप्टर)(?:$|\s)/i
  },
  {
    canonicalPartName: 'Grease Seals & End Cap Bolts',
    category: 'BEARINGS',
    aliases: ['grease seal', 'grease seals', 'end cap bolts', 'end cap', 'cap bolts', 'ग्रीस सील', 'एंड कैप'],
    regex: /(?:^|\s)(grease\s+seal(s)?|end\s+cap(\s+bolts)?|cap\s+bolts|ग्रीस\s+सील|एंड\s+कैप(\s+बोल्ट)?)(?:$|\s)/i
  },
  {
    canonicalPartName: 'CTRB Cartridge Bearing Rotation',
    category: 'BEARINGS',
    aliases: ['ctrb bearing', 'ctrb', 'bearing', 'cartridge bearing', 'roller bearing', 'bearing rotation', 'सीटीआरबी बेयरिंग', 'बेयरिंग', 'सीटीआरबी'],
    regex: /(?:^|\s)(ctrb(\s+cartridge)?(\s+bearing)?(\s+rotation)?|cartridge\s+bearing|roller\s+bearing|bearing|सीटीआरबी(\s+बेयरिंग)?|बेयरिंग)(?:$|\s)/i
  },

  // 4. WHEELS & AXLES
  {
    canonicalPartName: 'Wheel Tread Diameter (Axle 1-4)',
    category: 'WHEELS_AXLES',
    aliases: ['wheel tread', 'wheel diameter', 'tread diameter', 'wheel tread diameter', 'पहिया डाया', 'ट्रेड डाया'],
    regex: /(?:^|\s)(wheel\s+tread(\s+diameter)?|wheel\s+diameter|tread\s+diameter|पहिया\s+(डाया|व्यास)|ट्रेड\s+डाया)(?:$|\s)/i
  },
  {
    canonicalPartName: 'Flange Thickness (Min 16.0mm)',
    category: 'WHEELS_AXLES',
    aliases: ['flange thickness', 'flange', 'wheel flange', 'फ्लैंज मोटाई', 'फ्लैंज'],
    regex: /(?:^|\s)(flange(\s+thickness)?|wheel\s+flange|फ्लैंज(\s+मोटाई)?)(?:$|\s)/i
  },
  {
    canonicalPartName: 'Wheel Gauge (1600 +2/-1 mm)',
    category: 'WHEELS_AXLES',
    aliases: ['wheel gauge', 'gauge', 'track gauge', 'व्हील गेज', 'गेज'],
    regex: /(?:^|\s)(wheel\s+gauge|wheelset\s+gauge|व्हील\s+गेज|गेज)(?:$|\s)/i
  },
  {
    canonicalPartName: 'Axle Journal UST Flaw Detection',
    category: 'WHEELS_AXLES',
    aliases: ['axle journal', 'journal ust', 'ust flaw detection', 'axle ust', 'ust', 'ultrasonic test', 'एक्सेल जर्नल', 'यूएसटी टेस्ट', 'धुरी परीक्षण'],
    regex: /(?:^|\s)(axle\s+journal|journal\s+ust|ust(\s+flaw\s+detection)?|axle\s+ust|ultrasonic\s+test|एक्सेल\s+जर्नल|यूएसटी(\s+टेस्ट)?|धुरी\s+परीक्षण)(?:$|\s)/i
  },

  // 5. BRAKE SYSTEM
  {
    canonicalPartName: 'Composite Brake Blocks (Min 10mm)',
    category: 'BRAKE_SYSTEM',
    aliases: ['brake blocks', 'brake shoes', 'composite brake blocks', 'brake block', 'ब्रेक ब्लॉक', 'ब्रेक शू'],
    regex: /(?:^|\s)(composite\s+brake\s+blocks?|brake\s+blocks?|brake\s+shoes?|ब्रेक\s+ब्लॉक|ब्रेक\s+शू)(?:$|\s)/i
  },
  {
    canonicalPartName: 'SAB Slack Adjuster DA-2(T)',
    category: 'BRAKE_SYSTEM',
    aliases: ['slack adjuster', 'sab', 'sab slack adjuster', 'da-2', 'स्लैक एडजस्टर', 'एसएबी'],
    regex: /(?:^|\s)(sab(\s+slack\s+adjuster)?|slack\s+adjuster|da-?2\(?t\)?|एसएबी|स्लैक\s+एडजस्टर)(?:$|\s)/i
  },
  {
    canonicalPartName: 'Brake Cylinder Piston Stroke',
    category: 'BRAKE_SYSTEM',
    aliases: ['brake cylinder', 'piston stroke', 'brake piston', 'ब्रेक सिलेंडर', 'पिस्टन स्ट्रोक'],
    regex: /(?:^|\s)(brake\s+cylinder(\s+piston\s+stroke)?|piston\s+stroke|brake\s+piston|ब्रेक\s+सिलेंडर|पिस्टन\s+स्ट्रोक)(?:$|\s)/i
  },
  {
    canonicalPartName: 'Distributor Valve KE/C3W',
    category: 'BRAKE_SYSTEM',
    aliases: ['distributor valve', 'dv valve', 'dv', 'ke valve', 'c3w valve', 'डिस्ट्रिब्यूटर वाल्व', 'डीवी वाल्व'],
    regex: /(?:^|\s)(distributor\s+valve|dv(\s+valve)?|ke(\s+valve|\/c3w)?|c3w(\s+valve)?|डिस्ट्रिब्यूटर\s+वाल्व|डीवी\s+वाल्व)(?:$|\s)/i
  },
  {
    canonicalPartName: 'Air Hose & Angle Cocks',
    category: 'BRAKE_SYSTEM',
    aliases: ['air hose', 'angle cocks', 'angle cock', 'brake pipe hose', 'cut off angle cock', 'एयर होज', 'एंगल कॉक', 'ब्रेक पाइप'],
    regex: /(?:^|\s)(air\s+hose(\s*&\s*angle\s+cocks?)?|angle\s+cocks?|brake\s+pipe\s+hose|एयर\s+होज|एंगल\s+कॉक|ब्रेक\s+पाइप)(?:$|\s)/i
  },
  {
    canonicalPartName: 'Brake Beams & Truss Assembly',
    category: 'BRAKE_SYSTEM',
    aliases: ['brake beam', 'brake beams', 'truss assembly', 'brake truss', 'brake', 'ब्रेक बीम', 'ट्रस असेंबली', 'ब्रेक'],
    regex: /(?:^|\s)(brake\s+beams?(\s*&\s*truss\s+assembly)?|truss\s+assembly|brake\s+truss|ब्रेक\s+बीम|ट्रस\s+असेंबली)(?:$|\s)/i
  },

  // 6. COUPLERS & DRAFT GEAR (Put Knuckle Nose Wear BEFORE Coupler Body Contour)
  {
    canonicalPartName: 'CBC Knuckle Nose Wear',
    category: 'COUPLERS_DRAFT_GEAR',
    aliases: ['knuckle nose wear', 'knuckle', 'knuckle nose', 'cbc knuckle', 'नकल', 'सीबीसी नकल', 'नकल पिन'],
    regex: /(?:^|\s)(cbc\s+knuckle|knuckle(\s+nose(\s+wear)?)?|नकल(\s+नोज)?|सीबीसी\s+नकल)(?:$|\s)/i
  },
  {
    canonicalPartName: 'Mark-50 Draft Gear Housing',
    category: 'COUPLERS_DRAFT_GEAR',
    aliases: ['draft gear', 'mark-50', 'mark 50', 'draft gear housing', 'draft pack', 'ड्राफ्ट गियर', 'मार्क 50'],
    regex: /(?:^|\s)(draft\s+gear(\s+housing)?|mark-?50|draft\s+pack|ड्राफ्ट\s+गियर|मार्क\s+50)(?:$|\s)/i
  },
  {
    canonicalPartName: 'Striker Casting Wear Plate',
    category: 'COUPLERS_DRAFT_GEAR',
    aliases: ['striker casting', 'wear plate', 'striker wear plate', 'striker plate', 'स्ट्राइकर कास्टिंग', 'वियर प्लेट'],
    regex: /(?:^|\s)(striker\s+casting(\s+wear\s+plate)?|wear\s+plate|striker\s+plate|स्ट्राइकर\s+कास्टिंग|वियर\s+प्लेट)(?:$|\s)/i
  },
  {
    canonicalPartName: 'CBC Coupler Body Contour',
    category: 'COUPLERS_DRAFT_GEAR',
    aliases: ['cbc coupler', 'coupler body', 'coupler', 'cbc', 'coupler contour', 'सीबीसी कपलर', 'कपलर बॉडी', 'कपलर'],
    regex: /(?:^|\s)(cbc(\s+coupler)?(\s+body\s+contour)?|coupler(\s+body)?|सीबीसी(\s+कपलर)?|कपलर(\s+बॉडी)?)(?:$|\s)/i
  },

  // 7. BOGIE FRAME & BOLSTER
  {
    canonicalPartName: 'Side Frame Column Liners',
    category: 'BOGIE_FRAME_BOLSTER',
    aliases: ['side frame', 'column liners', 'side frame liners', 'column liner', 'साइड फ्रेम', 'कॉलम लाइनर'],
    regex: /(?:^|\s)(side\s+frame(\s+column\s+liners?)?|column\s+liners?|side\s+frame\s+liners?|साइड\s+फ्रेम|कॉलम\s+लाइनर)(?:$|\s)/i
  },
  {
    canonicalPartName: 'Bolster Pocket Slope Liners',
    category: 'BOGIE_FRAME_BOLSTER',
    aliases: ['bolster pocket', 'slope liners', 'bolster liners', 'pocket liners', 'बोल्स्टर पॉकेट', 'स्लोप लाइनर'],
    regex: /(?:^|\s)(bolster\s+pocket(\s+slope\s+liners?)?|slope\s+liners?|bolster\s+liners?|बोल्स्टर\s+पॉकेट|स्लोप\s+लाइनर)(?:$|\s)/i
  },
  {
    canonicalPartName: 'Center Plate & Pivot Pin',
    category: 'BOGIE_FRAME_BOLSTER',
    aliases: ['center plate', 'pivot pin', 'bogie center plate', 'center pivot', 'सेंटर प्लेट', 'पिवट पिन'],
    regex: /(?:^|\s)(center\s+plate(\s*&\s*pivot\s+pin)?|pivot\s+pin|center\s+pivot|सेंटर\s+प्लेट|पिवट\s+पिन)(?:$|\s)/i
  },
  {
    canonicalPartName: 'Constant Contact Side Bearers',
    category: 'BOGIE_FRAME_BOLSTER',
    aliases: ['side bearers', 'side bearer', 'ccsb', 'constant contact side bearer', 'elastomeric pad', 'em pad', 'side bearer pad', 'साइड बेयरर', 'इलास्टोमेरिक पैड', 'ईएम पैड'],
    regex: /(?:^|\s)(constant\s+contact\s+side\s+bearers?|side\s+bearers?|ccsb|elastomeric\s+pad|em\s+pad|साइड\s+बेयरर|इलास्टोमेरिक\s+पैड|ईएम\s+पैड)(?:$|\s)/i
  },

  // 8. BODY & UNDERFRAME
  {
    canonicalPartName: 'Center Sill & Sole Bar Camber',
    category: 'BODY_UNDERFRAME',
    aliases: ['center sill', 'sole bar', 'camber', 'underframe camber', 'solebar', 'सेंटर सिल', 'सोल बार', 'अंडरफ्रेम'],
    regex: /(?:^|\s)(center\s+sill(\s*&\s*sole\s+bar\s+camber)?|sole\s+bar|underframe\s+camber|solebar|सेंटर\s+सिल|सोल\s+बार|अंडरफ्रेम)(?:$|\s)/i
  },
  {
    canonicalPartName: 'Steel Flooring & Perforations',
    category: 'BODY_UNDERFRAME',
    aliases: ['steel flooring', 'flooring', 'wagon floor', 'perforations', 'floor sheet', 'स्टील फ्लोरिंग', 'वैगन फर्श', 'फर्श'],
    regex: /(?:^|\s)(steel\s+flooring(\s*&\s*perforations)?|wagon\s+floor(ing)?|perforations|floor\s+sheet|स्टील\s+फ्लोरिंग|वैगन\s+फर्श|फर्श)(?:$|\s)/i
  },
  {
    canonicalPartName: 'Side Doors & Locking Gear',
    category: 'BODY_UNDERFRAME',
    aliases: ['side doors', 'locking gear', 'wagon door', 'door lock', 'discharge door', 'door latch', 'साइड डोर', 'लॉकिंग गियर', 'दरवाजा'],
    regex: /(?:^|\s)(side\s+doors?(\s*&\s*locking\s+gear)?|wagon\s+doors?|locking\s+gear|discharge\s+door|साइड\s+डोर|लॉकिंग\s+गियर|दरवाजा)(?:$|\s)/i
  },
  {
    canonicalPartName: 'Paint & Stenciling Legibility',
    category: 'BODY_UNDERFRAME',
    aliases: ['paint', 'stenciling', 'paint and stenciling', 'marking', 'wagon paint', 'lettering', 'पेंट व स्टेनसिलिंग', 'पेंट', 'मार्किंग'],
    regex: /(?:^|\s)(paint(\s*&\s*stenciling(\s+legibility)?)?|stenciling|wagon\s+(paint|marking)|पेंट(िंग)?|स्टेनसिलिंग|मार्किंग)(?:$|\s)/i
  }
];

// -----------------------------------------------------------------------------
// 6. Defect Notes Matchers
// -----------------------------------------------------------------------------

export interface DefectPattern {
  name: string;
  regex: RegExp;
  standardNoteEn: string;
  standardNoteHi: string;
}

export const DEFECT_PATTERNS: DefectPattern[] = [
  {
    name: 'DEEP_CRACK',
    regex: /(?:^|\s)(deep\s+crack|crack\s+detected|fracture|broken\s+coil|darar|गहरी\s+दरार|दरार|टूटी\s+कॉइल)(?:$|\s)/i,
    standardNoteEn: 'Deep crack / fracture detected',
    standardNoteHi: 'गहरी दरार / फ्रैक्चर पाया गया'
  },
  {
    name: 'SURFACE_CRACK',
    regex: /(?:^|\s)(surface\s+crack|hairline\s+crack|minor\s+crack|सतह\s+दरार|बाल\s+जैसी\s+दरार)(?:$|\s)/i,
    standardNoteEn: 'Surface / hairline crack observed',
    standardNoteHi: 'सतह पर बाल जैसी दरार'
  },
  {
    name: 'GROOVE_WORN',
    regex: /(?:^|\s)(groove\s+worn|groove\s+wear|excessive\s+wear|worn\s+out|ghisa\s+hua|ghisa|घिसा\s+हुआ|अत्यधिक\s+घिसाव|ग्रूव\s+घिसा)(?:$|\s)/i,
    standardNoteEn: 'Groove worn / excessive surface wear',
    standardNoteHi: 'ग्रूव घिसा हुआ / अत्यधिक घिसाव'
  },
  {
    name: 'BROKEN_CHIPPED',
    regex: /(?:^|\s)(broken|chipped|toota\s+hua|tuta\s+hua|toota|tuta|टुकड़ा\s+टूटा|टूटा\s+हुआ|टूटा)(?:$|\s)/i,
    standardNoteEn: 'Broken / chipped component',
    standardNoteHi: 'टूटा हुआ / खंडित घटक'
  },
  {
    name: 'BENT_DEFORMED',
    regex: /(?:^|\s)(bent|deformed|permanent\s+set|tilt|terha|muda\s+hua|मुड़ा\s+हुआ|टेढ़ा|स्थायी\s+विकृति)(?:$|\s)/i,
    standardNoteEn: 'Bent / permanent deformation',
    standardNoteHi: 'मुड़ा हुआ / स्थायी विकृति'
  },
  {
    name: 'HEAVY_CORROSION',
    regex: /(?:^|\s)(heavy\s+corrosion|corroded|pitting|severe\s+rust|jung\s+laga|zang|अत्यधिक\s+जंग|क्षरण)(?:$|\s)/i,
    standardNoteEn: 'Severe corrosion / pitting detected',
    standardNoteHi: 'अत्यधिक जंग / क्षरण'
  },
  {
    name: 'LOOSE_BOLTS',
    regex: /(?:^|\s)(loose\s+bolt|missing\s+pin|loose\s+rivet|dhila\s+bolt|ढीला\s+बोल्ट|गायब\s+पिन)(?:$|\s)/i,
    standardNoteEn: 'Loose / missing fastener or pin',
    standardNoteHi: 'ढीला बोल्ट / गायब पिन'
  },
  {
    name: 'LEAKAGE_AIR_GREASE',
    regex: /(?:^|\s)(air\s+leak(age)?|grease\s+leak|grease\s+oozing|hiss|हवा\s+का\s+रिसाव|ग्रीस\s+लीक|लीकेज)(?:$|\s)/i,
    standardNoteEn: 'Air pressure or grease leakage detected',
    standardNoteHi: 'हवा / ग्रीस का रिसाव'
  }
];

export function extractDefectNotes(
  normalized: string,
  matchedComponent?: ComponentAliasMapping,
  matchedStatus?: PartInspectionStatus
): string | undefined {
  const detectedStandardNotesEn: string[] = [];

  for (const pat of DEFECT_PATTERNS) {
    if (pat.regex.test(normalized)) {
      detectedStandardNotesEn.push(pat.standardNoteEn);
    }
  }

  // Also check if there are specific detail tokens in parenthetical or freeform notes
  const noteMatch = normalized.match(/(?:with|because|due to|notes?|reason|defect)\s+([a-z0-9\s]+)/i);
  if (noteMatch && noteMatch[1]) {
    const rawNote = noteMatch[1].trim();
    if (rawNote && !detectedStandardNotesEn.includes(rawNote)) {
      detectedStandardNotesEn.push(rawNote);
    }
  }

  if (detectedStandardNotesEn.length > 0) {
    return detectedStandardNotesEn.join('; ');
  }

  return undefined;
}

// -----------------------------------------------------------------------------
// 7. Category Labels
// -----------------------------------------------------------------------------

export function getCategoryLabelEn(cat: CASNUBCategory): string {
  const map: Record<CASNUBCategory, string> = {
    SPRINGS: 'Springs & Suspension',
    WHEELS_AXLES: 'Wheels & Axles',
    BEARINGS: 'CTRB & Bearings',
    BRAKE_SYSTEM: 'Air Brake System',
    COUPLERS_DRAFT_GEAR: 'CBC Couplers & Draft Gear',
    BOGIE_FRAME_BOLSTER: 'Bogie Frame & Bolster',
    FRICTION_WEDGES: 'Friction Wedges',
    BODY_UNDERFRAME: 'Body & Underframe'
  };
  return map[cat] || cat;
}

export function getCategoryLabelHi(cat: CASNUBCategory): string {
  const map: Record<CASNUBCategory, string> = {
    SPRINGS: 'स्प्रिंग्स एवं सस्पेंशन',
    WHEELS_AXLES: 'पहिए एवं धुरी',
    BEARINGS: 'सीटीआरबी बेयरिंग्स',
    BRAKE_SYSTEM: 'एयर ब्रेक प्रणाली',
    COUPLERS_DRAFT_GEAR: 'सीबीसी कपलर व ड्राफ्ट गियर',
    BOGIE_FRAME_BOLSTER: 'बोगी फ्रेम एवं बोल्स्टर',
    FRICTION_WEDGES: 'घर्षण वेज',
    BODY_UNDERFRAME: 'बॉडी एवं अंडरफ्रेम'
  };
  return map[cat] || cat;
}

// -----------------------------------------------------------------------------
// 8. Spring Classification Voice Command Matcher (Stage 3 Inspection Screen)
// -----------------------------------------------------------------------------

export function parseSpringInspectionCommand(
  normalized: string,
  rawText: string
): {
  isSpringParam: boolean;
  springParams: {
    measuredHeight?: number;
    bogieType?: BogieType;
    position?: SpringPosition;
    condition?: SpringCondition;
    isSaveCommand?: boolean;
  };
} {
  const converted = convertDevanagariDigits(normalized);
  const result: {
    isSpringParam: boolean;
    springParams: {
      measuredHeight?: number;
      bogieType?: BogieType;
      position?: SpringPosition;
      condition?: SpringCondition;
      isSaveCommand?: boolean;
    };
  } = {
    isSpringParam: false,
    springParams: {}
  };

  // 1. Check for Save / Submit command
  if (/(?:^|\s)(save(\s+inspection)?|submit(\s+record)?|save\s+karo|surakshit\s+kare|सुरक्षित\s+करें|सेव\s+करें)(?:$|\s)/i.test(converted)) {
    result.isSpringParam = true;
    result.springParams.isSaveCommand = true;
    return result;
  }

  // 2. Check for Height (e.g. "height 260.5", "260.5 mm", "260.5 millimeter", "२६०.५")
  const heightMatch = converted.match(/(?:^|\s)(?:height|unchai|uchai|ऊंचाई|हाइट)?\s*([1-4]\d{2}(?:\.\d{1,2})?)\s*(?:mm|millimeter|mili\s*meter|मिमी|मिलीमीटर)?(?:$|\s)/i);
  if (heightMatch && heightMatch[1]) {
    const val = parseFloat(heightMatch[1]);
    if (val >= 100 && val <= 500) {
      result.isSpringParam = true;
      result.springParams.measuredHeight = val;
    }
  }

  // 3. Check for Bogie Type
  if (/(?:^|\s)(casnub\s*22\s*nlb|nlb\s+bogie|\bnlb\b|एनएलबी)(?:$|\s)/i.test(converted)) {
    result.isSpringParam = true;
    result.springParams.bogieType = 'CASNUB_22_NLB';
  } else if (/(?:^|\s)(casnub\s*22\s*hs|hs\s+bogie|\bhs\b|एचएस)(?:$|\s)/i.test(converted)) {
    result.isSpringParam = true;
    result.springParams.bogieType = 'CASNUB_22_HS';
  } else if (/(?:^|\s)(casnub\s*22\s*rft|rft\s+bogie|\brft\b|आरएफटी)(?:$|\s)/i.test(converted)) {
    result.isSpringParam = true;
    result.springParams.bogieType = 'CASNUB_22_RFT';
  }

  // 4. Check for explicit position only if NOT part of a status update command
  if (/(?:^|\s)(select\s+outer|set\s+outer|position\s+outer|outer\s+coil\s+position)(?:$|\s)/i.test(converted)) {
    result.isSpringParam = true;
    result.springParams.position = 'OUTER';
  } else if (/(?:^|\s)(select\s+inner|set\s+inner|position\s+inner|inner\s+coil\s+position)(?:$|\s)/i.test(converted)) {
    result.isSpringParam = true;
    result.springParams.position = 'INNER';
  } else if (/(?:^|\s)(select\s+snubber|set\s+snubber|position\s+snubber|snubber\s+position)(?:$|\s)/i.test(converted)) {
    result.isSpringParam = true;
    result.springParams.position = 'SNUBBER';
  }

  // 5. Check for explicit condition selection
  if (/(?:^|\s)(used\s+spring|old\s+spring|condition\s+used|पुरानी\s+स्प्रिंग|पुराना\s+स्प्रिंग)(?:$|\s)/i.test(converted)) {
    result.isSpringParam = true;
    result.springParams.condition = 'USED';
  } else if (/(?:^|\s)(new\s+spring|fresh\s+spring|condition\s+new|नया\s+स्प्रिंग|नई\s+स्प्रिंग)(?:$|\s)/i.test(converted)) {
    result.isSpringParam = true;
    result.springParams.condition = 'NEW';
  }

  return result;
}

// -----------------------------------------------------------------------------
// 9. Main Spoken Voice Command Parser
// -----------------------------------------------------------------------------

export function parseVoiceCommand(
  rawTranscript: string,
  currentCategory?: CASNUBCategory,
  availableItems?: ChecklistItem[]
): VoiceParseResult {
  if (!rawTranscript || rawTranscript.trim().length === 0) {
    return {
      matched: false,
      actionType: 'UNKNOWN',
      intent: 'UNKNOWN',
      feedbackMessage: 'No speech recognized. Please speak an inspection command.',
      feedbackMessageHi: 'कोई ध्वनि आदेश नहीं मिला। कृपया निरीक्षण आदेश बोलें।',
      rawTranscript: '',
      transcript: '',
      confidence: 0,
      detectedLanguage: 'en'
    };
  }

  const normalized = normalizeTranscript(rawTranscript);
  const detectedLang = detectLanguage(rawTranscript);

  // 1. Check for UNDO Command
  if (UNDO_REGEX.test(normalized)) {
    return {
      matched: true,
      actionType: 'UNDO',
      intent: 'UNDO',
      feedbackMessage: 'Undoing previous inspection update.',
      feedbackMessageHi: 'पिछला निरीक्षण बदलाव वापस लिया गया।',
      rawTranscript,
      transcript: rawTranscript,
      normalizedTranscript: normalized,
      confidence: 0.99,
      detectedLanguage: detectedLang
    };
  }

  // 2. Check for Status Match in spoken phrase
  let detectedStatus: PartInspectionStatus | undefined;
  for (const pat of STATUS_PATTERNS) {
    if (pat.regex.test(normalized)) {
      detectedStatus = pat.status;
      break;
    }
  }

  // 3. Match Target Component
  let matchedComponent: ComponentAliasMapping | undefined;
  let targetItemId: string | undefined;

  // Pass 3a: Match known aliases from COMPONENT_ALIASES
  for (const comp of COMPONENT_ALIASES) {
    if (comp.regex.test(normalized)) {
      matchedComponent = comp;
      break;
    }
  }

  // Pass 3b: Match against availableItems passed from active checklist
  if (availableItems && availableItems.length > 0) {
    if (matchedComponent) {
      // Find matching item in available items list
      const matched = availableItems.find(
        (it) =>
          it.partName.toLowerCase().includes(matchedComponent!.canonicalPartName.toLowerCase()) ||
          matchedComponent!.canonicalPartName.toLowerCase().includes(it.partName.toLowerCase()) ||
          (it.category === matchedComponent!.category && (!matchedComponent!.defaultPosition || it.bogiePosition === matchedComponent!.defaultPosition))
      );
      if (matched) {
        targetItemId = matched.id;
      }
    } else {
      // Try fuzzy matching against item partName
      for (const item of availableItems) {
        const itemWords = item.partName.toLowerCase().split(/[\s\(\)\/]+/);
        const significantWords = itemWords.filter((w) => w.length > 3 && !['bogie', 'wear', 'assembly', 'system'].includes(w));
        if (significantWords.length > 0 && significantWords.some((w) => normalized.includes(w))) {
          targetItemId = item.id;
          matchedComponent = {
            canonicalPartName: item.partName,
            category: item.category,
            aliases: [item.partName],
            regex: new RegExp(item.partName, 'i')
          };
          break;
        }
      }
    }
  }

  // Pass 3c: If status was spoken but component was omitted, fallback to active category's pending item
  if (detectedStatus && !matchedComponent && currentCategory && availableItems) {
    const itemsInCat = availableItems.filter((i) => i.category === currentCategory);
    const pendingItem = itemsInCat.find((i) => !i.status || i.status === 'FAIL') || itemsInCat[0];
    if (pendingItem) {
      matchedComponent = {
        canonicalPartName: pendingItem.partName,
        category: currentCategory,
        aliases: [pendingItem.partName],
        regex: new RegExp(pendingItem.partName, 'i')
      };
      targetItemId = pendingItem.id;
    }
  }

  // 4. If status + component matched -> UPDATE_STATUS
  if (matchedComponent && detectedStatus) {
    const defectNotes = extractDefectNotes(normalized, matchedComponent, detectedStatus);
    const partName = matchedComponent.canonicalPartName;
    const cat = matchedComponent.category;

    const statusMapEn: Record<PartInspectionStatus, string> = {
      PASS: 'PASS / Serviceable',
      CONDEMNED: 'CONDEMNED / Scrap',
      REPAIRED: 'REPAIRED & Tested',
      REPLACED: 'REPLACED with New',
      FAIL: 'DEFECTIVE / Fail'
    };

    const statusMapHi: Record<PartInspectionStatus, string> = {
      PASS: 'पास / सेवा योग्य',
      CONDEMNED: 'कंडम / स्क्रैप',
      REPAIRED: 'मरम्मत पूर्ण',
      REPLACED: 'नया प्रतिस्थापित',
      FAIL: 'दोषपूर्ण'
    };

    const feedbackEn = defectNotes
      ? `Marked "${partName}" as ${statusMapEn[detectedStatus]} (Defect: ${defectNotes}).`
      : `Marked "${partName}" as ${statusMapEn[detectedStatus]}.`;

    const feedbackHi = defectNotes
      ? `"${partName}" को टिप्पणी "${defectNotes}" के साथ ${statusMapHi[detectedStatus]} चिह्नित किया गया।`
      : `"${partName}" को ${statusMapHi[detectedStatus]} चिह्नित किया गया।`;

    return {
      matched: true,
      actionType: 'UPDATE_STATUS',
      intent: 'UPDATE_STATUS',
      targetPartName: partName,
      itemName: partName,
      targetCategory: cat,
      category: cat,
      targetItemId: targetItemId,
      itemId: targetItemId,
      status: detectedStatus,
      defectNotes: defectNotes,
      feedbackMessage: feedbackEn,
      feedbackMessageHi: feedbackHi,
      rawTranscript,
      transcript: rawTranscript,
      normalizedTranscript: normalized,
      confidence: 0.95,
      detectedLanguage: detectedLang
    };
  }

  // 5. Check for CATEGORY NAVIGATION Command (only if no status update matched)
  if (!detectedStatus) {
    for (const [catKey, regex] of Object.entries(CATEGORY_NAVIGATION_MAP)) {
      if (regex.test(normalized)) {
        const category = catKey as CASNUBCategory;
        const catLabelEn = getCategoryLabelEn(category);
        const catLabelHi = getCategoryLabelHi(category);

        return {
          matched: true,
          actionType: 'SWITCH_CATEGORY',
          intent: 'SWITCH_CATEGORY',
          category: category,
          categoryToSwitch: category,
          feedbackMessage: `Navigated to ${catLabelEn} section.`,
          feedbackMessageHi: `${catLabelHi} अनुभाग खोला गया।`,
          rawTranscript,
          transcript: rawTranscript,
          normalizedTranscript: normalized,
          confidence: 0.96,
          detectedLanguage: detectedLang
        };
      }
    }
  }

  // 6. Check for Stage 3 Spring Classification Commands (e.g. height, bogie type, save)
  const springResult = parseSpringInspectionCommand(normalized, rawTranscript);
  if (springResult.isSpringParam) {
    const params = springResult.springParams;
    let feedbackEn = 'Spring parameter updated.';
    let feedbackHi = 'स्प्रिंग पैरामीटर अद्यतन हुआ।';

    if (params.isSaveCommand) {
      feedbackEn = 'Saving spring inspection record.';
      feedbackHi = 'स्प्रिंग निरीक्षण रिकॉर्ड सुरक्षित किया जा रहा है।';
    } else if (params.measuredHeight) {
      feedbackEn = `Measured height set to ${params.measuredHeight} mm.`;
      feedbackHi = `मापी गई ऊंचाई ${params.measuredHeight} मिमी निर्धारित की गई।`;
    } else if (params.bogieType) {
      feedbackEn = `Bogie type set to ${params.bogieType.replace(/_/g, ' ')}.`;
      feedbackHi = `बोगी प्रकार सेट किया गया।`;
    } else if (params.position) {
      feedbackEn = `Spring position set to ${params.position}.`;
      feedbackHi = `स्प्रिंग स्थिति सेट की गई।`;
    } else if (params.condition) {
      feedbackEn = `Spring condition set to ${params.condition}.`;
      feedbackHi = `स्प्रिंग स्थिति (Used/New) सेट की गई।`;
    }

    return {
      matched: true,
      actionType: 'CLASSIFY_SPRING',
      intent: 'CLASSIFY_SPRING',
      springParams: params,
      feedbackMessage: feedbackEn,
      feedbackMessageHi: feedbackHi,
      rawTranscript,
      transcript: rawTranscript,
      normalizedTranscript: normalized,
      confidence: 0.95,
      detectedLanguage: detectedLang
    };
  }

  // 7. If only component matched without status
  if (matchedComponent && !detectedStatus) {
    return {
      matched: false,
      actionType: 'UNKNOWN',
      intent: 'UNKNOWN',
      targetPartName: matchedComponent.canonicalPartName,
      itemName: matchedComponent.canonicalPartName,
      targetCategory: matchedComponent.category,
      category: matchedComponent.category,
      targetItemId: targetItemId,
      itemId: targetItemId,
      feedbackMessage: `Recognized "${matchedComponent.canonicalPartName}". Please state status (Pass, Condemn, Repaired, Replaced).`,
      feedbackMessageHi: `"${matchedComponent.canonicalPartName}" पहचाना गया। कृपया स्थिति बताएं (पास, कंडम, मरम्मत, बदला)।`,
      rawTranscript,
      transcript: rawTranscript,
      normalizedTranscript: normalized,
      confidence: 0.65,
      detectedLanguage: detectedLang
    };
  }

  // Unknown command
  return {
    matched: false,
    actionType: 'UNKNOWN',
    intent: 'UNKNOWN',
    feedbackMessage: `Command not recognized: "${rawTranscript}". Try: "Outer spring passes", "Condemn friction wedge", "Undo".`,
    feedbackMessageHi: `आदेश पहचाना नहीं गया: "${rawTranscript}"। उदाहरण बोलें: "आउटर स्प्रिंग पास", "घर्षण वेज कंडम", "Undo"।`,
    rawTranscript,
    transcript: rawTranscript,
    normalizedTranscript: normalized,
    confidence: 0.2,
    detectedLanguage: detectedLang
  };
}
