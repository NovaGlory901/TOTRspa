import { useEffect, useState } from 'react';
import {
  allowInstallApps,
  canInstallApps,
  installApk,
  onInstallProgress,
  shellInfo,
  supportsInstall,
} from './native.js';

// Tells the person a newer build of this app is on the server. The server publishes version.json
// next to the app (see vite.config.js); this build's own id is baked in as __BUILD_ID__. Nothing
// reloads until they click Update now.
const CHECK_EVERY_MS = 2 * 60 * 1000;
const versionUrl = () => new URL('version.json', location.href.split('#')[0]).href;
// The address carries a changing ?t= so no cache anywhere (the phone's web view, a proxy) can hand
// back an old answer.
export const fetchVersion = () =>
  fetch(`${versionUrl()}?t=${Date.now()}`, { cache: 'no-store', credentials: 'omit' }).then(r => {
    if (!r.ok) throw new Error(`the server answered ${r.status}`);
    return r.json();
  });
// Loads the app again from the server. A plain reload can be answered from the phone's cache; a new
// ?u= makes this a page it has never seen.
export const reloadFresh = () => {
  const u = new URL(location.href);
  u.searchParams.set('u', Date.now());
  location.replace(u.toString());
};

// "0.1.0" < "0.2.0"; anything that is not x.y.z compares as 0.
const parts = v =>
  String(v || '')
    .split('.')
    .map(n => parseInt(n, 10) || 0);
const older = (a, b) => {
  const x = parts(a),
    y = parts(b);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0);
  return false;
};

export default function UpdateNotice() {
  // the server's version.json when it differs from what is running
  const [info, setInfo] = useState(null);
  const [later, setLater] = useState(''); // the build id the person said "Later" to
  // Android: how the download and install of a newer app is going
  const [prog, setProg] = useState(null);
  useEffect(() => onInstallProgress(setProg), []);
  // Windows / Linux app: the shell's own updater (electron/main.cjs)
  const [desk, setDesk] = useState(null);
  const [deskVersion, setDeskVersion] = useState('');
  useEffect(() => {
    const s = shellInfo();
    return s && s.updates
      ? s.updates.onChange(st => {
          if (st.version) setDeskVersion(st.version);
          setDesk(st);
        })
      : undefined;
  }, []);

  useEffect(() => {
    // the dev server has no published build to compare with
    if (import.meta.env.DEV) return undefined;
    let live = true;
    const check = () =>
      fetchVersion()
        .then(v => {
          if (live && v) setInfo(v);
        })
        .catch(() => {
          /* server unreachable: try again later */
        });
    // A phone keeps the page alive in the background, pauses its timers, and often sends no "focus"
    // event when you come back: the page becoming visible again is the reliable signal, so check on
    // that too (and when the network returns).
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    check();
    const timer = setInterval(check, CHECK_EVERY_MS);
    window.addEventListener('focus', check);
    window.addEventListener('online', check);
    window.addEventListener('pageshow', check);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener('focus', check);
      window.removeEventListener('online', check);
      window.removeEventListener('pageshow', check);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  if (!info) return null;
  const shell = shellInfo(); // from the Electron / Android shell; null in a plain browser
  const shellOld = shell && info.minShell && older(shell.version, info.minShell);
  const newBuild = info.buildId && info.buildId !== __BUILD_ID__ && info.buildId !== later;
  const download = shell && info.downloads && info.downloads[shell.platform];

  // Windows / Linux: the shell found a newer installer on the server. Nothing downloads until
  // Install is pressed; the app then restarts as the new version.
  if (
    shell &&
    shell.updates &&
    desk &&
    ['available', 'download', 'ready', 'error'].includes(desk.stage) &&
    later !== 'desk-' + deskVersion
  ) {
    return (
      <aside className="update-notice" role="status">
        {desk.stage === 'available' && (
          <p>
            A new TOTR app is ready (version {deskVersion}; you have {shell.version}).
          </p>
        )}
        {desk.stage === 'download' && <p>Downloading the new app... {desk.pct}%</p>}
        {desk.stage === 'ready' && <p>Restarting to finish the update...</p>}
        {desk.stage === 'error' && <p>The update did not install: {desk.message}</p>}
        {(desk.stage === 'available' || desk.stage === 'error') && (
          <button onClick={() => shell.updates.install()}>
            {desk.stage === 'error' ? 'Try again' : 'Install'}
          </button>
        )}
        {desk.stage !== 'download' && desk.stage !== 'ready' && (
          <button onClick={() => setLater('desk-' + deskVersion)}>Later</button>
        )}
      </aside>
    );
  }

  // Android: a newer app (the APK itself) is on the server. The native side downloads it and hands
  // it to Android, which asks for one tap.
  const apk = info.android,
    androidNew =
      shell &&
      shell.platform === 'android' &&
      apk &&
      older(shell.version, apk.version) &&
      later !== 'apk-' + apk.version;
  if (androidNew) {
    const address = new URL(
      apk.url || (info.downloads && info.downloads.android) || '/static/downloads/TOTR.apk',
      location.href,
    ).href;
    const install = () => {
      if (!canInstallApps()) {
        allowInstallApps();
        setProg({
          stage: 'permission',
          pct: 0,
          msg: 'Turn on "Allow from this source" for TOTR, then come back and press Install again.',
        });
        return;
      }
      setProg({ stage: 'download', pct: 0, msg: '' });
      installApk(address, apk.sha256, apk.size);
    };
    const working = prog && (prog.stage === 'download' || prog.stage === 'install');
    return (
      <aside className="update-notice" role="status">
        <p>
          A new TOTR app is ready (version {apk.version}; you have {shell.version}).
        </p>
        {!supportsInstall() && (
          <p>
            This install cannot update itself yet. Install the new app by hand once:{' '}
            <a href={address}>download it</a>, open it, and Android will ask to replace TOTR (if it
            refuses, uninstall TOTR first).
          </p>
        )}
        {supportsInstall() && prog && prog.stage === 'download' && (
          <p>Downloading... {prog.pct}%</p>
        )}
        {supportsInstall() && prog && prog.stage === 'install' && <p>Handing it to Android...</p>}
        {supportsInstall() && prog && prog.stage === 'confirm' && (
          <p>Press Update on the Android screen.</p>
        )}
        {supportsInstall() && prog && prog.stage === 'permission' && <p>{prog.msg}</p>}
        {supportsInstall() && prog && prog.stage === 'error' && (
          <p>The update did not install: {prog.msg}</p>
        )}
        {supportsInstall() && (
          <button onClick={install} disabled={working}>
            {prog && prog.stage === 'error' ? 'Try again' : 'Install'}
          </button>
        )}
        <button onClick={() => setLater('apk-' + apk.version)}>Later</button>
      </aside>
    );
  }

  if (shellOld) {
    return (
      <aside className="update-notice" role="status">
        <p>
          This app needs a new installer (you have {shell.version}, the server needs {info.minShell}
          ).
        </p>
        {download ? (
          <a href={download} target="_blank" rel="noreferrer">
            Download it
          </a>
        ) : (
          <p>Ask the server's administrator for the new installer.</p>
        )}
      </aside>
    );
  }
  if (!newBuild) return null;
  return (
    <aside className="update-notice" role="status">
      <p>A new version of TOTR is ready.</p>
      <button onClick={reloadFresh}>Update now</button>
      <button onClick={() => setLater(info.buildId)}>Later</button>
    </aside>
  );
}
