// A self-signed certificate for the headset's https front door, made with
// nothing but node:crypto — no openssl on the PATH, no extra package.
//
// Node can make keys and sign bytes but has no "make a certificate" call, so
// the certificate itself is written out by hand below: an X.509 v3 cert is a
// small tree of DER (tag, length, value) records, and a self-signed one is that
// tree signed with its own key.
//
// Made once and kept in dev-cert/ (gitignored). Made again only when it is
// close to expiring or when this PC has an address the old one doesn't name —
// each new certificate means one more "proceed anyway" on the headset.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// ── DER, just the pieces a certificate needs ─────────────────────────
const len = n => {
  if (n < 0x80) return Buffer.from([n]);
  const b = [];
  while (n) { b.unshift(n & 0xff); n = Math.floor(n / 256); }
  return Buffer.from([0x80 | b.length, ...b]);
};
const tlv = (tag, ...parts) => { const body = Buffer.concat(parts); return Buffer.concat([Buffer.from([tag]), len(body.length), body]); };
const seq = (...p) => tlv(0x30, ...p);
const set = (...p) => tlv(0x31, ...p);
const explicit = (n, ...p) => tlv(0xa0 + n, ...p);
const NULL = Buffer.from([0x05, 0x00]);
const bool = v => tlv(0x01, Buffer.from([v ? 0xff : 0x00]));
const utf8 = s => tlv(0x0c, Buffer.from(s, 'utf8'));
const octets = b => tlv(0x04, b);
const bits = b => tlv(0x03, Buffer.from([0]), b);          // no unused bits
function int(b) {                                            // a positive INTEGER from raw bytes
  while (b.length > 1 && b[0] === 0 && !(b[1] & 0x80)) b = b.subarray(1);
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
  return tlv(0x02, b);
}
function oid(s) {
  const p = s.split('.').map(Number);
  const out = [40 * p[0] + p[1]];
  p.slice(2).forEach(n => {
    const enc = [n & 0x7f];
    while ((n = Math.floor(n / 128))) enc.unshift(0x80 | (n & 0x7f));
    out.push(...enc);
  });
  return tlv(0x06, Buffer.from(out));
}
function time(d) {                                           // UTCTime until 2050, as X.509 asks
  const s = d.toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z';
  return d.getUTCFullYear() < 2050 ? tlv(0x17, Buffer.from(s.slice(2))) : tlv(0x18, Buffer.from(s));
}
function ipBytes(ip) {
  if (ip.includes(':')) {                                    // IPv6, '::' expanded
    const [head, tail = ''] = ip.split('::');
    const h = head ? head.split(':') : [], t = tail ? tail.split(':') : [];
    const all = ip.includes('::') ? [...h, ...Array(8 - h.length - t.length).fill('0'), ...t] : h;
    return Buffer.from(all.flatMap(g => { const v = parseInt(g || '0', 16); return [v >> 8, v & 0xff]; }));
  }
  return Buffer.from(ip.split('.').map(Number));
}

const SHA256_RSA = seq(oid('1.2.840.113549.1.1.11'), NULL);

function makeCert({ names, ips, days }) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const serial = crypto.randomBytes(16); serial[0] &= 0x7f;
  const name = seq(
    set(seq(oid('2.5.4.3'),  utf8('Resonote on this PC'))),   // CN — what the warning page shows
    set(seq(oid('2.5.4.10'), utf8('Resonote dev server'))),   // O
  );
  const notBefore = new Date(Date.now() - 24 * 3600e3);       // a day of slack for a headset clock that runs behind
  const notAfter  = new Date(Date.now() + days * 24 * 3600e3);
  const ext = (id, critical, value) => seq(oid(id), ...(critical ? [bool(true)] : []), octets(value));
  const san = seq(
    ...names.map(n => tlv(0x82, Buffer.from(n, 'ascii'))),    // dNSName
    ...ips.map(ip => tlv(0x87, ipBytes(ip))),                 // iPAddress
  );
  const tbs = seq(
    explicit(0, int(Buffer.from([2]))),                        // v3
    int(serial),
    SHA256_RSA,
    name,                                                      // issuer = subject: self-signed
    seq(time(notBefore), time(notAfter)),
    name,
    spki,
    explicit(3, seq(
      ext('2.5.29.19', true, seq()),                           // basicConstraints: not a CA
      ext('2.5.29.15', true, tlv(0x03, Buffer.from([0x05, 0xa0]))),   // keyUsage: digitalSignature, keyEncipherment
      ext('2.5.29.37', false, seq(oid('1.3.6.1.5.5.7.3.1'))),  // extKeyUsage: serverAuth
      ext('2.5.29.17', false, san),                            // subjectAltName
    )),
  );
  const sig = crypto.sign('sha256', tbs, privateKey);
  const der = seq(tbs, SHA256_RSA, bits(sig));
  const pem = '-----BEGIN CERTIFICATE-----\n' + der.toString('base64').match(/.{1,64}/g).join('\n') + '\n-----END CERTIFICATE-----\n';
  return { cert: pem, key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
}

// The cached certificate if it still covers `ips`, else a fresh one.
// Returns { key, cert, fresh }.
export function devCert(dir, ips, { days = 365 } = {}) {
  const keyFile = path.join(dir, 'key.pem'), certFile = path.join(dir, 'cert.pem');
  let known = [];                                            // addresses the old one named (a laptop on two networks keeps both)
  try {
    const key = fs.readFileSync(keyFile, 'utf8'), cert = fs.readFileSync(certFile, 'utf8');
    const x = new crypto.X509Certificate(cert);
    const named = String(x.subjectAltName || '');
    known = [...named.matchAll(/IP Address:(\d+\.\d+\.\d+\.\d+)/g)].map(m => m[1]);
    const coversAll = ips.every(ip => known.includes(ip));
    const longEnough = new Date(x.validTo).getTime() - Date.now() > 14 * 24 * 3600e3;
    if (coversAll && longEnough && x.checkPrivateKey(crypto.createPrivateKey(key))) return { key, cert, fresh: false };
  } catch (e) { /* none yet, or unreadable — make one */ }
  const made = makeCert({ names: ['localhost'], ips: [...new Set(['127.0.0.1', '::1', ...known, ...ips])], days });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(keyFile, made.key, { mode: 0o600 });
  fs.writeFileSync(certFile, made.cert);
  return { ...made, fresh: true };
}
