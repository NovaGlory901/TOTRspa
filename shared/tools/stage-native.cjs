// Builds DejaVuAmp and FalseHorizons (Release) and puts them where the desktop installer picks them
// up: electron/native/<platform>/<name>/ (the program, its font / built-in presets and the README
// files of its plain folders: the same layout `cmake --install` makes for ~/DejaVuAmp and
// ~/FalseHorizons). package.json's `extraResources` then copies that into the installer, so the
// programs update with the app. Run by `dist:linux` and `dist:win`.
// Windows: built with MSYS2's UCRT64 toolchain (C:\msys64, or MSYS2_ROOT), the same one as each
// program's windows/build.ps1; `cmake --install` also copies every
// DLL the program needs (SDL2, ANGLE, ffmpeg...) next to it, so the installed app does not depend
// on MSYS2.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// the folder that holds this repository and the two programs' repositories side by side
const root = path.resolve(__dirname, '..', '..', '..');
// the shell folder this is run from (TOTRspa_win or TOTRspa_linux): npm runs scripts there
const shell = process.cwd();
const platform = process.platform === 'win32' ? 'win' : 'linux';
const isWin = platform === 'win';
const out = path.join(shell, 'electron', 'native', platform);
// DejaVuAmp and FalseHorizons live in their own repositories; DEJAVUAMP_DIR / FALSEHORIZONS_DIR say
// where they are checked out.
const checkout = {
  DejaVuAmp: process.env.DEJAVUAMP_DIR || path.join(root, 'DejaVuAmp'),
  FalseHorizons: process.env.FALSEHORIZONS_DIR || path.join(root, 'FalseHorizons'),
};
const programs = [
  {
    dir: 'DejaVuAmp',
    name: 'dejavuamp',
    binary: isWin ? 'DejaVuAmp.exe' : 'dejavuamp',
    versionLine: /^dejavuamp \d+\.\d+/,
  },
  {
    dir: 'FalseHorizons',
    name: 'falsehorizons',
    binary: isWin ? 'FalseHorizons.exe' : 'falsehorizons',
    versionLine: /^falsehorizons \d+\.\d+/,
  },
];

// Windows: the MSYS2 toolchain's folder goes first on the PATH of everything started here (cmake,
// ninja, g++, and the staged programs' own --version check).
const msysBin = path.join(process.env.MSYS2_ROOT || 'C:\\msys64', 'ucrt64', 'bin');
const env = isWin
  ? { ...process.env, PATH: msysBin + path.delimiter + process.env.PATH }
  : process.env;
const tool = name => (isWin ? path.join(msysBin, name + '.exe') : name);
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, {
    stdio: opts.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    encoding: 'utf8',
    env,
  });

if (isWin && !fs.existsSync(tool('g++'))) {
  console.error(
    `stage-native: no MSYS2 UCRT64 toolchain at ${msysBin} (set MSYS2_ROOT; setup line: FalseHorizons/windows/build.ps1).`,
  );
  process.exit(1);
}
const appVersion = JSON.parse(fs.readFileSync(path.join(shell, 'package.json'), 'utf8')).version;
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

for (const p of programs) {
  const src = checkout[p.dir],
    build = path.join(src, isWin ? 'build-windows' : 'build-release'),
    dest = path.join(out, p.name);
  if (!fs.existsSync(path.join(src, 'CMakeLists.txt'))) {
    console.error(
      `stage-native: no ${p.dir} checkout at ${src} (set ${p.dir === 'DejaVuAmp' ? 'DEJAVUAMP_DIR' : 'FALSEHORIZONS_DIR'})`,
    );
    process.exit(1);
  }
  console.log(`== ${p.dir}: building (Release)`);
  run(tool('cmake'), ['-S', src, '-B', build, '-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release']);
  run(tool('cmake'), ['--build', build]);
  run(tool('cmake'), ['--install', build, '--prefix', dest]);
  const bin = path.join(dest, p.binary);
  if (!fs.existsSync(bin)) {
    console.error(
      `stage-native: ${p.binary} was not built (SDL2 and GLES2 development files are needed)`,
    );
    process.exit(1);
  }
  if (isWin && !fs.existsSync(path.join(dest, 'libEGL.dll'))) {
    console.error(
      `stage-native: libEGL.dll (ANGLE) is not next to ${p.binary}: the window could not open`,
    );
    process.exit(1);
  }
  // the staged program must start; on Windows with a bare PATH (no MSYS2), as on a PC without it,
  // so a DLL that was not copied shows up here
  const cleanEnv = isWin
    ? { SystemRoot: process.env.SystemRoot, PATH: path.join(process.env.SystemRoot, 'System32') }
    : process.env;
  const said = execFileSync(bin, ['--version'], {
    stdio: ['ignore', 'pipe', 'inherit'],
    encoding: 'utf8',
    env: cleanEnv,
    cwd: dest,
  }).trim();
  if (!p.versionLine.test(said)) {
    console.error(`stage-native: ${p.binary} --version said "${said}"`);
    process.exit(1);
  }
  console.log(`   ${said}`);
}
// the TOTR app version these were staged for
fs.writeFileSync(path.join(out, 'version.txt'), appVersion + '\n');
console.log(`staged for TOTR ${appVersion} in ${path.relative(process.cwd(), out)}`);
