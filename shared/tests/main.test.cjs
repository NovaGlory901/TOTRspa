// The real electron/main.cjs, loaded against a stand-in for Electron (no window opens): who is
// allowed to press each of the shell's buttons, and which pages the window may navigate to. Run:
// node tests/main.test.cjs
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { pathToFileURL } = require('node:url');
// a machine may have OPENSSL_CONF pointing at a file that is not there (a leftover of another
// program's installer): openssl then fails, so ignore it for this test
if (process.env.OPENSSL_CONF && !fs.existsSync(process.env.OPENSSL_CONF))
  delete process.env.OPENSSL_CONF;
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'totr-main-test-'));
const userData = path.join(tmp, 'userData'),
  home = path.join(tmp, 'home');
process.env.TOTR_SERVER = 'https://10.0.0.60:8443';
delete process.env.ELECTRON_DEV_URL;
// updates count as possible only in a packaged app that can replace itself
process.env.APPIMAGE = path.join(tmp, 'TOTR.AppImage');
process.resourcesPath = path.join(tmp, 'resources');
fs.mkdirSync(userData, { recursive: true });
// an install that already has a controls list: nobody has them yet
fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({ access: [] }));

const crypto = require('node:crypto');
const devKeys = crypto.generateKeyPairSync('ed25519');
const devPub = devKeys.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
const appsigReal = require('../electron/appsig.cjs');
const signYml = (bytes, keys = devKeys) =>
  crypto.sign(null, Buffer.concat([appsigReal.PREFIX, bytes]), keys.privateKey).toString('base64');
const goodSha = crypto.createHash('sha512').update('the installer').digest('base64');
const ymlFor = (version, sha = goodSha) =>
  Buffer.from(
    `version: ${version}\nfiles:\n  - url: TOTR-${version}-linux.AppImage\n    sha512: ${sha}\n    size: 13\npath: TOTR-${version}-linux.AppImage\nsha512: ${sha}\n`,
  );
const feedFiles = new Map(); // what the connected server serves under /static/downloads/
const feedFetch = async url => {
  const b = feedFiles.get(url.split('/').pop());
  return b ? { ok: true, status: 200, arrayBuffer: async () => b } : { ok: false, status: 404 };
};
const updaterEvents = new Map();
const handlers = new Map(),
  listeners = new Map(),
  wc = new Map();
const log = {
  setPath: [],
  access: [],
  dialogs: [],
  relaunch: 0,
  exit: 0,
  opened: [],
  loadURL: 0,
  check: 0,
  download: 0,
  sent: [],
};
let readyCb = null;
let dialogAnswer = 0,
  accessAnswer = 1; // 0 = Cancel, 1 = "The codes match: trust this server"
