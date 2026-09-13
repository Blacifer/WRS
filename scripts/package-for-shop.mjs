#!/usr/bin/env node
/**
 * Package the application for a machine that has no internet and no developer
 * Indian Railways WRS Raipur
 *
 * WHY THIS EXISTS
 * ---------------
 * The runbook's install path is git clone, npm ci, npm run build. That needs
 * Git, a working internet connection, and twenty minutes of a stranger's
 * machine — and if npm fails on their PC, it fails in front of the DRM.
 *
 * A shop PC has none of those things, and it should not need them. What it
 * needs is a folder to copy and a file to double-click. This produces that
 * folder: everything the application needs at runtime and nothing it needs
 * only to be developed.
 *
 * WHAT GOES IN, AND WHY IT IS SMALL
 * ---------------------------------
 * The server has two runtime dependencies — dotenv and qrcode-generator — and
 * runs its TypeScript directly under Node 22. So the bundle is the server
 * source, the shared modules, the BUILT client (which already contains the
 * 31 MB of vision weights), the runbook, and a start script. About 40 MB.
 * Node itself is not bundled: its installer goes on the same USB stick, and
 * the start script checks for it and says exactly what to do if it is absent.
 *
 * Run this on a developer machine that has internet:
 *
 *   node scripts/package-for-shop.mjs
 *
 * and copy dist-shop/wrs-raipur/ to the stick beside the Node installer.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const OUT = path.join(ROOT, 'dist-shop');
const BUNDLE = path.join(OUT, 'wrs-raipur');

const step = (label) => console.log(`\n== ${label}`);
const run = (cmd, cwd = ROOT) => {
  console.log(`   $ ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
};

function copyTree(src, dest, { skip = () => false } = {}) {
  if (!fs.existsSync(src)) throw new Error(`missing: ${src}`);
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (skip(s, entry)) continue;
    if (entry.isDirectory()) copyTree(s, d, { skip });
    else fs.copyFileSync(s, d);
  }
}

const dirSize = (p) => {
  let n = 0;
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const f = path.join(p, e.name);
    n += e.isDirectory() ? dirSize(f) : fs.statSync(f).size;
  }
  return n;
};
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;

// ---------------------------------------------------------------------------
step('Clean');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(BUNDLE, { recursive: true });

// ---------------------------------------------------------------------------
step('Check the vision weights are present — the shed cannot fetch them');
for (const m of ['coco-ssd', 'mobilenet']) {
  const manifest = path.join(ROOT, 'client', 'public', 'models', m, 'model.json');
  if (!fs.existsSync(manifest)) {
    console.error(`   ${m}/model.json is missing. Run: node scripts/vendor-vision-models.mjs`);
    process.exit(1);
  }
}
console.log('   both present');

// ---------------------------------------------------------------------------
step('Build the client');
run('npm run build --prefix client');

// ---------------------------------------------------------------------------
step('Copy what the server needs at runtime');
copyTree(path.join(ROOT, 'server', 'src'), path.join(BUNDLE, 'server', 'src'));
copyTree(path.join(ROOT, 'server', 'scripts'), path.join(BUNDLE, 'server', 'scripts'));
copyTree(path.join(ROOT, 'shared'), path.join(BUNDLE, 'shared'), {
  skip: (p) => /\.test\.ts$/.test(p)
});
fs.mkdirSync(path.join(BUNDLE, 'server', 'data'), { recursive: true });
for (const f of ['package.json', 'package-lock.json']) {
  fs.copyFileSync(path.join(ROOT, 'server', f), path.join(BUNDLE, 'server', f));
}

// Production dependencies only, installed INTO the bundle so the shop machine
// never runs npm at all.
step('Install the two runtime dependencies into the bundle');
run('npm ci --omit=dev --ignore-scripts --no-audit --no-fund', path.join(BUNDLE, 'server'));
fs.rmSync(path.join(BUNDLE, 'server', 'package-lock.json'), { force: true });

// ---------------------------------------------------------------------------
step('Copy the built client, weights included');
copyTree(path.join(ROOT, 'client', 'dist'), path.join(BUNDLE, 'client', 'dist'));

// ---------------------------------------------------------------------------
step('Copy the documents');
copyTree(path.join(ROOT, 'docs'), path.join(BUNDLE, 'docs'));

// ---------------------------------------------------------------------------
step('Write the start script and the environment template');

fs.writeFileSync(
  path.join(BUNDLE, '.env.example'),
  `# Copy this file to .env and fill in the three lines marked CHANGE.
# START.cmd does this for you on first run and generates the secret.

NODE_ENV=production
PORT=3000

# The address the tablets will use to reach this PC, e.g. http://192.168.1.20:3000
CORS_ORIGIN=http://localhost:3000

# Generated by START.cmd on first run. Never copy one from anywhere.
JWT_SECRET=

# Where backups go. MUST be a different disk from this PC — a second drive,
# a USB disk kept in another room, or a network share. The dashboard looks
# here and flags the default (beside the database) as not protection.
WRS_BACKUP_DIR=D:\\wrs-backups

# The first administrator, used ONCE on the first start and then ignored.
# Remove these two lines after signing in and changing the password.
BOOTSTRAP_ADMIN_USERNAME=wrsadmin
BOOTSTRAP_ADMIN_PASSWORD=CHANGE-ME-at-least-12-characters
`
);

fs.writeFileSync(
  path.join(BUNDLE, 'START.cmd'),
  `@echo off
setlocal
title WRS Raipur
cd /d "%~dp0"

rem ---------------------------------------------------------------------------
rem Is Node here, and is it new enough?
rem
rem The application runs its TypeScript directly under Node, which needs 22 or
rem newer. An older Node fails with ERR_UNKNOWN_BUILTIN_MODULE for node:sqlite,
rem which looks like a broken application rather than an old Node, so it is
rem checked here and named.
rem ---------------------------------------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed on this PC.
  echo   Run the Node installer from the same USB stick as this folder,
  echo   accept the defaults, then run START.cmd again.
  echo.
  pause
  exit /b 1
)
for /f "tokens=1 delims=v." %%a in ('node -p "process.versions.node"') do set NODE_MAJOR=%%a
if %NODE_MAJOR% LSS 22 (
  echo.
  echo   Node.js is too old ^(found version %NODE_MAJOR%; need 22 or newer^).
  echo   Run the Node installer from the USB stick, then run START.cmd again.
  echo.
  pause
  exit /b 1
)

rem ---------------------------------------------------------------------------
rem First run: make the .env with a generated secret.
rem ---------------------------------------------------------------------------
if not exist ".env" (
  echo   First start. Creating .env with a generated secret...
  copy /y ".env.example" ".env" >nul
  for /f "delims=" %%s in ('node -p "require('crypto').randomBytes(48).toString('base64')"') do set SECRET=%%s
  powershell -NoProfile -Command "(Get-Content .env) -replace '^JWT_SECRET=$', 'JWT_SECRET=%SECRET%' | Set-Content .env"
  echo.
  echo   Now open .env in Notepad and set BOOTSTRAP_ADMIN_PASSWORD
  echo   ^(at least 12 characters^) and WRS_BACKUP_DIR, then run START.cmd again.
  echo.
  notepad .env
  exit /b 0
)

rem ---------------------------------------------------------------------------
rem Start.
rem ---------------------------------------------------------------------------
echo.
echo   Starting WRS Raipur. Leave this window open.
echo   On this PC:      http://localhost:3000
for /f "tokens=2 delims=:" %%i in ('ipconfig ^| findstr /c:"IPv4"') do (
  for /f "tokens=* delims= " %%j in ("%%i") do echo   From a tablet:   http://%%j:3000
)
echo.
cd server
node --experimental-strip-types src\\index.ts
pause
`
);

fs.writeFileSync(
  path.join(BUNDLE, 'READ-ME-FIRST.txt'),
  `WRS Raipur — installing on a workshop PC
=========================================

You need, on one USB stick:
  1. This folder (wrs-raipur)
  2. The Node.js 22 LTS installer for Windows (node-v22.x.x-x64.msi)
     from https://nodejs.org — download it BEFORE going to the shop.

On the PC:
  1. Run the Node installer. Accept every default.
  2. Copy this folder to C:\\wrs-raipur
  3. Double-click START.cmd. It creates a settings file and opens it.
     Set the administrator password (12+ characters) and where backups go.
  4. Double-click START.cmd again. Leave the window open.
  5. Open http://localhost:3000 in Edge or Chrome. Sign in.
  6. Change the administrator password (key icon, top right).
  7. Create the real accounts under User Accounts.
  8. Delete the two BOOTSTRAP lines from .env.

Then read docs\\INSTALL.md — sections 5 (the manual), 6 (the gauges),
7 (backups: the scheduled task), and 8 (check your work).

If START.cmd says Node is missing or too old, the installer on the stick
fixes it. Nothing else on this PC is needed, and nothing needs the internet.
`
);

// ---------------------------------------------------------------------------
step('Check nothing development-only leaked in');
const forbidden = ['playwright', 'vitest', 'typescript', 'concurrently', '@tensorflow'];
const nm = path.join(BUNDLE, 'server', 'node_modules');
const leaked = fs.existsSync(nm) ? fs.readdirSync(nm).filter((d) => forbidden.some((f) => d.startsWith(f))) : [];
if (leaked.length) {
  console.error(`   development packages in the bundle: ${leaked.join(', ')}`);
  process.exit(1);
}
console.log(`   runtime packages: ${fs.readdirSync(nm).filter((d) => !d.startsWith('.')).join(', ')}`);

// ---------------------------------------------------------------------------
step('Done');
const total = dirSize(BUNDLE);
console.log(`
   ${BUNDLE}
   ${mb(total)} total, of which ${mb(dirSize(path.join(BUNDLE, 'client', 'dist', 'models')))} is vision weights.

   Copy that folder to a USB stick beside the Node 22 installer.
   On the shop PC: run the Node installer, copy the folder, double-click START.cmd.
`);
