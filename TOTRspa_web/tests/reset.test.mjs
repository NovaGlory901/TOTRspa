// "Reset app" (src/reset.js): clears what the page keeps, survives a browser that blocks pieces of
// it, and never touches anything else. Run: node tests/reset.test.mjs
import assert from 'node:assert';
import { resetLocal } from '../src/reset.js';
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
const store = init => {
  const m = new Map(Object.entries(init));
  return { m, clear: () => m.clear(), getItem: k => m.get(k) ?? null };
};

await check(
  'local and session storage, caches, service workers and databases are all cleared',
  async () => {
    const log = { unregistered: 0, cacheDeleted: [], dbDeleted: [] };
    const env = {
      localStorage: store({ theme: 'x', place: 'y' }),
      sessionStorage: store({ a: '1' }),
      caches: {
        keys: async () => ['v1', 'v2'],
        delete: async k => {
          log.cacheDeleted.push(k);
        },
      },
      navigator: {
        serviceWorker: {
          getRegistrations: async () => [
            {
              unregister: async () => {
                log.unregistered++;
              },
            },
          ],
        },
      },
      indexedDB: {
        databases: async () => [{ name: 'a' }, { name: 'b' }, {}],
        deleteDatabase: n => log.dbDeleted.push(n),
      },
    };
    const done = await resetLocal(env);
    assert.strictEqual(env.localStorage.m.size + env.sessionStorage.m.size, 0);
    assert.deepStrictEqual(log, {
      unregistered: 1,
      cacheDeleted: ['v1', 'v2'],
      dbDeleted: ['a', 'b'],
    });
    assert.deepStrictEqual(done, ['localStorage', 'sessionStorage', 'caches']);
  },
);
await check(
  'a browser that blocks storage, caches or databases does not stop the reset',
  async () => {
    const blocked = {
      get localStorage() {
        throw new Error('blocked');
      },
      sessionStorage: store({ a: '1' }),
      caches: {
        keys: async () => {
          throw new Error('no');
        },
      },
      navigator: {
        serviceWorker: {
          getRegistrations: async () => {
            throw new Error('no');
          },
        },
      },
      indexedDB: {
        databases: async () => {
          throw new Error('no');
        },
      },
    };
    assert.deepStrictEqual(await resetLocal(blocked), ['sessionStorage']);
    assert.strictEqual(blocked.sessionStorage.m.size, 0);
    assert.deepStrictEqual(await resetLocal({}), []);
  },
);
console.log(bad ? `\n${bad} FAILED` : '\nALL PASSED');
process.exit(bad ? 1 : 0);
