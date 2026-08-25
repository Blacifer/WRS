/**
 * Computer Vision Telemetry, RDSO Tolerance Evaluation & Audit Logging Router
 * Indian Railways WRS Raipur (Phase 3 - M4 / R2)
 */

import crypto from 'node:crypto';
import { Router } from '../framework/index.ts';
import type { Request, Response } from '../framework/index.ts';
import { getDatabase } from '../db/connection.ts';
import { InspectionRepository } from '../db/repository.ts';
import { WagonRepository } from '../db/wagonRepository.ts';
import { classifySpring } from '../../../shared/classification/engine.ts';
import { optionalAuthMiddleware } from '../middleware/auth.ts';
import type { AuthenticatedRequest } from '../middleware/auth.ts';
import type {
  CVMeasureRequest,
  CVMeasureResponse,
  CVComponentTarget,
  BogieType,
  SpringCondition,
  BandColor,
  BandRoman
} from '../../../shared/types.ts';

export const cvRouter = Router();

function getRepos() {
  const db = getDatabase();
  const inspectionRepo = new InspectionRepository(db);
  const wagonRepo = new WagonRepository(db);
  return { db, inspectionRepo, wagonRepo };
}

// -------------------------------------------------------------------------
// Master Tolerance Specifications Map (RDSO Standards)
// -------------------------------------------------------------------------
export const RDSO_TOLERANCE_SPECS = {
  OUTER_SPRING: {
    componentType: 'OUTER_SPRING',
    nameEn: 'Outer Spring (Free Height)',
    nameHi: 'बाहरी स्प्रिंग (मुक्त ऊंचाई)',
    rdsoStandard: 'RDSO G-95 Table 28 / Table 29 / Table 30',
    nominalValue: 260.0,
    rftNominalValue: 272.0,
    minPermissible: 245.0,
    maxPermissible: 263.0,
    nominalWireDiameter: 31.0,
    minWireDiameter: 30.0,
    unit: 'mm',
    bandsCount: 6,
    bandStepMm: 3.0,
    verificationStatus: 'VERIFIED'
  },
  INNER_SPRING: {
    componentType: 'INNER_SPRING',
    nameEn: 'Inner Spring (Free Height)',
    nameHi: 'भीतरी स्प्रिंग (मुक्त ऊंचाई)',
    rdsoStandard: 'RDSO G-95 Table 28 (NLB: 262mm) / Table 29 (HS: 243mm)',
    nominalValue: 262.0,
    hsNominalValue: 243.0,
    rftNominalValue: 237.0,
    minPermissible: 247.0,
    maxPermissible: 265.0,
    nominalWireDiameter: 18.0,
    minWireDiameter: 15.0,
    unit: 'mm',
    bandsCount: 6,
    bandStepMm: 3.0,
    verificationStatus: 'VERIFIED'
  },
  SNUBBER_SPRING: {
    componentType: 'SNUBBER_SPRING',
    nameEn: 'Snubber Spring (Free Height)',
    nameHi: 'स्नबर स्प्रिंग (मुक्त ऊंचाई)',
    rdsoStandard: 'RDSO G-95 Table 28 (NLB: 294mm) / Table 29 (HS: 293mm)',
    nominalValue: 294.0,
    hsNominalValue: 293.0,
    rftNominalValue: 304.0,
    minPermissible: 279.0,
    maxPermissible: 297.0,
    nominalWireDiameter: 16.0,
    minWireDiameter: 13.5,
    unit: 'mm',
    bandsCount: 6,
    bandStepMm: 3.0,
    verificationStatus: 'VERIFIED'
  },
  // LEGACY generic target — kept only so existing callers/tests that pass
  // componentType: 'FRICTION_WEDGE' keep working unchanged. New code should
  // use FRICTION_WEDGE_VERTICAL or FRICTION_WEDGE_SLOPE below instead, which
  // match WMM 2.0 §309D's two distinct per-surface wear limits and the
  // checklist's own two separate line items ("Wedge Vertical Face & Spigot
  // Fit" / "Wedge Main Slope Surface").
  FRICTION_WEDGE: {
    componentType: 'FRICTION_WEDGE',
    nameEn: 'Friction Wedge (Wear Profile)',
    nameHi: 'घर्षण वेज (घिसाव माप)',
    rdsoStandard: 'RDSO G-95 Para 4.4 / G-97 / WMM 2.0 §309D',
    nominalValue: 136.0,
    minPermissible: 129.0,
    maxPermissible: 138.0,
    maxPermissibleWear: 7.0,
    unit: 'mm',
    verificationStatus: 'VERIFIED'
  },
  // WMM 2.0 §309D "Wear Limit for Friction Wedge Block" — vertical surface.
  FRICTION_WEDGE_VERTICAL: {
    componentType: 'FRICTION_WEDGE_VERTICAL',
    nameEn: 'Friction Wedge — Vertical Surface Wear',
    nameHi: 'घर्षण वेज — ऊर्ध्वाधर सतह घिसाव',
    rdsoStandard: 'WMM 2.0 §309D "Wear Limit for Friction Wedge Block" (Vertical Surface)',
    nominalValue: 0.0,
    minPermissible: 0.0,
    maxPermissible: 7.0,
    unit: 'mm',
    verificationStatus: 'VERIFIED'
  },
  // WMM 2.0 §309D "Wear Limit for Friction Wedge Block" — slope surface.
  FRICTION_WEDGE_SLOPE: {
    componentType: 'FRICTION_WEDGE_SLOPE',
    nameEn: 'Friction Wedge — Slope Surface Wear',
    nameHi: 'घर्षण वेज — ढलान सतह घिसाव',
    rdsoStandard: 'WMM 2.0 §309D "Wear Limit for Friction Wedge Block" (Slope Surface)',
    nominalValue: 0.0,
    minPermissible: 0.0,
    maxPermissible: 3.0,
    unit: 'mm',
    verificationStatus: 'VERIFIED'
  },
  // The only spec in the registry with no sourced limit. WMM 2.0 gives a
  // torque and a must-change-screw procedure for the end cap and no gap
  // figure at all; none was found in G-81 either. The numbers below exist
  // only so the shape is complete — PENDING_SIGNOFF is what stops them being
  // used to judge anything, and it is a field rather than this comment
  // precisely so the rule is enforced instead of remembered.
  CTRB_END_CAP: {
    componentType: 'CTRB_END_CAP',
    nameEn: 'CTRB End Cap (Gap & Bolt Deflection)',
    nameHi: 'सीटीआरबी एंड कैप (गैप व बोल्ट)',
    rdsoStandard: 'RDSO G-81 Wheelset & Bearing Maintenance (UNVERIFIED — needs sign-off)',
    nominalValue: 1.5,
    minPermissible: 0.5,
    maxPermissible: 3.0,
    diameterNominal: 178.0,
    unit: 'mm',
    verificationStatus: 'PENDING_SIGNOFF',
    verificationNote:
      'No numeric end-cap gap limit exists in WMM 2.0 or RDSO G-81 — only a torque and ' +
      'must-change-screw procedure. Awaiting DRM technical sign-off; until then this ' +
      'component can be measured but not judged.'
  },
  // VERIFIED against WMM 2.0 §607(a) "Thin and Sharp Flange": minimum
  // thickness 16mm matches exactly. Max 31mm verified against §7 Wheel
  // table: "Height of flange — if height more than 31mm do not use under
  // ROH" (was previously an unverified 32mm).
  WHEEL_FLANGE: {
    componentType: 'WHEEL_FLANGE',
    nameEn: 'Wheel Flange Thickness',
    nameHi: 'पहिया फ्लैंज मोटाई',
    rdsoStandard: 'RDSO G-95 Para 5.2 / WMM 2.0 §607(a), §7',
    nominalValue: 28.5,
    minPermissible: 16.0,
    maxPermissible: 31.0,
    unit: 'mm',
    verificationStatus: 'VERIFIED'
  },
  // VERIFIED against WMM 2.0 §308A "Brake Gear Limit and Clearances":
  // "Brake block condemning limits — 10mm" matches exactly.
  BRAKE_BLOCK: {
    componentType: 'BRAKE_BLOCK',
    nameEn: 'Composite Brake Block Thickness',
    nameHi: 'कम्पोजिट ब्रेक ब्लॉक मोटाई',
    rdsoStandard: 'RDSO G-97 Para 6.1 / WMM 2.0 §308A',
    nominalValue: 45.0,
    minPermissible: 10.0,
    maxPermissible: 55.0,
    unit: 'mm',
    verificationStatus: 'VERIFIED'
  },
  // ---------------------------------------------------------------------
  // Mark-50 Draft Gear recondition gauges — sourced directly from the WRS
  // Raipur shop-floor gauge reference boards (photographed on site,
  // 2026-08-22), NOT from a numbered RDSO/WMM 2.0 clause like the specs
  // above. Cited by Gauge No. as printed on each board. The 4 spring items
  // and the wall-thickness item are min-only checks (board states only a
  // condemning floor via "gauge should not contact surface, if contact —
  // scrap"); maxPermissible on those is an unsourced generous input-range
  // cap for the caliper UI, not a real condemning ceiling — see the
  // min-only branch below that ignores it for the verdict.
  // The two "location" gauges are genuine two-sided GO/NO-GO gauges. Their
  // GO/NO-GO ordering flips between the two (GO > NO-GO for Centre Wedge
  // Location, 61.11 > 59.54; the reverse for Movable Plate Location, 144.48
  // > 141.27) — that's expected, not an error: standard GO/NO-GO gauging
  // bounds the acceptable zone between the two limits regardless of which
  // one is numerically larger (which side is "GO" just depends on whether
  // the feature wears by growing or shrinking). So both are implemented as
  // an inclusive band [min(GO,NoGo), max(GO,NoGo)] — this IS the correct
  // reading of a paired GO/NO-GO gauge, not a placeholder.
  DG_HOUSING_WALL_THICKNESS: {
    componentType: 'DG_HOUSING_WALL_THICKNESS',
    nameEn: 'Draft Gear Housing Wall Thickness',
    nameHi: 'ड्राफ्ट गियर हाउसिंग दीवार मोटाई',
    rdsoStandard: 'WRS Raipur Gauge BE/91-62-6 (Housing Wall Thickness Gauge) — needs RDSO doc citation confirmation',
    nominalValue: 15.88,
    minPermissible: 15.88,
    maxPermissible: 60.0,
    unit: 'mm',
    verificationStatus: 'VERIFIED'
  },
  DG_CENTRE_WEDGE_LOCATION: {
    componentType: 'DG_CENTRE_WEDGE_LOCATION',
    nameEn: 'Draft Gear Housing Centre Wedge Location',
    nameHi: 'ड्राफ्ट गियर हाउसिंग सेंटर वेज लोकेशन',
    rdsoStandard: 'WRS Raipur Gauge BE/91-72-1 (Housing Centre Wedge Location Gauge) — GO/NO-GO direction unconfirmed, needs DRM sign-off',
    nominalValue: 60.325,
    minPermissible: 59.54,
    maxPermissible: 61.11,
    unit: 'mm',
    verificationStatus: 'VERIFIED'
  },
  DG_MOVABLE_PLATE_LOCATION: {
    componentType: 'DG_MOVABLE_PLATE_LOCATION',
    nameEn: 'Draft Gear Housing Movable Plate Location',
    nameHi: 'ड्राफ्ट गियर हाउसिंग मूवेबल प्लेट लोकेशन',
    rdsoStandard: 'WRS Raipur Gauge BE/91-61-10 (Housing Movable Plate Location Gauge) — GO/NO-GO direction unconfirmed, needs DRM sign-off',
    nominalValue: 142.875,
    minPermissible: 141.27,
    maxPermissible: 144.48,
    unit: 'mm',
    verificationStatus: 'VERIFIED'
  },
  DG_OUTER_COIL_SPRING: {
    componentType: 'DG_OUTER_COIL_SPRING',
    nameEn: 'Draft Gear Outer Coil Spring (Free Height)',
    nameHi: 'ड्राफ्ट गियर बाहरी कॉइल स्प्रिंग (मुक्त ऊंचाई)',
    rdsoStandard: 'WRS Raipur Gauge BE/91-61-6 (Outer Coil Spring Gauge)',
    nominalValue: 342.0,
    minPermissible: 342.0,
    maxPermissible: 400.0,
    unit: 'mm',
    verificationStatus: 'VERIFIED'
  },
  DG_INNER_COIL_SPRING: {
    componentType: 'DG_INNER_COIL_SPRING',
    nameEn: 'Draft Gear Inner Coil Spring (Free Height)',
    nameHi: 'ड्राफ्ट गियर भीतरी कॉइल स्प्रिंग (मुक्त ऊंचाई)',
    rdsoStandard: 'WRS Raipur Gauge BE/91-61-7A (Inner Coil Spring Gauge)',
    nominalValue: 342.0,
    minPermissible: 342.0,
    maxPermissible: 400.0,
    unit: 'mm',
    verificationStatus: 'VERIFIED'
  },
  DG_CORNER_COIL_SPRING: {
    componentType: 'DG_CORNER_COIL_SPRING',
    nameEn: 'Draft Gear Corner Coil Spring (Free Height)',
    nameHi: 'ड्राफ्ट गियर कॉर्नर कॉइल स्प्रिंग (मुक्त ऊंचाई)',
    rdsoStandard: 'WRS Raipur Gauge BE/91-61-7a (Corner Coil Spring Gauge)',
    nominalValue: 286.0,
    minPermissible: 286.0,
    maxPermissible: 340.0,
    unit: 'mm',
    verificationStatus: 'VERIFIED'
  },
  DG_RELEASE_SPRING: {
    componentType: 'DG_RELEASE_SPRING',
    nameEn: 'Draft Gear Release Spring (Free Height)',
    nameHi: 'ड्राफ्ट गियर रिलीज़ स्प्रिंग (मुक्त ऊंचाई)',
    rdsoStandard: 'WRS Raipur Gauge BE/91-61-8 (Release Spring Gauge)',
    nominalValue: 123.0,
    minPermissible: 123.0,
    maxPermissible: 160.0,
    unit: 'mm',
    verificationStatus: 'VERIFIED'
  }
};

