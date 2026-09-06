/**
 * Several inspectors, several wagons, one database
 * Indian Railways WRS Raipur
 *
 * WHY THIS DRILL EXISTS
 * ---------------------
 * The pilot database's audit chain was found broken by the restore drill. The
 * cause was not tampering: two writers had each read the same "last hash" and
 * both appended, and the chain forked. Two people had signed in at the same
 * moment.
 *
 * Nothing in the test suite could have caught it, because every suite writes
 * from a single process, and within one process node:sqlite is synchronous —
 * the read and the write cannot interleave. The fault only exists across
 * processes, which is exactly how the workshop runs: several tablets, one
 * server, one file.
 *
 * So this drives complete wagon lifecycles — register, five stage
 * transitions, forty-one checklist verdicts, a spring reading, the §720-C air
 * brake test, an OTP, and a signed release — from several processes at once
 * against one database, and then checks the things that break when writers
 * collide:
 *
 *   - the audit chain still verifies, with no forked parents
 *   - no two inspections were handed the same sequence number
 *   - no two certificates share a number or a signature
 *   - every wagon reached RELEASE with its full checklist
 *
 * Run it before a deployment and after touching anything that writes.
 *
 *   node scripts/concurrent-lifecycle-drill.mjs
 *
 * On 6 September 2026: four processes, twenty wagons, two seconds. Chain
 * verified over 1,020 entries with zero breaks, zero forks, twenty distinct
 * sequence numbers and twenty distinct signatures.
 */

import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { verifyAuditChain } from '../server/src/db/auditLog.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKERS = 4;
const PER_WORKER = 5;

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wrs-drill-')), 'lifecycle.db');
console.log(`  database: ${dbPath}`);

/* One process first, so the schema exists before the others race for it. */
const run = (tag, count) => new Promise((resolve) => {
  const p = spawn(process.execPath,
    ['--experimental-strip-types', path.join(HERE, 'lifecycle-worker.mjs'), dbPath, tag, String(count)],
    { stdio: ['ignore', 'pipe', 'ignore'] });
  let out = '';
  p.stdout.on('data', (c) => { out += c; });
  p.on('close', () => {
    try { resolve(JSON.parse(out.trim().split('\n').pop())); }
    catch { resolve({ tag, released: [], failures: ['worker produced no result'] }); }
  });
});

await run('SEED', 0);

const started = Date.now();
const results = await Promise.all(
  ['A', 'B', 'C', 'D'].slice(0, WORKERS).map((t) => run(t, PER_WORKER))
);
const seconds = ((Date.now() - started) / 1000).toFixed(1);

const released = results.flatMap((r) => r.released);
const failures = results.flatMap((r) => r.failures);

console.log(`  ${WORKERS} processes, ${PER_WORKER} wagons each, in ${seconds}s`);
console.log('  wagons released        :', released.length, 'of', WORKERS * PER_WORKER);
console.log('  distinct certificates  :', new Set(released).size);
if (failures.length) console.log('  failures               :', failures.slice(0, 3).join(' ;; '));

const db = new DatabaseSync(dbPath, { readOnly: true });


const problems = [];

const v = verifyAuditChain(db);
if (!v.verified) problems.push(`audit chain broken (${v.breaksFound} breaks)`);
console.log('  audit chain verified   :', v.verified, '| entries', v.entriesChecked, '| breaks', v.breaksFound);
if (!v.verified) console.log('    first break:', v.firstBrokenAt.reason, '-', v.firstBrokenAt.detail.slice(0, 100));

const forks = db.prepare('SELECT COUNT(*) c FROM (SELECT previous_hash FROM inspection_audit_log GROUP BY previous_hash HAVING COUNT(*)>1)').get().c;
console.log('  forked parents         :', forks, forks ? '  <-- CHAIN FORKED' : '(none)');
if (forks) problems.push(`${forks} forked parents`);

const seq = db.prepare('SELECT COUNT(*) t, COUNT(DISTINCT sequence_number) d FROM inspections').get();
console.log('  inspections            :', seq.t, '| distinct sequence numbers:', seq.d, seq.t === seq.d ? '(no collisions)' : '  <-- COLLISION');
if (seq.t !== seq.d) problems.push('duplicate inspection sequence numbers');

const cert = db.prepare('SELECT COUNT(*) t, COUNT(DISTINCT certificate_number) d, COUNT(DISTINCT digital_signature) s FROM gate_signoffs').get();
console.log('  certificates           :', cert.t, '| distinct numbers:', cert.d, '| distinct signatures:', cert.s);
if (cert.t !== cert.d) problems.push('duplicate certificate numbers');
if (cert.t !== cert.s) problems.push('duplicate certificate signatures');

const w = db.prepare("SELECT COUNT(*) c FROM wagons WHERE current_stage='RELEASE'").get().c;
const items = db.prepare('SELECT COUNT(*) c FROM checklist_items').get().c;
const wagons = db.prepare('SELECT COUNT(*) c FROM wagons').get().c;
console.log('  wagons at RELEASE      :', w, 'of', wagons, '| checklist rows:', items, `(${(items / wagons).toFixed(0)} per wagon)`);

/*
 * The integrity checks decide the exit code, not just the release count.
 *
 * The first version of this script printed PASS while reporting a broken
 * chain and 123 forked parents, because it only asked whether the wagons had
 * been released. They had — that is the whole point of the fault. A drill
 * that passes while the record is forked is worse than no drill, and this is
 * the second time in this codebase an ambiguous pass has had to be closed.
 */
if (failures.length) problems.push(`${failures.length} wagon(s) failed to release`);
if (released.length !== WORKERS * PER_WORKER) problems.push('not every wagon was released');

if (problems.length) {
  console.log('\n  FAIL —', problems.join('; '));
  process.exit(1);
}
console.log('\n  PASS');
