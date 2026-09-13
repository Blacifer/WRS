#!/usr/bin/env node
/**
 * A wagon part passed by the camera with no tap — and refused where it must be
 * Indian Railways WRS Raipur
 *
 * The wagon half of auto-sort-drive.mjs, through the real checklist screen:
 *
 *   1. Untaught, the judge asks on every part.
 *   2. Taught through the judge itself — the inspector confirming clean parts
 *      and TEACHING (not recording) rusted and cracked ones — it earns the
 *      SURFACE and DAMAGE heads. One wagon has 43 items; earning takes more
 *      judgements than that, so the drive moves through wagons the way a
 *      shop does.
 *   3. Earned, a clean part is marked PASS with no tap, the row says
 *      CAMERA_AUTO, and a photograph is attached to it.
 *   4. A rusted part still asks, and the judge will not record it: a FAIL is
 *      a person's verdict with a reason.
 *
 * Drawn parts, stamped, refuses a real database. Deliberate run:
 *
 *   node scripts/auto-judge-drive.mjs
 */

import { chromium } from 'playwright';

const BASE = process.env.APP_URL || 'http://localhost:4173';
const SYNTHETIC_MARK = 'SYNTHETIC_DRIVE';
const TEACH_CAP = Number(process.env.TEACH_CAP || 160);

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ permissions: ['camera'] });
const page = await ctx.newPage();
const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
const failedCalls = [];
page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) failedCalls.push(`${r.status()} ${r.url()}`); });
await page.route('**/api/vision/brain/teach', (route) => {
  let body = {}; try { body = JSON.parse(route.request().postData() || '{}'); } catch { /* */ }
  return route.continue({ postData: JSON.stringify({ ...body, partName: SYNTHETIC_MARK }) });
});

console.log('Signing in...');
await page.goto(BASE);
await page.fill('input[type="text"]', 'inspector1');
await page.fill('input[type="password"]', 'password123');
await page.click('button[type="submit"]');
await page.waitForTimeout(2500);

const guard = await page.evaluate(async () => {
  const r = await fetch('/api/vision/brain?domain=WAGON_PART', { headers: { authorization: `Bearer ${localStorage.getItem('wrs_token')}` } });
  const ex = (await r.json().catch(() => null))?.data?.examples || [];
  return ex.filter((e) => e.partName !== 'SYNTHETIC_DRIVE').length;
});
if (guard > 0 && process.env.TEACH_DRIVE_ALLOW_REAL_DB !== '1') { console.error(`REFUSING TO RUN: ${guard} real wagon-part teaching(s).`); process.exit(2); }

// A drawn part. Installed after every page load, since a reload loses it.
async function installPart() {
  await page.evaluate(() => {
    let seed = 7171 + Math.floor(Math.random() * 1000);
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const c = document.createElement('canvas'); c.width = c.height = 480;
    window.__part = { canvas: c, draw(opts = {}) {
      const g = c.getContext('2d');
      const bg = 80 + rnd() * 90; g.fillStyle = `rgb(${bg},${bg - 5},${bg - 10})`; g.fillRect(0, 0, 480, 480);
      for (let i = 0; i < 6; i++) { g.fillStyle = `rgba(${rnd()*255|0},${rnd()*255|0},${rnd()*255|0},0.25)`; g.fillRect(rnd()*480, rnd()*480, 30 + rnd()*80, 30 + rnd()*80); }
      g.save(); g.translate(240, 240); g.rotate((rnd() - 0.5) * 0.4); const s = 0.85 + rnd() * 0.3; g.scale(s, s);
      const rust = !!opts.rust;
      g.fillStyle = rust ? '#8a5a30' : '#7c8088'; g.fillRect(-120, -150, 240, 300);
      g.strokeStyle = rust ? '#5c3720' : '#4e5157'; g.lineWidth = 14; g.strokeRect(-120, -150, 240, 300);
      g.fillStyle = rust ? '#b8763c' : '#c2c6cc'; g.beginPath(); g.arc(0, 0, 55, 0, Math.PI * 2); g.fill();
      if (opts.crack) { g.strokeStyle = '#0a0a0a'; g.lineWidth = 5; g.beginPath(); g.moveTo(-125, -40); g.lineTo(125, 30); g.stroke(); g.beginPath(); g.moveTo(-100, 60); g.lineTo(110, -70); g.stroke(); }
      g.restore();
    } };
  });
}

