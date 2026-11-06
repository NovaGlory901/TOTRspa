// When a page may make the shell open the person's browser (electron/linkgate.cjs). Run: node
// tests/linkgate.test.cjs
const assert = require('node:assert');
const linkgate = require('../electron/linkgate.cjs');
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
const U = 'https://example.org/x';
const gate = () => {
  const clock = { t: 1000 };
  return { clock, g: linkgate.create({ now: () => clock.t, windowMs: 1500 }) };
};

check('nothing opens without a real input', () => {
  const { g } = gate();
  assert.strictEqual(g.take(U), false);
});
check('a click opens one link, and the next needs another click', () => {
  const { g } = gate();
  g.input('mouseUp');
  assert.strictEqual(g.take(U), true);
  assert.strictEqual(g.take(U), false);
});
check('the click is only good for a moment', () => {
  const { clock, g } = gate();
  g.input('mouseDown');
  clock.t += 1501;
  assert.strictEqual(g.take(U), false);
  g.input('mouseDown');
  clock.t += 1500;
  assert.strictEqual(g.take(U), true);
});
check('key presses and taps count; moving and scrolling do not', () => {
  for (const type of [
    'keyDown',
    'rawKeyDown',
    'touchStart',
    'touchEnd',
    'gestureTap',
    'mouseDown',
    'mouseUp',
  ]) {
    const { g } = gate();
    g.input(type);
    assert.strictEqual(g.take(U), true, type);
  }
  for (const type of [
    'mouseMove',
    'mouseWheel',
    'keyUp',
    'mouseEnter',
    'mouseLeave',
    '',
    undefined,
    null,
    5,
    {},
  ]) {
    const { g } = gate();
    g.input(type);
    assert.strictEqual(g.take(U), false, String(type));
  }
});
check('only web addresses are ever handed over, even after a click', () => {
  for (const u of [
    'javascript:alert(1)',
    'file:///etc/passwd',
    'data:text/html,x',
    'ftp://x/',
    'totr://x',
    '',
    undefined,
    null,
    5,
    {},
    ['https://x'],
  ]) {
    const { g } = gate();
    g.input('mouseUp');
    assert.strictEqual(g.take(u), false, String(u));
  }
  const { g } = gate();
  g.input('mouseUp');
  assert.strictEqual(g.take('http://10.0.0.1/'), true);
});
check('a refused address does not use up the click', () => {
  const { g } = gate();
  g.input('mouseUp');
  assert.strictEqual(g.take('javascript:x'), false);
  assert.strictEqual(g.take(U), true);
});
check('a hundred script calls after one click still open one link', () => {
  const { g } = gate();
  g.input('mouseUp');
  let n = 0;
  for (let i = 0; i < 100; i++) if (g.take(U)) n++;
  assert.strictEqual(n, 1);
});
console.log(bad ? `\nFAILED (${bad} failing)` : '\nALL PASSED');
process.exit(bad ? 1 : 0);
