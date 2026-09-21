#!/usr/bin/env node
/**
 * Section 2 of the walkthrough — the inspector, on a phone — performed by a
 * machine, photographed step by step, so a person can see what each screen
 * must look like before doing it with their own hands.
 *
 * Every step below is the same step, with the same number, as section 2 of
 * docs/WALKTHROUGH_TEST_SCRIPT.md and the artifact page. For each one it
 * records: what it tapped, what the screen said, whether that matched, and
 * a phone-sized photograph. The result is written as JSON for the guide
 * page to render; nothing here changes what the walkthrough expects.
 *
 *   APP_URL=https://localhost:3200 node scripts/inspector-walk.mjs [outDir]
 *
 * Two steps need a physical thing a machine cannot supply: a real spring in
 * front of a camera (2.7) and a painted wagon number (2.18). Those are
 * driven with a fake camera and reported as "screen opens — the rest is by
 * hand", not as passed.
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.APP_URL || 'https://localhost:3200';
const OUT = process.argv[2] || 'docs/artifacts/inspector-walk';
mkdirSync(OUT, { recursive: true });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const steps = [];
let current = null;
const begin = (num, did) => { current = { num, did, saw: [], ok: true, shots: [], byHand: null, startedAt: new Date().toISOString() }; steps.push(current); console.log(`\n${num} ${did}`); };
const saw = (ok, text) => { current.saw.push({ ok, text }); if (!ok) current.ok = false; console.log(`  ${ok ? '✓' : '✗'} ${text}`); };
const byHand = (text) => { current.byHand = text; console.log(`  ○ by hand: ${text}`); };

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
let ctx; let page;
const consoleErrors = [];
async function open() {
  if (ctx) await ctx.close();
  ctx = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    permissions: ['camera'],
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36'
  });
  page = await ctx.newPage();
  page.on('pageerror', (e) => consoleErrors.push(`${current?.num || '-'}: ${String(e).slice(0, 160)}`));
}
let shotN = 0;
async function shot(name, { full = true } = {}) {
  await page.waitForTimeout(1000);
  // From the top, so the sticky header sits where a person sees it and the capture has no blank band.
  if (full) { await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(300); }
  shotN++;
  const file = `${String(shotN).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: join(OUT, file), fullPage: full });
  current.shots.push(file);
  return file;
}
const bodyText = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ');
const has = async (re) => re.test(await bodyText());
const api = async (method, p, body, token) => {
  const r = await fetch(`${BASE}/api${p}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
async function signIn(user) {
  await open();
  await page.goto(BASE);
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('wrs_lang', 'en'); });
  await page.goto(BASE);
  await page.fill('input[type="text"]', user);
  await page.fill('input[type="password"]', 'password123');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);
  return page.evaluate(() => localStorage.getItem('wrs_token'));
}
const nav = async (id) => { await page.locator(`[data-testid="${id}"]`).first().click(); await page.waitForTimeout(1500); };
const wagonTab = async (label) => { await page.locator('[data-testid="wagon-tabs"] button', { hasText: label }).first().click(); await page.waitForTimeout(2000); };
async function openWagonFromHome(number) {
  await nav('nav-inspector-home');
  await chooseWagon();
  // Inside the picker only — the active-wagon card behind it carries the same number.
  const picker = page.locator('.fixed.inset-0').last();
  if (await picker.locator(`text=${number}`).first().isVisible().catch(() => false)) {
    await picker.locator(`text=${number}`).first().click();
  } else {
    await picker.getByRole('button', { name: /All wagons/i }).first().click().catch(() => {});
    await page.waitForTimeout(1000);
    if (await picker.locator(`text=${number}`).first().isVisible().catch(() => false)) {
      await picker.locator(`text=${number}`).first().click();
    } else {
      await page.fill('#wagon-manual', number);
      await page.locator('#wagon-manual').press('Enter');
    }
  }
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /^(Continue checklist|Open checklist|Start checklist)/i }).first().click().catch(() => {});
  await page.waitForTimeout(1500);
}
// "A wagon" on the home screen; once a wagon is active the card offers "Switch wagon" instead.
async function chooseWagon() {
  const choose = page.locator('[data-testid="choose-wagon"]').first();
  if (await choose.isVisible().catch(() => false)) await choose.click();
  else await page.locator('[data-testid="btn-switch-wagon"]').first().click();
  await page.waitForTimeout(1500);
}
const record = async () => (await page.locator('[data-testid="my-record-today"]').first().innerText().catch(() => '')).replace(/\s+/g, ' ');
const sessionTotal = async () => Number((await page.locator('[data-testid="session-total"]').innerText().catch(() => '0')).replace(/\D/g, '') || 0);
const bandButtons = () => page.locator('button[style*="background-color"]');

// ---------------------------------------------------------------------------
const token = await signIn('inspector1');
const startedAt = new Date().toISOString();

begin('2.1', 'Home');
await shot('home');
saw(await has(/Springs/), 'the Springs card is on the home screen');
saw(await has(/A wagon/), 'the "A wagon" card is on the home screen');
saw(await has(/Your record today/i), '"Your record today" sits under the two cards');

begin('2.2', 'Sorting');
await nav('nav-spring-sorting');
await shot('sorting');
{
  const t = await bodyText();
  saw(/Bogie type/i.test(t), 'a Bogie type chooser');
  saw(/Used/.test(t) && /New/.test(t), 'Used / New');
  saw(/Outer/.test(t) && /Inner/.test(t) && /Snubber/.test(t), 'Outer / Inner / Snubber');
  const n = await bandButtons().count();
  saw(n === 6, `six coloured band buttons for a used spring (${n} found)`);
  const labels = (await bandButtons().allInnerTexts()).map((s) => s.replace(/\s+/g, ' ').trim());
  saw(labels.every((l) => /\d{3}/.test(l)), `each button carries a height range: ${labels.map((l) => l.slice(0, 28)).join(' | ')}`);
}

begin('2.3', 'Tap Green, Yellow, Blue');
{
  const t0 = await sessionTotal();
  const labels = await bandButtons().allInnerTexts();
  const idx = (name) => labels.findIndex((l) => new RegExp(name, 'i').test(l));
  for (const name of ['Green', 'Yellow', 'Blue']) { const i = idx(name); await bandButtons().nth(i >= 0 ? i : 0).click(); await page.waitForTimeout(900); }
  const t3 = await sessionTotal();
  saw(t3 === t0 + 3, `session total went ${t0} → ${t3}`);
  await shot('three-sorted');
  const rec = await record();
  const rows = (await page.locator('[data-testid="my-record-list"] li').allInnerTexts()).slice(0, 3).map((r) => r.replace(/\s+/g, ' '));
  saw(/BLUE/.test(rows[0] || '') && /YELLOW/.test(rows[1] || '') && /GREEN/.test(rows[2] || ''), `Your record today lists the three newest first — ${rows.map((r) => r.slice(0, 40)).join(' / ')}`);
  saw(/\d{1,2}:\d{2}/.test(rec), 'with a time against each');
}

begin('2.4', 'Tap Undo last');
{
  const before = await sessionTotal();
  await page.locator('[data-testid="undo-last-spring"]').click();
  await page.waitForTimeout(1200);
  const after = await sessionTotal();
  saw(after === before - 1, `total went ${before} → ${after}`);
  const note = (await page.locator('[data-testid="undo-notice"]').innerText().catch(() => '')).replace(/\s+/g, ' ');
  saw(note.length > 0, `the undone spring is named: "${note.slice(0, 120)}"`);
  await shot('undone', { full: false });
}

begin('2.5', 'Gauge picker → Snubber → SSG-02');
{
  const opts = await page.locator('[data-testid="gauge-select"] option').allInnerTexts();
  saw(['OSG-01', 'OSG-02', 'ISG-01', 'SSG-02'].every((g) => opts.some((o) => o.includes(g))), `gauges named: ${opts.filter((o) => /SG-/.test(o)).map((o) => o.trim().slice(0, 30)).join(', ')}`);
  await page.locator('select').filter({ has: page.locator('option[value="SNUBBER"]') }).first().selectOption('SNUBBER').catch(() => {});
  await page.waitForTimeout(800);
  const ssg = (await page.locator('[data-testid="gauge-select"] option').allInnerTexts()).find((o) => /SSG-02/.test(o));
  await page.locator('[data-testid="gauge-select"]').selectOption({ label: ssg || '' }).catch(() => {});
  await page.waitForTimeout(800);
  const warn = (await page.locator('[data-testid="gauge-calibration-warning"]').innerText().catch(() => '')).replace(/\s+/g, ' ');
  saw(/calibrat/i.test(warn), `amber note: "${warn.slice(0, 120)}"`);
  await shot('ssg-02', { full: false });
  await page.locator('select').filter({ has: page.locator('option[value="OUTER"]') }).first().selectOption('OUTER').catch(() => {});
  await page.waitForTimeout(500);
}

begin('2.6', 'Condemn this spring');
{
  await page.locator('[data-testid="condemn-open"]').click();
  await page.waitForTimeout(800);
  await shot('condemn-open');
  const reasons = (await page.locator('[data-testid="condemn-reasons"]').innerText().catch(() => '')).replace(/\s+/g, ' ');
  saw(/crack/i.test(reasons) && /corrosion/i.test(reasons), `reasons offered: "${reasons.slice(0, 140)}"`);
  await page.locator('[data-testid="condemn-cancel"]').click();
  await page.waitForTimeout(500);
  saw(!(await page.locator('[data-testid="condemn-reasons"]').isVisible().catch(() => false)), 'Cancel closes it without recording');
  const t0 = await sessionTotal();
  await page.locator('[data-testid="condemn-open"]').click();
  await page.waitForTimeout(600);
  await page.locator('[data-testid="condemn-crack"]').click();   // the reason IS the confirmation — one tap records it
  await page.waitForTimeout(1800);
  await shot('condemned');
  const t1 = await sessionTotal();
  const top = ((await page.locator('[data-testid="my-record-list"] li').allInnerTexts())[0] || '').replace(/\s+/g, ' ');
  saw(/Condemned/i.test(top) && /Crack/.test(top) && !/200/.test(top), `the day's record shows it red, with the reason and no invented height: "${top.slice(0, 100)}"`);
  saw(t1 === t0 + 1, `session total ${t0} → ${t1}, condemned count up by one`);
  saw(!(await has(/Worth a second look/)), 'no "re-measure?" question — nothing was measured');
}

begin('2.7', 'Tick "Photograph springs while sorting"');
{
  await page.locator('[data-testid="toggle-spring-photos"]').click();
  await page.waitForTimeout(2500);
  const video = page.locator('[data-testid="spring-evidence-video"]');
  saw(await video.isVisible().catch(() => false), 'the live camera opens under the tick box');
  const box = await video.boundingBox().catch(() => null);
  saw(Boolean(box) && box.height >= 200, `the picture is large (${box ? Math.round(box.height) : 0} px tall)`);
  saw(await has(/Photographing/i), 'a green "Photographing" badge');
  const learning = page.locator('[data-testid="camera-learning"]');
  saw((await learning.count()) === 1 && !(await learning.evaluate((el) => el.open).catch(() => true)), '"Teach the camera (advanced)" is folded away');
  await shot('camera-on');
  byHand('A real spring in front of the camera; then a hand in front — "person excluded", never "spring 98%". The machine has no spring to show it.');
  await page.locator('[data-testid="toggle-spring-photos"]').click();
  await page.waitForTimeout(800);
}

begin('2.8', 'Bogie type LWLH25');
{
  await page.locator('select').filter({ has: page.locator('option[value="LWLH25"]') }).first().selectOption('LWLH25');
  await page.waitForTimeout(1200);
  await shot('lwlh25');
  const n = await bandButtons().count();
  saw(n === 0, `the six-band strip is gone (${n} band buttons)`);
  saw(await page.locator('[data-testid="free-height-input"]').isVisible().catch(() => false), 'a height is typed instead');
  saw(await has(/309C|G-112|G‑112/), 'the condemning height is cited to WMM §309C / G-112');
  await page.locator('select').filter({ has: page.locator('option[value="LWLH25"]') }).first().selectOption('CASNUB_22_NLB');
  await page.waitForTimeout(800);
}

begin('2.9', 'Hindi toggle on the sorting screen');
{
  await page.locator('button', { hasText: /हिंदी|हिन्दी/ }).first().click();
  await page.waitForTimeout(1200);
  await shot('hindi');
  saw(await has(/स्प्रिंग छँटाई/), 'the screen title is in Hindi');
  const labels = (await bandButtons().allInnerTexts()).map((s) => s.replace(/\s+/g, ' ').trim());
  saw(labels.length === 6 && labels.every((l) => /[ऀ-ॿ]/.test(l)), `band names in Hindi: ${labels.map((l) => l.slice(0, 18)).join(' | ')}`);
  saw(labels.every((l) => /\d{3}/.test(l)), 'the numbers are unchanged');
  await page.locator('button', { hasText: /English|EN/ }).first().click().catch(() => {});
  await page.waitForTimeout(800);
}

begin('2.10', 'Single Spring — free height');
{
  await nav('nav-inspection');
  await shot('single-spring');
  saw(await has(/wagon/i), 'it first asks which wagon and bogie');
  const input = page.locator('input[type="number"]').first();
  saw(await input.isVisible().catch(() => false), 'a Free height box is on the screen');
  const tryHeight = async (v) => { await input.fill(''); await input.fill(v); await page.waitForTimeout(900); return bodyText(); };
  let t = await tryHeight('258.5');
  saw(/Green/i.test(t), '258.5 → Green');
  saw(/Table 28/.test(t), 'Table 28 cited');
  await shot('single-258-5', { full: false });
  t = await tryHeight('244');
  saw(/CONDEMN/i.test(t), '244 → CONDEMNED');
  await shot('single-244', { full: false });
  t = await tryHeight('263.1');
  saw(/CONDEMN|over/i.test(t), '263.1 → over-height, condemned');
  await input.fill('');
  await input.type('abc').catch(() => {});
  await page.waitForTimeout(600);
  const v = await input.inputValue();
  saw(v === '', `"abc" is refused (the box holds "${v}"), no crash`);
}

begin('2.11', 'A wagon → All wagons → WR/BCNHL/40112');
{
  await nav('nav-inspector-home');
  await chooseWagon();
  await shot('choose-wagon');
  await page.getByRole('button', { name: /All wagons/i }).first().click().catch(() => {});
  await page.waitForTimeout(1200);
  await shot('all-wagons');
  saw(await has(/ENTRY|INSPECTION|REPAIR|RELEASE|stage/i), 'the wagons in the shop, each with its stage');
  await page.fill('#wagon-manual', 'WR/BCNHL/40112');
  await page.locator('#wagon-manual').press('Enter');
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /^(Continue checklist|Open checklist|Start checklist)/i }).first().click().catch(() => {});
  await page.waitForTimeout(1500);
  saw(await has(/WR\/BCNHL\/40112/), 'WR/BCNHL/40112 opens');
  await shot('40112-open');
}

begin('2.12', 'Wagon → Checklist');
{
  await wagonTab('Checklist');
  await shot('40112-checklist');
  const t = await bodyText();
  saw(/PASS/.test(t) && /FAIL/.test(t) && /CONDEMNED/.test(t) && /REPAIRED/.test(t) && /REPLACED/.test(t), 'Pass · Fail · Condemned · Repaired · Replaced per item');
  saw(/Spring|Bogie|Brake|Wheel/i.test(t), 'category tabs');
}

begin('2.13', 'Wagon → Photos');
{
  await wagonTab('Photos');
  await shot('40112-photos');
  const frames = page.locator('[data-testid^="pocket-frame-BOGIE"]');
  saw((await frames.count()) === 4, `four frames (${await frames.count()})`);
  const b1a = (await page.locator('[data-testid="pocket-frame-BOGIE_1-SIDE_A"]').innerText().catch(() => '')).replace(/\s+/g, ' ');
  saw(/agree/i.test(b1a), `Bogie 1·A: "${b1a.slice(0, 100)}"`);
  const b2b = (await page.locator('[data-testid="pocket-frame-BOGIE_2-SIDE_B"]').innerText().catch(() => '')).replace(/\s+/g, ' ');
  saw(/blind recount/i.test(b2b) && !/\b6 of 7\b|short/i.test(b2b), `Bogie 2·B: "${b2b.slice(0, 100)}" — no figures`);
  await page.locator('[data-testid="pocket-open-BOGIE_2-SIDE_B"]').click();
  await page.waitForTimeout(1500);
  await shot('40112-counter');
  const counter = (await page.locator('[data-testid="pocket-counter"]').innerText().catch(() => '')).replace(/\s+/g, ' ');
  saw(counter.length > 0 && !/expected|should be|\b7\b/i.test(counter), 'the counter does not show the expected number');
  await page.locator('[data-testid="pocket-close"]').click().catch(() => {});
}

begin('2.14', 'Wagon → Parts');
{
  await wagonTab('Parts');
  await shot('40112-parts');
  const t = await bodyText();
  saw(/Parts in, parts out/.test(t), '"Parts in, parts out"');
  saw(/\d+ off · \d+ back on/.test(t), `the ledger balance: "${(t.match(/\d+ off · \d+ back on[^.]*/) || [''])[0]}"`);
  for (const b of ['Came off', 'Went back on', 'Replaced with new', 'Scrapped', 'Not being refitted']) saw(await page.getByRole('button', { name: b, exact: true }).first().isVisible().catch(() => false), `the "${b}" button`);
  saw(await has(/Category/) && await has(/Position/) && await has(/How many/), 'Category, Position, Part, How many — then "Record: …"');
  await page.locator('text=Show every entry').first().click().catch(() => {});
  await page.waitForTimeout(600);
  saw(await has(/Crack at the second coil/), 'the replaced spring is in the list with its reason');
  saw(!(await has(/more went back on than were recorded coming off/)), 'no position has more back on than came off');
}

