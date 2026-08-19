/**
 * Tier 1 Test Suite — Feature R2: Measurement Input (OCR & Manual Fallback)
 * Indian Railways WRS Raipur
 *
 * Verifies caliper LCD OCR reading across 5+ sample fixture images,
 * response time under 3 seconds, and strict validation of manual entry fallback.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CaliperOCREngine } from '../../harness/ocr_engine.ts';
import { FIXTURE_SPECS } from '../../fixtures/generate_fixtures.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, '../../fixtures');

describe('Tier 1 — R2: Measurement Input (OCR & Manual)', () => {
  const ocrEngine = new CaliperOCREngine();

  // Test Case 1: OCR Caliper Image reading 260.00mm
  it('TC-R2-01: Caliper LCD OCR correctly parses 260.00 mm from SVG and BMP fixture image', async () => {
    const svgPath = path.join(FIXTURES_DIR, 'caliper_260_00.svg');
    const svgContent = fs.readFileSync(svgPath, 'utf-8');
    const resultSvg = await ocrEngine.readCaliperImage(svgContent);

    assert.strictEqual(resultSvg.measuredHeight, 260.00);
    assert.ok(resultSvg.confidence >= 0.9);
    assert.ok(resultSvg.processingTimeMs < 3000, `Processing time ${resultSvg.processingTimeMs}ms must be under 3000ms`);

    const bmpPath = path.join(FIXTURES_DIR, 'caliper_260_00.bmp');
    const bmpBuffer = fs.readFileSync(bmpPath);
    const resultBmp = await ocrEngine.readCaliperImage(bmpBuffer);
    assert.strictEqual(resultBmp.measuredHeight, 260.00);
    assert.ok(resultBmp.confidence >= 0.9);
  });

  // Test Case 2: OCR Caliper Image reading 257.50mm
  it('TC-R2-02: Caliper LCD OCR correctly parses 257.50 mm from fixture image', async () => {
    const svgPath = path.join(FIXTURES_DIR, 'caliper_257_50.svg');
    const svgContent = fs.readFileSync(svgPath, 'utf-8');
    const res = await ocrEngine.readCaliperImage(svgContent);

    assert.strictEqual(res.measuredHeight, 257.50);
    assert.ok(res.confidence >= 0.9);
    assert.ok(res.processingTimeMs < 3000);
  });

  // Test Case 3: OCR Caliper Image reading 248.00mm
  it('TC-R2-03: Caliper LCD OCR correctly parses 248.00 mm from fixture image', async () => {
    const svgPath = path.join(FIXTURES_DIR, 'caliper_248_00.svg');
    const svgContent = fs.readFileSync(svgPath, 'utf-8');
    const res = await ocrEngine.readCaliperImage(svgContent);

    assert.strictEqual(res.measuredHeight, 248.00);
    assert.ok(res.confidence >= 0.9);
    assert.ok(res.processingTimeMs < 3000);
  });

  // Test Case 4: OCR Caliper Images reading 294.00mm, 305.20mm, 241.30mm, 273.00mm
  it('TC-R2-04: Caliper LCD OCR accurately reads remaining sample fixture images', async () => {
    const sampleFixtures = [
      { name: 'caliper_294_00.svg', expected: 294.00 },
      { name: 'caliper_305_20.svg', expected: 305.20 },
      { name: 'caliper_241_30.svg', expected: 241.30 },
      { name: 'caliper_273_00.svg', expected: 273.00 }
    ];

    for (const item of sampleFixtures) {
      const svgPath = path.join(FIXTURES_DIR, item.name);
      const svgContent = fs.readFileSync(svgPath, 'utf-8');
      const res = await ocrEngine.readCaliperImage(svgContent);

      assert.strictEqual(res.measuredHeight, item.expected, `Fixture ${item.name} should read ${item.expected}`);
      assert.ok(res.confidence >= 0.9);
      assert.ok(res.processingTimeMs < 3000);
    }
  });

  // Test Case 5: Performance Benchmark — Execution time under 3 seconds
  it('TC-R2-05: Caliper OCR response latency benchmark is strictly under 3 seconds (< 3000ms)', async () => {
    const svgPath = path.join(FIXTURES_DIR, 'caliper_260_00.svg');
    const svgContent = fs.readFileSync(svgPath, 'utf-8');

    const start = performance.now();
    const res = await ocrEngine.readCaliperImage(svgContent);
    const duration = performance.now() - start;

    assert.ok(duration < 3000, `OCR response took ${duration.toFixed(2)}ms, exceeding 3s SLA`);
    assert.ok(res.processingTimeMs < 3000);
  });

  // Test Case 6: Manual Entry Validation — Valid numeric strings and numbers
  it('TC-R2-06: Manual entry validator accepts valid numbers and decimal strings within physical limits', () => {
    const validInputs = [
      { input: 260.0, expected: 260.0 },
      { input: '257.5', expected: 257.5 },
      { input: ' 248.00 ', expected: 248.0 },
      { input: 294.156, expected: 294.16 }
    ];

    for (const v of validInputs) {
      const valRes = ocrEngine.validateManualInput(v.input);
      assert.strictEqual(valRes.valid, true, `Input ${v.input} should be valid`);
      assert.strictEqual(valRes.value, v.expected);
    }
  });

  // Test Case 7: Manual Entry Validation — Rejection of non-numeric inputs
  it('TC-R2-07: Manual entry validator rejects invalid non-numeric formats (empty, alpha, NaN, multiple dots)', () => {
    const invalidInputs = ['', '   ', 'abc', '25.4.1', 'two hundred', null, undefined];

    for (const inv of invalidInputs) {
      const valRes = ocrEngine.validateManualInput(inv);
      assert.strictEqual(valRes.valid, false, `Input ${inv} must be rejected`);
      assert.ok(valRes.error && valRes.error.length > 0);
    }
  });

  // Test Case 8: Manual Entry Validation — Rejection of impossible physical ranges
  it('TC-R2-08: Manual entry validator rejects negative, zero, and out-of-physical-range heights (<100mm, >500mm)', () => {
    const impossibleInputs = [
      { input: 0, reason: 'zero' },
      { input: -250.0, reason: 'negative' },
      { input: 45.0, reason: 'below 100mm min limit' },
      { input: 750.0, reason: 'exceeds 500mm max caliper limit' }
    ];

    for (const imp of impossibleInputs) {
      const valRes = ocrEngine.validateManualInput(imp.input);
      assert.strictEqual(valRes.valid, false, `Input ${imp.input} (${imp.reason}) must be rejected`);
      assert.ok(valRes.error);
    }
  });

});
