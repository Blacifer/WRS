#!/usr/bin/env node
/**
 * Soak drill — a year of the bench, and how long every screen takes to read it
 * Indian Railways WRS Raipur
 *
 * The shop sorts about 700 springs a shift. A year of that is 150,000 rows
 * in spring_sorting_records, and every dashboard, forecast, report and
 * question reads them. Nothing in the test suites goes past a few thousand,
 * which is how an unindexed self-join sat there reading fine at 3,000 rows
 * and quadratic after. This writes a year, then times every read path the
 * screens use, in-process against the real router, and refuses if any of
 * them takes longer than a person will wait.
 *
 *   node --experimental-strip-types scripts/soak-drill.mjs [rows]   # default 150000
 */

import { mkdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'server', 'data', 'demo');
const DB = path.join(DIR, 'soak.db');
const ROWS = Number(process.argv[2]) || 150_000;
const LIMIT_MS = Number(process.env.SOAK_LIMIT_MS) || 3000;

// A .env with a real Zapheit key must not make Ask the Records call anyone.
process.env.ZAPHEIT_API_KEY = '';
process.env.NODE_ENV = 'test';

mkdirSync(DIR, { recursive: true });
for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) rmSync(f, { force: true });

const { createApp } = await import(path.join(ROOT, 'server', 'src', 'app.ts'));
const { getDatabase } = await import(path.join(ROOT, 'server', 'src', 'db', 'connection.ts'));
const { classifySpring } = await import(path.join(ROOT, 'shared', 'classification', 'engine.ts'));
const { getRDSOTable } = await import(path.join(ROOT, 'shared', 'classification', 'tables.ts'));
const { config } = await import(path.join(ROOT, 'server', 'src', 'config', 'index.ts'));
config.zapheitApiKey = null;

const app = createApp(DB);
const db = getDatabase();

// ---------------------------------------------------------------- write
console.log(`Writing ${ROWS.toLocaleString()} bench rows over 365 days...`);
const t0 = Date.now();
let s = 20260916;
const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const inspectors = ['usr_insp_001', 'usr_insp_002', 'usr_insp_003', 'usr_insp_004'];
const positions = ['OUTER', 'INNER', 'SNUBBER'];
const gauges = { OUTER: ['OSG-01', 'OSG-02'], INNER: ['ISG-01'], SNUBBER: ['SSG-02'] };
const insert = db.prepare(`
  INSERT INTO spring_sorting_records (
    id, batch_id, bogie_type, spring_condition, spring_position, measured_height, height_is_approximate,
    classified_band, band_roman, status, damage_type, condemnation_reason, table_reference,
    inspector_id, inspector_name, sync_id, supersedes, voided, gauge_code, gauge_calibration_state, measurement_source, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, NULL, NULL, ?, ?, ?, NULL, ?, ?, ?, 'UNRECORDED', 'MANUAL', ?)
`);
const tables = {};
for (const bt of ['CASNUB_22_NLB', 'CASNUB_22_HS']) for (const p of positions) {
  const t = getRDSOTable(bt, 'USED', p);
  tables[`${bt}|${p}`] = { nominal: typeof t.nominalFreeHeight === 'number' ? t.nominalFreeHeight : Math.max(...t.bands.map((b) => b.maxHeight)) - 2, condemnMin: t.condemningMinHeight };
}
db.exec('BEGIN');
let lastId = null;
for (let i = 0; i < ROWS; i++) {
  const daysAgo = Math.floor((i / ROWS) * 365);
  const bt = rand() < 0.65 ? 'CASNUB_22_NLB' : 'CASNUB_22_HS';
  const pos = positions[rand() < 0.5 ? 0 : rand() < 0.75 ? 1 : 2];
  const tab = tables[`${bt}|${pos}`];
  let h = tab.nominal - 2.5 + (rand() + rand() + rand() - 1.5) * 4.2;
  if (rand() < 0.06) h = tab.condemnMin - 0.4 - rand() * 3;
  h = Math.round(h * 2) / 2;
  const c = classifySpring({ bogieType: bt, condition: 'USED', position: pos, measuredHeight: h });
  const status = c.status === 'CONDEMNED' ? 'CONDEMNED' : 'PASS';
  const at = new Date(Date.now() - (365 - daysAgo) * 86400_000 + (i % 700) * 40_000).toISOString();
  const id = `soak_${i}`;
  // One in two hundred is a correction of the row before it; one in a thousand an undo.
  const corrects = i > 0 && rand() < 0.005;
  const voids = corrects && rand() < 0.2;
  const g = gauges[pos];
  insert.run(id, `soak-${daysAgo}`, bt, 'USED', pos, h, status === 'PASS' ? c.band : null, status === 'PASS' ? c.bandRoman : null, status,
    c.tableReference, inspectors[i % 4], 'Soak Inspector', corrects ? lastId : null, voids ? 1 : 0, g[i % g.length], at);
  lastId = id;
  if (i % 25_000 === 0 && i > 0) process.stdout.write(`  ${i.toLocaleString()}\n`);
}
db.exec('COMMIT');
console.log(`  written in ${((Date.now() - t0) / 1000).toFixed(1)} s; database ${(statSync(DB).size / 1048576).toFixed(1)} MB`);

