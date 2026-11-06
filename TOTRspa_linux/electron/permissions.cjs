// Which browser permissions a page in the shell may have. Electron grants every one of them to
// every page unless told otherwise: without this a page of any server (a friend's included) could
// read the clipboard, listen on the microphone, use the camera or MIDI devices and show
// notifications, with no question asked. TOTR's own pages use only
// two: copying an invite link (clipboard-sanitized-write, which still needs a click on the page)
// and the radio's full screen. Everything else is refused.
// Pure data plus one function that takes the session, so it is tested without Electron
// (tests/permissions.test.cjs).
const ALLOWED = Object.freeze(['clipboard-sanitized-write', 'fullscreen']);

const allow = permission => typeof permission === 'string' && ALLOWED.includes(permission);

function install(session) {
  session.setPermissionRequestHandler((_webContents, permission, callback) =>
    callback(allow(permission)),
  ); // asked for: yes or no, never a question to the person
  // "may I?" queries (permissions.query, clipboard-read checks)
  session.setPermissionCheckHandler((_webContents, permission) => allow(permission));
  // USB, serial, HID and Bluetooth pickers
  if (session.setDevicePermissionHandler) session.setDevicePermissionHandler(() => false);
}

module.exports = { ALLOWED, allow, install };
