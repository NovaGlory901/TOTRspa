// Trusting a server by its fingerprint (electron/pins.cjs, electron/probe.cjs, and the pin path of
// electron/trust.cjs). Real certificates made with openssl, a real
// local https server for the network part. Run: node tests/pins.test.cjs (needs openssl and
// python3)
const fs = require('fs'),
  os = require('os'),
  path = require('path'),
  https = require('https'),
  crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');
if (process.env.OPENSSL_CONF && !fs.existsSync(process.env.OPENSSL_CONF))
  delete process.env.OPENSSL_CONF;
if (spawnSync('openssl', ['version']).status !== 0) {
  console.log('skip  openssl is not installed');
  process.exit(0);
}
const pins = require('../electron/pins.cjs'),
  probe = require('../electron/probe.cjs'),
  trust = require('../electron/trust.cjs');
const python =
  ['python3', 'python', 'py'].find(c => {
    try {
      return spawnSync(c, ['--version'], { stdio: 'ignore' }).status === 0;
    } catch {
      return false;
    }
  }) || 'python3';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'totr-pins-'));
let bad = 0,
  pending = Promise.resolve();
const ok = (name, cond, extra) => {
  console.log((cond ? 'ok  ' : 'BAD ') + name + (!cond && extra ? '   <- ' + extra : ''));
  bad += !cond;
};
const check = (name, fn) => {
  pending = pending.then(async () => {
    try {
      ok(name, (await fn()) !== false);
    } catch (e) {
      ok(name, false, e.message);
    }
  });
};
const sh = (...a) => execFileSync('openssl', a, { stdio: 'pipe' });
const file = n => path.join(dir, n),
  read = n => fs.readFileSync(file(n), 'utf8');

// an authority, and a server certificate it signed for 127.0.0.1 (and localhost); the same again
// for an imposter
function makeAuthority(name, days = 30) {
  sh(
    'req',
    '-x509',
    '-newkey',
    'ec',
    '-pkeyopt',
    'ec_paramgen_curve:P-256',
    '-nodes',
    '-keyout',
    file(name + '-ca.key'),
    '-out',
    file(name + '-ca.pem'),
    '-days',
    String(days),
    '-subj',
    `/CN=${name} TOTR CA`,
    '-addext',
    'basicConstraints=critical,CA:TRUE',
    '-addext',
    'keyUsage=critical,keyCertSign,cRLSign',
  );
}
function makeLeaf(name, ca, host = '127.0.0.1', days = 30) {
  sh(
    'req',
    '-newkey',
    'ec',
    '-pkeyopt',
    'ec_paramgen_curve:P-256',
    '-nodes',
    '-keyout',
    file(name + '.key'),
    '-out',
    file(name + '.csr'),
    '-subj',
    '/CN=server',
  );
  fs.writeFileSync(
    file(name + '.ext'),
    `subjectAltName=IP:${host},DNS:localhost\nbasicConstraints=CA:FALSE\n`,
  );
  sh(
    'x509',
    '-req',
    '-in',
    file(name + '.csr'),
    '-CA',
    file(ca + '-ca.pem'),
    '-CAkey',
    file(ca + '-ca.key'),
    '-CAcreateserial',
    '-out',
    file(name + '.pem'),
    '-days',
    String(days),
    '-extfile',
    file(name + '.ext'),
  );
}
makeAuthority('friend');
makeLeaf('friend-server', 'friend');
makeAuthority('imposter');
makeLeaf('imposter-server', 'imposter');
const CA = read('friend-ca.pem'),
  LEAF = read('friend-server.pem'),
  IMP_LEAF = read('imposter-server.pem'),
  IMP_CA = read('imposter-ca.pem'),
  KEY = read('friend-ca.key');
const day = 864e5;

