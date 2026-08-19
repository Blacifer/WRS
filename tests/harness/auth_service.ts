/**
 * Role-Based Access Control (RBAC) & Security Service
 * Indian Railways WRS Raipur
 *
 * Implements 3-tier RBAC (Inspector, Supervisor, Admin), JWT/HMAC token issuance,
 * and OTP verification for sensitive operations (Overrides, Exports, User Mgmt).
 */

import crypto from 'node:crypto';
import type { User, UserRole, OTPRequest, OTPVerification } from '../../shared/types.ts';

interface StoredUser {
  id: string;
  username: string;
  passwordHash: string;
  name: string;
  role: UserRole;
  isActive: boolean;
}

interface StoredOTP {
  otpId: string;
  userId: string;
  action: string;
  code: string;
  expiresAt: number;
  consumed: boolean;
}

export class AuthService {
  private secretKey: string;
  private users: Map<string, StoredUser> = new Map();
  private otps: Map<string, StoredOTP> = new Map();
  private verifiedOtpTokens: Map<string, { userId: string; action: string; expiresAt: number }> = new Map();

  constructor(secretKey: string = 'wrs-raipur-rdso-g95-secret-key-2026') {
    this.secretKey = secretKey;
    this.seedDefaultUsers();
  }

  private hashPassword(password: string): string {
    return crypto.createHmac('sha256', this.secretKey).update(password).digest('hex');
  }

  private seedDefaultUsers(): void {
    const defaultAccounts = [
      { id: 'user-insp-001', username: 'inspector1', password: 'password123', name: 'R. K. Sharma (Inspector)', role: 'Inspector' as UserRole },
      { id: 'user-sup-001', username: 'supervisor1', password: 'password123', name: 'A. K. Verma (Supervisor)', role: 'Supervisor' as UserRole },
      { id: 'user-adm-001', username: 'admin1', password: 'password123', name: 'DRM Officer Raipur (Admin)', role: 'Admin' as UserRole }
    ];

    for (const acc of defaultAccounts) {
      this.users.set(acc.username, {
        id: acc.id,
        username: acc.username,
        passwordHash: this.hashPassword(acc.password),
        name: acc.name,
        role: acc.role,
        isActive: true
      });
    }
  }

  /**
   * Authenticate user credentials
   */
  public login(username: string, password: string): { token: string; user: User } | null {
    const user = this.users.get(username);
    if (!user || !user.isActive) return null;

    const hash = this.hashPassword(password);
    if (hash !== user.passwordHash) return null;

    const token = this.generateToken(user);
    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role
      }
    };
  }

  /**
   * Create signed token for session
   */
  private generateToken(user: StoredUser): string {
    const payload = {
      sub: user.id,
      username: user.username,
      role: user.role,
      name: user.name,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (24 * 3600) // 24 hours
    };

    const headerB64 = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto.createHmac('sha256', this.secretKey)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url');

    return `${headerB64}.${payloadB64}.${signature}`;
  }

  /**
   * Verify and decode bearer token
   */
  public verifyToken(token: string): User | null {
    if (!token || typeof token !== 'string') return null;

    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signature] = parts;
    const expectedSig = crypto.createHmac('sha256', this.secretKey)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url');

    if (signature !== expectedSig) return null;

    try {
      const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'));
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
        return null; // Expired
      }

      return {
        id: payload.sub,
        username: payload.username,
        name: payload.name,
        role: payload.role
      };
    } catch {
      return null;
    }
  }

  /**
   * Request OTP for sensitive action
   */
  public requestOTP(req: OTPRequest): { otpId: string; codeForTest: string; message: string } {
    const otpId = crypto.randomUUID();
    // 6-digit random code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + (5 * 60 * 1000); // 5 minutes validity

    this.otps.set(otpId, {
      otpId,
      userId: req.userId,
      action: req.action,
      code,
      expiresAt,
      consumed: false
    });

    return {
      otpId,
      codeForTest: code,
      message: `OTP sent for action ${req.action}`
    };
  }

  /**
   * Verify OTP and issue single-use OTP authorization token
   */
  public verifyOTP(verification: OTPVerification): { success: boolean; otpToken?: string; error?: string } {
    const otp = this.otps.get(verification.otpId);
    if (!otp) {
      return { success: false, error: 'Invalid OTP ID' };
    }

    if (otp.consumed) {
      return { success: false, error: 'OTP has already been used' };
    }

    if (Date.now() > otp.expiresAt) {
      return { success: false, error: 'OTP has expired' };
    }

    if (otp.code !== verification.otpCode) {
      return { success: false, error: 'Incorrect OTP code' };
    }

    // Mark consumed
    otp.consumed = true;

    // Issue OTP token valid for 10 minutes
    const otpToken = crypto.randomBytes(24).toString('hex');
    this.verifiedOtpTokens.set(otpToken, {
      userId: otp.userId,
      action: otp.action,
      expiresAt: Date.now() + (10 * 60 * 1000)
    });

    return { success: true, otpToken };
  }

  /**
   * Check if an OTP token is valid for a specific action
   */
  public validateOtpToken(otpToken: string, expectedAction: string): boolean {
    if (!otpToken) return false;
    const item = this.verifiedOtpTokens.get(otpToken);
    if (!item) return false;
    if (Date.now() > item.expiresAt) {
      this.verifiedOtpTokens.delete(otpToken);
      return false;
    }
    return item.action === expectedAction;
  }

  /**
   * Consume OTP token after successful sensitive action
   */
  public consumeOtpToken(otpToken: string): void {
    this.verifiedOtpTokens.delete(otpToken);
  }

  /**
   * Check RBAC permission for a given action
   */
  public checkPermission(user: User, action: 'INSPECT' | 'OVERRIDE' | 'VIEW_REPORTS' | 'EXPORT' | 'ADMIN'): boolean {
    switch (action) {
      case 'INSPECT':
        return ['Inspector', 'Supervisor', 'Admin'].includes(user.role);
      case 'VIEW_REPORTS':
        return ['Supervisor', 'Admin'].includes(user.role);
      case 'OVERRIDE':
        return ['Supervisor', 'Admin'].includes(user.role);
      case 'EXPORT':
        return ['Admin'].includes(user.role);
      case 'ADMIN':
        return ['Admin'].includes(user.role);
      default:
        return false;
    }
  }
}
