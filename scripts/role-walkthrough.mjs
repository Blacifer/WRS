/**
 * Every role, every screen, driven
 * Indian Railways WRS Raipur
 *
 * The shop's first report of this app was that it "feels disoriented and
 * misaligned" and that "every role should be connected to each other". Screens
 * that fail for one role and not another are invisible to whoever is signed in
 * as somebody else, and a 403 fired by a panel that then hides itself looks
 * like nothing at all until a DRM opens the developer tools.
 *
 * So this signs in as each role, visits every destination that role is
 * offered, and reports three things per screen: whether it renders, whether
 * the console stayed clean, and whether any API call was refused. The third
 * is the one worth having — a screen can render perfectly while quietly
 * failing to load what it is for.
 *
 * Not part of `npm test`: it needs Playwright, a running server and a real
 * browser. Run it deliberately, before a deployment and after touching
 * navigation, roles or capabilities.
 *
 *   npm run dev                          # in one terminal
 *   node scripts/role-walkthrough.mjs    # in another, with playwright installed
 *
 * What good looks like: every destination "renders", and both "console errors"
 * and "failed API calls" reading none, for all four roles.
 *
 * On 6 September 2026 that is what it reported — after fixing the one thing it
 * found, a DRM dashboard firing an admin-only storage request on every load.
 */

import { chromium } from 'playwright';

/*
 * Where to drive.
 *
 * Defaults to the dev server for a developer running this by hand. The gate
 * points it at a preview of the BUILT client instead — the same artefact the
 * shop installs, and the one whose service worker the offline drill needs. A
 * screen that renders in dev and not in the build is a failure this would
 * otherwise never see.
 */
const BASE = process.env.DRILL_URL || 'http://localhost:5173';
const b = await chromium.launch();

const users = [
  ['inspector1',  'INSPECTOR'],
  ['supervisor1', 'SUPERVISOR'],
  ['admin1',      'ADMIN'],
  ['drm1',        'DRM']
];

for (const [user, role] of users) {
  const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 110)); });
  p.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message.slice(0, 110)));
  // A failed API call is a broken screen even when nothing throws.
  const bad = [];
  p.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 400) bad.push(`${r.status()} ${r.url().split('/api/')[1].split('?')[0]}`);
  });

  await p.goto(BASE, { waitUntil: 'networkidle' });
  await p.fill('input[type="text"]', user);
  await p.fill('input[type="password"]', 'password123');
  await p.click('button[type="submit"]');
  await p.waitForTimeout(4000);

  // Every top-level destination this role is offered.
  const navs = await p.locator('header button, nav button').allInnerTexts();
  const tabs = [...new Set(navs.map((t) => t.replace(/\s+/g, ' ').trim()))]
    .filter((t) => t && !/^(हिंदी|English|Logout)$/i.test(t) && t.length < 40);

  console.log(`\n  === ${role} (${user}) — ${tabs.length} destinations`);
  for (const tab of tabs) {
    try {
      await p.getByRole('button', { name: tab, exact: true }).first().click({ timeout: 4000 });
      await p.waitForTimeout(2200);
      const body = await p.locator('body').innerText();
      const blank = body.replace(/\s+/g, ' ').trim().length < 400;
      console.log(`    ${tab.padEnd(26)} ${blank ? 'LOOKS EMPTY' : 'renders'}`);
    } catch {
      console.log(`    ${tab.padEnd(26)} could not open`);
    }
  }
  console.log('    console errors :', errs.length ? errs.slice(0, 2).join(' ;; ') : 'none');
  console.log('    failed API calls:', bad.length ? [...new Set(bad)].slice(0, 4).join(', ') : 'none');
  await ctx.close();
}
await b.close();
