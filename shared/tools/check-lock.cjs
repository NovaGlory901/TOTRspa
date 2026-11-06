// Is a folder of synced files still what its lock file says? Run from a shell folder: node
// ../shared/tools/check-lock.cjs <lock file> <folder>
// (tools/sync-vendor.cjs writes the lock files and the copies; this lets the shell test for drift
// on its own, without the source beside it.)
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const [lockFile, folder] = process.argv.slice(2);
if (!lockFile || !folder) {
  console.error('usage: check-lock.cjs <lock file> <folder>');
  process.exit(2);
}
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
let files = {};
check(`${lockFile} exists and lists files`, () => {
  files = JSON.parse(fs.readFileSync(lockFile, 'utf8')).files;
  assert.ok(Object.keys(files).length > 0, 'empty');
});
for (const [name, info] of Object.entries(files)) {
  check(
    `${folder}/${name} is the copy the lock file describes (change it at ${info.from}, then run tools/sync-vendor.cjs)`,
    () => {
      const file = path.join(folder, name);
      assert.ok(fs.existsSync(file), 'missing');
      assert.strictEqual(sha(file), info.sha256, 'differs');
    },
  );
}
console.log(bad ? `\nFAILED (${bad} failing)` : '\nALL PASSED');
process.exit(bad ? 1 : 0);
