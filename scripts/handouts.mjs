#!/usr/bin/env node
/**
 * The handouts — the pages that leave the building — as PDFs.
 *
 *   node scripts/handouts.mjs
 *
 * Renders docs/handouts/drm-handout.html and the four role walks
 * (written by `HANDOUT=1 node scripts/walk-guide.mjs <role>`) to PDF beside
 * themselves, with the same Chromium the drives use. Nothing in
 * either page says how it was produced; that is deliberate — they are read
 * by the shop and the DRM's office, not by the people who built them.
 */
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const walk = { format: 'A4', margin: { top: '10mm', bottom: '12mm', left: '10mm', right: '10mm' } };
const pages = [
  ['docs/handouts/drm-handout.html', 'docs/handouts/drm-handout.pdf', { format: 'A4', margin: { top: '14mm', bottom: '14mm', left: '14mm', right: '14mm' } }],
  ['docs/handouts/drm-dossier.html', 'docs/handouts/drm-dossier.pdf', { format: 'A4', margin: { top: '16mm', bottom: '16mm', left: '16mm', right: '16mm' }, displayHeaderFooter: true, headerTemplate: '<div></div>', footerTemplate: '<div style="font-family:sans-serif;font-size:8px;color:#7a8590;width:100%;text-align:center">WRS Raipur — Spring &amp; Wagon QC — page <span class="pageNumber"></span> of <span class="totalPages"></span></div>' }],
  ['docs/handouts/spring-line-proposal.html', 'docs/handouts/spring-line-proposal.pdf', { format: 'A4', margin: { top: '15mm', bottom: '15mm', left: '15mm', right: '15mm' }, displayHeaderFooter: true, headerTemplate: '<div></div>', footerTemplate: '<div style="font-family:sans-serif;font-size:8px;color:#7a8590;width:100%;text-align:center">WRS Raipur — The spring line — page <span class="pageNumber"></span> of <span class="totalPages"></span></div>' }],
  ...['inspector', 'supervisor', 'drm', 'admin'].map((r) => [`docs/handouts/${r}-walk.html`, `docs/handouts/${r}-walk.pdf`, walk]),
  // For the tester, not the room: the tick page and the meeting pack, printable.
  ['docs/artifacts/walkthrough.html', 'docs/handouts/walkthrough-test-script.pdf', { format: 'A4', landscape: true, margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' } }],
  ['docs/artifacts/meeting-pack.html', 'docs/handouts/meeting-pack.pdf', walk]
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
