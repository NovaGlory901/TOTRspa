// The saved-servers list (electron/servers.cjs). Run: node tests/servers.test.cjs
const assert = require('node:assert');
const S = require('../electron/servers.cjs');
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
const A = 'https://10.0.0.60:8443',
  B = 'https://totr.example';
check('the server in use is listed first even if never saved', () =>
  assert.deepStrictEqual(S.list({}, A), [{ name: '', origin: A }]),
);
check('the saved name of the server in use is kept', () =>
  assert.deepStrictEqual(S.list({ servers: [{ name: 'Home', origin: A }] }, A), [
    { name: 'Home', origin: A },
  ]),
);
check('junk and repeats are dropped', () =>
  assert.deepStrictEqual(
    S.list(
      {
        servers: [
          null,
          5,
          { origin: 'nope://x' },
          { name: 'a', origin: B },
          { name: 'b', origin: B + '/' },
        ],
      },
      A,
    ).map(s => s.origin),
    [A, B],
  ),
);
check('add keeps the name (trimmed, 40 characters) and normalises the address', () => {
  const r = S.add({}, '  ' + 'x'.repeat(50) + ' ', 'totr.example:443/app/', A);
  assert.ok(!r.error, r.error);
  assert.strictEqual(r.config.servers[1].origin, 'http://totr.example:443');
  assert.strictEqual(r.config.servers[1].name.length, 40);
});
check('add refuses a repeat and nonsense', () => {
  assert.ok(S.add({}, '', A, A).error);
  assert.ok(S.add({}, '', 'file:///x', A).error);
});
check('add keeps other config keys', () =>
  assert.strictEqual(S.add({ other: 1 }, 'B', B, A).config.other, 1),
);
check('remove drops one, but not the server in use', () => {
  const cfg = S.add({}, 'B', B, A).config;
  assert.deepStrictEqual(
    S.remove(cfg, B, A).config.servers.map(s => s.origin),
    [A],
  );
  assert.ok(S.remove(cfg, A, A).error);
});
check('use switches the server and remembers an unsaved one', () => {
  const r = S.use({}, B, A);
  assert.strictEqual(r.config.server, B);
  assert.deepStrictEqual(
    r.config.servers.map(s => s.origin),
    [A, B],
  );
  assert.ok(S.use({}, 'x://y', A).error);
});
check('the list stops growing at 30', () => {
  let cfg = {};
  for (let i = 0; i < 40; i++) {
    const r = S.add(cfg, '', `https://h${i}.example`, A);
    if (r.config) cfg = r.config;
  }
  assert.strictEqual(S.list(cfg, A).length, 30);
});
console.log(bad ? `\nFAILED (${bad} failing)` : '\nALL PASSED');
process.exit(bad ? 1 : 0);
