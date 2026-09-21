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
 *   lan-ca-key.pem  The shop's own certificate authority: its private key.
 *   lan-ca.pem      The CA certificate (self-signed, CA:TRUE, ten years).
 *   lan-cert.crt    The SAME CA certificate in DER — the one file a tablet,
 *                   phone or laptop installs, ONCE. See docs/TABLET_TRUST.md.
 *   lan-key.pem     The server's private key. Stays on the PC.
 *   lan-cert.pem    The server's certificate, signed by the CA, naming every
 *                   IPv4 address this machine has right now (plus localhost,
 *                   its hostname and anything extra on the command line),
 *                   followed by the CA certificate, as the chain the server
 *                   presents.
 *
 * WHY TWO
 * -------
 * The first version was one self-signed certificate naming the PC's
 * addresses. Every time the address changed — a new DHCP lease, a phone
 * hotspot, a rehearsal on a different Wi-Fi — the certificate had to be made
 * again AND installed again on every tablet, and until it was, the browser
 * warned and kept the camera shut. That happened three times in one week of
 * rehearsal. With a CA the devices trust one thing that never changes, and
 * the server's certificate is reissued for whatever addresses it has: this
 * script does that on every start, and only rewrites the server certificate
 * when the addresses actually differ. The CA key is never overwritten.
 *
 * The server certificate is valid for 825 days — the longest Apple and
 * Chrome accept — and carries the serverAuth purpose Apple requires.
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
  subjectKeyId: '2.5.29.14',
  authorityKeyId: '2.5.29.35',
  extKeyUsage: '2.5.29.37',
  serverAuth: '1.3.6.1.5.5.7.3.1'
};

const pem = (label, der) =>
  `-----BEGIN ${label}-----\n${der.toString('base64').replace(/(.{64})/g, '$1\n').trim()}\n-----END ${label}-----\n`;
