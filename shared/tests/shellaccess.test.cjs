// Which servers may use the shell's controls (electron/shellaccess.cjs). Run: node
// tests/shellaccess.test.cjs
const assert = require('node:assert');
const X = require('../electron/shellaccess.cjs');
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
  B = 'https://totr.example',
  C = 'http://192.168.1.5:8080';
check('nobody has the controls until given', () => {
  assert.ok(!X.has({}, A));
  assert.ok(!X.has({ access: [] }, A));
});
check('give and take back', () => {
  const c = X.grant({ server: A }, B);
  assert.ok(X.has(c, B));
  assert.ok(!X.has(c, A));
  assert.strictEqual(c.server, A);
  assert.ok(!X.has(X.revoke(c, B), B));
});
check('giving twice lists the server once', () =>
  assert.deepStrictEqual(X.grant(X.grant({}, A), A).access, [A]),
);
check('junk in the list gives nothing', () => {
  const c = { access: [null, 5, 'evil', 'https://totr.example/', { origin: A }, B] };
  assert.ok(!X.has(c, 'evil'));
  assert.ok(!X.has(c, A));
  assert.ok(X.has(c, B));
  assert.deepStrictEqual(X.grant(c, C).access, [B, C]);
});
check('a list that is not a list gives nothing', () => {
  assert.ok(!X.has({ access: A }, A));
  assert.ok(!X.has({ access: { [A]: true } }, A));
  assert.ok(!X.has(null, A));
});
check('an install from before keeps the controls for the servers it knew, once', () => {
  const c = {
    server: A,
    servers: [
      { name: 'Home', origin: A },
      { name: 'Friend', origin: B },
    ],
  };
  const r = X.inherit(c, A);
  assert.deepStrictEqual(r.access, [A, B]);
  assert.strictEqual(r.server, A);
  assert.strictEqual(X.inherit(r, A), null, 'it asked again after it was decided');
  assert.strictEqual(X.inherit({ access: [] }, A), null, 'an empty list is a decision too');
});
check('a first run knows no servers and so gives nothing', () =>
  assert.strictEqual(X.inherit({}, ''), null),
);
check('the list has a ceiling', () => {
  let c = {};
  for (let i = 0; i < 80; i++) c = X.grant(c, `https://h${i}.example`);
  assert.ok(c.access.length <= 50);
});
if (bad) {
  console.log(`\nFAILED (${bad})`);
  process.exit(1);
}
console.log('\nALL PASSED');
