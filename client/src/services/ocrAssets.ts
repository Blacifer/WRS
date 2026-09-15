/**
 * Where the OCR engine's files are, and why it is written down here
 * Indian Railways WRS Raipur
 *
 * tesseract.js, given no paths, fetches its worker and WASM core from
 * cdn.jsdelivr.net and its language data from a second CDN — on first use.
 * On the shop PC, which has no route to the internet by design, that is a
 * wagon-number reader that fails with a network error the first time an
 * inspector points it at a wagon. The vision weights had already been
 * vendored for exactly this reason; the OCR engine had not.
 *
 * scripts/vendor-ocr.mjs puts the files under client/public/tesseract/, the
 * service worker caches them like the weights, and this is the single place
 * both OCR services take their paths from — so neither can quietly go back
 * to a CDN.
 */

export const OCR_ASSET_ROOT = '/tesseract';

export const OCR_WORKER_OPTIONS = {
  workerPath: `${OCR_ASSET_ROOT}/worker.min.js`,
  corePath: OCR_ASSET_ROOT,
  langPath: OCR_ASSET_ROOT
} as const;

/** The files the vendor script must have put there. Checked by the drill. */
export const OCR_ASSET_FILES = [
  'worker.min.js',
  'tesseract-core-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-relaxedsimd-lstm.wasm.js',
  'eng.traineddata.gz'
] as const;
