// Sends the installers to the live server over SSH, into its static/downloads folder, whatever
// their size (the desktop ones are over GitHub's 100 MB file limit, so they cannot travel by git).
// One method for all three: node shared/tools/deploy.cjs [android] [linux] [win] [app]  (default:
// android) For each platform it takes release/TOTR-<version>-<android.apk | linux.AppImage |
// win.exe> (the version in package.json: build it first), stores it on the server under that name,
// makes the fixed name the apps link to (TOTR.apk, TOTR-linux.AppImage, TOTR-win.exe: see
// publish.config.json "downloads") point at the same file, checks the copy there by SHA-256, and
// deletes all but the newest `keep` versions. For Linux and Windows it also sends the files the
// apps' own updater reads: the .blockmap (if built) and then latest-linux.yml / latest.yml, last,
// so an app never sees a yml that names a file the server does not have yet. The yml must have its
// developer signature next to it (<yml>.sig, made with TOTRsrv/tools/release_tool.py sign-file):
// the apps install nothing else. Files are written under a temporary name and renamed, so a
// download in progress never sees half a file. `app` sends the built web app (the folder
// TOTR_APP_OUT names, the one `npm run publish:web` fills) to the server's static/app: it is
// unpacked next to it, checked (file count and version.json by SHA-256), and only then swapped in,
// keeping the one before as static/app.old. The folder is "appDir" in deploy.config.json
// (TOTR_APP_DIR for one run), by default the static/app next to "downloadsDir".
// Where: deploy.config.json ("ssh", "downloadsDir", "keep"; your own copy of
// deploy.config.example.json, not in git); TOTR_SSH / TOTR_DOWNLOADS_DIR override it for one run.
// With an SSH key already set up for that host there is no password prompt; without one, ssh asks
// in this terminal (once per file).
const fs = require('fs'),
  path = require('path'),
  crypto = require('crypto'),
  { spawnSync } = require('child_process');
const shared = path.resolve(__dirname, '..'); // TOTRspa/shared
let cfg;
try {
  cfg = JSON.parse(
    fs.readFileSync(
      process.env.TOTR_DEPLOY_CONFIG || path.join(shared, 'deploy.config.json'),
      'utf8',
    ),
  );
} catch (e) {
  // TOTR_DEPLOY_CONFIG: another file, for tests
  if (process.env.TOTR_SSH && process.env.TOTR_DOWNLOADS_DIR)
    cfg = {}; // both given on the command line: no file needed
  else {
    console.error(
      'No usable shared/deploy.config.json (your server and folder; it stays out of git). Copy shared/deploy.config.example.json to deploy.config.json and edit it.',
    );
    process.exit(1);
  }
}
const links = JSON.parse(
  fs.readFileSync(path.join(shared, 'publish.config.json'), 'utf8'),
).downloads;
// each platform builds in its own folder: its installer is that folder's release/ and its version
// is that folder's package.json
const SHELLS = { android: 'TOTRspa_apk', linux: 'TOTRspa_linux', win: 'TOTRspa_win' };
const shellDir = name => path.join(shared, '..', SHELLS[name]);
const versionOf = name =>
  JSON.parse(fs.readFileSync(path.join(shellDir(name), 'package.json'), 'utf8')).version;
const target = process.env.TOTR_SSH || cfg.ssh,
  dir = process.env.TOTR_DOWNLOADS_DIR || cfg.downloadsDir,
  keep = Math.max(1, Number(cfg.keep) || 5);
if (!/^[\w.@-]+$/.test(target) || !/^\/[\w/.-]+$/.test(dir)) {
  console.error('deploy.config.json: "ssh" and "downloadsDir" look wrong.');
  process.exit(1);
}

// pattern: the versioned names to prune (newest `keep` stay); yml: the file the app's updater
// reads, sent last
const PLATFORMS = {
  android: { ext: 'android.apk', pattern: 'TOTR-[0-9.]+-android\\.apk' },
  linux: {
    ext: 'linux.AppImage',
    pattern: 'TOTR-[0-9.]+-linux\\.AppImage(\\.blockmap)?',
    yml: 'latest-linux.yml',
  },
  win: { ext: 'win.exe', pattern: 'TOTR-[0-9.]+-win\\.exe(\\.blockmap)?', yml: 'latest.yml' },
};
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : ['android'];
for (const w of wanted)
  if (!PLATFORMS[w] && w !== 'app') {
    console.error(`Unknown platform "${w}" (use: ${Object.keys(PLATFORMS).join(', ')}, app).`);
    process.exit(1);
  }

