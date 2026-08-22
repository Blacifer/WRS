/**
 * Client-Side Caliper OCR Reader & Pipeline
 * Indian Railways WRS Raipur
 */

import Tesseract from 'tesseract.js';
import type { CaliperOCRResult } from '../../../shared/types.ts';

export interface SampleFixture {
  id: string;
  name: string;
  expectedValue: number;
  svgPath: string;
  bmpPath: string;
  description: string;
}

export const SAMPLE_CALIPER_FIXTURES: SampleFixture[] = [
  {
    id: 'caliper_260_00',
    name: '260.00 mm (NLB Outer Used Band I)',
    expectedValue: 260.00,
    svgPath: '/fixtures/caliper_260_00.svg',
    bmpPath: '/fixtures/caliper_260_00.bmp',
    description: 'CASNUB 22 NLB Outer Used Band I Boundary'
  },
  {
    id: 'caliper_257_50',
    name: '257.50 mm (NLB Outer Used Band II)',
    expectedValue: 257.50,
    svgPath: '/fixtures/caliper_257_50.svg',
    bmpPath: '/fixtures/caliper_257_50.bmp',
    description: 'CASNUB 22 NLB Outer Used Band II'
  },
  {
    id: 'caliper_248_00',
    name: '248.00 mm (NLB Outer Used Band V/VI)',
    expectedValue: 248.00,
    svgPath: '/fixtures/caliper_248_00.svg',
    bmpPath: '/fixtures/caliper_248_00.bmp',
    description: 'CASNUB 22 NLB Outer Used Band V/VI boundary'
  },
  {
    id: 'caliper_294_00',
    name: '294.00 mm (NLB Snubber Used Band I/II)',
    expectedValue: 294.00,
    svgPath: '/fixtures/caliper_294_00.svg',
    bmpPath: '/fixtures/caliper_294_00.bmp',
    description: 'CASNUB 22 NLB Snubber Used Band I/II boundary'
  },
  {
    id: 'caliper_305_20',
    name: '305.20 mm (RFT Snubber Used Band I)',
    expectedValue: 305.20,
    svgPath: '/fixtures/caliper_305_20.svg',
    bmpPath: '/fixtures/caliper_305_20.bmp',
    description: 'CASNUB 22 RFT Snubber Used Band I'
  },
  {
    id: 'caliper_241_30',
    name: '241.30 mm (HS Inner Used Band II)',
    expectedValue: 241.30,
    svgPath: '/fixtures/caliper_241_30.svg',
    bmpPath: '/fixtures/caliper_241_30.bmp',
    description: 'CASNUB 22 HS Inner Used Band II'
  },
  {
    id: 'caliper_273_00',
    name: '273.00 mm (RFT Outer New Band I/II)',
    expectedValue: 273.00,
    svgPath: '/fixtures/caliper_273_00.svg',
    bmpPath: '/fixtures/caliper_273_00.bmp',
    description: 'CASNUB 22 RFT New Outer Band I/II boundary'
  }
];

export async function preprocessImageForOCR(imageDataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        return resolve(imageDataUrl);
      }
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        
        const threshold = 128;
        const color = gray > threshold ? 255 : 0;
        
        data[i] = color;
        data[i + 1] = color;
        data[i + 2] = color;
      }
      
      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = (err) => reject(err);
    img.src = imageDataUrl;
  });
}

export interface MeasurementRange {
  min: number;
  max: number;
}

export const DEFAULT_CALIPER_RANGE: MeasurementRange = { min: 100.0, max: 500.0 };

/**
 * Valid physical measurement ranges per CV component target, mirroring
 * RDSO_TOLERANCE_SPECS in server/src/routes/cv.ts (widened slightly to cover
 * both branch interpretations that endpoint uses for dual-purpose readings,
 * e.g. friction wedge wear-step vs. slope height).
 */