const derFromPem = (text) => Buffer.from(text.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64');
const nameOf = (organization, commonName) => seq(
  set(seq(oid(OID.organization), utf8(organization))),
  set(seq(oid(OID.commonName), utf8(commonName)))
);

// ---------------------------------------------------------------------------
// The certificate
// ---------------------------------------------------------------------------

export function makeSelfSigned({ commonName, organization, ips, dnsNames, days = 825 }) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const spki = publicKey.export({ type: 'spki', format: 'der' });

  const name = nameOf(organization, commonName);
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

  // No SAN at all when there are no names (the CA): an empty SAN is malformed,
  // and macOS refused the CA with "unknown critical cert extension".
  const extensions = ctx(3, seq(
    seq(oid(OID.basicConstraints), bool(true), octets(seq(bool(true)))),
    seq(oid(OID.keyUsage), bool(true), octets(keyUsage)),
    ...(ips.length + dnsNames.length ? [seq(oid(OID.subjectAltName), octets(san))] : []),
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

  return {
    keyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    certPem: pem('CERTIFICATE', cert),
    certDer: cert,
    notAfter,
    ips,
    dnsNames
  };
}

/**
 * The server's certificate, signed by the CA. CA:FALSE, digitalSignature +
 * keyEncipherment, serverAuth, the addresses in the SAN, 825 days.
 */
export function makeLeaf({ caKeyPem, caCertDer, commonName, organization, ips, dnsNames, days = 825 }) {
  const caKey = crypto.createPrivateKey(caKeyPem);
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const caSpki = new crypto.X509Certificate(caCertDer).publicKey.export({ type: 'spki', format: 'der' });
  const issuer = derIssuerName(caCertDer);

  const notBefore = new Date(Date.now() - 60_000);
  const notAfter = new Date(notBefore.getTime() + days * 86400_000);
  const san = seq(
    ...dnsNames.map((d) => tlv(0x82, Buffer.from(d, 'ascii'))),
    ...ips.map((ip) => tlv(0x87, Buffer.from(ip.split('.').map(Number))))
  );
  // digitalSignature (bit 0) + keyEncipherment (bit 2): 10100000 = 0xa0, 5 unused bits.
  const keyUsage = bits(Buffer.from([0xa0]), 5);
  const extensions = ctx(3, seq(
    seq(oid(OID.basicConstraints), bool(true), octets(seq())),
    seq(oid(OID.keyUsage), bool(true), octets(keyUsage)),
    seq(oid(OID.extKeyUsage), octets(seq(oid(OID.serverAuth)))),
    seq(oid(OID.subjectAltName), octets(san)),
    seq(oid(OID.subjectKeyId), octets(octets(crypto.createHash('sha1').update(spki).digest()))),
    seq(oid(OID.authorityKeyId), octets(seq(tlv(0x80, crypto.createHash('sha1').update(caSpki).digest()))))
  ));
  const sigAlg = seq(oid(OID.sha256WithRSA), nul());
  const tbs = seq(
    ctx(0, integer(Buffer.from([2]))),
    integer(crypto.randomBytes(16)),
    sigAlg,
    issuer,
    seq(utcTime(notBefore), utcTime(notAfter)),
    nameOf(organization, commonName),
    spki,
    extensions
  );
  const cert = seq(tbs, sigAlg, bits(crypto.sign('sha256', tbs, caKey)));
  return {
    keyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    certPem: pem('CERTIFICATE', cert) + pem('CERTIFICATE', caCertDer),   // the chain the server presents
    certDer: cert,
    notAfter, ips, dnsNames
  };
}

/** The CA certificate's subject, byte for byte, to be the leaf's issuer. */
function derIssuerName(caCertDer) {
  // Certificate ::= SEQUENCE { tbsCertificate SEQUENCE { [0] version, serial, sigAlg, issuer, validity, subject, ... } }
  const readTlv = (buf, at) => {
    let i = at + 1; let l = buf[i++];
    if (l & 0x80) { const n = l & 0x7f; l = 0; for (let k = 0; k < n; k++) l = (l << 8) | buf[i++]; }
    return { start: at, headerEnd: i, end: i + l };
  };
  const outer = readTlv(caCertDer, 0);
  const tbs = readTlv(caCertDer, outer.headerEnd);
  let at = tbs.headerEnd;
  const fields = [];
  while (at < tbs.end && fields.length < 6) { const f = readTlv(caCertDer, at); fields.push(f); at = f.end; }
  // fields: [0]version, serial, sigAlg, issuer, validity, subject — subject is the CA's own name.
  const subject = fields[5];
  return caCertDer.subarray(subject.start, subject.end);
}

/** The addresses an existing server certificate names. */
export function namesInCert(certPem) {
  try {
    const x = new crypto.X509Certificate(derFromPem(certPem.split('-----END CERTIFICATE-----')[0] + '-----END CERTIFICATE-----'));
    const san = String(x.subjectAltName || '');
    return {
      ips: [...san.matchAll(/IP Address:([\d.]+)/g)].map((m) => m[1]),
      dnsNames: [...san.matchAll(/DNS:([^,\s]+)/g)].map((m) => m[1]),
      notAfter: new Date(x.validTo),
      issuerIsSelf: x.issuer === x.subject
    };
  } catch { return null; }
}

/**
 * Make or refresh the certificates in outDir. The CA is made once and never
 * rewritten; the server certificate is reissued when it is missing, was the
 * old self-signed kind, or does not name every address this machine has.
 * Returns what happened, for the caller to print.
 */
export function ensureCerts(outDir, extras = []) {
  const caKeyPath = path.join(outDir, 'lan-ca-key.pem');
  const caCertPath = path.join(outDir, 'lan-ca.pem');
  const installPath = path.join(outDir, 'lan-cert.crt');
  const keyPath = path.join(outDir, 'lan-key.pem');
  const certPath = path.join(outDir, 'lan-cert.pem');
  fs.mkdirSync(outDir, { recursive: true });

  const result = { caMade: false, leafMade: false, ips: [], dnsNames: [], notAfter: null, files: { caKeyPath, caCertPath, installPath, keyPath, certPath } };

  if (!fs.existsSync(caKeyPath) || !fs.existsSync(caCertPath)) {
    const ca = makeSelfSigned({ commonName: 'WRS Raipur workshop CA', organization: 'Indian Railways WRS Raipur', ips: [], dnsNames: [], days: 3650 });
    fs.writeFileSync(caKeyPath, ca.keyPem, { mode: 0o600 });
    fs.writeFileSync(caCertPath, ca.certPem, { mode: 0o644 });
    fs.writeFileSync(installPath, ca.certDer, { mode: 0o644 });
    result.caMade = true;
  } else if (!fs.existsSync(installPath) || !fs.readFileSync(caCertPath, 'utf8').includes(fs.readFileSync(installPath).toString('base64').slice(0, 40))) {
    // The install file must always be the CA — an old self-signed lan-cert.crt would be the wrong thing to hand out.
    fs.writeFileSync(installPath, derFromPem(fs.readFileSync(caCertPath, 'utf8')), { mode: 0o644 });
  }

  const ips = [...new Set([...localIPv4s(), ...extras.filter((e) => /^\d+\.\d+\.\d+\.\d+$/.test(e))])];
  const dnsNames = [...new Set(['localhost', os.hostname().toLowerCase(), ...extras.filter((e) => !/^\d+\.\d+\.\d+\.\d+$/.test(e))])];
  result.ips = ips; result.dnsNames = dnsNames;

  const existing = fs.existsSync(certPath) && fs.existsSync(keyPath) ? namesInCert(fs.readFileSync(certPath, 'utf8')) : null;
  const covers = existing && !existing.issuerIsSelf && ips.every((ip) => existing.ips.includes(ip)) && dnsNames.every((d) => existing.dnsNames.includes(d)) && existing.notAfter > new Date(Date.now() + 30 * 86400_000);
  if (!covers) {
    const leaf = makeLeaf({
      caKeyPem: fs.readFileSync(caKeyPath, 'utf8'), caCertDer: derFromPem(fs.readFileSync(caCertPath, 'utf8')),
      commonName: 'WRS Raipur workshop server', organization: 'Indian Railways WRS Raipur', ips, dnsNames
    });
    fs.writeFileSync(keyPath, leaf.keyPem, { mode: 0o600 });
    fs.writeFileSync(certPath, leaf.certPem, { mode: 0o644 });
    result.leafMade = true; result.notAfter = leaf.notAfter;
  } else {
    result.notAfter = existing.notAfter;
  }
  return result;
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
  const r = ensureCerts(outDir, extras);
  if (r.caMade) console.log(`[make-lan-cert] made the workshop CA: ${r.files.caCertPath}`);
  if (r.leafMade) console.log(`[make-lan-cert] issued the server certificate for ${r.ips.join(', ')} and ${r.dnsNames.join(', ')} — valid until ${r.notAfter.toISOString().slice(0, 10)}`);
  else console.log(`[make-lan-cert] the server certificate already names ${r.ips.join(', ')} — kept`);
  console.log(`[make-lan-cert] ${r.files.installPath} is the ONE file to install on each tablet, phone and laptop — see docs/TABLET_TRUST.md${r.caMade ? ' (new CA: install it on every device, even ones that trusted the old certificate)' : ''}`);
}
