/**
 * Server Startup & Port Binding
 * Indian Railways WRS Raipur
 */

import fs from 'node:fs';
import path from 'node:path';
import { createApp } from './app.ts';
import { config } from './config/index.ts';
import { getDatabase, closeDatabase } from './db/connection.ts';
import { STARTS_LOG } from './routes/health.ts';
import { startBackupSchedule } from './backup/scheduler.ts';

const app = createApp();

/*
 * Every start, on the record.
 *
 * This server exits on purpose when something goes badly wrong, and
 * START.cmd brings it back five seconds later — so a fault that recurs looks,
 * from a tablet, like nothing at all: the app answers, mostly. One line per
 * start beside the database lets the readiness panel say "restarted eleven
 * times since yesterday", which is the sentence that gets somebody to open
 * the log. Appended, never rotated: a line a day is nothing, and eleven in a
 * night is the point.
 */
try {
  fs.appendFileSync(
    path.join(path.dirname(config.dbPath), STARTS_LOG),
    `${new Date().toISOString()} pid=${process.pid} node=${process.version} tls=${!!(process.env.TLS_KEY_PATH && process.env.TLS_CERT_PATH)}\n`
  );
} catch {
  // A start that cannot be written down is still a start.
}

// Serve over TLS when a certificate is provided. Camera and voice input are
// both gated behind a secure context, so a phone reaching this over plain HTTP
// on the LAN silently loses hands-free entry — the one thing that keeps an
// inspector's hands on the gauge instead of the keyboard.
const tlsKeyPath = process.env.TLS_KEY_PATH;
const tlsCertPath = process.env.TLS_CERT_PATH;
const useTls = !!(tlsKeyPath && tlsCertPath && fs.existsSync(tlsKeyPath) && fs.existsSync(tlsCertPath));

const server = useTls
  ? app.listenTls(
      config.port,
      { key: fs.readFileSync(tlsKeyPath!), cert: fs.readFileSync(tlsCertPath!) },
      () => {
        console.log(`🚂 WRS Raipur server running on https://localhost:${config.port}`);
        console.log(`🔐 TLS enabled — camera and voice input available on the LAN`);
        console.log(`📋 RDSO Technical Pamphlet G-95 Revision-II Tables 28-33 Active`);
      }
    )
  : app.listen(config.port, () => {
      console.log(`🚂 WRS Raipur Spring Classification Server running on http://localhost:${config.port}`);
      console.log(`📋 RDSO Technical Pamphlet G-95 Revision-II Tables 28-33 Active`);
      console.log(`🔒 Append-Only SQLite Audit Logging Active (WAL Mode)`);
    });

/*
 * The nightly backup, from inside the server.
 *
 * Off for a read-only mirror (it holds a restored copy, not the record) and
 * for tests; on for everything else. The readiness panel reads what it wrote.
 */
const stopBackupSchedule = process.env.WRS_BACKUP_SCHEDULE === 'off' || process.env.WRS_READ_ONLY_MIRROR === 'true' || config.nodeEnv === 'test'
  ? () => {}
  : startBackupSchedule({
      dbPath: config.dbPath, backupDir: config.backupDir, photoDir: config.photoDir,
      hour: process.env.WRS_BACKUP_HOUR ? Number(process.env.WRS_BACKUP_HOUR) : 2,
      log: (line) => console.log(line)
    });

/*
 * A mirror reopens its database when the refresh script has swapped it.
 *
 * SQLite cannot have the file replaced underneath an open handle, so
 * mirror-refresh.mjs writes the restored copy beside it and drops a flag;
 * the server exits cleanly, and the start loop (START.cmd, or the mirror's
 * systemd unit) brings it back on the new file within seconds.
 */
if (process.env.WRS_READ_ONLY_MIRROR === 'true') {
  const flag = path.join(path.dirname(config.dbPath), 'mirror-restart.flag');
  setInterval(() => {
    if (fs.existsSync(flag)) {
      try { fs.unlinkSync(flag); } catch { /* the restart is what matters */ }
      console.log('[mirror] a fresh copy has been restored; restarting to open it');
      process.kill(process.pid, 'SIGTERM');
    }
  }, 15_000).unref();
}

/*
 * Shutting down without leaving work half-written.
 *
 * This closed the HTTP server and never closed the database. In WAL mode that
 * leaves a write-ahead log to be recovered on next start — survivable, and
 * untidy for something a backup script may copy moments later. A checkpoint
 * on the way out folds it back into the main file.
 *
 * SIGINT was not handled at all, which is the signal that actually arrives:
 * the shop stops this with Ctrl+C in a terminal, not with a service manager.
 */
let shuttingDown = false;

function shutdown(signal: string, code = 0): void {
  if (shuttingDown) return;   // a second Ctrl+C must not race the first
  shuttingDown = true;
  stopBackupSchedule();

  console.log(`${signal} received. Shutting down gracefully...`);

  const finish = () => {
    try {
      // Fold the write-ahead log back into the database before letting go.
      getDatabase().exec('PRAGMA wal_checkpoint(TRUNCATE);');
    } catch {
      // A database that cannot be checkpointed is one SQLite will recover on
      // its own; it must not stop the process from exiting.
    }
    try { closeDatabase(); } catch { /* already closed */ }
    process.exit(code);
  };

  server.close(finish);

  /*
   * A held-open connection must not keep the process alive indefinitely. Five
   * seconds is longer than any request this server serves and short enough
   * that nobody stands there wondering whether it worked.
   */
  setTimeout(finish, 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

/*
 * Failures nobody caught.
 *
 * The router awaits every handler and routes a thrown error to the error
 * middleware, so a failing request cannot bring the process down. What can is
 * background work — anything started and not awaited — and in Node 22 an
 * unhandled rejection terminates the process by default, with a stack trace
 * to a terminal nobody is watching and no explanation of what was lost.
 *
 * The choice here is deliberate: log it in full, close the database cleanly,
 * and exit non-zero rather than carrying on. This system writes safety
 * records, and continuing after an unknown failure risks writing them wrongly
 * — a server that is plainly down is a better failure than one that is
 * quietly unreliable. Run it under something that restarts it.
 */
function fatal(kind: string, err: unknown): void {
  console.error(`[fatal] ${kind}. The server is stopping rather than continuing in an unknown state.`);
  console.error(err);
  shutdown(kind, 1);
}

process.on('uncaughtException', (err) => fatal('uncaughtException', err));
process.on('unhandledRejection', (reason) => fatal('unhandledRejection', reason));
