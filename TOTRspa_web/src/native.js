// The Android app's native audio piece (android/app/src/main/java/org/totr/app/): it keeps the
// music going with the screen off and shows the lock-screen / notification controls. The page tells
// it what is playing and gets the button presses back. In a browser, in Electron, and in an Android
// install made before this existed, `window.TotrNative` is missing and everything here does
// nothing.
const bridge = () =>
  typeof window !== 'undefined' &&
  window.TotrNative &&
  typeof window.TotrNative.version === 'function'
    ? window.TotrNative
    : null;

export const hasNative = () => !!bridge();

export function nativeUpdate({ title, artist, playing, positionSec, durationSec }) {
  const b = bridge();
  if (!b) return;
  try {
    b.update(
      title || '',
      artist || '',
      !!playing,
      Math.round((positionSec || 0) * 1000),
      Math.round((durationSec || 0) * 1000),
    );
  } catch {
    /* the page keeps playing either way */
  }
}

// What the page knows about the app around it: Electron gives window.totrShell; the Android app
// gives the native bridge (an install from before version numbers existed has the bridge's audio
// part but no appVersion, which counts as 0.1.0).
export function shellInfo() {
  if (window.totrShell) return window.totrShell;
  const b = bridge();
  if (!b) return null;
  let v = '';
  try {
    v = typeof b.appVersion === 'function' ? b.appVersion() : '';
  } catch {
    v = '';
  }
  return { platform: 'android', version: v || '0.1.0' };
}

// A readable line for the You page: why the lock-screen controls are or are not there.
export function nativeStatus() {
  const b = bridge();
  if (!b)
    return window.Capacitor || /\bwv\b|; wv\)/.test(navigator.userAgent)
      ? 'not in this install of the app: it was installed before background audio existed, so reinstall the newest APK'
      : 'only in the Android app';
  try {
    return typeof b.status === 'function' ? b.status() : 'present';
  } catch (e) {
    return 'present, but status failed: ' + e.message;
  }
}

// Updating the app itself: the server's version.json says where the newest APK is; the native side
// downloads it, checks it and hands it to Android's installer (installs only over an app signed
// with the same key). Progress comes back through onInstallProgress.
export const supportsInstall = () => {
  const b = bridge();
  return !!(b && typeof b.installApk === 'function');
};
export const canInstallApps = () => {
  const b = bridge();
  try {
    return !!(b && typeof b.canInstall === 'function' && b.canInstall());
  } catch {
    return false;
  }
};
export function allowInstallApps() {
  const b = bridge();
  try {
    if (b && typeof b.allowInstall === 'function') b.allowInstall();
  } catch {
    /* ignore */
  }
}
export function installApk(address, sha256, size) {
  const b = bridge();
  try {
    b.installApk(address, sha256 || '', Number(size) || 0);
  } catch (e) {
    if (window.__totrInstall) window.__totrInstall('error', 0, e.message);
  }
}
export function onInstallProgress(fn) {
  window.__totrInstall = (stage, pct, msg) => fn({ stage, pct, msg });
  return () => {
    delete window.__totrInstall;
  };
}

// The cover of the song now playing, for the lock screen and notification (an address on this
// server; the native side fetches it with the sign-in cookie).
export function nativeCover(address) {
  const b = bridge();
  if (!b || typeof b.setCover !== 'function') return;
  try {
    b.setCover(address || '');
  } catch {
    /* ignore */
  }
}
// The app's colours, so the pages bundled in the app (the "no signal" screen and the offline
// player) match the theme.
export function nativeSaveTheme(colors) {
  const b = bridge();
  if (!b || typeof b.saveTheme !== 'function') return;
  try {
    b.saveTheme(JSON.stringify({ colors }));
  } catch {
    /* ignore */
  }
}

// offline mode (Android app only): saved mixtapes and the switch that closes the app up
export const offlineSupported = () => {
  const b = bridge();
  return !!(b && typeof b.saveMixtape === 'function');
};
export function offlineIndex() {
  const b = bridge();
  if (!b || typeof b.offlineIndex !== 'function') return [];
  try {
    return JSON.parse(b.offlineIndex()).mixtapes || [];
  } catch {
    return [];
  }
}
export const offlineBytes = () => {
  const b = bridge();
  try {
    return b && typeof b.offlineBytes === 'function' ? b.offlineBytes() : 0;
  } catch {
    return 0;
  }
};
export function saveMixtapeOffline({ id, name, tracks }) {
  const b = bridge();
  if (!b) return;
  b.saveMixtape(
    JSON.stringify({
      id: String(id),
      name,
      origin: location.origin,
      tracks: tracks.map(t => ({
        track_id: t.track_id,
        title: t.title,
        artists: t.artists || '',
        album_id: t.album_id || null,
      })),
    }),
  );
}
export function removeMixtapeOffline(id) {
  const b = bridge();
  try {
    if (b) b.removeMixtape(String(id));
  } catch {
    /* ignore */
  }
}
export function goOffline() {
  const b = bridge();
  try {
    if (b) b.goOffline();
  } catch {
    /* ignore */
  }
}
const offlineListeners = new Set();
export function onOfflineProgress(fn) {
  offlineListeners.add(fn);
  window.__totrOffline = evt => offlineListeners.forEach(l => l(evt));
  return () => offlineListeners.delete(fn);
}

