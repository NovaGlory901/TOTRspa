// The DejaVuAmp and FalseHorizons scripts in vendor/js are copies (the originals live with those
// programs). The lock file written by tools/sync-vendor.cjs says what each copy must contain. Run:
// node tests/vendor.test.cjs
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
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
const sha = file =>
  crypto
    .createHash('sha256')
    .update(Buffer.from(fs.readFileSync(file).toString('latin1').replace(/\r\n/g, '\n'), 'latin1'))
    .digest('hex');

const dir = path.join(__dirname, '..', 'vendor');
let files = {};
check('the lock file exists and lists the scripts', () => {
  files = JSON.parse(fs.readFileSync(path.join(dir, 'vendor.lock.json'), 'utf8')).files;
  assert.ok(
    Object.keys(files).length >= 11 && files['falsehorizon-core.js'] && files['dejavuamp.js'],
  );
});
for (const [name, info] of Object.entries(files)) {
  check(
    `vendor/js/${name} is the copy the lock file describes (change it at ${info.from}, then run tools/sync-vendor.cjs)`,
    () => {
      const file = path.join(dir, 'js', name);
      assert.ok(fs.existsSync(file), 'missing');
      assert.strictEqual(sha(file), info.sha256, 'differs');
    },
  );
}
console.log(bad ? `\nFAILED (${bad} failing)` : '\nALL PASSED');
process.exitCode = bad ? 1 : 0;
