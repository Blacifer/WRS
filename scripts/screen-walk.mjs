#!/usr/bin/env node
/**
 * Every screen, every role, both languages — photographed
 * Indian Railways WRS Raipur
 *
 * The role walkthrough asserts that screens render. This looks at them. It
 * signs in as each demo account, opens every navigation item and every tab
 * of a wagon, in English and in Hindi, at desktop and tablet widths, and
 * writes a screenshot of each — plus one line per screen with the console
 * errors and failed API calls it produced. A person then reads the pictures,
 * which is the only way to find text nobody can read, a panel that says
 * "no data" on a shop with data, or a button that fell off the screen.
 *
 *   node scripts/screen-walk.mjs [outDir]        # against a preview on :4173
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.APP_URL || 'http://localhost:4173';
const OUT = process.argv[2] || 'screen-walk';
mkdirSync(OUT, { recursive: true });

const ROLES = [
  { user: 'inspector1', width: 820, height: 1100, wagon: true, inspector: true },
  { user: 'supervisor1', width: 1280, height: 900, wagon: true },
  { user: 'drm1', width: 1280, height: 900 },
  { user: 'admin1', width: 1280, height: 900 }
];
const WAGON_TABS = ['CHECKLIST', 'GATE', 'PHOTOS', 'TIMELINE', 'ACOUSTIC', 'COMPONENTS', 'SWT', 'REPORT', 'PARTS', 'PASSPORT'];

const browser = await chromium.launch();
const report = [];

for (const role of ROLES) {
  for (const lang of ['en', 'hi']) {
    const ctx = await browser.newContext({ viewport: { width: role.width, height: role.height } });
    const page = await ctx.newPage();
    let errors = []; let failed = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 160)));
    page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 160)}`));
    page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) failed.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, '')}`); });

    const shot = async (name) => {
      await page.waitForTimeout(1800);
      const file = `${role.user}-${lang}-${name}.png`;
      await page.screenshot({ path: join(OUT, file), fullPage: true });
      report.push({ role: role.user, lang, screen: name, errors: [...errors], failed: [...failed] });
      errors = []; failed = [];
    };

    await page.goto(BASE);
    await page.evaluate((l) => { localStorage.clear(); localStorage.setItem('wrs_lang', l); }, lang);
    await page.goto(BASE);
    await shot('login');
    await page.fill('input[type="text"]', role.user);
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2500);
    await shot('home');

    const navs = await page.locator('[data-testid^="nav-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    for (const nav of [...new Set(navs)]) {
      const el = page.locator(`[data-testid="${nav}"]`).first();
      if (!(await el.isVisible().catch(() => false))) continue;
      await el.click().catch(() => {});
      await shot(nav.replace('nav-', ''));
    }

    if (role.wagon) {
      if (role.inspector) {
        await page.locator('[data-testid="nav-inspector-home"]').first().click().catch(() => {});
        await page.waitForTimeout(1500);
        await page.getByRole('button', { name: /A wagon/i }).first().click().catch(() => {});
        await page.waitForTimeout(2000);
        await shot('wagon-list');
        await page.locator('text=/SECR\\//').first().click().catch(() => {});
        await page.waitForTimeout(2000);
        await page.getByRole('button', { name: /Continue checklist|चेकलिस्ट/i }).first().click().catch(() => {});
      } else {
        await page.locator('[data-testid="nav-wagons"]').first().click();
        await page.waitForTimeout(2000);
        await page.locator('text=/SECR\\//').first().click().catch(() => {});
      }
      await page.waitForTimeout(2500);
      await shot('wagon-checklist');
      // Tabs are buttons in one row under the wagon header; walk them by their order.
      const tabButtons = page.locator('nav, div').filter({ has: page.locator('[data-testid="tab-parts"]') }).last().locator('button');
      const n = await tabButtons.count();
      for (let i = 0; i < n && i < 12; i++) {
        const b = tabButtons.nth(i);
        const label = ((await b.innerText().catch(() => '')) || `tab${i}`).split('\n')[0].replace(/[^A-Za-zऀ-ॿ]+/g, '-').slice(0, 24) || `tab${i}`;
        await b.click().catch(() => {});
        await shot(`wagon-${label}`);
      }
    }
    await ctx.close();
  }
}
await browser.close();

const lines = report.map((r) => `${r.role.padEnd(12)} ${r.lang} ${r.screen.padEnd(28)} ${r.errors.length ? 'ERRORS: ' + r.errors.join(' | ') : ''}${r.failed.length ? ' FAILED: ' + r.failed.join(', ') : ''}`.trimEnd());
writeFileSync(join(OUT, 'report.txt'), lines.join('\n') + '\n');
const bad = report.filter((r) => r.errors.length || r.failed.length);
console.log(`${report.length} screens photographed into ${OUT}/; ${bad.length} with console errors or failed calls.`);
for (const r of bad) console.log(`  ${r.role} ${r.lang} ${r.screen}: ${[...r.errors, ...r.failed].join(' | ')}`);
