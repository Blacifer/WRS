#!/usr/bin/env node
/**
 * Pocket counts — driven the way the shop will use them
 * Indian Railways WRS Raipur
 *
 * Green tests are not evidence. This uploads four assembly frames for a
 * BOXNHL, has one inspector count two of them on the real screen (one
 * matching, one short), checks that the same inspector cannot recount,
 * has a second inspector recount blind — never seeing the first count or
 * the expected figure — and then looks at the exit gate as the supervisor
 * to see the short count and the disagreement waiting there, by name.
 *
 *   npm run dev                              # or a preview on :4173
 *   node scripts/pocket-count-drive.mjs
 */

import { chromium } from 'playwright';

const BASE = process.env.APP_URL || 'http://localhost:4173';
const WAGON_TYPE = 'BOXNHL';
const WAGON = `SECR/${WAGON_TYPE}/${50000 + Math.floor(Math.random() * 9000)}`;
const problems = [];
const check = (ok, what) => { console.log(`${ok ? '  ✓' : '  ✗'} ${what}`); if (!ok) problems.push(what); };

const browser = await chromium.launch();
const page = await browser.newPage();
const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
const failedCalls = [];
page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) failedCalls.push(`${r.status()} ${r.request().method()} ${r.url()}`); });

async function signIn(username) {
  await page.goto(BASE);
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE);
  await page.fill('input[type="text"]', username);
  await page.fill('input[type="password"]', 'password123');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);
  const token = await page.evaluate(() => localStorage.getItem('wrs_token'));
  if (!token) { console.error(`Could not sign in as ${username}.`); process.exit(1); }
}

/** Open the wagon's Photos tab, as an inspector (landing → list → Continue checklist) or as staff (list → card). */
async function openPhotos(inspector) {
  if (inspector) {
    await page.getByRole('button', { name: /A wagon/i }).first().click();
    await page.waitForTimeout(2000);
    await page.getByText(WAGON, { exact: true }).first().click();
    await page.waitForTimeout(2000);
    await page.getByRole('button', { name: /Continue checklist/i }).first().click();
  } else {
    await page.locator('[data-testid="nav-wagons"]').first().click();
    await page.waitForTimeout(2000);
    await page.getByText(WAGON, { exact: true }).first().click();
  }
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: /Photo/i }).first().click();
  await page.locator('[data-testid="pocket-panel"]').waitFor({ timeout: 15000 });
}

/** Tap N marks of a kind on the frame, along one row. */
async function tapRow(kind, n, y) {
  await page.click(`[data-testid="pocket-kind-${kind}"]`);
  const box = await page.locator('[data-testid="pocket-frame"]').boundingBox();
  for (let i = 0; i < n; i++) await page.mouse.click(box.x + box.width * ((i + 0.5) / n), box.y + box.height * y);
}

