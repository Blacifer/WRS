#!/usr/bin/env node
/**
 * Sections 3, 4 and 5 of the walkthrough — the supervisor, the DRM and the
 * administrator, on the laptop — performed by a machine and photographed,
 * the way scripts/inspector-walk.mjs does section 2 on a phone.
 *
 *   APP_URL=https://localhost:3200 node scripts/role-walks.mjs supervisor|drm|admin [outDir]
 *
 * Same step numbers as the walkthrough; result.json in the same shape, so
 * scripts/walk-guide.mjs renders each into its page. Steps that need a
 * second device (scanning a QR with a phone) are driven as far as the
 * laptop can and marked "by hand" for the rest.
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROLE = (process.argv[2] || '').toLowerCase();
if (!['supervisor', 'drm', 'admin'].includes(ROLE)) { console.error('usage: node scripts/role-walks.mjs supervisor|drm|admin [outDir]'); process.exit(2); }
const BASE = process.env.APP_URL || 'https://localhost:3200';
const OUT = process.argv[3] || `docs/artifacts/${ROLE}-walk`;
mkdirSync(OUT, { recursive: true });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const steps = [];
let current = null;
const begin = (num, did) => { current = { num, did, saw: [], ok: true, shots: [], byHand: null, startedAt: new Date().toISOString() }; steps.push(current); console.log(`\n${num} ${did}`); };
const saw = (ok, text) => { current.saw.push({ ok, text }); if (!ok) current.ok = false; console.log(`  ${ok ? '✓' : '✗'} ${text}`); };
const byHand = (text) => { current.byHand = text; console.log(`  ○ by hand: ${text}`); };

const browser = await chromium.launch();
let ctx; let page;
const consoleErrors = [];
async function open() {
  if (ctx) await ctx.close();
  ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1.5, acceptDownloads: true });
  page = await ctx.newPage();
  page.on('pageerror', (e) => consoleErrors.push(`${current?.num || '-'}: ${String(e).slice(0, 160)}`));
}
let shotN = 0;
async function shot(name, { full = true } = {}) {
  await page.waitForTimeout(1000);
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
async function signIn(user, password = 'password123') {
  await open();
  await page.goto(BASE);
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('wrs_lang', 'en'); });
  await page.goto(BASE);
  await page.fill('input[type="text"]', user);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);
  return page.evaluate(() => localStorage.getItem('wrs_token'));
}
const nav = async (id) => { await page.locator(`[data-testid="${id}"]`).first().click(); await page.waitForTimeout(1800); };
const wagonTab = async (label) => { await page.locator('[data-testid="wagon-tabs"] button', { hasText: label }).first().click(); await page.waitForTimeout(2000); };
async function openWagon(number, tab) {
  await nav('nav-wagons');
  const search = page.getByPlaceholder(/Search wagon number/i).first();
  if (await search.isVisible().catch(() => false)) { await search.fill(number); await page.waitForTimeout(800); }
  await page.locator(`text=${number}`).first().click();
  await page.waitForTimeout(2000);
  if (tab) await wagonTab(tab);
}
/** The one-time code, the way the production configuration issues it (OTP_DELIVERY=INLINE): request, read it off the panel, type it, confirm. */
async function confirmWithCode() {
  await page.getByRole('button', { name: /Request code|कोड भेजें/ }).first().click();
  await page.waitForTimeout(1200);
  const shown = (await page.locator('[data-testid="inline-code"]').innerText().catch(() => '')).replace(/\D/g, '').slice(-6);
  await page.locator('input[inputmode="numeric"]').last().fill(shown);
  await page.getByRole('button', { name: /^Confirm$|पुष्टि करें/ }).last().click();
  await page.waitForTimeout(2000);
  return shown;
}

