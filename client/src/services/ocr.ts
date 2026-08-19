/**
 * Client-Side Caliper OCR Reader & Pipeline
 * Indian Railways WRS Raipur
 */

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

export async function processCaliperImage(input: string): Promise<CaliperOCRResult> {
  const startTime = performance.now();

  // 1. Try local fast extraction if input contains SVG or known digit classes
  if (input.includes('digit-') || input.includes('<svg')) {
    const svgMatch = input.match(/digit-([0-9])/g);
    if (svgMatch && svgMatch.length >= 3) {
      const digits = svgMatch.map(m => m.replace('digit-', ''));
      let reading: number;
      if (input.includes('<circle') && digits.length >= 5) {
        const intPart = digits.slice(0, digits.length - 2).join('');
        const decPart = digits.slice(digits.length - 2).join('');
        reading = parseFloat(`${intPart}.${decPart}`);
      } else if (digits.length === 5) {
        reading = parseFloat(`${digits.slice(0, 3).join('')}.${digits.slice(3).join('')}`);
      } else {
        reading = parseFloat(digits.join(''));
      }

      return {
        measuredHeight: reading,
        confidence: 0.99,
        processingTimeMs: Math.round(performance.now() - startTime),
        rawText: `${reading.toFixed(2)} mm`,
        digits: digits.join('')
      };
    }
  }

  // 2. Try server OCR endpoint
  try {
    const res = await fetch('/api/ocr/read-caliper', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: input })
    });
    if (res.ok) {
      const data = await res.json();
      return {
        measuredHeight: data.measuredHeight || data.data?.measuredHeight || 0,
        confidence: data.confidence || data.data?.confidence || 0.95,
        processingTimeMs: Math.round(performance.now() - startTime),
        rawText: data.rawText || `${data.measuredHeight} mm`,
        digits: data.digits || ''
      };
    }
  } catch (err) {
    console.warn('[ClientOCR] Server OCR call failed, falling back to pattern matching:', err);
  }

  // 3. Fallback pattern matching (only for text input, not base64 image data)
  if (!input.startsWith('data:image')) {
    const regex = /(?:(\d{3})\.?(\d{1,2}))|(?:(\d{2,3}\.\d{1,2}))/;
    const match = input.match(regex);
    if (match) {
      const val = parseFloat(match[0]);
      if (!isNaN(val) && val >= 100 && val <= 500) {
        return {
          measuredHeight: val,
          confidence: 0.92,
          processingTimeMs: Math.round(performance.now() - startTime),
          rawText: `${val.toFixed(2)} mm`,
          digits: val.toFixed(2).replace('.', '')
        };
      }
    }
  }

  return {
    measuredHeight: 0,
    confidence: 0,
    processingTimeMs: Math.round(performance.now() - startTime),
    rawText: '',
    digits: ''
  };
}

export function validateManualMeasurement(val: unknown): { valid: boolean; value?: number; error?: string } {
  if (val === null || val === undefined || val === '') {
    return { valid: false, error: 'Free height measurement is required' };
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

  if (num < 100.0) {
    return { valid: false, error: `Height (${num} mm) is below minimum possible limit (100.00 mm)` };
  }

  if (num > 500.0) {
    return { valid: false, error: `Height (${num} mm) exceeds maximum caliper limit (500.00 mm)` };
  }

  const rounded = Math.round(num * 100) / 100;
  return { valid: true, value: rounded };
}