export const CV_COMPONENT_RANGES: Record<string, MeasurementRange> = {
  OUTER_SPRING: DEFAULT_CALIPER_RANGE,
  INNER_SPRING: DEFAULT_CALIPER_RANGE,
  SNUBBER_SPRING: DEFAULT_CALIPER_RANGE,
  FRICTION_WEDGE: { min: 0.0, max: 150.0 },
  CTRB_END_CAP: { min: 0.0, max: 200.0 },
  CTRB_BEARING_END_CAP: { min: 0.0, max: 200.0 },
  WHEEL_FLANGE: { min: 10.0, max: 40.0 },
  BRAKE_BLOCK: { min: 5.0, max: 60.0 },
  DG_HOUSING_WALL_THICKNESS: { min: 5.0, max: 70.0 },
  DG_CENTRE_WEDGE_LOCATION: { min: 40.0, max: 80.0 },
  DG_MOVABLE_PLATE_LOCATION: { min: 100.0, max: 180.0 },
  DG_OUTER_COIL_SPRING: { min: 300.0, max: 420.0 },
  DG_INNER_COIL_SPRING: { min: 300.0, max: 420.0 },
  DG_CORNER_COIL_SPRING: { min: 240.0, max: 360.0 },
  DG_RELEASE_SPRING: { min: 80.0, max: 180.0 }
};

export async function processCaliperImage(input: string, range: MeasurementRange = DEFAULT_CALIPER_RANGE): Promise<CaliperOCRResult> {
  const startTime = performance.now();
  try {
    const processedUrl = await preprocessImageForOCR(input);

    const worker = await Tesseract.createWorker('eng');
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789.',
    });
    const result = await worker.recognize(processedUrl);
    await worker.terminate();

    const { data: { text, confidence: tesseractConfidence } } = result;
    const confidence = tesseractConfidence / 100;

    const match = text.match(/\d{1,3}\.?\d{0,2}/);

    if (match && confidence >= 0.5) {
      const parsedValue = parseFloat(match[0]);
      if (parsedValue >= range.min && parsedValue <= range.max) {
        return {
          measuredHeight: parsedValue,
          confidence,
          processingTimeMs: Math.round(performance.now() - startTime),
          rawText: text.trim(),
          digits: match[0].replace('.', '')
        };
      }
    }
    
    return {
      measuredHeight: 0,
      confidence,
      processingTimeMs: Math.round(performance.now() - startTime),
      rawText: text.trim(),
      digits: ''
    };
  } catch (err) {
    console.error('OCR processing error:', err);
    return {
      measuredHeight: 0,
      confidence: 0,
      processingTimeMs: Math.round(performance.now() - startTime),
      rawText: '',
      digits: ''
    };
  }
}

export function validateManualMeasurement(val: unknown, range: MeasurementRange = DEFAULT_CALIPER_RANGE): { valid: boolean; value?: number; error?: string } {
  if (val === null || val === undefined || val === '') {
    return { valid: false, error: 'Measurement is required' };
  }

  let num: number;
  if (typeof val === 'number') {
    num = val;
  } else if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
      return { valid: false, error: 'Invalid numeric format (e.g. 260.00)' };
    }
    num = parseFloat(trimmed);
  } else {
    return { valid: false, error: 'Must be a numeric measurement' };
  }

  if (isNaN(num) || !isFinite(num)) {
    return { valid: false, error: 'Invalid measurement number' };
  }

  if (num <= 0) {
    return { valid: false, error: 'Measurement must be strictly positive (> 0 mm)' };
  }

  if (num < range.min) {
    return { valid: false, error: `Measurement (${num} mm) is below minimum possible limit (${range.min.toFixed(2)} mm)` };
  }

  if (num > range.max) {
    return { valid: false, error: `Measurement (${num} mm) exceeds maximum possible limit (${range.max.toFixed(2)} mm)` };
  }

  const rounded = Math.round(num * 100) / 100;
  return { valid: true, value: rounded };
}