begin('2.15', 'Wagon → Air-brake test');
{
  await wagonTab('Air-brake test');
  await shot('40112-swt');
  const rows = await page.locator('table tbody tr').count();
  saw(rows === 14, `the proforma has ${rows} rows (12 readings, 2 yes/no)`);
  saw(await has(/720-C|WMM/), 'headed WMM 2.0 §720-C');
  const first = page.locator('table tbody input').first();
  await first.fill('3.2');
  await page.waitForTimeout(500);
  saw(await first.evaluate((el) => /bad/.test(el.className)), '3.2 in "Pressure in BP" (4.9–5.1) turns the box red as you type');
  await first.fill('');
  saw(await page.getByRole('button', { name: 'Not', exact: true }).first().isVisible(), 'the "Not" button on a yes/no row is fully on screen');
}

begin('2.16', 'Wagon → Timeline');
{
  await wagonTab('Timeline');
  await shot('40112-timeline');
  const t = await bodyText();
  saw(/ENTRY|Entry|INSPECTION|Inspection/.test(t), 'stages listed');
  saw(/\d{1,2} [A-Z][a-z]{2} \d{4}|\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4}/.test(t), 'with dates');
}

begin('2.17', 'SER/BOXNHL/30914 → Checklist → Wheels → tap a wheel → 917');
{
  await openWagonFromHome('SER/BOXNHL/30914');
  saw(await has(/SER\/BOXNHL\/30914/), 'SER/BOXNHL/30914 opens');
  await wagonTab('Checklist');
  await page.locator('[data-testid="wheel-readings"]').scrollIntoViewIfNeeded().catch(() => {});
  await shot('30914-wheels');
  await page.locator('[data-testid="wheel-1L"]').click();
  await page.waitForTimeout(800);
  const box = page.locator('[data-testid="wheel-treadDiameterMm"]');
  saw(await box.isVisible(), 'one large box for the tread diameter');
  await box.fill('917');
  await page.waitForTimeout(900);
  const live = (await page.locator('[data-testid="wheel-live"]').innerText().catch(() => '')).replace(/\s+/g, ' ');
  saw(/below/i.test(live) && /919/.test(live) && /906/.test(live), `917 → "${live.slice(0, 140)}"`);
  saw(await has(/WD-88089|Ch\.6|IRCA/), 'the drawing and rule are cited beneath');
  const opt = page.locator('details', { hasText: /optional/i }).first();
  saw((await opt.count()) > 0 && !(await opt.evaluate((el) => el.open).catch(() => true)), 'flange figures are folded under "optional"');
  await shot('30914-wheel-917', { full: false });
  await page.keyboard.press('Escape').catch(() => {});
}

