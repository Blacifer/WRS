#!/usr/bin/env node
/**
 * The production first day — driven on the built bundle, with nobody's demo account
 * Indian Railways WRS Raipur
 *
 * Every other drive signs in as inspector1 / password123. That is the demo
 * record, and a production bundle refuses it. Nobody had driven the day the
 * shop actually has: a fresh database, NODE_ENV=production, the bootstrap
 * administrator from .env, the password changed, the real roster created on
 * the User Accounts screen, the bench's gauges entered, an inspector sorting
 * on the strip, a wagon taken from registration to a signed certificate with
 * the one-time code the production configuration issues, a backup written
 * to another directory, and the readiness panel read at the end.
 *
 * The screens a person uses on the first day are driven through the browser;
 * the wagon flow, which the role walkthrough and the parts and pocket drives
 * already cover screen by screen, goes through the API — the point here is
 * that it works on a production database with no demo seed.
 *
 *   APP_URL=https://localhost:3100 ADMIN_PASSWORD='…' node scripts/first-day-drill.mjs
 *
 * against a bundle started in production mode with BOOTSTRAP_ADMIN_USERNAME=wrsadmin.
 */

import { chromium } from 'playwright';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const BASE = process.env.APP_URL || 'https://localhost:3100';
const ADMIN_USER = process.env.ADMIN_USERNAME || 'wrsadmin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const BUNDLE = process.env.BUNDLE_DIR || path.resolve('dist-shop', 'wrs-raipur');
if (!ADMIN_PASSWORD) { console.error('ADMIN_PASSWORD (the BOOTSTRAP_ADMIN_PASSWORD in the bundle .env) is required.'); process.exit(2); }

const NEW_ADMIN_PASSWORD = 'Raipur-Bogie-Shop-2026-Admin!';
const problems = [];
const check = (ok, what) => { console.log(`${ok ? '  ✓' : '  ✗'} ${what}`); if (!ok) problems.push(what); };
const api = async (method, p, body, token) => {
  const r = await fetch(`${BASE}/api${p}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
// The bundle's certificate is self-signed; the browser and fetch both accept it here, as a tablet does after TABLET_TRUST.md.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const browser = await chromium.launch();
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
// Headless Chromium will not let a service worker fetch over a self-signed
// certificate even with ignoreHTTPSErrors; a tablet with the certificate
// installed (TABLET_TRUST.md) has no such error. Everything else counts.
const consoleErrors = []; page.on('console', (m) => m.type() === 'error' && !/SSL certificate error/.test(m.text()) && consoleErrors.push(m.text().slice(0, 160)));
const failed = []; page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400 && !/auth\/login/.test(r.url())) failed.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, '')}`); });

async function signIn(u, p) {
  await page.goto(BASE); await page.evaluate(() => localStorage.clear()); await page.goto(BASE);
  await page.fill('input[type="text"]', u); await page.fill('input[type="password"]', p); await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);
  return page.evaluate(() => localStorage.getItem('wrs_token'));
}

console.log('1. The demo accounts do not exist, and the bootstrap administrator does');
const demo = await api('POST', '/auth/login', { username: 'inspector1', password: 'password123' });
check(demo.status === 401 || demo.status === 403, `inspector1 / password123 refused (${demo.status})`);
let adminToken = await signIn(ADMIN_USER, ADMIN_PASSWORD);
check(Boolean(adminToken), `${ADMIN_USER} signs in with the bootstrap password from .env`);

console.log('\n2. The administrator changes the bootstrap password on the screen');
await page.click('[data-testid="header-password"]');
await page.locator('[data-testid="change-password"]').waitFor();
await page.fill('[data-testid="current-password"]', ADMIN_PASSWORD);
await page.fill('[data-testid="new-password"]', NEW_ADMIN_PASSWORD);
await page.fill('[data-testid="confirm-password"]', NEW_ADMIN_PASSWORD);
await page.locator('[data-testid="change-password"] button[type="submit"]').click();
await page.locator('[data-testid="password-changed"]').waitFor({ timeout: 10000 });
check(true, 'password changed');
const old = await api('POST', '/auth/login', { username: ADMIN_USER, password: ADMIN_PASSWORD });
check(old.status === 401, `the bootstrap password no longer works (${old.status})`);
adminToken = await signIn(ADMIN_USER, NEW_ADMIN_PASSWORD);
check(Boolean(adminToken), 'the new password does');

