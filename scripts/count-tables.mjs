// Count the rows a live database and a restored copy hold, side by side.
import { DatabaseSync } from 'node:sqlite';
const [live, back] = process.argv.slice(2).map((p) => new DatabaseSync(p, { readOnly: true }));
const q = (db, t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
for (const t of ['wagons', 'inspections', 'spring_sorting_records', 'inspection_audit_log']) console.log(`   ${t.padEnd(24)} live ${String(q(live, t)).padStart(6)}   restored ${String(q(back, t)).padStart(6)}`);