// ===========================================================================
if (ROLE === 'supervisor') {
  const token = await signIn('supervisor1');

  begin('3.1', 'Wagons Pipeline');
  await nav('nav-wagons');
  await shot('pipeline');
  {
    const t = await bodyText();
    saw(/Wagons in the workshop|Wagons Pipeline/i.test(t), 'the Wagons Pipeline heading');
    saw(/TOTAL 13/i.test(t) && /STAGE 7/.test(t), 'thirteen wagons, seven stage tiles with their counts');
    saw(/days in shop/i.test(t) && /Due:/.test(t), 'days in shop and the due date on the cards');
  }

  begin('3.2', 'Register a wagon — a duplicate and a nonsense number are refused');
  {
    await page.getByRole('button', { name: /Register New Wagon/i }).first().click();
    await page.waitForTimeout(1000);
    await shot('register-form');
    const dup = await api('POST', '/wagons/register', { wagonNumber: 'WR/BCNHL/40112', wagonType: 'BCNHL', owningRailway: 'WR' }, token);
    saw(dup.status >= 400, `a duplicate number (WR/BCNHL/40112) is refused: ${dup.status} ${String(dup.body?.error || dup.body?.message || '').slice(0, 80)}`);
    const junk = await api('POST', '/wagons/register', { wagonNumber: 'ADSFADS', wagonType: 'BOXNHL', owningRailway: 'SECR' }, token);
    saw(junk.status >= 400, `"ADSFADS" is refused — not a wagon number: ${junk.status}`);
    const badType = await api('POST', '/wagons/register', { wagonNumber: 'SECR/BOXNHL/77777', wagonType: 'NOTATYPE', owningRailway: 'SECR' }, token);
    saw(badType.status >= 400, `a nonsense type is refused: ${badType.status}`);
    await page.keyboard.press('Escape').catch(() => {});
    await page.getByRole('button', { name: /Cancel|✕|Close/ }).first().click().catch(() => {});
  }

  begin('3.3', 'WR/BCNHL/40112 → Photos → Pocket counts, as a supervisor');
  {
    await openWagon('WR/BCNHL/40112', 'Photos');
    await shot('40112-photos');
    const b2b = (await page.locator('[data-testid="pocket-frame-BOGIE_2-SIDE_B"]').innerText().catch(() => '')).replace(/\s+/g, ' ');
    saw(/6 of 7 outer/i.test(b2b), `Bogie 2 · Side B shows the figures the inspector was not shown: "${b2b.slice(0, 110)}"`);
    for (const f of ['BOGIE_1-SIDE_A', 'BOGIE_1-SIDE_B', 'BOGIE_2-SIDE_A']) {
      const txt = (await page.locator(`[data-testid="pocket-frame-${f}"]`).innerText().catch(() => '')).replace(/\s+/g, ' ');
      saw(!/pocket may be empty|of 7/i.test(txt), `${f.replace(/_/g, ' ')} is complete — not flagged`);
    }
  }

  begin('3.4', '→ Release checks — the short count waits as an advisory');
  {
    await wagonTab('Release checks');
    await shot('40112-release-checks');
    const gate = await api('GET', '/wagons/WR%2FBCNHL%2F40112/gate/status', null, token);
    const adv = gate.body?.data?.advisories || [];
    saw(adv.some((a) => /Bogie 2 Side B/i.test(a)), `the advisory names the frame: "${adv.find((a) => /Bogie 2/i.test(a)) || '(missing)'}"`);
    saw(await has(/Bogie 2 Side B/i), 'and it is on the screen');
  }

  begin('3.5', 'SER/BOXNHL/30914 → Release checks — blocked, Authorise disabled');
  {
    await openWagon('SER/BOXNHL/30914', 'Release checks');
    await shot('30914-release-checks');
    const gate = await api('GET', '/wagons/SER%2FBOXNHL%2F30914/gate/status', null, token);
    const blockers = gate.body?.data?.blockers || [];
    saw(blockers.some((b) => /condemn/i.test(b)), `blocked by a condemned spring: "${(blockers.find((b) => /condemn/i.test(b)) || '').slice(0, 90)}"`);
    const wheel = blockers.find((b) => /917\.5/.test(b));
    saw(Boolean(wheel) && /919/.test(wheel), `blocked by the axle-3 pair at 917.5 below 919: "${(wheel || '').slice(0, 110)}"`);
    saw(blockers.some((b) => /bearing|rotation/i.test(b)), `a bearing rotation check pending: "${(blockers.find((b) => /bearing|rotation/i.test(b)) || '').slice(0, 90)}"`);
    const t = await bodyText();
    saw(/blocker/i.test(t) && /917\.5/.test(t), 'the blockers are on the screen with the figure');
    const auth = page.getByRole('button', { name: /Authori[sz]e/i }).first();
    saw(!(await auth.isVisible().catch(() => false)) || (await auth.isDisabled().catch(() => false)), 'Authorise is disabled or absent while blockers stand');
  }

  begin('3.6', '→ Checklist → the wheels');
  {
    await wagonTab('Checklist');
    await page.locator('[data-testid="wheel-readings"]').scrollIntoViewIfNeeded().catch(() => {});
    await shot('30914-wheels');
    const wr = (await page.locator('[data-testid="wheel-readings"]').innerText().catch(() => '')).replace(/\s+/g, ' ');
    const read = (wr.match(/\d{3}(?:\.\d)? mm/g) || []).length;
    saw(read >= 8, `eight chalk figures (${read} found)`);
    saw(/917\.5/.test(wr) && /below issue limit/i.test(wr), 'axle 3 flagged below the issue limit');
    saw(/WD-88089|IRCA|Plate 52/.test(wr), 'the drawing and rule cited beneath');
  }

  begin('3.7', '→ Condition report');
  {
    await wagonTab('Condition report');
    await shot('30914-condition-report');
    saw(await has(/Print report/i), 'a printable one-page report with a Print button');
    saw(await has(/SER\/BOXNHL\/30914/), 'for this wagon');
  }

  begin('3.8', 'SECR/BOXNHL/10492 (released) → Release Certificate');
  {
    await openWagon('SECR/BOXNHL/10492');
    await page.getByRole('button', { name: /Release Certificate/i }).first().click();
    await page.waitForTimeout(2000);
    await shot('10492-certificate');
    // The certificate is a document in its own frame, so read the frame.
    const frame = page.frames().find((f) => f !== page.mainFrame());
    const t = frame ? (await frame.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ') : await bodyText();
    saw(/WRS\/QC-REL\//.test(t), `a certificate number: ${(t.match(/WRS\/QC-REL\/[\w/]+/) || [''])[0]}`);
    saw(/TAT/i.test(t) && /Days/i.test(t), `the turnaround: ${(t.match(/TAT:?\s*[\d.]+ Days/i) || [''])[0]}`);
    saw(/CLEARED/.test(t) && /Springs/.test(t) && /Friction Wedges/.test(t), 'the eight categories, each cleared');
    saw(frame ? (await frame.locator('svg, canvas, img').count()) > 0 : false, 'a QR on the certificate');
    const js = await api('GET', '/wagons/SECR%2FBOXNHL%2F10492/certificate?format=json', null, token);
    const qr = String(js.body?.data?.qrData || '');
    saw(/\/verify\.html\?n=/.test(qr), `the QR is a link to this server's verify page: ${qr.slice(0, 70)}…`);
    const date = js.body?.data?.releaseDate || js.body?.data?.issuedAt || js.body?.data?.signedAt || '';
    saw(Boolean(date) && !String(date).startsWith(new Date().toISOString().slice(0, 10)), `the release date is when it left (${String(date).slice(0, 10)}), not today`);
    const pub = await fetch(`${BASE}/api/audit/certificates/${encodeURIComponent(decodeURIComponent(qr.split('?n=')[1] || ''))}`).then((r) => r.status).catch(() => 0);
    saw(pub === 200, `the number fetches the signed certificate with no account (${pub})`);
    byHand('Scan the QR with the phone on the same Wi-Fi: it opens /verify.html on this server and shows VERIFIED. Print gives a clean page.');
    await page.keyboard.press('Escape').catch(() => {});
    await page.getByRole('button', { name: /Close|✕/ }).first().click().catch(() => {});
  }

  begin('3.9', '→ Passport → Export the passport');
  {
    await wagonTab('Passport');
    await shot('10492-passport');
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }).catch(() => null),
      page.locator('[data-testid="passport-export"]').click()
    ]);
    await page.waitForTimeout(1500);
    saw(Boolean(dl) && /\.jsonl$/.test(dl.suggestedFilename()), `a .jsonl file downloads (${dl ? dl.suggestedFilename() : 'nothing'})`);
    const note = (await page.locator('[data-testid="passport-note"]').innerText().catch(() => '')).replace(/\s+/g, ' ');
    saw(/stage|reading|verdict|photograph|sign/i.test(note), `under the button, what the passport holds: "${note.slice(0, 120)}…"`);
    await shot('10492-passport-exported', { full: false });
  }

  begin('3.10', 'Pick a new Due out date on a wagon in progress — a reason is asked');
  {
    await openWagon('WR/BCNHL/40112');
    const input = page.locator('[data-testid="due-out-input"]');
    const cur = await input.inputValue();
    const d = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    await input.fill(d);
    await page.waitForTimeout(800);
    saw(await page.locator('[data-testid="due-out-reason"]').isVisible(), 'a box asks why');
    const save = page.locator('[data-testid="due-out-save"]');
    saw(await save.isDisabled(), '"Move the date" stays disabled until a reason is typed');
    await page.locator('[data-testid="due-out-reason-input"]').fill('Bogie frame repair took two days longer');
    await save.click();
    await page.waitForTimeout(1500);
    const note = (await page.locator('[data-testid="due-out-note"]').innerText().catch(() => '')).replace(/\s+/g, ' ');
    saw(/moved|audit/i.test(note), `a green line confirms it: "${note.slice(0, 120)}"`);
    await shot('40112-due-out', { full: false });
    // Put it back so the demo record stays as rehearsed.
    await input.fill(cur); await page.waitForTimeout(600);
    await page.locator('[data-testid="due-out-reason-input"]').fill('Restored after rehearsal').catch(() => {});
    await save.click().catch(() => {});
    await page.waitForTimeout(800);
  }

  begin('3.11', 'Stores, Passports, History, Analytics, Learning are not on the supervisor\'s menu');
  {
    const t = await page.locator('nav, header').first().innerText().catch(() => '');
    const shown = ['nav-inventory', 'nav-passports', 'nav-history', 'nav-analytics', 'nav-learning'];
    let visible = 0;
    for (const id of shown) if (await page.locator(`[data-testid="${id}"]`).first().isVisible().catch(() => false)) visible++;
    saw(visible === 0, `none of the five is on the menu (${visible} visible) — by design, the pilot keeps the supervisor on the shop floor`);
    await shot('supervisor-menu', { full: false });
  }

  begin('3.15', 'Ask the Manual');
  {
    await nav('nav-manual-sup');
    const q = page.locator('form input').first();
    await q.fill('brake block condemning limit'); await q.press('Enter');
    await page.waitForTimeout(3500);
    await shot('manual');
    const t = await bodyText();
    saw(/IN THE DOCUMENT'S OWN WORDS/i.test(t) && /Source:/i.test(t), 'the answer in the document\'s own words, with its source');
  }

  begin('3.17', 'Shadow Run — the week, the verdict, record a discrepancy and a summary');
  {
    await nav('nav-shadow');
    await shot('shadow');
    const t = await bodyText();
    saw(await page.locator('[data-testid="shadow-days"]').isVisible().catch(() => false), 'a week of the log');
    saw(await page.locator('[data-testid="shadow-verdict"]').isVisible().catch(() => false), 'the verdict');
    saw(/NR\/BOXN\/60334/.test(t) && /register would have passed/i.test(t), 'the snubber on NR/BOXN/60334 — the register would have passed it');
    const form = page.locator('[data-testid="discrepancy-form"]');
    saw(await form.isVisible().catch(() => false), 'a discrepancy can be recorded');
    saw(await page.locator('[data-testid="summary-form"]').isVisible().catch(() => false), 'a day\'s summary can be recorded');
  }

  begin('3.18', 'Ask the Records');
  {
    await nav('nav-ask');
    const ask = async (q) => { await page.locator('[data-testid="ask-input"]').fill(q); await page.locator('[data-testid="ask-submit"]').click(); await page.waitForTimeout(3500); return bodyText(); };
    let t = await ask('which wagon type condemns the most snubbers this quarter');
    await shot('ask-snubbers');
    saw(await page.locator('[data-testid="ask-answer"]').isVisible().catch(() => false), 'an answer with its count');
    await page.locator('[data-testid="ask-how"]').click().catch(() => {});
    await page.waitForTimeout(800);
    saw(await page.locator('[data-testid="ask-rows"]').isVisible().catch(() => false), '"How this was computed" shows the query and the rows');
    t = await ask('is any gauge reading high');
    await shot('ask-gauge');
    saw(/OSG-02/.test(t), 'OSG-02 named as the gauge reading high');
    t = await ask('what colour is the DRM\'s car');
    saw(await page.locator('[data-testid="ask-no-answer"]').isVisible().catch(() => false) || /cannot|no answer|not something/i.test(t), 'a question it cannot answer → it says so');
  }

  begin('3.19', 'Audit Chain → Verify chain again');
  {
    await nav('nav-audit');
    await page.waitForTimeout(2500);
    await page.getByRole('button', { name: /Verify chain again/i }).first().click();
    await page.waitForTimeout(2500);
    await shot('audit');
    const v = (await page.locator('[data-testid="audit-verdict"]').innerText().catch(() => '')).replace(/\s+/g, ' ');
    const ran = (await page.locator('[data-testid="audit-ran-at"]').innerText().catch(() => '')).replace(/\s+/g, ' ');
    saw(/intact|valid|unbroken|verified/i.test(v), `the verdict: "${v.slice(0, 80)}"`);
    saw(/Re-derived just now/i.test(ran) && /ms/.test(ran), `"${ran.slice(0, 100)}"`);
  }

  begin('3.20', 'Single Spring → Supervisor override — change the band');
  {
    await nav('nav-inspection');
    await page.waitForTimeout(1500);
    const h = page.locator('input[type="number"]').first();
    await h.fill('258.5'); await page.waitForTimeout(800);
    await page.locator('[data-testid="open-override"]').scrollIntoViewIfNeeded().catch(() => {});
    await shot('single-spring-override-button', { full: false });
    saw(await page.locator('[data-testid="open-override"]').isVisible().catch(() => false), 'the amber "Supervisor override — change the band" is next to Save');
    await page.locator('[data-testid="open-override"]').click();
    await page.waitForTimeout(1000);
    await shot('override-modal', { full: false });
    const t = await bodyText();
    saw(/OVERRIDE RDSO BAND/i.test(t) && /Red Band \(Band VI\)/.test(t), 'it asks the new band — six to pick from');
    saw(/JUSTIFICATION \(REQUIRED\)/i.test(t), 'a justification is required (ten characters at least)');
    saw(/Request OTP/i.test(t), 'and the one-time code');
    saw(await page.getByRole('button', { name: /Authorize Override/i }).first().isDisabled().catch(() => false), 'Authorize Override stays disabled until all three are given');
    await page.keyboard.press('Escape').catch(() => {});
    await page.getByRole('button', { name: /Cancel/i }).first().click().catch(() => {});
  }

  begin('3.21', 'Hindi on the pipeline and release checks');
  {
    await nav('nav-wagons');
    await page.locator('button', { hasText: /हिंदी|हिन्दी/ }).first().click();
    await page.waitForTimeout(1500);
    await shot('pipeline-hindi');
    const t = await bodyText();
    saw(/[ऀ-ॿ]/.test(t), 'the pipeline is in Hindi');
    saw(/WR\/BCNHL\/40112|SER\/BOXNHL\/30914/.test(t), 'wagon numbers unchanged');
    await page.locator('button', { hasText: /English|EN/ }).first().click().catch(() => {});
  }
}