// The list is kept by the app around the page (Android: the native side; desktop: config.json),
// because each server is its own web origin and the page cannot see another one's storage. A shell
// from before the list existed has none of this, and the You page then shows no Servers panel.
// list() -> { current, list: [{ name, origin }], fixedByEnvironment? }; add / remove -> { error? };
// use() leaves this server (the app reopens on the other).
const desktopServers = () =>
  (typeof window !== 'undefined' && window.totrShell && window.totrShell.servers) || null;
const androidServers = () => {
  const b = bridge();
  return b && typeof b.servers === 'function' && typeof b.useServer === 'function' ? b : null;
};
export const serversSupported = () => !!(desktopServers() || androidServers());
export async function serverList() {
  const d = desktopServers();
  if (d) return d.list();
  const b = androidServers();
  try {
    return JSON.parse(b.servers());
  } catch {
    return { current: '', list: [] };
  }
}
export async function serverAdd(name, address) {
  const d = desktopServers();
  if (d) return d.add(name, address);
  const err = androidServers().addServer(name || '', address || '');
  return err ? { error: err } : {};
}
export async function serverRemove(origin) {
  const d = desktopServers();
  if (d) return d.remove(origin);
  androidServers().removeServer(origin);
  return {};
}
export async function serverUse(origin) {
  const d = desktopServers();
  if (d) return d.use(origin);
  androidServers().useServer(origin);
  return {};
}

// servers near you, and asking to join (desktop app and Android app)
// The app around the page looks for TOTR servers on the same network (private addresses only) and
// can ask one to let the person in. start() -> { list } | { error }; list() -> { list: [{ name,
// origin, address, fingerprint }] }. ask(address, { name, note, history }) -> { joins } | { error
// }; refresh() -> { joins: [{ requestId, origin, name,
// status: pending | approved | declined }] }; cancel(id); finish(id) restarts the app on that
// server's invite page. The invite token never reaches the page.
const desktopNear = () =>
  (typeof window !== 'undefined' &&
    window.totrShell &&
    window.totrShell.discover &&
    window.totrShell.join &&
    window.totrShell) ||
  null;
// The Android app has the same calls as one bridge function, nearCall(id, op, args), whose answer
// comes back as window.__totrNearDone(id, json): the page never waits on the network.
const androidNear = () => {
  const b = bridge();
  return b && typeof b.nearCall === 'function' ? b : null;
};
const nearWaiting = new Map();
let nearId = 0;
function androidCall(op, args) {
  return new Promise(resolve => {
    const id = ++nearId;
    const timer = setTimeout(() => {
      nearWaiting.delete(id);
      resolve({ error: 'The phone did not answer.' });
    }, 60 * 1000);
    nearWaiting.set(id, json => {
      clearTimeout(timer);
      let v;
      try {
        v = JSON.parse(json);
      } catch {
        v = { error: 'The phone gave an answer this app does not understand.' };
      }
      resolve(v);
    });
    window.__totrNearDone = (done, json) => {
      const f = nearWaiting.get(done);
      if (f) {
        nearWaiting.delete(done);
        f(json);
      }
    };
    try {
      androidNear().nearCall(String(id), op, JSON.stringify(args || {}));
    } catch {
      nearWaiting.delete(id);
      clearTimeout(timer);
      resolve({ error: 'The phone did not answer.' });
    }
  });
}
export const nearSupported = () => !!(desktopNear() || androidNear());
export const nearStart = async () => {
  const d = desktopNear();
  if (d) return d.discover.start();
  const r = await androidCall('start');
  return r.error ? r : androidCall('list');
};
export const nearList = async () => {
  const d = desktopNear();
  return d ? d.discover.list() : androidCall('list');
};
export const nearStop = async () => {
  const d = desktopNear();
  return d ? d.discover.stop() : androidCall('stop');
};
export const joinAsk = async (address, details) => {
  const d = desktopNear();
  return d
    ? d.join.ask(address, details)
    : androidCall('ask', { address, details: JSON.stringify(details || {}) });
};
export const joinRefresh = async () => {
  const d = desktopNear();
  return d ? d.join.refresh() : androidCall('refresh');
};
export const joinCancel = async id => {
  const d = desktopNear();
  return d ? d.join.cancel(id) : androidCall('cancel', { id });
};
export const joinFinish = async id => {
  const d = desktopNear();
  return d ? d.join.finish(id) : androidCall('finish', { id });
};

// remembered sign-ins (desktop app and Android app)
// The app remembers a person's username and password for each server and signs in for them; the
// password never reaches the page, which only gets yes or no. Desktop:
// window.totrShell.accounts.call(op, args); Android: accountCall(id, op, args), answered as
// window.__totrAccountsDone(id, json). A shell without it (a browser, an older app) offers nothing
// and every call here does nothing. The portal's own pages use the same calls through the server's
// static/accounts.js.
const desktopAccounts = () =>
  (typeof window !== 'undefined' &&
    window.totrShell &&
    window.totrShell.accounts &&
    typeof window.totrShell.accounts.call === 'function' &&
    window.totrShell.accounts) ||
  null;
