// The page's side of "servers near you" and "ask to join" (src/native.js): the desktop shell is
// used when there is one, otherwise the Android bridge's nearCall(id, op, args), whose answer comes
// back as window.__totrNearDone(id, json). Run: node tests/native.test.mjs
import assert from 'node:assert';
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

// a phone: answers each op from `replies` (a function op, args -> json text), after a tick, out of
// order if `delay` says so
function phone(replies, log = [], delay = () => 0) {
  return {
    version: () => 1,
    nearCall(id, op, args) {
      log.push({ id, op, args: JSON.parse(args) });
      setTimeout(
        () => globalThis.window.__totrNearDone(Number(id), replies(op, JSON.parse(args))),
        delay(op),
      );
    },
  };
}
const load = async win => {
  globalThis.window = win;
  return import('../src/native.js?' + Math.random());
};

await check('without the Android bridge or the desktop shell nothing is offered', async () => {
  const n = await load({});
  assert.strictEqual(n.nearSupported(), false);
});
await check(
  'an Android install from before this existed (bridge without nearCall) offers nothing',
  async () => {
    const n = await load({ TotrNative: { version: () => 1 } });
    assert.strictEqual(n.nearSupported(), false);
  },
);
await check('start asks the phone to start, then returns its list', async () => {
  const log = [];
  const n = await load({
    TotrNative: phone(
      op =>
        JSON.stringify(
          op === 'start'
            ? { ok: true }
            : {
                list: [
                  {
                    name: 'Box',
                    origin: 'https://10.0.0.5:8443',
                    address: '10.0.0.5',
                    fingerprint: '',
                  },
                ],
              },
        ),
      log,
    ),
  });
  assert.strictEqual(n.nearSupported(), true);
  const r = await n.nearStart();
  assert.deepStrictEqual(
    r.list.map(x => x.name),
    ['Box'],
  );
  assert.deepStrictEqual(
    log.map(x => x.op),
    ['start', 'list'],
  );
});
await check("a start that fails gives the phone's sentence and no list call", async () => {
  const log = [];
  const n = await load({
    TotrNative: phone(() => JSON.stringify({ error: 'The network does not allow it.' }), log),
  });
  assert.deepStrictEqual(await n.nearStart(), { error: 'The network does not allow it.' });
  assert.deepStrictEqual(
    log.map(x => x.op),
    ['start'],
  );
});
await check(
  'ask passes the address and the details, refresh/cancel/finish pass what they should',
  async () => {
    const log = [];
    const n = await load({ TotrNative: phone(() => JSON.stringify({ joins: [] }), log) });
    await n.joinAsk('https://10.0.0.5:8443', { name: 'Pia', note: 'hi', history: { plays: 3 } });
    await n.joinRefresh();
    await n.joinCancel('abc');
    await n.joinFinish('def');
    await n.nearStop();
    assert.deepStrictEqual(
      log.map(x => x.op),
      ['ask', 'refresh', 'cancel', 'finish', 'stop'],
    );
    assert.strictEqual(log[0].args.address, 'https://10.0.0.5:8443');
    assert.deepStrictEqual(JSON.parse(log[0].args.details), {
      name: 'Pia',
      note: 'hi',
      history: { plays: 3 },
    });
    assert.strictEqual(log[2].args.id, 'abc');
    assert.strictEqual(log[3].args.id, 'def');
  },
);
await check(
  'two calls at once each get their own answer, even when the second comes first',
  async () => {
    const n = await load({
      TotrNative: phone(
        op => JSON.stringify({ op }),
        [],
        op => (op === 'refresh' ? 30 : 0),
      ),
    });
    const [a, b] = await Promise.all([n.joinRefresh(), n.nearList()]);
    assert.deepStrictEqual([a, b], [{ op: 'refresh' }, { op: 'list' }]);
  },
);
await check('an answer that is not JSON becomes a plain error, not a crash', async () => {
  const n = await load({ TotrNative: phone(() => 'not json') });
  const r = await n.nearList();
  assert.ok(typeof r.error === 'string' && r.error.length > 10);
});
await check('a phone whose call throws gives a plain error', async () => {
  const n = await load({
    TotrNative: {
      version: () => 1,
      nearCall() {
        throw new Error('boom');
      },
    },
  });
  assert.deepStrictEqual(await n.nearList(), { error: 'The phone did not answer.' });
});
await check(
  'the desktop shell is used when there is one, and the bridge is not touched',
  async () => {
    const log = [];
    const calls = [];
    const shell = {
      discover: {
        start: async () => (calls.push('start'), { list: [] }),
        list: async () => (calls.push('list'), { list: [] }),
        stop: async () => calls.push('stop'),
      },
      join: {
        ask: async (a, d) => (calls.push('ask ' + a), { joins: [] }),
        refresh: async () => (calls.push('refresh'), { joins: [] }),
        cancel: async id => calls.push('cancel ' + id),
        finish: async id => calls.push('finish ' + id),
      },
    };
    const n = await load({ totrShell: shell, TotrNative: phone(() => '{}', log) });
    await n.nearStart();
    await n.joinAsk('https://x', {});
    await n.joinRefresh();
    await n.joinCancel('1');
    await n.joinFinish('2');
    await n.nearList();
    await n.nearStop();
    assert.deepStrictEqual(calls, [
      'start',
      'ask https://x',
      'refresh',
      'cancel 1',
      'finish 2',
      'list',
      'stop',
    ]);
    assert.strictEqual(log.length, 0);
  },
);

