/**
 * Client Production Builder Script
 * Indian Railways WRS Raipur
 *
 * Compiles and builds the production distribution directory `client/dist`
 * containing index.html, public assets, fixtures, manifest, and service worker.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const clientDir = __dirname;
const distDir = path.join(clientDir, 'dist');
const publicDir = path.join(clientDir, 'public');

console.log('[Build] Building WRS Raipur Client PWA to dist/...');

// Ensure dist directory exists and is clean
if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true, force: true });
}
fs.mkdirSync(distDir, { recursive: true });

// Copy public directory recursively
function copyDirSync(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

copyDirSync(publicDir, distDir);

// Copy and transform index.html
const indexHtmlSrc = path.join(clientDir, 'index.html');
if (fs.existsSync(indexHtmlSrc)) {
  let html = fs.readFileSync(indexHtmlSrc, 'utf-8');
  fs.writeFileSync(path.join(distDir, 'index.html'), html, 'utf-8');
}

console.log('✅ Client PWA build complete at:', distDir);
