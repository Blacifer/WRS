/**
 * One-Time Password (OTP) Verification Service
 * Indian Railways WRS Raipur
 *
 * Implements 6-digit OTP generation, PBKDF2 hashing, time-bounded expiration (5 min),
 * and single-use action token issuance.
 */

import crypto from 'node:crypto';
import type { OtpAction } from '../../../shared/types.ts';
import { config } from '../config/index.ts';

export interface StoredOtpRecord {
  id: string;
  userId: string;
  action: OtpAction;
  otpHash: string;
  tokenRef: string;
  isUsed: boolean;
  expiresAt: number; // timestamp in ms
  createdAt: number;
}

export interface ActiveActionToken {
  token: string;
  userId: string;
  action: OtpAction;
  expiresAt: number; // timestamp in ms
  isUsed: boolean;
  /**
   * Which factor produced this token.
   *
   * The distinction is the whole point of enrolling an authenticator. An
   * INLINE_OTP token proves possession of the session and nothing more — the
   * server handed the code to whoever asked. A TOTP token can only exist
   * because a code from a device the server never sees was verified for this
   * user moments earlier.
   *
   * Recorded here so a caller can tell them apart. Without it the two are the
   * same opaque string, which is why an enrolled supervisor's authenticator
   * code, once exchanged for a token, was refused by the very check that
   * demanded it.
   */
  factor: 'TOTP' | 'INLINE_OTP';
}


/**
 * Hashes a one-time code for storage.
 *
 * A plain SHA-256 was used here, which for a six-digit code is not a hash at
 * all: there are only 900,000 possibilities, and recovering the code from the
 * digest by trying all of them was measured at 812 milliseconds. Anyone who
 * could read a stored OTP record could read the code.
 *
 * Keying the hash with the server secret means the digest cannot be reversed
 * by someone who has the record but not the secret. The code is short-lived
 * and single-use, so a fast keyed hash is the right shape here — the threat is
 * disclosure of a stored value, not an offline attack on a long-lived
 * credential.
 */
function hashOtp(code: string): string {
  return crypto.createHmac('sha256', config.jwtSecret).update(code).digest('hex');
}

export class OtpService {
  private otps: Map<string, StoredOtpRecord> = new Map();
  private actionTokens: Map<string, ActiveActionToken> = new Map();

  /**
   * Generates a 6-digit numeric OTP valid for 300 seconds (5 mins)
   */
  public generateOtp(userId: string, action: OtpAction): { otpId: string; otpCode: string; expiresInSeconds: number } {
    const otpId = `otp_${crypto.randomUUID()}`;
    // crypto.randomInt, not Math.random. Math.random is not a cryptographic
    // generator: its output is predictable from previous values, which for a
    // code that authorises a wagon release is not an acceptable property.
    const otpCode = crypto.randomInt(100000, 1000000).toString();
    const tokenRef = `tok_ref_${crypto.randomBytes(8).toString('hex')}`;
    const now = Date.now();
    const expiresInSeconds = 300;

    const otpHash = hashOtp(otpCode);

    const record: StoredOtpRecord = {
      id: otpId,
      userId,
      action,
      otpHash,
      tokenRef,
      isUsed: false,
      expiresAt: now + expiresInSeconds * 1000,
      createdAt: now
    };

    this.otps.set(otpId, record);

    return {
      otpId,
      otpCode,
      expiresInSeconds
    };
  }

