/**
 * Bilingual Translation Dictionaries & Localization Service
 * Indian Railways WRS Raipur (Hindi + English)
 *
 * Provides complete bilingual coverage for shop-floor operators and supervisors.
 */

import type { BandColor, InspectionStatus, DamageType, BogieType, SpringCondition, SpringPosition } from '../../shared/types.ts';

export const I18N_DICTIONARIES = {
  en: {
    app: {
      title: 'Spring Classification & Inspection System',
      subtitle: 'Indian Railways — Wagon Repair Shop (WRS) Raipur',
      workshop: 'WRS Raipur Bogie Section',
      tagline: 'RDSO G-95 Revision-II Compliant'
    },
    nav: {
      inspection: 'Inspection',
      history: 'History & Logs',
      analytics: 'Analytics',
      admin: 'Admin Console',
      logout: 'Logout',
      sync: 'Sync Data'
    },
    roles: {
      Inspector: 'Inspector',
      Supervisor: 'Supervisor',
      Admin: 'Admin / DRM Officer'
    },
    bogieTypes: {
      CASNUB_22_NLB: 'CASNUB 22 NLB / NLB(M)',
      CASNUB_22_HS: 'CASNUB 22 HS / HS(M)',
      CASNUB_22_RFT: 'CASNUB 22 RFT'
    } as Record<BogieType, string>,
    positions: {
      OUTER: 'Outer Spring',
      INNER: 'Inner Spring',
      SNUBBER: 'Snubber Spring',
      SNUBBER_OUTER: 'Snubber Outer',
      SNUBBER_INNER: 'Snubber Inner'
    } as Record<SpringPosition, string>,
    conditions: {
      USED: 'Used / Old Spring (6 Bands)',
      NEW: 'New Spring (3 Bands)'
    } as Record<SpringCondition, string>,
    bands: {
      BLUE: 'Blue Band (Band I)',
      GREEN: 'Green Band',
      YELLOW: 'Yellow Band',
      ORANGE: 'Orange Band',
      WHITE: 'White Band',
      RED: 'Red Band'
    } as Record<BandColor, string>,
    statuses: {
      PASS: 'PASS / SERVICEABLE',
      CONDEMNED: 'CONDEMNED / SCRAP'
    } as Record<InspectionStatus, string>,
    damages: {
      NONE: 'No Visible Damage',
      CRACK: 'Surface Crack / Fracture',
      CORROSION: 'Heavy Corrosion / Pitting',
      DEFORMATION: 'Permanent Set / Tilt Deformation',
      OTHER: 'Other Defect'
    } as Record<DamageType, string>,
    actions: {
      capture: 'Capture Caliper Image',
      retake: 'Retake Photo',
      manualEntry: 'Manual Height Entry',
      classify: 'Classify Spring',
      saveInspection: 'Save & Log Inspection',
      override: 'Supervisor Override',
      confirmOverride: 'Authorize Override',
      exportData: 'Export Audit Trail',
      requestOtp: 'Request OTP',
      verifyOtp: 'Verify OTP'
    },
    messages: {
      classificationSuccess: 'Spring successfully classified per RDSO G-95',
      condemnedAlert: 'WARNING: Spring is CONDEMNED. Remove from bogie assembly.',
      overrideRequired: 'Override requires supervisor OTP authentication and mandatory justification.',
      offlineSaved: 'Offline: Inspection saved locally. Will sync automatically when online.',
      syncSuccess: 'Sync completed: all offline records uploaded successfully.',
      invalidMeasurement: 'Please enter a valid numeric measurement between 100.00mm and 500.00mm.'
    },
    stages: {
      ENTRY_REGISTRATION: 'Entry Registration',
      DISMANTLING: 'Dismantling',
      COMPONENT_INSPECTION: 'Component Inspection',
      REPAIR_REPLACEMENT: 'Repair / Replacement',
      REASSEMBLY: 'Reassembly',
      FINAL_QC_GATE: 'Final QC Gate',
      RELEASE: 'Release'
    },
    categories: {
      SPRINGS: 'Springs',
      WHEELS_AXLES: 'Wheels & Axles',
      BEARINGS: 'Bearings',
      BRAKE_SYSTEM: 'Brake System',
      COUPLERS_DRAFT_GEAR: 'Couplers & Draft Gear',
      BOGIE_FRAME_BOLSTER: 'Bogie Frame & Bolster',
      FRICTION_WEDGES: 'Friction Wedges',
      BODY_UNDERFRAME: 'Body / Underframe'
    },
    partStatuses: {
      PASS: 'Pass',
      FAIL: 'Fail',
      CONDEMNED: 'Condemned',
      REPAIRED: 'Repaired',
      REPLACED: 'Replaced'
    }
  },

  hi: {
    app: {
      title: 'स्प्रिंग वर्गीकरण एवं निरीक्षण प्रणाली',
      subtitle: 'भारतीय रेल — वैगन मरम्मत कारखाना (WRS) रायपुर',
      workshop: 'डब्लूआरएस रायपुर बोगी अनुभाग',
      tagline: 'आरडीएसओ जी-95 संशोधन-II अनुपालन'
    },
    nav: {
      inspection: 'स्प्रिंग निरीक्षण',
      history: 'इतिहास व लॉग्स',
      analytics: 'विश्लेषण',
      admin: 'प्रशासक कंसोल',
      logout: 'लॉग आउट',
      sync: 'डेटा सिंक करें'
    },
    roles: {
      Inspector: 'निरीक्षक (इस्पेक्टर)',
      Supervisor: 'पर्यवेक्षक (सुपरवाइजर)',
      Admin: 'प्रशासक / मंडल रेल प्रबंधक (DRM)'
    },
    bogieTypes: {
      CASNUB_22_NLB: 'कासनब 22 एनएलबी / एनएलबी(एम)',
      CASNUB_22_HS: 'कासनब 22 एचएस / एचएस(एम)',
      CASNUB_22_RFT: 'कासनब 22 आरएफटी'
    } as Record<BogieType, string>,
    positions: {
      OUTER: 'बाहरी स्प्रिंग (आउटर)',
      INNER: 'भीतरी स्प्रिंग (इनर)',
      SNUBBER: 'स्नबर स्प्रिंग',
      SNUBBER_OUTER: 'स्नबर आउटर',
      SNUBBER_INNER: 'स्नबर इनर'
    } as Record<SpringPosition, string>,
    conditions: {
      USED: 'प्रयुक्त / पुरानी स्प्रिंग (6 बैंड)',
      NEW: 'नई स्प्रिंग (3 बैंड)'
    } as Record<SpringCondition, string>,
    bands: {
      BLUE: 'नीला बैंड (बैंड I)',
      GREEN: 'हरा बैंड',
      YELLOW: 'पीला बैंड',
      ORANGE: 'नारंगी बैंड',
      WHITE: 'सफेद बैंड',
      RED: 'लाल बैंड'
    } as Record<BandColor, string>,
    statuses: {
      PASS: 'उत्तीर्ण / उपयोग योग्य',
      CONDEMNED: 'अस्वीकृत / निष्कासित (कंडम)'
    } as Record<InspectionStatus, string>,
    damages: {
      NONE: 'कोई प्रत्यक्ष क्षति नहीं',
      CRACK: 'सतह दरार / टूटन',
      CORROSION: 'अत्यधिक जंग / क्षरण',
      DEFORMATION: 'स्थायी विकृति / झुकाव',
      OTHER: 'अन्य दोष'
    } as Record<DamageType, string>,
    actions: {
      capture: 'कैलीपर फोटो लें',
      retake: 'पुनः फोटो लें',
      manualEntry: 'मैन्युअल माप दर्ज करें',
      classify: 'स्प्रिंग वर्गीकृत करें',
      saveInspection: 'निरीक्षण सुरक्षित करें',
      override: 'पर्यवेक्षक बदलाव (ओवरराइड)',
      confirmOverride: 'बदलाव प्रमाणित करें',
      exportData: 'ऑडिट लॉग निर्यात करें',
      requestOtp: 'ओटीपी अनुरोध करें',
      verifyOtp: 'ओटीपी सत्यापित करें'
    },
    messages: {
      classificationSuccess: 'स्प्रिंग का आरडीएसओ जी-95 के अनुसार सफलतापूर्वक वर्गीकरण हुआ',
      condemnedAlert: 'चेतावनी: स्प्रिंग अस्वीकृत (कंडम) है। इसे बोगी असेंबली से हटा दें।',
      overrideRequired: 'बदलाव के लिए पर्यवेक्षक ओटीपी प्रमाणीकरण और अनिवार्य कारण आवश्यक है।',
      offlineSaved: 'ऑफ़लाइन: निरीक्षण स्थानीय रूप से सहेजा गया। ऑनलाइन होने पर स्वतः सिंक होगा।',
      syncSuccess: 'सिंक पूर्ण: सभी ऑफ़लाइन रिकॉर्ड सफलतापूर्वक अपलोड हो गए।',
      invalidMeasurement: 'कृपया 100.00 मिमी से 500.00 मिमी के बीच एक मान्य संख्यात्मक माप दर्ज करें।'
    },
    stages: {
      ENTRY_REGISTRATION: 'प्रवेश पंजीकरण',
      DISMANTLING: 'डिसमेंटलिंग (विघटन)',
      COMPONENT_INSPECTION: 'घटक निरीक्षण',
      REPAIR_REPLACEMENT: 'मरम्मत / प्रतिस्थापन',
      REASSEMBLY: 'पुनः संयोजन (री-असेंबली)',
      FINAL_QC_GATE: 'अंतिम गुणवत्ता गेट',
      RELEASE: 'रिलीज़ / रवानगी'
    },
    categories: {
      SPRINGS: 'स्प्रिंग्स',
      WHEELS_AXLES: 'पहिए और धुरी',
      BEARINGS: 'बेयरिंग',
      BRAKE_SYSTEM: 'ब्रेक प्रणाली',
      COUPLERS_DRAFT_GEAR: 'युग्मक एवं ड्राफ्ट गियर',
      BOGIE_FRAME_BOLSTER: 'बोगी फ्रेम और बोल्स्टर',
      FRICTION_WEDGES: 'घर्षण वेज',
      BODY_UNDERFRAME: 'बॉडी / अंडरफ्रेम'
    },
    partStatuses: {
      PASS: 'उत्तीर्ण',
      FAIL: 'अनुत्तीर्ण',
      CONDEMNED: 'कंडम / अस्वीकृत',
      REPAIRED: 'मरम्मत किया गया',
      REPLACED: 'प्रतिस्थापित'
    }
  }
};

export type LanguageCode = 'en' | 'hi';

export function getTranslation(lang: LanguageCode = 'en') {
  return I18N_DICTIONARIES[lang] || I18N_DICTIONARIES.en;
}

export function getLocalizedBandName(band: BandColor, lang: LanguageCode = 'en'): string {
  const dict = getTranslation(lang);
  return dict.bands[band] || band;
}

export function getLocalizedStatus(status: InspectionStatus, lang: LanguageCode = 'en'): string {
  const dict = getTranslation(lang);
  return dict.statuses[status] || status;
}

export function getLocalizedDamageType(damage: DamageType, lang: LanguageCode = 'en'): string {
  const dict = getTranslation(lang);
  return dict.damages[damage] || damage;
}

export function getLocalizedStage(stage: string, lang: LanguageCode = 'en'): string {
  const dict = getTranslation(lang);
  return (dict as any).stages?.[stage] || stage;
}

export function getLocalizedCategory(category: string, lang: LanguageCode = 'en'): string {
  const dict = getTranslation(lang);
  return (dict as any).categories?.[category] || category;
}