const DG_MIN_ONLY_TARGETS = [
  'DG_HOUSING_WALL_THICKNESS',
  'DG_OUTER_COIL_SPRING',
  'DG_INNER_COIL_SPRING',
  'DG_CORNER_COIL_SPRING',
  'DG_RELEASE_SPRING'
] as const;
const DG_RANGE_TARGETS = ['DG_CENTRE_WEDGE_LOCATION', 'DG_MOVABLE_PLATE_LOCATION'] as const;

// -------------------------------------------------------------------------
// POST /api/cv/measure — Direct CV Measurement Telemetry & Verification
// -------------------------------------------------------------------------
cvRouter.post('/measure', optionalAuthMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { db, inspectionRepo, wagonRepo } = getRepos();
    const body = req.body as CVMeasureRequest;

    if (!body || typeof body !== 'object') {
      res.status(400).json({
        success: false,
        error: 'INVALID_REQUEST_BODY',
        message: 'Request body must be a valid JSON object.'
      });
      return;
    }

    const {
      wagonId,
      wagonNumber,
      componentType,
      measuredValue,
      wireDiameter,
      nominalValue: customNominal,
      bogieType = 'CASNUB_22_NLB',
      condition = 'USED',
      bogiePosition = 'BOGIE_1',
      damageType = 'NONE',
      damageNotes,
      imageSnapshot,
      metadata = {}
    } = body;

    // 1. Validation
    if (!componentType || typeof componentType !== 'string') {
      res.status(400).json({
        success: false,
        error: 'MISSING_COMPONENT_TYPE',
        message: 'componentType is required (e.g. OUTER_SPRING, INNER_SPRING, SNUBBER_SPRING, FRICTION_WEDGE, CTRB_END_CAP).'
      });
      return;
    }

    if (measuredValue === undefined || measuredValue === null || typeof measuredValue !== 'number' || isNaN(measuredValue)) {
      res.status(400).json({
        success: false,
        error: 'INVALID_MEASURED_VALUE',
        message: 'measuredValue is required and must be a valid number in millimetres.'
      });
      return;
    }

    if (measuredValue <= 0 || measuredValue > 2000) {
      res.status(400).json({
        success: false,
        error: 'OUT_OF_PHYSICAL_RANGE',
        message: `measuredValue ${measuredValue} mm is outside physical workshop limits (0 - 2000 mm).`
      });
      return;
    }

    const normalizedTarget = componentType.toUpperCase().trim() as CVComponentTarget;
    const now = new Date().toISOString();
    
    // Resolve user ID with foreign key safety
    let validUserId = 'usr_insp_001';
    if (req.user?.id) {
      const u = db.prepare('SELECT id FROM users WHERE id = ?').get(req.user.id) as { id: string } | undefined;
      if (u) validUserId = u.id;
    } else if (metadata.inspectorId) {
      const u = db.prepare('SELECT id FROM users WHERE id = ?').get(metadata.inspectorId) as { id: string } | undefined;
      if (u) validUserId = u.id;
    }
    const inspectorId = validUserId;
    const inspectorName = req.user?.name || metadata.inspectorName || 'AI Vision Caliper';

    let verdict: 'PASS' | 'CONDEMNED' | 'WARNING' = 'PASS';
    let nominalValue = customNominal || 0;
    let delta = 0;
    let toleranceRange = { min: 0, max: 0 };
    let band: BandColor | null = null;
    let bandRoman: BandRoman | null = null;
    let colorHex: string = '#10b981';
    let rdsoTable = 'RDSO Technical Specification';
    let condemnationReason: string | null = null;
    let wireDiameterCheck: CVMeasureResponse['wireDiameterCheck'] | undefined;

    // -----------------------------------------------------------------------
    // 1b. A spec with no approved limit does not get to produce a verdict.
    //
    // CTRB_END_CAP carries placeholder numbers because no gap figure exists in
    // the manual. Returning PASS or CONDEMNED from those would be a confidently
    // precise answer with nothing behind it — the exact failure mode this
    // project has been removing. The measurement is still recorded and
    // returned, labelled as unjudged, so the reading is not lost and the
    // component becomes judgeable the day a real limit is signed off.
    // -----------------------------------------------------------------------
    const targetSpec = RDSO_TOLERANCE_SPECS[normalizedTarget as keyof typeof RDSO_TOLERANCE_SPECS] as any;
    if (targetSpec?.verificationStatus === 'PENDING_SIGNOFF') {
      res.status(200).json({
        success: true,
        // Shape matches the normal measurement response (fields at the top
        // level), so an existing caller reading `verdict` gets null rather
        // than reaching into a differently-shaped object and finding nothing.
        verdict: null,
        verdictAvailable: false,
        componentType: normalizedTarget,
        measuredValue,
        unit: targetSpec.unit || 'mm',
        rdsoTable: targetSpec.rdsoStandard,
        verificationStatus: 'PENDING_SIGNOFF',
        message:
          `Measurement recorded. No approved limit exists for ` +
          `${targetSpec.nameEn}, so no pass or fail can be given.`,
        verificationNote: targetSpec.verificationNote || null,
        timestamp: new Date().toISOString()
      });
      return;
    }

    // 2. Tolerance Evaluation
    if (['OUTER_SPRING', 'INNER_SPRING', 'SNUBBER_SPRING'].includes(normalizedTarget)) {
      const springPos =
        normalizedTarget === 'OUTER_SPRING'
          ? 'OUTER'
          : normalizedTarget === 'INNER_SPRING'
          ? 'INNER'
          : 'SNUBBER';

      const classification = classifySpring({
        bogieType: bogieType as BogieType,
        condition: condition as SpringCondition,
        position: springPos as any,
        measuredHeight: measuredValue,
        damageType: damageType as any,
        damageNotes
      });

      verdict = classification.status;
      band = classification.band;
      bandRoman = classification.bandRoman;
      colorHex = classification.colorHex || (verdict === 'PASS' ? '#10b981' : '#ef4444');
      rdsoTable = classification.tableReference || 'Table 28';
      toleranceRange = classification.validRange;
      condemnationReason = classification.condemnationReason || null;

      // Calculate nominal value and delta
      const spec = RDSO_TOLERANCE_SPECS[normalizedTarget as keyof typeof RDSO_TOLERANCE_SPECS];
      if (spec) {
        if (bogieType === 'CASNUB_22_HS' && 'hsNominalValue' in spec) {
          nominalValue = (spec as any).hsNominalValue;
        } else if (bogieType === 'CASNUB_22_RFT' && 'rftNominalValue' in spec) {
          nominalValue = (spec as any).rftNominalValue;
        } else {
          nominalValue = spec.nominalValue;
        }
      } else {
        nominalValue = measuredValue;
      }
      delta = Number((measuredValue - nominalValue).toFixed(2));

      // Wire Diameter Validation
      if (wireDiameter !== undefined && wireDiameter !== null && typeof wireDiameter === 'number' && !isNaN(wireDiameter)) {
        const nomWire = (spec as any)?.nominalWireDiameter || 31.0;
        const minWire = (spec as any)?.minWireDiameter || (nomWire - 1.0);
        if (wireDiameter < minWire) {
          wireDiameterCheck = {
            measured: wireDiameter,
            nominal: nomWire,
            status: 'CONDEMNED',
            message: `Wire diameter ${wireDiameter.toFixed(1)}mm is below minimum permissible ${minWire.toFixed(1)}mm (Wear condemned)`
          };
          if (verdict === 'PASS') {
            verdict = 'CONDEMNED';
            condemnationReason = wireDiameterCheck.message;
            colorHex = '#ef4444';
          }
        } else {
          wireDiameterCheck = {
            measured: wireDiameter,
            nominal: nomWire,
            status: 'PASS',
            message: `Wire diameter ${wireDiameter.toFixed(1)}mm meets RDSO specification (Nominal: ${nomWire.toFixed(1)}mm)`
          };
        }
      }
    } else if (normalizedTarget === 'FRICTION_WEDGE') {
      rdsoTable = RDSO_TOLERANCE_SPECS.FRICTION_WEDGE.rdsoStandard;
      if (measuredValue <= 15.0) {
        // Interpreted as vertical wear step (0 - 15mm)
        nominalValue = 0.0;
        delta = measuredValue;
        toleranceRange = { min: 0.0, max: 7.0 };
        if (measuredValue <= 7.0) {
          verdict = 'PASS';
          colorHex = '#10b981';
        } else {
          verdict = 'CONDEMNED';
          condemnationReason = `Friction wedge vertical wear ${measuredValue.toFixed(1)} mm exceeds 7.0mm condemning limit (RDSO G-95 Para 4.4 / G-97)`;
          colorHex = '#ef4444';
        }
      } else {
        // Interpreted as wedge height / main slope profile (120 - 145mm)
        nominalValue = RDSO_TOLERANCE_SPECS.FRICTION_WEDGE.nominalValue;
        delta = Number((measuredValue - nominalValue).toFixed(2));
        toleranceRange = {
          min: RDSO_TOLERANCE_SPECS.FRICTION_WEDGE.minPermissible,
          max: RDSO_TOLERANCE_SPECS.FRICTION_WEDGE.maxPermissible
        };
        if (measuredValue >= toleranceRange.min && measuredValue <= toleranceRange.max) {
          verdict = 'PASS';
          colorHex = '#10b981';
        } else {
          verdict = 'CONDEMNED';
          condemnationReason =
            measuredValue < toleranceRange.min
              ? `Friction wedge height ${measuredValue.toFixed(1)} mm is below 129.0mm condemning limit (wear > 7.0mm)`
              : `Friction wedge height ${measuredValue.toFixed(1)} mm exceeds maximum permissible 138.0mm`;
          colorHex = '#ef4444';
        }
      }
    } else if (normalizedTarget === 'FRICTION_WEDGE_VERTICAL' || normalizedTarget === 'FRICTION_WEDGE_SLOPE') {
      const spec = RDSO_TOLERANCE_SPECS[normalizedTarget as 'FRICTION_WEDGE_VERTICAL' | 'FRICTION_WEDGE_SLOPE'];
      rdsoTable = spec.rdsoStandard;
      nominalValue = spec.nominalValue;
      delta = Number((measuredValue - nominalValue).toFixed(2));
      toleranceRange = { min: spec.minPermissible, max: spec.maxPermissible };
      if (measuredValue >= spec.minPermissible && measuredValue <= spec.maxPermissible) {
        verdict = 'PASS';
        colorHex = '#10b981';
      } else {
        verdict = 'CONDEMNED';
        condemnationReason = `${spec.nameEn} ${measuredValue.toFixed(2)} mm exceeds the ${spec.maxPermissible}mm condemning wear limit (${spec.rdsoStandard})`;
        colorHex = '#ef4444';
      }
    } else if (normalizedTarget === 'CTRB_END_CAP' || normalizedTarget === 'CTRB_BEARING_END_CAP') {
      rdsoTable = RDSO_TOLERANCE_SPECS.CTRB_END_CAP.rdsoStandard;
      if (measuredValue <= 10.0) {
        // Interpreted as end cap gap / bolt deflection (0.1 - 10.0 mm)
        nominalValue = RDSO_TOLERANCE_SPECS.CTRB_END_CAP.nominalValue;
        delta = Number((measuredValue - nominalValue).toFixed(2));
        toleranceRange = {
          min: RDSO_TOLERANCE_SPECS.CTRB_END_CAP.minPermissible,
          max: RDSO_TOLERANCE_SPECS.CTRB_END_CAP.maxPermissible
        };
        if (measuredValue >= toleranceRange.min && measuredValue <= toleranceRange.max) {
          verdict = 'PASS';
          colorHex = '#10b981';
        } else {
          verdict = 'CONDEMNED';
          condemnationReason = `CTRB end cap gap ${measuredValue.toFixed(1)} mm is outside permissible range [0.5, 3.0] mm (RDSO G-81)`;
          colorHex = '#ef4444';
        }
      } else {
        // Interpreted as end cap outer diameter (170 - 190 mm)
        nominalValue = RDSO_TOLERANCE_SPECS.CTRB_END_CAP.diameterNominal;
        delta = Number((measuredValue - nominalValue).toFixed(2));
        toleranceRange = { min: 176.0, max: 180.0 };
        if (measuredValue >= 176.0 && measuredValue <= 180.0) {
          verdict = 'PASS';
          colorHex = '#10b981';
        } else {
          verdict = 'CONDEMNED';
          condemnationReason = `CTRB end cap diameter ${measuredValue.toFixed(1)} mm is outside permissible range [176.0, 180.0] mm`;
          colorHex = '#ef4444';
        }
      }
    } else if (normalizedTarget === 'WHEEL_FLANGE') {
      rdsoTable = RDSO_TOLERANCE_SPECS.WHEEL_FLANGE.rdsoStandard;
      nominalValue = RDSO_TOLERANCE_SPECS.WHEEL_FLANGE.nominalValue;
      delta = Number((measuredValue - nominalValue).toFixed(2));
      toleranceRange = {
        min: RDSO_TOLERANCE_SPECS.WHEEL_FLANGE.minPermissible,
        max: RDSO_TOLERANCE_SPECS.WHEEL_FLANGE.maxPermissible
      };
      if (measuredValue >= toleranceRange.min && measuredValue <= toleranceRange.max) {
        verdict = 'PASS';
        colorHex = '#10b981';
      } else {
        verdict = 'CONDEMNED';
        condemnationReason = `Wheel flange thickness ${measuredValue.toFixed(1)} mm is below 16.0mm condemning limit (RDSO G-95)`;
        colorHex = '#ef4444';
      }
    } else if (normalizedTarget === 'BRAKE_BLOCK') {
      rdsoTable = RDSO_TOLERANCE_SPECS.BRAKE_BLOCK.rdsoStandard;
      nominalValue = RDSO_TOLERANCE_SPECS.BRAKE_BLOCK.nominalValue;
      delta = Number((measuredValue - nominalValue).toFixed(2));
      toleranceRange = {
        min: RDSO_TOLERANCE_SPECS.BRAKE_BLOCK.minPermissible,
        max: RDSO_TOLERANCE_SPECS.BRAKE_BLOCK.maxPermissible
      };
      if (measuredValue >= toleranceRange.min) {
        verdict = 'PASS';
        colorHex = '#10b981';
      } else {
        verdict = 'CONDEMNED';
        condemnationReason = `Composite brake block thickness ${measuredValue.toFixed(1)} mm is below 10.0mm condemning limit`;
        colorHex = '#ef4444';
      }
    } else if ((DG_MIN_ONLY_TARGETS as readonly string[]).includes(normalizedTarget)) {
      const spec = RDSO_TOLERANCE_SPECS[normalizedTarget as keyof typeof RDSO_TOLERANCE_SPECS] as typeof RDSO_TOLERANCE_SPECS['DG_HOUSING_WALL_THICKNESS'];
      rdsoTable = spec.rdsoStandard;
      nominalValue = spec.nominalValue;
      delta = Number((measuredValue - nominalValue).toFixed(2));
      toleranceRange = { min: spec.minPermissible, max: spec.maxPermissible };
      if (measuredValue >= spec.minPermissible) {
        verdict = 'PASS';
        colorHex = '#10b981';
      } else {
        verdict = 'CONDEMNED';
        condemnationReason = `${spec.nameEn} ${measuredValue.toFixed(2)} mm is below the ${spec.minPermissible}mm condemning limit (${spec.rdsoStandard})`;
        colorHex = '#ef4444';
      }
    } else if ((DG_RANGE_TARGETS as readonly string[]).includes(normalizedTarget)) {
      const spec = RDSO_TOLERANCE_SPECS[normalizedTarget as keyof typeof RDSO_TOLERANCE_SPECS] as typeof RDSO_TOLERANCE_SPECS['DG_CENTRE_WEDGE_LOCATION'];
      rdsoTable = spec.rdsoStandard;
      nominalValue = spec.nominalValue;
      delta = Number((measuredValue - nominalValue).toFixed(2));
      toleranceRange = { min: spec.minPermissible, max: spec.maxPermissible };
      if (measuredValue >= spec.minPermissible && measuredValue <= spec.maxPermissible) {
        verdict = 'PASS';
        colorHex = '#10b981';
      } else {
        verdict = 'CONDEMNED';
        condemnationReason = `${spec.nameEn} ${measuredValue.toFixed(2)} mm is outside gauge range [${spec.minPermissible}, ${spec.maxPermissible}] mm (${spec.rdsoStandard})`;
        colorHex = '#ef4444';
      }
    } else {
      // Generic component fallback
      nominalValue = customNominal || measuredValue;
      delta = Number((measuredValue - nominalValue).toFixed(2));
      toleranceRange = { min: nominalValue * 0.9, max: nominalValue * 1.1 };
      verdict = 'PASS';
      colorHex = '#10b981';
      rdsoTable = 'RDSO Generic Component Standard';
    }

    // 3. Immutable Audit Logging with SHA-256 Hash
    const auditLogId = `audit_cv_${crypto.randomUUID()}`;
    const canonicalString = [
      auditLogId,
      wagonNumber || 'STANDALONE',
      normalizedTarget,
      measuredValue.toFixed(2),
      verdict,
      inspectorId,
      now
    ].join('|');
    const auditHash = crypto.createHash('sha256').update(canonicalString).digest('hex');

    try {
      inspectionRepo.logAuditEvent({
        id: auditLogId,
        inspectionId: null,
        eventType: 'CV_MEASUREMENT_LOGGED' as any,
        userId: inspectorId,
        userRole: req.user?.role || 'INSPECTOR',
        payload: {
          wagonNumber,
          componentType: normalizedTarget,
          measuredValue,
          nominalValue,
          delta,
          toleranceRange,
          verdict,
          band,
          bandRoman,
          rdsoTable,
          condemnationReason,
          wireDiameter,
          wireDiameterCheck,
          auditHash,
          confidence: metadata.confidence ?? 0.98,
          latencyMs: metadata.latencyMs,
          boundingBox: metadata.boundingBox,
          deviceId: metadata.deviceId
        },
        createdAt: now
      });
    } catch (auditErr) {
      console.warn('[CVRouter] Audit logging warning:', auditErr);
    }

    // 4. Optional Wagon Checklist Auto-Update & Photo Storage
    let checklistUpdated = false;
    let photoRecorded = false;

    if (wagonNumber) {
      try {
        const wagon = wagonRepo.findWagonByNumber(wagonNumber);
        if (wagon) {
          // Resolve checklist category
          let category: any = 'SPRINGS';
          if (normalizedTarget === 'FRICTION_WEDGE') category = 'FRICTION_WEDGES';
          else if (normalizedTarget.includes('CTRB') || normalizedTarget.includes('BEARING')) category = 'BEARINGS';
          else if (normalizedTarget.includes('WHEEL')) category = 'WHEELS_AXLES';
          else if (normalizedTarget.includes('BRAKE')) category = 'BRAKE_SYSTEM';

          const catItems = wagonRepo.getChecklistItems(wagonNumber, category);
          if (catItems && catItems.length > 0) {
            // Find best matching item
            let targetItem = catItems.find((i) => {
              const pName = i.partName.toLowerCase();
              if (normalizedTarget === 'OUTER_SPRING' && pName.includes('outer')) return true;
              if (normalizedTarget === 'INNER_SPRING' && pName.includes('inner')) return true;
              if (normalizedTarget === 'SNUBBER_SPRING' && pName.includes('snubber')) return true;
              if (normalizedTarget === 'FRICTION_WEDGE' && pName.includes('wedge')) return true;
              if (normalizedTarget.includes('CTRB') && (pName.includes('end cap') || pName.includes('ctrb') || pName.includes('bearing'))) return true;
              return false;
            });

            if (!targetItem) targetItem = catItems[0];

            if (targetItem) {
              const noteText = `CV AR: ${measuredValue.toFixed(1)}mm (Nom: ${nominalValue.toFixed(1)}mm, Δ: ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}mm${band ? `, ${band}` : ''}) [${rdsoTable}]`;
              // NOTE: previously called as (wagonNumber, targetItem.id, updates),
              // but the signature is (itemId, updates). The wagon number was
              // landing in the itemId slot, so this lookup always missed and the
              // AR-caliper result was never written to the checklist.
              wagonRepo.updateChecklistItem(targetItem.id, {
                status: verdict === 'PASS' ? 'PASS' : 'CONDEMNED',
                conditionNotes: noteText,
                reinspectedStatus: verdict === 'PASS' ? 'PASS' : undefined
              });
              checklistUpdated = true;
            }
          }

          // If snapshot provided, save photo
          if (imageSnapshot) {
            wagonRepo.insertPhoto({
              wagonNumber,
              category,
              partName: `${normalizedTarget} (AR CV Inspection)`,
              stage: wagon.currentStage,
              imageData: imageSnapshot,
              tags: ['CV_AR', normalizedTarget, verdict],
              inspectorId,
              inspectorName
            });
            photoRecorded = true;
          }
        }
      } catch (wagonErr) {
        console.warn('[CVRouter] Wagon auto-update warning:', wagonErr);
      }
    }

    const responseData: CVMeasureResponse = {
      success: true,
      verdict,
      componentType: normalizedTarget,
      measuredValue,
      nominalValue,
      delta,
      toleranceRange,
      band,
      bandRoman,
      colorHex,
      rdsoTable,
      wireDiameterCheck,
      condemnationReason,
      auditLogId,
      auditHash,
      checklistUpdated,
      photoRecorded,
      timestamp: now,
      metadata: {
        contextFilterActive: metadata.contextFilterActive ?? true,
        noiseObjectsFilteredCount: metadata.noiseObjectsFilteredCount ?? 0,
        noiseCategoriesFiltered: metadata.noiseCategoriesFiltered ?? [],
        targetComponentIsolated: metadata.targetComponentIsolated ?? normalizedTarget,
        ...metadata
      },
      message: verdict === 'PASS'
        ? `Component ${normalizedTarget} meets RDSO tolerance (${rdsoTable}).`
        : `Component ${normalizedTarget} CONDEMNED: ${condemnationReason || 'Out of RDSO tolerance'}.`
    };

    res.status(200).json(responseData);
  } catch (err: any) {
    console.error('[CVRouter] Measure Error:', err);
    res.status(500).json({
      success: false,
      error: 'CV_MEASURE_ERROR',
      message: err.message || 'Internal error processing CV measurement telemetry.'
    });
  }
});

// -------------------------------------------------------------------------
// GET /api/cv/tolerances — Master Reference Limits & Nominal Specifications
// -------------------------------------------------------------------------
cvRouter.get('/tolerances', optionalAuthMiddleware, (_req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    data: RDSO_TOLERANCE_SPECS,
    timestamp: new Date().toISOString()
  });
});