let wagonsUsed = 0;
let WAGON = '';
async function openFreshWagon() {
  const wagonNumber = `SECR/BOXNHL/${70000 + Math.floor(Math.random() * 9000)}`;
  const st = await page.evaluate(async ({ wagonNumber }) => {
    const r = await fetch('/api/wagons/register', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${localStorage.getItem('wrs_token')}` }, body: JSON.stringify({ wagonNumber, wagonType: 'BOXNHL', owningRailway: 'SECR' }) });
    return r.status;
  }, { wagonNumber });
  if (st >= 400) { console.error(`register: ${st}`); process.exit(1); }
  wagonsUsed++;
  WAGON = wagonNumber;
  await page.goto(BASE);
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: /A wagon/i }).first().click();
  await page.waitForTimeout(2500);
  const row = page.getByText(wagonNumber, { exact: true }).first();
  await row.waitFor({ timeout: 10000 }); await row.click();
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: /Continue checklist/i }).first().click();
  await page.waitForTimeout(3000);
  await installPart();
}

/** The next PENDING item's Judge button, looking across every category tab. */
async function nextJudgeButton() {
  const direct = page.locator('[data-testid^="judge-part-"]').first();
  if (await direct.count()) return direct;
  const tabs = page.locator('[data-testid^="category-tab-"]');
  const n = await tabs.count();
  for (let i = 0; i < n; i++) {
    await tabs.nth(i).click();
    await page.waitForTimeout(250);
    const b = page.locator('[data-testid^="judge-part-"]').first();
    if (await b.count()) return b;
  }
  return null;
}

/** Open the judge on the next PENDING item, point the camera at a drawn part, look. */
async function judgeNext(opts = {}) {
  let btn = await nextJudgeButton();
  if (!btn) { await openFreshWagon(); btn = await nextJudgeButton(); }
  if (!btn) return null;
  await btn.click();
  await page.locator('[data-testid="auto-judge-part"]').waitFor({ timeout: 15000 });
  await page.waitForFunction(() => { const b = document.querySelector('[data-testid="auto-judge-look"]'); return b && !b.disabled; }, { timeout: 30000 });
  await page.evaluate((opts) => {
    window.__part.draw(opts);
    const v = document.querySelector('[data-testid="auto-judge-part"] video');
    v.srcObject = window.__part.canvas.captureStream(10);
    return v.play().catch(() => {});
  }, opts);
  await page.waitForFunction(() => { const v = document.querySelector('[data-testid="auto-judge-part"] video'); return v && v.videoWidth > 0 && v.readyState >= 2; }, { timeout: 30000 });
  await page.click('[data-testid="auto-judge-look"]');
  await page.waitForFunction(() => !!document.querySelector('[data-testid="auto-judge-decision"]') || !!document.querySelector('[data-testid="auto-judge-done"]'), { timeout: 180000 });
  await page.waitForTimeout(400);
  const done = await page.locator('[data-testid="auto-judge-done"]').count();
  const text = done ? (await page.locator('[data-testid="auto-judge-done"]').innerText()).trim() : (await page.locator('[data-testid="auto-judge-decision"]').innerText()).trim();
  const asked = !!(await page.locator('[data-testid="auto-judge-ask"]').count());
  return { auto: /no tap/i.test(text) && !!done, asked, text };
}

async function closeModal() {
  const done = page.locator('[data-testid="auto-judge-part"] button', { hasText: /^Close$|बंद/ });
  if (await done.count()) { await done.last().click(); await page.waitForTimeout(500); return; }
  const x = page.locator('[data-testid="auto-judge-part"] button[aria-label="Close"]');
  if (await x.count()) { await x.click(); await page.waitForTimeout(400); }
}

async function answerAndClose(surface, damage) {
  await page.click(`[data-testid="auto-judge-SURFACE-${surface}"]`);
  await page.click(`[data-testid="auto-judge-DAMAGE-${damage}"]`);
  const teach = page.locator('[data-testid="auto-judge-teach"]');
  if (await teach.count()) await teach.click(); else await page.click('[data-testid="auto-judge-confirm"]');
  await page.locator('[data-testid="auto-judge-done"]').waitFor({ timeout: 60000 });
  await closeModal();
}

await openFreshWagon();

// 1. Untaught.
const first = await judgeNext({});
console.log(`\n1. First part, camera untaught: ${first.asked ? 'ASKED' : first.auto ? 'auto-passed' : 'no decision'}`);
console.log(`   "${(first.text.split('\n')[1] || first.text).slice(0, 120)}"`);
if (!first.asked) { console.error('   FAIL — an untaught camera must ask.'); process.exit(1); }
await answerAndClose('CLEAN', 'NONE');

// 2. Teach through the judge until earned, across as many wagons as it takes.
let placed = 1;
let status = [];
for (;;) {
  status = await page.evaluate(async () => {
    const r = await fetch('/api/vision/auto/status?domain=WAGON_PART', { headers: { authorization: `Bearer ${localStorage.getItem('wrs_token')}` } });
    return (await r.json()).data.heads.filter((h) => h.head === 'SURFACE' || h.head === 'DAMAGE');
  });
  if (status.every((h) => h.allowed) || placed >= TEACH_CAP) break;
  const rust = placed % 3 === 1, crack = placed % 3 === 2;
  const r = await judgeNext({ rust, crack });
  if (!r) { console.log('   could not open another item'); break; }
  if (r.asked) await answerAndClose(rust ? 'HEAVY_RUST' : 'CLEAN', crack ? 'CRACK' : 'NONE');
  else await closeModal();
  placed++;
  if (placed % 12 === 0) process.stdout.write(`   ${placed} judged across ${wagonsUsed} wagon(s) · ${status.map((h) => `${h.head.toLowerCase()} ${h.rate == null ? `${h.sampled}/30` : `${Math.round(h.rate * 100)}%`}`).join(' · ')}\n`);
}
console.log(`\n2. After ${placed} parts on ${wagonsUsed} wagon(s): ${status.map((h) => `${h.head.toLowerCase()} ${h.allowed ? 'EARNED' : 'not yet'} (${h.reason})`).join('; ')}`);

// 3. Earned: a clean part passes with no tap, photo attached, row says CAMERA_AUTO.
const clean = await judgeNext({});
console.log(`\n3. A clean part: ${clean?.auto ? 'PASSED WITH NO TAP' : clean?.asked ? 'asked' : 'no decision'}`);
console.log(`   "${(clean?.text || '').split('\n')[0].slice(0, 120)}"`);
if (clean?.asked) await answerAndClose('CLEAN', 'NONE'); else await closeModal();
await page.waitForTimeout(800);

const rows = await page.evaluate(async ({ wagonNumber }) => {
  const r = await fetch(`/api/wagons/${wagonNumber}/checklist`, { headers: { authorization: `Bearer ${localStorage.getItem('wrs_token')}` } });
  const items = (await r.json()).data.allItems || [];
  const auto = items.filter((i) => i.verdictSource === 'CAMERA_AUTO');
  return { auto: auto.length, withPhoto: auto.filter((i) => i.photoId).length, status: auto.map((i) => i.status) };
}, { wagonNumber: WAGON });
console.log(`   On ${WAGON}: rows marked CAMERA_AUTO: ${rows.auto}, with a photograph attached: ${rows.withPhoto}, statuses: ${[...new Set(rows.status)].join(',') || '-'}`);

// 4. A fault still asks and cannot be passed here.
const rusted = await judgeNext({ rust: true });
console.log(`\n4. A heavily rusted part: ${rusted?.asked ? 'ASKED' : rusted?.auto ? 'auto-passed' : 'no decision'}`);
console.log(`   "${((rusted?.text || '').split('\n')[1] || rusted?.text || '').slice(0, 120)}"`);
const recordOffered = rusted?.asked ? await page.locator('[data-testid="auto-judge-confirm"]').count() : 0;
const teachOffered = rusted?.asked ? await page.locator('[data-testid="auto-judge-teach"]').count() : 0;
console.log(`   "Record PASS" offered: ${recordOffered ? 'YES — wrong' : 'no'} · "Teach the camera" offered: ${teachOffered ? 'yes' : 'no'}`);
await closeModal();

await browser.close();
console.log(`\nConsole errors:    ${consoleErrors.length ? consoleErrors.join('\n  ') : 'none'}`);
console.log(`Failed API calls:  ${failedCalls.length ? failedCalls.join('\n  ') : 'none'}`);
const ok = first.asked && !!clean?.auto && rows.auto >= 1 && rows.withPhoto >= 1 && rows.status.every((s) => s === 'PASS') && !!rusted?.asked && !recordOffered && !!teachOffered && consoleErrors.length === 0 && failedCalls.length === 0;
console.log(ok ? '\nPASS — untaught it asks; earned it passes a clean part with no tap and a photograph; a rusted part is asked about and cannot be passed here.' : '\nFAIL — see above.');
process.exit(ok ? 0 : 1);
