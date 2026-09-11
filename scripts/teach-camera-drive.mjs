#!/usr/bin/env node
/**
 * Drive the teaching screen the way the DRM will see it
 * Indian Railways WRS Raipur
 *
 * Green tests are not evidence. This signs in as a real inspector, opens the
 * real screen in a real browser, feeds the camera drawn springs through a fake
 * video device, and taps the answers — then checks the three things that make
 * the demonstration honest rather than a puppet show:
 *
 *   1. It starts knowing nothing and says so.
 *   2. After twenty of each it names one it has never seen.
 *   3. What it learned is on the SERVER, so it survives the browser being
 *      closed and the machine being rebuilt from a backup.
 *
 *   npm run dev                              # in one terminal
 *   node scripts/teach-camera-drive.mjs      # in another
 *
 * DELIBERATELY NOT PART OF PREFLIGHT
 * ----------------------------------
 * The other browser drills are read-mostly. This one TEACHES: thirty drawn
 * springs go into vision_examples, which is append-only by design. On a
 * developer's machine that is harmless. On the shop's machine — where preflight
 * is exactly what somebody would run before go-live — it would seed the
 * camera's memory with cartoons that can never be removed. So it is a
 * deliberate run, it refuses a database that holds anything real, and the
 * pipeline itself is proven in preflight by vision-brain-proof.mjs, which
 * writes nothing.
 */

import { chromium } from 'playwright';

/*
 * The BUILT client, as the other browser drills use — the artefact the shop
 * actually installs. The preview proxies /api through to the server, so there
 * is one URL here rather than two that can drift apart.
 */
const BASE = process.env.APP_URL || 'http://localhost:4173';
const API = process.env.API_URL || `${BASE}/api`;
/*
 * Ten of each rather than twenty. The claim being checked here is that the
 * screen teaches and remembers, and thirty taps establish that as well as
 * sixty do — at software-rasterised speed, sixty is a twenty-minute run for no
 * extra evidence. Whether twenty per class is enough for accuracy is a
 * different question, answered by scripts/vision-brain-proof.mjs.
 */
const PER_CLASS = Number(process.env.PER_CLASS || 10);

/*
 * Everything this drive teaches is stamped with this, and the stamp is what
 * makes the guard below possible.
 *
 * The springs here are DRAWN, not photographed. They are good enough to prove
 * the screen teaches and remembers, and they are nothing like a real spring in
 * a real shed. Left in a shop's database they would do two kinds of harm: the
 * camera would compare real springs against cartoons, and the readiness panel
 * would count thirty cartoons as thirty pieces of evidence — the one number in
 * this system that must never be inflated.
 *
 * vision_examples is append-only by trigger, deliberately: it is the evidence
 * for why the camera said what it said. So these rows cannot be tidied away
 * afterwards. The only safe answer is to refuse to write them in the first
 * place, which is what the guard does.
 */
const SYNTHETIC_MARK = 'SYNTHETIC_DRIVE';

const TYPES = {
  OUTER:   { coils: 9,  wire: 13, width: 0.62, height: 0.86 },
  INNER:   { coils: 13, wire: 7,  width: 0.36, height: 0.84 },
  SNUBBER: { coils: 5,  wire: 15, width: 0.44, height: 0.52 }
};

/*
 * The two GL flags are not cosmetic. Headless Chromium has no GPU, so TensorFlow
 * falls back to a pure-CPU backend, and on that path loading the detector alone
 * measured 233 seconds — which reads as a hung application rather than a slow
 * one. Software rasterisation brings it to about 8. A real shop laptop with a
 * real GPU is faster than either, and the app now measures the machine it finds
 * and drops the detector when it is too slow (see DETECT_BUDGET_MS).
 */
const browser = await chromium.launch({
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader'
  ]
});
const ctx = await browser.newContext({ permissions: ['camera'] });
const page = await ctx.newPage();

