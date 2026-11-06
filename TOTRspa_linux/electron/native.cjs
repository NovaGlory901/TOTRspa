// Starting the two native programs that ship inside the desktop app: DejaVuAmp (a player) and
// FalseHorizons (a visualizer). They never talk to the TOTR server; they are plain windows of their
// own that play local files / draw to sound. The page may only say WHICH one to open (a fixed
// name): never a path, never an argument. Everything here takes its dependencies as parameters so
// tests can run it without Electron (tests/native.test.cjs).
const fs = require('node:fs');
const { plainError } = require('./plainerror.cjs');
const path = require('node:path');

// name -> where it is inside the installer (<resources>/native/<dir>/), its program file (`binary`
// on Linux, `winBinary` on Windows), its visible folder in the person's home folder, and which of
// that folder's sub-folders exist. The files in `seed` sub-folders (the built-in presets) are
// copied over when missing, never over anything.
const PROGRAMS = Object.freeze({
  amp: Object.freeze({
    title: 'DejaVuAmp',
    dir: 'dejavuamp',
    binary: 'dejavuamp',
    winBinary: 'DejaVuAmp.exe',
    home: 'DejaVuAmp',
    folders: ['music', 'themes', 'eq-presets'],
    seed: ['eq-presets', 'themes', 'music'],
  }),
  fh: Object.freeze({
    title: 'FalseHorizons',
    dir: 'falsehorizons',
    binary: 'falsehorizons',
    winBinary: 'FalseHorizons.exe',
    home: 'FalseHorizons',
    folders: ['backgrounds', 'artifacts', 'presets'],
    seed: ['presets', 'backgrounds', 'artifacts'],
  }),
});
// the file names that are copied: plain names only, no paths
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,100}$/;
// a program that stops within this long, with an error, did not start
const STARTUP_GRACE_MS = 1500;

// The program file for a platform, and how to test that it is there: on Windows there is no
// executable permission to check (X_OK means "exists" there).
const binaryFor = (p, platform = process.platform) =>
  platform === 'win32' ? p.winBinary : p.binary;
const runnable = (platform = process.platform) =>
  platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK;

const known = name =>
  typeof name === 'string' && Object.prototype.hasOwnProperty.call(PROGRAMS, name);

// A call counts only if it comes from the app's own page (the server the shell is showing), not the
// offline page, another site or a frame.
function fromApp(senderUrl, serverOrigin) {
  try {
    const u = new URL(String(senderUrl));
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.origin === serverOrigin;
  } catch {
    return false;
  }
}

// Which programs are in this install (an unpackaged dev run, or a build made before they were
// bundled, may have none).
function available(base, fsApi = fs, platform = process.platform) {
  return Object.keys(PROGRAMS).filter(n => {
    try {
      fsApi.accessSync(
        path.join(base, PROGRAMS[n].dir, binaryFor(PROGRAMS[n], platform)),
        runnable(platform),
      );
      return true;
    } catch {
      return false;
    }
  });
}

// Makes the person's visible folder and its sub-folders if they are missing, and copies the files
// the program ships for them (the built-in presets, the README files) into the ones that lack them.
// An existing file is never touched, so the person's own presets, pictures and edits are safe, and
// a newer built-in preset in a later update simply appears. Only plain files with plain names are
// copied (no folders, no links).
function prepareFolder(name, base, homeDir, fsApi = fs) {
  const p = PROGRAMS[name],
    target = path.join(homeDir, p.home);
  fsApi.mkdirSync(target, { recursive: true });
  for (const sub of p.folders) fsApi.mkdirSync(path.join(target, sub), { recursive: true });
  for (const sub of p.seed) {
    const from = path.join(base, p.dir, sub);
    let entries = [];
    try {
      entries = fsApi.readdirSync(from, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isFile() || !SAFE_NAME.test(e.name)) continue;
      const to = path.join(target, sub, e.name);
      try {
        fsApi.copyFileSync(path.join(from, e.name), to, fs.constants.COPYFILE_EXCL);
      } catch {
        /* already there (kept as it is), or not writable: the program still starts */
      }
    }
  }
  return target;
}

// Opens one program. `running` is the Map of programs already open (name -> child); a second click
// does not start a second copy. Returns a Promise of {} or {error: 'a sentence'}. The program runs
// as a child of the app and is closed with it (see closeAll): an AppImage's files disappear when it
// quits, so a program left running from inside it would lose its own files.
function launch(name, ctx) {
  const {
    base,
    homeDir,
    spawn,
    running,
    fsApi = fs,
    graceMs = STARTUP_GRACE_MS,
    platform = process.platform,
  } = ctx;
  if (!known(name)) return Promise.resolve({ error: 'Unknown program.' });
  const p = PROGRAMS[name],
    bin = path.join(base, p.dir, binaryFor(p, platform));
  const live = running.get(name);
  if (live && live.exitCode === null && !live.killed)
    return Promise.resolve({ error: `${p.title} is already open.` });
  try {
    fsApi.accessSync(bin, runnable(platform));
  } catch {
    return Promise.resolve({ error: `${p.title} is not part of this install of the app.` });
  }
  let folder;
  try {
    folder = prepareFolder(name, base, homeDir, fsApi);
  } catch (e) {
    return Promise.resolve({ error: `${p.title} could not make its folder. ${plainError(e)}` });
  }
  return new Promise(resolve => {
    let settled = false;
    const done = r => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };
    let child;
    try {
      child = spawn(bin, ['--folder', folder], { stdio: 'ignore', shell: false, cwd: folder });
    } catch (e) {
      return done({
        error: `${p.title} did not start. Its file may be damaged or missing, or this account may not be allowed to run it.`,
      });
    }
    running.set(name, child);
    child.on('error', e => {
      running.delete(name);
      done({
        error: `${p.title} did not start. Its file may be damaged or missing, or this account may not be allowed to run it.`,
      });
    });
    child.on('exit', (code, signal) => {
      if (running.get(name) === child) running.delete(name);
      if (code !== 0 && code !== null)
        done({
          error: `${p.title} stopped right away (exit code ${code}). It may be missing a library (SDL2, OpenGL ES, or on Windows one of its DLLs) or a sound device.`,
        });
      else if (signal && signal !== 'SIGTERM')
        done({ error: `${p.title} stopped right away (${signal}).` });
      else done({});
    });
    setTimeout(() => done({}), graceMs); // still running after the grace time: it started
  });
}

function closeAll(running) {
  for (const child of running.values()) {
    try {
      child.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }
  running.clear();
}

module.exports = {
  PROGRAMS,
  binaryFor,
  known,
  fromApp,
  available,
  prepareFolder,
  launch,
  closeAll,
};