const d = `'${dir}'`;
// Stores one file on the server (temporary name, then rename), optionally also as `copyAs`, checks
// it by SHA-256, and optionally prunes old versions.
function put(file, name, { copyAs, prune } = {}) {
  const bytes = fs.readFileSync(file),
    sha = crypto.createHash('sha256').update(bytes).digest('hex');
  const pruneCmd = prune
    ? ` && (ls -1 ${d} | grep -E '^${prune}$' | sort -V | head -n -${keep * (prune.includes('blockmap') ? 2 : 1)} | while read f; do rm -f ${d}/"$f"; done)`
    : '';
  const copyCmd = copyAs
    ? ` && cp -f ${d}/${name} ${d}/${copyAs}.part && mv -f ${d}/${copyAs}.part ${d}/${copyAs}`
    : '';
  const remote = `mkdir -p ${d} && cat > ${d}/${name}.part && mv -f ${d}/${name}.part ${d}/${name}${copyCmd} && sha256sum ${d}/${copyAs || name} | cut -d' ' -f1${pruneCmd}`;
  const r = spawnSync('ssh', [target, remote], {
    input: bytes,
    stdio: ['pipe', 'pipe', 'inherit'],
    maxBuffer: 1 << 20,
  });
  if (r.error || r.status !== 0) {
    console.error(
      `  ${name}: the upload failed` +
        (r.error ? ': ' + r.error.message : ` (ssh exit ${r.status})`) +
        '.',
    );
    return false;
  }
  const remoteSha = String(r.stdout).trim().split('\n')[0];
  if (remoteSha !== sha) {
    console.error(
      `  ${name}: the copy on the server does not match (server ${remoteSha.slice(0, 16)}..., here ${sha.slice(0, 16)}...). Run it again.`,
    );
    return false;
  }
  console.log(
    `  ${name}: uploaded and checked (sha256 ${sha.slice(0, 16)}..., ${Math.round((bytes.length / 1048576) * 10) / 10} MB)${copyAs ? `; ${copyAs} points at it` : ''}`,
  );
  return true;
}

// Where the built app is: TOTR_APP_OUT (environment, or TOTRspa_web/.env.local like `publish:web`;
// relative to TOTRspa_web).
function appSource() {
  const web = path.join(shared, '..', 'TOTRspa_web');
  let value = process.env.TOTR_APP_OUT;
  if (value === undefined) {
    try {
      value = (fs
        .readFileSync(path.join(web, '.env.local'), 'utf8')
        .match(/^TOTR_APP_OUT=(.+)$/m) || [])[1];
    } catch {
      /* no such file */
    }
  }
  return value ? path.resolve(web, value.trim()) : '';
}

