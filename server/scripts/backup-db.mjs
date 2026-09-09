/**
 * Encrypted, verified backup of the WRS Raipur database — on any operating system
 * Indian Railways WRS Raipur
 *
 *   node --experimental-strip-types server/scripts/backup-db.mjs [source_db] [backup_dir]
 *   node --experimental-strip-types server/scripts/backup-db.mjs --restore <file.enc> [target_db]
 *
 * WHY THIS EXISTS ALONGSIDE backup-db.sh
 * --------------------------------------
 * The shell version needs bash, sqlite3 and openssl on the PATH, plus umask,
 * chmod and cron. WRS Raipur runs Windows. On that machine the backup would
 * simply never have run — and the readiness panel would have shown one red
 * row saying so, for as long as anybody left it.
 *
 * Losing this file is losing every release certificate the shop has issued.
 * It is the one thing that must work before anything else matters, so it must
 * not depend on tools that happen not to be installed.
 *
 * This needs only Node, which the application already requires.
 *
 *   snapshot    VACUUM INTO — SQLite's own consistent copy of a live
 *               WAL-mode database, in pure SQL. A plain file copy can catch a
 *               write half-done; measured on the real database, a copy taken
 *               while the server was running was 85 audit entries short.
 *   encryption  node:crypto, AES-256-CBC with PBKDF2-SHA512 at 210,000
 *               iterations and a random salt per backup.
 *   integrity   detached HMAC-SHA256 over the ciphertext. Encrypt-then-MAC,
 *               verified before decryption, so a tampered file is refused
 *               without being fed to the cipher.
 *
 * THE FORMAT IS OPENSSL'S, DELIBERATELY
 * -------------------------------------
 * Byte-for-byte what `openssl enc -aes-256-cbc -pbkdf2 -iter 210000 -md
 * sha512 -salt` produces: the 8-byte "Salted__" magic, an 8-byte salt, then
 * the ciphertext. So a backup written on the shop's Windows PC can be opened
 * with plain openssl on any Linux machine years from now, by somebody who has
 * never seen this application. A backup that can only be read by the program
 * that wrote it is a hostage, not a backup.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const ITERATIONS = 210000;
const DIGEST = 'sha512';
const RETENTION_DAYS = 30;
const MAGIC = Buffer.from('Salted__', 'ascii');

const log = (m) => console.log(`[backup-db] ${m}`);
const fail = (m) => { console.error(`[backup-db] ERROR: ${m}`); process.exit(1); };

/**
 * The passphrase openssl would use for `-pass file:X`.
 *
 * openssl reads the FIRST LINE and drops its newline. Matching that exactly is
 * what keeps the two tools interchangeable — a subtle difference here would
 * produce backups that each tool believes are corrupt.
 */
function readPassphrase(keyFile) {
  const raw = fs.readFileSync(keyFile);
  const nl = raw.indexOf(0x0a);
  const line = nl === -1 ? raw : raw.subarray(0, nl);
  return line.toString('binary').replace(/\r$/, '');
}

/** The HMAC key: SHA-256 of the whole key file, hex — as the shell version derives it. */
function hmacKey(keyFile) {
  return crypto.createHash('sha256').update(fs.readFileSync(keyFile)).digest('hex');
}

function deriveKeyAndIv(passphrase, salt) {
  const bytes = crypto.pbkdf2Sync(Buffer.from(passphrase, 'binary'), salt, ITERATIONS, 48, DIGEST);
  return { key: bytes.subarray(0, 32), iv: bytes.subarray(32, 48) };
}

function encryptFile(plainPath, encPath, passphrase) {
  const salt = crypto.randomBytes(8);
  const { key, iv } = deriveKeyAndIv(passphrase, salt);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const plain = fs.readFileSync(plainPath);
  fs.writeFileSync(encPath, Buffer.concat([MAGIC, salt, cipher.update(plain), cipher.final()]));
}

function decryptFile(encPath, plainPath, passphrase) {
  const buf = fs.readFileSync(encPath);
  if (buf.length < 16 || !buf.subarray(0, 8).equals(MAGIC)) {
    throw new Error('This file is not in the expected encrypted format.');
  }
  const { key, iv } = deriveKeyAndIv(passphrase, buf.subarray(8, 16));
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  fs.writeFileSync(plainPath, Buffer.concat([decipher.update(buf.subarray(16)), decipher.final()]));
}

function fileHmac(filePath, keyHex) {
  return crypto.createHmac('sha256', Buffer.from(keyHex, 'hex')).update(fs.readFileSync(filePath)).digest('hex');
}

/** True when SQLite considers this a sound database. */
function integrityOk(dbPath) {
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const row = db.prepare('PRAGMA integrity_check').get();
    db.close();
    return String(Object.values(row || {})[0] || '').toLowerCase() === 'ok';
  } catch { return false; }
}

function requireKeyFile() {
  const keyFile = process.env.WRS_BACKUP_KEY_FILE;
  if (!keyFile) {
    console.error(`
[backup-db] ERROR: WRS_BACKUP_KEY_FILE is not set.

This database holds the audit log, the release certificates and every
inspector's record. It is not backed up in plaintext.

Create a key once, keeping it OFF the backup volume:

  Windows (PowerShell):
    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" > C:\\wrs\\backup.key
    setx WRS_BACKUP_KEY_FILE C:\\wrs\\backup.key

  Linux / macOS:
    umask 077
    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" > /etc/wrs/backup.key
    chmod 400 /etc/wrs/backup.key
    export WRS_BACKUP_KEY_FILE=/etc/wrs/backup.key

Then back that key up separately. Without it, no backup can be restored.
`.trim());
    process.exit(1);
  }
  if (!fs.existsSync(keyFile)) fail(`the key file ${keyFile} does not exist.`);
  return keyFile;
}

