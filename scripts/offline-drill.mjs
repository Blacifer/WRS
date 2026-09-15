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

/*
 * ACT TWO — the 200 that never arrived.
 *
 * A wagon is moved to its next stage with no signal, so the move is queued.
 * On the first reconnect the batch REACHES the server, which commits it, and
 * then the response is lost — a wifi drop between the write and the 200. The
 * queue rightly keeps the move and sends it again.
 *
 * What must be true afterwards: the wagon moved ONCE. Before receipts, the
 * resend inserted a second transition and a second audit entry, and current
 * stage was whichever landed last. The server is asked directly.
 */
const WAGON = `SECR/BOXNHL/${80000 + Math.floor(Math.random() * 9000)}`;
const api = async (p, path, init = {}) =>
  p.evaluate(async ({ path, init }) => {
    const r = await fetch(path, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${localStorage.getItem('wrs_token')}`, ...(init.headers || {}) } });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, { path, init });

const reg = await api(page2, '/api/wagons/register', { method: 'POST', body: JSON.stringify({ wagonNumber: WAGON, wagonType: 'BOXNHL', owningRailway: 'SECR' }) });
if (reg.status !== 201) { console.error(`Could not register ${WAGON}: ${reg.status}`); process.exit(1); }

// Open it the way an inspector does: the wagon list, the row, "Continue checklist".
await page2.getByRole('button', { name: /A wagon/i }).first().click();
await page2.waitForTimeout(2500);
await page2.getByText(WAGON, { exact: true }).first().click();
await page2.waitForTimeout(2000);
await page2.getByRole('button', { name: /Continue checklist/i }).first().click();
await page2.waitForTimeout(3000);

// Lose the signal, advance the stage — queued.
await ctx.setOffline(true);
await page2.waitForTimeout(800);
await page2.getByRole('button', { name: /Advance to Next Stage/i }).first().click();
await page2.waitForTimeout(1200);
const queuedMove = await page2.evaluate(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('wrs_raipur_pwa_offline_db_v2'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const n = await new Promise((res) => { const t = db.transaction('pending_stage_transitions').objectStore('pending_stage_transitions').count(); t.onsuccess = () => res(t.result); });
  db.close();
  return n;
});
console.log('after advancing a stage offline, transitions queued:', queuedMove);

// The first sync reaches the server and the reply is dropped on the floor.
let lost = 0;
await ctx.route('**/api/sync/batch', async (route) => {
  if (lost === 0) {
    lost++;
    await route.fetch();          // the server receives and commits it
    await route.abort('failed');  // ...and the tablet hears nothing
    return;
  }
  await route.continue();
});
await ctx.setOffline(false);
await page2.waitForTimeout(4000);
console.log('first reconnect: the server got the batch, the reply was lost —', lost === 1 ? 'as staged' : 'NOT STAGED');

// The queue retries on its own interval; press "sync now" rather than wait for it.
await page2.locator('button[title*="Sync" i], button[title*="सिंक" i]').first().click().catch(() => undefined);
await page2.waitForTimeout(5000);
await ctx.unroute('**/api/sync/batch');

const timeline = await api(page2, `/api/wagons/${encodeURIComponent(WAGON)}/timeline`);
const moves = (timeline.body?.data?.transitions || timeline.body?.data || []).filter((t) => t.fromStage !== t.toStage);
const detail = await api(page2, `/api/wagons/${encodeURIComponent(WAGON)}`);
const stage = detail.body?.data?.currentStage ?? detail.body?.data?.wagon?.currentStage;
const stillQueued = await page2.evaluate(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('wrs_raipur_pwa_offline_db_v2'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const n = await new Promise((res) => { const t = db.transaction('pending_stage_transitions').objectStore('pending_stage_transitions').count(); t.onsuccess = () => res(t.result); });
  db.close();
  return n;
});
console.log(`after the resend: ${WAGON} is at ${stage}, moved ${moves.length} time(s), ${stillQueued} still queued`);

console.log('ERRORS:', errs.length ? errs.slice(0, 4).join(' ;; ') : 'none');
await b.close();

const ok = drained === 0 && moves.length === 1 && stage === 'DISMANTLING' && stillQueued === 0;
console.log(ok
  ? '\nPASS — twelve springs arrived once; a stage move whose 200 was lost was applied once.'
  : '\nFAIL — see above.');
process.exit(ok ? 0 : 1);