const net = {
  state: 'ok',
  offer: { error: 'This server does not offer a certificate authority to trust.' },
  asked: [],
}; // the stand-in network (electron/probe.cjs)
const mainFrame = { url: '' };
let windowOpen = null; // the handler the shell gave window.open
const permissionSession = {}; // the handlers the shell put on the default session
// the stand-in for a server that takes join requests (what the session's fetch reaches)
const joinNet = {
  calls: [],
  state: 'pending',
  open: true,
  fetch: async (url, init = {}) => {
    const u = new URL(url),
      method = init.method || 'GET';
    joinNet.calls.push(method + ' ' + u.pathname);
    const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
    if (u.pathname === '/api/join' && method === 'GET') return reply(200, { open: joinNet.open });
    if (u.pathname === '/api/join' && method === 'POST')
      return reply(200, { request_id: 'e'.repeat(32) });
    if (u.pathname === '/api/join/' + 'e'.repeat(32)) return reply(200, { status: joinNet.state });
    if (u.pathname.endsWith('/withdraw')) return reply(200, { ok: true });
    throw new Error('unreachable');
  },
};
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
    exit() {
      log.exit++;
    },
    getPath: n => (n === 'userData' ? userData : home),
    setPath: (n, p) => {
      log.setPath.push([n, p]);
    },
    commandLine: { hasSwitch: () => false },
    whenReady: () => ({
      then: cb => {
        readyCb = cb;
      },
    }),
  },
  ipcMain: {
    on: (n, f) => listeners.set(n, f),
    handle: (n, f) => handlers.set(n, f),
    removeAllListeners: n => listeners.delete(n),
  },
  BrowserWindow: class {
    constructor() {
      this.webContents = {
        on: (n, f) => wc.set(n, f),
        setWindowOpenHandler(f) {
          windowOpen = f;
        },
        send: (m, s) => log.sent.push([m, s]),
        isDestroyed: () => false,
        mainFrame,
      };
    }
    loadURL() {
      log.loadURL++;
      return Promise.resolve();
    }
    loadFile() {
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
  shell: { openExternal: u => log.opened.push(u) },
  dialog: {
    showMessageBox: async (_win, options) => {
      if (options.title.startsWith('Let this server')) {
        log.access.push(options);
        return { response: accessAnswer };
      }
      log.dialogs.push(options);
      return { response: dialogAnswer };
    },
  },
  session: {
    defaultSession: {
      setCertificateVerifyProc() {},
      fetch: (url, init) => joinNet.fetch(url, init),
      setPermissionRequestHandler(f) {
        permissionSession.request = f;
      },
      setPermissionCheckHandler(f) {
        permissionSession.check = f;
      },
      setDevicePermissionHandler(f) {
        permissionSession.device = f;
      },
    },
    fromPartition: () => ({ setCertificateVerifyProc() {}, fetch: feedFetch }),
  },
};
const updater = {
  autoUpdater: {
    setFeedURL() {},
    on: (n, f) => updaterEvents.set(n, f),
    checkForUpdates() {
      log.check++;
      return Promise.resolve();
    },
    downloadUpdate() {
      log.download++;
      return Promise.resolve();
    },
    quitAndInstall() {},
  },
};
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return electron;
  if (request === 'electron-updater') return updater;
  if (request === 'multicast-dns') return () => ({ on() {}, query() {}, destroy() {} });
  if (request === './appkey.cjs') return { pubkey: () => devPub };
  if (request === './probe.cjs')
    return {
      check: async o => {
        net.asked.push(['check', o]);
        return net.state;
      },
      fetchCa: async o => {
        net.asked.push(['fetchCa', o]);
        return net.offer;
      },
    };
  return realLoad.call(this, request, ...rest);
};
const realInterval = global.setInterval;
// the shell checks for updates every 30 minutes: not in a test
global.setInterval = () => ({ unref() {} });
require('../electron/main.cjs');
readyCb(); // the window is made (the stand-in one)
global.setInterval = realInterval;

const O = process.env.TOTR_SERVER;
const offlineUrl =
  pathToFileURL(path.join(__dirname, '..', 'electron', 'offline.html')).href + '?server=x';
const ev = (url, sub) => {
  const main = { url };
  return { senderFrame: sub ? { url } : main, sender: { mainFrame: main } };
};
const FROM = {
  app: ev(O + '/app/'),
  offline: ev(offlineUrl),
  evil: ev('https://evil.example/'),
  lookalike: ev(O + '.evil.example/app/'),
  subframe: ev(O + '/app/', true),
  none: { senderFrame: null, sender: {} },
};
const strangers = ['evil', 'lookalike', 'subframe', 'none'];
const denied = r => r && r.error === 'Not allowed from this page.';

check(
  'the settings folder is <appData>/totr-spa, the name 0.6.2 and earlier used, whatever the package is called now (an update must find its saved servers, pins and controls)',
  () => {
    assert.deepStrictEqual(log.setPath, [['userData', path.join(home, 'totr-spa')]]);
  },
);
check('shell-info answers to any page (it is only the version and platform)', () => {
  const e = {};
  listeners.get('shell-info')(e);
  assert.deepStrictEqual(e.returnValue, {
    version: '9.9.9',
    platform: process.platform === 'win32' ? 'win' : 'linux',
  });
});