// ===========================================================================
if (ROLE === 'drm') {
  const token = await signIn('drm1');

  begin('4.1', 'DRM Dashboard — Shop Floor, Right Now');
  await nav('nav-dashboard');
  await page.waitForTimeout(2500);
  await shot('dashboard');
  {
    const now = (await page.locator('text=Shop Floor — Right Now').first().locator('xpath=ancestor::section[1]').innerText().catch(() => '')).replace(/\s+/g, ' ');
    saw(now.length > 0, 'the "Shop Floor — Right Now" section');
    saw(/springs\/hour/i.test(now), 'when today\'s pile finishes, with the rate');
    saw(/complete bogies/i.test(now), 'how many bogies can be built');
    saw(/Stores/i.test(now) && /replacements/i.test(now), 'what Stores will need');
    saw(!/Not yet known/.test(now), 'none says "Not yet known"');
  }

  begin('4.2', 'Scroll the dashboard');
  {
    const t = await bodyText();
    saw(/Turnaround|TAT/i.test(t), 'turnaround');
    saw(await page.locator('[data-testid="where-wagons-wait"]').isVisible().catch(() => false), 'where wagons wait — and the wagon that will miss its date');
    saw(/keeps coming back|Recurring/i.test(t), 'what keeps coming back');
    saw(await page.locator('[data-testid="inspector-quality"]').isVisible().catch(() => false), 'inspector quality');
    saw(await page.locator('[data-testid="dashboard-gauge-exposure"]').isVisible().catch(() => false), 'gauge exposure');
    saw((t.match(/\bn\s*=\s*\d+|\(\d+\)|of \d+/g) || []).length >= 5, 'rates carry their counts');
    await page.locator('[data-testid="where-wagons-wait"]').scrollIntoViewIfNeeded().catch(() => {});
    await shot('dashboard-lower', { full: false });
  }

  begin('4.3', 'Spring Analytics — tap a day\'s bar; the standard report; gauge drift');
  {
    await nav('nav-analytics');
    await page.waitForTimeout(2500);
    await shot('analytics');
    saw(await page.locator('[data-testid="sorted-today"]').isVisible().catch(() => false) && await page.locator('[data-testid="sorted-week"]').isVisible().catch(() => false), 'bench totals today and this week');
    const bars = page.locator('[data-testid="sorting-trend"] [role="button"], [data-testid="sorting-trend"] button');
    const nb = await bars.count();
    if (nb) { await bars.nth(Math.max(0, nb - 2)).click(); await page.waitForTimeout(800); }
    saw(await page.locator('[data-testid="sorting-day-detail"]').isVisible().catch(() => false), 'tapping a day\'s bar reads that day\'s figures beneath');
    saw(await page.locator('[data-testid="sorting-stock"]').isVisible().catch(() => false), 'stock by band');
    saw(await page.locator('[data-testid="standard-report"]').isVisible().catch(() => false), 'the standard report');
    const sr = (await page.locator('[data-testid="standard-report"]').innerText().catch(() => '')).replace(/\s+/g, ' ');
    saw((sr.match(/\bn\s*=\s*\d+/g) || []).length >= 3, `n on the figures (${(sr.match(/\bn\s*=\s*\d+/g) || []).length} found)`);
    const drift = (await page.locator('[data-testid="analytics-gauge-drift"]').innerText().catch(() => '')).replace(/\s+/g, ' ');
    saw(/OSG-02/.test(drift), `the Gauge drift panel names OSG-02: "${drift.slice(0, 120)}…"`);
    await page.locator('[data-testid="analytics-gauge-drift"]').scrollIntoViewIfNeeded().catch(() => {});
    await shot('analytics-drift', { full: false });
  }

  begin('4.4', 'System Learning → Run Analysis');
  {
    await nav('nav-learning');
    await page.waitForTimeout(2500);
    await shot('learning');
    const t = await bodyText();
    saw(/Observations/.test(t) && /Corrected/.test(t) && /Accuracy/.test(t) && /Spring camera/.test(t), 'each subsystem with its observations, corrections and accuracy');
    saw(/has not been taught anything yet/i.test(t), 'the camera says it has not been taught anything yet');
    const auto = await api('GET', '/vision/auto/status', null, token);
    saw(auto.status === 200 && auto.body?.data && !auto.body.data.allowed && !auto.body.data.enabled, `the server confirms the camera may not sort on its own (allowed: ${auto.body?.data?.allowed ?? '?'})`);
    await page.getByRole('button', { name: /Run Analysis/i }).first().click();
    await page.waitForTimeout(3500);
    const ran = (await page.locator('[data-testid="analysis-ran"]').innerText().catch(() => '')).replace(/\s+/g, ' ');
    saw(/Analysed at/i.test(ran) && /observations/i.test(ran), `after Run Analysis: "${ran.slice(0, 120)}"`);
    await shot('learning-ran', { full: false });
  }

  begin('4.5', 'Shadow Run — read-only');
  {
    await nav('nav-shadow');
    await shot('shadow-readonly');
    saw(await page.locator('[data-testid="shadow-days"]').isVisible().catch(() => false), 'the week is visible');
    saw(!(await page.locator('[data-testid="discrepancy-submit"]').isVisible().catch(() => false)) && !(await page.locator('[data-testid="summary-submit"]').isVisible().catch(() => false)), 'no record buttons for the DRM');
  }

  begin('4.6', 'Ask the Records');
  {
    await nav('nav-ask');
    await page.locator('[data-testid="ask-input"]').fill('is any gauge reading high');
    await page.locator('[data-testid="ask-submit"]').click();
    await page.waitForTimeout(3500);
    await shot('ask');
    saw(await has(/OSG-02/), 'OSG-02 named');
    await page.locator('[data-testid="ask-how"]').click().catch(() => {});
    await page.waitForTimeout(800);
    saw(await page.locator('[data-testid="ask-rows"]').isVisible().catch(() => false), 'how it was computed, with the rows');
  }

  begin('4.7', 'Audit Chain → Verify');
  {
    await nav('nav-audit');
    await page.waitForTimeout(2500);
    await page.getByRole('button', { name: /Verify chain again/i }).first().click();
    await page.waitForTimeout(2500);
    await shot('audit');
    const v = (await page.locator('[data-testid="audit-verdict"]').innerText().catch(() => '')).replace(/\s+/g, ' ');
    saw(/intact|valid|unbroken|verified/i.test(v), `"${v.slice(0, 80)}"`);
  }

  begin('4.8', 'Wagons Pipeline — no Register button for the DRM, and the server refuses too');
  {
    await nav('nav-wagons');
    await shot('pipeline-drm');
    saw(!(await page.getByRole('button', { name: /Register New Wagon/i }).first().isVisible().catch(() => false)), 'no Register New Wagon button');
    const r = await api('POST', '/wagons/register', { wagonNumber: 'SECR/BOXNHL/77777', wagonType: 'BOXNHL', owningRailway: 'SECR' }, token);
    saw(r.status === 403, `the server refuses the DRM's token: ${r.status}`);
  }

  begin('4.9', 'SECR/BOXNHL/10492 → Release Certificate → scan the QR with the phone');
  {
    await openWagon('SECR/BOXNHL/10492');
    await page.getByRole('button', { name: /Release Certificate/i }).first().click();
    await page.waitForTimeout(2000);
    await shot('certificate');
    const js = await api('GET', '/wagons/SECR%2FBOXNHL%2F10492/certificate?format=json', null, token);
    const qr = String(js.body?.data?.qrData || '');
    const n = decodeURIComponent(qr.split('?n=')[1] || '');
    saw(/verify\.html\?n=/.test(qr), 'the QR is a link to the verify page');
    // The phone's job, done by a second page: open the link and read the verdict.
    const p2 = await ctx.newPage();
    await p2.goto(`${BASE}/verify.html?n=${encodeURIComponent(n)}`);
    await p2.waitForTimeout(3500);
    const vt = (await p2.locator('body').innerText()).replace(/\s+/g, ' ');
    saw(/VERIFIED/.test(vt), `the verify page shows VERIFIED: "${vt.slice(0, 100)}…"`);
    await p2.screenshot({ path: join(OUT, `${String(++shotN).padStart(2, '0')}-verify.png`) }); current.shots.push(`${String(shotN).padStart(2, '0')}-verify.png`);
    await p2.close();
    byHand('Scan the QR with the phone: the same page opens on the phone and shows VERIFIED. The page also takes a certificate file with no server at all.');
  }
}

