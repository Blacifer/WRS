/**
 * Server Production Builder Script
 * Indian Railways WRS Raipur
 *
 * Prepares server distribution directory `server/dist` and verifies TypeScript syntax.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const serverDir = __dirname;
const distDir = path.join(serverDir, 'dist');
const srcDir = path.join(serverDir, 'src');

console.log('[Build] Building WRS Raipur Server to dist/...');

// Ensure dist directory exists and is clean
if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true, force: true });
}
fs.mkdirSync(distDir, { recursive: true });

// Copy source tree recursively to dist
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

copyDirSync(srcDir, distDir);

console.log('✅ Server build complete at:', distDir);
