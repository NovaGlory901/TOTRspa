// Trust for TOTR's own certificate authority (electron/totr-ca.pem, put there by shared/tools/sync-
// ca.cjs), so https://<server>:8443 works with no setup on the computer. The system's usual
// authorities are still trusted for anything else. A certificate that the system does not accept is
// accepted here only if ALL of these hold: it was signed by the TOTR authority, it is within its
// dates, it is for the very address being visited, and that address is a private network one (10.x,
// 192.168.x, 172.16-31.x, or a name ending .local / .lan: the same limits the authority is made
// with).
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const pins = require('./pins.cjs');

function loadCa() {
  try {
    return new crypto.X509Certificate(fs.readFileSync(path.join(__dirname, 'totr-ca.pem')));
  } catch {
    return null;
  }
}

function privateName(host) {
  if (net.isIPv4(host)) {
    const [a, b] = host.split('.').map(Number);
    return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
  }
  return /\.(local|lan)$/i.test(host);
}

// true when `pem` (the server's certificate) should be trusted for `host`
function acceptedByTotrCa(ca, pem, host, now = Date.now()) {
  try {
    const leaf = new crypto.X509Certificate(pem);
    const inDates = c => Date.parse(c.validFrom) <= now && now <= Date.parse(c.validTo);
    const forHost = net.isIP(host) ? !!leaf.checkIP(host) : !!leaf.checkHost(host);
    return (
      inDates(ca) &&
      inDates(leaf) &&
      leaf.checkIssued(ca) &&
      leaf.verify(ca.publicKey) &&
      forHost &&
      privateName(host)
    );
  } catch {
    return false;
  }
}

function caPemText() {
  try {
    return fs.readFileSync(path.join(__dirname, 'totr-ca.pem'), 'utf8');
  } catch {
    return null;
  }
}

// Also accepted: a server the person chose to trust by checking its fingerprint
// (electron/pins.cjs). `pinsFor(host)` gives the authorities pinned for that host name;
// `onRefused(host, hadPin)` hears about every certificate turned away, so the shell can say "this
// server's certificate changed" when there was a pin.
function install(session, { pinsFor = () => [], onRefused = () => {} } = {}) {
  const ca = loadCa();
  session.setCertificateVerifyProc((request, callback) => {
    if (request.verificationResult === 'net::OK') return callback(0); // trusted the normal way
    const cert = request.certificate.data,
      host = request.hostname;
    if (ca && acceptedByTotrCa(ca, cert, host)) return callback(0);
    const pinned = pinsFor(host);
    if (pinned.some(pem => pins.acceptedByPin(pem, cert, host))) return callback(0);
    onRefused(host, pinned.length > 0);
    callback(-2);
  });
  return true;
}

module.exports = { install, acceptedByTotrCa, loadCa, caPemText, privateName };
