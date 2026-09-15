/**
 * The OCR engine is loaded from this origin, by both readers
 * Indian Railways WRS Raipur
 *
 * tesseract.js's defaults point at two CDNs. scripts/ocr-offline-drill.mjs
 * proves the vendored files work with the network cut; this pins the two
 * services to those paths so that a refactor which drops the options
 * argument — the smallest possible edit — fails here rather than in the shed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OCR_WORKER_OPTIONS, OCR_ASSET_ROOT, OCR_ASSET_FILES } from '../src/services/ocrAssets.ts';

const createWorker = vi.fn(async () => ({
  setParameters: async () => undefined,
  recognize: async () => ({ data: { text: '31135017205', confidence: 90 } }),
  terminate: async () => undefined
}));

vi.mock('tesseract.js', () => ({ default: { createWorker } }));

describe('where the OCR engine comes from', () => {
  beforeEach(() => createWorker.mockClear());

  it('TC-OCR-01 every path is on this origin', () => {
    expect(OCR_ASSET_ROOT.startsWith('/')).toBe(true);
    for (const v of Object.values(OCR_WORKER_OPTIONS)) {
      expect(v.startsWith('/')).toBe(true);
      expect(v).not.toMatch(/^https?:/);
    }
    expect(OCR_ASSET_FILES).toContain('worker.min.js');
    expect(OCR_ASSET_FILES).toContain('eng.traineddata.gz');
  });

  it('TC-OCR-02 the wagon-number reader passes them to the engine', async () => {
    const { readWagonNumber } = await import('../src/services/wagonNumberOcr.ts');
    await readWagonNumber('data:image/png;base64,AAAA');
    expect(createWorker).toHaveBeenCalledTimes(1);
    expect(createWorker.mock.calls[0][2]).toEqual(OCR_WORKER_OPTIONS);
  });

  it('TC-OCR-03 the caliper reader passes them to the engine', async () => {
    const mod = await import('../src/services/ocr.ts');
    // The preprocessing draws to a canvas, which happy-dom cannot; the engine
    // call after it is the subject, so the step before is stood in for.
    vi.spyOn(mod, 'preprocessImageForOCR').mockResolvedValue('data:image/png;base64,AAAA');
    await mod.processCaliperImage('data:image/png;base64,AAAA');
    expect(createWorker).toHaveBeenCalledTimes(1);
    expect(createWorker.mock.calls[0][2]).toEqual(OCR_WORKER_OPTIONS);
  });
});
