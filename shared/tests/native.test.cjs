// Starting the bundled native programs (electron/native.cjs). Run: node tests/native.test.cjs
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const N = require('../electron/native.cjs');
let bad = 0,
  pending = Promise.resolve();
const check = (name, fn) => {
  pending = pending.then(async () => {
    try {
      await fn();
      console.log('ok  ' + name);
    } catch (e) {
      bad++;
      console.log('BAD ' + name + '   <- ' + e.message);
    }
  });
};

// a fake installer folder and a fake home
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'totr-native-test-'));
const base = path.join(tmp, 'native'),
  home = path.join(tmp, 'home');
const put = (rel, text = 'x', mode) => {
  const f = path.join(base, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
  if (mode) fs.chmodSync(f, mode);
};
const ampBin = 'dejavuamp/' + N.binaryFor(N.PROGRAMS.amp),
  fhBin = 'falsehorizons/' + N.binaryFor(N.PROGRAMS.fh); // the file names of THIS platform
const isWin = process.platform === 'win32';
put(ampBin, '#!/bin/sh', 0o755);
put('dejavuamp/music/README.txt', 'songs');
put('dejavuamp/eq-presets/README.txt', 'eq');
put(fhBin, '#!/bin/sh', 0o755);
put('falsehorizons/presets/slow-tide.fh-preset.json', '{"a":1}');
put('falsehorizons/presets/night-bus.fh-preset.json', '{"b":2}');
put('falsehorizons/backgrounds/README.txt', 'bg');
put('falsehorizons/presets/../evil name/..x', 'no');
fs.mkdirSync(path.join(base, 'falsehorizons/presets/subfolder'), { recursive: true });
put('falsehorizons/presets/subfolder/deep.json', 'no');

// a stand-in for a running program
class Child extends EventEmitter {
  constructor() {
    super();
    this.exitCode = null;
    this.killed = false;
  }
  kill() {
    this.killed = true;
    this.emit('exit', null, 'SIGTERM');
  }
}
const spawnWith = (log, behave) => (cmd, args, opts) => {
  const c = new Child();
  log.push({ cmd, args, opts });
  if (behave) setImmediate(() => behave(c));
  return c;
};
const ctx = (extra = {}) => ({ base, homeDir: home, running: new Map(), graceMs: 30, ...extra });

check('only the two fixed names are known, and odd values are not', () => {
  assert.ok(N.known('amp') && N.known('fh'));
  for (const bad of [
    '',
    'AMP',
    'dejavuamp',
    '../amp',
    '__proto__',
    'constructor',
    'toString',
    null,
    undefined,
    5,
    {},
    ['amp'],
  ])
    assert.ok(!N.known(bad), String(bad));
});
check(
  "only the app's own page counts: not another site, the offline page, a frame url, or nonsense",
  () => {
    const o = 'https://10.0.0.60:8443';
    assert.ok(N.fromApp(o + '/app/', o) && N.fromApp(o + '/app/#/you', o));
    for (const u of [
      'https://evil.example/app/',
      'http://10.0.0.60:8443/app/',
      'https://10.0.0.60:8444/',
      'file:///x/offline.html',
      'javascript:alert(1)',
      '',
      undefined,
      'not a url',
      'https://10.0.0.60:8443.evil.example/',
    ])
      assert.ok(!N.fromApp(u, o), String(u));
  },
);
check('available lists the programs that are really in this install', () => {
  assert.deepStrictEqual(N.available(base).sort(), ['amp', 'fh']);
  assert.deepStrictEqual(N.available(path.join(tmp, 'nothing')), []);
  if (!isWin) {
    // (Windows has no executable permission: present means available)
    fs.chmodSync(path.join(base, ampBin), 0o644);
    assert.deepStrictEqual(N.available(base), ['fh']); // present but not executable: not available
    fs.chmodSync(path.join(base, ampBin), 0o755);
  }
});
check(
  'launch starts the fixed program with only --folder <home>/<Name>, no shell, and says ok after the grace time',
  async () => {
    const log = [],
      c = ctx({ spawn: spawnWith(log) });
    const r = await N.launch('amp', c);
    assert.deepStrictEqual(r, {});
    assert.strictEqual(log.length, 1);
    assert.strictEqual(log[0].cmd, path.join(base, ampBin));
    assert.deepStrictEqual(log[0].args, ['--folder', path.join(home, 'DejaVuAmp')]);
    assert.strictEqual(log[0].opts.shell, false);
    assert.ok(c.running.has('amp'));
  },
);
check("the visible folders are made, and the program's README and presets are copied in", () => {
  for (const d of ['DejaVuAmp/music', 'DejaVuAmp/themes', 'DejaVuAmp/eq-presets'])
    assert.ok(fs.statSync(path.join(home, d)).isDirectory(), d);
  assert.strictEqual(
    fs.readFileSync(path.join(home, 'DejaVuAmp/music/README.txt'), 'utf8'),
    'songs',
  );
});
check('a second click while it is open does not start a second copy', async () => {
  const log = [],
    c = ctx({ spawn: spawnWith(log) });
  await N.launch('amp', c);
  const r = await N.launch('amp', c);
  assert.ok(r.error && /already open/.test(r.error));
  assert.strictEqual(log.length, 1);
  c.running.get('amp').emit('exit', 0, null);
  c.running.get('amp') && c.running.delete('amp');
  assert.deepStrictEqual(await N.launch('amp', c), {}); // after it closed it can be opened again
  assert.strictEqual(log.length, 2);
});
check(
  "first run copies built-in presets and never overwrites or removes the person's files",
  async () => {
    const dir = path.join(home, 'FalseHorizons/presets');
    const c = ctx({ spawn: spawnWith([]) });
    await N.launch('fh', c);
    assert.deepStrictEqual(fs.readdirSync(dir).sort(), [
      'night-bus.fh-preset.json',
      'slow-tide.fh-preset.json',
    ]);
    fs.writeFileSync(path.join(dir, 'slow-tide.fh-preset.json'), 'MY EDIT');
    fs.writeFileSync(path.join(dir, 'mine.fh-preset.json'), 'mine');
    fs.rmSync(path.join(dir, 'night-bus.fh-preset.json'));
    c.running.clear();
    await N.launch('fh', c);
    assert.strictEqual(
      fs.readFileSync(path.join(dir, 'slow-tide.fh-preset.json'), 'utf8'),
      'MY EDIT',
    ); // the edit is kept
    // their own file is kept
    assert.strictEqual(fs.readFileSync(path.join(dir, 'mine.fh-preset.json'), 'utf8'), 'mine');
    assert.strictEqual(
      fs.readFileSync(path.join(dir, 'night-bus.fh-preset.json'), 'utf8'),
      '{"b":2}',
    ); // a missing built-in comes back
  },
);
check('only plain files are copied: no sub-folders, no odd names, no escaping the folder', () => {
  const dir = path.join(home, 'FalseHorizons/presets');
  assert.ok(
    !fs.existsSync(path.join(dir, 'subfolder')) && !fs.existsSync(path.join(dir, 'deep.json')),
  );
  assert.ok(!fs.existsSync(path.join(home, 'FalseHorizons/evil name')));
});
check('a program that stops straight away with an error is reported, with a reason', async () => {
  const r = await N.launch(
    'fh',
    ctx({
      spawn: spawnWith([], c => {
        c.exitCode = 127;
        c.emit('exit', 127, null);
      }),
    }),
  );
  assert.ok(
    r.error && /stopped right away/.test(r.error) && /127/.test(r.error),
    JSON.stringify(r),
  );
});
check('a program that cannot be run at all is reported', async () => {
  const r = await N.launch(
    'fh',
    ctx({ spawn: spawnWith([], c => c.emit('error', new Error('spawn EACCES'))) }),
  );
  assert.ok(
    r.error &&
      /did not start/.test(r.error) &&
      !/EACCES/.test(r.error) &&
      /not be allowed to run/.test(r.error),
    JSON.stringify(r),
  );
  assert.ok(
    (
      await N.launch(
        'fh',
        ctx({
          spawn: () => {
            throw new Error('boom');
          },
        }),
      )
    ).error,
  );
});
check(
  'unknown names, and an install without the program, are refused without starting anything',
  async () => {
    const log = [];
    for (const n of ['rm', '../x', '__proto__', undefined])
      assert.ok((await N.launch(n, ctx({ spawn: spawnWith(log) }))).error);
    assert.ok(
      (await N.launch('amp', ctx({ base: path.join(tmp, 'nothing'), spawn: spawnWith(log) })))
        .error,
    );
    assert.strictEqual(log.length, 0);
  },
);
check('closeAll closes every open program', async () => {
  const c = ctx({ spawn: spawnWith([]) });
  await N.launch('amp', c);
  await N.launch('fh', c);
  const kids = [...c.running.values()];
  N.closeAll(c.running);
  assert.ok(kids.length === 2 && kids.every(k => k.killed) && c.running.size === 0);
});
check(
  'on Windows the programs are the .exe files (FalseHorizons.exe, DejaVuAmp.exe), and being present is enough',
  async () => {
    const winBase = path.join(tmp, 'winnative');
    for (const f of ['dejavuamp/DejaVuAmp.exe', 'falsehorizons/FalseHorizons.exe']) {
      fs.mkdirSync(path.dirname(path.join(winBase, f)), { recursive: true });
      fs.writeFileSync(path.join(winBase, f), 'MZ', { mode: 0o644 });
    }
    assert.deepStrictEqual(N.available(winBase, fs, 'win32').sort(), ['amp', 'fh']);
    assert.deepStrictEqual(N.available(winBase, fs, 'linux'), []); // the Linux names are not there
    const log = [];
    const r = await N.launch('fh', {
      base: winBase,
      homeDir: path.join(tmp, 'winhome'),
      running: new Map(),
      graceMs: 30,
      platform: 'win32',
      spawn: spawnWith(log),
    });
    assert.deepStrictEqual(r, {});
    assert.strictEqual(log[0].cmd, path.join(winBase, 'falsehorizons', 'FalseHorizons.exe'));
    assert.deepStrictEqual(log[0].args, ['--folder', path.join(tmp, 'winhome', 'FalseHorizons')]);
  },
);
pending.then(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(bad ? `\nFAILED (${bad} failing)` : '\nALL PASSED');
  process.exit(bad ? 1 : 0);
});