check(
  'the saved servers: the app and the offline page may read the list; strangers get a refusal, not the list',
  async () => {
    for (const who of ['app', 'offline']) {
      const r = await handlers.get('servers-list')(FROM[who]);
      assert.strictEqual(r.current, O, who);
      assert.ok(Array.isArray(r.list));
    }
    for (const who of strangers)
      assert.ok(denied(await handlers.get('servers-list')(FROM[who])), who);
  },
);
check(
  'adding a server works from the app and is refused (nothing written) from strangers',
  async () => {
    for (const who of strangers)
      assert.ok(
        denied(await handlers.get('servers-add')(FROM[who], 'x', 'https://evil.example')),
        who,
      );
    assert.strictEqual(
      JSON.parse(fs.readFileSync(path.join(userData, 'config.json'), 'utf8')).servers,
      undefined,
      'a stranger wrote the config',
    );
    assert.deepStrictEqual(
      await handlers.get('servers-add')(FROM.app, 'Friend', 'https://friend.example:8443'),
      {},
    );
    assert.ok(
      fs.readFileSync(path.join(userData, 'config.json'), 'utf8').includes('friend.example'),
    );
  },
);
check('removing a server is refused from strangers', async () => {
  for (const who of strangers)
    assert.ok(
      denied(await handlers.get('servers-remove')(FROM[who], 'https://friend.example:8443')),
      who,
    );
  assert.ok(fs.readFileSync(path.join(userData, 'config.json'), 'utf8').includes('friend.example'));
});
check(
  'switching server (which restarts the app) is refused from strangers, and works from the app and the offline page',
  async () => {
    for (const who of strangers)
      assert.ok(denied(await handlers.get('servers-use')(FROM[who], 'https://evil.example')), who);
    assert.strictEqual(log.relaunch + log.exit, 0, 'a stranger restarted the app');
    assert.deepStrictEqual(
      await handlers.get('servers-use')(FROM.app, 'https://friend.example:8443'),
      {},
    );
    assert.deepStrictEqual(
      await handlers.get('servers-use')(FROM.offline, 'https://friend.example:8443'),
      {},
    );
    assert.strictEqual(log.relaunch, 2);
    assert.strictEqual(log.exit, 2);
  },
);
check(
  'opening the native programs is refused from strangers, and the offline page may not open them either',
  async () => {
    for (const who of [...strangers, 'offline']) {
      assert.ok(denied(await handlers.get('native-launch')(FROM[who], 'amp')), who);
      assert.deepStrictEqual(await handlers.get('native-available')(FROM[who]), [], who);
    }
  },
);
const settle = () => new Promise(r => setImmediate(r));
const lastState = () => log.sent[log.sent.length - 1][1];
const platformYml = process.platform === 'win32' ? 'latest.yml' : 'latest-linux.yml';
const serve = (version, sha, sign = true, keys) => {
  feedFiles.clear();
  const y = ymlFor(version, sha);
  feedFiles.set(platformYml, y);
  if (sign) feedFiles.set(platformYml + '.sig', Buffer.from(signYml(y, keys) + '\n'));
};
check('updates: only the app can ask for the check or the install', async () => {
  serve('99.0.0');
  for (const who of [...strangers, 'offline']) {
    listeners.get('update-check')(FROM[who]);
    listeners.get('update-install')(FROM[who]);
  }
  await settle();
  assert.strictEqual(log.check + log.download, 0, 'a stranger started an update');
  listeners.get('update-check')(FROM.app);
  await settle();
  listeners.get('update-install')(FROM.app);
  await settle();
  assert.strictEqual(log.check, 1);
  assert.strictEqual(log.download, 1);
});
check(
  'updates: an update file the developer did not sign is refused, and nothing is checked or downloaded',
  async () => {
    const before = log.check + log.download;
    for (const [what, setup] of [
      ['no signature file', () => serve('99.0.0', undefined, false)],
      [
        'signed by someone else',
        () => serve('99.0.0', undefined, true, crypto.generateKeyPairSync('ed25519')),
      ],
      [
        'file changed after signing',
        () => {
          serve('99.0.0');
          feedFiles.set(platformYml, ymlFor('99.0.1'));
        },
      ],
    ]) {
      setup();
      listeners.get('update-check')(FROM.app);
      await settle();
      assert.strictEqual(lastState().stage, 'error', what);
      assert.match(lastState().message, /not signed by the developer/, what);
      listeners.get('update-install')(FROM.app);
    }
    assert.strictEqual(
      log.check + log.download,
      before,
      'something was fetched for an unsigned update',
    );
  },
);
check('updates: a signed file for a version that is not newer offers nothing', async () => {
  const before = log.check;
  serve('0.0.1');
  listeners.get('update-check')(FROM.app);
  await settle();
  assert.strictEqual(lastState().stage, 'none');
  assert.strictEqual(log.check, before);
});
check('updates: a server with no update files at all just has no update', async () => {
  const before = log.check;
  feedFiles.clear();
  listeners.get('update-check')(FROM.app);
  await settle();
  assert.strictEqual(lastState().stage, 'none');
  assert.strictEqual(log.check, before);
});
check(
  'updates: the finished download must match the signed SHA-512, else it is deleted and never installed',
  async () => {
    serve('99.0.0');
    listeners.get('update-check')(FROM.app);
    await settle();
    updaterEvents.get('update-available')({ version: '98.0.0' });
    assert.strictEqual(
      lastState().stage,
      'error',
      'a different version than the signed one was accepted',
    );
    serve('99.0.0');
    listeners.get('update-check')(FROM.app);
    await settle();
    const bad = path.join(tmp, 'bad.AppImage'),
      good = path.join(tmp, 'good.AppImage');
    fs.writeFileSync(bad, 'something else');
    fs.writeFileSync(good, 'the installer');
    updaterEvents.get('update-downloaded')({ downloadedFile: bad });
    assert.strictEqual(lastState().stage, 'error');
    assert.ok(!fs.existsSync(bad), 'the bad download was kept');
    serve('99.0.0');
    listeners.get('update-check')(FROM.app);
    await settle();
    updaterEvents.get('update-downloaded')({ downloadedFile: good });
    assert.strictEqual(lastState().stage, 'ready');
    assert.ok(fs.existsSync(good));
  },
);
check('the update state is replayed only to the app', () => {
  const n = log.sent.length;
  for (const who of [...strangers, 'offline']) listeners.get('update-state')(FROM[who]);
  assert.strictEqual(log.sent.length, n);
});
check('retry: the app and the offline page may, strangers may not', () => {
  const n = log.loadURL;
  for (const who of strangers) listeners.get('shell-retry')(FROM[who]);
  assert.strictEqual(log.loadURL, n);
  listeners.get('shell-retry')(FROM.offline);
  listeners.get('shell-retry')(FROM.app);
  assert.strictEqual(log.loadURL, n + 2);
});
check(
  'navigation: the window follows this server and its offline page, and sends everything else to the browser',
  () => {
    const nav = url => {
      const e = {
        prevented: false,
        preventDefault() {
          this.prevented = true;
        },
      };
      wc.get('will-navigate')(e, url);
      return e.prevented;
    };
    assert.strictEqual(nav(O + '/app/#/you'), false);
    assert.strictEqual(nav(O + '/download'), false);
    assert.strictEqual(nav(offlineUrl), false);
    log.opened.length = 0;
    for (const u of [
      O + '.evil.example/app/',
      'https://10.0.0.60:84430/',
      'https://evil.example/',
    ]) {
      wc.get('input-event')({}, { type: 'mouseUp' });
      assert.strictEqual(nav(u), true, u);
    }
    assert.deepStrictEqual(log.opened, [
      O + '.evil.example/app/',
      'https://10.0.0.60:84430/',
      'https://evil.example/',
    ]);
    log.opened.length = 0;
    for (const u of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,hi']) {
      wc.get('input-event')({}, { type: 'mouseUp' });
      assert.strictEqual(nav(u), true, u);
    }
    assert.deepStrictEqual(log.opened, [], 'only web addresses may be handed to the browser');
  },
);

