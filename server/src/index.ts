/**
 * Server Startup & Port Binding
 * Indian Railways WRS Raipur
 */

import { createApp } from './app.ts';
import { config } from './config/index.ts';

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`🚂 WRS Raipur Spring Classification Server running on http://localhost:${config.port}`);
  console.log(`📋 RDSO Technical Pamphlet G-95 Revision-II Tables 28-33 Active`);
  console.log(`🔒 Append-Only SQLite Audit Logging Active (WAL Mode)`);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    process.exit(0);
  });
});
