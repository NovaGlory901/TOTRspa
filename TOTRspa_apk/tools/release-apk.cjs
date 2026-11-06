// After an Android build:
// * copies the APK to release/ as TOTR-<version>-android.apk (kept) and TOTR.apk (always the
// newest); * if a local server folder is configured (TOTR_LOCAL_DOWNLOADS_DIR or
// "localDownloadsDir" in shared/deploy.config.json), also copies it there (TOTR.apk and
// TOTR-<version>-android.apk, newest KEEP versions). That folder is git-ignored: it never reaches
// the server by git. `node shared/tools/deploy.cjs android` is what sends the APK to the server
// (over SSH); * writes what the installed apps need to know into publish.config.json ("android":
// version, versionCode, size, SHA-256, address), which `npm run publish:web` puts in version.json.
// Apps older than that offer an in-app update. Order for a new app version (full steps and checks:
// docs/release_step_by_step.md): raise "version" in package.json, then `npm run android:release`
// (build, THEN send the APK to the server, THEN publish the web build, so version.json never names
// an APK the server does not have), commit, push, pull on the server. Running `npm run publish:web`
// before this build leaves version.json naming the OLD APK, and no phone is offered the update.
const fs = require('fs'),
  path = require('path'),
  crypto = require('crypto'),
  { execFileSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const src = path.join(
  root,
  'android',
  'app',
  'build',
  'outputs',
  'apk',
  'release',
  'app-release.apk',
);
if (!fs.existsSync(src)) {
  console.error('No APK at ' + src);
  process.exit(1);
}
const bytes = fs.readFileSync(src);
const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
const [maj, min, pat] = version.split('.').map(Number);
const versionCode = maj * 10000 + min * 100 + pat;

const out = path.join(root, 'release');
// A server folder on this computer that should get a copy too (optional): TOTR_LOCAL_DOWNLOADS_DIR,
// or "localDownloadsDir" in shared/deploy.config.json.
const deployCfg = (() => {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(root, '..', 'shared', 'deploy.config.json'), 'utf8'),
    );
  } catch {
    return {};
  }
})();
const downloads = process.env.TOTR_LOCAL_DOWNLOADS_DIR || deployCfg.localDownloadsDir || '';
fs.mkdirSync(out, { recursive: true });
if (downloads) fs.mkdirSync(downloads, { recursive: true });
const KEEP = 5;
for (const f of [
  path.join(out, `TOTR-${version}-android.apk`),
  path.join(out, 'TOTR.apk'),
  ...(downloads
    ? [path.join(downloads, `TOTR-${version}-android.apk`), path.join(downloads, 'TOTR.apk')]
    : []),
])
  fs.writeFileSync(f, bytes);
const code = n => {
  const m = n.match(/^TOTR-(\d+)\.(\d+)\.(\d+)-android\.apk$/);
  return m ? m[1] * 10000 + m[2] * 100 + +m[3] : -1;
};
const old = (downloads ? fs.readdirSync(downloads) : [])
  .filter(n => code(n) >= 0)
  .sort((a, b) => code(b) - code(a))
  .slice(KEEP);
for (const n of old) fs.unlinkSync(path.join(downloads, n));

const cfgPath = path.join(root, '..', 'shared', 'publish.config.json');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
cfg.android = {
  version,
  versionCode,
  size: bytes.length,
  sha256,
  url: (cfg.downloads && cfg.downloads.android) || '/static/downloads/TOTR.apk',
};
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');

let signer = 'not checked';
try {
  const sdk = process.env.ANDROID_HOME || '/opt/android-sdk',
    tools = path.join(sdk, 'build-tools');
  const latest = fs.readdirSync(tools).sort().pop();
  const text = execFileSync(
    path.join(tools, latest, 'apksigner'),
    ['verify', '--print-certs', src],
    { encoding: 'utf8' },
  );
  signer = (text.match(/certificate SHA-256 digest: (\w+)/) || [])[1] || 'unknown';
} catch {
  /* apksigner not available: skip */
}
console.log(
  `APK ${version} (code ${versionCode}, ${Math.round(bytes.length / 1024)} KB, sha256 ${sha256.slice(0, 16)}..., signed by key ${String(signer).slice(0, 16)}...)`,
);
console.log(
  '  release/TOTR.apk' +
    (downloads
      ? ', ' + path.join(downloads, 'TOTR.apk') + ' (+ the newest ' + KEEP + ' versions)'
      : '') +
    ', publish.config.json updated' +
    (old.length ? '; removed ' + old.join(', ') : ''),
);
