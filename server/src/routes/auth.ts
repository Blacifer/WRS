/**
 * Authentication & OTP Route Handler
 * Indian Railways WRS Raipur
 */

import { Router } from '../framework/index.ts';
import type { Request, Response, NextFunction } from '../framework/index.ts';
import { verifyPassword, hashPassword } from '../auth/password.ts';
import { signToken } from '../auth/jwt.ts';
import { otpService } from '../auth/otpService.ts';
import { authMiddleware } from '../middleware/auth.ts';
import type { AuthenticatedRequest } from '../middleware/auth.ts';
import { requireCapability } from '../middleware/rbac.ts';
import { getDatabase } from '../db/connection.ts';
import { InspectionRepository } from '../db/repository.ts';
import { logAuditEvent } from '../db/auditLog.ts';
import type { UserRole, OtpAction } from '../../../shared/types.ts';
import { config } from '../config/index.ts';
import { TotpService } from '../auth/totpService.ts';

export const authRouter = Router();

/**
 * POST /api/auth/login
 */

/**
 * Login throttling.
 *
 * There was none: an unlimited number of password guesses could be made
 * against any account, at whatever rate the network allowed. On a workshop
 * LAN with known usernames (inspector1, supervisor1) and a shared initial
 * password policy, that is the easiest way into the system by a wide margin.
 *
 * Kept in memory deliberately — the lockout should reset if the server
 * restarts, and persisting failures would let an attacker fill the database.
 */
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;
const loginAttempts = new Map<string, { count: number; firstAt: number; lockedUntil: number }>();

function loginKey(username: string, req: any): string {
  const ip = req.socket?.remoteAddress || req.headers?.['x-forwarded-for'] || 'unknown';
  // Keyed on both, so one account being attacked cannot lock out a whole
  // shop floor sharing an IP, and one machine cannot spray every account.
  return `${String(username).toLowerCase()}|${ip}`;
}

function isLockedOut(key: string): number {
  const rec = loginAttempts.get(key);
  if (!rec) return 0;
  if (rec.lockedUntil > Date.now()) return Math.ceil((rec.lockedUntil - Date.now()) / 1000);
  if (rec.lockedUntil && rec.lockedUntil <= Date.now()) loginAttempts.delete(key);
  return 0;
}

function recordFailure(key: string): void {
  const now = Date.now();
  const rec = loginAttempts.get(key) || { count: 0, firstAt: now, lockedUntil: 0 };
  // Attempts age out, so occasional typos across a shift never accumulate
  // into a lockout.
  if (now - rec.firstAt > LOGIN_LOCKOUT_MS) {
    rec.count = 0;
    rec.firstAt = now;
  }
  rec.count += 1;
  if (rec.count >= LOGIN_MAX_ATTEMPTS) rec.lockedUntil = now + LOGIN_LOCKOUT_MS;
  loginAttempts.set(key, rec);
}

function clearFailures(key: string): void {
  loginAttempts.delete(key);
}

