/**
 * Server Startup & Port Binding
 * Indian Railways WRS Raipur
 */

import fs from 'node:fs';
import { createApp } from './app.ts';
import { config } from './config/index.ts';

const app = createApp();

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

process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    process.exit(0);
  });
});
