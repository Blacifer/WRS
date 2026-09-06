/**
 * One photograph cannot be unbounded
 * Indian Railways WRS Raipur
 *
 * Evidence photographs live as base64 in the same SQLite file as the audit
 * chain. Two of the four capture screens used to encode the camera's full
 * frame, so a single image could be megabytes — and the cost is not only
 * disk: every backup copies it, every query against the table drags it, and
 * the device holds the same bytes in IndexedDB while it waits for a network.
 *
 * Those screens now downscale. The server must not depend on that. A tablet
 * running an older bundle, or any caller that is not the app at all, would
 * otherwise still be able to write an arbitrarily large row into the table
 * that holds evidence.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';
import { generateToken } from '../src/auth/jwt.ts';
import { MAX_STORED_PHOTO_BYTES } from '../../shared/media/imageLimits.ts';
import type { ExpressApp } from '../src/framework/index.ts';

describe('Stored photograph size ceiling', () => {
  let app: ExpressApp;
  let token: string;
  const wagonNumber = 'SECR/BOXNHL/IMG001';

  const auth = () => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });

  before(async () => {
    app = createApp(':memory:');
    token = generateToken({
      id: 'usr_insp_001', username: 'inspector1', role: 'INSPECTOR',
      name: 'Ramesh Kumar', employeeId: 'WRS-INSP-1042'
    });
    await app.dispatch({
      method: 'POST', url: '/api/wagons/register', headers: auth(),
      body: { wagonNumber, wagonType: 'BOXNHL', owningRailway: 'SECR' }
    });
  });

  /** A data URL of a given payload size, without building a real image. */
  const payload = (bytes: number) => `data:image/jpeg;base64,${'A'.repeat(bytes)}`;

  test('TC-IMG-01: a photograph over the ceiling is refused, not stored', async () => {
    const res = await app.dispatch({
      method: 'POST', url: '/api/photos/upload', headers: auth(),
      body: {
        wagonNumber,
        partName: 'Brake Block',
        imageBase64: payload(MAX_STORED_PHOTO_BYTES + 1024)
      }
    });

    assert.equal(res.status, 413);
    assert.equal(res.body.error, 'PHOTO_TOO_LARGE');

    const list = await app.dispatch({
      method: 'GET', url: `/api/photos/wagon/${wagonNumber}`, headers: auth()
    });
    const photos = list.body?.data?.photos || list.body?.data || [];
    assert.equal(photos.length, 0, 'nothing may be written when the upload is refused');
  });

  test('TC-IMG-02: the refusal says how large it was and why, not just "too large"', async () => {
    const res = await app.dispatch({
      method: 'POST', url: '/api/photos/upload', headers: auth(),
      body: { wagonNumber, partName: 'Brake Block', imageBase64: payload(MAX_STORED_PHOTO_BYTES + 1024) }
    });

    // The person who hits this needs to know whether their device is out of
    // date or their image is genuinely unusual.
    assert.match(res.body.message, /MB/);
    assert.match(res.body.message, /older version/i);
  });

  test('TC-IMG-03: a photograph the capture path actually produces is accepted', async () => {
    // A 1600px JPEG at quality 0.85 measures a few hundred kilobytes.
    const res = await app.dispatch({
      method: 'POST', url: '/api/photos/upload', headers: auth(),
      body: { wagonNumber, partName: 'Brake Block', imageBase64: payload(300 * 1024) }
    });

    assert.equal(res.status, 201, `a normal capture must not be refused: ${res.body?.message}`);
  });

  test('TC-IMG-04: the limit applies to the imageData spelling too', async () => {
    // The route accepts either field name; a ceiling on one of them only
    // would be a ceiling on neither.
    const res = await app.dispatch({
      method: 'POST', url: '/api/photos/upload', headers: auth(),
      body: { wagonNumber, partName: 'Brake Block', imageData: payload(MAX_STORED_PHOTO_BYTES + 1024) }
    });
    assert.equal(res.status, 413);
  });
});
