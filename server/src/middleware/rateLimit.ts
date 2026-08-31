/**
 * Rate limiting
 * Indian Railways WRS Raipur
 *
 * WHY, GIVEN LOGIN IS ALREADY PROTECTED
 * -------------------------------------
 * Sign-in has had its own lockout for a while — five failures and the pair of
 * (username, address) is refused for fifteen minutes. That one stays where it
 * is, because it counts failures rather than requests, and for a password
 * that distinction is the whole point.
 *
 * Everything else has been unlimited. On a workshop LAN that was tolerable.
 * It stops being tolerable the moment this is reachable through a tunnel,
 * which is now one command and a URL anybody with the link can open: the
 * sign-in endpoint is guarded and the twenty routes behind it are not.
 *
 * WHAT THIS IS AND IS NOT FOR
 * ---------------------------
 * It is a brake on abuse and on a client stuck in a loop — this codebase has
 * already produced one of those, a speech recogniser that retried about a
 * hundred and fifty times in two seconds. It is not a defence against a
 * serious denial of service, which is a network-layer problem and belongs in
 * front of the application rather than inside it.
 *
 * The ceiling sits well above real work so it never touches an inspector.
 * Sorting is one tap per spring, roughly seven hundred a shift — two a second
 * at the very fastest, in bursts. Three hundred a minute is more than an
 * order of magnitude above that, and nobody reaches it by working quickly.
 */

import type { Request, Response, NextFunction } from '../framework/index.ts';
import { verifyToken } from '../auth/jwt.ts';

export const DEFAULT_WINDOW_MS = 60 * 1000;

/**
 * Signed-in callers get a generous ceiling; anonymous ones do not.
 *
 * The first draft used one number for both, at 300 a minute, and the
 * adversarial suite caught what that would have done in the field. It fires
 * 500 requests to prove sequence numbers stay monotonic under load, and got
 * throttled — which is the same shape as the thing that actually matters:
 * an inspector who worked a full shift offline has ~700 springs queued, and
 * the sync drains them one request per spring as fast as the network allows.
 * A limit below that turns a normal reconnection into a stream of refusals.
 *
 * So the two cases are separated, because they are different risks. An
 * authenticated inspector emptying a queue is the system working. An
 * unauthenticated caller has almost nothing legitimate to do here — sign in,
 * and ask for health — so their allowance is much tighter than the old
 * single number, not looser.
 */
export const DEFAULT_MAX_REQUESTS = 1000;
export const ANONYMOUS_MAX_REQUESTS = 60;

interface Bucket {
  count: number;
  windowStart: number;
}

/*
 * Counters live on the middleware instance, not on the module.
 *
 * They were module-level, and the whole test suite shares one process: 590
 * cases across 45 files accumulated into a single bucket and eventually
 * tripped a limit none of them had any business reaching. That was a real
 * defect wearing a test failure's clothes — two servers created in one
 * process would have shared one allowance in production too, which is not
 * something anybody would have chosen.
 *
 * In memory either way, like the login lockout, for the same two reasons: a
 * restart clearing it is correct behaviour, and persisting a counter keyed on
 * whatever an unauthenticated caller sends would let them fill the database.
 */
const allBuckets: Array<Map<string, Bucket>> = [];

/** Keeps a map from growing without bound on a long-running server. */
function sweep(buckets: Map<string, Bucket>, now: number, windowMs: number): void {
  if (buckets.size < 5000) return;
  for (const [key, b] of buckets) {
    if (now - b.windowStart > windowMs * 2) buckets.delete(key);
  }
}

/**
 * Identifies the caller.
 *
 * An authenticated user is keyed by id rather than address, so a whole shop
 * floor behind one router does not share one allowance — sharing it would let
 * one busy inspector throttle everybody else, which is the usual way a rate
 * limit causes more trouble than the abuse it was added for.
 *
 * WHY THIS VERIFIES THE TOKEN ITSELF
 * ----------------------------------
 * It read req.user, which is set by the route's auth middleware — and this
 * limiter runs on /api before any route is reached, so req.user was always
 * undefined and every caller was treated as anonymous. The authenticated
 * ceiling was unreachable; the adversarial suite found it by being refused
 * while holding a perfectly good token.
 *
 * Reading the header without checking the signature would have been worse
 * than the bug: anyone could claim an id to get the larger allowance, or
 * rotate through invented ids for an unlimited number of buckets. So the
 * signature is verified — the same check the auth middleware performs, one
 * HMAC, and an unsigned or forged token simply falls through to the address.
 */
function callerKey(req: Request): string {
  const user = (req as any).user;
  if (user?.id) return `user:${user.id}`;

  const header = req.headers?.authorization || req.headers?.Authorization;
  const raw = Array.isArray(header) ? header[0] : header;
  if (typeof raw === 'string' && raw.toLowerCase().startsWith('bearer ')) {
    const payload = verifyToken(raw.slice(7).trim());
    if (payload?.id) return `user:${payload.id}`;
  }

  const socket = (req as any).socket;
  const forwarded = req.headers?.['x-forwarded-for'];
  const ip = socket?.remoteAddress
    || (Array.isArray(forwarded) ? forwarded[0] : forwarded)
    || 'unknown';
  return `ip:${ip}`;
}

export function rateLimit(options?: { windowMs?: number; max?: number; anonymousMax?: number }) {
  const windowMs = options?.windowMs ?? DEFAULT_WINDOW_MS;
  const authenticatedMax = options?.max ?? DEFAULT_MAX_REQUESTS;
  const anonymousMax = options?.anonymousMax ?? options?.max ?? ANONYMOUS_MAX_REQUESTS;

  const buckets = new Map<string, Bucket>();
  allBuckets.push(buckets);

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const key = callerKey(req);
    const max = key.startsWith('user:') ? authenticatedMax : anonymousMax;
    sweep(buckets, now, windowMs);

    let bucket = buckets.get(key);
    if (!bucket || now - bucket.windowStart >= windowMs) {
      bucket = { count: 0, windowStart: now };
    }
    bucket.count += 1;
    buckets.set(key, bucket);

    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - bucket.count)));

    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.windowStart + windowMs - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({
        success: false,
        error: 'RATE_LIMITED',
        // Written for whoever reads it, which on a shop floor is an inspector
        // rather than an operator — and it says the work is safe, because
        // somebody who thinks it is not will reach for paper.
        message:
          `Too many requests in a short time. Try again in ${retryAfter} second(s). ` +
          `Anything already recorded is safe.`,
        retryAfterSeconds: retryAfter,
        statusCode: 429,
        timestamp: new Date().toISOString()
      });
      return;
    }

    next();
  };
}

/** Test seam: forget every counter, on every limiter created so far. */
export function resetRateLimits(): void {
  for (const buckets of allBuckets) buckets.clear();
}
