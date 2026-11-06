// Tests for electron/trust.cjs: the Windows / Linux app trusts TOTR's own certificate authority,
// and only that, only for the right private address. Makes a throwaway authority with
// TOTRsrv/tools/make_certs.py (needs python3 and openssl). Run: npm test
const fs = require('fs'),
  os = require('os'),
  path = require('path'),
  crypto = require('crypto'),
  { execFileSync, spawnSync } = require('child_process');
const trust = require('../electron/trust.cjs');
// a machine may have OPENSSL_CONF pointing at a file that is not there (a leftover of another
// program's installer): openssl then fails, so ignore it for this test
if (process.env.OPENSSL_CONF && !fs.existsSync(process.env.OPENSSL_CONF))
  delete process.env.OPENSSL_CONF;
// the first Python that really runs (on Windows `python3` is often only the Microsoft Store stub,
// which fails)
const python =
  ['python3', 'python', 'py'].find(c => {
    try {
      return spawnSync(c, ['--version'], { stdio: 'ignore' }).status === 0;
    } catch {
      return false;
    }
  }) || 'python3';
const tool = path.join(__dirname, '..', '..', '..', 'TOTRsrv', 'tools', 'make_certs.py');
if (!fs.existsSync(tool)) {
  console.log('skip trust tests: they need the TOTRsrv project in a folder next to this one');
  process.exit(0);
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'totr-trust-'));
const env = {
  ...process.env,
  TOTR_CERTS_DIR: dir,
  TOTR_CA_PASSPHRASE: 'throwaway passphrase for tests',
};
let bad = 0;
const ok = (name, cond) => {
  console.log((cond ? 'ok  ' : 'BAD ') + name);
  bad += !cond;
};
try {
  if (spawnSync('openssl', ['version']).status !== 0) {
    console.log('skip  openssl is not installed');
    process.exit(0);
  }
  execFileSync(python, [tool, 'ca'], { env, stdio: 'ignore' });
  execFileSync(python, [tool, 'server', '--ip', '10.0.0.60', '--name', 'box.local'], {
    env,
    stdio: 'ignore',
  });
  const ca = new crypto.X509Certificate(fs.readFileSync(path.join(dir, 'totr-ca.pem')));
  const pem = fs.readFileSync(path.join(dir, 'server.pem'), 'utf8');
  const day = 864e5;
  ok('accepted for its own IP', trust.acceptedByTotrCa(ca, pem, '10.0.0.60'));
  ok('accepted for its own name', trust.acceptedByTotrCa(ca, pem, 'box.local'));
  ok('refused for another IP', !trust.acceptedByTotrCa(ca, pem, '10.0.0.99'));
  ok('refused for another name', !trust.acceptedByTotrCa(ca, pem, 'other.local'));
  ok(
    'refused after it expires',
    !trust.acceptedByTotrCa(ca, pem, '10.0.0.60', Date.now() + 5 * 365 * day),
  );
  ok(
    'refused before it starts',
    !trust.acceptedByTotrCa(ca, pem, '10.0.0.60', Date.now() - 2 * day),
  );
  const other = path.join(dir, 'imposter');
  fs.mkdirSync(other);
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'ec',
      '-pkeyopt',
      'ec_paramgen_curve:P-256',
      '-nodes',
      '-keyout',
      path.join(other, 'k.pem'),
      '-out',
      path.join(other, 'c.pem'),
      '-days',
      '30',
      '-subj',
      '/CN=imposter',
      '-addext',
      'subjectAltName=IP:10.0.0.60',
    ],
    { stdio: 'ignore' },
  );
  ok(
    'refused when signed by someone else, even for the same address',
    !trust.acceptedByTotrCa(ca, fs.readFileSync(path.join(other, 'c.pem'), 'utf8'), '10.0.0.60'),
  );
  ok('refused: not a certificate', !trust.acceptedByTotrCa(ca, 'not a certificate', '10.0.0.60'));
  for (const [host, want] of [
    ['10.1.2.3', true],
    ['192.168.1.9', true],
    ['172.16.0.1', true],
    ['172.31.255.1', true],
    ['172.32.0.1', false],
    ['8.8.8.8', false],
    ['192.169.0.1', false],
    ['box.local', true],
    ['x.lan', true],
    ['example.com', false],
    ['local.example.com', false],
  ])
    ok(
      `private address check: ${host} is ${want ? '' : 'not '}private`,
      trust.privateName(host) === want,
    );
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log(bad ? 'FAILED' : 'ALL PASSED');
process.exit(bad ? 1 : 0);
