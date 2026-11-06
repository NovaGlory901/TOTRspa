// The two questions the shell asks the network before saving an https server (the answers feed
// pins.cjs):
//  check(origin, extraCas) can this server's certificate be trusted already (by the usual
// authorities or TOTR's own)? -> 'ok' | 'untrusted' | 'unreachable'
//  fetchCa(origin) the authority it offers at /.well-known/totr-ca.pem, for the person to check by
// fingerprint -> { pem } | { error }
// fetchCa deliberately does not verify the connection: it cannot, that is the point. What it gets
// is shown to the person, who compares its fingerprint with the one on the server's own admin page;
// a man in the middle's authority would have a different code. Size and time are limited, and
// nothing is run or saved from the answer.
const https = require('node:https');
const tls = require('node:tls');
const pins = require('./pins.cjs');

const CERT_PROBLEMS = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'UNABLE_TO_GET_ISSUER_CERT',
  'CERT_UNTRUSTED',
]);
const TIMEOUT = 8000,
  MAX_BYTES = 16 * 1024;

function get(origin, path, options) {
  return new Promise(resolve => {
    let done = false;
    const finish = v => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    const u = new URL(origin);
    const req = https.get(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path,
        timeout: TIMEOUT,
        agent: false,
        headers: { Accept: '*/*' },
        ...options,
      },
      res => {
        const chunks = [];
        let size = 0;
        res.on('data', c => {
          size += c.length;
          if (size > MAX_BYTES) {
            req.destroy();
            finish({ error: 'too big' });
          } else chunks.push(c);
        });
        res.on('end', () =>
          finish({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }),
        );
        res.on('error', () => finish({ error: 'read' }));
      },
    );
    req.on('timeout', () => {
      req.destroy();
      finish({ error: 'timeout' });
    });
    req.on('error', e => finish({ error: e.code || 'error' }));
  });
}

async function check(origin, extraCas = []) {
  const r = await get(origin, '/health', {
    rejectUnauthorized: true,
    ca: [...tls.rootCertificates, ...extraCas],
  });
  if (!r.error) return 'ok';
  return CERT_PROBLEMS.has(r.error) ? 'untrusted' : 'unreachable';
}

async function fetchCa(origin) {
  const r = await get(origin, '/.well-known/totr-ca.pem', { rejectUnauthorized: false });
  if (r.error)
    return {
      error:
        r.error === 'timeout'
          ? 'The server did not answer in time.'
          : 'Could not reach the server.',
    };
  if (r.status !== 200)
    return { error: 'This server does not offer a certificate authority to trust.' };
  const p = pins.parse(r.body);
  if (!p) return { error: 'The server offered something that is not a single certificate.' };
  if (!pins.usableAuthority(p.pem))
    return { error: 'The certificate authority this server offers is not valid right now.' };
  return { pem: p.pem, fingerprint: pins.fingerprint(p.pem) };
}

module.exports = { check, fetchCa };
