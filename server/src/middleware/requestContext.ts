/**
 * Who is at the other end of this request.
 *
 * The audit log has had an `ip_address` column since the first schema, and
 * `logAuditEvent` has always accepted one. Nothing filled it in. Three call
 * sites in the inventory repository passed the literal string '127.0.0.1',
 * which is worse than leaving it null — a fabricated address in an audit
 * ledger is exactly the kind of thing the ledger exists to prevent.
 *
 * The difficulty is that the code which writes audit entries is mostly
 * repository code, several layers below the request, and threading an IP
 * through every one of those signatures would put a plumbing argument into
 * seventeen call sites and guarantee that the eighteenth forgets it.
 *
 * AsyncLocalStorage carries it instead. One middleware opens a context per
 * request; anything that runs inside that request — however deep — can ask
 * for it. Work with no request behind it (a migration, a seed, a scheduled
 * job) gets no context and honestly logs no address.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { Request, Response, NextFunction } from '../framework/index.ts';

export interface RequestContext {
  /** The client's address, or null when it genuinely cannot be determined. */
  ip: string | null;
  requestId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Whether to believe X-Forwarded-For.
 *
 * That header is set by whoever spoke to us last, so a client can simply
 * assert one. It is trustworthy only when a proxy we control overwrites it,
 * which is true behind the deploy's nginx and behind the Cloudflare tunnel,
 * and false when the server is exposed directly. Defaulting to trusting it
 * would let anyone write a chosen IP into the audit log — so it is off unless
 * the deployment says otherwise.
 */
function trustsProxy(): boolean {
  return String(process.env.TRUST_PROXY || '').toLowerCase() === 'true';
}

export function clientIpOf(req: Request): string | null {
  if (trustsProxy()) {
    // Cloudflare's own header first: it is the tunnel's assertion of the
    // originating client and is not attacker-controllable behind the tunnel.
    const cf = req.headers['cf-connecting-ip'];
    if (typeof cf === 'string' && cf.trim()) return cf.trim();

    const fwd = req.headers['x-forwarded-for'];
    const raw = Array.isArray(fwd) ? fwd[0] : fwd;
    if (typeof raw === 'string' && raw.trim()) {
      // Left-most entry is the original client; the rest are proxy hops.
      const first = raw.split(',')[0]?.trim();
      if (first) return first;
    }
  }

  const socketAddress = (req as any).socket?.remoteAddress;
  if (typeof socketAddress === 'string' && socketAddress) {
    // Node reports IPv4 over a dual-stack socket as ::ffff:10.0.0.4.
    return socketAddress.startsWith('::ffff:') ? socketAddress.slice(7) : socketAddress;
  }
  return null;
}

export function requestContext(req: Request, _res: Response, next: NextFunction): void {
  const requestId = (req.headers['x-request-id'] as string) || crypto.randomUUID();
  storage.run({ ip: clientIpOf(req), requestId }, () => next());
}

/** The context for the request currently being served, if there is one. */
export function currentRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/** The client address for the request currently being served, if known. */
export function currentClientIp(): string | null {
  return storage.getStore()?.ip ?? null;
}
