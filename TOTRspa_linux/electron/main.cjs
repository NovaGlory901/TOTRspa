// TOTR desktop shell. A thin window onto the TOTR server's own copy of the listener app
// (<server>/app/). The app is not bundled here, so a fix pushed to the server reaches every
// installed copy without a reinstall: the app notices the newer build and offers "Update now"
// (src/UpdateNotice.jsx). Because the page comes from the server itself, cookies, the CSRF check
// and audio seeking work with no proxy. This file only changes when the shell itself does; the app
// then asks for a new installer (publish.config.json: minShell).
const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const trust = require('./trust.cjs');
const servers = require('./servers.cjs');
const access = require('./shellaccess.cjs');
const permissions = require('./permissions.cjs');
const linkgate = require('./linkgate.cjs');
const nativePrograms = require('./native.cjs');
const guard = require('./guard.cjs');
const pins = require('./pins.cjs');
const probe = require('./probe.cjs');
const { plainError } = require('./plainerror.cjs');
const appsig = require('./appsig.cjs');
const appKey = require('./appkey.cjs');
const discover = require('./discover.cjs');
const joinclient = require('./joinclient.cjs');
const accountsCore = require('./accounts.cjs');
const { parseServer } = require('./address.cjs');
const fs = require('node:fs');
const path = require('node:path');

// The settings folder (config.json: saved servers, pins, the controls list, the join key,
// remembered sign-ins) keeps the name it has always had. Electron names it after the package, the
// folder split renamed the packages (totr-spa-win, totr-spa-linux), and a new name would start
// every updated app on the first-run page with all of that left behind in the old folder. Set
// before anything asks for userData, the single-instance lock below included. A copy started with
// --user-data-dir (a throwaway profile for a test, or a second copy on purpose) keeps the folder it
// was given.
if (!app.commandLine.hasSwitch('user-data-dir'))
  app.setPath('userData', path.join(app.getPath('appData'), 'totr-spa'));

// One TOTR at a time: a second start (the launcher, the `totr` command, a double click) brings the
// first window to the front and quits at once. Two copies would share one config.json and one sign-
// in, and each would start its own DejaVuAmp / FalseHorizons. The lock is let go just before the
// app restarts itself on purpose (switching servers, installing an update), or the new copy would
// find the old one still there and quit.
const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();
let mainWindow = null;
app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

const configFile = () => path.join(app.getPath('userData'), 'config.json');
const PLATFORM =
  process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';

// The server in use: TOTR_SERVER, else the saved choice, else null. There is no built-in address:
// the first run asks which server to use (the offline page).
function readServer() {
  let url = process.env.TOTR_SERVER;
  if (!url) {
    try {
      url = JSON.parse(fs.readFileSync(configFile(), 'utf8')).server;
    } catch {
      /* no config yet */
    }
  }
  try {
    const u = new URL(url);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u;
  } catch {
    /* none, or not an address */
  }
  return null;
}
const serverOrigin = () => {
  const s = readServer();
  return s ? s.origin : '';
};

ipcMain.on('shell-info', e => {
  e.returnValue = { version: app.getVersion(), platform: PLATFORM };
});

// who may press the shell's buttons
// The shell shows the app (a page of the TOTR server) and its own offline page. Only those can
// switch servers, retry, install an update or open a program; any other page or frame that ends up
// in the window cannot (electron/guard.cjs). The server is trusted to serve the app, but a page it
// links to is not.
const offlinePath = path.join(__dirname, 'offline.html');
const appPageOrigin = () =>
  new URL(process.env.ELECTRON_DEV_URL || serverOrigin() || 'https://no-server.invalid').origin;
const fromApp = e => guard.fromAppFrame(e, appPageOrigin());
const fromAppOrOffline = e => fromApp(e) || guard.fromOfflineFrame(e, offlinePath);
const DENIED = { error: 'Not allowed from this page.' };

