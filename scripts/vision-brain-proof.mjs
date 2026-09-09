#!/usr/bin/env node
/**
 * Does the camera actually separate one kind of part from another?
 * Indian Railways WRS Raipur
 *
 * WHAT THIS PROVES, AND WHAT IT DOES NOT
 * --------------------------------------
 * It proves the whole chain works with no internet and nothing installed on
 * the machine beyond this application: the vendored MobileNet weights load
 * from disk, produce a 1280-value description of an image, and a
 * nearest-neighbour vote over those descriptions separates classes it was
 * taught from twenty examples each.
 *
 * It does NOT prove the camera can tell a real CASNUB outer spring from a real
 * inner spring in a Raipur shed. Nothing can prove that except real
 * photographs from that shed, and there are three in the database. The springs
 * here are drawn, not photographed, and drawn springs are easier than
 * photographed ones — even with the rotation, lighting and background clutter
 * added below. Treat the figure this prints as an upper bound, and the real
 * number as the one the leave-one-out score gives on the shop's own images.
 *
 * It is still worth running before the shop visit, because it is the
 * difference between "the design should work" and "the weights load offline
 * and the arithmetic separates things", and only one of those is a fact.
 *
 *   node scripts/vision-brain-proof.mjs
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
const PUBLIC = path.join(ROOT, 'client', 'public');

const TYPES = {
  // Drawn to differ the way the three genuinely differ on a bench: coil
  // count, wire thickness and overall proportion. Nothing here encodes the
  // label directly — no colour coding, no text — because a model that learned
  // a colour would score perfectly and mean nothing.
  OUTER:   { coils: 9,  wire: 13, width: 0.62, height: 0.86 },
  INNER:   { coils: 13, wire: 7,  width: 0.36, height: 0.84 },
  SNUBBER: { coils: 5,  wire: 15, width: 0.44, height: 0.52 }
};

const TEACH_PER_CLASS = 20;
const TEST_PER_CLASS = 15;

// ---------------------------------------------------------------------------
// A static server for the vendored weights. The point of the exercise is that
// nothing is fetched from the internet, so the page may only reach this.
// ---------------------------------------------------------------------------
const MIME = { '.json': 'application/json', '.html': 'text/html' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent((req.url || '/').split('?')[0]);
  if (rel === '/') {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end('<!doctype html><meta charset="utf-8"><title>proof</title><body></body>');
  }
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    return res.end('not found');
  }
  res.writeHead(200, {
    'content-type': MIME[path.extname(file)] || 'application/octet-stream',
    'access-control-allow-origin': '*'
  });
  fs.createReadStream(file).pipe(res);
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const ORIGIN = `http://127.0.0.1:${PORT}`;

const tfjs = path.join(ROOT, 'client', 'node_modules', '@tensorflow', 'tfjs', 'dist', 'tf.min.js');
const mnjs = path.join(
  ROOT, 'client', 'node_modules', '@tensorflow-models', 'mobilenet', 'dist', 'mobilenet.min.js'
);
for (const f of [tfjs, mnjs]) {
  if (!fs.existsSync(f)) {
    console.error(`Missing ${f}\nRun: cd client && npm install`);
    process.exit(1);
  }
}

const browser = await chromium.launch();
const page = await browser.newPage();

// Anything not served by us is a bug in this proof: the shed has no internet.
let offOrigin = 0;
await page.route('**/*', (route) => {
  if (route.request().url().startsWith(ORIGIN)) return route.continue();
  offOrigin++;
  return route.abort();
});

page.on('console', (m) => {
  if (m.type() === 'error') console.error('  browser error:', m.text());
});

await page.goto(ORIGIN + '/');
await page.addScriptTag({ path: tfjs });
await page.addScriptTag({ path: mnjs });

