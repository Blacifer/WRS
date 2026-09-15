#!/usr/bin/env node
/**
 * A certificate for the workshop LAN, made with nothing but Node
 * Indian Railways WRS Raipur
 *
 *   node server/scripts/make-lan-cert.mjs [out_dir] [extra-ip-or-name ...]
 *
 * WHY THIS EXISTS
 * ---------------
 * A browser gives a page the camera, the microphone and a service worker only
 * from a secure context — https, or localhost. The shop's tablets reach the
 * PC over the LAN, so over plain http they get none of those: no photograph
 * of a condemned spring, no QR scan, no voice, no offline reload. The server
 * has served TLS for months when given a certificate; the USB bundle never
 * gave it one, because the only thing that made certificates here was
 * openssl in pilot-tunnel.sh, and the shop PC has no openssl.
 *
 * Node has no certificate generator either. It does have RSA keys, SHA-256
 * signatures and DER export of a public key, and an X.509 certificate is
 * nothing more than those in a fixed ASN.1 shape. So that shape is written
 * out here, by hand, in about a hundred lines — and checked against openssl
 * and a real TLS handshake in scripts/lan-cert-drill.sh, because a
 * certificate that is one byte wrong fails on the tablet, not here.
 *
 * WHAT IT MAKES
 * -------------
 *   lan-key.pem    RSA-2048 private key. Stays on the PC.
 *   lan-cert.pem   Self-signed X.509 v3, CA:TRUE, for the server to present.
 *   lan-cert.crt   The same certificate in DER, which Android and Windows
 *                  install from a tap. Copied to a tablet ONCE and installed
 *                  as a trusted certificate, it stops the browser warning
 *                  for good. See docs/TABLET_TRUST.md.
 *
 * The certificate names every IPv4 address this machine has, plus localhost
 * and any extra names given on the command line. A certificate that does not
 * name the address the tablet typed is warned about even once installed, so
 * if the PC's address changes, run this again.
 *
 * It is valid for 825 days — the longest Apple and Chrome accept without
 * complaint — and refuses to overwrite a key that already exists.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// DER, the minimum of it
// ---------------------------------------------------------------------------

function len(n) {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  while (n > 0) { bytes.unshift(n & 0xff); n >>= 8; }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const tlv = (tag, content) => Buffer.concat([Buffer.from([tag]), len(content.length), content]);
const seq = (...parts) => tlv(0x30, Buffer.concat(parts));
const set = (...parts) => tlv(0x31, Buffer.concat(parts));
const ctx = (n, ...parts) => tlv(0xa0 | n, Buffer.concat(parts));   // [n] EXPLICIT
const nul = () => Buffer.from([0x05, 0x00]);
const bool = (v) => Buffer.from([0x01, 0x01, v ? 0xff : 0x00]);
const octets = (b) => tlv(0x04, b);
const utf8 = (s) => tlv(0x0c, Buffer.from(s, 'utf8'));
const bits = (b, unused = 0) => tlv(0x03, Buffer.concat([Buffer.from([unused]), b]));
function integer(buf) {
  // Positive: a leading zero if the high bit is set, as DER demands.
  let b = buf;
  while (b.length > 1 && b[0] === 0 && !(b[1] & 0x80)) b = b.subarray(1);
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
  return tlv(0x02, b);
}
function oid(dotted) {
  const parts = dotted.split('.').map(Number);
  const out = [parts[0] * 40 + parts[1]];
  for (const p of parts.slice(2)) {
    const enc = [];
    let v = p;
    do { enc.unshift(v & 0x7f); v = Math.floor(v / 128); } while (v > 0);
    for (let i = 0; i < enc.length - 1; i++) enc[i] |= 0x80;
    out.push(...enc);
  }
  return tlv(0x06, Buffer.from(out));
}
function utcTime(d) {
  const p = (n) => String(n).padStart(2, '0');
  return tlv(0x17, Buffer.from(
    `${String(d.getUTCFullYear()).slice(2)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`,
    'ascii'
  ));
}

const OID = {
  sha256WithRSA: '1.2.840.113549.1.1.11',
  commonName: '2.5.4.3',
  organization: '2.5.4.10',
  basicConstraints: '2.5.29.19',
  keyUsage: '2.5.29.15',
  subjectAltName: '2.5.29.17',
  subjectKeyId: '2.5.29.14'
};

// ---------------------------------------------------------------------------
// The certificate
// ---------------------------------------------------------------------------

export function makeSelfSigned({ commonName, organization, ips, dnsNames, days = 825 }) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const spki = publicKey.export({ type: 'spki', format: 'der' });

  const name = seq(
    set(seq(oid(OID.organization), utf8(organization))),
    set(seq(oid(OID.commonName), utf8(commonName)))
  );
  const notBefore = new Date(Date.now() - 60_000);
  const notAfter = new Date(notBefore.getTime() + days * 86400_000);

  // SubjectAltName: dNSName [2] IA5String, iPAddress [7] OCTET STRING (4 bytes).
  const san = seq(
    ...dnsNames.map((d) => tlv(0x82, Buffer.from(d, 'ascii'))),
    ...ips.map((ip) => tlv(0x87, Buffer.from(ip.split('.').map(Number))))
  );
  // keyUsage: digitalSignature (bit 0), keyEncipherment (bit 2), keyCertSign (bit 5)
  // as a BIT STRING: 1 unused bit, byte 10100100 = 0xa4? bits are numbered
  // from the most significant: bit0=0x80, bit2=0x20, bit5=0x04 -> 0xa4.
  const keyUsage = bits(Buffer.from([0xa4]), 2);
  const skid = crypto.createHash('sha1').update(spki).digest();

  const extensions = ctx(3, seq(
    seq(oid(OID.basicConstraints), bool(true), octets(seq(bool(true)))),
    seq(oid(OID.keyUsage), bool(true), octets(keyUsage)),
    seq(oid(OID.subjectAltName), octets(san)),
    seq(oid(OID.subjectKeyId), octets(octets(skid)))
  ));

  const sigAlg = seq(oid(OID.sha256WithRSA), nul());
  const tbs = seq(
    ctx(0, integer(Buffer.from([2]))),        // version v3
    integer(crypto.randomBytes(16)),          // serial
    sigAlg,
    name,                                     // issuer
    seq(utcTime(notBefore), utcTime(notAfter)),
    name,                                     // subject (self-signed)
    spki,
    extensions
  );
  const signature = crypto.sign('sha256', tbs, privateKey);
  const cert = seq(tbs, sigAlg, bits(signature));

  const pem = (label, der) =>
    `-----BEGIN ${label}-----\n${der.toString('base64').replace(/(.{64})/g, '$1\n').trim()}\n-----END ${label}-----\n`;

  return {
    keyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    certPem: pem('CERTIFICATE', cert),
    certDer: cert,
    notAfter,
    ips,
    dnsNames
  };
}

/** Every IPv4 address this machine answers on, loopback included. */
export function localIPv4s() {
  const out = new Set(['127.0.0.1']);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' || i.family === 4) out.add(i.address);
  }
  return [...out];
}