check(
  'a page that blanks the window (about:blank, which will-navigate never reports) is put back on the app; the app, its pages and the offline page are left alone',
  () => {
    const did = url => {
      const n = log.loadURL;
      wc.get('did-navigate')({}, url);
      return log.loadURL - n;
    };
    assert.strictEqual(did('about:blank'), 1);
    assert.strictEqual(did('about:blank#x'), 1);
    assert.strictEqual(did('https://evil.example/'), 1);
    assert.strictEqual(did(O + '/app/#/you'), 0);
    assert.strictEqual(did(O + '/download'), 0);
    assert.strictEqual(did(offlineUrl), 0);
  },
);

check(
  'the browser opens for a link only straight after a real click or key press, once per click, never because a page asked (window.open, navigation, a loop)',
  () => {
    const nav = url => {
      const e = { preventDefault() {} };
      wc.get('will-navigate')(e, url);
    };
    const U = 'https://friend.example/link';
    windowOpen({ url: U }); // an earlier test may have left one click unused: use it up first
    log.opened.length = 0;
    for (let i = 0; i < 20; i++) {
      windowOpen({ url: U });
      nav(U);
    }
    assert.deepStrictEqual(log.opened, [], 'a page opened the browser without any click');
    wc.get('input-event')({}, { type: 'mouseMove' });
    wc.get('input-event')({}, { type: 'mouseWheel' });
    windowOpen({ url: U });
    assert.deepStrictEqual(log.opened, [], 'moving the mouse counted as a click');
    wc.get('input-event')({}, { type: 'mouseUp' });
    for (let i = 0; i < 5; i++) windowOpen({ url: U });
    assert.deepStrictEqual(log.opened, [U], 'one click opened more than one tab');
    wc.get('before-input-event')({}, { type: 'keyDown' });
    windowOpen({ url: U });
    assert.deepStrictEqual(log.opened, [U, U], 'a key press did not count');
    wc.get('input-event')({}, { type: 'mouseUp' });
    windowOpen({ url: 'javascript:alert(1)' });
    windowOpen({ url: 'file:///etc/passwd' });
    assert.strictEqual(log.opened.length, 2, 'a non-web address reached the browser');
    log.opened.length = 0;
  },
);

