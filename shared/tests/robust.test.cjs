// The desktop shell with a damaged, missing, unreadable or unwritable settings file, a missing
// settings folder, a full disk: each case must start, say something a person can act on (no paths,
// no error codes) and never throw or lose the old file silently. Run: node tests/robust.test.cjs
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
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

delete process.env.TOTR_SERVER;
delete process.env.ELECTRON_DEV_URL;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'totr-robust-'));
process.env.APPIMAGE = path.join(tmp, 'TOTR.AppImage');
process.resourcesPath = tmp;
const realFs = { writeFileSync: fs.writeFileSync, mkdirSync: fs.mkdirSync };
const realLoad = Module._load;
const FROM_OFFLINE = userData => {
  const url = require('node:url').pathToFileURL(
    path.join(__dirname, '..', 'electron', 'offline.html'),
  ).href;
  const main = { url };
  return { senderFrame: main, sender: { mainFrame: main } };
};

// Starts the real main.cjs fresh against its own settings folder. Returns what it did.
function start(userData, files, switches = []) {
  const log = { loadFile: [], loadURL: [], relaunch: 0, feed: 0, setPath: [] },
    handlers = new Map();
  let readyCb = null;
  if (files !== undefined) {
    fs.mkdirSync(userData, { recursive: true });
    for (const [n, c] of Object.entries(files)) fs.writeFileSync(path.join(userData, n), c);
  }
  const electron = {
    app: {
      requestSingleInstanceLock: () => true,
      on() {},
      quit() {},
      getVersion: () => '9.9.9',
      isPackaged: true,
      releaseSingleInstanceLock() {},
      relaunch() {
        log.relaunch++;
      },
      exit() {},
      getPath: () => userData,
      setPath: (n, p) => {
        log.setPath.push([n, p]);
      },
      commandLine: { hasSwitch: s => switches.includes(s) },
      whenReady: () => ({
        then: cb => {
          readyCb = cb;
        },
      }),
    },
    ipcMain: { on() {}, handle: (n, f) => handlers.set(n, f), removeAllListeners() {} },
    BrowserWindow: class {
      constructor() {
        this.webContents = {
          on() {},
          setWindowOpenHandler() {},
          send() {},
          isDestroyed: () => false,
          mainFrame: { url: '' },
        };
      }
      loadURL(u) {
        log.loadURL.push(u);
        return Promise.resolve();
      }
      loadFile(f, o) {
        log.loadFile.push(o);
        return Promise.resolve();
      }
      isMinimized() {
        return false;
      }
      isDestroyed() {
        return false;
      }
      restore() {}
      show() {}
      focus() {}
    },
    Menu: { buildFromTemplate: x => x, setApplicationMenu() {} },
    shell: { openExternal() {} },
    dialog: {},
    session: {
      defaultSession: {
        setCertificateVerifyProc() {},
        setPermissionRequestHandler() {},
        setPermissionCheckHandler() {},
        setDevicePermissionHandler() {},
      },
      fromPartition: () => ({ setCertificateVerifyProc() {} }),
    },
  };
  Module._load = function (request, ...rest) {
    return request === 'electron'
      ? electron
      : request === 'electron-updater'
        ? {
            autoUpdater: {
              setFeedURL() {
                log.feed++;
              },
              on() {},
              checkForUpdates: () => Promise.resolve(),
            },
          }
        : realLoad.call(this, request, ...rest);
  };
  for (const k of Object.keys(require.cache))
    if (k.includes(path.join('shared', 'electron'))) delete require.cache[k];
  global.setInterval = () => ({ unref() {} });
  require('../electron/main.cjs');
  readyCb();
  return {
    log,
    call: (name, ...args) => handlers.get(name)(FROM_OFFLINE(userData), ...args),
    userData,
  };
}
const fresh = n => path.join(tmp, 'ud' + n);
const noPaths = s => !/[\\/]|ENOSPC|EACCES|EROFS|EPERM|ENOENT/.test(s);
const full = () => {
  const e = new Error(
    "ENOSPC: no space left on device, open '/home/someone/.config/TOTR/config.json'",
  );
  e.code = 'ENOSPC';
  throw e;
};
const denied = () => {
  const e = new Error("EACCES: permission denied, open '/home/someone/.config/TOTR/config.json'");
  e.code = 'EACCES';
  throw e;
};

