#!/usr/bin/env node
/**
 * Demo day, rehearsed — the DEMO_DAY.md walk, step by step, on the built bundle
 * Indian Railways WRS Raipur
 *
 * docs/DEMO_DAY.md makes specific claims: three tiles show figures, four
 * frames carry pocket counts and one is short, a wagon is blocked by a named
 * wheel pair at 917.5 mm, a gauge reads high and the drift check finds it,
 * the chain verifies, the certificate verifies with no server, the shadow
 * week holds the one line that decides go-live. Every other drive checks
 * that screens render. This one checks that what the person in the room
 * will say is what the screen will show — in the order they will say it,
 * signed in as the accounts they will use, on the bundle that will be on
 * the PC, seeded by DEMO-DATA.cmd's exact command.
 *
 * It photographs every step into an output directory so the pictures can be
 * read afterwards, and it fails on the first claim the screen does not back.
 *
 *   APP_URL=https://localhost:3200 node scripts/demo-day-drill.mjs [outDir]
 *
 * scripts/demo-day.sh packages the bundle, seeds it the way DEMO-DATA.cmd
 * does, starts it the way START.cmd does, and runs this.
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.APP_URL || 'https://localhost:3200';
const OUT = process.argv[2] || 'demo-rehearsal';
mkdirSync(OUT, { recursive: true });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const problems = [];
const check = (ok, what) => { console.log(`${ok ? '  ✓' : '  ✗'} ${what}`); if (!ok) problems.push(what); return ok; };
const api = async (method, p, body, token) => {
  const r = await fetch(`${BASE}/api${p}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null), text: null };
};

const browser = await chromium.launch();
const consoleErrors = []; const failedCalls = [];
let page; let ctx; let shotN = 0;

async function open(width, height) {
  if (ctx) await ctx.close();
  ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width, height } });
  page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && !/SSL certificate error|ERR_CERT/.test(m.text()) && consoleErrors.push(m.text().slice(0, 160)));
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 160)}`));
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400 && !/auth\/login/.test(r.url())) failedCalls.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, '')}`); });
}
async function shot(name) {
  await page.waitForTimeout(1200);
  shotN++;
  await page.screenshot({ path: join(OUT, `${String(shotN).padStart(2, '0')}-${name}.png`), fullPage: true });
}
async function signIn(user, width = 1280, height = 900) {
  await open(width, height);
  await page.goto(BASE);
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('wrs_lang', 'en'); });
  await page.goto(BASE);
  await page.fill('input[type="text"]', user);
  await page.fill('input[type="password"]', 'password123');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);
  const token = await page.evaluate(() => localStorage.getItem('wrs_token'));
  check(Boolean(token), `${user} signs in`);
  return token;
}
const bodyText = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ');
async function openWagon(number, tabLabel) {
  await page.locator('[data-testid="nav-wagons"]').first().click();
  await page.waitForTimeout(1500);
  await page.locator(`text=${number}`).first().click();
  await page.waitForTimeout(2000);
  if (tabLabel) {
    await page.locator('[data-testid="wagon-tabs"] button', { hasText: tabLabel }).first().click();
    await page.waitForTimeout(2000);
  }
}

// ---------------------------------------------------------------------------
console.log('The evening before, step 4: the DRM dashboard shows figures, not "Not yet known"');
await signIn('drm1');
await page.locator('[data-testid="nav-dashboard"]').first().click().catch(() => {});
await page.waitForTimeout(3000);
await shot('drm-dashboard');
{
  const t = await bodyText();
  check(/Shop Floor — Right Now/.test(t), 'the "Shop Floor — Right Now" section is on the dashboard');
  const now = await page.locator('text=Shop Floor — Right Now').first().locator('xpath=ancestor::section[1]').innerText().catch(() => '');
  check(!/Not yet known/.test(now), `no tile under it says "Not yet known"${/Not yet known/.test(now) ? ' — the seed did not run' : ''}`);
}

// ---------------------------------------------------------------------------
console.log('\nWalk 1: the sorting bench — three springs by tapping the band, undo one, the gauge named, SSG-02 without a calibration date');
await signIn('inspector1', 820, 1100);
await page.locator('[data-testid="nav-spring-sorting"]').first().click();
await page.waitForTimeout(2000);
await shot('bench-before');
{
  const total0 = Number((await page.locator('[data-testid="session-total"]').innerText().catch(() => '0')).replace(/\D/g, '') || 0);
  const bands = page.locator('button[style*="background-color"]');
  const n = await bands.count();
  check(n >= 3, `the strip shows ${n} band buttons`);
  for (let i = 0; i < 3; i++) { await bands.nth(i % n).click(); await page.waitForTimeout(900); }
  await shot('bench-three-sorted');
  const total3 = Number((await page.locator('[data-testid="session-total"]').innerText()).replace(/\D/g, ''));
  check(total3 === total0 + 3, `three taps: the session total went ${total0} → ${total3}`);
  await page.locator('[data-testid="undo-last-spring"]').click();
  await page.waitForTimeout(1200);
  await shot('bench-undone');
  const total2 = Number((await page.locator('[data-testid="session-total"]').innerText()).replace(/\D/g, ''));
  check(total2 === total0 + 2, `undo: the session total is ${total2}`);
  check(await page.locator('[data-testid="gauge-picker"]').isVisible(), 'the gauge picker is on the bench');
  const opts = await page.locator('[data-testid="gauge-select"] option').allInnerTexts().catch(() => []);
  check(opts.some((o) => /OSG-01/.test(o)), `the gauges are named on the bench (${opts.filter((o) => /SG-/.test(o)).join(', ')})`);
  await page.locator('label:has-text("Spring position") + select, select').filter({ has: page.locator('option[value="SNUBBER"]') }).first().selectOption('SNUBBER').catch(() => {});
  await page.waitForTimeout(800);
  await page.locator('[data-testid="gauge-select"]').selectOption({ label: (await page.locator('[data-testid="gauge-select"] option').allInnerTexts()).find((o) => /SSG-02/.test(o)) || '' }).catch(() => {});
  await page.waitForTimeout(800);
  await shot('bench-ssg-02');
  const warn = await page.locator('[data-testid="gauge-calibration-warning"]').innerText().catch(() => '');
  check(/SSG-02|calibrat/i.test(warn), `SSG-02 carries the amber calibration note: "${warn.slice(0, 90)}"`);
}

// ---------------------------------------------------------------------------
console.log('\nWalk 2: WR/BCNHL/40112 → Photos — four frames with pocket counts, Bogie 2 · Side B short one; the counter hides the expected number');
{
  await page.locator('[data-testid="nav-inspector-home"]').first().click();
  await page.waitForTimeout(1500);
  await page.locator('[data-testid="choose-wagon"]').first().click();
  await page.waitForTimeout(1800);
  await shot('inspector-wagon-picker');
  const listed = await page.locator('text=WR/BCNHL/40112').first().isVisible().catch(() => false);
  if (listed) {
    await page.locator('text=WR/BCNHL/40112').first().click();
  } else {
    // The landing shows the eight most recent; the person opens "All wagons" and types the number.
    console.log('    (WR/BCNHL/40112 is not among the recent eight — "All wagons", then typing it)');
    await page.getByRole('button', { name: /All wagons/i }).first().click();
    await page.waitForTimeout(1200);
    await shot('inspector-all-wagons');
    const inList = await page.locator('text=WR/BCNHL/40112').first().isVisible().catch(() => false);
    if (inList) { await page.locator('text=WR/BCNHL/40112').first().click(); await page.waitForTimeout(1500); }
    await page.fill('#wagon-manual', 'WR/BCNHL/40112');
    await page.locator('#wagon-manual').press('Enter');
  }
  await page.waitForTimeout(2000);
  await shot('inspector-wagon-selected');
  await page.getByRole('button', { name: /Continue checklist|Open checklist|Checklist/i }).first().click().catch(() => {});
  await page.waitForTimeout(1500);
  check(/WR\/BCNHL\/40112/.test(await bodyText()), 'the wagon WR/BCNHL/40112 is open');
  await page.locator('[data-testid="wagon-tabs"] button', { hasText: 'Photos' }).first().click();
  await page.waitForTimeout(2500);
  await shot('40112-photos');
  const frames = page.locator('[data-testid^="pocket-frame-BOGIE"]');
  const nFrames = await frames.count();
  check(nFrames === 4, `four assembly frames are listed (${nFrames})`);
  const b2b = (await page.locator('[data-testid="pocket-frame-BOGIE_2-SIDE_B"]').innerText().catch(() => '')).replace(/\s+/g, ' ');
  // An inspector sees the first count blind: no figures, no verdict, until a second person has recounted.
  check(/blind recount/i.test(b2b) && !/short/i.test(b2b), `to the inspector, Bogie 2 · Side B shows no figures — a blind recount is asked for: "${b2b.slice(0, 110)}"`);
  const b1a = (await page.locator('[data-testid="pocket-frame-BOGIE_1-SIDE_A"]').innerText().catch(() => '')).replace(/\s+/g, ' ');
  check(/agree/i.test(b1a), `Bogie 1 · Side A, counted by two people, shows both counts agree: "${b1a.slice(0, 110)}"`);
  await page.locator('[data-testid="pocket-open-BOGIE_2-SIDE_B"]').click();
  await page.waitForTimeout(1500);
  await shot('40112-pocket-counter');
  const counter = (await page.locator('[data-testid="pocket-counter"]').innerText().catch(() => '')).replace(/\s+/g, ' ');
  check(counter.length > 0, 'the pocket counter opens on the frame');
  check(!/expected|अपेक्षित|should be|\b7\b/i.test(counter), 'the expected number is not on the counter — the person counts what is in the photograph');
  await page.locator('[data-testid="pocket-close"]').click().catch(() => {});
}

// ---------------------------------------------------------------------------
console.log('\nWalk 3: supervisor1 — the short count waits as an advisory; SER/BOXNHL/30914 blocked by a condemned spring and the axle-3 wheel pair at 917.5 mm');
const sup = await signIn('supervisor1');
{
  await openWagon('WR/BCNHL/40112', 'Photos');
  await shot('40112-photos-supervisor');
  const sb2b = (await page.locator('[data-testid="pocket-frame-BOGIE_2-SIDE_B"]').innerText().catch(() => '')).replace(/\s+/g, ' ');
  check(/6 of 7 outer/i.test(sb2b) && /pocket may be empty/i.test(sb2b), `to the supervisor, Bogie 2 · Side B is short one outer spring: "${sb2b.slice(0, 120)}"`);
  await page.locator('[data-testid="wagon-tabs"] button', { hasText: 'Release checks' }).first().click();
  await page.waitForTimeout(2000);
  await shot('40112-release-checks');
  const gate40112 = await api('GET', '/wagons/WR%2FBCNHL%2F40112/gate/status', null, sup);
  const adv = gate40112.body?.data?.advisories || [];
  check(adv.some((a) => /Bogie 2 Side B/i.test(a) && /fell short/i.test(a)), `the short count waits at the release checks as an advisory, by name: ${adv.find((a) => /Bogie 2/i.test(a)) || '(missing)'}`);
  check(/Bogie 2 Side B/i.test(await bodyText()), 'and it is on the screen');
  await openWagon('SER/BOXNHL/30914', 'Release checks');
  await shot('30914-release-checks');
  const gate = await api('GET', '/wagons/SER%2FBOXNHL%2F30914/gate/status', null, sup);
  const blockers = gate.body?.data?.blockers || [];
  check(blockers.some((b) => /condemn/i.test(b)), `blocked by a condemned spring: ${blockers.find((b) => /condemn/i.test(b)) || '(missing)'}`);
  const wheel = blockers.find((b) => /917\.5/.test(b));
  check(Boolean(wheel) && /919/.test(wheel), `blocked by the axle-3 pair at 917.5 below 919: ${wheel || '(missing)'}`);
  const onScreen = await bodyText();
  check(/917\.5/.test(onScreen) && /919/.test(onScreen), 'both figures are on the screen');
  await page.locator('[data-testid="wagon-tabs"] button', { hasText: 'Checklist' }).first().click();
  await page.waitForTimeout(2000);
  const wheels = page.locator('[data-testid="wheel-readings"]');
  await wheels.scrollIntoViewIfNeeded().catch(() => {});
  await shot('30914-checklist-wheels');
  const wt = await wheels.innerText().catch(() => '');
  check(/what the gauge read/i.test(wt), '"Wheels — what the gauge read" is on the checklist tab');
  check(/917\.5/.test(wt) && /919/.test(wt) && /WD-97037|S-01/.test(wt), 'the chalk figures, the limit and the drawing number are beside each other');
}

// ---------------------------------------------------------------------------
console.log('\nWalk 4: Ask the Records — two questions, "How this was computed", OSG-02 reads high');
{
  await page.locator('[data-testid="nav-ask"]').first().click();
  await page.waitForTimeout(1500);
  const ask = async (q) => {
    await page.fill('[data-testid="ask-input"]', q);
    await page.locator('[data-testid="ask-submit"]').click();
    await page.locator('[data-testid="ask-answer"], [data-testid="ask-no-answer"]').first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(800);
    return page.locator('[data-testid="ask-page"]').innerText();
  };
  const a1 = await ask('which wagon type condemns the most snubbers this quarter');
  await shot('ask-snubbers');
  check(/BOXN|BCN|BOST|BOBR|BOXNHL/.test(a1) && /out of|of \d+|n ?=/i.test(a1), 'the snubber answer names a wagon type and carries its count');
  await page.locator('[data-testid="ask-how"]').first().click().catch(() => {});
  await page.waitForTimeout(800);
  await shot('ask-snubbers-how');
  check(/SELECT|select/.test(await page.locator('[data-testid="ask-page"]').innerText()), '"How this was computed" shows the query');
  const a2 = await ask('is any gauge reading high');
  await shot('ask-gauge-high');
  check(/OSG-02/.test(a2), `the drift check finds OSG-02: ${(a2.match(/OSG-02[^.]{0,80}/) || [''])[0]}`);
}

// ---------------------------------------------------------------------------
console.log('\nWalk 5: drm1 — the four dashboard questions with n, then Spring Analytics against the standard');
await signIn('drm1');
{
  await page.locator('[data-testid="nav-dashboard"]').first().click();
  await page.waitForTimeout(3000);
  const t = await bodyText();
  check(/pile|finish/i.test(t), '"When does today\'s pile finish" is on the dashboard');
  check(/bogies/i.test(t) && /build/i.test(t), '"how many bogies can we build" is on the dashboard');
  check(/wait/i.test(t), '"where wagons wait" is on the dashboard');
  check(/keeps coming back|coming back/i.test(t), '"what keeps coming back" is on the dashboard');
  check((t.match(/\bn\s*=\s*\d+|\bof \d+\b|\(\d+\)/g) || []).length >= 4, 'the figures carry their counts');
  await page.locator('[data-testid="nav-analytics"]').first().click();
  await page.waitForTimeout(3000);
  await page.locator('text=/against the standard|against RDSO/i').first().scrollIntoViewIfNeeded().catch(() => {});
  await shot('spring-analytics');
  const a = await bodyText();
  check(/against (the standard|RDSO)/i.test(a), 'the standard report ("against the standard") is on Spring Analytics');
  check(/[Bb]and/.test(a) && /n\s*=|of \d+/.test(a), 'it shows bands with counts');
}

// ---------------------------------------------------------------------------
console.log('\nWalk 6: the audit chain verifies; a released wagon\'s certificate verifies at /verify.html with no server');
const drm = await page.evaluate(() => localStorage.getItem('wrs_token'));
{
  await page.locator('[data-testid="nav-audit"]').first().click();
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: /Verify chain again/i }).click();
  await page.waitForTimeout(4000);
  await shot('audit-chain');
  check(/Chain intact/i.test(await bodyText()), 'the chain is intact after re-derivation');
  const cert = await (await fetch(`${BASE}/api/wagons/${encodeURIComponent('SECR/BOXNHL/10492')}/certificate?format=json`, { headers: { authorization: `Bearer ${drm}` } })).text();
  check(cert.startsWith('{'), 'the released wagon SECR/BOXNHL/10492 has a certificate');
  const v = await ctx.newPage();
  await v.goto(`${BASE}/verify.html`);
  await ctx.setOffline(true);
  await v.fill('#input', cert); await v.click('#go'); await v.waitForTimeout(900);
  const verdict = (await v.locator('.verdict').innerText()).split('\n')[0];
  await v.screenshot({ path: join(OUT, `${String(++shotN).padStart(2, '0')}-verify-offline.png`), fullPage: true });
  check(/^VERIFIED/.test(verdict), `the certificate verifies with the network cut: ${verdict}`);
  await ctx.setOffline(false);
  await v.close();
  await openWagon('SECR/BOXNHL/10492', 'Release checks');
  await page.getByRole('button', { name: /Release Certificate/i }).first().click().catch(() => {});
  await page.waitForTimeout(1500);
  await shot('certificate-modal');
}

// ---------------------------------------------------------------------------
console.log('\nWalk 7: the shadow run — a week of the log with the one case the register would have passed');
await signIn('supervisor1');
{
  await page.locator('[data-testid="nav-shadow"]').first().click();
  await page.waitForTimeout(2500);
  await shot('shadow-run');
  const verdict = await page.locator('[data-testid="shadow-verdict"]').innerText().catch(() => '');
  const days = await page.locator('[data-testid="shadow-days"] tbody tr').count().catch(() => 0);
  check(days >= 5, `the log shows ${days} days`);
  const t = await bodyText();
  check(/NR\/BOXN\/60334/.test(t) && /would have (passed|stopped)/i.test(t), 'the snubber on NR/BOXN/60334 — the one the register would have passed — is on the page');
  check(verdict.length > 0, `the verdict panel reads: "${verdict.replace(/\s+/g, ' ').slice(0, 140)}"`);
}

// ---------------------------------------------------------------------------
console.log('\nThe questions you will be asked: the camera tile says zero labelled photographs; the readiness panel is honest');
await signIn('drm1');
{
  await page.locator('[data-testid="nav-learning"]').first().click();
  await page.waitForTimeout(3000);
  await shot('learning');
  const t = await bodyText();
  check(/has not been taught anything yet/i.test(t), 'the learning dashboard says the camera has not been taught anything yet');
  check(/example count is not the answer/i.test(t), 'and that the example count is not the answer to whether it is improving');
  const status = await api('GET', '/vision/auto/status', null, drm);
  const heads = status.body?.data?.heads || [];
  check(status.status === 200 && heads.length > 0 && heads.every((h) => !h.allowed), `no camera head may auto-commit on the demo record (${heads.map((h) => `${h.head || h.name || '?'}: ${h.allowed ? 'ALLOWED' : 'no'}`).join(', ')})`);
}
await signIn('admin1');
{
  const adm = await page.evaluate(() => localStorage.getItem('wrs_token'));
  const ready = await api('GET', '/system/readiness', null, adm);
  const list = ready.body?.data?.checks || [];
  // On the demonstration record the demo accounts are on the published password by
  // design; the row must FAIL and say why they can nevertheless sign in.
  const demoRow = list.find((r) => r.id === 'demo-passwords');
  check(demoRow?.state === 'FAIL' && /SEED_DEMO_USERS=true is set/.test(demoRow.detail), `demo-passwords FAILS and says SEED_DEMO_USERS is what lets them sign in: "${(demoRow?.detail || '').slice(0, 100)}"`);
  const fails = list.filter((r) => r.state === 'FAIL' && r.id !== 'demo-passwords');
  console.log(`  readiness: ${list.map((r) => `${r.id}=${r.state}`).join(', ')}`);
  for (const r of list.filter((x) => x.state !== 'PASS')) console.log(`    ${r.state} ${r.id}: ${r.detail}`);
  check(list.length > 0 && fails.length === 0, `no other readiness row FAILS on the demo PC${fails.length ? ': ' + fails.map((r) => r.id).join(', ') : ''}`);
  await page.locator('[data-testid="nav-users"]').first().click().catch(() => {});
  await page.waitForTimeout(2000);
  await shot('admin-users');
}

await browser.close();
writeFileSync(join(OUT, 'report.txt'), [
  `problems: ${problems.length}`, ...problems.map((p) => `  - ${p}`),
  `console errors: ${consoleErrors.length}`, ...consoleErrors.map((e) => `  - ${e}`),
  `failed API calls: ${failedCalls.length}`, ...failedCalls.map((f) => `  - ${f}`)
].join('\n') + '\n');
console.log(`\n${shotN} screenshots in ${OUT}/`);
if (consoleErrors.length) console.log(`console errors (${consoleErrors.length}):\n  ${[...new Set(consoleErrors)].join('\n  ')}`);
if (failedCalls.length) console.log(`failed API calls (${failedCalls.length}):\n  ${[...new Set(failedCalls)].join('\n  ')}`);
if (problems.length) { console.log(`\n${problems.length} claim(s) in DEMO_DAY.md the screen did not back:\n  ${problems.join('\n  ')}`); process.exit(1); }
console.log('\nEvery claim in DEMO_DAY.md is backed by the screen.');
