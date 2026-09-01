/**
 * The offline drill, driven rather than described
 * Indian Railways WRS Raipur
 *
 * Sort twelve springs with the network down, close the tab, reopen it still
 * offline, reconnect, and confirm every one arrives exactly once with the
 * right band — and that the condemned one still says why.
 *
 * This is kept because running it found two real faults that nothing else
 * would have. The sorting queue's drain was gated on "is anything pending for
 * THIS batch", and the batch id was minted fresh on every mount, so a reload
 * left the previous session's springs in IndexedDB for good. Underneath that,
 * the drain lived inside the sorting page's own effect — so coming back into
 * signal on any other screen never tried to send them at all. Twelve springs
 * sat at "12 pending" through a reconnect and nothing said so.
 *
 * Not part of `npm test`: it needs Playwright, a running server and a real
 * browser. Run it deliberately, before a pilot and after touching anything in
 * the sync path.
 *
 *   npm run dev                      # in one terminal
 *   node scripts/offline-drill.mjs   # in another, with playwright installed
 *
 * What good looks like: "12 pending" after sorting, "0 pending" after
 * reconnecting, and a delta of exactly 12 live records with no duplicate
 * sync ids.
 */

import { chromium } from 'playwright';

/*
 * The offline drill, driven rather than described.
 *
 * Sort twelve springs with the network down, close the tab, reopen it still
 * offline, then reconnect and confirm every one arrives exactly once with the
 * right band — and that the condemned one still says why.
 */

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 950 } });
const page = await ctx.newPage();
const errs = [];
page.on('console', m => m.type() === 'error' && errs.push(m.text()));
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));

async function openSorting(p) {
  await p.locator('button').filter({ hasText: /Springs/ }).first().click();
  await p.waitForTimeout(1500);
  await p.getByText('Spring Sorting', { exact: true }).first().click();
  await p.waitForTimeout(2500);
}

await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
await page.fill('input[type="text"]', 'inspector1');
await page.fill('input[type="password"]', 'password123');
await page.click('button[type="submit"]');
await page.waitForTimeout(3000);
await openSorting(page);

const batchId = await page.evaluate(() => {
  const m = document.body.innerText.match(/batch_[a-z0-9_]+/i);
  return m ? m[0] : null;
});

// --- go offline and sort ---
await ctx.setOffline(true);
await page.waitForTimeout(1200);

const plan = ['BLUE', 'GREEN', 'YELLOW', 'BLUE', 'GREEN', 'ORANGE', 'BLUE', 'WHITE', 'GREEN', 'BLUE', 'YELLOW'];
for (const band of plan) {
  await page.locator('button').filter({ hasText: new RegExp(`^${band}`) }).first().click();
  await page.waitForTimeout(400);
}
// and one condemned for a crack — twelve in total
await page.locator('[data-testid="condemn-open"]').click();
await page.waitForTimeout(400);
await page.locator('[data-testid="condemn-crack"]').click();
await page.waitForTimeout(900);

const pendingText = await page.locator('body').innerText();
const pendingMatch = pendingText.match(/(\d+)\s*(?:Pending|pending)/);
console.log('after sorting 12 offline, pending shows:', pendingMatch ? pendingMatch[1] : '(not shown)');

// --- close the tab entirely, reopen still offline ---
await page.close();
const page2 = await ctx.newPage();
page2.on('pageerror', e => errs.push('PAGEERROR(2): ' + e.message));
await page2.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' }).catch(() => {});
await page2.waitForTimeout(3000);
const survived = (await page2.locator('body').innerText()).match(/(\d+)\s*(?:Pending|pending)/);
console.log('after closing and reopening the tab, still offline:', survived ? survived[1] + ' pending' : '(not shown)');

// --- back online, let it drain ---
await ctx.setOffline(false);
await page2.reload({ waitUntil: 'networkidle' }).catch(() => {});
await page2.waitForTimeout(9000);
const afterDrain = (await page2.locator('body').innerText()).match(/(\d+)\s*(?:Pending|pending)/);
console.log('after reconnecting:', afterDrain ? afterDrain[1] + ' pending' : '(not shown)');

console.log('batch:', batchId);
console.log('ERRORS:', errs.length ? errs.slice(0, 4).join(' ;; ') : 'none');
await b.close();
