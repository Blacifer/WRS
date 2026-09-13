/**
 * Server Configuration & Environment Variables
 * Indian Railways WRS Raipur
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Load the .env file before anything below reads process.env.
 *
 * Without this, a .env file is read by Docker Compose (which interpolates it
 * itself) and ignored by every other way of starting the server — including
 * `npm start`, which the deployment README documents. The visible symptom
 * would be a production start refusing to boot with a correct JWT_SECRET
 * sitting in the file beside it; the invisible one is worse, since a
 * development start would quietly run on the built-in fallback secret while
 * the operator believed the file was in effect.
 *
 * Two locations are tried because the server can be launched from either the
 * repository root or from server/. dotenv does not overwrite variables that
 * are already set, so a real environment variable — how Docker and any
 * managed host inject secrets — always wins over a file on disk, and the
 * more specific server/.env wins over the repository root.
 */
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
dotenv.config({ path: path.join(REPO_ROOT, 'server', '.env'), quiet: true });
dotenv.config({ path: path.join(REPO_ROOT, '.env'), quiet: true });

export interface AppConfig {
  port: number;
  jwtSecret: string;
  jwtExpiresIn: string;
  dbPath: string;
  /**
   * Where backups are written, and therefore where the readiness panel looks
   * for them.
   *
   * One value read by both the backup script and the health check, because
   * the two disagreeing is worse than either being wrong: the runbook tells
   * the shop to back up to a second drive, and a dashboard still looking in
   * the default folder would report "no backup" every day while a perfectly
   * good one sat on D:. The default is beside the database, which the panel
   * flags as not protection — deliberately, so the first thing an installer
   * sees is the instruction to move it.
   */
  backupDir: string;
  corsOrigin: string;
  otpDelivery: 'INLINE' | 'SMS';
  nodeEnv: string;

  /*
   * Zapheit, if this deployment has it. All three are optional and the server
   * must run without them.
   *
   * That is not politeness — it is the design. This app's core property is
   * that it works with no network, and a workshop LAN may have no route to the
   * internet at all. If the manual became unavailable whenever the link
   * dropped, it would be missing at exactly the moment an inspector holding a
   * component most needs it. Every AI path here degrades to what already
   * works: full-text search over the indexed manual, and the existing voice
   * parser.
   */
  zapheitApiKey: string | null;
  zapheitBaseUrl: string;
  zapheitModel: string;
}

const nodeEnv = process.env.NODE_ENV || 'development';

// The JWT secret must never fall back to a hardcoded default in production —
// anyone who has seen this source code would be able to forge valid tokens
// for any user, including ADMIN. Fail loudly at startup instead of silently
// running an insecure deployment.
if (nodeEnv === 'production' && !process.env.JWT_SECRET) {
  throw new Error(
    'JWT_SECRET environment variable is required when NODE_ENV=production. ' +
    'Refusing to start with the default development secret in a production deployment.'
  );
}

// A wildcard CORS origin in production means any website a logged-in user
// visits can call this API with their browser. Fine on a closed LAN during
// the pilot, not something to reach production unnoticed.
if (nodeEnv === 'production' && (!process.env.CORS_ORIGIN || process.env.CORS_ORIGIN === '*')) {
  console.warn(
    '[config] WARNING: CORS_ORIGIN is "*" in production. Set it to the exact origin ' +
    'the workshop tablets load the app from.'
  );
}

if (process.env.OTP_DELIVERY === 'SMS') {
  throw new Error(
    'OTP_DELIVERY=SMS is not implemented — no SMS gateway is integrated. ' +
    'Use OTP_DELIVERY=INLINE (the code is returned in the API response, which is ' +
    'an audited confirmation step but not a second factor), or add a delivery ' +
    'integration before selecting SMS.'
  );
}

export const config: AppConfig = {
  port: parseInt(process.env.PORT || '3000', 10),
  jwtSecret: process.env.JWT_SECRET || 'wrs-raipur-rdso-g95-secret-key-2026-DEV-ONLY',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',
  dbPath: process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'wrs_inspections.db'),
  backupDir:
    process.env.WRS_BACKUP_DIR ||
    path.resolve(path.dirname(process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'wrs_inspections.db')), 'backups'),
  corsOrigin: process.env.CORS_ORIGIN || '*',
  // How a supervisor receives their one-time code.
  //
  // 'INLINE' returns the code in the API response to whoever asked for it.
  // That is workable for a LAN pilot where the tablet is the supervisor's own
  // and the point of the step is a deliberate, audited confirmation — but it
  // is NOT a second factor, because possession of nothing extra is proven.
  // It is a setting rather than a silent default so the posture is a choice
  // somebody made, not an accident nobody noticed.
  //
  // 'SMS' requires a delivery integration and is not implemented; selecting it
  // makes the server refuse to start rather than pretend.
  otpDelivery: (process.env.OTP_DELIVERY || 'INLINE') as 'INLINE' | 'SMS',

  // Absent by default. Nothing in the system requires them to be set.
  zapheitApiKey: process.env.ZAPHEIT_API_KEY || null,
  zapheitBaseUrl: process.env.ZAPHEIT_BASE_URL || 'https://api.zapheit.com/v1',
  zapheitModel: process.env.ZAPHEIT_MODEL || 'gpt-4o-mini',

  nodeEnv
};
