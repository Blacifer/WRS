#!/usr/bin/env node
/**
 * The wagon-number reader, with the internet cut
 * Indian Railways WRS Raipur
 *
 * The vision weights were vendored so the camera works in the shed. The OCR
 * engine was not: tesseract.js, given no paths, fetched its worker, its WASM
 * core and its language data from two CDNs on first use — from a shop PC
 * with no route to the internet by design. The wagon-number reader, the one
 * OCR feature in use, failed with a network error the moment it was needed,
 * and nothing in the test suite could see it because nothing in the test
 * suite loads the engine.
 *
 * This loads the BUILT app, refuses every request that leaves its origin,
 * and makes the app's own copy of the engine — the chunk Vite emitted, with
 * the paths in client/src/services/ocrAssets.ts — read eleven stencilled
 * digits off a canvas. If a single byte would have come from a CDN, the
 * read fails here rather than in the shed.
 *
 *   npm run build --prefix client && (cd client && npx vite preview)
 *   node --experimental-strip-types scripts/ocr-offline-drill.mjs
 */

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { OCR_WORKER_OPTIONS, OCR_ASSET_FILES, OCR_ASSET_ROOT } from '../client/src/services/ocrAssets.ts';

const BASE = process.env.DRILL_URL || 'http://localhost:4173';
const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(here, '..', 'client', 'dist');

// The app's own engine chunk, by the name vite.config.ts gives it.
const chunk = fs.readdirSync(path.join(DIST, 'assets')).find((f) => /^tesseract-.*\.js$/.test(f));
if (!chunk) {
  console.error('No tesseract-*.js chunk in client/dist/assets — build the client first.');
  process.exit(1);
}

const origin = new URL(BASE).origin;
const b = await chromium.launch();
const ctx = await b.newContext();
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));

// Nothing leaves this origin. Counted, so a pass says how many it refused.
let refused = [];
await ctx.route('**/*', (route) => {
  const u = route.request().url();
  if (u.startsWith(origin) || u.startsWith('blob:') || u.startsWith('data:')) return route.continue();
  refused.push(u);
  return route.abort('blockedbyclient');
});

await page.goto(BASE, { waitUntil: 'domcontentloaded' });

// 1. Every file the vendor script must have put there is served, whole.
const sizes = await page.evaluate(async ({ root, files }) => {
  const out = {};
  for (const f of files) {
    const r = await fetch(`${root}/${f}`);
    out[f] = r.ok ? (await r.arrayBuffer()).byteLength : -r.status;
  }
  return out;
}, { root: OCR_ASSET_ROOT, files: [...OCR_ASSET_FILES] });
let assetsOk = true;
for (const f of OCR_ASSET_FILES) {
  const raw = fs.readFileSync(path.join(DIST, 'tesseract', f));
  const onDisk = raw.length;
  /*
   * A static server may answer a .gz with Content-Encoding: gzip, in which
   * case the browser hands the engine the inflated bytes; the Node server
   * sends them as they are. The engine reads both (it checks the magic
   * bytes), so both are whole — what would not be is a truncated file.
   */
  const inflated = f.endsWith('.gz') ? zlib.gunzipSync(raw).length : null;
  const ok = sizes[f] === onDisk || sizes[f] === inflated;
  if (!ok) assetsOk = false;
  console.log(`  ${ok ? 'ok ' : 'BAD'} ${f}: served ${sizes[f]} bytes, on disk ${onDisk}${inflated ? ` (${inflated} inflated)` : ''}`);
}

// 2. The app's engine reads digits with the network cut.
const result = await page.evaluate(async ({ chunkUrl, options }) => {
  const c = document.createElement('canvas');
  c.width = 900; c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#000'; g.font = 'bold 96px Arial'; g.textBaseline = 'middle';
  g.fillText('31135017205', 30, 80);

  const m = await import(chunkUrl);
  const T = m.default?.createWorker ? m.default : Object.values(m).find((v) => v && typeof v === 'object' && typeof v.createWorker === 'function');
  if (!T) return { error: `no createWorker in chunk exports: ${Object.keys(m).join(',')}` };
  const started = performance.now();
  try {
    const worker = await T.createWorker('eng', 1, options);
    await worker.setParameters({ tessedit_char_whitelist: '0123456789 ' });
    const r = await worker.recognize(c);
    await worker.terminate();
    return { text: (r?.data?.text || '').trim(), confidence: r?.data?.confidence, ms: Math.round(performance.now() - started) };
  } catch (e) {
    return { error: String(e?.message || e), ms: Math.round(performance.now() - started) };
  }
}, { chunkUrl: `/assets/${chunk}`, options: OCR_WORKER_OPTIONS });

await b.close();

const digits = (result.text || '').replace(/\D/g, '');
console.log(`\n  read: "${result.text ?? ''}" (${result.ms} ms)${result.error ? ` — ERROR: ${result.error}` : ''}`);
console.log(`  requests refused for leaving ${origin}: ${refused.length}${refused.length ? '\n    ' + refused.slice(0, 5).join('\n    ') : ''}`);
if (errs.length) console.log(`  page errors: ${errs.slice(0, 3).join(' ;; ')}`);

const ok = assetsOk && !result.error && digits === '31135017205';
console.log(ok
  ? '\nPASS — the app\'s own OCR engine read the number from this origin alone.'
  : '\nFAIL — see above.');
process.exit(ok ? 0 : 1);