await page.route('**/api/vision/brain/teach', (route) => {
  const req = route.request();
  let body = {};
  try {
    body = JSON.parse(req.postData() || '{}');
  } catch {
    /* leave it */
  }
  return route.continue({ postData: JSON.stringify({ ...body, partName: SYNTHETIC_MARK }) });
});

const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
const failedCalls = [];
page.on('response', (r) => {
  if (r.url().includes('/api/') && r.status() >= 400) failedCalls.push(`${r.status()} ${r.url()}`);
});

console.log('Signing in as inspector1...');
await page.goto(BASE);
await page.fill('input[name="username"], input[type="text"]', 'inspector1');
await page.fill('input[type="password"]', 'password123');
await page.click('button[type="submit"]');
await page.waitForTimeout(2500);

// Reach the sorting bench, whichever way this build labels the way there.
const openedSorting = await page.evaluate(() => {
  const wanted = /spring|सॉर्ट|sorting/i;
  const btn = [...document.querySelectorAll('button,a')].find((b) => wanted.test(b.textContent || ''));
  if (btn) { btn.click(); return true; }
  return false;
});
if (!openedSorting) {
  console.error('Could not find a way to Spring Sorting from the landing screen.');
  process.exit(1);
}
await page.waitForTimeout(2000);

/*
 * Refuse to run against a database that holds anything real.
 *
 * A real teaching has no partName; ours carry SYNTHETIC_MARK. If even one
 * unmarked example exists, this is a shop's database — or a developer's that
 * is standing in for one — and thirty cartoons must not be written into it.
 * The override exists for a developer who knows exactly what they are doing
 * and is prepared to say so in the environment.
 */
const before = await page.evaluate(async () => {
  const r = await fetch('/api/vision/brain?domain=SPRING', {
    headers: { authorization: `Bearer ${localStorage.getItem('wrs_token')}` }
  });
  const b = await r.json().catch(() => null);
  const examples = b?.data?.examples || [];
  return {
    total: examples.length,
    real: examples.filter((e) => e.partName !== 'SYNTHETIC_DRIVE').length
  };
});

if (before.real > 0 && process.env.TEACH_DRIVE_ALLOW_REAL_DB !== '1') {
  console.error(`
REFUSING TO RUN.

This database holds ${before.real} taught photograph${before.real === 1 ? '' : 's'} that did not come
from this drive. That makes it a real database, and this drive would write
${PER_CLASS * 3} DRAWN springs into it — permanently, because what the camera is
taught is append-only evidence.

The camera would then compare real springs against cartoons, and the readiness
panel would count cartoons as evidence.

Run this against a fresh database, or set TEACH_DRIVE_ALLOW_REAL_DB=1 if you
are a developer and this is not a shop's machine.
`);
  process.exit(2);
}

const panel = page.locator('[data-testid="teach-the-camera"]');
await panel.waitFor({ timeout: 15000 });
console.log('The teaching panel is on the sorting page.');

/*
 * 1. Does it admit what it knows?
 *
 * Only a genuinely empty installation can be asked to say it knows nothing,
 * and this table is append-only by design — there is no way to empty it again
 * once a single spring has been taught, which is the point of it. So the check
 * adapts: on a fresh database it insists on the honest empty message, and on a
 * used one it reports what is already there and carries on with the parts that
 * can still be proven.
 */
const startingCount = await page.evaluate(async () => {
  const token = localStorage.getItem('wrs_token');
  const r = await fetch('/api/vision/brain?domain=SPRING', {
    headers: { authorization: `Bearer ${token}` }
  });
  const b = await r.json();
  return b?.meta?.total ?? 0;
});

const empty = (await page.locator('[data-testid="teach-accuracy"]').innerText()).trim();
console.log(`\n1. This installation already holds ${startingCount} taught photographs.`);
console.log(`   The screen says: "${empty.split('\n')[0]}"`);