// Every regular file of the folder: refuses links and odd names, so what is sent is exactly what
// the folder shows.
function listFiles(root, rel = '') {
  const out = [];
  for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${entry.name}` : entry.name;
    if (!/^[\w.@+~ -]+$/.test(entry.name) || entry.name === '.' || entry.name === '..')
      throw new Error(`the name "${r}" is not a plain file name`);
    if (entry.isDirectory()) out.push(...listFiles(root, r));
    else if (entry.isFile()) out.push(r);
    else throw new Error(`"${r}" is not a plain file`);
  }
  return out;
}

function deployApp() {
  const src = appSource();
  const appDir =
    process.env.TOTR_APP_DIR ||
    cfg.appDir ||
    (path.posix.basename(dir) === 'downloads'
      ? path.posix.join(path.posix.dirname(dir), 'app')
      : '');
  if (!src) {
    console.error(
      'app: TOTR_APP_OUT is not set (environment or TOTRspa_web/.env.local): the folder `npm run publish:web` builds into.',
    );
    return false;
  }
  if (!/^\/[\w/.-]+$/.test(appDir) || appDir.endsWith('/')) {
    console.error(
      'app: the server folder for the web app is unknown: set "appDir" in deploy.config.json (for example /srv/totr/TOTRsrv/static/app).',
    );
    return false;
  }
  let files;
  try {
    if (
      !fs.existsSync(path.join(src, 'index.html')) ||
      !fs.existsSync(path.join(src, 'version.json'))
    )
      throw new Error(
        `${src} has no index.html and version.json: build the app first (npm run publish:web)`,
      );
    files = listFiles(src);
  } catch (e) {
    console.error('app: ' + e.message + '.');
    return false;
  }
  const tar = spawnSync('tar', ['-cf', '-', '-C', src, '.'], { maxBuffer: 1 << 29 });
  if (tar.error || tar.status !== 0) {
    console.error(
      'app: could not pack the folder with tar' + (tar.error ? ': ' + tar.error.message : '') + '.',
    );
    return false;
  }
  const versionSha = crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(src, 'version.json')))
    .digest('hex');
  const a = `'${appDir}'`,
    s = `'${appDir}.new'`;
  console.log(
    `app: sending ${files.length} files (${Math.round(tar.stdout.length / 1024)} KB) to ${target}:${appDir} ...`,
  );
  // 1. unpack next to the live folder and look at it; the live folder is not touched
  const stage = `set -e; mkdir -p "$(dirname ${a})"; rm -rf ${s}; mkdir ${s}; tar -xf - -C ${s}; test -f ${s}/index.html; echo "$(find ${s} -type f | wc -l | tr -d " ") $(sha256sum ${s}/version.json | cut -d' ' -f1)"`;
  const r = spawnSync('ssh', [target, stage], {
    input: tar.stdout,
    stdio: ['pipe', 'pipe', 'inherit'],
    maxBuffer: 1 << 20,
  });
  const got = String(r.stdout || '')
    .trim()
    .split('\n')
    .pop();
  if (r.error || r.status !== 0 || got !== `${files.length} ${versionSha}`) {
    console.error(
      `app: the copy on the server does not match (${r.error ? r.error.message : r.status !== 0 ? 'ssh exit ' + r.status : `server "${got}", here "${files.length} ${versionSha.slice(0, 16)}..."`}). Nothing was changed there.`,
    );
    spawnSync('ssh', [target, `rm -rf ${s}`], { stdio: 'ignore' });
    return false;
  }
  // 2. swap, keeping the one before as app.old
  const swap = `set -e; rm -rf '${appDir}.old'; if [ -e ${a} ]; then mv ${a} '${appDir}.old'; echo kept; fi; mv ${s} ${a}`;
  const w = spawnSync('ssh', [target, swap], {
    stdio: ['ignore', 'pipe', 'inherit'],
    encoding: 'utf8',
  });
  if (w.error || w.status !== 0) {
    console.error(
      'app: the swap failed' +
        (w.error ? ': ' + w.error.message : ` (ssh exit ${w.status})`) +
        '; putting the old app back.',
    );
    spawnSync(
      'ssh',
      [target, `if [ ! -e ${a} ] && [ -e '${appDir}.old' ]; then mv '${appDir}.old' ${a}; fi`],
      { stdio: 'ignore' },
    );
    return false;
  }
  console.log(
    `app: done. The new app is live` +
      (String(w.stdout).includes('kept') ? `; the one before is kept as ${appDir}.old.` : '.'),
  );
  return true;
}

let failed = false;
for (const name of wanted) {
  if (name === 'app') continue;
  const { ext, pattern, yml } = PLATFORMS[name];
  const version = versionOf(name),
    releaseDir = path.join(shellDir(name), 'release');
  const versioned = `TOTR-${version}-${ext}`,
    fixed = path.posix.basename(links[name] || '');
  const file = path.join(releaseDir, versioned);
  if (!/^[\w.-]+$/.test(fixed) || !fs.existsSync(file)) {
    console.error(
      `${name}: no ${file}. Build it first (version ${version} in ${SHELLS[name]}/package.json).`,
    );
    failed = true;
    continue;
  }
  if (yml && !fs.existsSync(path.join(releaseDir, yml + '.sig'))) {
    console.error(
      `${name}: no release/${yml}.sig. The apps install only updates signed by the developer: python TOTRsrv/tools/release_tool.py sign-file --key <signing.key> ${path.join(releaseDir, yml)}`,
    );
    failed = true;
    continue;
  }
  if (yml && !fs.existsSync(path.join(releaseDir, yml))) {
    console.error(
      `${name}: no release/${yml} (electron-builder writes it with the installer). Build it again.`,
    );
    failed = true;
    continue;
  }
  console.log(`${name}: sending to ${target}:${dir} ...`);
  let ok = put(file, versioned, { copyAs: fixed, prune: pattern });
  const blockmap = path.join(releaseDir, `${versioned}.blockmap`);
  if (ok && fs.existsSync(blockmap)) ok = put(blockmap, `${versioned}.blockmap`);
  if (ok && yml)
    ok =
      put(path.join(releaseDir, yml + '.sig'), yml + '.sig') &&
      // the signature first, so an app never sees a yml without it
      put(path.join(releaseDir, yml), yml);
  if (ok) console.log(`${name}: done. The server keeps the newest ${keep}.`);
  else failed = true;
}
if (wanted.includes('app') && !deployApp()) failed = true;
process.exit(failed ? 1 : 0);
