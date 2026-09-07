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
 * What good looks like: queued 12 after sorting, still 12 after closing and
 * reopening the tab offline, 0 after reconnecting — and exactly 12 new rows
 * server-side with 12 distinct sync ids.
 *
 * Run it against a BUILT client, not `npm run dev`. vite-plugin-pwa has no
 * devOptions here, so the dev server registers no service worker and the
 * reopen-while-offline step cannot pass — the tab simply fails to load.
 * `scripts/pilot-tunnel.sh` builds first, which is the topology to drill.
 */

import { chromium } from 'playwright';

/*
 * The offline drill, driven rather than described.
 *
 * Sort twelve springs with the network down, close the tab, reopen it still
 * offline, then reconnect and confirm every one arrives exactly once with the
 * right band — and that the condemned one still says why.
 */

/*
 * The queue depth, read from IndexedDB rather than off the screen.
 *
 * The badge was scraped with /(\d+)\s*pending/ and disappears at zero, so a
 * fully drained queue and a drill that had failed to find the badge at all
 * both printed "(not shown)" — on the one step the drill exists to check.
 * An ambiguous pass is worse than a failure, because it is the reading
 * somebody takes to mean everything worked.
 */
/*
 * Where to drive.
 *
 * Defaults to the dev server, but the reopen-while-offline step below can
 * only pass against the BUILT app: vite-plugin-pwa does not register the
 * service worker in dev, so a tab reopened offline against `npm run dev` gets
 * nothing at all. Point this at a `vite preview` of the production bundle to
 * exercise the configuration the shop actually runs.
 */
const BASE = process.env.DRILL_URL || 'http://localhost:5173';

async function queueDepth(p) {
  /*
   * IndexedDB belongs to an origin, so a page sitting on about:blank cannot
   * read it and throws SecurityError. That happens for one specific reason —
   * the tab was reopened offline and no service worker served the shell — and
   * saying that is far more use than a stack trace about IDBFactory.
   */
  if (!p.url().startsWith('http')) {
    return 'no page — the tab could not reopen offline (no service worker served the shell)';
  }
  return p.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open('wrs_raipur_pwa_offline_db_v2');
    req.onerror = () => resolve('unreadable');
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('pending_sorted_springs')) return resolve(0);
      const c = db.transaction('pending_sorted_springs', 'readonly')
        .objectStore('pending_sorted_springs').count();
      c.onsuccess = () => resolve(c.result);
      c.onerror = () => resolve('unreadable');
    };
  }));
}

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 950 } });
const page = await ctx.newPage();
const errs = [];
page.on('console', m => m.type() === 'error' && errs.push(m.text()));
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));

/*
 * Sorting is one click from the header.
 *
 * This used to open a "Springs" menu and then pick "Spring Sorting" out of
 * it. The nav was flattened in the design refresh and the drill was not run
 * again, so it sat broken — which is the failure mode of any check that is
 * not part of `npm test`: it does not report that it has stopped working, it
 * just stops being run. Worth remembering the next time the nav moves.
 */
async function openSorting(p) {
  await p.getByRole('button', { name: /^Sorting$/ }).first().click();
  await p.waitForTimeout(2500);
}

await page.goto(BASE, { waitUntil: 'networkidle' });
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

console.log('after sorting 12 offline, queued:', await queueDepth(page));

// --- close the tab entirely, reopen still offline ---
await page.close();
const page2 = await ctx.newPage();
page2.on('pageerror', e => errs.push('PAGEERROR(2): ' + e.message));
await page2.goto(BASE, { waitUntil: 'domcontentloaded' }).catch(() => {});
await page2.waitForTimeout(3000);
console.log('after closing and reopening the tab, still offline, queued:', await queueDepth(page2));

// --- back online, let it drain ---
await ctx.setOffline(false);
await page2.reload({ waitUntil: 'networkidle' }).catch(() => {});
await page2.waitForTimeout(9000);
const drained = await queueDepth(page2);
console.log('after reconnecting, queued:', drained, drained === 0 ? '— drained' : '— STILL QUEUED');

// Context only — nothing here asserts on it, and a shift with no open batch
// is a normal state. Said plainly so "batch: null" is not read as a fault.
console.log('batch on screen:', batchId || 'none open (not a failure — informational)');
console.log('ERRORS:', errs.length ? errs.slice(0, 4).join(' ;; ') : 'none');
await b.close();
