/**
 * Request logging
 * Indian Railways WRS Raipur
 *
 * WHY THIS EXISTS NOW
 * -------------------
 * It was a stub. It generated a request id, timed the request, and then threw
 * the timing away — the body of the finish handler was a comment saying
 * "silent in testing/production unless debug enabled", and there was no debug
 * branch to enable. So the system produced no operational record of any kind.
 *
 * That is survivable on a laptop and not on a shop floor. When an inspector
 * says "it wouldn't save my spring at about eleven", the only way to answer
 * is a log with a time, a route, a status and a person in it. The audit chain
 * records what was decided; this records what the system was asked and what
 * it answered, which is a different question and the one that gets asked when
 * something goes wrong.
 *
 * WHAT IS DELIBERATELY NOT LOGGED
 * -------------------------------
 * No request bodies and no query strings. Bodies here carry passwords, TOTP
 * codes and sealed secrets, and a log is the easiest place in a system to
 * leak one from — it is copied, mailed and pasted into tickets by people who
 * would never handle the database that way. The route, the outcome and the
 * actor answer the operational question without any of that.
 *
 * One line of JSON per request, to stdout. Whatever runs the server —
 * systemd, Docker, a cloud log sink — collects stdout, so this needs no
 * configuration and no dependency.
 */

import type { Request, Response, NextFunction } from '../framework/index.ts';
import crypto from 'node:crypto';
import { clientIpOf } from './requestContext.ts';

/** Quiet during tests, so 988 test cases do not print 988 log lines. */
const SILENT = process.env.NODE_ENV === 'test' || process.env.WRS_LOG_SILENT === '1';

/**
 * Routes whose paths carry something private.
 *
 * A wagon number in a path is fine and useful. A token in a path is not, and
 * neither is a username — /api/auth/users/:id is an account, and an
 * operational log is not the place to accumulate a roster.
 */
function safePath(url: string): string {
  const path = (url || '').split('?')[0];
  return path
    .replace(/\/api\/auth\/users\/[^/]+/, '/api/auth/users/:id')
    .replace(/\/totp\/[^/]+/, '/totp/:id');
}

export interface RequestLogLine {
  ts: string;
  level: 'info' | 'warn' | 'error';
  msg: 'request';
  requestId: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  /** Who made it, when the request was authenticated. Never the token. */
  actor?: string;
  actorRole?: string;
  /** The client address, when the deployment can determine one honestly. */
  ip?: string;
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const requestId = (req.headers['x-request-id'] as string) || crypto.randomUUID();
  res.setHeader('X-Request-ID', requestId);

  const start = Date.now();

  res.on('finish', () => {
    if (SILENT) return;

    const status = res.statusCode || 0;
    const user = (req as any).user;

    const line: RequestLogLine = {
      ts: new Date().toISOString(),
      // 5xx is ours, 4xx is theirs, and the distinction is what makes a log
      // greppable when something is actually wrong.
      level: status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info',
      msg: 'request',
      requestId,
      method: req.method || 'GET',
      path: safePath(req.url || ''),
      status,
      durationMs: Date.now() - start
    };

    const ip = clientIpOf(req);
    if (ip) line.ip = ip;

    if (user?.id) {
      line.actor = user.id;
      line.actorRole = user.role;
    }

    // One JSON object per line: greppable by eye, parseable by anything.
    process.stdout.write(JSON.stringify(line) + '\n');
  });

  next();
}
