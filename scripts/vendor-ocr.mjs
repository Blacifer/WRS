#!/usr/bin/env node
/**
 * Keep the OCR engine for the shed, not just for the demonstration
 * Indian Railways WRS Raipur
 *
 * The vision weights under client/public/models are served by this app and
 * cached by the service worker, so the camera works with no route to the
 * internet. The wagon-number reader did not: tesseract.js, left to its
 * defaults, fetches its worker script and its WASM core from cdn.jsdelivr.net
 * and the English language data from a second CDN — on first use, from a
 * shop PC that has no internet by design. So the one OCR feature actually
 * in use failed with a network error the moment it was needed.
 *
 * This puts the same files under client/public/tesseract/ so they are served
 * from this origin, cached the way the weights are, and packaged onto the
 * USB stick with everything else. The worker and the core come straight out
 * of node_modules (no network); the language data is fetched once and kept.
 *
 *   npm run vendor:ocr
 *
 * client/src/services/ocrAssets.ts is the one place the paths are named.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.join(here, '..', 'client');
const OUT = path.join(CLIENT, 'public', 'tesseract');
const NM = path.join(CLIENT, 'node_modules');

fs.mkdirSync(OUT, { recursive: true });

function copy(from, name) {
  const dest = path.join(OUT, name);
  fs.copyFileSync(from, dest);
  console.log(`  + ${name} (${(fs.statSync(dest).size / 1048576).toFixed(1)} MB)`);
}

console.log('tesseract -> client/public/tesseract/');

// The worker that runs the engine off the main thread.
copy(path.join(NM, 'tesseract.js', 'dist', 'worker.min.js'), 'worker.min.js');

// The engine. The app uses the LSTM-only model (tesseract.js's default), and
// the worker picks one of three builds by what the CPU supports — plain,
// SIMD, relaxed SIMD — so all three go, or a tablet without SIMD would fall
// back to a file that is not there.
for (const f of ['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js']) {
  copy(path.join(NM, 'tesseract.js-core', f), f);
}

// The English language data, from the package tesseract.js itself defaults
// to (4.0.0_best_int is the LSTM-only set), gzipped as the worker expects.
const lang = path.join(OUT, 'eng.traineddata.gz');
if (fs.existsSync(lang) && fs.statSync(lang).size > 0) {
  console.log('  = eng.traineddata.gz (already present)');
} else {
  const url = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(lang, buf);
  console.log(`  + eng.traineddata.gz (${(buf.length / 1048576).toFixed(1)} MB)`);
}

// A pin, so a `npm update` that moves tesseract.js does not leave the app
// loading a worker from one version against a core from another.
const v = JSON.parse(fs.readFileSync(path.join(NM, 'tesseract.js', 'package.json'), 'utf8')).version;
const cv = JSON.parse(fs.readFileSync(path.join(NM, 'tesseract.js-core', 'package.json'), 'utf8')).version;
fs.writeFileSync(path.join(OUT, 'VERSION'), `tesseract.js ${v}\ntesseract.js-core ${cv}\n`);
console.log(`  pinned: tesseract.js ${v}, tesseract.js-core ${cv}`);