const fp = pins.fingerprint(CA);
ok(
  'a certificate has a fingerprint of six groups of four hex digits',
  /^([0-9a-f]{4}-){5}[0-9a-f]{4}$/.test(fp || ''),
  fp,
);
const sha = sh('x509', '-in', file('friend-ca.pem'), '-noout', '-fingerprint', '-sha256')
  .toString()
  .split('=')[1]
  .trim()
  .replace(/:/g, '')
  .toLowerCase();
ok(
  'it is the start of the SHA-256 that openssl computes',
  (fp || '').replace(/-/g, '') === sha.slice(0, 24),
  `${fp} vs ${sha.slice(0, 24)}`,
);
const py = spawnSync(
  python,
  [
    '-c',
    'import sys; sys.path.insert(0, sys.argv[1]); import tlsid; print(tlsid.fingerprint(open(sys.argv[2], "rb").read()))',
    path.join(__dirname, '..', '..', '..', 'TOTRsrv'),
    file('friend-ca.pem'),
  ],
  { encoding: 'utf8' },
);
ok(
  'and it is exactly the code the server shows (TOTRsrv/tlsid.py)',
  py.status === 0 && py.stdout.trim() === fp,
  py.stderr || py.stdout,
);
ok(
  'a key is never accepted as a certificate, even beside one',
  pins.parse(KEY) === null && pins.parse(CA + KEY) === null && pins.fingerprint(KEY) === null,
);
ok(
  'two certificates, none, or junk are refused',
  pins.parse(CA + LEAF) === null &&
    pins.parse('') === null &&
    pins.parse('hello') === null &&
    pins.parse(null) === null,
);
ok(
  'a damaged certificate is refused',
  pins.parse('-----BEGIN CERTIFICATE-----\n!!!!\n-----END CERTIFICATE-----') === null &&
    pins.parse(CA.slice(0, 120) + '\n-----END CERTIFICATE-----') === null,
);
ok(
  'the text is normalised, so the same certificate always gives the same code',
  pins.fingerprint(CA.replace(/\n/g, '\r\n')) === fp && pins.fingerprint('  ' + CA + '  ') === fp,
);
ok('an imposter has a different code', pins.fingerprint(IMP_CA) !== fp);

ok('an authority in date can be pinned', pins.usableAuthority(CA));
ok(
  'an ordinary server certificate cannot (it would let a stolen server key vouch for the host forever)',
  !pins.usableAuthority(LEAF),
);
ok(
  'an authority that has run out cannot',
  !pins.usableAuthority(CA, Date.now() + 40 * day) &&
    !pins.usableAuthority(CA, Date.now() - 2 * day),
);

// accepting a certificate for a host
ok(
  'a certificate its pinned authority signed is accepted for its own address',
  pins.acceptedByPin(CA, LEAF, '127.0.0.1'),
);
ok('and for its own name', pins.acceptedByPin(CA, LEAF, 'localhost'));
ok(
  'not for another address or name',
  !pins.acceptedByPin(CA, LEAF, '127.0.0.2') && !pins.acceptedByPin(CA, LEAF, 'other.example'),
);
ok(
  'not when someone else signed it, even for the same address (the man in the middle)',
  !pins.acceptedByPin(CA, IMP_LEAF, '127.0.0.1'),
);
ok(
  'not after it runs out, and not before it starts',
  !pins.acceptedByPin(CA, LEAF, '127.0.0.1', Date.now() + 40 * day) &&
    !pins.acceptedByPin(CA, LEAF, '127.0.0.1', Date.now() - 2 * day),
);
makeLeaf('short-server', 'friend', '127.0.0.1', 2);
ok(
  'not once the server certificate has run out, even while its authority is still good',
  pins.acceptedByPin(CA, read('short-server.pem'), '127.0.0.1') &&
    !pins.acceptedByPin(CA, read('short-server.pem'), '127.0.0.1', Date.now() + 3 * day),
);
ok(
  'not when what was pinned is an ordinary certificate',
  !pins.acceptedByPin(LEAF, LEAF, '127.0.0.1'),
);
ok(
  'not for junk',
  !pins.acceptedByPin(CA, 'junk', '127.0.0.1') &&
    !pins.acceptedByPin('junk', LEAF, '127.0.0.1') &&
    !pins.acceptedByPin(CA, LEAF, ''),
);

