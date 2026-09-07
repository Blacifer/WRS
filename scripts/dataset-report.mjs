/**
 * How far the shop's own photographs have got
 * Indian Railways WRS Raipur
 *
 * WHY THIS EXISTS
 * ---------------
 * The DRM asked for a camera that names a spring's category, its band and its
 * damage. Three of those four things are reachable; none of them is reachable
 * without examples. On 6 September 2026 this database held ZERO photographs,
 * so nothing could be built and — more importantly — nothing could be
 * measured.
 *
 * Every frame is labelled for free: sorting already asks the inspector for the
 * answer (position from the selector, band from the strip, pass or condemned
 * from the verdict), so switching "Photograph springs while sorting" on turns
 * a shift into a few hundred labelled examples at no extra tap.
 *
 * This prints what has actually accumulated. It is deliberately blunt about
 * the thinnest class rather than the total: a set of two thousand outer
 * springs and eleven snubbers trains a model that has never really seen a
 * snubber, and a headline total hides exactly that.
 *
 *   node scripts/dataset-report.mjs [path/to/wrs_inspections.db]
 *
 * Read-only. Needs no running server.
 */

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';

/* The same thresholds the Vision Readiness panel reports against, so the
 * screen and this script cannot disagree about whether there is enough. */
const ATTEMPT_AT = 200;
const TRUST_AT = 1000;

const dbPath = process.argv[2]
  || path.resolve(process.cwd(), 'server', 'data', 'wrs_inspections.db');

if (!fs.existsSync(dbPath)) {
  console.error(`  No database at ${dbPath}`);
  console.error('  Pass the path as an argument, or run this from the repository root.');
  process.exit(1);
}

const db = new DatabaseSync(dbPath, { readOnly: true });

const one = (sql, ...args) => {
  try { return db.prepare(sql).get(...args); } catch { return null; }
};
const all = (sql, ...args) => {
  try { return db.prepare(sql).all(...args); } catch { return []; }
};

const total = one('SELECT COUNT(*) AS c FROM spring_images')?.c ?? 0;

console.log('');
console.log(`  Labelled spring photographs — ${path.basename(dbPath)}`);
console.log('  ' + '-'.repeat(58));

if (total === 0) {
  console.log('  None yet.');
  console.log('');
  console.log('  Nothing about the camera can be attempted or even measured until');
  console.log('  these exist. Switch on "Photograph springs while sorting" at the');
  console.log('  bench; the inspector is already giving the answer, so every frame');
  console.log('  is labelled at no extra tap.');
  console.log('');
  db.close();
  process.exit(0);
}

// ---------------------------------------------------------------------------
// By position — the classifier's classes, and the one that limits it.
// ---------------------------------------------------------------------------
const positions = all(`
  SELECT spring_position AS pos, COUNT(*) AS c
  FROM spring_images GROUP BY spring_position ORDER BY c DESC
`);

console.log(`  ${total} photographs, by position:`);
for (const p of positions) {
  const bar = '#'.repeat(Math.min(30, Math.round((p.c / total) * 30)));
  console.log(`    ${String(p.pos ?? 'unlabelled').padEnd(10)} ${String(p.c).padStart(6)}  ${bar}`);
}

const expected = ['OUTER', 'INNER', 'SNUBBER'];
const counts = Object.fromEntries(positions.map((p) => [p.pos, p.c]));
const thinnest = expected
  .map((p) => ({ pos: p, c: counts[p] ?? 0 }))
  .sort((a, b) => a.c - b.c)[0];

console.log('');
console.log(`  Thinnest class: ${thinnest.pos} at ${thinnest.c}.`);
console.log(
  thinnest.c >= TRUST_AT
    ? '    Enough to depend on.'
    : thinnest.c >= ATTEMPT_AT
    ? `    Worth attempting and scoring. ${TRUST_AT - thinnest.c} more before depending on it.`
    : `    ${ATTEMPT_AT - thinnest.c} more before this is worth attempting at all.`
);

// ---------------------------------------------------------------------------
// By band — the DRM's hardest ask, and the balance that decides it.
// ---------------------------------------------------------------------------
const bands = all(`
  SELECT COALESCE(labelled_band, '(none)') AS band, COUNT(*) AS c
  FROM spring_images GROUP BY labelled_band ORDER BY c DESC
`);

console.log('');
console.log('  By band:');
for (const b of bands) {
  console.log(`    ${String(b.band).padEnd(10)} ${String(b.c).padStart(6)}`);
}

const condemned = one(
  "SELECT COUNT(*) AS c FROM spring_images WHERE labelled_status = 'CONDEMNED'"
)?.c ?? 0;
console.log('');
console.log(`  Condemned (the rust and damage examples): ${condemned}`);

// ---------------------------------------------------------------------------
// A0 — the go/no-go the plan fixes in advance.
//
// A reading taken from a photograph is only worth building once it has been
// compared against what the fitter recorded, on the shop's own springs. This
// reports how many frames are even eligible for that comparison.
// ---------------------------------------------------------------------------
const withHeight = one(
  'SELECT COUNT(*) AS c FROM spring_images WHERE measured_height IS NOT NULL'
)?.c ?? 0;
const withBand = one(
  'SELECT COUNT(*) AS c FROM spring_images WHERE labelled_band IS NOT NULL'
)?.c ?? 0;

console.log('');
console.log('  Ready for the A0 agreement check:');
console.log(`    frames carrying the inspector's band   : ${withBand}`);
console.log(`    frames carrying a measured height too  : ${withHeight}`);
console.log('');
console.log('    The decision rule, fixed before the numbers arrive:');
console.log('      agreement 95% or better  -> build it as an assistive reading');
console.log('      80 to 95%                -> build it as a flag only, never a proposal');
console.log('      below 80%                -> say so plainly and stop');

// ---------------------------------------------------------------------------
// Storage, since these are base64 rows in the same file as the audit chain.
// ---------------------------------------------------------------------------
const bytes = one('SELECT COALESCE(SUM(LENGTH(image_data)), 0) AS c FROM spring_images')?.c ?? 0;
const mb = (n) => (n / (1024 * 1024)).toFixed(1);
console.log('');
console.log(`  Storage: ${mb(bytes)} MB of image data`);
if (total > 0) {
  console.log(`    averaging ${Math.round(bytes / total / 1024)} KB per photograph`);
}
console.log('');

db.close();
