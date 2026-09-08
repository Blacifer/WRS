/**
 * Response headers that cost nothing and close real doors
 * Indian Railways WRS Raipur
 *
 * WHY THIS EXISTS
 * ---------------
 * None of these were set. Each one is a single line, and each closes a class of
 * attack that a security review of a system holding release certificates will
 * ask about by name:
 *
 *   X-Content-Type-Options   a browser must not guess that a photograph is a
 *                            script because the bytes happen to look like one.
 *   X-Frame-Options          nobody may put the sign-off screen inside their
 *                            own page and lay an invisible button over the
 *                            release control.
 *   Referrer-Policy          a wagon number in a URL must not travel to
 *                            whatever site an inspector opens next.
 *   Permissions-Policy       only this origin may use the camera and the
 *                            microphone — the two things this app genuinely
 *                            needs, and the two most sensitive to hand out.
 *
 * DELIBERATELY NOT HERE
 * ---------------------
 * Content-Security-Policy. It is the strongest of the set and also the one
 * that breaks a working application silently: this client uses inline styles,
 * a TensorFlow worker, a Tesseract worker and a service worker, and a policy
 * that has not been tested against every one of those ships a camera that
 * stops working with nothing in the log. It wants its own pass, verified
 * against the built client in a browser, not a line added here in passing.
 */

import type { Request, Response, NextFunction } from '../framework/index.ts';

export function securityHeaders() {
  return (_req: Request, res: Response, next: NextFunction): void => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
    next();
  };
}
