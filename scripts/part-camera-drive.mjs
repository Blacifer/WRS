#!/usr/bin/env node
/**
 * The camera naming a wagon part, driven
 * Indian Railways WRS Raipur
 *
 * The sorting bench's camera learns springs. This one learns the parts a
 * wagon type is supposed to carry — the same 43 positions the parts ledger
 * measures against — so that recording a removal becomes: photograph, tap the
 * name, tap "record". This checks three things through the real screen:
 *
 *   1. The camera on the Parts tab offers this wagon type's OWN parts, not a
 *      generic list — every choice must be one of the expected positions.
 *   2. Confirming an answer fills the ledger form with that part, its
 *      category and its position, so the entry lands on the expected position
 *      rather than beside it (the vocabulary mismatch the ledger drive found).
 *   3. What it learned reached the server under the WAGON_PART domain.
 *
 * Like the spring drive, it teaches DRAWN images and refuses a database that
 * holds anything real. It is a deliberate run, not part of preflight.
 *
 *   node scripts/part-camera-drive.mjs
 */

import { chromium } from 'playwright';

const BASE = process.env.APP_URL || 'http://localhost:4173';
const WAGON_TYPE = 'BOXNHL';
const WAGON = `SECR/${WAGON_TYPE}/${50000 + Math.floor(Math.random() * 9000)}`;
const SYNTHETIC_MARK = 'SYNTHETIC_DRIVE';

const browser = await chromium.launch({
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader'
  ]
});
const ctx = await browser.newContext({ permissions: ['camera'] });
const page = await ctx.newPage();

const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
const failedCalls = [];
page.on('response', (r) => {
  if (r.url().includes('/api/') && r.status() >= 400) failedCalls.push(`${r.status()} ${r.url()}`);
});

// Stamp what this drive teaches, as the spring drive does, so it can be told
// apart from real evidence and refused on a real database.
await page.route('**/api/vision/brain/teach', (route) => {
  let body = {};
  try { body = JSON.parse(route.request().postData() || '{}'); } catch { /* leave it */ }
  return route.continue({ postData: JSON.stringify({ ...body, partName: SYNTHETIC_MARK }) });
});

console.log(`Signing in and registering ${WAGON}...`);
await page.goto(BASE);
await page.fill('input[type="text"]', 'inspector1');
await page.fill('input[type="password"]', 'password123');
await page.click('button[type="submit"]');
await page.waitForTimeout(2500);

const registered = await page.evaluate(async ({ wagonNumber, wagonType }) => {
  const r = await fetch('/api/wagons/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${localStorage.getItem('wrs_token')}` },
    body: JSON.stringify({ wagonNumber, wagonType, owningRailway: 'SECR' })
  });
  return r.status;
}, { wagonNumber: WAGON, wagonType: WAGON_TYPE });
if (registered >= 400) { console.error(`Could not register ${WAGON}: ${registered}`); process.exit(1); }

const before = await page.evaluate(async () => {
  const r = await fetch('/api/vision/brain?domain=WAGON_PART', {
    headers: { authorization: `Bearer ${localStorage.getItem('wrs_token')}` }
  });
  const b = await r.json().catch(() => null);
  const ex = b?.data?.examples || [];
  return { total: ex.length, real: ex.filter((e) => e.partName !== 'SYNTHETIC_DRIVE').length };
});
if (before.real > 0 && process.env.TEACH_DRIVE_ALLOW_REAL_DB !== '1') {
  console.error(`REFUSING TO RUN: this database holds ${before.real} real wagon-part teaching(s). See teach-camera-drive.mjs.`);
  process.exit(2);
}

// Open the wagon the way an inspector does (see parts-ledger-drive.mjs).
await page.getByRole('button', { name: /A wagon/i }).first().click();
await page.waitForTimeout(2500);
const row = page.getByText(WAGON, { exact: true }).first();
await row.waitFor({ timeout: 10000 });
await row.click();
await page.waitForTimeout(2500);
await page.getByRole('button', { name: /Continue checklist/i }).first().click();
await page.waitForTimeout(3000);
await page.locator('[data-testid="tab-parts"]').click();
await page.locator('[data-testid="parts-ledger"]').waitFor({ timeout: 15000 });

// The expected list, from the API, to check the camera's choices against.
const expected = await page.evaluate(async ({ wagonNumber }) => {
  const r = await fetch(`/api/wagons/${wagonNumber}/parts/reconciliation`, {
    headers: { authorization: `Bearer ${localStorage.getItem('wrs_token')}` }
  });
  const b = await r.json().catch(() => null);
  return (b?.data?.parts || []).filter((p) => p.expected !== null).map((p) => ({ name: p.partName, position: p.bogiePosition, category: p.category }));
}, { wagonNumber: WAGON });
console.log(`This wagon type expects ${expected.length} positions.\n`);

