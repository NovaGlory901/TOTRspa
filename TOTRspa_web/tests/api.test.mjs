// What a person reads when a request fails (src/api.js): never the browser's own "Failed to fetch",
// and never a bare status. Run: node tests/api.test.mjs
import assert from 'node:assert';
import { api, ApiError, failureText } from '../src/api.js';
let bad = 0;
const check = async (name, fn) => {
  try {
    await fn();
    console.log('ok  ' + name);
  } catch (e) {
    bad++;
    console.log('BAD ' + name + '   <- ' + e.message);
  }
};
const answer = (status, body) => {
  globalThis.fetch = async () => ({
    ok: status < 400,
    status,
    json: async () => {
      if (body === undefined) throw new Error('not json');
      return body;
    },
  });
};
const fails = async () => {
  try {
    await api('/x');
  } catch (e) {
    return e;
  }
  throw new Error('did not fail');
};

await check('a network failure says the server cannot be reached, in plain words', async () => {
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };
  const e = await fails();
  assert.ok(
    e instanceof ApiError &&
      e.status === 0 &&
      /Cannot reach the server/.test(e.message) &&
      !/Failed to fetch/.test(e.message),
  );
});
await check("the server's own reason is shown when it gives one", async () => {
  answer(400, { detail: 'That name is taken.' });
  assert.strictEqual((await fails()).message, 'That name is taken.');
});
await check('a reason that is not text (a validation list) falls back to plain words', async () => {
  answer(422, { detail: [{ msg: 'bad' }] });
  assert.strictEqual((await fails()).message, failureText(422));
});
await check(
  'no reason at all: each kind of failure has its own wording, none is empty or a bare number',
  async () => {
    const seen = new Set();
    for (const st of [400, 401, 403, 404, 429, 500, 502, 503, 504]) {
      answer(st, undefined);
      const m = (await fails()).message;
      assert.ok(m.length > 20 && !/^Request failed/.test(m), st + ': ' + m);
      seen.add(m);
    }
    assert.ok(seen.size >= 7);
  },
);
await check('success returns the data', async () => {
  answer(200, { a: 1 });
  assert.deepStrictEqual(await api('/x'), { a: 1 });
});
console.log(bad ? `\n${bad} FAILED` : '\nALL PASSED');
process.exit(bad ? 1 : 0);
