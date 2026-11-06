// Which browser permissions a page in the shell gets (electron/permissions.cjs). Run: node
// tests/permissions.test.cjs
const assert = require('node:assert');
const permissions = require('../electron/permissions.cjs');
let bad = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log('ok  ' + name);
  } catch (e) {
    bad++;
    console.log('BAD ' + name + '   <- ' + e.message);
  }
};

check('only copying to the clipboard and full screen are allowed', () => {
  assert.deepStrictEqual([...permissions.ALLOWED].sort(), [
    'clipboard-sanitized-write',
    'fullscreen',
  ]);
  assert.ok(permissions.allow('fullscreen') && permissions.allow('clipboard-sanitized-write'));
});
check('everything else is refused, including look-alikes and non-text', () => {
  for (const p of [
    'clipboard-read',
    'media',
    'geolocation',
    'notifications',
    'midi',
    'midiSysex',
    'display-capture',
    'openExternal',
    'idle-detection',
    'Fullscreen',
    'fullscreen ',
    'clipboard-sanitized-write2',
    '',
    'unknown',
    undefined,
    null,
    5,
    {},
    ['fullscreen'],
  ])
    assert.strictEqual(permissions.allow(p), false, String(p));
});
check('the list cannot be changed from outside', () => {
  assert.throws(() => {
    'use strict';
    permissions.ALLOWED.push('media');
  });
  assert.strictEqual(permissions.allow('media'), false);
});
check('install puts a request, a check and a device handler on the session', () => {
  const s = {};
  let answered;
  permissions.install({
    setPermissionRequestHandler: f => {
      s.request = f;
    },
    setPermissionCheckHandler: f => {
      s.check = f;
    },
    setDevicePermissionHandler: f => {
      s.device = f;
    },
  });
  s.request({}, 'media', v => {
    answered = v;
  });
  assert.strictEqual(answered, false);
  s.request({}, 'fullscreen', v => {
    answered = v;
  });
  assert.strictEqual(answered, true);
  assert.strictEqual(s.check({}, 'clipboard-read'), false);
  assert.strictEqual(s.device({}), false);
});
check('an older Electron without a device handler still installs', () => {
  assert.doesNotThrow(() =>
    permissions.install({ setPermissionRequestHandler() {}, setPermissionCheckHandler() {} }),
  );
});
console.log(bad ? `\nFAILED (${bad} failing)` : '\nALL PASSED');
process.exit(bad ? 1 : 0);