let n = 0;
const BROKEN = {
  'an empty file': '',
  'not JSON': 'not json {',
  'a list': '[]',
  'a number': '5',
  'a string': '"hello"',
};
const ODD = {
  'a server that is a number': '{"server": 5}',
  'a server that is not a web address': '{"server": "javascript:alert(1)"}',
  'servers that are not a list and pins that are a list': '{"servers": "x", "pins": [1, 2]}',
  'pins that are garbage':
    '{"pins": {"https://a.example": {"pem": 7, "fingerprint": null}, "nope": 1}}',
};
for (const [what, text] of Object.entries(BROKEN))
  check(
    `a settings file that is ${what}: the app starts, asks for a server, says the settings were not readable, and keeps the old file when it saves`,
    async () => {
      const s = start(fresh(++n), { 'config.json': text });
      assert.deepStrictEqual(s.log.loadFile, [{ query: { first: '1', problem: 'config' } }]);
      assert.deepStrictEqual(s.log.loadURL, []);
      const list = await s.call('servers-list');
      assert.deepStrictEqual(list.list, []);
      const r = await s.call('servers-add', 'Home', 'http://192.0.2.1:8080');
      assert.deepStrictEqual(r, {});
      assert.strictEqual(
        fs.readFileSync(path.join(s.userData, 'config.json.broken'), 'utf8'),
        text,
      );
      assert.strictEqual(
        JSON.parse(fs.readFileSync(path.join(s.userData, 'config.json'), 'utf8')).servers[0].origin,
        'http://192.0.2.1:8080',
      );
    },
  );
for (const [what, text] of Object.entries(ODD))
  check(
    `a settings file with ${what}: the app starts at the "choose a server" page and nothing throws`,
    async () => {
      const s = start(fresh(++n), { 'config.json': text });
      assert.deepStrictEqual(s.log.loadFile, [{ query: { first: '1' } }]);
      await s.call('servers-list');
      assert.ok((await s.call('servers-add', 'x', 'http://192.0.2.2:8080')).error === undefined);
    },
  );
check(
  'no settings file and no settings folder at all: first run, and the first save makes the folder',
  async () => {
    const dir = path.join(fresh(++n), 'deeper', 'still');
    const s = start(dir);
    assert.deepStrictEqual(s.log.loadFile, [{ query: { first: '1' } }]);
    assert.deepStrictEqual(await s.call('servers-add', '', 'http://192.0.2.3:8080'), {});
    assert.ok(fs.existsSync(path.join(dir, 'config.json')));
    assert.ok(!fs.existsSync(path.join(dir, 'config.json.broken')));
  },
);
check(
  'a settings file that cannot be read (no permission): same as damaged, no crash',
  async () => {
    if (process.getuid && process.getuid() === 0) return; // root reads everything
    if (process.platform === 'win32') {
      console.log(
        'skip  a file cannot be made unreadable with chmod on Windows (not tested there)',
      );
      return;
    }
    const dir = fresh(++n);
    const s0 = start(dir, { 'config.json': '{"server":"http://192.0.2.4:8080"}' });
    fs.chmodSync(path.join(dir, 'config.json'), 0);
    try {
      const s = start(dir);
      assert.deepStrictEqual(s.log.loadFile, [{ query: { first: '1', problem: 'config' } }]);
    } finally {
      fs.chmodSync(path.join(dir, 'config.json'), 0o600);
    }
  },
);
for (const [what, boom] of [
  ['the disk is full', full],
  ['the folder is read-only', denied],
])
  check(
    `${what}: add, use and remove each return a plain sentence, change nothing and do not restart`,
    async () => {
      const s = start(fresh(++n), {
        'config.json': JSON.stringify({
          server: 'http://192.0.2.5:8080',
          servers: [
            { name: 'A', origin: 'http://192.0.2.5:8080' },
            { name: 'B', origin: 'http://192.0.2.6:8080' },
          ],
        }),
      });
      const before = fs.readFileSync(path.join(s.userData, 'config.json'), 'utf8');
      fs.writeFileSync = boom;
      try {
        for (const [name, args] of [
          ['servers-add', ['C', 'http://192.0.2.7:8080']],
          ['servers-use', ['http://192.0.2.6:8080']],
          ['servers-remove', ['http://192.0.2.6:8080']],
        ]) {
          const r = await s.call(name, ...args);
          assert.ok(
            r && typeof r.error === 'string' && r.error.length > 30 && noPaths(r.error),
            name + ': ' + JSON.stringify(r),
          );
        }
      } finally {
        fs.writeFileSync = realFs.writeFileSync;
      }
      assert.strictEqual(fs.readFileSync(path.join(s.userData, 'config.json'), 'utf8'), before);
      assert.strictEqual(s.log.relaunch, 0);
    },
  );