// 1. Switch the camera on and read what it offers.
await page.click('[data-testid="parts-camera-toggle"]');
const panel = page.locator('[data-testid="teach-the-camera"]');
await panel.waitFor({ timeout: 15000 });
await page.waitForFunction(
  () => !/Loading/i.test(document.querySelector('[data-testid="teach-accuracy"]')?.textContent || ''),
  { timeout: 30000 }
);

const offered = await page.evaluate(() =>
  [...document.querySelectorAll('[data-testid^="teach-label-"]')].map((b) => b.textContent.replace(/\d+$/, '').trim())
);
const expectedNames = new Set(expected.map((e) => e.name));
const foreign = offered.filter((o) => !expectedNames.has(o));
console.log(`1. The camera offers ${offered.length} answers. Not on the expected list: ${foreign.length}`);
console.log(`   e.g. "${offered[0]}"`);
if (offered.length === 0 || foreign.length > 0) {
  console.error('   FAIL — the camera must offer exactly this wagon type\'s parts.');
  process.exit(1);
}

// 2. Start the camera, feed it a drawn frame, look, confirm a part, and check
//    the form filled in.
await page.click('[data-testid="teach-camera-toggle"]');
await page.waitForFunction(() => {
  const b = document.querySelector('[data-testid="teach-camera-look"]');
  return b && !b.disabled;
}, { timeout: 30000 });

await page.evaluate(() => {
  const c = document.createElement('canvas');
  c.width = c.height = 480;
  const g = c.getContext('2d');
  g.fillStyle = '#6b6f76'; g.fillRect(0, 0, 480, 480);
  g.strokeStyle = '#c9ccd2'; g.lineWidth = 18;
  g.strokeRect(120, 90, 240, 300);
  g.beginPath(); g.arc(240, 240, 60, 0, Math.PI * 2); g.stroke();
  const video = document.querySelector('[data-testid="teach-the-camera"] video');
  video.srcObject = c.captureStream(10);
  return video.play().catch(() => {});
});
await page.waitForFunction(() => {
  const v = document.querySelector('[data-testid="teach-the-camera"] video');
  return v && v.videoWidth > 0 && v.readyState >= 2;
}, { timeout: 30000 });

await page.click('[data-testid="teach-camera-look"]');
await page.waitForFunction(
  () => !document.querySelector('[data-testid="teach-camera-look"]').disabled,
  { timeout: 180000 }
);
const said = (await page.locator('[data-testid="teach-proposal"]').innerText()).trim();
console.log(`\n2. Shown a part it has never seen, it said: "${said}"`);

// Pick a part that has exactly one expected position, so the form can fill
// category and position unambiguously.
const byName = new Map();
for (const e of expected) byName.set(e.name, [...(byName.get(e.name) || []), e]);
const target = expected.find((e) => byName.get(e.name).length === 1);
const label = target.name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64);
await page.click(`[data-testid="teach-label-${label}"]`);
await page.waitForTimeout(500);

const form = await page.evaluate(() => ({
  part: document.querySelector('[data-testid="part-name-input"]')?.value,
  category: document.querySelectorAll('[data-testid="parts-ledger"] select')[0]?.value,
  position: document.querySelectorAll('[data-testid="parts-ledger"] select')[1]?.value
}));
console.log(`   Confirmed "${target.name}". The ledger form now holds:`);
console.log(`     part      ${form.part}`);
console.log(`     category  ${form.category}   (expected ${target.category})`);
console.log(`     position  ${form.position}   (expected ${target.position})`);
const filled = form.part === target.name && form.category === target.category && form.position === target.position;

// 3. It reached the server, in the right domain.
const after = await page.evaluate(async () => {
  const r = await fetch('/api/vision/brain?domain=WAGON_PART', {
    headers: { authorization: `Bearer ${localStorage.getItem('wrs_token')}` }
  });
  const b = await r.json().catch(() => null);
  return { total: b?.data?.examples?.length ?? 0, counts: b?.data?.counts?.PART_ID ?? {} };
});
console.log(`\n3. The server now holds ${after.total} wagon-part teaching(s) (${before.total} before).`);
console.log(`   ${JSON.stringify(after.counts)}`);

await browser.close();
console.log(`\nConsole errors:    ${consoleErrors.length ? consoleErrors.join('\n  ') : 'none'}`);
console.log(`Failed API calls:  ${failedCalls.length ? failedCalls.join('\n  ') : 'none'}`);

const ok = filled && after.total === before.total + 1 && consoleErrors.length === 0 && failedCalls.length === 0;
console.log(ok
  ? '\nPASS — the camera offers the wagon\'s own parts, a confirmed answer fills the ledger form, and it was remembered.'
  : '\nFAIL — see above.');
process.exit(ok ? 0 : 1);
