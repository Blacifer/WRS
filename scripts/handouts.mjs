#!/usr/bin/env node
/**
 * The handouts — the pages that leave the building — as PDFs.
 *
 *   node scripts/handouts.mjs
 *
 * Renders docs/handouts/drm-handout.html and docs/handouts/inspector-walk.html
 * (the latter written by `HANDOUT=1 node scripts/inspector-guide.mjs`) to
 * PDF beside themselves, with the same Chromium the drives use. Nothing in
 * either page says how it was produced; that is deliberate — they are read
 * by the shop and the DRM's office, not by the people who built them.
 */
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const pages = [
  ['docs/handouts/drm-handout.html', 'docs/handouts/drm-handout.pdf', { format: 'A4', margin: { top: '14mm', bottom: '14mm', left: '14mm', right: '14mm' } }],
  ['docs/handouts/inspector-walk.html', 'docs/handouts/inspector-walk.pdf', { format: 'A4', margin: { top: '10mm', bottom: '12mm', left: '10mm', right: '10mm' } }]
];
const browser = await chromium.launch();
for (const [src, out, opts] of pages) {
  if (!existsSync(src)) { console.log(`skip ${src} — not generated yet`); continue; }
  const page = await browser.newPage();
  await page.goto(`file://${resolve(src)}`, { waitUntil: 'networkidle' });
  await page.emulateMedia({ media: 'print', colorScheme: 'light' });
  await page.pdf({ path: out, printBackground: true, preferCSSPageSize: false, ...opts });
  console.log(`${out}`);
  await page.close();
}
await browser.close();
