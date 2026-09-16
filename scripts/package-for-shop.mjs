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
step('Check the OCR engine and the interface font are present — same reason');
for (const f of ['tesseract/worker.min.js', 'tesseract/tesseract-core-lstm.wasm.js', 'tesseract/eng.traineddata.gz', 'fonts/InterVariable.woff2']) {
  if (!fs.existsSync(path.join(ROOT, 'client', 'public', f))) {
    console.error(`   client/public/${f} is missing. Run: node scripts/vendor-ocr.mjs`);
    process.exit(1);
  }
}
console.log('   present');

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
CORS_ORIGIN=https://localhost:3000

# Generated by START.cmd on first run. Never copy one from anywhere.
JWT_SECRET=

# Where backups go. MUST be a different disk from this PC — a second drive,
# a USB disk kept in another room, or a network share. The dashboard looks
# here and flags the default (beside the database) as not protection.
WRS_BACKUP_DIR=D:\\wrs-backups

# Photographs are files in server\\data\\photos beside the database, carried
# by the same backup. Leave this unset unless they should live elsewhere.
# WRS_PHOTO_DIR=

# DEMO-DATA.cmd adds SEED_DEMO_USERS=true here so the published demonstration
# accounts can sign in. Delete that line, and those accounts, before real use.

# The first administrator, used ONCE on the first start and then ignored.
# Remove these two lines after signing in and changing the password.
BOOTSTRAP_ADMIN_USERNAME=wrsadmin
BOOTSTRAP_ADMIN_PASSWORD=CHANGE-ME-at-least-12-characters
`
);

fs.writeFileSync(
  path.join(BUNDLE, 'START.cmd'),
  // String.raw: a Windows path in an ordinary template literal loses its
  // backslashes (\c, \s, \l are dropped; \n becomes a newline). The first
  // shipped START.cmd read "servercertslan-cert.pem" and could not start.
  String.raw`@echo off
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
rem
rem Looked for on the PATH first, then where the installer puts it. Task
rem Scheduler runs this as SYSTEM, whose PATH may not include Node at all —
rem the scheduled backup was broken by exactly that for weeks.
rem ---------------------------------------------------------------------------
set "NODE=node"
where node >nul 2>nul
if errorlevel 1 (
  if exist "%ProgramFiles%\nodejs\node.exe" (
    set "NODE=%ProgramFiles%\nodejs\node.exe"
  ) else (
    echo.
    echo   Node.js is not installed on this PC.
    echo   Run the Node installer from the same USB stick as this folder,
    echo   accept the defaults, then run START.cmd again.
    echo.
    pause
    exit /b 1
  )
)
for /f "tokens=1 delims=v." %%a in ('"%NODE%" -p "process.versions.node"') do set NODE_MAJOR=%%a
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
  for /f "delims=" %%s in ('"%NODE%" -p "require('crypto').randomBytes(48).toString('base64')"') do set SECRET=%%s
  powershell -NoProfile -Command "(Get-Content .env) -replace '^JWT_SECRET=$', 'JWT_SECRET=%SECRET%' | Set-Content .env"
  echo.
  echo   Now open .env in Notepad and set BOOTSTRAP_ADMIN_PASSWORD
  echo   ^(at least 12 characters^) and WRS_BACKUP_DIR, then run START.cmd again.
  echo.
  notepad .env
  exit /b 0
)

rem ---------------------------------------------------------------------------
rem A certificate for this PC's address, made once.
rem
rem A browser gives a page the camera, the microphone and offline reload only
rem over https (or from localhost). The tablets reach this PC over the LAN, so
rem without a certificate they get none of those — no photograph of a
rem condemned spring, no QR, no voice. Made here with Node alone; the .crt
rem beside it is installed on each tablet once. See docs\TABLET_TRUST.md.
rem ---------------------------------------------------------------------------
if not exist "server\certs\lan-cert.pem" (
  echo   Making a certificate for this PC's address...
  "%NODE%" server\scripts\make-lan-cert.mjs server\certs
)
set "TLS_KEY_PATH=%~dp0server\certs\lan-key.pem"
set "TLS_CERT_PATH=%~dp0server\certs\lan-cert.pem"

