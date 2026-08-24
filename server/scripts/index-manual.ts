/**
 * Builds the searchable index of the RDSO Wagon Maintenance Manual.
 *
 *   npm run index-manual -- "/path/to/Vol-I (System Documentation).pdf"
 *   npm run index-manual -- /path/to/already-extracted.txt
 *
 * A PDF is converted with pdftotext -layout (poppler). If that is not
 * installed, extract the text yourself and pass the .txt instead — the
 * indexer only ever needs text.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { getDatabase } from '../src/db/connection.ts';
import { runMigrations } from '../src/db/migrations.ts';
import { indexManualText, getManualStats } from '../src/manual/manualIndex.ts';

const PDFTOTEXT_CANDIDATES = ['/opt/homebrew/bin/pdftotext', '/usr/local/bin/pdftotext', 'pdftotext'];

function extractPdf(pdfPath: string): string {
  const out = path.join(os.tmpdir(), `wmm_${Date.now()}.txt`);
  let lastErr: unknown = null;

  for (const bin of PDFTOTEXT_CANDIDATES) {
    try {
      execFileSync(bin, ['-layout', pdfPath, out], { stdio: 'pipe' });
      const text = fs.readFileSync(out, 'utf8');
      fs.unlinkSync(out);
      return text;
    } catch (e) {
      lastErr = e;
    }
  }

  throw new Error(
    `Could not run pdftotext (tried: ${PDFTOTEXT_CANDIDATES.join(', ')}).\n` +
    `Install poppler (brew install poppler / apt-get install poppler-utils), or extract the\n` +
    `text yourself and pass the .txt file to this script instead.\n` +
    `Underlying error: ${(lastErr as any)?.message || lastErr}`
  );
}

function main() {
  const input = process.argv[2];
  if (!input) {
    console.error('Usage: npm run index-manual -- "/path/to/manual.pdf"  (or a .txt)');
    process.exit(1);
  }
  if (!fs.existsSync(input)) {
    console.error(`File not found: ${input}`);
    process.exit(1);
  }

  console.log(`Reading ${path.basename(input)} ...`);
  const raw = input.toLowerCase().endsWith('.pdf')
    ? extractPdf(input)
    : fs.readFileSync(input, 'utf8');

  console.log(`Extracted ${raw.length.toLocaleString()} characters.`);

  const db = getDatabase();
  runMigrations(db);

  const { passageCount, pageCount } = indexManualText(db, raw, path.basename(input));

  console.log(`Indexed ${passageCount.toLocaleString()} passages across ${pageCount} pages.`);
  console.log('Stats:', JSON.stringify(getManualStats(db), null, 2));
  console.log('\nInspectors can now search the manual from inside the app.');
}

main();