console.log('\n3. The roster — a supervisor and an inspector, created on User Accounts');
const people = [
  { fullName: 'S. K. Verma', employeeId: 'WRS-SUP-2019', role: 'SUPERVISOR', username: 'sk.verma' },
  { fullName: 'Ramesh Kumar', employeeId: 'WRS-INSP-1042', role: 'INSPECTOR', username: 'ramesh.kumar' }
];
const passwords = {};
await page.locator('[data-testid="nav-users"]').first().click(); await page.waitForTimeout(1500);
for (const person of people) {
  await page.getByRole('button', { name: /Add person/i }).first().click(); await page.waitForTimeout(500);
  await page.getByPlaceholder('Ramesh Kumar').fill(person.fullName);
  await page.getByPlaceholder('WRS-INSP-2031').fill(person.employeeId);
  await page.locator('form select').first().selectOption(person.role);
  await page.getByPlaceholder('ramesh.kumar').fill(person.username);
  // The screen generates a strong password; the administrator writes it down for the person.
  passwords[person.username] = await page.locator('form input[type="text"]').last().inputValue();
  await page.locator('form button[type="submit"]').click();
  // Creating an account is confirmed with a one-time code, on the screen, the
  // way the production configuration issues it (OTP_DELIVERY=INLINE).
  await page.getByRole('button', { name: /Request code/i }).click();
  const shown = page.locator('[data-testid="inline-code"] strong');
  await shown.waitFor({ timeout: 10000 });
  const code = (await shown.innerText()).trim();
  await page.getByPlaceholder('000000').fill(code);
  await page.getByRole('button', { name: /^Confirm$/ }).click();
  await page.waitForTimeout(2500);
  const listed = (await api('GET', '/auth/users', null, adminToken)).body?.data?.some((u) => u.username === person.username);
  check(listed && passwords[person.username]?.length >= 12, `${person.username} (${person.role}) created, confirmed with a one-time code, with a generated password`);
}

console.log('\n4. The bench\'s gauges, entered on the register');
await page.locator('[data-testid="gauge-add"]').waitFor({ timeout: 10000 });
for (const g of [['OSG-01', 'OUTER', 'Outer spring gauge (NLB/HS)'], ['ISG-01', 'INNER', 'Inner spring gauge (NLB/HS)']]) {
  await page.click('[data-testid="gauge-add"]');
  await page.fill('[data-testid="gauge-new-code"]', g[0]);
  await page.selectOption('[data-testid="gauge-new-applies"]', g[1]);
  await page.fill('[data-testid="gauge-new-description"]', g[2]);
  await page.fill('[data-testid="gauge-new-certificate"]', `SECR/CAL/2026/${g[0]}`);
  await page.fill('[data-testid="gauge-new-calibrated"]', '2026-07-01');
  await page.fill('[data-testid="gauge-new-valid"]', '2027-07-01');
  await page.click('[data-testid="gauge-add-save"]'); await page.waitForTimeout(1200);
}
const gauges = await api('GET', '/gauges', null, adminToken);
check((gauges.body?.data?.gauges || []).some((g) => g.gaugeCode === 'OSG-01' && g.calibrationState === 'VALID'), 'OSG-01 is on the register with a valid calibration');

console.log('\n5. The inspector sorts on the strip');
const inspToken = await signIn('ramesh.kumar', passwords['ramesh.kumar']);
check(Boolean(inspToken), 'ramesh.kumar signs in with the generated password');
await page.locator('[data-testid="nav-spring-sorting"]').first().click(); await page.waitForTimeout(2000);
const gaugeShown = await page.locator('select').filter({ hasText: /OSG-01/ }).count();
check(gaugeShown > 0, 'the outer gauge entered by the administrator is offered on the bench');
for (const band of ['BLUE', 'GREEN', 'YELLOW']) { await page.getByRole('button', { name: new RegExp(`^${band}\\b`, 'i') }).first().click(); await page.waitForTimeout(700); }
const sessionText = await page.locator('body').innerText();
check(/This session:\s*3/.test(sessionText), 'three springs on the strip, recorded against a named gauge');
const bench = await api('GET', '/sorting/throughput', null, inspToken);
check(bench.body?.data?.total === 3, `the server holds ${bench.body?.data?.total} springs for today`);

