// The check on app updates (electron/appsig.cjs): signature, the yml it covers, and the downloaded
// file. Includes a signature made by the developer's real tool (TOTRsrv/tools/release_tool.py sign-
// file), so the two sides cannot drift apart. Run: node tests/appsig.test.cjs
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const A = require('../electron/appsig.cjs');
let bad = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log('ok  ' + name);
  } catch (e) {
    bad++;
    console.log('BAD ' + name + '   <- ' + e.message);
  }
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'totr-appsig-'));

const keys = crypto.generateKeyPairSync('ed25519'),
  pub = keys.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
const sign = (bytes, k = keys, prefix = A.PREFIX) =>
  crypto.sign(null, Buffer.concat([prefix, bytes]), k.privateKey).toString('base64');
const sha = crypto.createHash('sha512').update('installer').digest('base64');
const yml = Buffer.from(
  `version: 1.2.3\nfiles:\n  - url: TOTR-1.2.3-win.exe\n    sha512: ${sha}\n    size: 9\npath: TOTR-1.2.3-win.exe\nsha512: ${sha}\nreleaseDate: '2026-10-11T00:00:00.000Z'\n`,
);

check('a key line is read; comments and blanks are skipped; junk is not a key', () => {
  assert.deepStrictEqual(A.parsePubkey('# c\n\ned25519 ' + pub.toString('base64') + ' me\n'), pub);
  for (const t of [
    '',
    '# only a comment',
    'rsa abc',
    'ed25519 AAAA',
    'ed25519 ' + Buffer.alloc(31).toString('base64'),
  ])
    assert.strictEqual(A.parsePubkey(t), null, t);
});
check("the developer's signature on the exact bytes passes", () =>
  assert.ok(A.verify(yml, sign(yml), pub)),
);
check('one changed byte, another key, no key, or a bad signature all fail', () => {
  const other = crypto.generateKeyPairSync('ed25519'),
    s = sign(yml);
  assert.ok(!A.verify(Buffer.concat([yml, Buffer.from(' ')]), s, pub));
  assert.ok(!A.verify(yml, sign(yml, other), pub));
  assert.ok(
    !A.verify(yml, s, other.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)),
  );
  for (const bogus of [null, '', 'AAAA', s.slice(1), s + 'A', 'x'.repeat(88)])
    assert.ok(!A.verify(yml, bogus, pub), String(bogus));
  assert.ok(!A.verify(yml, s, null) && !A.verify(yml, s, Buffer.alloc(31)));
  assert.ok(!A.verify(Buffer.alloc(0), s, pub) && !A.verify(Buffer.alloc(70000), s, pub));
});
check('a signature made without the app prefix (a server release signature, say) is refused', () =>
  assert.ok(!A.verify(yml, sign(yml, keys, Buffer.alloc(0)), pub)),
);
check('the yml is read: version and the installer checksum', () =>
  assert.deepStrictEqual(A.parseYml(yml), {
    version: '1.2.3',
    files: [{ url: 'TOTR-1.2.3-win.exe', sha512: sha }],
  }),
);
check('a yml with no version, no checksum or a bad checksum is refused', () => {
  for (const t of [
    'files:\n  - url: a\n    sha512: ' + sha,
    'version: 1.2.3\n',
    'version: 1.2.3\nfiles:\n  - url: a\n    sha512: short\n',
    'version: latest\nfiles:\n  - url: a\n    sha512: ' + sha,
  ])
    assert.strictEqual(A.parseYml(Buffer.from(t)), null, t);
});
check('only a strictly newer version counts', () => {
  assert.ok(A.newer('1.2.4', '1.2.3') && A.newer('2.0.0', '1.9.9') && A.newer('1.10.0', '1.9.0'));
  assert.ok(!A.newer('1.2.3', '1.2.3') && !A.newer('1.2.2', '1.2.3'));
});
check('the finished download must hash to a signed checksum', () => {
  const good = path.join(tmp, 'g'),
    badf = path.join(tmp, 'b');
  fs.writeFileSync(good, 'installer');
  fs.writeFileSync(badf, 'installer!');
  const signed = A.parseYml(yml);
  assert.ok(A.downloadMatches(signed, good));
  assert.ok(!A.downloadMatches(signed, badf));
  assert.ok(!A.downloadMatches(signed, path.join(tmp, 'missing')));
  assert.ok(!A.downloadMatches(signed, undefined));
});
check("a signature from the developer's own tool (release_tool.py sign-file) passes", () => {
  const svr = path.join(__dirname, '..', '..', '..', 'TOTRsrv');
  // only inside the full repository
  if (!fs.existsSync(path.join(svr, 'tools', 'release_tool.py'))) return;
  const env = { ...process.env, TOTR_SIGNING_PASSPHRASE: 'a long test passphrase' },
    dir = path.join(tmp, 'k');
  const kg = spawnSync(
    'python3',
    [path.join(svr, 'tools', 'release_tool.py'), 'keygen', '--out', dir],
    { env, encoding: 'utf8' },
  );
  if (kg.status !== 0) throw new Error('keygen: ' + kg.stderr);
  const line = (kg.stdout.match(/ed25519 [A-Za-z0-9+/=]+/) || [])[0];
  assert.ok(line, kg.stdout);
  const f = path.join(tmp, 'latest.yml');
  fs.writeFileSync(f, yml);
  execFileSync(
    'python3',
    [
      path.join(svr, 'tools', 'release_tool.py'),
      'sign-file',
      '--key',
      path.join(dir, 'signing.key'),
      f,
    ],
    { env, stdio: 'pipe' },
  );
  assert.ok(A.verify(yml, fs.readFileSync(f + '.sig', 'utf8'), A.parsePubkey(line)));
  assert.ok(
    !A.verify(
      Buffer.concat([yml, Buffer.from('\n')]),
      fs.readFileSync(f + '.sig', 'utf8'),
      A.parsePubkey(line),
    ),
  );
});
console.log(bad ? `\n${bad} FAILED` : '\nALL PASSED');
process.exit(bad ? 1 : 0);
