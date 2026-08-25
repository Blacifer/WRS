/**
 * TOTP enrolment and verification
 * Indian Railways WRS Raipur
 *
 * Wraps the RFC 6238 primitives in the things a real deployment needs: sealed
 * storage, a two-step enrolment that cannot half-succeed, replay protection,
 * and an administrator path for a supervisor who has lost their phone.
 */

import { DatabaseSync } from 'node:sqlite';
import { generateTotpSecret, verifyTotp, buildTotpUri } from './totp.ts';
import { seal, open } from './secretBox.ts';
import { logAuditEvent } from '../db/auditLog.ts';

const STEP_SECONDS = 30;
const DRIFT_WINDOW = 1;

export interface EnrolmentOffer {
  secret: string;
  uri: string;
}

export class TotpService {
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  private user(userId: string): any {
    return this.db
      .prepare('SELECT id, username, is_active, totp_secret_sealed, totp_enrolled_at, totp_last_counter FROM users WHERE id = ?')
      .get(userId);
  }

  public isEnrolled(userId: string): boolean {
    const u = this.user(userId);
    return !!(u && u.totp_enrolled_at && open(u.totp_secret_sealed));
  }

  /**
   * Begins enrolment: generates a secret and returns it with the URI an
   * authenticator app reads from a QR code.
   *
   * The secret is stored sealed but `totp_enrolled_at` stays null until a code
   * is confirmed. That matters: if the supervisor closes the page mid-scan,
   * they are not left in a state where the system believes they have a second
   * factor they cannot produce — which would lock them out of the release gate.
   */
  public beginEnrolment(userId: string): EnrolmentOffer {
    const u = this.user(userId);
    if (!u) throw new Error(`User ${userId} is not registered.`);
    if (!u.is_active) throw new Error(`User ${userId} is deactivated.`);

    const secret = generateTotpSecret();
    this.db
      .prepare('UPDATE users SET totp_secret_sealed = ?, totp_enrolled_at = NULL, totp_last_counter = NULL WHERE id = ?')
      .run(seal(secret), userId);

    return { secret, uri: buildTotpUri({ secret, accountName: u.username }) };
  }

  /**
   * Completes enrolment by proving the app and the server agree on a code.
   *
   * Without this step an enrolment could silently fail — a mistyped secret, a
   * phone with a badly wrong clock — and only be discovered at a release gate.
   */
  public confirmEnrolment(userId: string, code: string, actorRole = 'SUPERVISOR'): boolean {
    const u = this.user(userId);
    if (!u) throw new Error(`User ${userId} is not registered.`);

    const secret = open(u.totp_secret_sealed);
    if (!secret) throw new Error('No enrolment in progress. Start enrolment again.');

    if (!verifyTotp(secret, code, { step: STEP_SECONDS, window: DRIFT_WINDOW })) return false;

    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE users SET totp_enrolled_at = ?, totp_last_counter = ? WHERE id = ?')
      .run(now, Math.floor(Date.now() / 1000 / STEP_SECONDS), userId);

    logAuditEvent(this.db, {
      eventType: 'OTP_VERIFIED' as any,
      userId,
      userRole: actorRole,
      payload: { action: 'TOTP_ENROLLED' }
    });
    return true;
  }

  /**
   * Verifies a code from the supervisor's authenticator.
   *
   * A code accepted once is not accepted again. TOTP codes stay valid for
   * roughly ninety seconds once drift tolerance is included, and without this
   * a code shoulder-surfed at a release gate could be reused within that
   * window — which is precisely the moment it would be worth reusing.
   */
  public verify(userId: string, code: string): { ok: boolean; reason?: string } {
    const u = this.user(userId);
    if (!u) return { ok: false, reason: 'User is not registered.' };
    if (!u.is_active) return { ok: false, reason: 'User is deactivated.' };
    if (!u.totp_enrolled_at) return { ok: false, reason: 'No authenticator is enrolled for this user.' };

    const secret = open(u.totp_secret_sealed);
    if (!secret) {
      // Sealed under a different server secret, or damaged. Say so plainly
      // rather than reporting a wrong code, which would send the supervisor
      // to check their phone for a fault that is not there.
      return { ok: false, reason: 'The stored authenticator secret cannot be read. Re-enrol this user.' };
    }

    if (!verifyTotp(secret, code, { step: STEP_SECONDS, window: DRIFT_WINDOW })) {
      return { ok: false, reason: 'Incorrect code.' };
    }

    const counter = Math.floor(Date.now() / 1000 / STEP_SECONDS);
    if (u.totp_last_counter !== null && counter <= u.totp_last_counter) {
      return { ok: false, reason: 'That code has already been used. Wait for the next one.' };
    }

    this.db.prepare('UPDATE users SET totp_last_counter = ? WHERE id = ?').run(counter, userId);
    return { ok: true };
  }

  /**
   * Clears an enrolment so the user can enrol a new device.
   *
   * A lost phone is the ordinary case, not an edge case, and without this the
   * only remedy would be editing the database by hand. Recorded in the audit
   * chain against the administrator who did it, because removing someone's
   * second factor is exactly the action an attacker would want.
   */
  public resetEnrolment(userId: string, byUserId: string, byRole: string): void {
    const u = this.user(userId);
    if (!u) throw new Error(`User ${userId} is not registered.`);

    this.db
      .prepare('UPDATE users SET totp_secret_sealed = NULL, totp_enrolled_at = NULL, totp_last_counter = NULL WHERE id = ?')
      .run(userId);

    logAuditEvent(this.db, {
      eventType: 'SECURITY_ALERT' as any,
      userId: byUserId,
      userRole: byRole,
      payload: { action: 'TOTP_RESET', targetUserId: userId, targetUsername: u.username }
    });
  }
}