rem ---------------------------------------------------------------------------
rem Start, and keep starting.
rem
rem The server exits on purpose when something goes badly wrong, so that it
rem never runs on in a broken state. This loop brings it back five seconds
rem later, and everything it prints — including why it stopped — goes to a
rem dated file under logs\, so a crash at 2 am has a record in the morning.
rem ---------------------------------------------------------------------------
if not exist "logs" mkdir logs
echo.
echo   Starting WRS Raipur. Leave this window open, or schedule START.cmd
echo   at boot ^(docs\INSTALL.md, section 9^) and close it.
echo   On this PC:      https://localhost:3000
for /f "tokens=2 delims=:" %%i in ('ipconfig ^| findstr /c:"IPv4"') do (
  for /f "tokens=* delims= " %%j in ("%%i") do echo   From a tablet:   https://%%j:3000
)
echo   Tablets: install server\certs\lan-cert.crt once ^(docs\TABLET_TRUST.md^).
echo   Log:             logs\wrs-YYYY-MM-DD.log
echo.
:run
for /f %%d in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set "TODAY=%%d"
echo [%date% %time%] starting >> "logs\wrs-%TODAY%.log"
cd server
"%NODE%" --experimental-strip-types src\index.ts >> "..\logs\wrs-%TODAY%.log" 2>&1
set "CODE=%errorlevel%"
cd ..
echo [%date% %time%] server exited with code %CODE% >> "logs\wrs-%TODAY%.log"
echo   [%time%] The server stopped ^(code %CODE%^). Restarting in 5 seconds. See logs\wrs-%TODAY%.log
timeout /t 5 /nobreak >nul
goto run
`
);

/*
 * DEMO-DATA.cmd — the demonstration record, on purpose only.
 *
 * A demonstration on an empty database shows a shop that has never sorted a
 * spring. This writes the demo record (the demo accounts, thirteen wagons,
 * a month of the sorting bench, one wagon's parts, tests and photographs)
 * into THIS bundle's database, and refuses if the database already holds
 * wagons — so it cannot be run by accident on the shop's real record. Not
 * started by START.cmd, not scheduled, not mentioned on the install path.
 */
fs.writeFileSync(
  path.join(BUNDLE, 'DEMO-DATA.cmd'),
  // String.raw: a Windows path in an ordinary template literal loses its
  // backslashes (\c, \s, \l are dropped; \n becomes a newline). The first
  // shipped START.cmd read "servercertslan-cert.pem" and could not start.
  String.raw`@echo off
setlocal
title WRS Raipur — demonstration record
cd /d "%~dp0"
set "NODE=node"
if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
echo.
echo   This writes the DEMONSTRATION record into this bundle's database:
echo   demo accounts (inspector1 / supervisor1 / drm1 / admin1, password123),
echo   thirteen wagons, a month of the sorting bench, and one wagon's story.
echo   It refuses if the database already holds wagons.
echo.
set /p GO=  Type DEMO and press Enter to continue, anything else to stop: 
if /i not "%GO%"=="DEMO" exit /b 1
cd server
set SEED_DEMO_USERS=true
"%NODE%" --experimental-strip-types src\db\seed.ts
if errorlevel 1 ( cd .. & echo. & echo   Nothing written. & pause & exit /b 1 )
cd ..
rem A production build refuses the published demo password at sign-in unless
rem this switch is set for the server too. It goes into .env here, on purpose,
rem and must come out again before the shop's real accounts are created.
findstr /b /c:"SEED_DEMO_USERS=true" .env >nul 2>nul || echo SEED_DEMO_USERS=true>> .env
echo.
echo   Done. Start with START.cmd and sign in as drm1 / password123.
echo.
echo   SEED_DEMO_USERS=true was added to .env so the demo accounts can sign in.
echo   DELETE THAT LINE, and the demo accounts, before real use.
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
  4. Double-click START.cmd again. It makes a certificate for this PC's
     address and starts. Leave the window open (or schedule it at boot —
     docs\\INSTALL.md section 9 — and close it).
  5. Open https://localhost:3000 in Edge or Chrome. Sign in.
  6. Change the administrator password (key icon, top right).
  7. Create the real accounts under User Accounts.
  8. Delete the two BOOTSTRAP lines from .env.

  9. On each tablet, install server\\certs\\lan-cert.crt once, so the browser
     trusts this PC and the camera works — docs\\TABLET_TRUST.md.

Then read docs\\INSTALL.md — sections 5 (the manual), 6 (the gauges),
7 (backups: the scheduled task), 8 (check your work), 9 (starting at boot).

If START.cmd says Node is missing or too old, the installer on the stick
fixes it. Nothing else on this PC is needed, and nothing needs the internet.
`
);

// ---------------------------------------------------------------------------
step('Read the start scripts back the way cmd.exe will');
/*
 * The one check that would have caught the first shipped START.cmd: every
 * Windows path in it must still have its backslashes. A template literal
 * silently drops \c, \s and \l and turns \n into a newline, and the
 * result looks fine in a diff and fails on the shop PC.
 */
for (const [file, needles] of [
  ['START.cmd', ['server\\certs\\lan-cert.pem', 'src\\index.ts', '%ProgramFiles%\\nodejs\\node.exe', 'logs\\wrs-']],
  ['DEMO-DATA.cmd', ['src\\db\\seed.ts', '%ProgramFiles%\\nodejs\\node.exe']]
]) {
  const text = fs.readFileSync(path.join(BUNDLE, file), 'utf8');
  for (const needle of needles) {
    if (!text.includes(needle)) {
      console.error(`   ${file} lost a path: expected "${needle}"`);
      process.exit(1);
    }
  }
  if (/^odejs/m.test(text)) { console.error(`   ${file} has a newline where \\nodejs should be`); process.exit(1); }
}
console.log('   START.cmd and DEMO-DATA.cmd keep their backslashes');

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
