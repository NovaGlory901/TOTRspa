// A first run: no TOTR_SERVER and nothing saved. The shell has no built-in address, so it must ask
// (the offline page with ?first=1), load no server, and check for no updates. Once an address is
// saved it opens that server. Run: node tests/firstrun.test.cjs
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
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

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'totr-first-'));
delete process.env.TOTR_SERVER;
delete process.env.ELECTRON_DEV_URL;
process.env.APPIMAGE = path.join(userData, 'TOTR.AppImage');
process.resourcesPath = userData;

let readyCb = null;
const log = { loadURL: [], loadFile: [], feed: 0, menu: null };
const electron = {
  app: {
    requestSingleInstanceLock: () => true,
    on() {},
    quit() {},
    getVersion: () => '9.9.9',
    isPackaged: true,
    releaseSingleInstanceLock() {},
    relaunch() {},
    exit() {},
    getPath: () => userData,
    setPath() {},
    commandLine: { hasSwitch: () => false },
    whenReady: () => ({
      then: cb => {
        readyCb = cb;
      },
    }),
  },
  ipcMain: { on() {}, handle() {}, removeAllListeners() {} },
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
  Menu: {
    buildFromTemplate: x => {
      log.menu = x;
      return x;
    },
    setApplicationMenu() {},
  },
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
const updater = {
  autoUpdater: {
    setFeedURL() {
      log.feed++;
    },
    on() {},
    checkForUpdates() {
      return Promise.resolve();
    },
    downloadUpdate() {},
    quitAndInstall() {},
  },
};
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  return request === 'electron'
    ? electron
    : request === 'electron-updater'
      ? updater
      : realLoad.call(this, request, ...rest);
};
global.setInterval = () => ({ unref() {} });

const src = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
require('../electron/main.cjs');
readyCb();

check('the source holds no built-in server address', () =>
  assert.ok(!/DEFAULT_SERVER|\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(src)),
);
check(
  'with no server chosen the offline page opens in first-run mode and nothing is loaded from a server',
  () => {
    assert.deepStrictEqual(log.loadFile, [{ query: { first: '1' } }]);
    assert.deepStrictEqual(log.loadURL, []);
  },
);
check('no update feed is set for a server that does not exist', () =>
  assert.strictEqual(log.feed, 0),
);
check('the menu says no server is chosen', () =>
  assert.ok(JSON.stringify(log.menu).includes('No server chosen yet')),
);
check('an installed app has no developer-tools menu item', () =>
  assert.ok(
    !JSON.stringify(log.menu).includes('toggleDevTools') &&
      JSON.stringify(log.menu).includes('reload'),
  ),
);
check('the offline page has the first-run wording', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'electron', 'offline.html'), 'utf8'),
    js = fs.readFileSync(path.join(__dirname, '..', 'electron', 'offline.js'), 'utf8');
  assert.ok(
    html.includes('id="firstRun"') &&
      js.includes("get('first')") &&
      !/\d+\.\d+\.\d+\.\d+/.test(html),
  );
});
console.log(bad ? `\n${bad} FAILED` : '\nALL PASSED');
process.exit(bad ? 1 : 0);
