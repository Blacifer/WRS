/**
 * SQLite Database Connection & Initializer
 * Indian Railways WRS Raipur
 *
 * Configures WAL mode, Foreign Key constraints, and Memory Temp Stores.
 */

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/index.ts';

export interface IDatabase {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...args: any[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    get(...args: any[]): any;
    all(...args: any[]): any[];
  };
  close(): void;
}

let dbInstance: DatabaseSync | null = null;

export function getDatabase(dbPath?: string): DatabaseSync {
  if (dbInstance && !dbPath) {
    return dbInstance;
  }

  const targetPath = dbPath || config.dbPath;

  // Create directory if not memory database
  if (targetPath !== ':memory:') {
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new DatabaseSync(targetPath);

  // Apply high-concurrency and strict integrity PRAGMAs
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `);

  if (targetPath !== ':memory:') {
    try {
      db.exec(`PRAGMA journal_mode = WAL;`);
      db.exec(`PRAGMA synchronous = NORMAL;`);
    } catch {
      // WAL might already be active
    }
  }

  dbInstance = db;
  return db;
}

export function setDatabaseInstance(db: DatabaseSync): void {
  dbInstance = db;
}

export function closeDatabase(): void {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {
      // Ignore already closed error
    }
    dbInstance = null;
  }
}
