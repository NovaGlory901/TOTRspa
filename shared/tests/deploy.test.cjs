// deploy.cjs app: sending the built web app to the server's static/app. The server is faked: a
// small `ssh` on the PATH runs the remote command on this computer, inside a temporary folder, so
// the real commands and the real tar stream are exercised and nothing leaves the machine. Run: node
// tests/deploy.test.cjs
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// The fake server is a POSIX shell script and the link test needs symlinks, so this suite is for Linux and macOS.
if (process.platform === 'win32') {
  console.log('skip  deploy.cjs app tests (they fake the server with a POSIX shell)');
  process.exit(0);
}

const tool = path.join(__dirname, '..', 'tools', 'deploy.cjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'totr-deploy-'));
let bad = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log('ok  ' + name);
  } catch (e) {
    bad++;
    console.log('BAD ' + name + '   <- ' + String(e.message).split('\n')[0]);
  }
};

function fakeSsh(name, body) {
  const bin = path.join(tmp, 'bin-' + name);
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'ssh'), `#!/bin/sh\nshift\n${body}\n`, { mode: 0o755 });
  return bin;
}
const works = fakeSsh('works', 'exec sh -c "$1"');
const drops = fakeSsh('drops', 'exec sh -c "$1" </dev/null'); // the data never arrives
// the swap fails
const fails = fakeSsh('fails', 'case "$1" in *mv*) exit 1;; esac\nexec sh -c "$1"');

function write(dir, files) {
  for (const [n, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, n)), { recursive: true });
    fs.writeFileSync(path.join(dir, n), c);
  }
}
function read(dir) {
  const out = {};
  (function walk(rel) {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) walk(r);
      else out[r] = fs.readFileSync(path.join(dir, r), 'utf8');
    }
  })('');
  return out;
}
function run(bin, { built, appDir, extra = {} }) {
  const env = {
    ...process.env,
    PATH: bin + path.delimiter + process.env.PATH,
    TOTR_SSH: 'tester@fake-host',
    TOTR_DOWNLOADS_DIR: path.join(tmp, 'srv', 'static', 'downloads'),
    TOTR_APP_DIR: appDir,
    TOTR_DEPLOY_CONFIG: path.join(tmp, 'no-such-config.json'),
    TOTR_APP_OUT: built,
    ...extra,
  };
  return spawnSync('node', [tool, 'app'], { env, encoding: 'utf8' });
}

const server = path.join(tmp, 'srv', 'static'),
  live = path.join(server, 'app');
const v1 = path.join(tmp, 'built1'),
  v2 = path.join(tmp, 'built2');
write(v1, {
  'index.html': '<html>one',
  'version.json': '{"buildId":"1"}',
  'assets/a-1.js': 'console.log(1)',
});
write(v2, {
  'index.html': '<html>two',
  'version.json': '{"buildId":"2"}',
  'assets/a-2.js': 'console.log(2)',
  'assets/deep/x.css': 'x{}',
});
delete process.env.TOTR_APP_OUT;

check('a built app is unpacked into static/app, file for file, with no staging folder left', () => {
  const r = run(works, { built: v1, appDir: live });
  assert.strictEqual(r.status, 0, r.stderr + r.stdout);
  assert.deepStrictEqual(read(live), read(v1));
  assert.ok(!fs.existsSync(live + '.new'), 'staging folder left behind');
});
check('the next deploy replaces it and keeps the one before as app.old', () => {
  const r = run(works, { built: v2, appDir: live });
  assert.strictEqual(r.status, 0, r.stderr + r.stdout);
  assert.deepStrictEqual(read(live), read(v2));
  assert.deepStrictEqual(read(live + '.old'), read(v1));
});
check('a folder without index.html and version.json is refused before anything is sent', () => {
  const half = path.join(tmp, 'half');
  write(half, { 'index.html': 'x' });
  const r = run(works, { built: half, appDir: live });
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /build the app first/);
  assert.deepStrictEqual(read(live), read(v2));
});
check('no TOTR_APP_OUT: refused with a message', () => {
  const r = run(works, { built: '', appDir: live });
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /TOTR_APP_OUT is not set/);
  assert.deepStrictEqual(read(live), read(v2));
});
check('a link inside the folder is refused', () => {
  const linked = path.join(tmp, 'linked');
  write(linked, { 'index.html': 'x', 'version.json': '{}' });
  fs.symlinkSync('/etc/passwd', path.join(linked, 'leak.txt'));
  const r = run(works, { built: linked, appDir: live });
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /not a plain file/);
  assert.deepStrictEqual(read(live), read(v2));
});
check('a copy that does not arrive changes nothing and leaves no staging folder', () => {
  const r = run(drops, { built: v1, appDir: live });
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /does not match/);
  assert.deepStrictEqual(read(live), read(v2));
  assert.ok(!fs.existsSync(live + '.new'));
});
check('a swap that fails puts the old app back', () => {
  const r = run(fails, { built: v1, appDir: live });
  assert.notStrictEqual(r.status, 0);
  assert.deepStrictEqual(read(live), read(v2));
});
check('an unsafe server folder is refused', () => {
  const r = run(works, { built: v1, appDir: path.join(tmp, 'bad dir', 'app') });
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /server folder for the web app is unknown/);
});
check('without "appDir" the folder is the static/app next to downloads', () => {
  const r = run(works, { built: v1, appDir: '', extra: { TOTR_APP_DIR: '' } });
  assert.strictEqual(r.status, 0, r.stderr + r.stdout);
  assert.deepStrictEqual(read(live), read(v1));
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(bad ? `\n${bad} FAILED` : '\nALL PASSED');
process.exit(bad ? 1 : 0);
