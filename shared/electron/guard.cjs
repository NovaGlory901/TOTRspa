// Which pages may do what in the desktop shell. The shell shows two kinds of page: the app (served
// by the TOTR server, an http(s) address) and its own offline page (a file inside the app).
// Anything else is a stranger: it may not navigate the window, and may not press the shell's
// buttons (switch servers, install an update, open a program). Pure functions, so they are tested
// without Electron (tests/guard.test.cjs).
const path = require('node:path');
const { fileURLToPath } = require('node:url');

// Is `url` a page of the server whose origin is `serverOrigin` (scheme + host + port, exactly)? A
// prefix test is not enough: "https://totr.example:8443.evil.example/" starts with
// "https://totr.example:8443".
function isAppPage(url, serverOrigin) {
  try {
    const u = new URL(String(url));
    return (
      (u.protocol === 'http:' || u.protocol === 'https:') &&
      !u.username &&
      !u.password &&
      u.origin === serverOrigin
    );
  } catch {
    return false;
  }
}

// Is `url` the shell's own offline page (the file `offlinePath`, with or without a query or
// fragment)?
function isOfflinePage(url, offlinePath, platform = process.platform) {
  try {
    const u = new URL(String(url));
    if (u.protocol !== 'file:') return false;
    const a = path.resolve(fileURLToPath(u)),
      b = path.resolve(offlinePath);
    return platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  } catch {
    return false;
  }
}

// May the window navigate to `url`? Only inside the app, or to the offline page. (Other web links
// are opened in the person's browser by the caller.)
const navigationAllowed = (url, serverOrigin, offlinePath, platform) =>
  isAppPage(url, serverOrigin) || isOfflinePage(url, offlinePath, platform);

// May a message from this frame press the shell's buttons? Only from the main frame of the app, or
// (for the few things the offline page needs) of the offline page. `e` is the IPC event: {
// senderFrame, sender }.
const isMainFrame = e =>
  !!e && !!e.senderFrame && !!e.sender && e.senderFrame === e.sender.mainFrame;
const fromAppFrame = (e, serverOrigin) =>
  isMainFrame(e) && isAppPage(e.senderFrame.url, serverOrigin);
const fromOfflineFrame = (e, offlinePath, platform) =>
  isMainFrame(e) && isOfflinePage(e.senderFrame.url, offlinePath, platform);

module.exports = { isAppPage, isOfflinePage, navigationAllowed, fromAppFrame, fromOfflineFrame };