console.log('Loading the vendored MobileNet weights from disk...');
const result = await page.evaluate(
  async ({ TYPES, TEACH_PER_CLASS, TEST_PER_CLASS }) => {
    const t0 = performance.now();
    const model = await window.mobilenet.load({
      version: 2,
      alpha: 1.0,
      modelUrl: '/models/mobilenet/model.json'
    });
    const loadMs = Math.round(performance.now() - t0);

    // -- a drawn spring, with the nuisances a shed actually adds ------------
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };

    function draw(spec) {
      const c = document.createElement('canvas');
      c.width = c.height = 224;
      const g = c.getContext('2d');

      // Background: a different shade and some clutter every time, so the
      // brain cannot succeed by memorising the backdrop.
      const bg = 90 + rnd() * 90;
      g.fillStyle = `rgb(${bg},${bg - 6},${bg - 12})`;
      g.fillRect(0, 0, 224, 224);
      for (let i = 0; i < 7; i++) {
        g.fillStyle = `rgba(${rnd() * 255 | 0},${rnd() * 255 | 0},${rnd() * 255 | 0},0.28)`;
        g.fillRect(rnd() * 224, rnd() * 224, 12 + rnd() * 42, 12 + rnd() * 42);
      }

      g.save();
      g.translate(112, 112);
      g.rotate((rnd() - 0.5) * 0.5);          // handled at an angle
      const scale = 0.82 + rnd() * 0.34;       // nearer or further from the lens
      g.scale(scale, scale);

      const h = spec.height * 200;
      const w = spec.width * 200;
      // Steel, sometimes rusted, sometimes lit from a different side.
      const rust = rnd();
      const grad = g.createLinearGradient(-w / 2, 0, w / 2, 0);
      grad.addColorStop(0, rust > 0.5 ? '#7a4a28' : '#6d7078');
      grad.addColorStop(0.5, rust > 0.5 ? '#b8763c' : '#c2c6cc');
      grad.addColorStop(1, rust > 0.5 ? '#5c3720' : '#4e5157');
      g.strokeStyle = grad;
      g.lineWidth = spec.wire;
      g.lineCap = 'round';

      // The coils themselves — an ellipse per turn down the height.
      for (let i = 0; i < spec.coils; i++) {
        const y = -h / 2 + (i + 0.5) * (h / spec.coils);
        g.beginPath();
        g.ellipse(0, y, w / 2, h / spec.coils / 1.8, 0, 0, Math.PI * 2);
        g.stroke();
      }
      g.restore();
      return c;
    }

    async function embed(canvas) {
      const t = model.infer(canvas, true);
      const raw = await t.data();
      t.dispose();
      let s = 0;
      for (let i = 0; i < raw.length; i++) s += raw[i] * raw[i];
      const n = Math.sqrt(s) || 1;
      return Array.from(raw, (v) => v / n);
    }

    const taught = [];
    const held = [];
    for (const [label, spec] of Object.entries(TYPES)) {
      for (let i = 0; i < TEACH_PER_CLASS; i++) {
        taught.push({ label, e: await embed(draw(spec)) });
      }
      for (let i = 0; i < TEST_PER_CLASS; i++) {
        held.push({ label, e: await embed(draw(spec)) });
      }
    }

    const dims = taught[0].e.length;
    const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

    // The same rule as client/src/services/visionBrain.ts, restated here
    // rather than imported, because this page is plain JavaScript with no
    // bundler. If the two ever disagree, this proof is the one that is wrong.
    const K = 5, SIM = 0.62, CONF = 0.65;
    function predict(q) {
      const scored = taught
        .map((t) => ({ label: t.label, s: dot(t.e, q) }))
        .sort((a, b) => b.s - a.s)
        .slice(0, K);
      if (scored[0].s < SIM) return { label: null, nearest: scored[0].s };
      const votes = {};
      let total = 0;
      for (const n of scored) {
        votes[n.label] = (votes[n.label] || 0) + Math.max(0, n.s);
        total += Math.max(0, n.s);
      }
      const [best, w] = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
      const conf = w / total;
      return conf < CONF
        ? { label: null, nearest: scored[0].s, conf }
        : { label: best, nearest: scored[0].s, conf };
    }

    let correct = 0, wrong = 0, abstained = 0;
    const confusion = {};
    for (const h of held) {
      const p = predict(h.e);
      if (!p.label) { abstained++; continue; }
      confusion[h.label] = confusion[h.label] || {};
      confusion[h.label][p.label] = (confusion[h.label][p.label] || 0) + 1;
      p.label === h.label ? correct++ : wrong++;
    }

    // How alike same-class and different-class images actually are. This is
    // the number that says whether the technique has any grip at all — if the
    // two overlap, no amount of voting will separate them.
    let same = [], diff = [];
    for (let i = 0; i < taught.length; i++) {
      for (let j = i + 1; j < taught.length; j++) {
        (taught[i].label === taught[j].label ? same : diff).push(dot(taught[i].e, taught[j].e));
      }
    }
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

    return {
      loadMs, dims,
      taught: taught.length, held: held.length,
      correct, wrong, abstained, confusion,
      sameClass: mean(same), diffClass: mean(diff)
    };
  },
  { TYPES, TEACH_PER_CLASS, TEST_PER_CLASS }
);

await browser.close();
server.close();

const answered = result.correct + result.wrong;
const acc = answered ? result.correct / answered : 0;
const pct = (n) => `${(n * 100).toFixed(1)}%`;

console.log(`
Weights loaded from disk in ${result.loadMs} ms; embedding is ${result.dims} values.
Requests to anything other than this app: ${offOrigin} (must be 0 — the shed has no internet).

Taught ${result.taught} images (${TEACH_PER_CLASS} per class).
Tested ${result.held} it had never seen (${TEST_PER_CLASS} per class).

  correct     ${result.correct}
  wrong       ${result.wrong}
  said "I do not know"  ${result.abstained}
  accuracy on the ones it answered   ${pct(acc)}

Average similarity between two images of the SAME class:      ${result.sameClass.toFixed(3)}
Average similarity between two images of DIFFERENT classes:   ${result.diffClass.toFixed(3)}
  (the gap between these two is what the whole approach rests on)

Confusion: ${JSON.stringify(result.confusion)}
`);

const gap = result.sameClass - result.diffClass;
const ok = offOrigin === 0 && result.dims === 1280 && acc >= 0.9 && gap > 0.05;

console.log(
  ok
    ? 'PASS — offline weights, 1280-value embeddings, and classes that separate.\n' +
      '       This is the pipeline working. It is NOT evidence about real springs;\n' +
      '       only photographs from the shed can give that.'
    : 'FAIL — see the numbers above.'
);
process.exit(ok ? 0 : 1);
