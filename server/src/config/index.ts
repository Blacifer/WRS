/**
 * Server Configuration & Environment Variables
 * Indian Railways WRS Raipur
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface AppConfig {
  port: number;
  jwtSecret: string;
  jwtExpiresIn: string;
  dbPath: string;
  corsOrigin: string;
  otpDelivery: 'INLINE' | 'SMS';
  nodeEnv: string;
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
  nodeEnv
};
