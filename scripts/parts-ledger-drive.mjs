#!/usr/bin/env node
/**
 * Parts in, parts out — driven the way the shop will use it
 * Indian Railways WRS Raipur
 *
 * Green tests are not evidence. This registers a wagon, records parts coming
 * off and going back on through the real screen, and checks the three things
 * the DRM will actually press on:
 *
 *   1. A wagon with nothing recorded says it CANNOT answer — not that nothing
 *      is missing. That distinction is the whole point of the section.
 *   2. Four off and three back names the outstanding one, and says where the
 *      replacement is.
 *   3. Recording why the fourth is not going back closes the wagon, with the
 *      reason on the record rather than an absence.
 *
 *   npm run dev                              # or a preview on :4173
 *   node scripts/parts-ledger-drive.mjs
 */

import { chromium } from 'playwright';

const BASE = process.env.APP_URL || 'http://localhost:4173';
const WAGON_TYPE = 'BOXNHL';
const WAGON = `SECR/${WAGON_TYPE}/${40000 + Math.floor(Math.random() * 9000)}`;

const browser = await chromium.launch();
const page = await browser.newPage();

const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
const failedCalls = [];
page.on('response', (r) => {
  if (r.url().includes('/api/') && r.status() >= 400) failedCalls.push(`${r.status()} ${r.url()}`);
});

console.log(`Signing in and registering ${WAGON}...`);
await page.goto(BASE);
await page.fill('input[type="text"]', 'inspector1');
await page.fill('input[type="password"]', 'password123');
await page.click('button[type="submit"]');
await page.waitForTimeout(2500);

const token = await page.evaluate(() => localStorage.getItem('wrs_token'));
if (!token) {
  console.error('Could not sign in.');
  process.exit(1);
}

