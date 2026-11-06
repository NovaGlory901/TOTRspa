// Is this app update really from the developer? The update files the apps read (latest.yml, latest-
// linux.yml) are signed with the developer's Ed25519 key; the matching public key ships INSIDE the
// app (update_pubkey.txt), so a server the person added cannot hand out its own "update": whichever
// server the app is on, only the developer's signature counts. The signed yml names the installer's
// SHA-512, and the finished download is hashed against it before it may be installed. Pure
// functions plus two small file helpers; main.cjs does the network. The same key and file format as
// the server's update_pubkey.txt (TOTRsrv/updates/signing.py).
const crypto = require('node:crypto');
const fs = require('node:fs');

// the developer's tool signs PREFIX + the file, so a server-release signature can never pass as an
// app one
const PREFIX = Buffer.from('totr-app-update\n');
const MAX_YML = 64 * 1024;
const SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex');

// update_pubkey.txt: a line `ed25519 <base64 of 32 bytes> [comment]`; blank lines and # comments
// ignored. -> Buffer, or null when there is no key.
function parsePubkey(text) {
  for (let line of String(text || '').split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    if (parts[0] !== 'ed25519' || parts.length < 2 || !/^[A-Za-z0-9+/]{43}=$/.test(parts[1]))
      return null;
    return Buffer.from(parts[1], 'base64');
  }
  return null;
}

function verify(ymlBytes, signatureB64, pubkey) {
  if (!pubkey || pubkey.length !== 32) return false;
  if (!Buffer.isBuffer(ymlBytes) || !ymlBytes.length || ymlBytes.length > MAX_YML) return false;
  const text = String(signatureB64 || '').trim();
  if (!/^[A-Za-z0-9+/]{86}==$/.test(text)) return false;
  try {
    const key = crypto.createPublicKey({
      key: Buffer.concat([SPKI_ED25519, pubkey]),
      format: 'der',
      type: 'spki',
    });
    return crypto.verify(null, Buffer.concat([PREFIX, ymlBytes]), key, Buffer.from(text, 'base64'));
  } catch {
    return false;
  }
}

// What a verified electron-builder yml says: { version, files: [{ url, sha512 }] } (sha512 is
// base64). Only the few plain lines it needs; anything odd gives null.
function parseYml(ymlBytes) {
  const lines = ymlBytes.toString('utf8').split(/\r?\n/);
  const version = (lines
    .map(l => /^version:\s*['"]?(\d{1,4}\.\d{1,4}\.\d{1,4})['"]?\s*$/.exec(l))
    .find(Boolean) || [])[1];
  const files = [];
  let cur = null;
  for (const l of lines) {
    let m;
    if ((m = /^\s*-\s+url:\s*(\S+)\s*$/.exec(l))) {
      cur = { url: m[1].replace(/^['"]|['"]$/g, '') };
      files.push(cur);
    } else if (cur && (m = /^\s+sha512:\s*(\S+)\s*$/.exec(l)))
      cur.sha512 = m[1].replace(/^['"]|['"]$/g, '');
    else if (/^\S/.test(l)) cur = null;
  }
  if (
    !version ||
    !files.length ||
    files.some(f => !f.url || !/^[A-Za-z0-9+/]{86}==$/.test(f.sha512 || ''))
  )
    return null;
  return { version, files };
}

const newer = (a, b) => {
  const x = a.split('.').map(Number),
    y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};

function sha512OfFile(file) {
  const h = crypto.createHash('sha512'),
    fd = fs.openSync(file, 'r'),
    buf = Buffer.alloc(1 << 20);
  try {
    for (let n; (n = fs.readSync(fd, buf, 0, buf.length, null)) > 0; ) h.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return h.digest('base64');
}

// Does the finished download match what the developer signed? `signed` is parseYml's result.
function downloadMatches(signed, file) {
  try {
    const got = sha512OfFile(file);
    return signed.files.some(f => f.sha512 === got);
  } catch {
    return false;
  }
}

module.exports = { PREFIX, parsePubkey, verify, parseYml, newer, sha512OfFile, downloadMatches };