const androidAccounts = () => {
  const b = bridge();
  return b && typeof b.accountCall === 'function' ? b : null;
};
const accountWaiting = new Map();
let accountId = 0;
function accountCall(op, args, ms) {
  const d = desktopAccounts();
  if (d)
    return Promise.race([
      d.call(op, args || {}),
      new Promise(r => setTimeout(() => r(null), ms)),
    ]).catch(() => null);
  const a = androidAccounts();
  if (!a) return Promise.resolve(null);
  return new Promise(resolve => {
    const id = ++accountId;
    const timer = setTimeout(() => {
      accountWaiting.delete(id);
      resolve(null);
    }, ms);
    accountWaiting.set(id, json => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(json));
      } catch {
        resolve(null);
      }
    });
    window.__totrAccountsDone = (done, json) => {
      const f = accountWaiting.get(done);
      if (f) {
        accountWaiting.delete(done);
        f(json);
      }
    };
    try {
      a.accountCall(String(id), op, JSON.stringify(args || {}));
    } catch {
      accountWaiting.delete(id);
      clearTimeout(timer);
      resolve(null);
    }
  });
}
export const accountsSupported = () => !!(desktopAccounts() || androidAccounts());
export const accountAuto = async () => {
  const r = await accountCall('auto', {}, 40 * 1000);
  return !!(r && r.signedIn === true);
}; // true: the app has just signed this window in
export const accountSave = (username, password) =>
  // the app asks the person, on its own screen
  accountCall('save', { username, password }, 130 * 1000);
// signed out by hand: no automatic sign-in until a manual one
export const accountSignedOut = () => accountCall('signedOut', {}, 10 * 1000);
// [{ origin, username }] for the saved servers, or [] (the app asks the person to allow this the
// first time)
export const accountList = async () => {
  const r = await accountCall('list', {}, 60 * 1000);
  return r && Array.isArray(r.accounts) ? r.accounts : [];
};
export const accountForget = origin => accountCall('forget', { origin }, 60 * 1000);

// offering saved songs to a server (Android app)
// listSavedSongs() -> [{ file, title, artist, album, ext, size, sha256 }] (every song saved for
// offline, once); sendSavedSong(offerId, itemNo, file, csrf) sends one song that was accepted, to
// the server this page came from -> { ok, message }. The phone does the reading and sending; the
// page never holds the audio.
export const songOffersSupported = () => {
  const b = bridge();
  return !!(b && typeof b.listSavedSongs === 'function' && typeof b.sendSavedSong === 'function');
};
function viaCallback(name, start, ms) {
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      delete window[name];
      resolve(null);
    }, ms);
    window[name] = value => {
      clearTimeout(timer);
      delete window[name];
      resolve(value);
    };
    try {
      start();
    } catch {
      clearTimeout(timer);
      delete window[name];
      resolve(null);
    }
  });
}
export const listSavedSongs = () =>
  viaCallback('__totrSongs', () => bridge().listSavedSongs(), 5 * 60 * 1000).then(l =>
    Array.isArray(l) ? l : [],
  );
export const sendSavedSong = (offerId, itemNo, file, csrf) =>
  viaCallback(
    '__totrSent',
    () => bridge().sendSavedSong(location.origin, offerId, itemNo, file, csrf || ''),
    20 * 60 * 1000,
  ).then(r => r || { ok: false, message: 'The phone did not answer.' });

export function nativeStop() {
  const b = bridge();
  if (!b) return;
  try {
    b.stop();
  } catch {
    /* ignore */
  }
}

// The notification's buttons arrive here: handlers = { play, pause, next, prev, seek(seconds) }.
export function nativeButtons(handlers) {
  window.__totrMedia = action => {
    const f = handlers[action];
    if (f) f();
  };
  window.__totrSeek = ms => {
    if (Number.isFinite(ms)) handlers.seek(ms / 1000);
  };
  return () => {
    delete window.__totrMedia;
    delete window.__totrSeek;
  };
}

// the programs that ship inside the desktop app
// DejaVuAmp (a player) and FalseHorizons (a visualizer) as windows of their own. Only the
// Windows/Linux shell has them (window.totrShell.native); the browser and Android keep the built-in
// JavaScript versions. They never talk to the server: they play local files and draw to sound. The
// page can only name which one to open ('amp' | 'fh'); the shell decides everything else.
// available() -> the names this install holds; launch -> { error? }.
const desktopPrograms = () =>
  (typeof window !== 'undefined' && window.totrShell && window.totrShell.native) || null;
export const programsSupported = () => !!desktopPrograms();
export async function programsAvailable() {
  const d = desktopPrograms();
  try {
    return d ? await d.available() : [];
  } catch {
    return [];
  }
}
export async function programOpen(name) {
  const d = desktopPrograms();
  if (!d) return { error: 'This app cannot open programs.' };
  try {
    return (await d.launch(name)) || {};
  } catch (e) {
    return { error: (e && e.message) || 'That did not work.' };
  }
}