const O = 'https://127.0.0.1:9443';
let r = pins.add({ server: O }, O, CA);
ok(
  'adding keeps the rest of the config and stores the authority with its code',
  r.config &&
    r.config.server === O &&
    r.config.pins[O].fingerprint === fp &&
    r.config.pins[O].pem.includes('BEGIN CERTIFICATE'),
);
ok(
  'adding something that is not an in-date authority is refused',
  !!pins.add({}, O, LEAF).error && !!pins.add({}, O, 'junk').error && !!pins.add({}, O, KEY).error,
);
const withPin = r.config;
ok(
  'pemsForHost finds the authority for the host, whatever the port',
  pins.pemsForHost(withPin, '127.0.0.1').length === 1 &&
    pins.pemsForHost(withPin, '10.9.9.9').length === 0,
);
ok(
  'a hand-edited fingerprint is not believed',
  Object.keys(
    pins.pinsOf({ pins: { [O]: { pem: CA, fingerprint: '0000-0000-0000-0000-0000-0000' } } }),
  ).length === 0,
);
ok(
  'a pin swapped for another certificate under the same code is not believed',
  Object.keys(pins.pinsOf({ pins: { [O]: { pem: IMP_CA, fingerprint: fp } } })).length === 0,
);
ok(
  'only exact https origins count (no path, no http, no junk)',
  Object.keys(
    pins.pinsOf({
      pins: {
        'http://a:1': { pem: CA, fingerprint: fp },
        'https://a:1/x': { pem: CA, fingerprint: fp },
        nope: { pem: CA, fingerprint: fp },
        'https://a:1': { pem: CA, fingerprint: fp },
      },
    }),
  ).join() === 'https://a:1',
);
ok(
  'removing drops the pin and nothing else',
  (() => {
    const c = pins.remove({ server: O, pins: withPin.pins }, O);
    return !c.pins[O] && c.server === O;
  })(),
);
ok(
  'configs without pins are fine',
  Object.keys(pins.pinsOf({})).length === 0 &&
    Object.keys(pins.pinsOf(null)).length === 0 &&
    pins.remove({}, O).pins !== undefined,
);
ok(
  'the pin list is capped',
  (() => {
    let c = {};
    for (let i = 0; i < 40; i++) {
      const x = pins.add(c, `https://h${i}.example:1`, CA);
      if (x.config) c = x.config;
    }
    return Object.keys(pins.pinsOf(c)).length === 30;
  })(),
);

// the certificate check inside Electron's session (the pin path of trust.cjs)
function verifier(pinsFor) {
  let proc = null;
  const refused = [];
  trust.install(
    {
      setCertificateVerifyProc: p => {
        proc = p;
      },
    },
    { pinsFor, onRefused: (h, had) => refused.push([h, had]) },
  );
  return {
    refused,
    run: (cert, host, res = 'net::ERR_CERT_AUTHORITY_INVALID') => {
      let out;
      proc({ verificationResult: res, certificate: { data: cert }, hostname: host }, v => {
        out = v;
      });
      return out;
    },
  };
}
let v = verifier(h => pins.pemsForHost(withPin, h));
ok("a pinned server's certificate is accepted", v.run(LEAF, '127.0.0.1') === 0);
ok(
  'a certificate for a pinned host from another authority is refused, and reported as a changed certificate',
  v.run(IMP_LEAF, '127.0.0.1') === -2 && JSON.stringify(v.refused) === '[["127.0.0.1",true]]',
);
ok(
  'a host with no pin is refused as before, and not reported as changed',
  v.run(LEAF, 'localhost') === -2 && JSON.stringify(v.refused[1]) === '["localhost",false]',
);
ok(
  'whatever the system already trusts still passes',
  v.run(IMP_LEAF, '127.0.0.1', 'net::OK') === 0,
);
ok('without any pin nothing new is trusted', verifier(() => []).run(LEAF, '127.0.0.1') === -2);

