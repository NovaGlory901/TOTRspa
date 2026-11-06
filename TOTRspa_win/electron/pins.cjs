// Servers the person has chosen to trust by checking a code, like the first connection to an SSH
// server. A friend's TOTR server has its own certificate authority; the first time the app meets
// it, the app shows the authority's fingerprint, the person compares it with the one on that
// server's admin page (Updates > This server), and if they match the authority is remembered FOR
// THAT SERVER ONLY (config.json: "pins": { "https://host:8443": { "pem": "...", "fingerprint":
// "xxxx-..." } }). From then on a certificate for that server is accepted only if that authority
// signed it; a different one is refused with a warning, which is the protection against someone
// sitting in the middle. Pure functions (no disk, no network); main.cjs does the asking and the
// saving. The fingerprint is the same as the server's (TOTRsrv/tlsid.py).
const crypto = require('node:crypto');
const net = require('node:net');

const MAX_PEM = 16 * 1024,
  MAX_PINS = 30;
const PEM = /-----BEGIN CERTIFICATE-----([A-Za-z0-9+/=\s]+?)-----END CERTIFICATE-----/g;

// The one certificate in `text`, as { pem, cert, der }, or null. Refuses anything with a private
// key in it and anything with more or fewer than one certificate.
function parse(text) {
  const s = String(text || '').slice(0, MAX_PEM);
  if (s.includes('PRIVATE KEY')) return null;
  const found = [...s.matchAll(PEM)];
  if (found.length !== 1) return null;
  try {
    const der = Buffer.from(found[0][1].replace(/\s+/g, ''), 'base64');
    const cert = new crypto.X509Certificate(der);
    const b64 = der
      .toString('base64')
      .match(/.{1,64}/g)
      .join('\n');
    return { pem: `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`, cert, der };
  } catch {
    return null;
  }
}

// 24 hex digits of the SHA-256 of the certificate, in groups of four (96 bits: easy to compare by
// eye, not feasible to forge)
function fingerprint(pemText) {
  const p = parse(pemText);
  if (!p) return null;
  const h = crypto.createHash('sha256').update(p.der).digest('hex').slice(0, 24);
  return h.match(/.{4}/g).join('-');
}

// May this authority be remembered? It must be a certificate authority (not an ordinary server
// certificate), in date.
function usableAuthority(pemText, now = Date.now()) {
  const p = parse(pemText);
  if (!p || !p.cert.ca) return false;
  return Date.parse(p.cert.validFrom) <= now && now <= Date.parse(p.cert.validTo);
}

// true when `leafPem` (the server's certificate) is accepted for `host` by the pinned authority
// `pinPem`: signed by it, in date, for the very host
function acceptedByPin(pinPem, leafPem, host, now = Date.now()) {
  try {
    const ca = parse(pinPem),
      leaf = new crypto.X509Certificate(leafPem);
    if (!ca || !ca.cert.ca) return false;
    const inDates = c => Date.parse(c.validFrom) <= now && now <= Date.parse(c.validTo);
    const forHost = net.isIP(host) ? !!leaf.checkIP(host) : !!leaf.checkHost(host);
    return (
      inDates(ca.cert) &&
      inDates(leaf) &&
      leaf.checkIssued(ca.cert) &&
      leaf.verify(ca.cert.publicKey) &&
      forHost
    );
  } catch {
    return false;
  }
}

// the saved pins in a config object (pure: they give back a new config)
// Only entries whose fingerprint really is that of their certificate count: a hand-edited or
// damaged entry is ignored, never trusted.
function pinsOf(config) {
  const out = {},
    raw = (config && typeof config.pins === 'object' && config.pins) || {};
  for (const [origin, pin] of Object.entries(raw)) {
    if (Object.keys(out).length >= MAX_PINS || !pin || typeof pin.pem !== 'string') continue;
    let u;
    try {
      u = new URL(origin);
    } catch {
      continue;
    }
    if (u.protocol !== 'https:' || u.origin !== origin) continue;
    const fp = fingerprint(pin.pem);
    if (fp && fp === pin.fingerprint) out[origin] = { pem: parse(pin.pem).pem, fingerprint: fp };
  }
  return out;
}

// the authorities pinned for a host name (any port), as PEM texts
const pemsForHost = (config, host) =>
  Object.entries(pinsOf(config))
    .filter(([origin]) => new URL(origin).hostname === host)
    .map(([, p]) => p.pem);

function add(config, origin, pemText) {
  if (!usableAuthority(pemText))
    return { error: 'That is not a certificate authority that is in date.' };
  const fp = fingerprint(pemText),
    pins = pinsOf(config);
  if (!pins[origin] && Object.keys(pins).length >= MAX_PINS)
    return { error: 'Too many trusted servers. Remove one first.' };
  return {
    config: {
      ...config,
      pins: { ...pins, [origin]: { pem: parse(pemText).pem, fingerprint: fp } },
    },
  };
}

function remove(config, origin) {
  const pins = { ...pinsOf(config) };
  delete pins[origin];
  return { ...config, pins };
}

module.exports = {
  parse,
  fingerprint,
  usableAuthority,
  acceptedByPin,
  pinsOf,
  pemsForHost,
  add,
  remove,
};
