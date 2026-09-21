#!/usr/bin/env node
/**
 * The tablet gets a camera over the LAN, proven rather than promised
 * Indian Railways WRS Raipur
 *
 * The bundle used to serve plain http, and an earlier tablet note had
 * already measured what that means: from any address but localhost, no
 * getUserMedia, no service worker, no secure context. The quick-start told
 * inspectors a condemned spring needs a photograph. From a tablet, it could
 * not have one.
 *
 * This makes a certificate the way START.cmd now does (Node only, no
 * openssl), starts the real server on it with a throwaway database, and:
 *
 *   1. completes a STRICT TLS handshake from Node to the machine's LAN
 *      address, trusting only that certificate — which is what a tablet does
 *      once the .crt is installed;
 *   2. opens the app in a real browser at the LAN address over https and
 *      checks isSecureContext and navigator.mediaDevices are there;
 *   3. opens the same over plain http and checks they are NOT — so the pass
 *      in (2) is the certificate's doing and not the browser's leniency.
 *
 * Needs playwright. Deliberate run, and part of preflight:
 *   node scripts/lan-cert-drill.mjs
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { ensureCerts, localIPv4s } from '../server/scripts/make-lan-cert.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wrs-lan-cert-'));
const PORT_TLS = 3443;
const PORT_HTTP = 3080;

const ips = localIPv4s();
const lan = ips.find((ip) => ip !== '127.0.0.1') || '127.0.0.1';
// The CA and a server certificate for this machine's addresses, exactly as
// START.cmd makes them; the strict client below trusts only the CA — the
// one file a tablet installs.
const certs = ensureCerts(work);
const keyPath = certs.files.keyPath;
const certPath = certs.files.certPath;
const made = { certPem: fs.readFileSync(certs.files.caCertPath, 'utf8') };
console.log(`certificate names ${certs.ips.join(', ')} (signed by the workshop CA); testing against ${lan}`);

function startServer(env, port) {
  const child = spawn(process.execPath, ['--experimental-strip-types', 'src/index.ts'], {
    cwd: path.join(ROOT, 'server'),
    env: { ...process.env, ...env, PORT: String(port), DB_PATH: path.join(work, `db-${port}.db`), WRS_PHOTO_DIR: path.join(work, `photos-${port}`), SEED_DEMO_USERS: 'true', WRS_LOG_SILENT: '1', NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  return { child, log: () => out };
}

async function waitFor(fn, ms = 20000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { if (await fn()) return true; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

const tls = startServer({ TLS_KEY_PATH: keyPath, TLS_CERT_PATH: certPath }, PORT_TLS);
const plain = startServer({}, PORT_HTTP);
const results = [];
const check = (label, ok, detail = '') => { results.push(ok); console.log(`  ${ok ? 'ok ' : 'BAD'} ${label}${detail ? ` — ${detail}` : ''}`); };

try {
  const upTls = await waitFor(() => new Promise((res) => {
    https.get({ host: '127.0.0.1', port: PORT_TLS, path: '/api/health', ca: made.certPem }, (r) => res(r.statusCode === 200)).on('error', () => res(false));
  }));
  check('the server comes up on TLS with the generated certificate', upTls, upTls ? '' : tls.log().slice(-400));
  const upPlain = await waitFor(() => new Promise((res) => {
    http.get({ host: '127.0.0.1', port: PORT_HTTP, path: '/api/health' }, (r) => res(r.statusCode === 200)).on('error', () => res(false));
  }));
  check('a plain-http server is up beside it for comparison', upPlain);

  // 1. Strict handshake at the LAN address, trusting only our certificate.
  const strict = await new Promise((res) => {
    https.get({ host: lan, port: PORT_TLS, path: '/api/health', ca: made.certPem, rejectUnauthorized: true }, (r) => {
      let body = ''; r.on('data', (d) => { body += d; }); r.on('end', () => res({ ok: r.statusCode === 200 && /healthy/.test(body) }));
    }).on('error', (e) => res({ ok: false, err: e.message }));
  });
  check(`a strict client trusting only the CA (lan-cert.crt) reaches https://${lan}:${PORT_TLS}`, strict.ok, strict.err || '');

  // And the same client refuses an address the certificate does not name.
  const wrongName = await new Promise((res) => {
    https.get({ host: lan, port: PORT_TLS, path: '/api/health', ca: made.certPem, rejectUnauthorized: true, servername: 'not-named.example' }, () => res(false)).on('error', () => res(true));
  });
  check('and refuses a name the certificate does not carry', wrongName);

  // 2 & 3. What a browser makes of it, from the LAN address.
  const b = await chromium.launch();
  const ctx = await b.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  await page.goto(`https://${lan}:${PORT_TLS}/`, { waitUntil: 'domcontentloaded' });
  const secure = await page.evaluate(() => ({ secure: window.isSecureContext, media: !!navigator.mediaDevices?.getUserMedia, sw: 'serviceWorker' in navigator }));
  check(`over https from ${lan}: isSecureContext`, secure.secure === true);
  check('  navigator.mediaDevices.getUserMedia exists (camera, microphone)', secure.media === true);
  check('  serviceWorker is available (offline reload)', secure.sw === true);

  const page2 = await ctx.newPage();
  await page2.goto(`http://${lan}:${PORT_HTTP}/`, { waitUntil: 'domcontentloaded' });
  const insecure = await page2.evaluate(() => ({ secure: window.isSecureContext, media: !!navigator.mediaDevices?.getUserMedia }));
  check(`over plain http from ${lan}: NOT a secure context`, insecure.secure === false);
  check('  and no getUserMedia — the certificate is what makes the difference', insecure.media === false);
  await b.close();
} finally {
  tls.child.kill(); plain.child.kill();
  fs.rmSync(work, { recursive: true, force: true });
}

const ok = results.every(Boolean);
console.log(ok ? '\nPASS — a tablet on the LAN gets the camera, the microphone and offline reload.' : '\nFAIL — see above.');
process.exit(ok ? 0 : 1);