if (startingCount === 0) {
  if (!/knows nothing/i.test(empty)) {
    console.error('   FAIL — a fresh installation must say plainly that it knows nothing.');
    process.exit(1);
  }
  console.log('   Correct: nothing is pre-loaded and it does not pretend otherwise.');
} else {
  console.log('   Not a fresh installation, so the "knows nothing" wording is not checked here.');
  console.log('   (TC-VBR-01 covers that against an empty database.)');
}

/*
 * Draw a spring onto a canvas the page owns, and make sure the screen's own
 * <video> is showing that canvas.
 *
 * Self-contained and idempotent on purpose. An earlier version stashed the
 * canvas and its draw function on `window` once, then called back into them
 * for sixty taps — and any reload in between (the service worker announcing
 * itself is enough) silently took them away, which presented as the drive
 * hanging rather than as an error. Recreating whatever is missing on every
 * call costs nothing and cannot fail that way.
 */
async function showSpring(page, TYPES, label) {
  await page.evaluate(
    ({ TYPES, label }) => {
      const w = window;
      if (!w.__benchCanvas) {
        const c = document.createElement('canvas');
        c.width = c.height = 480;
        w.__benchCanvas = c;
        w.__benchSeed = 999;
      }
      const c = w.__benchCanvas;
      const rnd = () => {
        w.__benchSeed = (w.__benchSeed * 1103515245 + 12345) % 2147483648;
        return w.__benchSeed / 2147483648;
      };

      const spec = TYPES[label];
      const g = c.getContext('2d');
      const bg = 90 + rnd() * 90;
      g.fillStyle = `rgb(${bg},${bg - 6},${bg - 12})`;
      g.fillRect(0, 0, 480, 480);
      for (let i = 0; i < 7; i++) {
        g.fillStyle = `rgba(${(rnd() * 255) | 0},${(rnd() * 255) | 0},${(rnd() * 255) | 0},0.28)`;
        g.fillRect(rnd() * 480, rnd() * 480, 26 + rnd() * 90, 26 + rnd() * 90);
      }
      g.save();
      g.translate(240, 240);
      g.rotate((rnd() - 0.5) * 0.5);
      const sc = 0.82 + rnd() * 0.34;
      g.scale(sc * 2.14, sc * 2.14);
      const h = spec.height * 200;
      const wd = spec.width * 200;
      const rust = rnd();
      const grad = g.createLinearGradient(-wd / 2, 0, wd / 2, 0);
      grad.addColorStop(0, rust > 0.5 ? '#7a4a28' : '#6d7078');
      grad.addColorStop(0.5, rust > 0.5 ? '#b8763c' : '#c2c6cc');
      grad.addColorStop(1, rust > 0.5 ? '#5c3720' : '#4e5157');
      g.strokeStyle = grad;
      g.lineWidth = spec.wire;
      g.lineCap = 'round';
      for (let i = 0; i < spec.coils; i++) {
        const y = -h / 2 + (i + 0.5) * (h / spec.coils);
        g.beginPath();
        g.ellipse(0, y, wd / 2, h / spec.coils / 1.8, 0, 0, Math.PI * 2);
        g.stroke();
      }
      g.restore();

      // Point the screen's own <video> at the bench canvas, so everything
      // downstream — the crop, the embedding, the vote — is the real path.
      // Attached only after the first draw, never before: a canvas with no
      // frames leaves the video at readyState 0 for ever.
      const video = document.querySelector('[data-testid="teach-the-camera"] video');
      if (video && w.__benchAttached !== c) {
        video.srcObject = c.captureStream(10);
        w.__benchAttached = c;
        video.play().catch(() => {});
      }
    },
    { TYPES, label }
  );
}

await page.click('[data-testid="teach-camera-toggle"]');

/*
 * Wait for the screen to say it is ready, rather than sleeping and hoping.
 * The first attempt slept 2 seconds; the camera took 3, and the failure read
 * as "the button is not enabled" rather than "you did not wait long enough".
 */