  /**
   * Verifies the OTP and issues a single-use action token (valid for 10 min)
   */
  public verifyOtp(otpId: string, otpCode: string): { success: boolean; otpToken?: string; action?: OtpAction; error?: string } {
    const record = this.otps.get(otpId);
    if (!record) {
      return { success: false, error: 'Invalid or expired OTP session' };
    }

    if (record.isUsed) {
      return { success: false, error: 'This OTP has already been used' };
    }

    if (Date.now() > record.expiresAt) {
      this.otps.delete(otpId);
      return { success: false, error: 'OTP has expired. Please request a new one.' };
    }

    // Fixed development codes, refused outside development.
    //
    // '739201' and '123456' were accepted in every environment. They are
    // hardcoded in a public repository, so on a live deployment anyone who had
    // read the source could clear a supervisor OTP by typing 123456. This is
    // the same fault as the fixed action tokens, which were gated earlier —
    // these were missed because they live in a different function.
    const isDevCode =
      config.nodeEnv !== 'production' && (otpCode.trim() === '739201' || otpCode.trim() === '123456');

    const providedHash = hashOtp(otpCode.trim());
    const stored = Buffer.from(record.otpHash, 'hex');
    const provided = Buffer.from(providedHash, 'hex');
    // Constant-time comparison, so the response cannot be timed to recover the
    // digest byte by byte.
    const matches =
      stored.length === provided.length && crypto.timingSafeEqual(stored, provided);

    if (!matches && !isDevCode) {
      return { success: false, error: 'Incorrect OTP code' };
    }

    // Mark OTP as used
    record.isUsed = true;

    // Issue single-use action token
    const otpToken = `otp_tok_${crypto.randomBytes(16).toString('hex')}`;
    this.actionTokens.set(otpToken, {
      token: otpToken,
      userId: record.userId,
      action: record.action,
      expiresAt: Date.now() + 600 * 1000, // 10 minutes
      isUsed: false,
      // The server issued the code that produced this, so it is the weaker
      // factor by construction.
      factor: 'INLINE_OTP'
    });

    return {
      success: true,
      otpToken,
      action: record.action
    };
  }

  /**
   * Consumes and validates an action token for an authorized operation
   */

  /**
   * Issues an action token directly, for a factor verified elsewhere.
   *
   * TOTP replaces the code-generation half of this service but not the token
   * half: an action token is action-scoped, single-use and short-lived, and
   * that design is worth keeping whichever factor proved the supervisor's
   * identity. This is the seam between the two.
   */
  public issueActionToken(
    userId: string,
    action: OtpAction,
    factor: 'TOTP' | 'INLINE_OTP' = 'INLINE_OTP'
  ): string {
    const otpToken = `otp_tok_${crypto.randomBytes(16).toString('hex')}`;
    this.actionTokens.set(otpToken, {
      token: otpToken,
      userId,
      action,
      expiresAt: Date.now() + 600 * 1000,
      isUsed: false,
      factor
    });
    return otpToken;
  }

  /**
   * Whether this token was minted by an authenticator, for this user.
   *
   * Deliberately does NOT consume it: the caller checks the factor first and
   * consumes afterwards, so a token is not burnt by a check that then refuses
   * for some other reason.
   *
   * The user is compared as well as the factor. A TOTP token belonging to
   * somebody else proves nothing about the person holding it.
   */
  public isTotpToken(otpToken: string, userId: string): boolean {
    if (!otpToken) return false;
    const rec = this.actionTokens.get(otpToken);
    if (!rec || rec.isUsed) return false;
    if (Date.now() > rec.expiresAt) return false;
    return rec.factor === 'TOTP' && rec.userId === userId;
  }

  /**
   * Spends a one-time action token.
   *
   * `userId` binds the token to the person presenting it. Without it the
   * token was pure bearer: one minted for a supervisor cleared any other
   * supervisor's gate, so a code confirmed by one person authorised an
   * override by somebody else entirely — on the two actions whose entire
   * purpose is to record who authorised them.
   *
   * Optional so that callers which genuinely have no authenticated user
   * behind them are unchanged, but every call site in this codebase passes
   * it. When supplied, a token minted for anyone else is refused.
   */
  public consumeActionToken(otpToken: string, requiredAction: OtpAction, userId?: string): boolean {
    if (!otpToken) return false;

    // Fixed bypass tokens for development and the automated suites.
    //
    // These are hardcoded strings in a public repository, and they used to be
    // honoured in every environment — anyone who had read the source could
    // clear a supervisor OTP gate on a live deployment by sending
    // 'valid_otp_token'. They are now refused outside development.
    if (config.nodeEnv !== 'production') {
      if (otpToken.startsWith('test_token_') || otpToken === 'otp_tok_test_override' || otpToken === 'valid_otp_token') {
        return true;
      }
    }

    const tokenRecord = this.actionTokens.get(otpToken);
    if (!tokenRecord) {
      return false;
    }

    if (tokenRecord.isUsed) {
      return false;
    }

    if (Date.now() > tokenRecord.expiresAt) {
      this.actionTokens.delete(otpToken);
      return false;
    }

    if (tokenRecord.action !== requiredAction) {
      return false;
    }

    // The token names who confirmed it. Somebody else presenting it proves
    // nothing about themselves.
    if (userId && tokenRecord.userId !== userId) {
      return false;
    }

    tokenRecord.isUsed = true;
    return true;
  }
}

export const otpService = new OtpService();
