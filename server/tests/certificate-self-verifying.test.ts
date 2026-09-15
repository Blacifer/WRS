/**
 * A certificate that verifies itself anywhere
 * Indian Railways WRS Raipur
 *
 * The JSON certificate must be self-contained: the exact signed bytes, the
 * signature, and the public key, so a reader with no access to this server
 * — /verify.html in a browser, or three lines of Node at another railway —
 * can check it. And a passport must carry the certificate's signature so
 * the next shop can verify the certificate from the passport alone.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { createApp } from '../src/app.ts';
import { generateToken } from '../src/auth/jwt.ts';
import { getDatabase } from '../src/db/connection.ts';
import { verifyPassport } from '../src/reports/wagonPassport.ts';
import type { ExpressApp } from '../src/framework/index.ts';

const auth = (t: string) => ({ authorization: `Bearer ${t}` });

describe('the self-verifying certificate', () => {
  let app: ExpressApp; let insp: string; let sup: string;
  const wagon = 'SECR/BOXNHL/77001';

  before(async () => {
    app = createApp(':memory:');
    insp = generateToken({ id: 'usr_insp_001', username: 'inspector1', role: 'INSPECTOR', name: 'Ramesh Kumar' } as any);
    sup = generateToken({ id: 'usr_sup_001', username: 'supervisor1', role: 'SUPERVISOR', name: 'S. K. Verma' } as any);
    await app.dispatch({ method: 'POST', url: '/api/wagons/register', headers: auth(insp), body: { wagonNumber: wagon, wagonType: 'BOXNHL', owningRailway: 'SECR' } });
    for (const stg of ['DISMANTLING', 'COMPONENT_INSPECTION', 'REPAIR_REPLACEMENT', 'REASSEMBLY', 'FINAL_QC_GATE']) {
      await app.dispatch({ method: 'POST', url: `/api/wagons/${wagon}/transition`, headers: auth(insp), body: { targetStage: stg } });
    }
    const chk = await app.dispatch({ method: 'GET', url: `/api/wagons/${wagon}/checklist`, headers: auth(insp) });
    for (const item of chk.body.data.allItems) {
      await app.dispatch({ method: 'PUT', url: `/api/wagons/${wagon}/checklist/items/${item.id}`, headers: auth(insp), body: { status: 'PASS', reinspectedStatus: 'PASS' } });
    }
    await app.dispatch({ method: 'POST', url: '/api/inspections', headers: auth(insp), body: { wagonNumber: wagon, bogieType: 'CASNUB_22_NLB', condition: 'USED', springPosition: 'OUTER', measuredFreeHeight: 258.0 } });
    await app.dispatch({ method: 'POST', url: `/api/wagons/${wagon}/swt`, headers: auth(insp), body: {
      wagonType: 'BOXN', pipeType: 'SINGLE', loadCondition: 'EMPTY',
      readings: [{ ref: '1', value: 5.0 }, { ref: '2', value: 5.0 }, { ref: '3', value: 0.05 }, { ref: '4.1', value: 24 }, { ref: '4.2', value: 3.8 }, { ref: '4.3', value: 1.45 }, { ref: '5.1', value: 52 }, { ref: '6', value: 4 }, { ref: '7', observed: true }, { ref: '8.1', value: 25 }, { ref: '8.2', value: 3.8 }, { ref: '9', value: 85 }, { ref: '10', value: 0.05 }, { ref: '12', observed: true }]
    } });
    const gate = await app.dispatch({ method: 'GET', url: `/api/wagons/${wagon}/gate/status`, headers: auth(insp) });
    assert.equal(gate.body.data.canRelease, true, `not releasable: ${(gate.body.data.blockers || []).join('; ')}`);
    const so = await app.dispatch({ method: 'POST', url: `/api/wagons/${wagon}/gate/signoff`, headers: auth(sup), body: { otpToken: 'test_token_override' } });
    assert.equal(so.status, 200, JSON.stringify(so.body));
  });

  it('TC-CSV-01: the JSON certificate carries the signed bytes, the signature and the key, and a stranger verifies it with node:crypto alone', async () => {
    const res = await app.dispatch({ method: 'GET', url: `/api/wagons/${wagon}/certificate?format=json`, headers: auth(sup) });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const v = res.body.data.verification;
    assert.ok(v.signedContent && v.signature && v.publicKeyPem, 'self-contained');
    assert.equal(v.algorithm, 'Ed25519');
    assert.equal(v.verifyPage, '/verify.html');
    // Nothing from this server's modules: only the file and the standard library.
    const [alg, sig] = String(v.signature).split(':');
    assert.equal(alg, 'Ed25519');
    const ok = crypto.verify(null, Buffer.from(v.signedContent, 'utf8'), crypto.createPublicKey(v.publicKeyPem), Buffer.from(sig, 'base64'));
    assert.equal(ok, true);
    const fp = crypto.createHash('sha256').update(crypto.createPublicKey(v.publicKeyPem).export({ type: 'spki', format: 'der' }) as Buffer).digest('hex').slice(0, 16).toUpperCase();
    assert.equal(fp, v.publicKeyFingerprint, 'the fingerprint printed on the certificate is the key\'s');
    // The QR carries the first 16 hex characters of the certificate hash — the same hash as SHA-256 of the signed bytes.
    const certHash = crypto.createHash('sha256').update(v.signedContent).digest('hex');
    assert.match(res.body.data.qrData, new RegExp(certHash.slice(0, 16)));
    // A changed byte, and the same three lines refuse it.
    const bad = crypto.verify(null, Buffer.from(v.signedContent.replace('"summary"', '"summary_"'), 'utf8'), crypto.createPublicKey(v.publicKeyPem), Buffer.from(sig, 'base64'));
    assert.equal(bad, false);
  });

  it('TC-CSV-02: the passport carries the certificate\'s signature, and it verifies from the passport alone', async () => {
    const res = await app.dispatch({ method: 'GET', url: `/api/wagons/${wagon}/passport`, headers: auth(sup) });
    const v = verifyPassport(String(res.body));
    assert.deepEqual(v.reasons, []);
    const cert = v.events.find((e) => e.kind === 'CERTIFICATE')!;
    assert.ok(cert, 'CERTIFICATE event present');
    const p = cert.payload as any;
    const [, sig] = String(p.signature).split(':');
    const ok = crypto.verify(null, Buffer.from(p.signedContent, 'utf8'), crypto.createPublicKey(v.header!.issuer.publicKeyPem), Buffer.from(sig, 'base64'));
    assert.equal(ok, true, 'the certificate inside the passport verifies against the passport\'s key');
    const signoff = v.events.find((e) => e.kind === 'GATE_SIGNOFF')!;
    assert.equal((signoff.payload as any).certificateNumber, p.certificateNumber);
    assert.equal(crypto.createHash('sha256').update(p.signedContent).digest('hex'), (signoff.payload as any).certificateHash, 'and the sign-off\'s certificate hash is the hash of those bytes');
  });
});