authRouter.post('/login', (req: Request, res: Response, next: NextFunction): void => {
  try {
    const { username, password } = req.body || {};

    if (!username || !password) {
      res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'Username and password are required',
        statusCode: 400,
        timestamp: new Date().toISOString()
      });
      return;
    }

    const attemptKey = loginKey(username, req);
    const lockedFor = isLockedOut(attemptKey);
    if (lockedFor > 0) {
      res.status(429).json({
        success: false,
        error: 'TOO_MANY_ATTEMPTS',
        message: `Too many failed sign-in attempts. Try again in ${Math.ceil(lockedFor / 60)} minute(s).`,
        retryAfterSeconds: lockedFor,
        statusCode: 429,
        timestamp: new Date().toISOString()
      });
      return;
    }

    const db = getDatabase();
    const repo = new InspectionRepository(db);
    const userRow = repo.getUserByUsername(username);

    if (!userRow || !verifyPassword(password, userRow.password_hash)) {
      recordFailure(attemptKey);

      /*
       * A refused sign-in is worth more to whoever reads this log than a
       * successful one. It is attributed to the system principal because the
       * audit table's foreign key needs a real user and, by definition, we do
       * not have one — the attempted username goes in the payload instead.
       * Never the password, including when someone types it in the wrong box.
       */
      logAuditEvent(db, {
        eventType: 'AUTH_LOGIN',
        userId: 'usr_system',
        userRole: 'SYSTEM',
        payload: {
          outcome: 'REFUSED',
          attemptedUsername: String(username).slice(0, 64),
          reason: userRow ? 'WRONG_PASSWORD' : 'NO_SUCH_USER'
        }
      });

      res.status(401).json({
        success: false,
        error: 'INVALID_CREDENTIALS',
        // Deliberately identical whether the user exists or not, so the
        // response cannot be used to enumerate valid usernames.
        message: 'Invalid username or password',
        statusCode: 401,
        timestamp: new Date().toISOString()
      });
      return;
    }

    /*
     * A demo password must not open a production deployment.
     *
     * seed.ts already refuses to CREATE the demo accounts when
     * NODE_ENV=production, and that guard is correct as far as it goes. It
     * does not go far enough: the realistic path to a live workshop is a
     * database that was seeded during development and then deployed, or a
     * server pointed at that same file. Those accounts already exist, and
     * until now production authenticated them happily — admin1/password123,
     * a full administrator, on whatever the shop is reachable from.
     *
     * Checked against the password actually supplied rather than against a
     * list of usernames, so it also catches a real account somebody created
     * with the demo password because it was in the README.
     *
     * The same deliberate escape hatch as the seed: SEED_DEMO_USERS=true, for
     * a supervised demonstration on a production build. It has to be typed on
     * purpose.
     */
    const DEMO_PASSWORD = 'password123';
    /*
     * Read from the environment at request time rather than from the config
     * singleton, which is resolved once at import. seed.ts makes the same
     * check the same way, so the two halves of this guard — refusing to
     * create the demo accounts, and refusing to authenticate them — cannot
     * drift apart or disagree about which environment they are in.
     */
    const demoAllowed =
      process.env.NODE_ENV !== 'production' || process.env.SEED_DEMO_USERS === 'true';

    if (!demoAllowed && password === DEMO_PASSWORD) {
      logAuditEvent(db, {
        eventType: 'SECURITY_ALERT',
        userId: 'usr_system',
        userRole: 'SYSTEM',
        payload: {
          action: 'DEMO_PASSWORD_REFUSED_IN_PRODUCTION',
          attemptedUsername: String(username).slice(0, 64)
        }
      });

      res.status(403).json({
        success: false,
        error: 'DEMO_CREDENTIAL_REFUSED',
        message:
          'This account still uses the demonstration password, which is published in ' +
          'the README and cannot be used on a production deployment. Set a real ' +
          'password for it from the User Accounts screen, or create the first ' +
          'administrator with BOOTSTRAP_ADMIN_USERNAME and BOOTSTRAP_ADMIN_PASSWORD.',
        statusCode: 403,
        timestamp: new Date().toISOString()
      });
      return;
    }

    clearFailures(attemptKey);

    const user = {
      id: userRow.id,
      username: userRow.username,
      name: userRow.full_name,
      role: userRow.role as UserRole,
      employeeId: userRow.employee_id
    };

    const token = signToken(user, 86400);

    /*
     * Every sign-in, recorded with its address.
     *
     * AUTH_LOGIN has been a permitted event type since the first schema and
     * had never once been written, so the log could show what someone did but
     * never that they had arrived. Asked for directly: everything logged, with
     * the date and where possible the address, from inspector to supervisor.
     */
    logAuditEvent(db, {
      eventType: 'AUTH_LOGIN',
      userId: user.id,
      userRole: user.role,
      payload: { outcome: 'SUCCESS', username: user.username, employeeId: user.employeeId }
    });

    res.status(200).json({
      success: true,
      token,
      expiresIn: 86400,
      user,
      data: {
        token,
        expiresIn: 86400,
        user
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/auth/request-otp
 */
authRouter.post('/request-otp', authMiddleware, (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  try {
    const { action = 'OVERRIDE' } = req.body || {};
    const userId = req.user?.id || 'usr_unknown';

    const otpResult = otpService.generateOtp(userId, action as OtpAction);

    res.status(200).json({
      success: true,
      otpId: otpResult.otpId,
      action,
      expiresInSeconds: otpResult.expiresInSeconds,
      // Said "sent to supervisor channel". Nothing was sent anywhere — the
      // code is in this response, which is the honest design for a workshop
      // with no mail or SMS on the shop floor, but the message described a
      // delivery that never happened and made this look like a second factor.
      message:
        'Confirmation code issued. It is returned here rather than sent — this is a ' +
        'deliberate second step on a consequential action, not a second factor. ' +
        'An enrolled authenticator app is the second factor.',
      // Returned because OTP_DELIVERY is INLINE — see config/index.ts. This is
      // an audited two-step confirmation, not a second factor: the code goes
      // back to whoever asked for it.
      devOtpCode: otpResult.otpCode,
      otpDelivery: config.otpDelivery,
      data: {
        otpId: otpResult.otpId,
        action,
        expiresInSeconds: otpResult.expiresInSeconds,
        devOtpCode: otpResult.otpCode
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/auth/verify-otp
 */
authRouter.post('/verify-otp', authMiddleware, (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  try {
    const { otpId, otpCode } = req.body || {};

    if (!otpId || !otpCode) {
      res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'otpId and otpCode are required',
        statusCode: 400,
        timestamp: new Date().toISOString()
      });
      return;
    }

    const result = otpService.verifyOtp(otpId, otpCode);

    if (!result.success) {
      res.status(400).json({
        success: false,
        error: 'OTP_VERIFICATION_FAILED',
        message: result.error || 'Failed to verify OTP',
        statusCode: 400,
        timestamp: new Date().toISOString()
      });
      return;
    }

    res.status(200).json({
      success: true,
      otpToken: result.otpToken,
      action: result.action,
      validUntil: new Date(Date.now() + 600 * 1000).toISOString(),
      data: {
        otpToken: result.otpToken,
        action: result.action,
        validUntil: new Date(Date.now() + 600 * 1000).toISOString()
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/auth/me
 */
authRouter.get('/me', authMiddleware, (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  try {
    res.status(200).json({
      success: true,
      user: req.user,
      data: req.user
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/auth/users — Admin-only: list all accounts (no password hashes).
 */
authRouter.get('/users', authMiddleware, requireCapability('users.manage'), (_req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  try {
    const db = getDatabase();
    const repo = new InspectionRepository(db);
    const users = repo.listUsers();
    res.status(200).json({ success: true, data: users });
  } catch (error) {
    next(error);
  }
});


/**
 * Requires a USER_MGMT action token on account changes.
 *
 * USER_MGMT was declared as an action type and enforced nowhere: creating,
 * deactivating and reactivating accounts needed only an admin session. Since
 * creating an account is how someone would grant themselves supervisor rights
 * — and deactivating one is how they would lock out the person who might
 * notice — this is the least defensible place to have had no second
 * confirmation.
 *
 * Admins without an authenticator enrolled are not blocked out of the system;
 * they are told to enrol, because the alternative is either a lockout or a
 * bypass, and neither is acceptable.
 */
function requireUserMgmtToken(req: AuthenticatedRequest, res: Response): boolean {
  const token = req.body?.otpToken || req.body?.otp || req.headers?.['x-otp-token'];
  if (!token) {
    res.status(401).json({
      success: false,
      error: 'OTP_REQUIRED',
      message:
        'Account changes require confirmation. Verify a code from your authenticator ' +
        'for the USER_MGMT action, then retry with the token it returns.',
      statusCode: 401,
      timestamp: new Date().toISOString()
    });
    return false;
  }
  if (!otpService.consumeActionToken(String(token), 'USER_MGMT')) {
    res.status(401).json({
      success: false,
      error: 'INVALID_OTP_TOKEN',
      message: 'That confirmation token is not valid for account changes.',
      statusCode: 401,
      timestamp: new Date().toISOString()
    });
    return false;
  }
  return true;
}

/**
 * POST /api/auth/users — Admin-only: create a real inspector/supervisor/admin account.
 */
authRouter.post('/users', authMiddleware, requireCapability('users.manage'), (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  if (!requireUserMgmtToken(req, res)) return;
  try {
    const { username, password, role, fullName, employeeId } = req.body || {};
    // DRM was missing here as well as in the form, so the only divisional
    // officer account that could ever exist was the seeded one.
    const validRoles = ['INSPECTOR', 'SUPERVISOR', 'ADMIN', 'DRM'];

    if (!username || !password || !role || !fullName || !employeeId) {
      res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'username, password, role, fullName, and employeeId are all required',
        statusCode: 400,
        timestamp: new Date().toISOString()
      });
      return;
    }

    if (!validRoles.includes(String(role).toUpperCase())) {
      res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: `role must be one of: ${validRoles.join(', ')}`,
        statusCode: 400,
        timestamp: new Date().toISOString()
      });
      return;
    }

    if (String(password).length < 8) {
      res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'password must be at least 8 characters',
        statusCode: 400,
        timestamp: new Date().toISOString()
      });
      return;
    }

    const db = getDatabase();
    const repo = new InspectionRepository(db);
    const user = repo.createUser({
      username,
      passwordHash: hashPassword(password),
      role: String(role).toUpperCase(),
      fullName,
      employeeId
    });

    res.status(201).json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/auth/users/:id/deactivate — Admin-only: soft-disable an account
 * (e.g. the seeded demo logins, once real accounts are in place). Never
 * hard-deletes — users are referenced by FK from inspection/audit rows.
 */
authRouter.patch('/users/:id/deactivate', authMiddleware, requireCapability('users.manage'), (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  if (!requireUserMgmtToken(req, res)) return;
  try {
    const db = getDatabase();
    const repo = new InspectionRepository(db);
    const user = repo.setUserActive(req.params.id, false);
    res.status(200).json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/auth/users/:id/reactivate — Admin-only: re-enable a disabled account.
 */
authRouter.patch('/users/:id/reactivate', authMiddleware, requireCapability('users.manage'), (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  if (!requireUserMgmtToken(req, res)) return;
  try {
    const db = getDatabase();
    const repo = new InspectionRepository(db);
    const user = repo.setUserActive(req.params.id, true);
    res.status(200).json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// TOTP — a real second factor
//
// The inline OTP flow above returns the code to whoever asked for it, because
// no SMS gateway is integrated. These endpoints replace that with a code
// generated on the supervisor's own device from a secret shared once, at
// enrolment, by QR scan. Nothing is procured and nothing needs connectivity.
// ---------------------------------------------------------------------------

authRouter.get('/totp/status', authMiddleware, (req: AuthenticatedRequest, res: Response): void => {
  if (!req.user?.id) {
    res.status(401).json({ success: false, error: 'UNAUTHORIZED', message: 'Sign in first.', statusCode: 401, timestamp: new Date().toISOString() });
    return;
  }
  const svc = new TotpService(getDatabase());
  res.status(200).json({
    success: true,
    data: { enrolled: svc.isEnrolled(req.user.id), username: req.user.username },
    timestamp: new Date().toISOString()
  });
});

authRouter.post('/totp/enrol', authMiddleware, (req: AuthenticatedRequest, res: Response): void => {
  if (!req.user?.id) {
    res.status(401).json({ success: false, error: 'UNAUTHORIZED', message: 'Sign in first.', statusCode: 401, timestamp: new Date().toISOString() });
    return;
  }
  try {
    const offer = new TotpService(getDatabase()).beginEnrolment(req.user.id);
    // The secret is returned once, here, so it can be rendered as a QR code
    // and typed by hand if a camera will not read it. It is not retrievable
    // afterwards — a second factor that can be fetched again on demand is not
    // a second factor.
    res.status(200).json({ success: true, data: offer, timestamp: new Date().toISOString() });
  } catch (err: any) {
    res.status(400).json({ success: false, error: 'ENROLMENT_FAILED', message: err?.message, statusCode: 400, timestamp: new Date().toISOString() });
  }
});

authRouter.post('/totp/confirm', authMiddleware, (req: AuthenticatedRequest, res: Response): void => {
  if (!req.user?.id) {
    res.status(401).json({ success: false, error: 'UNAUTHORIZED', message: 'Sign in first.', statusCode: 401, timestamp: new Date().toISOString() });
    return;
  }
  try {
    const ok = new TotpService(getDatabase()).confirmEnrolment(req.user.id, String(req.body?.code || ''), req.user.role);
    if (!ok) {
      res.status(400).json({
        success: false,
        error: 'INCORRECT_CODE',
        message: 'That code did not match. Check the time on the phone is correct, then try the next code.',
        statusCode: 400,
        timestamp: new Date().toISOString()
      });
      return;
    }
    res.status(200).json({ success: true, message: 'Authenticator enrolled.', timestamp: new Date().toISOString() });
  } catch (err: any) {
    res.status(400).json({ success: false, error: 'ENROLMENT_FAILED', message: err?.message, statusCode: 400, timestamp: new Date().toISOString() });
  }
});

authRouter.post('/totp/verify', authMiddleware, (req: AuthenticatedRequest, res: Response): void => {
  if (!req.user?.id) {
    res.status(401).json({ success: false, error: 'UNAUTHORIZED', message: 'Sign in first.', statusCode: 401, timestamp: new Date().toISOString() });
    return;
  }
  const action = req.body?.action;
  if (!['OVERRIDE', 'EXPORT', 'USER_MGMT'].includes(action)) {
    res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'action must be OVERRIDE, EXPORT or USER_MGMT.', statusCode: 400, timestamp: new Date().toISOString() });
    return;
  }

  const result = new TotpService(getDatabase()).verify(req.user.id, String(req.body?.code || ''));
  if (!result.ok) {
    res.status(401).json({ success: false, error: 'INCORRECT_CODE', message: result.reason, statusCode: 401, timestamp: new Date().toISOString() });
    return;
  }

  res.status(200).json({
    success: true,
    data: { otpToken: otpService.issueActionToken(req.user.id, action), action },
    timestamp: new Date().toISOString()
  });
});

authRouter.post('/users/:userId/totp/reset', authMiddleware, requireCapability('users.manage'), (req: AuthenticatedRequest, res: Response): void => {
  const targetId = req.params?.userId;
  if (!targetId || !req.user?.id) {
    res.status(400).json({ success: false, error: 'MISSING_PARAM', message: 'userId is required', statusCode: 400, timestamp: new Date().toISOString() });
    return;
  }
  try {
    new TotpService(getDatabase()).resetEnrolment(targetId, req.user.id, req.user.role);
    res.status(200).json({ success: true, message: 'Authenticator cleared. The user can enrol a new device.', timestamp: new Date().toISOString() });
  } catch (err: any) {
    res.status(400).json({ success: false, error: 'RESET_FAILED', message: err?.message, statusCode: 400, timestamp: new Date().toISOString() });
  }
});