await page.waitForFunction(
  () => {
    const b = document.querySelector('[data-testid="teach-camera-look"]');
    return b && !b.disabled;
  },
  { timeout: 30000 }
);

await showSpring(page, TYPES, 'OUTER');
await page.waitForFunction(
  () => {
    const v = document.querySelector('[data-testid="teach-the-camera"] video');
    return v && v.videoWidth > 0 && v.readyState >= 2;
  },
  { timeout: 30000 }
);

console.log(`\n2. Teaching it ${PER_CLASS} of each kind, the way an inspector would...`);
const labels = Object.keys(TYPES);
let firstNamed = null;
for (let round = 0; round < PER_CLASS; round++) {
  for (const label of labels) {
    const tapStart = Date.now();
    process.stdout.write(`   [${round + 1}/${PER_CLASS}] drawing ${label}... `);
    await showSpring(page, TYPES, label);
    await page.waitForTimeout(120);
    await page.click('[data-testid="teach-camera-look"]');
    // The first look pays for loading both sets of weights; give it room.
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="teach-camera-look"]').disabled,
      { timeout: round === 0 ? 180000 : 60000 }
    );
    const said = (await page.locator('[data-testid="teach-proposal"]').innerText()).trim();
    if (!firstNamed && said === label) firstNamed = { round: round + 1, label };
    await page.click(`[data-testid="teach-label-${label}"]`);
    await page.waitForTimeout(90);
    process.stdout.write(
      `it said ${said.replace(/\n/g, ' ').slice(0, 18).padEnd(20)} ${Date.now() - tapStart} ms\n`
    );
  }
  if ((round + 1) % 5 === 0) process.stdout.write(`   ${(round + 1) * labels.length} taught\n`);
}

console.log(
  firstNamed
    ? `   It first named a spring correctly on round ${firstNamed.round} (${firstNamed.round * 3} photographs in).`
    : '   It never named one correctly during teaching.'
);

// 3. Now a spring it has never seen.
console.log('\n3. Showing it three it has never seen:');
let right = 0;
for (const label of labels) {
  await showSpring(page, TYPES, label);
  await page.waitForTimeout(150);
  await page.click('[data-testid="teach-camera-look"]');
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="teach-camera-look"]').disabled,
    { timeout: 60000 }
  );
  const said = (await page.locator('[data-testid="teach-proposal"]').innerText()).trim();
  const ok = said === label;
  if (ok) right++;
  console.log(`   shown ${label.padEnd(8)} -> it said ${said.padEnd(14)} ${ok ? 'correct' : ''}`);
}

const score = (await page.locator('[data-testid="teach-accuracy"]').innerText()).trim();
console.log(`\n4. Its own score, held out:\n   ${score.split('\n').slice(0, 2).join('\n   ')}`);

// 5. Did any of it reach the server? Close the browser entirely and ask.
const token = await page.evaluate(() => localStorage.getItem('wrs_token'));
await browser.close();

const res = await fetch(`${API}/vision/brain?domain=SPRING`, {
  headers: { authorization: `Bearer ${token}` }
});
const body = await res.json();
const stored = body?.data?.examples?.length ?? 0;
const counts = body?.data?.counts?.CATEGORY ?? {};

console.log(`
5. With the browser closed, the server holds ${stored} taught photographs
   (${startingCount} before this run, so ${stored - startingCount} were added by it).
   ${JSON.stringify(counts)}
   This is what survives the machine being formatted — it is inside the
   database the weekly backup carries off.

Console errors:    ${consoleErrors.length ? consoleErrors.join('\n  ') : 'none'}
Failed API calls:  ${failedCalls.length ? failedCalls.join('\n  ') : 'none'}
`);

const ok =
  right === labels.length &&
  stored >= startingCount + PER_CLASS * labels.length &&
  consoleErrors.length === 0 &&
  failedCalls.length === 0;

console.log(ok ? 'PASS — taught in the browser, remembered on the server.' : 'FAIL — see above.');
process.exit(ok ? 0 : 1);
