/**
 * An ended session must say so
 * Indian Railways WRS Raipur
 *
 * A token lasts a day, so on a tablet left signed in on the shop floor,
 * expiry mid-shift is a certainty rather than an edge case. Nothing handled
 * it: requests simply began failing.
 *
 * The work itself was never at risk — a failed write falls back to the
 * IndexedDB queue, and the sync keeps whatever the server did not accept. But
 * the queue then never drained, the pending badge climbed, and the only thing
 * the inspector was told was that things were failing. Somebody who is not
 * told their session ended has no reason to think signing in again would fix
 * it, and every reason to think the app has lost their work.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api } from './api.ts';

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });

describe('Session expiry', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    api.setSession('a-token', { id: 'u1', username: 'inspector1', role: 'INSPECTOR', name: 'R' } as any);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    api.clearSession();
  });

  it('drops the session and tells the app when the server stops accepting it', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(401, { message: 'Token expired' })) as any;

    let told = false;
    const off = api.onSessionExpired(() => { told = true; });

    await expect(api.getWagonDetail('SECR/BOXNHL/1')).rejects.toThrow();

    expect(told, 'the app has to know, or it shows a screen that quietly stops working').toBe(true);
    expect(api.getToken()).toBeNull();
    off();
  });

  it('does NOT sign the user out on a permission refusal', async () => {
    /*
     * 403 is the server refusing an action this user may not take — a
     * supervisor reaching for the divisional analytics. Signing them out over
     * it would be both wrong and infuriating.
     */
    globalThis.fetch = vi.fn(async () => jsonResponse(403, { message: 'Forbidden' })) as any;

    let told = false;
    const off = api.onSessionExpired(() => { told = true; });

    await expect(api.getWagonDetail('SECR/BOXNHL/1')).rejects.toThrow();

    expect(told).toBe(false);
    expect(api.getToken()).toBe('a-token');
    off();
  });

  it('does not fire on a wrong password at the login form', async () => {
    // A 401 there means the credentials were wrong, and the form says so.
    api.clearSession();
    api.setSession('a-token', { id: 'u1' } as any);
    globalThis.fetch = vi.fn(async () => jsonResponse(401, { message: 'Invalid credentials' })) as any;

    let told = false;
    const off = api.onSessionExpired(() => { told = true; });

    await expect(api.login({ username: 'x', password: 'y' } as any)).rejects.toThrow();

    expect(told).toBe(false);
    off();
  });

  it('says the work is safe, because it is', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(401, {})) as any;

    await expect(api.getWagonDetail('SECR/BOXNHL/1')).rejects.toThrow(/nothing you recorded has been lost/i);
  });

  it('one broken listener does not stop the others being told', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(401, {})) as any;

    let second = false;
    const offA = api.onSessionExpired(() => { throw new Error('boom'); });
    const offB = api.onSessionExpired(() => { second = true; });

    await expect(api.getWagonDetail('SECR/BOXNHL/1')).rejects.toThrow();

    expect(second).toBe(true);
    offA(); offB();
  });
});
