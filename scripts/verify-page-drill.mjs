#!/usr/bin/env node
/**
 * A certificate that verifies itself anywhere — proven with the network cut
 * Indian Railways WRS Raipur
 *
 * Releases a wagon through the real gate on a running server, takes its
 * certificate JSON and its passport, opens /verify.html in a real browser,
 * cuts the network, and checks: the genuine certificate verifies; one
 * altered byte in the signed content does not; a swapped key does not; the
 * passport verifies; one altered event is refused by name. The page makes
 * no request, so a copy saved on a laptop at another railway does the same.
 *
 *   DRILL_URL=http://localhost:3000 node scripts/verify-page-drill.mjs
 */

import { chromium } from 'playwright';

const BASE = process.env.DRILL_URL || 'http://localhost:3000';
const W = `SECR/BOXNHL/${77100 + Math.floor(Math.random() * 800)}`;
const login = async (u) => (await (await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: u, password: 'password123' }) })).json()).token;
const call = async (m, p, body, t) => { const r = await fetch(`${BASE}/api${p}`, { method: m, headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };
const text = async (p, t) => (await fetch(`${BASE}/api${p}`, { headers: { authorization: `Bearer ${t}` } })).text();

const insp = await login('inspector1'); const sup = await login('supervisor1');
if (!insp || !sup) { console.error('Could not sign in — is the server running with the demo accounts?'); process.exit(1); }
await call('POST', '/wagons/register', { wagonNumber: W, wagonType: 'BOXNHL', owningRailway: 'SECR' }, insp);
for (const s of ['DISMANTLING', 'COMPONENT_INSPECTION', 'REPAIR_REPLACEMENT', 'REASSEMBLY', 'FINAL_QC_GATE']) await call('POST', `/wagons/${encodeURIComponent(W)}/transition`, { targetStage: s }, insp);
const chk = await call('GET', `/wagons/${encodeURIComponent(W)}/checklist`, null, insp);
for (const it of chk.body.data.allItems) await call('PUT', `/wagons/${encodeURIComponent(W)}/checklist/items/${it.id}`, { status: 'PASS', reinspectedStatus: 'PASS' }, insp);
await call('POST', '/inspections', { wagonNumber: W, bogieType: 'CASNUB_22_NLB', condition: 'USED', springPosition: 'OUTER', measuredFreeHeight: 258 }, insp);
await call('POST', `/wagons/${encodeURIComponent(W)}/swt`, { wagonType: 'BOXN', pipeType: 'SINGLE', loadCondition: 'EMPTY', readings: [{ ref: '1', value: 5 }, { ref: '2', value: 5 }, { ref: '3', value: 0.05 }, { ref: '4.1', value: 24 }, { ref: '4.2', value: 3.8 }, { ref: '4.3', value: 1.45 }, { ref: '5.1', value: 52 }, { ref: '6', value: 4 }, { ref: '7', observed: true }, { ref: '8.1', value: 25 }, { ref: '8.2', value: 3.8 }, { ref: '9', value: 85 }, { ref: '10', value: 0.05 }, { ref: '12', observed: true }] }, insp);
const gate = await call('GET', `/wagons/${encodeURIComponent(W)}/gate/status`, null, sup);
if (!gate.body?.data?.canRelease) { console.error(`Not releasable: ${(gate.body?.data?.blockers || []).join('; ')}`); process.exit(1); }
const so = await call('POST', `/wagons/${encodeURIComponent(W)}/gate/signoff`, { otpToken: 'test_token_override', acknowledgedAdvisoryIds: (gate.body.data.advisoryDetails || []).map((a) => a.id) }, sup);
if (so.status !== 200) { console.error(`Sign-off refused: ${JSON.stringify(so.body).slice(0, 200)} (the development OTP bypass is refused in production — run this against a development server)`); process.exit(1); }
console.log(`released ${W}: certificate ${so.body?.data?.certificateNumber || so.body?.data?.signoff?.certificateNumber || '(issued)'}`);

const certText = await text(`/wagons/${encodeURIComponent(W)}/certificate?format=json`, sup);
const passport = await text(`/wagons/${encodeURIComponent(W)}/passport`, sup);

const b = await chromium.launch(); const ctx = await b.newContext(); const v = await ctx.newPage();
const requests = []; v.on('request', (r) => { if (!r.url().endsWith('/verify.html')) requests.push(r.url()); });
await v.goto(`${BASE}/verify.html`);
await ctx.setOffline(true);
const run = async (t) => { await v.fill('#input', t); await v.click('#go'); await v.waitForTimeout(700); return (await v.locator('.verdict').innerText()).split('\n')[0]; };
const results = [];
const check = (label, got, want) => { const ok = got.startsWith(want); results.push(ok); console.log(`  ${ok ? 'ok ' : 'BAD'} ${label}: ${got}`); };

check('genuine certificate, network cut', await run(certText), 'VERIFIED');
const d1 = JSON.parse(certText); d1.data.verification.signedContent = d1.data.verification.signedContent.replace('"summary"', '"summary_"');
check('one byte of the signed content changed', await run(JSON.stringify(d1)), 'NOT VERIFIED');
const d2 = JSON.parse(certText); d2.data.verification.publicKeyPem = d2.data.verification.publicKeyPem.replace(/MCowBQYDK2VwAyEA(.)/, (m, c) => 'MCowBQYDK2VwAyEA' + (c === 'A' ? 'B' : 'A'));
check('a different key substituted', await run(JSON.stringify(d2)), 'NOT VERIFIED');
check('the released wagon\'s passport', await run(passport), 'VERIFIED');
const lines = passport.trim().split('\n'); const ev = JSON.parse(lines[2]); ev.payload.toStage = 'RELEASE'; lines[2] = JSON.stringify(ev);
const altered = await run(lines.join('\n'));
check('one event altered', altered, 'NOT VERIFIED');
console.log(`  requests the page made while verifying: ${requests.length}`);
results.push(requests.length === 0);
await b.close();
const ok = results.every(Boolean);
console.log(ok ? '\nPASS — a certificate and a passport verify in the browser with no server, and every alteration is refused.' : '\nFAIL — see above.');
process.exit(ok ? 0 : 1);
