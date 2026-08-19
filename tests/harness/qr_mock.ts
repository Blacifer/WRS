/**
 * Serialized Component QR Code Generator & Decoder Mock Harness
 * Indian Railways WRS Raipur (Phase 3 - M2 / R4 Component Health Passports)
 *
 * Implements QR code formatting for serialized components (Wheelsets, Bearings, Draft Gears),
 * payload parsing, validation, and error diagnostics for malformed/corrupted QR codes.
 */

export interface ComponentQRMetadata {
  componentType: string;
  manufacturer: string;
  mfgDate?: string;
  initialWagon?: string;
}

export interface DecodedComponentQR {
  serialNumber: string;
  componentType: string;
  manufacturer: string;
  mfgDate?: string;
  protocolVersion: string;
}

/**
 * Encodes component metadata into standardized Indian Railways QR Passport URI format
 */
export function encodeComponentQR(serialNumber: string, metadata: ComponentQRMetadata): string {
  if (!serialNumber || serialNumber.trim() === '') {
    throw new Error('QR_ENCODING_ERROR: Serial number cannot be empty');
  }

  const cleanSn = serialNumber.trim().toUpperCase();
  const cleanType = metadata.componentType.trim().toUpperCase();
  const cleanMfg = metadata.manufacturer.trim();
  const mfgDate = metadata.mfgDate || '2026-01-01';

  return `WRS-PASSPORT://v1?sn=${encodeURIComponent(cleanSn)}&type=${encodeURIComponent(cleanType)}&mfg=${encodeURIComponent(cleanMfg)}&date=${encodeURIComponent(mfgDate)}`;
}

/**
 * Decodes and validates component QR code payload supporting both URI and JSON protocols
 */
export function decodeComponentQR(qrPayload: string): DecodedComponentQR {
  if (!qrPayload || typeof qrPayload !== 'string' || qrPayload.trim() === '') {
    throw new Error('MALFORMED_QR: QR payload is empty or invalid string');
  }

  const clean = qrPayload.trim();

  // 1. Check URI Protocol (WRS-PASSPORT://v1?...)
  if (clean.startsWith('WRS-PASSPORT://')) {
    try {
      const url = new URL(clean.replace('WRS-PASSPORT://', 'https://passport.wrs/'));
      const version = url.pathname.replace(/^\//, '') || 'v1';
      const serialNumber = url.searchParams.get('sn');
      const componentType = url.searchParams.get('type');
      const manufacturer = url.searchParams.get('mfg');
      const mfgDate = url.searchParams.get('date') || undefined;

      if (!serialNumber) {
        throw new Error('MALFORMED_QR: Missing "sn" (serial number) parameter in QR URI');
      }
      if (!componentType) {
        throw new Error('MALFORMED_QR: Missing "type" parameter in QR URI');
      }

      return {
        serialNumber: serialNumber.trim().toUpperCase(),
        componentType: componentType.trim().toUpperCase(),
        manufacturer: manufacturer || 'RWF Yelahanka',
        mfgDate,
        protocolVersion: version
      };
    } catch (err: any) {
      if (err.message?.startsWith('MALFORMED_QR')) throw err;
      throw new Error(`MALFORMED_QR: Unable to parse QR URI structure: ${err.message}`);
    }
  }

  // 2. Check JSON Protocol ({ "serialNumber": ... })
  if (clean.startsWith('{') && clean.endsWith('}')) {
    try {
      const obj = JSON.parse(clean);
      if (!obj.serialNumber && !obj.sn) {
        throw new Error('MALFORMED_QR: JSON payload missing "serialNumber" property');
      }
      return {
        serialNumber: String(obj.serialNumber || obj.sn).trim().toUpperCase(),
        componentType: String(obj.componentType || obj.type || 'UNKNOWN').trim().toUpperCase(),
        manufacturer: String(obj.manufacturer || obj.mfg || 'RWF Yelahanka'),
        mfgDate: obj.mfgDate || obj.date || undefined,
        protocolVersion: obj.version || 'v1'
      };
    } catch (err: any) {
      if (err.message?.startsWith('MALFORMED_QR')) throw err;
      throw new Error(`MALFORMED_QR: Invalid JSON QR payload: ${err.message}`);
    }
  }

  // 3. Fallback raw serial string if format matches WRS-*
  if (clean.startsWith('WRS-') || clean.startsWith('RW-') || clean.startsWith('CTRB-')) {
    return {
      serialNumber: clean.toUpperCase(),
      componentType: clean.includes('WS') ? 'WHEELSET' : clean.includes('BRG') ? 'BEARING' : 'DRAFT_GEAR',
      manufacturer: 'RWF Yelahanka',
      protocolVersion: 'raw-sn'
    };
  }

  throw new Error(`MALFORMED_QR: Unsupported QR code scheme or invalid format: "${clean.substring(0, 30)}..."`);
}

/**
 * Mock QR Scanner Detector simulating camera video canvas decoding
 */
export class MockQRDetector {
  public async detectFromPayload(qrPayload: string): Promise<DecodedComponentQR> {
    return decodeComponentQR(qrPayload);
  }
}