console.log('\n6. A wagon, registration to certificate, on the production database');
const supToken = (await api('POST', '/auth/login', { username: 'sk.verma', password: passwords['sk.verma'] })).body?.token;
check(Boolean(supToken), 'sk.verma signs in');
const W = `SECR/BOXNHL/${60000 + Math.floor(Math.random() * 9000)}`;
const reg = await api('POST', '/wagons/register', { wagonNumber: W, wagonType: 'BOXNHL', owningRailway: 'SECR' }, supToken);
check(reg.status === 201, `${W} registered (${reg.status})`);
const chk = await api('GET', `/wagons/${encodeURIComponent(W)}/checklist`, null, inspToken);
const items = chk.body?.data?.allItems || [];
check(items.length >= 40, `the wagon received its checklist without a demo seed: ${items.length} items`);
// Green-band heights per position for a used NLB set; each reading names the gauge it was taken on.
const heights = { OUTER: [257, 'OSG-01'], INNER: [259, 'ISG-01'], SNUBBER: [291, 'SSG-02'] };
for (let i = 0; i < 48; i++) {
  const position = i % 12 < 7 ? 'OUTER' : i % 12 < 11 ? 'INNER' : 'SNUBBER';
  // Each reading names its bogie: the checklist's "Outer Spring (Bogie 1)" links only to a reading from BOGIE_1.
  const r = await api('POST', '/inspections', { wagonNumber: W, bogieType: 'CASNUB_22_NLB', condition: 'USED', springPosition: position, bogiePosition: i < 24 ? 'BOGIE_1' : 'BOGIE_2', measuredFreeHeight: heights[position][0], gaugeCode: heights[position][1] }, inspToken);
  if (r.status !== 201 && r.status !== 200) { check(false, `inspection ${i} (${position}): ${r.status} ${r.body?.message || ''}`); break; }
}
// Clearing the rest behind an attestation is the supervisor's act (wagon.override).
const bulk = await api('POST', '/checklist/bulk-clear', { wagonNumber: W, attestation: 'Every remaining item inspected on the floor and found serviceable — first-day drill.' }, supToken);
check(bulk.status === 200, `remaining checklist items cleared by the supervisor's attestation (${bulk.status} ${bulk.body?.message || ''})`);
await api('POST', `/wagons/${encodeURIComponent(W)}/swt`, { wagonType: 'BOXN', pipeType: 'SINGLE', loadCondition: 'EMPTY', readings: [{ ref: '1', value: 5 }, { ref: '2', value: 5 }, { ref: '3', value: 0.05 }, { ref: '4.1', value: 24 }, { ref: '4.2', value: 3.8 }, { ref: '4.3', value: 1.45 }, { ref: '5.1', value: 52 }, { ref: '6', value: 4 }, { ref: '7', observed: true }, { ref: '8.1', value: 25 }, { ref: '8.2', value: 3.8 }, { ref: '9', value: 85 }, { ref: '10', value: 0.05 }, { ref: '12', observed: true }] }, inspToken);
for (const stage of ['DISMANTLING', 'COMPONENT_INSPECTION', 'REPAIR_REPLACEMENT', 'REASSEMBLY', 'FINAL_QC_GATE']) {
  const t = await api('POST', `/wagons/${encodeURIComponent(W)}/transition`, { targetStage: stage, notes: 'first-day drill' }, supToken);
  if (t.status !== 200) check(false, `transition to ${stage}: ${t.status} ${t.body?.message || ''}`);
}
const gate = await api('GET', `/wagons/${encodeURIComponent(W)}/gate/status`, null, supToken);
check(gate.body?.data?.canRelease === true, `the gate can release: blockers ${JSON.stringify(gate.body?.data?.blockers || [])}`);
// The one-time code the production configuration issues (OTP_DELIVERY=INLINE): request, verify, sign.
const otpReq = await api('POST', '/auth/request-otp', { action: 'OVERRIDE' }, supToken);
const otpCode = otpReq.body?.data?.devOtpCode || otpReq.body?.devOtpCode;
const otpId = otpReq.body?.data?.otpId || otpReq.body?.otpId;
check(Boolean(otpCode && otpId), 'a one-time code is issued for the sign-off');
const otpVer = await api('POST', '/auth/verify-otp', { otpId, otpCode }, supToken);
const otpToken = otpVer.body?.data?.otpToken || otpVer.body?.otpToken;
check(Boolean(otpToken), 'the code verifies into an action token');
const so = await api('POST', `/wagons/${encodeURIComponent(W)}/gate/signoff`, { otpToken, acknowledgedAdvisoryIds: (gate.body?.data?.advisoryDetails || []).map((a) => a.id), signoffNotes: 'First-day drill release.' }, supToken);
check(so.status === 201 || so.status === 200, `release signed (${so.status}) ${so.body?.message || ''}`);
const cert = await api('GET', `/wagons/${encodeURIComponent(W)}/certificate?format=json`, null, supToken);
check(cert.status === 200 && /^ED25519:/i.test(String(cert.body?.data?.verification?.signature || cert.body?.data?.signoff?.digitalSignature || '')), 'the certificate carries an Ed25519 signature');
const pass = await fetch(`${BASE}/api/wagons/${encodeURIComponent(W)}/passport`, { headers: { authorization: `Bearer ${supToken}` } });
check(pass.status === 200 && (await pass.text()).includes('"type":"SEAL"'), 'the passport exports, sealed');