// ----------------------------------------------------------------- read
const call = (method, url, body, token) => app.dispatch({ method, url, body, headers: token ? { authorization: `Bearer ${token}` } : {} });
const login = async (u) => (await call('POST', '/api/auth/login', { username: u, password: 'password123' })).body.token;
const drm = await login('drm1');
const sup = await login('supervisor1');
// A wagon so the wagon-side reads have a row.
await call('POST', '/api/wagons/register', { wagonNumber: 'SECR/BOXNHL/90001', wagonType: 'BOXNHL', owningRailway: 'SECR' }, sup);

const reads = [
  ['GET', '/api/sorting/throughput', null, drm],
  ['GET', '/api/sorting/stock?bogieType=CASNUB_22_NLB&condition=USED', null, drm],
  ['GET', '/api/sorting/allocation?bogieType=CASNUB_22_NLB&condition=USED&forWagon=BOXNHL', null, drm],
  ['GET', '/api/analytics/forecast?days=14', null, drm],
  ['GET', '/api/analytics/inspectors', null, drm],
  ['GET', '/api/analytics/standard?days=365', null, drm],
  ['GET', '/api/gauges/drift', null, drm],
  ['GET', '/api/gauges/exposure', null, drm],
  ['GET', '/api/analytics/pipeline', null, drm],
  ['GET', '/api/analytics/findings', null, drm],
  ['GET', '/api/analytics/dwell', null, drm],
  ['GET', '/api/analytics/blockers', null, drm],
  ['GET', '/api/analytics/export', null, drm],
  ['GET', '/api/system/readiness', null, await login('admin1')],
  ['GET', '/api/audit/verify/tail?entries=500', null, drm],
  ['GET', '/api/shadow/report?days=7', null, sup],
  ['POST', '/api/ask', { question: 'how many springs were sorted per day this year' }, sup],
  ['POST', '/api/ask', { question: 'band distribution for outer springs this year' }, sup],
  ['POST', '/api/ask', { question: 'is any gauge reading high' }, sup],
  ['POST', '/api/ask', { question: 'condemnation rate per inspector this year' }, sup],
  ['POST', '/api/ask', { question: 'forecast spring replacements for the next 30 days' }, sup],
  ['POST', '/api/sorting/record', { batchId: 'soak-live', bogieType: 'CASNUB_22_NLB', condition: 'USED', springPosition: 'OUTER', measuredFreeHeight: 258 }, await login('inspector1')]
];

console.log(`\nReading it back (limit ${LIMIT_MS} ms each):`);
const slow = [];
for (const [method, url, body, token] of reads) {
  const t = Date.now();
  const r = await call(method, url, body, token);
  const ms = Date.now() - t;
  const ok = r.status < 400 && ms <= LIMIT_MS;
  const label = `${method} ${url}${body?.question ? ` "${body.question}"` : ''}`;
  console.log(`  ${ok ? '✓' : '✗'} ${String(ms).padStart(6)} ms  ${r.status}  ${label}`);
  if (!ok) slow.push(`${label}: ${r.status} in ${ms} ms${r.status >= 400 ? ' — ' + (r.body?.message || r.body?.error || '') : ''}`);
}

const size = (statSync(DB).size / 1048576).toFixed(1);
console.log(`\nDatabase after a year of the bench: ${size} MB.`);
if (slow.length) {
  console.error(`\n${slow.length} read(s) failed or exceeded ${LIMIT_MS} ms:\n  ${slow.join('\n  ')}`);
  process.exit(1);
}
console.log('Soaked. Every screen reads a year of the bench inside the limit.');
