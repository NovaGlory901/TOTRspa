// A sentence a person can act on for the errors the operating system and the network throw, without
// file paths or error codes. Pure.
function plainError(err) {
  const code = String((err && err.code) || ''),
    text = String((err && err.message) || err || '');
  const has = re => re.test(code) || re.test(text);
  if (has(/ENOSPC/)) return 'The disk is full. Free some space and try again.';
  if (has(/EACCES|EPERM|EROFS/))
    return 'The app is not allowed to write there (the folder is read-only, or this account has no permission).';
  if (has(/ENOENT/)) return 'A folder or file the app needs is missing.';
  if (
    has(/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|net::ERR_/)
  )
    return 'The server could not be reached. Check the network and that the server is on.';
  return 'Something unexpected went wrong.';
}
module.exports = { plainError };
