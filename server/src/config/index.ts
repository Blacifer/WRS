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
  nodeEnv: string;
}

export const config: AppConfig = {
  port: parseInt(process.env.PORT || '3000', 10),
  jwtSecret: process.env.JWT_SECRET || 'wrs-raipur-rdso-g95-secret-key-2026',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',
  dbPath: process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'wrs_inspections.db'),
  corsOrigin: process.env.CORS_ORIGIN || '*',
  nodeEnv: process.env.NODE_ENV || 'development'
};