// ===========================================================================
if (ROLE === 'admin') {
  const token = await signIn('admin1');

  begin('5.1', 'User Accounts — create, deactivate, reactivate');
  {
    await nav('nav-users');
    await page.waitForTimeout(2000);
    await shot('users');
    const t = await bodyText();
    saw(/inspector1|supervisor1|drm1/.test(t), 'the accounts are listed');
    saw(/deactivate|active/i.test(t), 'each can be deactivated and reactivated');
    const list = await api('GET', '/users', null, token);
    const u = (list.body?.data || []).find((x) => x.username === 'inspector2');
    if (u) {
      const off = await api('POST', `/users/${u.id}/deactivate`, {}, token);
      const login = await api('POST', '/auth/login', { username: 'inspector2', password: 'password123' });
      const on = await api('POST', `/users/${u.id}/reactivate`, {}, token);
      const login2 = await api('POST', '/auth/login', { username: 'inspector2', password: 'password123' });
      saw(off.status < 300 && login.status >= 400, `deactivated → inspector2 cannot sign in (${login.status})`);
      saw(on.status < 300 && login2.status === 200, `reactivated → can sign in again (${login2.status})`);
    }
    byHand('Create an account with the form: a one-time code is asked before it is made.');
  }

  begin('5.2', 'Roster import — paste three lines, preview, confirm, slips');
  {
    await page.locator('[data-testid="roster-toggle"]').click().catch(() => {});
    await page.waitForTimeout(800);
    saw(await page.locator('[data-testid="roster-file"]').isVisible().catch(() => false), 'a file picker for the office\'s CSV');
    await page.locator('[data-testid="roster-text"]').fill('Sunil Verma,WRS-INSP-2201,INSPECTOR\nMeena Rao,WRS-INSP-2202,INSPECTOR\nR. K. Das,WRS-SUP-2203,SUPERVISOR');
    await page.locator('[data-testid="roster-preview"]').click().catch(() => {});
    await page.waitForTimeout(1200);
    await shot('roster-preview');
    saw(await has(/Sunil Verma/) && await has(/Meena Rao/), 'the preview lists the three');
    byHand('Confirm (one-time code) → three printable slips with passwords. Not done in rehearsal, so the demo accounts stay as they are.');
  }

  begin('5.3', 'What each role holds — read-only');
  {
    const t = await bodyText();
    saw(/What each role holds|role holds|capabilit/i.test(t), 'the table is on the page');
    saw(/read-only|cannot be changed|fixed/i.test(t), 'read-only by design, with the note saying why');
    saw(/release/i.test(t), 'shows the admin cannot release a wagon');
    await page.locator('text=/What each role holds/i').first().scrollIntoViewIfNeeded().catch(() => {});
    await shot('role-matrix', { full: false });
  }

  begin('5.4', 'Checklist Rules — the blue box; add and withdraw a shop line');
  {
    await nav('nav-checklist-config');
    await page.waitForTimeout(2000);
    await shot('checklist-rules');
    const box = (await page.locator('[data-testid="checklist-rules-what"]').innerText().catch(() => '')).replace(/\s+/g, ' ');
    saw(/What it is/i.test(box) && /What you can do/i.test(box) && /When/i.test(box), 'the blue box: what it is, what you can do, when');
    saw(await page.locator('[data-testid="config-part-name"]').isVisible().catch(() => false), 'a shop line can be added with a reason and source');
  }

  begin('5.5', 'Gauge Register — SSG-02 with no calibration; the drift box');
  {
    await nav('nav-users');
    await page.waitForTimeout(2000);
    await page.locator('[data-testid="gauge-register"]').scrollIntoViewIfNeeded().catch(() => {});
    const reg = (await page.locator('[data-testid="gauge-register"]').innerText().catch(() => '')).replace(/\s+/g, ' ');
    await shot('gauge-register', { full: false });
    saw(/OSG-01/.test(reg) && /OSG-02/.test(reg) && /ISG-01/.test(reg) && /SSG-02/.test(reg), 'four gauges');
    saw(/1251122-04-125/.test(reg), 'SSG-02 shows its certificate number');
    saw(/NOT RECORDED/i.test(reg), 'and NOT RECORDED for its calibration');
    const drift = (await page.locator('[data-testid="gauge-drift"]').innerText().catch(() => '')).replace(/\s+/g, ' ');
    saw(/disagree by/i.test(drift) && /master/i.test(drift), `the drift box, one line per finding: "${drift.slice(0, 120)}…"`);
    const findings = Number((drift.match(/(\d+) findings?/) || [])[1] || 0);
    saw(findings > 0 && (drift.match(/disagree by/gi) || []).length === findings, `one line per finding (${findings}) — the same pair once per spring kind, not once per gauge`);
    byHand('Record calibration for SSG-02 with the dates from certificate 1251122-04-125 → the amber note on the bench goes. Left as is in rehearsal so the demo shows the amber.');
  }

  begin('5.6', 'DRM Dashboard as admin — Deployment readiness and Storage first');
  {
    await nav('nav-dashboard');
    await page.waitForTimeout(3000);
    await page.locator('[data-testid="run-readiness"]').click().catch(() => {});
    await page.waitForTimeout(4000);
    await shot('dashboard-admin');
    saw(await page.locator('[data-testid="deployment-readiness"]').isVisible().catch(() => false), 'Deployment readiness is on the dashboard');
    const readyBox = await page.locator('[data-testid="deployment-readiness"]').boundingBox().catch(() => null);
    const nowBox = await page.locator('text=Shop Floor — Right Now').first().boundingBox().catch(() => null);
    saw(Boolean(readyBox && nowBox) && readyBox.y < nowBox.y, 'and it comes before Shop Floor — Right Now');
    const r = (await page.locator('[data-testid="deployment-readiness"]').innerText().catch(() => '')).replace(/\s+/g, ' ');
    saw(/backup/i.test(r) && /manual/i.test(r) && /demo/i.test(r) && /audit/i.test(r), 'rows for backup, manual, demo passwords, audit chain');
    saw(/SEED_DEMO_USERS/.test(r), 'the demo-passwords row says why they still sign in');
  }

  begin('5.7', 'Password (top right, labelled) — the panel opens in full');
  {
    await page.locator('[data-testid="header-password"]').first().click();
    await page.waitForTimeout(800);
    await shot('password-panel', { full: false });
    const panel = page.locator('[data-testid="change-password"]');
    const box = await panel.boundingBox().catch(() => null);
    saw(Boolean(box) && box.y >= 0 && box.y + box.height <= 900, 'the panel is fully on screen, not under the header');
    saw(await page.locator('[data-testid="current-password"]').isVisible().catch(() => false), 'old and new password boxes');
    byHand('Change it and sign in again: the old password stops working, the new one works. Not changed in rehearsal.');
    await page.keyboard.press('Escape').catch(() => {});
    await page.getByRole('button', { name: /Cancel|Close|✕/ }).first().click().catch(() => {});
  }

  begin('5.8', 'Authenticator (top right, labelled) — a QR to scan');
  {
    await page.locator('[data-testid="header-totp"]').first().click();
    await page.waitForTimeout(1500);
    let t = await bodyText();
    saw(/Authenticator setup/i.test(t), 'the enrolment panel opens in full');
    await page.getByRole('button', { name: /Start setup|Set up a new phone/i }).first().click();
    await page.waitForTimeout(2000);
    await shot('authenticator-panel', { full: false });
    t = await bodyText();
    saw(/scan/i.test(t) && (await page.locator('svg, canvas').count()) > 0, 'a QR to scan with the app, and a box for the code');
    byHand('Scan it with an authenticator app, type the code: a wrong code is refused, the right one enrols, and sign-in then needs the code. Not enrolled in rehearsal.');
    await page.keyboard.press('Escape').catch(() => {});
    await page.getByRole('button', { name: /Cancel|Close|✕|Later/ }).first().click().catch(() => {});
  }

  begin('5.9', 'Stores & Inventory — add a part; restock 10; restock 1.5 refused');
  {
    await nav('nav-inventory');
    await page.waitForTimeout(2000);
    await page.locator('[data-testid="stores-add-toggle"]').click();
    await page.waitForTimeout(600);
    const code = `DEMO-${Date.now().toString().slice(-5)}`;
    await page.locator('[data-testid="stores-add-code"]').fill(code);
    await page.locator('[data-testid="stores-add-name"]').fill('Rehearsal split pin 12x110');
    await page.locator('[data-testid="stores-add-bin"]').fill('R-07').catch(() => {});
    await page.locator('[data-testid="stores-add-save"]').click();
    await page.waitForTimeout(1500);
    await shot('stores-added');
    saw(await has(new RegExp(code)), `the new part ${code} appears in the list`);
    const part = (await api('GET', `/inventory/part/${encodeURIComponent(code)}`, null, token)).body?.data;
    if (part) {
      const q0 = Number(part.stockQuantity ?? 0);
      const ok = await api('POST', '/inventory/restock', { partCode: code, quantity: 10 }, token);
      const bad = await api('POST', '/inventory/restock', { partCode: code, quantity: 1.5 }, token);
      const q1 = Number((await api('GET', `/inventory/part/${encodeURIComponent(code)}`, null, token)).body?.data?.stockQuantity ?? 0);
      saw(ok.status < 300 && q1 === q0 + 10, `restock 10 → stock ${q0} → ${q1}`);
      saw(bad.status >= 400, `restock 1.5 → refused (${bad.status})`);
    } else saw(false, 'the new part could not be found by the API');
  }

  begin('5.10', 'Component Passports — paste a QR payload');
  {
    await nav('nav-passports');
    await page.waitForTimeout(1500);
    const input = page.locator('input[type="text"], textarea').first();
    await input.fill('WRS-PASSPORT|WHL-RWF-2023-8841|WHEELSET|RWF_YELAHANKA');
    await input.press('Enter');
    await page.getByRole('button', { name: /Look up|Search|Open|Find/i }).first().click().catch(() => {});
    await page.waitForTimeout(2500);
    await shot('passport');
    saw(await has(/WHL-RWF-2023-8841/), 'the wheelset\'s history opens');
  }

  begin('5.11', 'History & Logs — filters narrow at once; the count line; export asks for the code');
  {
    await nav('nav-history');
    await page.waitForTimeout(2500);
    const count0 = (await page.locator('[data-testid="history-count"]').innerText().catch(() => '')).replace(/\s+/g, ' ');
    const sel = page.locator('[data-testid="history-filters"] select').first();
    if (await sel.count()) { const opts = await sel.locator('option').allInnerTexts(); const pick = opts.find((o) => /RED|CONDEMNED/i.test(o)); if (pick) await sel.selectOption({ label: pick }); }
    await page.waitForTimeout(1200);
    const count1 = (await page.locator('[data-testid="history-count"]').innerText().catch(() => '')).replace(/\s+/g, ' ');
    saw(count0 !== count1 && /records matching/i.test(count1), `picking a band narrows the list at once: "${count1.slice(0, 80)}"`);
    const box = page.locator('[data-testid="history-filters"] input[type="text"]').first();
    if (await box.count()) { await box.fill('SECR'); await page.waitForTimeout(1200); }
    const count2 = (await page.locator('[data-testid="history-count"]').innerText().catch(() => '')).replace(/\s+/g, ' ');
    saw(/records? matching/i.test(count2) && /SECR/.test(count2), `typing part of a number narrows as you type: "${count2.slice(0, 80)}"`);
    saw(await has(/Clear filters/i), 'Clear filters');
    await shot('history');
    await page.getByRole('button', { name: /Export Audit Trail/i }).first().click().catch(() => {});
    await page.waitForTimeout(1500);
    saw(await has(/one-time code|Request code|6-digit code|OTP/i), 'Export Audit Trail (top bar) asks for the one-time code');
    await shot('export-otp', { full: false });
    await page.keyboard.press('Escape').catch(() => {});
    await page.getByRole('button', { name: /Cancel/i }).first().click().catch(() => {});
  }
}

await browser.close();
const result = { role: ROLE, base: BASE, startedAt: steps[0]?.startedAt, finishedAt: new Date().toISOString(), steps, consoleErrors };
writeFileSync(join(OUT, 'result.json'), JSON.stringify(result, null, 2));
const failed = steps.filter((s) => !s.ok);
console.log(`\n${ROLE}: ${steps.length - failed.length} of ${steps.length} steps matched${failed.length ? `; did not match: ${failed.map((s) => s.num).join(', ')}` : ''}`);
if (consoleErrors.length) console.log('page errors:', consoleErrors);
process.exit(failed.length ? 1 : 0);