console.log('\n7. A backup to another directory, with a key that is not beside the database');
const keyDir = path.join(BUNDLE, 'key-elsewhere'); mkdirSync(keyDir, { recursive: true });
const keyFile = path.join(keyDir, 'backup.key');
if (!existsSync(keyFile)) writeFileSync(keyFile, 'a'.repeat(64));
const backupDir = path.join(BUNDLE, 'backups-elsewhere'); mkdirSync(backupDir, { recursive: true });
try {
  execFileSync(process.execPath, ['--experimental-strip-types', path.join(BUNDLE, 'server', 'scripts', 'backup-db.mjs'), path.join(BUNDLE, 'server', 'data', 'wrs_inspections.db'), backupDir], { env: { ...process.env, WRS_BACKUP_KEY_FILE: keyFile }, stdio: 'pipe' });
  const files = readdirSync(backupDir).filter((f) => /\.enc$/.test(f));
  check(files.length > 0, `encrypted backup written: ${files[files.length - 1]}`);
} catch (e) {
  check(false, `backup failed: ${String(e.stderr || e.message).slice(0, 200)}`);
}

console.log('\n8. What the readiness panel says at the end of the first day');
const ready = await api('GET', '/system/readiness', null, adminToken);
for (const c of ready.body?.data?.checks || []) console.log(`     ${c.state.padEnd(4)} ${c.label} — ${c.detail}`);
check(ready.status === 200 && !(ready.body?.data?.checks || []).some((c) => c.state === 'FAIL'), `readiness: ${ready.body?.data?.passed} passed, ${ready.body?.data?.warned} warned, ${ready.body?.data?.failed} failed`);

console.log(`\nConsole errors: ${consoleErrors.length}${consoleErrors.length ? '\n  ' + consoleErrors.join('\n  ') : ''}; failed API calls from the screens: ${failed.length}${failed.length ? '\n  ' + failed.join('\n  ') : ''}`);
await browser.close();
if (problems.length || consoleErrors.length || failed.length) { console.error(`\n${problems.length} problem(s).`); process.exit(1); }
console.log('\nFirst day driven: no demo account, a real roster, real gauges, a wagon released with a one-time code, a backup elsewhere.');