// trusting a new server by its fingerprint
const { execFileSync } = require('node:child_process');
const pinsMod = require('../electron/pins.cjs');
const caDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totr-main-ca-'));
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
    path.join(caDir, 'k.pem'),
    '-out',
    path.join(caDir, 'ca.pem'),
    '-days',
    '30',
    '-subj',
    '/CN=friend CA',
    '-addext',
    'basicConstraints=critical,CA:TRUE',
  ],
  { stdio: 'ignore' },
);
const FRIEND_CA = fs.readFileSync(path.join(caDir, 'ca.pem'), 'utf8'),
  FRIEND_FP = pinsMod.fingerprint(FRIEND_CA);
const FRIEND = 'https://friend-nas.example:8443';
const config = () => JSON.parse(fs.readFileSync(path.join(userData, 'config.json'), 'utf8'));
const reset = () => {
  net.state = 'untrusted';
  net.offer = { pem: FRIEND_CA, fingerprint: FRIEND_FP };
  net.asked.length = 0;
  log.dialogs.length = 0;
  dialogAnswer = 0;
};

check(
  'a new https server with its own authority: the person is asked, with the fingerprint, and a Cancel adds nothing',
  async () => {
    reset();
    const before = fs.readFileSync(path.join(userData, 'config.json'), 'utf8');
    const r = await handlers.get('servers-add')(FROM.app, 'Friend NAS', FRIEND);
    assert.ok(r.error && /not confirmed/.test(r.error), JSON.stringify(r));
    assert.strictEqual(log.dialogs.length, 1);
    assert.ok(log.dialogs[0].detail.includes(FRIEND_FP), 'the dialog must show the code');
    assert.ok(log.dialogs[0].message.includes('friend-nas.example:8443'));
    assert.deepStrictEqual(log.dialogs[0].buttons[0], 'Cancel');
    assert.strictEqual(log.dialogs[0].defaultId, 0, 'the safe button is the default');
    assert.strictEqual(
      fs.readFileSync(path.join(userData, 'config.json'), 'utf8'),
      before,
      'nothing may be written',
    );
  },
);
check('confirming saves the server together with its pinned authority', async () => {
  reset();
  dialogAnswer = 1;
  assert.deepStrictEqual(await handlers.get('servers-add')(FROM.app, 'Friend NAS', FRIEND), {});
  const c = config();
  assert.ok(
    c.servers.some(s => s.origin === FRIEND),
    'the server is listed',
  );
  assert.strictEqual(c.pins[FRIEND].fingerprint, FRIEND_FP);
});
check(
  'a server that is already pinned is added without asking again, and the network is not even probed',
  async () => {
    reset();
    const r = await handlers.get('servers-use')(FROM.app, FRIEND);
    assert.deepStrictEqual(r, {});
    assert.strictEqual(log.dialogs.length, 0);
    assert.deepStrictEqual(net.asked, []);
  },
);
check(
  'a server the system already trusts (or an unreachable one) is added without a question',
  async () => {
    for (const state of ['ok', 'unreachable']) {
      reset();
      net.state = state;
      const r = await handlers.get('servers-add')(
        FROM.app,
        'Other ' + state,
        `https://${state}-host.example:8443`,
      );
      assert.deepStrictEqual(r, {}, state);
      assert.strictEqual(log.dialogs.length, 0, state);
      assert.deepStrictEqual(
        net.asked.map(a => a[0]),
        ['check'],
        'the authority is only fetched when it is needed',
      );
    }
  },
);
check(
  'plain http is added with no probe and no question (it protects nothing, so there is nothing to trust)',
  async () => {
    reset();
    assert.deepStrictEqual(
      await handlers.get('servers-add')(FROM.app, 'Plain', 'http://plain-host.example:8080'),
      {},
    );
    assert.deepStrictEqual(net.asked, []);
    assert.strictEqual(log.dialogs.length, 0);
  },
);
check(
  'a server that offers no authority, or a bad one, cannot be added (and there is no question to click through)',
  async () => {
    for (const offer of [
      { error: 'This server does not offer a certificate authority to trust.' },
      { error: 'The server offered something that is not a single certificate.' },
    ]) {
      reset();
      net.offer = offer;
      const r = await handlers.get('servers-add')(
        FROM.app,
        'Nope',
        'https://nope-host.example:8443',
      );
      assert.ok(r.error && r.error.includes(offer.error), JSON.stringify(r));
      assert.strictEqual(log.dialogs.length, 0);
      assert.ok(!config().servers.some(s => s.origin === 'https://nope-host.example:8443'));
    }
  },
);
check(
  'what the server offers is checked again by the shell: a pem that is not an authority is never pinned, even if the person agrees',
  async () => {
    reset();
    dialogAnswer = 1;
    net.offer = { pem: 'not a certificate', fingerprint: 'aaaa-aaaa-aaaa-aaaa-aaaa-aaaa' };
    const r = await handlers.get('servers-add')(FROM.app, 'Liar', 'https://liar-host.example:8443');
    assert.ok(r.error, JSON.stringify(r));
    assert.ok(!(config().pins || {})['https://liar-host.example:8443']);
  },
);
check(
  'the question is only ever asked for the app or the offline page, never for a stranger',
  async () => {
    reset();
    dialogAnswer = 1;
    for (const who of strangers)
      assert.ok(
        denied(await handlers.get('servers-add')(FROM[who], 'x', 'https://new-host.example:8443')),
        who,
      );
    assert.strictEqual(log.dialogs.length, 0);
    assert.deepStrictEqual(net.asked, []);
  },
);
check('a junk address is refused before anything is probed', async () => {
  reset();
  const r = await handlers.get('servers-add')(FROM.app, 'x', 'ftp://nope');
  assert.ok(r.error);
  assert.deepStrictEqual(net.asked, []);
  assert.strictEqual(log.dialogs.length, 0);
});
check('removing a server removes its pin too', async () => {
  reset();
  assert.ok(config().pins[FRIEND]);
  // the server in use cannot be removed, so switch away first
  await handlers.get('servers-use')(FROM.app, O);
  const r = await handlers.get('servers-remove')(FROM.app, FRIEND);
  assert.deepStrictEqual(r, {});
  assert.ok(!(config().pins || {})[FRIEND], 'the pin must go with the server');
  assert.ok(!config().servers.some(s => s.origin === FRIEND));
});
check(
  "the offline page explains a changed certificate (reason=certificate is shown, and only from the shell's own query)",
  () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'electron', 'offline.html'), 'utf8'),
      js = fs.readFileSync(path.join(__dirname, '..', 'electron', 'offline.js'), 'utf8');
    assert.ok(
      html.includes('id="certWarn"') &&
        html.includes('hidden') &&
        /certificate has changed/i.test(html),
    );
    assert.ok(/reason'\) === 'certificate'/.test(js) && !/innerHTML/.test(js));
  },
);
check(
  'the main window code reports a changed certificate to the offline page only for a pinned host',
  () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
    assert.ok(
      /onRefused: \(host, hadPin\) => \{\s*if \(hadPin\) (\{\s*)?certificateChanged\.add\(host\)/.test(
        src,
      ) && /reason: 'certificate'/.test(src),
    );
  },
);

// servers near you, asking to join
const JOIN_CHANNELS = [
  'discover-start',
  'discover-list',
  'discover-stop',
  'join-ask',
  'join-refresh',
  'join-cancel',
  'join-finish',
];
check(
  'discovery and joining are refused from strangers, and nothing is sent or written',
  async () => {
    const before = fs.existsSync(path.join(userData, 'config.json'))
      ? fs.readFileSync(path.join(userData, 'config.json'), 'utf8')
      : null;
    joinNet.calls.length = 0;
    const relaunches = log.relaunch + log.exit;
    for (const who of strangers)
      for (const ch of JOIN_CHANNELS)
        assert.ok(
          denied(await handlers.get(ch)(FROM[who], 'http://192.168.1.5:8080', { name: 'x' })),
          who + ' ' + ch,
        );
    assert.deepStrictEqual(joinNet.calls, []);
    assert.strictEqual(log.relaunch + log.exit, relaunches);
    assert.strictEqual(
      fs.existsSync(path.join(userData, 'config.json'))
        ? fs.readFileSync(path.join(userData, 'config.json'), 'utf8')
        : null,
      before,
    );
  },
);
check('discovery answers the app and the offline page with a list', async () => {
  for (const who of ['app', 'offline']) {
    const r = await handlers.get('discover-start')(FROM[who]);
    assert.ok(Array.isArray(r.list), who);
    assert.ok(Array.isArray((await handlers.get('discover-list')(FROM[who])).list));
  }
  assert.deepStrictEqual(await handlers.get('discover-stop')(FROM.app), {});
});
check(
  'asking an https server this app has not met goes through the trust question first; cancelling sends nothing',
  async () => {
    net.state = 'untrusted';
    net.offer = { pem: 'x', fingerprint: 'aaaa-bbbb-cccc-dddd-eeee-ffff' };
    dialogAnswer = 0;
    joinNet.calls.length = 0;
    const r = await handlers.get('join-ask')(FROM.app, 'https://192.168.1.77:8443', {
      name: 'Rae',
    });
    assert.ok(r.error && /code was not confirmed/.test(r.error), JSON.stringify(r));
    assert.deepStrictEqual(joinNet.calls, []);
    net.state = 'ok';
  },
);
check(
  'asking a server that is open: one request goes out, the ask is remembered, and the page gets no token',
  async () => {
    joinNet.calls.length = 0;
    joinNet.state = 'pending';
    const r = await handlers.get('join-ask')(FROM.app, 'http://192.168.1.88:8080', {
      name: ' Rae ',
      note: 'hi',
      history: { plays: 4, evil: 1 },
    });
    assert.ok(!r.error, r.error);
    assert.deepStrictEqual(joinNet.calls, ['GET /api/join', 'POST /api/join']);
    assert.deepStrictEqual(r.joins, [
      {
        requestId: 'e'.repeat(32),
        origin: 'http://192.168.1.88:8080',
        name: 'Rae',
        status: 'pending',
      },
    ]);
    const saved = JSON.parse(fs.readFileSync(path.join(userData, 'config.json'), 'utf8'));
    assert.ok(
      saved.joins[0].token.length >= 43 && !JSON.stringify(r).includes(saved.joins[0].token),
    );
    assert.ok(fs.existsSync(path.join(userData, 'install-key.json')));
  },
);
check(
  'a second ask to the same server while one is waiting is refused and the first request is not duplicated',
  async () => {
    joinNet.calls.length = 0;
    const r = await handlers.get('join-ask')(FROM.app, 'http://192.168.1.88:8080', {
      name: 'Rae again',
    });
    assert.ok(r.error && /already asked/.test(r.error), JSON.stringify(r));
    assert.ok(joinNet.calls.includes('POST /api/join/' + 'e'.repeat(32) + '/withdraw'));
  },
);
check(
  'refresh: still waiting, then approved (remembered); finish saves the server, restarts, and the token is not in the page list',
  async () => {
    let r = await handlers.get('join-refresh')(FROM.app);
    assert.strictEqual(r.joins[0].status, 'pending');
    joinNet.state = 'approved';
    r = await handlers.get('join-refresh')(FROM.offline);
    assert.strictEqual(r.joins[0].status, 'approved');
    const restarts = log.relaunch;
    assert.deepStrictEqual(await handlers.get('join-finish')(FROM.app, 'e'.repeat(32)), {});
    assert.strictEqual(log.relaunch, restarts + 1);
    const cfg = JSON.parse(fs.readFileSync(path.join(userData, 'config.json'), 'utf8'));
    assert.strictEqual(cfg.server, 'http://192.168.1.88:8080');
    assert.deepStrictEqual(cfg.joins, []);
    assert.ok(cfg.pendingInvite && cfg.pendingInvite.token.length >= 43);
    assert.ok(cfg.servers.some(x => x.origin === 'http://192.168.1.88:8080'));
  },
);
check('finishing something that is not approved, or does not exist, is refused', async () => {
  assert.ok((await handlers.get('join-finish')(FROM.app, 'f'.repeat(32))).error);
});
check('cancel withdraws a waiting ask and forgets it', async () => {
  joinNet.state = 'pending';
  joinNet.calls.length = 0;
  fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({ server: O, joins: [] }));
  const a = await handlers.get('join-ask')(FROM.app, 'http://192.168.1.99:8080', { name: 'Rae' });
  assert.ok(!a.error, a.error);
  joinNet.calls.length = 0;
  const r = await handlers.get('join-cancel')(FROM.app, 'e'.repeat(32));
  assert.deepStrictEqual(r.joins, []);
  assert.ok(joinNet.calls.includes('POST /api/join/' + 'e'.repeat(32) + '/withdraw'));
});
check('a declined or vanished ask is shown as declined, or dropped', async () => {
  const a = await handlers.get('join-ask')(FROM.app, 'http://192.168.1.99:8080', { name: 'Rae' });
  assert.ok(!a.error, a.error);
  joinNet.state = 'declined';
  let r = await handlers.get('join-refresh')(FROM.app);
  assert.strictEqual(r.joins[0].status, 'declined');
});
check(
  'the main window code opens a pending invite once and goes to the app after the account is made',
  () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
    assert.ok(
      /takePendingInvite\(readConfig\(\), server\.origin\)/.test(src) &&
        /win\.loadURL\(firstUrl\)/.test(src) &&
        /pathname === '\/'/.test(src),
    );
  },
);

