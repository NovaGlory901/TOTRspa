// Which pages may navigate the window and press the shell's buttons (electron/guard.cjs). Run: node
// tests/guard.test.cjs
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const G = require('../electron/guard.cjs');
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

const O = 'https://10.0.0.60:8443';
check('pages of the server are the app', () => {
  for (const u of [O + '/app/', O + '/app/#/you', O + '/download', O + '/', O + '/app/?u=1'])
    assert.ok(G.isAppPage(u, O), u);
});
check('look-alike addresses are not the app', () => {
  for (const u of [
    O + '.evil.example/app/',
    'https://10.0.0.60:84430/',
    'https://10.0.0.60:8444/',
    'http://10.0.0.60:8443/',
    'https://10.0.0.234:8443/',
    'https://10.0.0.60:8443@evil.example/',
    'https://evil.example@10.0.0.60:8443/',
    'https://user:pw@10.0.0.60:8443/',
    'https://evil.example/https://10.0.0.60:8443/',
    'https://box.local.evil.example/',
  ])
    assert.ok(!G.isAppPage(u, O), u);
});
check('named servers work the same way', () => {
  assert.ok(G.isAppPage('https://box.local/app/', 'https://box.local'));
  assert.ok(!G.isAppPage('https://box.local.evil.example/', 'https://box.local'));
});
check('other schemes and junk are not the app', () => {
  for (const u of [
    'javascript:alert(1)',
    'data:text/html,hi',
    'file:///etc/passwd',
    'blob:https://10.0.0.60:8443/x',
    '',
    undefined,
    null,
    'not a url',
    5,
  ])
    assert.ok(!G.isAppPage(u, O), String(u));
});
check('the dev server address works as the app', () =>
  assert.ok(
    G.isAppPage('http://localhost:5173/', 'http://localhost:5173') &&
      !G.isAppPage('http://localhost:5174/', 'http://localhost:5173'),
  ),
);

const offline = path.join(__dirname, '..', 'electron', 'offline.html');
const off = pathToFileURL(offline).href;
check('the offline page is recognised, with a query or fragment', () => {
  for (const u of [off, off + '?server=https%3A%2F%2Fx', off + '#a'])
    assert.ok(G.isOfflinePage(u, offline), u);
});
check('other files and look-alikes are not the offline page', () => {
  for (const u of [
    pathToFileURL(path.join(path.dirname(offline), 'other.html')).href,
    pathToFileURL(offline + '.evil.html').href,
    'file:///etc/passwd',
    O + '/',
    'https://evil.example/' + off,
    pathToFileURL(
      path.join(path.dirname(offline), '..', 'electron', '..', 'electron', 'offline.js'),
    ).href,
  ])
    assert.ok(!G.isOfflinePage(u, offline), u);
});
check('on Windows the offline page is found whatever the letter case of the path', () =>
  assert.ok(
    G.isOfflinePage(
      'file:///C:/Program%20Files/totr/electron/OFFLINE.HTML',
      'C:\\Program Files\\totr\\electron\\offline.html',
      'win32',
    ) || process.platform !== 'win32',
  ),
);
check('navigation: the app and the offline page only', () => {
  assert.ok(
    G.navigationAllowed(O + '/app/#/you', O, offline) &&
      G.navigationAllowed(off + '?server=x', O, offline),
  );
  assert.ok(
    !G.navigationAllowed('https://evil.example/', O, offline) &&
      !G.navigationAllowed(O + '.evil.example/', O, offline) &&
      !G.navigationAllowed('file:///etc/passwd', O, offline),
  );
});

const frame = url => ({ url });
const ev = (url, sub) => {
  const main = frame(url);
  return { senderFrame: sub ? frame(url) : main, sender: { mainFrame: main } };
};
check("a message from the app's main frame counts", () =>
  assert.ok(G.fromAppFrame(ev(O + '/app/'), O)),
);
check(
  'a message from a sub-frame of the app does not (an embedded page cannot press the buttons)',
  () => assert.ok(!G.fromAppFrame(ev(O + '/app/', true), O)),
);
check('a message from another site, or from nowhere, does not', () => {
  assert.ok(!G.fromAppFrame(ev('https://evil.example/'), O));
  assert.ok(
    !G.fromAppFrame({}, O) &&
      !G.fromAppFrame(null, O) &&
      !G.fromAppFrame({ senderFrame: null, sender: {} }, O),
  );
});
check(
  'the offline page counts for the few buttons it needs, and the app page is not the offline page',
  () => {
    assert.ok(G.fromOfflineFrame(ev(off + '?server=x'), offline));
    assert.ok(
      !G.fromOfflineFrame(ev(O + '/app/'), offline) &&
        !G.fromAppFrame(ev(off), O) &&
        !G.fromOfflineFrame(ev(off, true), offline),
    );
  },
);
console.log(bad ? `\nFAILED (${bad} failing)` : '\nALL PASSED');
process.exit(bad ? 1 : 0);