// the network part, against a real https server
const serve = handler =>
  new Promise(res => {
    const s = https.createServer(
      {
        key: fs.readFileSync(file('friend-server.key')),
        cert: fs.readFileSync(file('friend-server.pem')),
      },
      handler,
    );
    s.listen(0, '127.0.0.1', () => res(s));
  });
const originOf = s => `https://127.0.0.1:${s.address().port}`;
check('check: a server with an unknown authority is "untrusted"', async () => {
  const s = await serve((q, a) => a.end('ok'));
  try {
    return (await probe.check(originOf(s))) === 'untrusted';
  } finally {
    s.close();
  }
});
check('check: the same server is "ok" once its authority is given', async () => {
  const s = await serve((q, a) => a.end('ok'));
  try {
    return (await probe.check(originOf(s), [CA])) === 'ok';
  } finally {
    s.close();
  }
});
check('check: another authority does not make it ok', async () => {
  const s = await serve((q, a) => a.end('ok'));
  try {
    return (await probe.check(originOf(s), [IMP_CA])) === 'untrusted';
  } finally {
    s.close();
  }
});
check(
  'check: nothing listening is "unreachable", not "untrusted"',
  async () => (await probe.check('https://127.0.0.1:1')) === 'unreachable',
);
check(
  'fetchCa: gets the authority the server offers, with the code the person is asked to compare',
  async () => {
    const s = await serve((q, a) => {
      if (q.url === '/.well-known/totr-ca.pem') {
        a.setHeader('content-type', 'application/x-pem-file');
        a.end(CA);
      } else {
        a.statusCode = 404;
        a.end();
      }
    });
    try {
      const got = await probe.fetchCa(originOf(s));
      return got.fingerprint === fp && got.pem.includes('BEGIN CERTIFICATE');
    } finally {
      s.close();
    }
  },
);
check('fetchCa: a server that offers nothing gives an error, not a certificate', async () => {
  const s = await serve((q, a) => {
    a.statusCode = 404;
    a.end();
  });
  try {
    const got = await probe.fetchCa(originOf(s));
    return !!got.error && !got.pem;
  } finally {
    s.close();
  }
});
check(
  'fetchCa: a key, two certificates, junk or an ordinary server certificate are all refused',
  async () => {
    for (const body of [KEY, CA + LEAF, 'hello', LEAF]) {
      const s = await serve((q, a) => a.end(body));
      try {
        const got = await probe.fetchCa(originOf(s));
        if (!got.error || got.pem) return false;
      } finally {
        s.close();
      }
    }
  },
);
check('fetchCa: an enormous answer is cut off, not read', async () => {
  const s = await serve((q, a) => {
    a.write('x'.repeat(10 * 1024 * 1024));
    a.end();
  });
  try {
    const got = await probe.fetchCa(originOf(s));
    return !!got.error;
  } finally {
    s.close();
  }
});
check('fetchCa: a server that never answers is given up on', async () => {
  const s = await serve(() => {
    /* never answers */
  });
  const t0 = Date.now();
  try {
    const got = await probe.fetchCa(originOf(s));
    return !!got.error && Date.now() - t0 < 15000;
  } finally {
    s.close();
    s.closeAllConnections && s.closeAllConnections();
  }
});
check(
  'the pinned authority then accepts the very certificate that server showed (the loop closes)',
  async () => {
    const s = await serve((q, a) => {
      a.end(CA);
    });
    try {
      const got = await probe.fetchCa(originOf(s));
      return pins.acceptedByPin(got.pem, LEAF, '127.0.0.1');
    } finally {
      s.close();
    }
  },
);

pending.then(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(bad ? `\nFAILED (${bad} failing)` : '\nALL PASSED');
  process.exit(bad ? 1 : 0);
});