const acctPhone = (replies, log = []) => ({
  version: () => 1,
  accountCall(id, op, args) {
    log.push({ op, args: JSON.parse(args) });
    setTimeout(() => globalThis.window.__totrAccountsDone(Number(id), replies(op)), 0);
  },
});
await check(
  'accounts: nothing is offered without the bridge call or the desktop shell, and every call does nothing',
  async () => {
    const n = await load({ TotrNative: { version: () => 1 } });
    assert.strictEqual(n.accountsSupported(), false);
    assert.strictEqual(await n.accountAuto(), false);
    assert.strictEqual(await n.accountSave('a', 'b'), null);
    assert.deepStrictEqual(await n.accountList(), []);
  },
);
await check(
  'accounts: auto is true only for a real true; save, signedOut, forget pass what they should',
  async () => {
    const log = [];
    const n = await load({
      TotrNative: acctPhone(
        op => JSON.stringify(op === 'auto' ? { signedIn: true } : { ok: true }),
        log,
      ),
    });
    assert.strictEqual(n.accountsSupported(), true);
    assert.strictEqual(await n.accountAuto(), true);
    await n.accountSave('pia', 'pw');
    await n.accountSignedOut();
    await n.accountForget('https://x');
    assert.deepStrictEqual(
      log.map(x => x.op),
      ['auto', 'save', 'signedOut', 'forget'],
    );
    assert.deepStrictEqual(log[1].args, { username: 'pia', password: 'pw' });
    assert.strictEqual(log[3].args.origin, 'https://x');
    const m = await load({ TotrNative: acctPhone(() => JSON.stringify({ signedIn: 'yes' })) });
    assert.strictEqual(await m.accountAuto(), false);
  },
);
await check(
  'accounts: list gives the saved sign-ins, and [] for a refusal or nonsense',
  async () => {
    const n = await load({
      TotrNative: acctPhone(() =>
        JSON.stringify({ accounts: [{ origin: 'https://a', username: 'pia' }] }),
      ),
    });
    assert.deepStrictEqual(await n.accountList(), [{ origin: 'https://a', username: 'pia' }]);
    assert.deepStrictEqual(
      await (
        await load({ TotrNative: acctPhone(() => JSON.stringify({ ok: false, error: 'no' })) })
      ).accountList(),
      [],
    );
    assert.deepStrictEqual(
      await (await load({ TotrNative: acctPhone(() => 'junk') })).accountList(),
      [],
    );
  },
);
await check(
  'accounts: a phone that throws ends the call cleanly; the desktop shell is used when there is one',
  async () => {
    assert.strictEqual(
      await (
        await load({
          TotrNative: {
            version: () => 1,
            accountCall() {
              throw new Error('boom');
            },
          },
        })
      ).accountAuto(),
      false,
    );
    const log = [],
      calls = [];
    const n = await load({
      totrShell: { accounts: { call: async (op, a) => (calls.push(op), { signedIn: true }) } },
      TotrNative: acctPhone(() => '{}', log),
    });
    assert.strictEqual(await n.accountAuto(), true);
    assert.deepStrictEqual(calls, ['auto']);
    assert.strictEqual(log.length, 0);
  },
);
console.log(bad ? `\n${bad} FAILED` : '\nALL PASSED');
process.exit(bad ? 1 : 0);
