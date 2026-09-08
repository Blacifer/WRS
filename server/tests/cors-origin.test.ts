/**
 * Which origins the API actually admits
 * Indian Railways WRS Raipur
 *
 * WHY THESE EXIST
 * ---------------
 * The cors() middleware set Access-Control-Allow-Origin: * unconditionally and
 * ignored its options. config.corsOrigin existed, the production startup
 * warned when it was left open, and the readiness panel reported "Pinned to
 * <address>" — and none of that reached the function that sends the header.
 * A green tick described a header that was never sent.
 *
 * These pin the header that a browser actually receives, for the three cases
 * that matter: open, matching, and not matching.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { express, cors } from '../src/framework/index.ts';

function appWith(origin: string) {
  const app = express();
  app.use(cors({ origin }));
  app.get('/ping', (_req: any, res: any) => res.status(200).json({ ok: true }));
  return app;
}

describe('CORS honours the configured origin', () => {
  it('TC-CORS-01: "*" stays open, for a laptop pilot', async () => {
    const res = await appWith('*').dispatch({ method: 'GET', url: '/ping', headers: { origin: 'http://anything.example' } });
    assert.strictEqual(res.headers['access-control-allow-origin'], '*');
  });

  it('TC-CORS-02: a matching origin is echoed back, and only that one', async () => {
    const res = await appWith('http://192.168.1.19:3000').dispatch({
      method: 'GET', url: '/ping', headers: { origin: 'http://192.168.1.19:3000' }
    });
    assert.strictEqual(res.headers['access-control-allow-origin'], 'http://192.168.1.19:3000');
    assert.strictEqual(res.headers['vary'], 'Origin', 'caches must not serve one origin’s answer to another');
  });

  it('TC-CORS-03: a different origin gets no Allow-Origin header at all', async () => {
    // Omitting the header is how a browser is told no. Sending the configured
    // origin back to a stranger would tell them exactly which address to spoof.
    const res = await appWith('http://192.168.1.19:3000').dispatch({
      method: 'GET', url: '/ping', headers: { origin: 'http://evil.example' }
    });
    assert.strictEqual(res.headers['access-control-allow-origin'], undefined);
  });

  it('TC-CORS-04: a comma-separated list admits each of its members', async () => {
    const app = appWith('http://192.168.1.19:3000, http://192.168.1.20:3000');
    const a = await app.dispatch({ method: 'GET', url: '/ping', headers: { origin: 'http://192.168.1.20:3000' } });
    const b = await app.dispatch({ method: 'GET', url: '/ping', headers: { origin: 'http://192.168.1.21:3000' } });
    assert.strictEqual(a.headers['access-control-allow-origin'], 'http://192.168.1.20:3000');
    assert.strictEqual(b.headers['access-control-allow-origin'], undefined);
  });
});