// ---------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (invokedDirectly) {
  const [outDirArg, ...extras] = process.argv.slice(2);
  const here = path.dirname(new URL(import.meta.url).pathname);
  const outDir = outDirArg || path.join(here, '..', 'certs');
  const keyPath = path.join(outDir, 'lan-key.pem');
  const certPath = path.join(outDir, 'lan-cert.pem');
  const derPath = path.join(outDir, 'lan-cert.crt');

  if (fs.existsSync(keyPath)) {
    console.error(`[make-lan-cert] ${keyPath} already exists. A tablet that trusts the old certificate would stop trusting a new one; delete it deliberately if the PC's address has changed.`);
    process.exit(2);
  }

  const ips = [...new Set([...localIPv4s(), ...extras.filter((e) => /^\d+\.\d+\.\d+\.\d+$/.test(e))])];
  const dnsNames = [...new Set(['localhost', os.hostname().toLowerCase(), ...extras.filter((e) => !/^\d+\.\d+\.\d+\.\d+$/.test(e))])];

  const made = makeSelfSigned({ commonName: 'WRS Raipur workshop server', organization: 'Indian Railways WRS Raipur', ips, dnsNames });
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(keyPath, made.keyPem, { mode: 0o600 });
  fs.writeFileSync(certPath, made.certPem, { mode: 0o644 });
  fs.writeFileSync(derPath, made.certDer, { mode: 0o644 });

  console.log(`[make-lan-cert] wrote ${certPath}`);
  console.log(`[make-lan-cert]   for ${ips.join(', ')} and ${dnsNames.join(', ')}`);
  console.log(`[make-lan-cert]   valid until ${made.notAfter.toISOString().slice(0, 10)}`);
  console.log(`[make-lan-cert]   ${derPath} is the file to install on each tablet — see docs/TABLET_TRUST.md`);
}
