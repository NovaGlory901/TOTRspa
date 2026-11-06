// Puts TOTR's certificate authority (the PUBLIC part, certs/totr-ca.pem made by
// TOTRsrv/tools/make_certs.py) into the app in the folder it is run from, so the app trusts the
// server's HTTPS certificate without any setup on the device. Run it from a shell folder (npm does,
// before every build):
//  TOTRspa_win, TOTRspa_linux -> electron/totr-ca.pem (see electron/trust.cjs)
//  TOTRspa_apk -> android/app/src/main/res/raw/totr_ca.pem and res/xml/network_security_config.xml,
// which says to trust it
// With no CA yet it still works: the Android config then trusts only the phone's own authorities
// and the Electron app has nothing extra to trust. The Android app never uses plain http (an http
// server address shows NO SIGNAL); the desktop app still allows it. The files it writes are public,
// so they are committed. TOTR_CERTS_DIR overrides where totr-ca.pem is read from (used by tests).
const fs = require('fs'),
  path = require('path');
const root = process.cwd(); // the shell folder it is run from
const src = path.join(
  process.env.TOTR_CERTS_DIR || path.join(__dirname, '..', '..', '..', 'TOTRsrv', 'certs'),
  'totr-ca.pem',
);
const isElectron = fs.existsSync(path.join(root, 'electron')),
  isAndroid = fs.existsSync(path.join(root, 'android'));
if (!isElectron && !isAndroid) {
  console.error(
    'sync-ca: run it from a shell folder (TOTRspa_win, TOTRspa_linux or TOTRspa_apk); this one has no electron/ or android/.',
  );
  process.exit(1);
}
const electronCopy = path.join(root, 'electron', 'totr-ca.pem');
const res = path.join(root, 'android', 'app', 'src', 'main', 'res');
const rawCopy = path.join(res, 'raw', 'totr_ca.pem');
const nsc = path.join(res, 'xml', 'network_security_config.xml');

const have = fs.existsSync(src);
if (have) {
  const pem = fs.readFileSync(src, 'utf8');
  if (!/^-----BEGIN CERTIFICATE-----/.test(pem) || /PRIVATE KEY/.test(pem)) {
    console.error(
      src + ' is not a public certificate. Refusing (nothing private goes into an app).',
    );
    process.exit(1);
  }
  if (isElectron) fs.writeFileSync(electronCopy, pem);
  if (isAndroid) {
    fs.mkdirSync(path.dirname(rawCopy), { recursive: true });
    fs.writeFileSync(rawCopy, pem);
  }
} else {
  if (isElectron) fs.rmSync(electronCopy, { force: true });
  if (isAndroid) fs.rmSync(rawCopy, { force: true });
}
if (isAndroid) {
  fs.mkdirSync(path.dirname(nsc), { recursive: true });
  fs.writeFileSync(
    nsc,
    `<?xml version="1.0" encoding="utf-8"?>
<!-- Written by shared/tools/sync-ca.cjs. Which certificate authorities the app trusts for network connections (the pages it opens, the update download,
     saved mixtapes). Plain http is refused: the server must be reached over https. -->
<network-security-config>
    <base-config cleartextTrafficPermitted="false">
        <trust-anchors>
            <certificates src="system" />${have ? '\n            <certificates src="@raw/totr_ca" />' : ''}
        </trust-anchors>
    </base-config>
</network-security-config>
`,
  );
}
console.log(
  have
    ? `TOTR's certificate authority is built into the app (from ${src}).`
    : 'No certificate authority yet (TOTRsrv/certs/totr-ca.pem): the app trusts only the usual ones. See docs/setup.md, "HTTPS".',
);
