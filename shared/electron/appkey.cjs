// The developer's public key for signed app updates, shipped inside the app (update_pubkey.txt next
// to this file; same one-line format as the server's). Kept in its own file so tests can stand in
// for it. No key = the app never installs an update (it could not tell a real one from a fake one).
const fs = require('node:fs');
const path = require('node:path');
const appsig = require('./appsig.cjs');
module.exports = {
  pubkey: () => {
    try {
      return appsig.parsePubkey(fs.readFileSync(path.join(__dirname, 'update_pubkey.txt'), 'utf8'));
    } catch {
      return null;
    }
  },
};