check('the settings folder cannot be made: a plain sentence, not a thrown error', async () => {
  const s = start(fresh(++n));
  fs.mkdirSync = denied;
  try {
    const r = await s.call('servers-add', 'x', 'http://192.0.2.8:8080');
    assert.ok(r.error && noPaths(r.error), JSON.stringify(r));
  } finally {
    fs.mkdirSync = realFs.mkdirSync;
  }
});
check(
  'a junk address typed on the first-run page gets a sentence and changes nothing',
  async () => {
    const s = start(fresh(++n));
    for (const junk of [
      '',
      '   ',
      'ftp://x',
      'http://',
      'javascript:alert(1)',
      'https://',
      '://',
      'a b c',
      '\0',
    ]) {
      const r = await s.call('servers-use', junk);
      assert.ok(
        r.error &&
          r.error.length > 10 &&
          !/[A-Z]{4,}/.test(r.error.replace(/\b(TOTR|HTTPS?)\b/g, '')),
        JSON.stringify(junk) + ' -> ' + JSON.stringify(r),
      );
    }
    assert.strictEqual(s.log.relaunch, 0);
  },
);
check(
  'plainError: the usual operating system and network errors become sentences without paths or codes',
  () => {
    const { plainError } = require('../electron/plainerror.cjs');
    for (const e of [
      { code: 'ENOSPC' },
      { code: 'EACCES' },
      { code: 'EROFS' },
      { code: 'ENOENT' },
      { code: 'ECONNREFUSED' },
      new Error('net::ERR_CONNECTION_REFUSED'),
      new Error("weird 'C:\\x\\y'"),
      null,
      undefined,
      'text',
    ]) {
      const m = plainError(e);
      assert.ok(m.length > 20 && noPaths(m) && !/net::/.test(m), m);
    }
  },
);
check(
  'a copy started with --user-data-dir keeps the folder it was given: the shell does not move it to <appData>/totr-spa',
  async () => {
    const dir = fresh(++n);
    const s = start(dir, {}, ['user-data-dir']);
    assert.deepStrictEqual(s.log.setPath, []);
  },
);
check(
  'a copy started without it uses <appData>/totr-spa, the folder 0.6.2 and earlier used',
  async () => {
    const dir = fresh(++n);
    const s = start(dir, {});
    // the stand-in answers every getPath with the folder under test
    assert.deepStrictEqual(s.log.setPath, [['userData', path.join(dir, 'totr-spa')]]);
  },
);
pending.then(() => {
  Module._load = realLoad;
  console.log(bad ? `\n${bad} FAILED` : '\nALL PASSED');
  process.exit(bad ? 1 : 0);
});
