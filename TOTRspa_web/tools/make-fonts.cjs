// Builds the fonts folder (the server's static/fonts/): the fonts the portal and the listener app
// use, served by the server itself (no Google Fonts request).
//  VT323 the terminal look (Latin, Latin Extended, Vietnamese only: that is all the font has)
//   TOTR Sans    Noto Sans: Latin, Cyrillic, Greek, Devanagari. Catches every letter VT323 lacks
// TOTR JP/SC/KR  Noto Sans Japanese, Simplified Chinese, Korean. Catch Japanese, Chinese and Korean
// text The CSS stack is 'VT323', 'TOTR Sans', 'TOTR JP', 'TOTR SC', 'TOTR KR', ...: the browser
// picks, letter by letter, the first font that has it. Every font is cut into small pieces
// (unicode-range), so a page downloads only the pieces its text needs: an English-only page never
// loads Noto at all. Only weight 400 is kept (VT323 has no bold; the browser fakes it).
//
// The packages are not project dependencies (the CJK ones are about 200 MB unpacked), so install
// them where you like and point at them: mkdir /tmp/fonts && cd /tmp/fonts && npm init -y && npm
// install @fontsource/vt323 @fontsource/noto-sans @fontsource/noto-sans-jp @fontsource/noto-sans-sc
// @fontsource/noto-sans-kr
//  node tools/make-fonts.cjs /tmp/fonts [OUT] (the folder that has node_modules/@fontsource/; OUT
// or TOTR_FONTS_DIR is the server's static/fonts, default ./fonts-out)
// The default is this app's own node_modules, which has @fontsource/vt323 only (enough to redo just
// the terminal font). The result is committed (static/fonts/), so nobody needs to run this unless
// the font list changes. All of these fonts are SIL Open Font License; each package's LICENSE is
// copied to static/fonts/licenses/.
const fs = require('fs'),
  path = require('path');
const from = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const out = path.resolve(
  process.argv[3] || process.env.TOTR_FONTS_DIR || path.join(__dirname, '..', 'fonts-out'),
);
const FAMILIES = [
  { pkg: 'vt323', family: 'VT323' },
  { pkg: 'noto-sans', family: 'TOTR Sans' },
  { pkg: 'noto-sans-jp', family: 'TOTR JP' },
  { pkg: 'noto-sans-sc', family: 'TOTR SC' },
  { pkg: 'noto-sans-kr', family: 'TOTR KR' },
];

const blocks = [];
let files = 0,
  bytes = 0;
fs.mkdirSync(path.join(out, 'files'), { recursive: true });
fs.mkdirSync(path.join(out, 'licenses'), { recursive: true });
for (const { pkg, family } of FAMILIES) {
  const dir = path.join(from, 'node_modules', '@fontsource', pkg);
  if (!fs.existsSync(path.join(dir, '400.css'))) {
    console.log(`skipped ${pkg}: not installed in ${from}`);
    continue;
  }
  const css = fs.readFileSync(path.join(dir, '400.css'), 'utf8');
  const found = css.match(/@font-face\s*{[^}]*}/g) || [];
  blocks.push(`/* ${family} (${pkg}): ${found.length} piece${found.length === 1 ? '' : 's'} */`);
  for (const b of found) {
    const m = /url\(\.\/files\/([\w.-]+\.woff2)\)/.exec(b),
      range = /unicode-range:\s*([^;]+);/.exec(b);
    if (!m || !range) throw new Error(`unexpected @font-face in ${pkg}/400.css`);
    const dest = path.join(out, 'files', m[1]);
    fs.copyFileSync(path.join(dir, 'files', m[1]), dest);
    files++;
    bytes += fs.statSync(dest).size;
    blocks.push(
      `@font-face { font-family: '${family}'; font-style: normal; font-weight: 400; font-display: swap; src: url(files/${m[1]}) format('woff2'); unicode-range: ${range[1].trim()}; }`,
    );
  }
  const lic = path.join(dir, 'LICENSE');
  if (fs.existsSync(lic)) fs.copyFileSync(lic, path.join(out, 'licenses', `${pkg}-LICENSE.txt`));
}
if (!blocks.length) {
  console.error('Nothing written: no @fontsource packages found in ' + from);
  process.exit(1);
}
fs.writeFileSync(
  path.join(out, 'fonts.css'),
  `/* Written by TOTRspa/TOTRspa_web/tools/make-fonts.cjs. Do not edit by hand. Fonts are SIL Open Font License (see licenses/). Only the pieces a page's text needs are downloaded. */\n${blocks.join('\n')}\n`,
);
console.log(
  `${files} font files (${(bytes / 1048576).toFixed(1)} MB) and fonts.css written to ${out}`,
);
