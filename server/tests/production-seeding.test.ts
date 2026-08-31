/**
 * The demo accounts must not follow the build into production
 * Indian Railways WRS Raipur
 *
 * seedUsers is called from createApp, so it ran on every start in every
 * environment. The four demo logins are documented in the README with the
 * password 'password123', which means a deployment would have come up with a
 * working admin1/password123 reachable by anyone, and nothing anywhere would
 * have mentioned it. The roster is deferred until after the DRM has seen the
 * system, which is exactly what makes this the step that gets forgotten.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../src/db/migrations.ts';
import { seedUsers } from '../src/db/seed.ts';

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  runMigrations(db);
  return db;
}

const realUsers = (db: DatabaseSync) =>
  (db.prepare(`SELECT COUNT(*) AS n FROM users WHERE username != 'system'`).get() as { n: number }).n;

const has = (db: DatabaseSync, username: string) =>
  Boolean(db.prepare('SELECT 1 FROM users WHERE username = ?').get(username));

const saved = { ...process.env };

afterEach(() => {
  for (const k of ['NODE_ENV', 'SEED_DEMO_USERS', 'BOOTSTRAP_ADMIN_USERNAME', 'BOOTSTRAP_ADMIN_PASSWORD']) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('Seeding across environments', () => {
  it('creates the demo accounts in development, where they are wanted', () => {
    process.env.NODE_ENV = 'development';
    const db = freshDb();
    seedUsers(db);
    assert.ok(has(db, 'inspector1'), 'development lost the demo inspector');
    assert.ok(has(db, 'drm1'), 'development lost the DRM account');
  });

  it('creates no demo account in production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.SEED_DEMO_USERS;
    delete process.env.BOOTSTRAP_ADMIN_USERNAME;
    delete process.env.BOOTSTRAP_ADMIN_PASSWORD;

    const db = freshDb();
    seedUsers(db);

    for (const u of ['inspector1', 'supervisor1', 'admin1', 'drm1']) {
      assert.ok(!has(db, u), `${u} was created on a production database`);
    }
    assert.equal(realUsers(db), 0, 'production seeded accounts it should not have');
  });

  it('still allows a supervised demonstration when asked for on purpose', () => {
    process.env.NODE_ENV = 'production';
    process.env.SEED_DEMO_USERS = 'true';
    const db = freshDb();
    seedUsers(db);
    assert.ok(has(db, 'admin1'), 'the deliberate escape hatch did not work');
  });

  it('creates a real first administrator from the environment instead', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.SEED_DEMO_USERS;
    process.env.BOOTSTRAP_ADMIN_USERNAME = 'wrs.admin';
    process.env.BOOTSTRAP_ADMIN_PASSWORD = 'a-properly-long-passphrase';

    const db = freshDb();
    seedUsers(db);

    assert.ok(has(db, 'wrs.admin'), 'no way into a fresh production deployment');
    assert.ok(!has(db, 'admin1'), 'the demo administrator came along anyway');
  });

  it('refuses a short bootstrap password rather than weakening the only account', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.SEED_DEMO_USERS;
    process.env.BOOTSTRAP_ADMIN_USERNAME = 'wrs.admin';
    process.env.BOOTSTRAP_ADMIN_PASSWORD = 'short';

    const db = freshDb();
    seedUsers(db);
    assert.ok(!has(db, 'wrs.admin'), 'a five-character password was accepted for an administrator');
  });

  it('does not bootstrap over a deployment that already has real accounts', () => {
    process.env.NODE_ENV = 'production';
    process.env.BOOTSTRAP_ADMIN_USERNAME = 'wrs.admin';
    process.env.BOOTSTRAP_ADMIN_PASSWORD = 'a-properly-long-passphrase';

    const db = freshDb();
    db.prepare(`
      INSERT INTO users (id, username, password_hash, role, full_name, employee_id, is_active)
      VALUES ('usr_real', 'k.sharma', 'x', 'SUPERVISOR', 'K. Sharma', 'WRS-SUP-1', 1)
    `).run();

    seedUsers(db);
    assert.ok(!has(db, 'wrs.admin'), 'a bootstrap account appeared on a live deployment');
  });
});