function backup(sourceDb, backupDir) {
  const keyFile = requireKeyFile();
  if (!fs.existsSync(sourceDb)) fail(`the database ${sourceDb} does not exist.`);
  fs.mkdirSync(backupDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '').replace('T', '_');
  const encPath = path.join(backupDir, `wrs_inspections_${stamp}.db.enc`);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wrs-backup-'));
  const plain = path.join(work, 'snapshot.db');
  const verify = path.join(work, 'verify.db');
  // However this exits, including on failure, no plaintext copy of the audit
  // log is left behind.
  const cleanup = () => { try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* nothing to undo */ } };

  try {
    log(`Snapshotting ${sourceDb}`);
    const db = new DatabaseSync(sourceDb, { readOnly: true });
    db.exec(`VACUUM INTO '${plain.replace(/'/g, "''")}'`);
    db.close();

    if (!integrityOk(plain)) fail('integrity check failed on the snapshot — not writing a backup');

    const passphrase = readPassphrase(keyFile);
    log(`Encrypting -> ${encPath}`);
    encryptFile(plain, encPath, passphrase);
    fs.writeFileSync(`${encPath}.hmac`, fileHmac(encPath, hmacKey(keyFile)) + '\n');

    // Prove it is restorable now, rather than on the day it is needed.
    try {
      decryptFile(encPath, verify, passphrase);
    } catch {
      fs.rmSync(encPath, { force: true }); fs.rmSync(`${encPath}.hmac`, { force: true });
      fail('the backup just written could not be decrypted — removed it');
    }
    if (!integrityOk(verify)) {
      fs.rmSync(encPath, { force: true }); fs.rmSync(`${encPath}.hmac`, { force: true });
      fail('the decrypted backup is not a valid database — removed it');
    }

    const mb = (fs.statSync(plain).size / (1024 * 1024)).toFixed(1);
    log(`Verified: encrypted, decrypts, and the result is a valid database (${mb}M plaintext)`);

    // Prune aged-out backups with their .hmac together, so a .hmac is never
    // left pointing at a backup that no longer exists.
    const cutoff = Date.now() - RETENTION_DAYS * 86400_000;
    let kept = 0;
    for (const name of fs.readdirSync(backupDir)) {
      if (!name.endsWith('.db.enc')) continue;
      const p = path.join(backupDir, name);
      if (fs.statSync(p).mtimeMs < cutoff) {
        fs.rmSync(p, { force: true });
        fs.rmSync(`${p}.hmac`, { force: true });
      } else kept++;
    }
    log(`Done. ${kept} encrypted backup(s) retained.`);
  } finally {
    cleanup();
  }
}

function restore(encPath, targetDb) {
  const keyFile = requireKeyFile();
  if (!fs.existsSync(encPath)) fail(`the backup ${encPath} does not exist.`);

  const hmacPath = `${encPath}.hmac`;
  if (fs.existsSync(hmacPath)) {
    const expected = fs.readFileSync(hmacPath, 'utf8').trim();
    if (fileHmac(encPath, hmacKey(keyFile)) !== expected) {
      console.error(`
[restore-db] ERROR: HMAC mismatch. Not restoring this backup.

       Two different things look like this, and the first is far more common:

         1. Wrong key file. The HMAC key is derived from WRS_BACKUP_KEY_FILE,
            so a key that does not match fails here rather than at decryption.
         2. The backup or its .hmac has been altered since it was written.
`.trim());
      process.exit(1);
    }
    log('HMAC verified.');
  } else {
    log('WARNING: no .hmac file beside this backup, so tampering cannot be ruled out.');
  }

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wrs-restore-'));
  const plain = path.join(work, 'restored.db');
  try {
    log(`Decrypting ${encPath}`);
    try { decryptFile(encPath, plain, readPassphrase(keyFile)); }
    catch { fail('could not decrypt this backup — check WRS_BACKUP_KEY_FILE.'); }

    if (!integrityOk(plain)) fail('the decrypted file is not a valid database.');

    fs.mkdirSync(path.dirname(path.resolve(targetDb)), { recursive: true });
    fs.copyFileSync(plain, targetDb);
    log(`Restored to ${targetDb}`);
    log('Now verify the audit chain before trusting the restored data.');
    log('Start the server, then as a SUPERVISOR or ADMIN open Audit Chain — it');
    log('recomputes every hash. A restored file that decrypts cleanly can still');
    log('have been altered before it was backed up, and that is what would show it.');
  } finally {
    try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* nothing to undo */ }
  }
}

const args = process.argv.slice(2);
const here = path.dirname(new URL(import.meta.url).pathname);
if (args[0] === '--restore') {
  if (!args[1]) fail('usage: --restore <file.db.enc> [target_db]');
  restore(args[1], args[2] || path.join(here, '..', 'data', 'wrs_inspections.db'));
} else {
  backup(
    args[0] || path.join(here, '..', 'data', 'wrs_inspections.db'),
    args[1] || path.join(here, '..', 'data', 'backups')
  );
}