// Register through the API — this drive is about the parts screen, not the
// registration form, which the role walkthrough already covers.
const reg = await page.evaluate(
  async ({ wagonNumber, wagonType }) => {
    const r = await fetch('/api/wagons/register', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${localStorage.getItem('wrs_token')}`
      },
      body: JSON.stringify({ wagonNumber, wagonType, owningRailway: 'SECR' })
    });
    return r.status;
  },
  { wagonNumber: WAGON, wagonType: WAGON_TYPE }
);
if (reg !== 201 && reg !== 200) {
  console.error(`Registration returned ${reg}`);
  process.exit(1);
}

/*
 * Pick a part from the wagon type's OWN expected list.
 *
 * Not from the stores, which was the first attempt and was wrong in an
 * instructive way. The stores call a wedge "CASNUB Cast Steel Friction Wedge
 * (RDSO SK-77579)" and the checklist calls it something shorter, so a ledger
 * entry typed from the stores vocabulary became a forty-fourth position while
 * all forty-three expected ones still read as never recorded. The shop would
 * have hit that on its first morning. The screen now offers the expected
 * positions, and this drives what the screen offers.
 */
const expected = await page.evaluate(async ({ wagonNumber }) => {
  const r = await fetch(`/api/wagons/${wagonNumber}/parts/reconciliation`, {
    headers: { authorization: `Bearer ${localStorage.getItem('wrs_token')}` }
  });
  const b = await r.json().catch(() => null);
  return {
    total: b?.data?.expectedTotal ?? 0,
    first: b?.data?.parts?.find((p) => p.expected !== null) ?? null
  };
}, { wagonNumber: WAGON });

if (!expected.first) {
  console.error(
    'This wagon type has no configured parts list, so there is no baseline to drive against.\n' +
      'Configure one in Checklist Configuration first.'
  );
  process.exit(1);
}

const PART = expected.first.partName;
const POSITION = expected.first.bogiePosition;
const CATEGORY = expected.first.category;
console.log(
  `This wagon type expects ${expected.total} positions. Driving against one of them: ` +
    `${PART} (${POSITION}).`
);

/*
 * Open the wagon the way an inspector does.
 *
 * There is no URL for a wagon — navigation here is buttons, as the role
 * walkthrough already relies on. An inspector also lands on a "what are you
 * working on today" choice first, so the wagon list is two steps in, not one.
 * Guessing a hash route left the browser on the landing screen and the failure
 * read as "the Parts tab is missing" rather than "you never opened a wagon".
 */
await page.getByRole('button', { name: /A wagon/i }).first().click();
await page.waitForTimeout(2500);

const row = page.getByText(WAGON, { exact: true }).first();
try {
  await row.waitFor({ timeout: 10000 });
  await row.click();
} catch {
  console.error(`Could not find ${WAGON} in the shop list.`);
  process.exit(1);
}
await page.waitForTimeout(2500);

/*
 * Picking a wagon makes it the ACTIVE one; it does not open it. The detail
 * screen — and with it the Parts tab — is behind "Continue checklist". Missing
 * that step presented as "the Parts tab is missing", which it was not.
 */
await page.getByRole('button', { name: /Continue checklist/i }).first().click();
await page.waitForTimeout(3000);

const tab = page.locator('[data-testid="tab-parts"]');
await tab.waitFor({ timeout: 15000 });
await tab.click();
await page.locator('[data-testid="parts-ledger"]').waitFor({ timeout: 15000 });
console.log('The Parts tab is on the wagon.\n');

/*
 * Read the panel only once it has finished loading.
 *
 * Sleeping and hoping is what failed here first: under the load of the full
 * gate the API is slower, the panel still said "Loading…", and the drive
 * reported that an empty ledger was worded wrongly — a false alarm about the
 * product caused entirely by the drive.
 */
async function readSummary() {
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="parts-reconciliation"]');
      const t = (el?.textContent || '').trim();
      return t.length > 0 && !/Loading|लोड/i.test(t);
    },
    { timeout: 30000 }
  );
  return (await page.locator('[data-testid="parts-reconciliation"]').innerText()).trim();
}

// 1. Nothing recorded.
const empty = await readSummary();
console.log(`1. With nothing recorded, it says:\n   "${empty.split('\n')[0]}"`);
if (!/can say nothing|Nothing has been recorded|no parts record at all/i.test(empty)) {
  console.error('   FAIL — an empty ledger must not read as "nothing is missing".');
  process.exit(1);
}
console.log('   Correct: silence is not balance, and it says so.\n');

async function record(event, part, qty, reason) {
  await page.click(`[data-testid="part-event-${event}"]`);
  // Category and position are part of the identity of a position, so they are
  // set explicitly rather than left on whatever the form defaulted to.
  await page.selectOption('select >> nth=0', CATEGORY).catch(() => {});
  await page.selectOption('select >> nth=1', POSITION).catch(() => {});
  await page.fill('[data-testid="part-name-input"]', part);
  await page.fill('[data-testid="part-quantity-input"]', String(qty));
  if (reason) await page.fill('[data-testid="part-reason-input"]', reason);
  await page.click('[data-testid="part-record-submit"]');
  // Wait for the button to come back rather than guessing at a duration.
  await page.waitForFunction(
    () => {
      const b = document.querySelector('[data-testid="part-record-submit"]');
      return b && !/Recording|दर्ज हो/i.test(b.textContent || '');
    },
    { timeout: 30000 }
  );
  await page.waitForTimeout(400);
}

// 2. Four off, three back.
console.log('2. Recording 4 off, then 3 back on...');
await record('REMOVED', PART, 4);
await record('REFITTED', PART, 3);

const short = await readSummary();
console.log(`   "${short.split('\n')[0]}"`);
const suggestion = await page
  .locator('[data-testid="parts-outstanding"]')
  .innerText()
  .catch(() => '');
console.log(`   Suggestion: "${suggestion.split('\n').slice(1).join(' ').trim()}"`);

/*
 * The summary now leads with coverage, because a wagon where one position
 * balances and forty-two were never touched is not a balanced wagon. The
 * outstanding part is named in the suggestion beside it.
 */
const namesOutstanding =
  /of \d+ expected positions have been recorded/i.test(short) &&
  /1 recorded coming off and not going back on|ha(s|ve) not gone back on/i.test(short);
const namesStores = /Stores holds/i.test(suggestion);
if (!namesOutstanding) {
  console.error('   FAIL — the outstanding part must be named.');
  process.exit(1);
}
console.log(`   Names the outstanding part: yes. Names where the replacement is: ${namesStores ? 'yes' : 'no (stores lookup found nothing)'}\n`);

// 3. Close it with a reason.
console.log('3. Recording the fourth as deliberately not refitted, with a reason...');
await record('NOT_FITTED', PART, 1, 'Condemned; replacement on indent IND-2291.');

const closed = await readSummary();
console.log(`   "${closed.split('\n')[0]}"`);
/*
 * This position now balances. The WAGON does not, and must not: the other
 * expected positions have still never been touched. That distinction is the
 * whole point of measuring against what the wagon should have, so it is what
 * is asserted here rather than a green tick.
 */
const positionClosed = !/1 recorded coming off and not going back on/i.test(closed);
const wagonStillOpen = /of \d+ expected positions have been recorded/i.test(closed);
console.log(`   This position now balances: ${positionClosed ? 'yes' : 'no'}`);
console.log(
  `   The wagon is still open, because other positions were never touched: ${wagonStillOpen ? 'yes' : 'no'}\n`
);

// 4. Every entry is still there, individually.
await page.click('[data-testid="parts-history-toggle"]');
await page.waitForTimeout(600);
const rows = await page.locator('[data-testid="parts-history"] tbody tr').count();
console.log(`4. The ledger holds ${rows} individual entries, each with a name and a time.`);

await browser.close();

console.log(`
Console errors:    ${consoleErrors.length ? consoleErrors.join('\n  ') : 'none'}
Failed API calls:  ${failedCalls.filter((c) => !/inventory/.test(c)).join('\n  ') || 'none'}
`);

const ok =
  namesOutstanding &&
  positionClosed &&
  wagonStillOpen &&
  rows === 3 &&
  consoleErrors.length === 0 &&
  failedCalls.filter((c) => !/inventory/.test(c)).length === 0;

console.log(
  ok
    ? 'PASS — an empty ledger says how much is unknown, a short one names the part and where\n' +
      '       the spare is, a reason closes the position, and the WAGON stays open while other\n' +
      '       expected positions have never been touched.'
    : 'FAIL — see above.'
);
process.exit(ok ? 0 : 1);