begin('2.18', 'Read a wagon number with the camera');
{
  await nav('nav-inspector-home');
  await chooseWagon();
  await page.getByRole('button', { name: /All wagons/i }).first().click().catch(() => {});
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /Read the number painted on the wagon/i }).first().click();
  await page.waitForTimeout(2500);
  await shot('number-camera');
  saw(await page.locator('video').first().isVisible().catch(() => false), 'the camera opens');
  saw(await has(/confirm|correct|number/i), 'it will propose the text for you to confirm or correct');
  byHand('Point at a printed wagon number. It proposes the text; you confirm or correct it. It never records what you did not confirm. The machine has no painted number to show it.');
  await page.locator('button', { hasText: '✕' }).first().click().catch(() => {});   // close the camera
  await page.waitForTimeout(500);
  await page.locator('button', { hasText: /^(Close|Cancel|✕)$/ }).first().click().catch(() => {});   // close the picker
  await page.waitForTimeout(500);
}

begin('2.19', 'Manual');
{
  await nav('nav-manual');
  const q = page.locator('form input').first();
  await q.fill('brake block condemning limit');
  await q.press('Enter');
  await page.waitForTimeout(3500);
  await shot('manual-brake-block');
  let t = await bodyText();
  saw(/ANSWER — IN THE DOCUMENT'S OWN WORDS|IN THE DOCUMENT/i.test(t), '"Answer — in the document\'s own words"');
  saw(/Source:/i.test(t), 'a Source line beneath it');
  saw(/ALSO IN/i.test(t), 'more under "Also in"');
  await q.fill('wheel diameter variation same axle bogie');
  await q.press('Enter');
  await page.waitForTimeout(3500);
  t = await bodyText();
  saw(/IRCA/i.test(t), 'IRCA Part III named for the wheel question');
  await shot('manual-irca');
}

begin('2.20', 'Wi-Fi off → sort three springs → Wi-Fi on');
{
  const my0 = await api('GET', `/sorting/mine?date=${new Date().toISOString().slice(0, 10)}`, null, token);
  const n0 = (my0.body?.data?.records || my0.body?.data || []).length;
  await nav('nav-spring-sorting');
  await ctx.setOffline(true);
  await page.waitForTimeout(1000);
  const t0 = await sessionTotal();
  for (let i = 0; i < 3; i++) { await bandButtons().nth(i).click(); await page.waitForTimeout(900); }
  await shot('offline-three');
  saw((await sessionTotal()) === t0 + 3, 'three springs sort with no network');
  const banner = (await page.locator('[data-testid="pending-sync-banner"]').innerText().catch(() => '')).replace(/\s+/g, ' ');
  saw(/3|queued|pending|waiting/i.test(banner), `the queued count shows: "${banner.slice(0, 100)}"`);
  await ctx.setOffline(false);
  let settled = false;
  for (let i = 0; i < 30 && !settled; i++) { await page.waitForTimeout(2000); settled = !(await page.locator('[data-testid="pending-sync-banner"]').isVisible().catch(() => false)); }
  saw(settled, 'the queue empties once the network is back');
  await page.waitForTimeout(1500);
  const my1 = await api('GET', `/sorting/mine?date=${new Date().toISOString().slice(0, 10)}`, null, token);
  const n1 = (my1.body?.data?.records || my1.body?.data || []).length;
  saw(n1 === n0 + 3, `exactly three more in the records (${n0} → ${n1}), no duplicates`);
  await shot('back-online');
}

begin('2.21', 'Type the DRM dashboard or Audit address by hand');
{
  const d = await api('GET', '/analytics/tat', null, token);
  const a = await api('GET', '/audit/verify', null, token);
  saw(d.status === 403, `the DRM's analytics answer ${d.status} (refused) to an inspector's token`);
  saw(a.status === 403, `the audit data answers ${a.status} (refused) to an inspector's token`);
  await page.goto(`${BASE}/dashboard`);
  await page.waitForTimeout(2000);
  await shot('typed-dashboard');
  saw(!(await has(/Shop Floor — Right Now|DRM Dashboard/)), 'the inspector still sees only the inspector\'s screens');
}

begin('2.22', 'Sign out');
{
  // On a phone the sign-out is the red "Logout" in the navigation bar; the header's own button is hidden there.
  await page.getByRole('button', { name: /Logout|Sign out|लॉग आउट/ }).filter({ visible: true }).first().click();
  await page.waitForTimeout(1500);
  saw(await page.locator('input[type="password"]').isVisible().catch(() => false), 'the sign-in page');
  await page.goBack().catch(() => {});
  await page.waitForTimeout(1200);
  saw(await page.locator('input[type="password"]').isVisible().catch(() => false), 'the back button does not reopen a signed-in screen');
  await shot('signed-out', { full: false });
}

await browser.close();
const result = { base: BASE, startedAt, finishedAt: new Date().toISOString(), steps, consoleErrors };
writeFileSync(join(OUT, 'result.json'), JSON.stringify(result, null, 2));
const failed = steps.filter((s) => !s.ok);
console.log(`\n${steps.length - failed.length} of ${steps.length} steps matched${failed.length ? `; did not match: ${failed.map((s) => s.num).join(', ')}` : ''}`);
if (consoleErrors.length) console.log('page errors:', consoleErrors);
process.exit(failed.length ? 1 : 0);
