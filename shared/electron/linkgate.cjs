// When may a page make the shell open the person's own browser? Only just after the person really
// clicked or pressed a key in the window, and once per click. Without this a page of any server
// could open any web address in the person's browser at will: dozens of tabs a second, or a look-
// alike login page that appears by itself. Electron does not say whether a window.open or a link
// was a user's doing, so the shell watches the real input events instead (a page cannot fake those:
// its own script-made clicks never reach the main process). Pure: it takes a clock, so it is tested
// without Electron (tests/linkgate.test.cjs).
const REAL_INPUT = new Set([
  'mouseDown',
  'mouseUp',
  'keyDown',
  'rawKeyDown',
  'touchStart',
  'touchEnd',
  'gestureTap',
]); // moving or scrolling is not a decision

function create({ now = Date.now, windowMs = 1500 } = {}) {
  let last = -Infinity;
  return {
    // a real input event reached the window
    input(type) {
      if (typeof type === 'string' && REAL_INPUT.has(type)) last = now();
    },
    // may an http(s) address be opened in the browser now? Using it up: the next one needs another
    // click.
    take(url) {
      if (typeof url !== 'string' || !/^https?:/i.test(url)) return false;
      if (now() - last > windowMs) return false;
      last = -Infinity;
      return true;
    },
  };
}

module.exports = { create, REAL_INPUT };
