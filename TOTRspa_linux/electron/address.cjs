// Turns what a person typed into the server's address (scheme://host:port, nothing after it). Used
// by the saved-servers list (servers.cjs).
function parseServer(text) {
  let v = String(text || '').trim();
  if (!v) return { error: 'Type the server address.' };
  // "totr.example:8080" means http://totr.example:8080
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) v = 'http://' + v;
  let u;
  try {
    u = new URL(v);
  } catch {
    return { error: 'That is not a web address.' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:')
    return { error: 'Use an http:// or https:// address.' };
  if (!u.hostname) return { error: 'That address has no host name.' };
  return { origin: u.origin };
}
module.exports = { parseServer };