// which server's pages get the controls (electron/shellaccess.cjs)
const cfg = () => JSON.parse(fs.readFileSync(path.join(userData, 'config.json'), 'utf8'));
const setAccess = list =>
  fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({ ...cfg(), access: list }));
check(
  'a server that was not given the controls is asked about once; Allow is remembered, strangers and the offline page never trigger the question',
  async () => {
    setAccess([]);
    accessAnswer = 1;
    log.access.length = 0;
    for (const who of strangers)
      assert.ok(denied(await handlers.get('servers-list')(FROM[who])), who);
    assert.strictEqual(log.access.length, 0, 'a stranger made the shell ask');
    assert.ok(Array.isArray((await handlers.get('servers-list')(FROM.offline)).list));
    assert.strictEqual(log.access.length, 0, 'the offline page made the shell ask');
    const both = await Promise.all([
      handlers.get('servers-list')(FROM.app),
      handlers.get('discover-list')(FROM.app),
    ]); // two calls at once: one question
    assert.ok(both.every(r => !denied(r)));
    assert.strictEqual(log.access.length, 1);
    assert.ok(log.access[0].message.includes('10.0.0.60'));
    assert.deepStrictEqual(cfg().access, [O]);
    await handlers.get('servers-list')(FROM.app);
    assert.strictEqual(log.access.length, 1, 'asked again after Allow');
  },
);
check(
  'Not now refuses every control, is not asked again that session, and the programs just stay hidden',
  async () => {
    setAccess([]);
    accessAnswer = 0;
    log.access.length = 0;
    assert.deepStrictEqual(await handlers.get('native-available')(FROM.app), []);
    assert.strictEqual(log.access.length, 0, 'the quiet question asked');
    for (const ch of [
      'servers-list',
      'discover-start',
      'discover-list',
      'discover-stop',
      'native-launch',
    ])
      assert.ok(denied(await handlers.get(ch)(FROM.app, 'amp')), ch);
    for (const ch of ['servers-add', 'servers-remove', 'servers-use'])
      assert.ok(denied(await handlers.get(ch)(FROM.app, 'x', 'https://other.example')), ch);
    for (const ch of ['join-ask', 'join-refresh', 'join-cancel', 'join-finish'])
      assert.ok(denied(await handlers.get(ch)(FROM.app, 'e'.repeat(32), { name: 'x' })), ch);
    assert.strictEqual(log.access.length, 1, 'asked more than once');
    assert.deepStrictEqual(cfg().access, [], 'Not now was remembered as Allow');
    const before = log.download;
    listeners.get('update-install')(FROM.app);
    await settle();
    assert.strictEqual(log.download, before, 'an update was installed');
  },
);
check(
  'the offline page keeps working while a server is refused (it is how the person leaves one)',
  async () => {
    assert.ok(Array.isArray((await handlers.get('servers-list')(FROM.offline)).list));
    assert.ok(Array.isArray((await handlers.get('discover-start')(FROM.offline)).list));
  },
);
check(
  'choosing a server on the offline page gives that server the controls; a page cannot give them to another server',
  async () => {
    setAccess([O]);
    assert.deepStrictEqual(
      await handlers.get('servers-use')(FROM.app, 'https://page-picked.example:8443'),
      {},
    );
    assert.ok(
      !cfg().access.includes('https://page-picked.example:8443'),
      'a page handed over the controls',
    );
    assert.deepStrictEqual(
      await handlers.get('servers-use')(FROM.offline, 'https://person-picked.example:8443'),
      {},
    );
    assert.ok(cfg().access.includes('https://person-picked.example:8443'));
  },
);
check('removing a server takes its controls away', async () => {
  setAccess([O, 'https://person-picked.example:8443']);
  assert.deepStrictEqual(
    await handlers.get('servers-remove')(FROM.app, 'https://person-picked.example:8443'),
    {},
  );
  assert.deepStrictEqual(cfg().access, [O]);
});

check(
  'the shell refuses every browser permission but the two the pages use (clipboard write, full screen)',
  async () => {
    assert.ok(
      permissionSession.request && permissionSession.check && permissionSession.device,
      'no handlers on the default session',
    );
    const asked = p => new Promise(res => permissionSession.request({}, p, res));
    for (const p of [
      'clipboard-read',
      'media',
      'geolocation',
      'notifications',
      'midi',
      'midiSysex',
      'display-capture',
      'openExternal',
      'idle-detection',
      'window-management',
      'unknown',
      undefined,
      42,
    ]) {
      assert.strictEqual(await asked(p), false, 'granted ' + p);
      assert.strictEqual(permissionSession.check({}, p), false, 'check granted ' + p);
    }
    for (const p of ['clipboard-sanitized-write', 'fullscreen']) {
      assert.strictEqual(await asked(p), true, p);
      assert.strictEqual(permissionSession.check({}, p), true, p);
    }
    assert.strictEqual(permissionSession.device({}), false);
  },
);

pending.then(() => {
  fs.rmSync(caDir, { recursive: true, force: true });
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(bad ? `\nFAILED (${bad} failing)` : '\nALL PASSED');
  process.exit(bad ? 1 : 0);
});