// Even a page of the app does not get the shell's controls just because its server serves it: a
// friend's server is a server the person may only want to listen to. The offline page (a file of
// the shell) always may. A server's page may when its origin is on the "access" list of config.json
// (electron/shellaccess.cjs); if it is not, the person is asked once, in a dialog of the shell.
// "Not now" holds until the app restarts and is not asked again meanwhile. `quiet` never asks.
const accessRefused = new Set(),
  accessAsking = new Map();
async function askAccess(origin) {
  const { dialog } = require('electron');
  const result = await dialog.showMessageBox(
    mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
    {
      type: 'question',
      title: "Let this server use the app's controls?",
      buttons: ['Not now', 'Allow'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      message: `${new URL(origin).host} wants to use this app's controls.`,
      detail:
        'That lets its pages switch which server this app uses, look for servers on your network and ask them to let you in, open DejaVuAmp and FalseHorizons, ' +
        'and install app updates. Listening to music does not need any of it. Only allow a server you trust.',
    },
  );
  if (result.response !== 1) return false;
  try {
    writeConfig(access.grant(readConfig(), origin));
  } catch {
    return true;
  } // allowed for now even if it could not be remembered
  return true;
}
async function allowed(e, { quiet = false, appOnly = false } = {}) {
  // appOnly: things the offline page has no use for (programs, updates)
  if (!appOnly && guard.fromOfflineFrame(e, offlinePath)) return true;
  if (!fromApp(e)) return false;
  const origin = appPageOrigin();
  if (process.env.ELECTRON_DEV_URL || access.has(readConfig(), origin)) return true;
  if (quiet || accessRefused.has(origin)) return false;
  if (!accessAsking.has(origin))
    accessAsking.set(
      origin,
      askAccess(origin)
        .then(yes => {
          if (!yes) accessRefused.add(origin);
          return yes;
        })
        .finally(() => accessAsking.delete(origin)),
    );
  return accessAsking.get(origin);
}

// config.json holds the server in use and a list of saved ones (electron/servers.cjs). The page's
// You tab and the offline page show the list; switching writes the choice and restarts the app,
// which then opens that server. TOTR_SERVER in the environment still wins over the saved choice
// (the page says so). A config that is missing, unreadable, damaged, or not a plain object (hand-
// edited into a list or a number) counts as empty: the app starts fresh and asks for a server. A
// file that exists but cannot be used is kept as config.json.broken before the first save replaces
// it, so nothing is lost silently.
const readConfigState = () => {
  let text;
  try {
    text = fs.readFileSync(configFile(), 'utf8');
  } catch (err) {
    return { config: {}, broken: !!err && err.code !== 'ENOENT' };
  }
  try {
    const c = JSON.parse(text);
    if (c && typeof c === 'object' && !Array.isArray(c)) return { config: c, broken: false };
  } catch {
    /* damaged */
  }
  return { config: {}, broken: true };
};
const readConfig = () => readConfigState().config;
const writeConfig = config => {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify(config, null, 2));
};
const saveOr = (result, then) => {
  if (result.error) return { error: result.error };
  try {
    if (readConfigState().broken) {
      try {
        fs.copyFileSync(configFile(), configFile() + '.broken');
      } catch {
        /* it could not be read either: nothing to keep */
      }
    }
    writeConfig(result.config);
  } catch (err) {
    return {
      error: 'Your server list could not be saved, so nothing was changed. ' + plainError(err),
    };
  }
  if (then) then();
  return {};
};
ipcMain.handle('servers-list', async e => {
  if (!(await allowed(e))) return DENIED;
  const current = serverOrigin();
  return {
    current,
    list: servers.list(readConfig(), current),
    fixedByEnvironment: !!process.env.TOTR_SERVER,
  };
});
// A server that uses its own certificate authority (a friend's TOTR) is trusted only after the
// person has compared its fingerprint with the one on that server's admin page (electron/pins.cjs,
// electron/probe.cjs). The question is a native dialog of the shell, which no web page can draw or
// press. A server already trusted (the system's authorities, TOTR's own built-in one, or an earlier
// pin) is added without asking.
async function confirmTrust(origin, fingerprint) {
  const { dialog } = require('electron');
  const result = await dialog.showMessageBox(
    mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
    {
      type: 'question',
      title: 'Trust this server?',
      buttons: ['Cancel', 'The codes match: trust this server'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      message: `${new URL(origin).host} is a server this app has not met before.`,
      detail:
        `Its certificate authority's code is:\n\n${fingerprint}\n\nOpen the server's admin page (Updates > This server > network identity), or ask whoever runs it, and compare. ` +
        'Only if the code is exactly the same, trust it. If it is different, someone may be listening in: press Cancel.',
    },
  );
  return result.response === 1;
}
// -> { config } (the saved config, plus a pin if one was just agreed) or { error }
async function ensureTrusted(address) {
  const r = parseServer(address);
  if (r.error) return { error: r.error };
  const config = readConfig();
  // plain http protects nothing, so there is nothing to trust
  if (!r.origin.startsWith('https:') || pins.pinsOf(config)[r.origin]) return { config };
  const builtIn = trust.caPemText();
  // trusted already, or not reachable (the offline page will say so)
  if ((await probe.check(r.origin, builtIn ? [builtIn] : [])) !== 'untrusted') return { config };
  const ca = await probe.fetchCa(r.origin);
  if (ca.error)
    return { error: `This server's certificate is not one this app can trust. ${ca.error}` };
  if (!(await confirmTrust(r.origin, ca.fingerprint)))
    return { error: 'Not added: the code was not confirmed.' };
  return pins.add(config, r.origin, ca.pem);
}
const restartOnServer = () => {
  app.releaseSingleInstanceLock();
  // an AppImage's own files vanish when it quits
  app.relaunch(process.env.APPIMAGE ? { execPath: process.env.APPIMAGE } : undefined);
  app.exit(0);
};
ipcMain.handle('servers-add', async (e, name, address) => {
  if (!(await allowed(e))) return DENIED;
  const t = await ensureTrusted(address);
  return t.error
    ? { error: t.error }
    : saveOr(servers.add(t.config, name, address, serverOrigin()));
});
ipcMain.handle('servers-remove', async (e, origin) => {
  if (!(await allowed(e))) return DENIED;
  const r = servers.remove(readConfig(), String(origin), serverOrigin());
  if (!r.error) accounts.forget(String(origin)); // a removed server takes its saved sign-in with it
  return saveOr(
    r.error ? r : { config: access.revoke(pins.remove(r.config, String(origin)), String(origin)) },
  ); // a removed server's pin and controls go with it
});
ipcMain.handle('servers-use', async (e, origin) => {
  if (!(await allowed(e))) return DENIED;
  const t = await ensureTrusted(origin);
  if (t.error) return { error: t.error };
  const r = servers.use(t.config, String(origin), serverOrigin());
  // choosing a server on the shell's own page is the person's decision, so that server gets the
  // controls; a page cannot hand them to another server
  return saveOr(
    !r.error && guard.fromOfflineFrame(e, offlinePath)
      ? { config: access.grant(r.config, parseServer(origin).origin) }
      : r,
    restartOnServer,
  );
});

// The app remembers a person's username and password for each server and signs in for them
// (electron/accounts.cjs). The vault is sealed with the operating system's protected storage
// (safeStorage); without it nothing is saved. Which server a saved sign-in is for comes from the
// frame's real address, never from the page. The page asks to save (the shell asks the person, in
// its own dialog, once per server per run) and gets only yes or no; looking at or removing a sign-
// in for another server needs the Allow question like the other controls.
const accounts = accountsCore.create({
  fs,
  dir: app.getPath('userData'),
  crypter: () => accountsCore.safeCrypter(require('electron').safeStorage),
  login: async (origin, username, password) => {
    const r = await sessionFetch(origin + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      credentials: 'include',
      redirect: 'error',
    });
    return { status: r.status };
  },
  hasSession: async origin =>
    (
      await require('electron').session.defaultSession.cookies.get({
        url: origin + '/',
        name: accountsCore.COOKIE,
      })
    ).length > 0,
  ask: async origin => {
    const { dialog } = require('electron');
    const r = await dialog.showMessageBox(
      mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
      {
        type: 'question',
        title: 'Save this sign-in?',
        buttons: ['Save', 'Not now', 'Never for this server'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
        message: `Let this app remember your sign-in for ${new URL(origin).host} and sign you in there itself next time?`,
        detail: "It is kept in this computer's protected storage and only used for that server.",
      },
    );
    return r.response;
  },
  servers: () => servers.list(readConfig(), serverOrigin()).map(s => s.origin),
});
ipcMain.handle('accounts-call', async (e, op, args) =>
  accounts.call(String(op), args, fromApp(e) ? appPageOrigin() : '', () => allowed(e)),
);

// servers near you, and asking to join
// Servers on the same network announce themselves (electron/discover.cjs, private addresses only);
// the page lists them and the person can ask one to let them in (electron/joinclient.cjs). Asking
// goes through the same trust check as adding a server, so a friend's certificate authority is
// compared by fingerprint first. What the page can do is small: start/stop looking, read the list,
// ask (a name, a note, optionally counts), see the answers, cancel, and finish once approved. The
// invite token stays in this file (config.json) and never reaches the page.
const finder = discover.create({ mdnsFactory: () => require('multicast-dns')() });
ipcMain.handle('discover-start', async e => {
  if (!(await allowed(e))) return DENIED;
  const r = finder.start();
  return r.error ? { error: r.error } : { list: finder.list() };
});
ipcMain.handle('discover-list', async e => ((await allowed(e)) ? { list: finder.list() } : DENIED));
ipcMain.handle('discover-stop', async e => {
  if (!(await allowed(e))) return DENIED;
  finder.stop();
  return {};
});
const sessionFetch = (url, init) => require('electron').session.defaultSession.fetch(url, init);
const joinsFor = config => joinclient.list(config).map(joinclient.forPage);
ipcMain.handle('join-ask', async (e, address, details) => {
  if (!(await allowed(e))) return DENIED;
  const t = await ensureTrusted(address);
  if (t.error) return { error: t.error };
  const origin = parseServer(address).origin;
  const d = details && typeof details === 'object' ? details : {};
  const request = joinclient.buildRequest(joinclient.loadKey(app.getPath('userData'), fs), {
    name: d.name,
    note: d.note,
    history: d.history,
    platform: PLATFORM,
    appVersion: app.getVersion(),
  });
  if (request.error) return { error: request.error };
  const asked = await joinclient.ask(sessionFetch, origin, request);
  if (asked.error) return { error: asked.error };
  const added = joinclient.add(t.config, {
    origin,
    requestId: asked.requestId,
    token: request.token,
    name: String(d.name || '')
      .trim()
      .slice(0, 40),
  });
  if (added.error) {
    await joinclient.withdraw(sessionFetch, origin, asked.requestId);
    return { error: added.error };
  }
  const saved = saveOr({ config: added.config });
  if (saved.error) {
    await joinclient.withdraw(sessionFetch, origin, asked.requestId);
    return saved;
  }
  return { joins: joinsFor(added.config) };
});
// Asks each waiting server for the answer, remembers it, and returns the list.
ipcMain.handle('join-refresh', async e => {
  if (!(await allowed(e))) return DENIED;
  let config = readConfig();
  for (const j of joinclient.list(config).filter(x => (x.status || 'pending') === 'pending')) {
    const r = await joinclient.check(sessionFetch, j.origin, j.requestId);
    if (r.status && r.status !== 'pending')
      config =
        r.status === 'gone'
          ? joinclient.remove(config, j.requestId)
          : joinclient.setStatus(config, j.requestId, r.status);
  }
  saveOr({ config });
  return { joins: joinsFor(config) };
});
ipcMain.handle('join-cancel', async (e, requestId) => {
  if (!(await allowed(e))) return DENIED;
  const config = readConfig(),
    j = joinclient.list(config).find(x => x.requestId === String(requestId));
  if (!j) return { joins: joinsFor(config) };
  // best effort: the server also forgets it after two weeks
  if (j.status === 'pending') await joinclient.withdraw(sessionFetch, j.origin, j.requestId);
  const next = joinclient.remove(config, j.requestId);
  const saved = saveOr({ config: next });
  return saved.error ? saved : { joins: joinsFor(next) };
});
ipcMain.handle('join-finish', async (e, requestId) => {
  if (!(await allowed(e))) return DENIED;
  const f = joinclient.finish(readConfig(), String(requestId));
  return f.error ? { error: f.error } : saveOr({ config: f.config }, restartOnServer);
});

// the native programs that ship inside this app (DejaVuAmp, FalseHorizons)
// Plain windows of their own (electron/native.cjs): they play local files and draw to sound, and
// never talk to the server. The page can only name which one to open; the program, its folder
// (~/DejaVuAmp, ~/FalseHorizons) and its arguments are fixed here. They update with the app (they
// are in the installer).
// hosts whose pinned authority did not sign the certificate they just showed (see did-fail-load)
const certificateChanged = new Set();
const nativeBase = () =>
  app.isPackaged
    ? path.join(process.resourcesPath, 'native')
    : path.join(__dirname, 'native', PLATFORM);
const nativeRunning = new Map();
ipcMain.handle('native-available', async e =>
  (await allowed(e, { quiet: true, appOnly: true })) ? nativePrograms.available(nativeBase()) : [],
); // never asks: the page just does not show the programs
ipcMain.handle('native-launch', async (e, name) =>
  (await allowed(e, { appOnly: true }))
    ? nativePrograms.launch(name, {
        base: nativeBase(),
        homeDir: app.getPath('home'),
        spawn: require('node:child_process').spawn,
        running: nativeRunning,
      })
    : DENIED,
);
app.on('before-quit', () => {
  nativePrograms.closeAll(nativeRunning);
  finder.stop();
});

// Installers live on the TOTR server (static/downloads/, with the latest.yml / latest-linux.yml
// files electron-builder writes). The page shows a notice (src/UpdateNotice.jsx); nothing downloads
// until the person presses Install, then the app restarts as the new version. It works for the
// Windows installer and the Linux AppImage; a tarball or an unpacked build cannot replace itself,
// and the page is told so (stage "unsupported").
const updatesPossible = app.isPackaged && (process.platform === 'win32' || !!process.env.APPIMAGE);
let updateWin = null,
  // the last state is replayed when the page subscribes (it may load after the news arrives)
  lastState = null;
const tell = state => {
  lastState = state;
  if (updateWin && !updateWin.isDestroyed()) updateWin.webContents.send('totr:update', state);
};
ipcMain.on('update-state', e => {
  if (fromApp(e) && lastState && updateWin && !updateWin.isDestroyed())
    updateWin.webContents.send('totr:update', lastState);
});
// Which update is genuine is decided by the developer's signature, never by the server the app is
// connected to (electron/appsig.cjs): the signed update file is fetched and checked first, the
// finished download is hashed against the SHA-512 inside it, and only then may it install.
let signedFeed = null;
async function fetchSignedFeed(server) {
  const key = appKey.pubkey();
  if (!key)
    return {
      error:
        'This app has no developer key built in, so it cannot tell a real update from a fake one. No update was used.',
    };
  const name = process.platform === 'win32' ? 'latest.yml' : 'latest-linux.yml';
  const ses = require('electron').session.fromPartition('electron-updater', { cache: false });
  const get = async n => {
    const r = await ses.fetch(`${server.origin}/static/downloads/${n}`, { redirect: 'error' });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const b = Buffer.from(await r.arrayBuffer());
    if (b.length > 64 * 1024) throw new Error('too big');
    return b;
  };
  const yml = await get(name);
  if (!yml) return { none: true };
  const sig = await get(name + '.sig');
  if (!sig || !appsig.verify(yml, sig.toString('utf8'), key))
    return { error: "This server's update is not signed by the developer, so it was not used." };
  const parsed = appsig.parseYml(yml);
  return parsed ? { signed: parsed } : { error: 'The signed update file could not be read.' };
}
function setupUpdates(win, server) {
  updateWin = win;
  if (!updatesPossible) {
    win.webContents.on('did-finish-load', () => tell({ stage: 'unsupported' }));
    return;
  }
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.setFeedURL({ provider: 'generic', url: `${server.origin}/static/downloads/` });
  const refuse = message => {
    signedFeed = null;
    tell({ stage: 'error', message });
  };
  autoUpdater.on('update-available', info => {
    if (signedFeed && info.version === signedFeed.version)
      tell({ stage: 'available', version: info.version });
    else refuse('The update offered is not the one the developer signed. It was not used.');
  });
  autoUpdater.on('update-not-available', () => tell({ stage: 'none' }));
  autoUpdater.on('download-progress', p =>
    tell({ stage: 'download', pct: Math.round(p.percent || 0) }),
  );
  autoUpdater.on('update-downloaded', info => {
    if (!signedFeed || !appsig.downloadMatches(signedFeed, info && info.downloadedFile)) {
      try {
        fs.rmSync(info && info.downloadedFile, { force: true });
      } catch {
        /* nothing to remove */
      }
      return refuse(
        'The download does not match what the developer signed. It was thrown away and not installed.',
      );
    }
    tell({ stage: 'ready' });
    setTimeout(() => {
      app.releaseSingleInstanceLock();
      autoUpdater.quitAndInstall(false, true);
    }, 800);
  });
  autoUpdater.on('error', e =>
    tell({ stage: 'error', message: 'The update did not work. ' + plainError(e) }),
  );
  const check = async () => {
    let r;
    try {
      r = await fetchSignedFeed(server);
    } catch {
      return;
    } // not reachable: try again later
    if (r.error) return refuse(r.error);
    if (r.none || !appsig.newer(r.signed.version, app.getVersion())) {
      signedFeed = null;
      return tell({ stage: 'none' });
    }
    signedFeed = r.signed;
    autoUpdater.checkForUpdates().catch(() => {
      /* server not reachable: try again later */
    });
  };
  ipcMain.removeAllListeners('update-check');
  ipcMain.removeAllListeners('update-install');
  ipcMain.on('update-check', e => {
    if (fromApp(e)) check();
  });
  ipcMain.on('update-install', async e => {
    if (!signedFeed || !(await allowed(e, { appOnly: true })) || !signedFeed) return;
    tell({ stage: 'download', pct: 0 });
    autoUpdater
      .downloadUpdate()
      .catch(e => tell({ stage: 'error', message: 'The update did not work. ' + plainError(e) }));
  });
  win.webContents.on('did-finish-load', () => check());
  setInterval(check, 30 * 60 * 1000);
}

function createWindow() {
  const server = readServer(); // null on a first run: the offline page asks for an address
  const appUrl =
    process.env.ELECTRON_DEV_URL ||
    (server ? `${server.origin}/app/` : 'https://no-server.invalid/app/');
  const appOrigin = new URL(appUrl).origin;
  const offlinePage = path.join(__dirname, 'offline.html');
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    backgroundColor: '#111111',
    title: 'TOTR',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  mainWindow = win;
  // After a join request was approved the next start opens the invite page once, where the person
  // picks a username and password (electron/joinclient.cjs).
  const pending =
    server && !process.env.ELECTRON_DEV_URL
      ? joinclient.takePendingInvite(readConfig(), server.origin)
      : null;
  if (pending) {
    try {
      writeConfig(pending.config);
    } catch {
      /* the invite page still opens; it would open again next time */
    }
  }
  const firstUrl = pending ? pending.url : appUrl;
  let onInvite = false;
  win.webContents.on('did-navigate', (_e, url) => {
    // will-navigate is not sent for about:blank (a page can blank the window with location.href =
    // 'about:blank'), so anything that is not the app or the offline page is put right here
    if (!guard.navigationAllowed(url, appOrigin, offlinePage)) {
      load();
      return;
    }
    const u = new URL(url);
    if (u.origin === appOrigin && u.pathname.startsWith('/invite/')) onInvite = true;
    else if (onInvite && u.origin === appOrigin && u.pathname === '/') {
      onInvite = false;
      win.loadURL(appUrl).catch(() => {
        /* offline page */
      });
    } // the account is made: into the app, not the portal
  });
  const load = () =>
    !server && !process.env.ELECTRON_DEV_URL
      ? win.loadFile(offlinePage, {
          query: { first: '1', ...(readConfigState().broken ? { problem: 'config' } : {}) },
        })
      : win.loadURL(firstUrl).catch(() => {
          /* did-fail-load below shows the offline page */
        });
  ipcMain.removeAllListeners('shell-retry');
  ipcMain.on('shell-retry', e => {
    if (fromAppOrOffline(e)) load();
  });
  // links that leave the app open in the person's browser, but only straight after a real click or
  // key press (electron/linkgate.cjs), never because a page's script asked
  const links = linkgate.create();
  win.webContents.on('input-event', (_e, input) => links.input(input && input.type));
  win.webContents.on('before-input-event', (_e, input) => links.input(input && input.type));
  const openInBrowser = url => {
    if (links.take(url)) shell.openExternal(url);
  };
  win.webContents.setWindowOpenHandler(({ url }) => {
    openInBrowser(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    // exactly this server's pages, or the offline page: not a look-alike address
    if (guard.navigationAllowed(url, appOrigin, offlinePage)) return;
    e.preventDefault();
    openInBrowser(url);
  });
  win.webContents.on('did-fail-load', (_e, code, _desc, url, isMainFrame) => {
    // -3 = a navigation replaced by another one, not a failure
    if (!isMainFrame || code === -3) return;
    if (url.startsWith('file://')) return;
    if (!server) return;
    win.loadFile(offlinePage, {
      query: {
        server: server.origin,
        ...(certificateChanged.has(new URL(server.origin).hostname)
          ? { reason: 'certificate' }
          : {}),
      },
    });
  });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'TOTR',
        submenu: [
          { label: server ? `Server: ${server.origin}` : 'No server chosen yet', enabled: false },
          {
            label: 'Servers...',
            click: () =>
              win.loadURL(`${appOrigin}/app/#/you`).catch(() => {
                /* did-fail-load shows the offline page, which lists the saved servers */
              }),
          },
          { type: 'separator' },
          { role: 'reload' },
          ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }]),
          { role: 'quit' }, // no developer tools in an installed app
        ],
      },
    ]),
  );
  if (server) setupUpdates(win, server);
  load();
}

if (hasLock)
  app.whenReady().then(() => {
    const { session } = require('electron');
    const trustOptions = {
      pinsFor: host => pins.pemsForHost(readConfig(), host),
      onRefused: (host, hadPin) => {
        if (hadPin) certificateChanged.add(host);
      },
    };
    // no microphone, camera, clipboard reading or notifications for any page
    // (electron/permissions.cjs)
    permissions.install(session.defaultSession);
    // TOTR's own certificate authority and the servers the person pinned (electron/trust.cjs)
    trust.install(session.defaultSession, trustOptions);
    // the updater downloads through its own session
    trust.install(session.fromPartition('electron-updater', { cache: false }), trustOptions);
    // an install from before the controls were per server keeps them for the servers it knew
    const inherited = access.inherit(readConfigState().config, serverOrigin());
    if (inherited) {
      try {
        writeConfig(inherited);
      } catch {
        /* asked about again next time */
      }
    }
    createWindow();
  });
app.on('window-all-closed', () => app.quit());
