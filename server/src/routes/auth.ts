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
import { requireRole } from '../middleware/rbac.ts';
import { getDatabase } from '../db/connection.ts';
import { InspectionRepository } from '../db/repository.ts';
import type { UserRole, OtpAction } from '../../../shared/types.ts';
import { config } from '../config/index.ts';

export const authRouter = Router();

/**
 * POST /api/auth/login
 */
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

    const db = getDatabase();
    const repo = new InspectionRepository(db);
    const userRow = repo.getUserByUsername(username);

    if (!userRow || !verifyPassword(password, userRow.password_hash)) {
      res.status(401).json({
        success: false,
        error: 'INVALID_CREDENTIALS',
        message: 'Invalid username or password',
        statusCode: 401,
        timestamp: new Date().toISOString()
      });
      return;
    }

    const user = {
      id: userRow.id,
      username: userRow.username,
      name: userRow.full_name,
      role: userRow.role as UserRole,
      employeeId: userRow.employee_id
    };

    const token = signToken(user, 86400);

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
      message: 'OTP has been generated and sent to supervisor channel',
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
authRouter.get('/users', authMiddleware, requireRole('ADMIN'), (_req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
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
 * POST /api/auth/users — Admin-only: create a real inspector/supervisor/admin account.
 */
authRouter.post('/users', authMiddleware, requireRole('ADMIN'), (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  try {
    const { username, password, role, fullName, employeeId } = req.body || {};
    const validRoles = ['INSPECTOR', 'SUPERVISOR', 'ADMIN'];

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
authRouter.patch('/users/:id/deactivate', authMiddleware, requireRole('ADMIN'), (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
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
authRouter.patch('/users/:id/reactivate', authMiddleware, requireRole('ADMIN'), (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  try {
    const db = getDatabase();
    const repo = new InspectionRepository(db);
    const user = repo.setUserActive(req.params.id, true);
    res.status(200).json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
});
