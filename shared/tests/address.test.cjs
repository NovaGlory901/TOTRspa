// The "Change server" window's address check (electron/address.cjs). Run: node
// tests/address.test.cjs
const assert = require('node:assert');
const { parseServer } = require('../electron/address.cjs');
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
check('https address with port', () =>
  assert.deepStrictEqual(parseServer('https://10.0.0.60:8443'), {
    origin: 'https://10.0.0.60:8443',
  }),
);
check('spaces, a trailing slash and a path are dropped', () =>
  assert.deepStrictEqual(parseServer('  http://box.local:8080/app/  '), {
    origin: 'http://box.local:8080',
  }),
);
check('no scheme means http', () =>
  assert.deepStrictEqual(parseServer('10.0.0.60:8080'), { origin: 'http://10.0.0.60:8080' }),
);
check('the default port is left out', () =>
  assert.deepStrictEqual(parseServer('https://totr.example:443/'), {
    origin: 'https://totr.example',
  }),
);
check('empty is refused', () => assert.ok(parseServer('   ').error));
check('other schemes are refused', () => {
  for (const v of ['file:///etc/passwd', 'javascript:alert(1)', 'ftp://x.example'])
    assert.ok(parseServer(v).error, v);
});
check('nonsense is refused', () => assert.ok(parseServer('http://').error));
console.log(bad ? `\nFAILED (${bad} failing)` : '\nALL PASSED');
process.exit(bad ? 1 : 0);