console.log(`Signing in as inspector1 and registering ${WAGON}...`);
await signIn('inspector1');
const setup = await page.evaluate(async ({ wagonNumber, wagonType }) => {
  const h = { 'content-type': 'application/json', authorization: `Bearer ${localStorage.getItem('wrs_token')}` };
  const reg = await fetch('/api/wagons/register', { method: 'POST', headers: h, body: JSON.stringify({ wagonNumber, wagonType, owningRailway: 'SECR' }) });
  // A drawn "open bogie": a dark frame with pale discs where the springs sit. Enough for a person to tap.
  const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 400;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#2b2b2b'; ctx.fillRect(0, 0, 640, 400);
  for (let i = 0; i < 7; i++) { ctx.fillStyle = '#9ca3af'; ctx.beginPath(); ctx.arc(60 + i * 86, 120, 30, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#d1d5db'; ctx.beginPath(); ctx.arc(60 + i * 86, 120, 14, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = '#f9a8d4'; ctx.beginPath(); ctx.arc(200, 280, 24, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(440, 280, 24, 0, Math.PI * 2); ctx.fill();
  const imageBase64 = canvas.toDataURL('image/jpeg', 0.8);
  const ids = {};
  for (const bogie of ['BOGIE_1', 'BOGIE_2']) for (const side of ['SIDE_A', 'SIDE_B']) {
    const r = await fetch('/api/photos/upload', { method: 'POST', headers: h, body: JSON.stringify({
      wagonNumber, category: 'SPRINGS', partName: `Bogie assembly — ${bogie} ${side}`, stage: 'REASSEMBLY', imageBase64, evidenceStage: 'GENERAL',
      tags: ['ASSEMBLY_EVIDENCE', `WAGON_TYPE:${wagonType}`, `BOGIE:${bogie}`, `SIDE:${side}`]
    }) });
    ids[`${bogie}-${side}`] = (await r.json()).data?.id;
  }
  return { reg: reg.status, ids };
}, { wagonNumber: WAGON, wagonType: WAGON_TYPE });
check(setup.reg === 201 || setup.reg === 200, `wagon registered (${setup.reg})`);
check(Object.values(setup.ids).every(Boolean), 'four assembly frames uploaded');

console.log('\n1. inspector1 counts BOGIE 1 SIDE A — the expected figure is not on the screen');
await openPhotos(true);
check((await page.locator('[data-testid^="pocket-frame-BOGIE"]').count()) === 4, 'the panel lists four frames');
check(/Not counted yet/.test(await page.locator('[data-testid="pocket-frame-BOGIE_1-SIDE_A"]').innerText()), 'a frame nobody counted says so');
await page.click('[data-testid="pocket-open-BOGIE_1-SIDE_A"]');
await page.locator('[data-testid="pocket-counter"]').waitFor();
const counterText = await page.locator('[data-testid="pocket-counter"]').innerText();
check(!/\b16\b|\b7\/7\/2\b/.test(counterText), 'the counter shows no expected count before the count is made');
await tapRow('OUTER', 7, 0.3); await tapRow('INNER', 7, 0.3); await tapRow('SNUBBER', 2, 0.7);
check((await page.locator('[data-testid="pocket-tap"]').count()) === 16, 'sixteen marks on the frame');
check((await page.locator('[data-testid="pocket-tally-OUTER"]').innerText()) === '7', 'outer tally reads 7');
await page.click('[data-testid="pocket-undo"]');
check((await page.locator('[data-testid="pocket-tap"]').count()) === 15, 'undo removes the last mark');
await tapRow('SNUBBER', 1, 0.7);
await page.click('[data-testid="pocket-submit"]');
await page.locator('[data-testid="pocket-outcome"]').waitFor();
check((await page.locator('[data-testid="pocket-match"]').count()) === 1, 'a matching count is reported as a count, with nothing raised');
check(!/verified|✓/i.test(await page.locator('[data-testid="pocket-outcome"]').innerText()), 'no "verified" appears');
await page.click('[data-testid="pocket-close"]');
await page.waitForTimeout(1000);

console.log('\n2. inspector1 counts BOGIE 1 SIDE B short by one inner');
await page.click('[data-testid="pocket-open-BOGIE_1-SIDE_B"]');
await page.locator('[data-testid="pocket-counter"]').waitFor();
await tapRow('OUTER', 7, 0.3); await tapRow('INNER', 6, 0.3); await tapRow('SNUBBER', 2, 0.7);
await page.click('[data-testid="pocket-submit"]');
await page.locator('[data-testid="pocket-outcome"]').waitFor();
const shortText = await page.locator('[data-testid="pocket-short"]').innerText().catch(() => '');
check(/6 of 7 inner/.test(shortText), `short count names the kind: "${shortText.slice(0, 80)}"`);
await page.click('[data-testid="pocket-close"]');
await page.waitForTimeout(1000);
check(/recount pending/.test(await page.locator('[data-testid="pocket-frame-BOGIE_1-SIDE_B"]').innerText()), 'the panel shows the counter their own count and asks for a recount');

console.log('\n3. the same person cannot recount');
await page.click('[data-testid="pocket-open-BOGIE_1-SIDE_A"]');
await page.locator('[data-testid="pocket-already"]').waitFor();
check(/someone else/.test(await page.locator('[data-testid="pocket-already"]').innerText()), 'refused on the screen, with the reason');
await page.click('[data-testid="pocket-close"]');

console.log('\n4. inspector2 recounts BOGIE 1 SIDE B blind');
await signIn('inspector2');
await openPhotos(true);
const rowB = await page.locator('[data-testid="pocket-frame-BOGIE_1-SIDE_B"]').innerText();
check(/blind recount by someone else is needed/.test(rowB) && !/7⁄6⁄2/.test(rowB), 'the first count is withheld from the recounter');
await page.click('[data-testid="pocket-open-BOGIE_1-SIDE_B"]');
await page.locator('[data-testid="pocket-counter"]').waitFor();
await page.locator('[data-testid="pocket-kind-OUTER"]').waitFor();
const blindText = await page.locator('[data-testid="pocket-counter"]').innerText();
check(/not shown to you/.test(blindText) && !/7\/6\/2|\b16\b/.test(blindText), 'the counter says the first count is hidden, and it is');
await tapRow('OUTER', 7, 0.3); await tapRow('INNER', 7, 0.3); await tapRow('SNUBBER', 2, 0.7);
await page.click('[data-testid="pocket-submit"]');
await page.locator('[data-testid="pocket-outcome"]').waitFor();
check(/differs from the first count/.test(await page.locator('[data-testid="pocket-agree"]').innerText()), 'the disagreement is reported to the recounter');
await page.click('[data-testid="pocket-close"]');
await page.waitForTimeout(1000);
check(/disagree/.test(await page.locator('[data-testid="pocket-frame-BOGIE_1-SIDE_B"]').innerText()), 'the panel now shows both counts and that they disagree');

console.log('\n5. supervisor1 sees it at the exit gate');
await signIn('supervisor1');
await openPhotos(false);
const supRow = await page.locator('[data-testid="pocket-frame-BOGIE_1-SIDE_B"]').innerText();
check(/7⁄6⁄2/.test(supRow), 'the supervisor sees the counts — they are not a recounter');
await page.getByRole('button', { name: /Release checks/i }).first().click();
await page.waitForTimeout(2000);
const body = await page.locator('body').innerText();
check(/6 of 7 inner/.test(body), 'the short count is on the gate screen');
check(/two people counted this frame and disagreed/.test(body), 'the disagreement is on the gate screen');
check(!/pocket.*(blocked|blocker)/i.test(body), 'it is an advisory, not a blocker');

console.log('\n6. the DRM dashboard reports the dataset with no model');
await signIn('drm1');
await page.locator('[data-testid="nav-dashboard"]').first().click();
await page.locator('[data-testid="pocket-dataset"]').waitFor({ timeout: 15000 });
const ds = await page.locator('[data-testid="pocket-dataset"]').innerText();
const figures = (ds.match(/(\d+) frames counted · (\d+) bogies both sides · (\d+) blind recounts(?:, (\d+(?:\.\d+)?)% agree)?/) || []);
check(Number(figures[1]) >= 2 && Number(figures[3]) >= 1, `dataset figures: ${figures[0]}`);
check(/Model: NONE/.test(ds), 'the model is NONE, said plainly');

const relevantFailures = failedCalls.filter((f) => !/\/api\/(auth|photos\/.*pocket-count$)/.test(f) || !/^409/.test(f));
console.log(`\nConsole errors: ${consoleErrors.length}; failed API calls: ${relevantFailures.length}${relevantFailures.length ? '\n  ' + relevantFailures.join('\n  ') : ''}`);
await browser.close();
if (problems.length || consoleErrors.length) { console.error(`\n${problems.length} problem(s).`); process.exit(1); }
console.log('\nDriven. A count is a label; a match is silence; a short count reaches the gate by name.');
