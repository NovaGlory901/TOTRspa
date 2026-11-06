// Remembered sign-ins (electron/accounts.cjs): the vault, its rules, the sealing, and the page-
// facing calls. Run: node tests/accounts.test.cjs
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const A = require('../electron/accounts.cjs');
let bad = 0;
const queue = [];
const check = (name, fn) =>
  queue.push(async () => {
    try {
      await fn();
      console.log('ok  ' + name);
    } catch (e) {
      bad++;
      console.log('BAD ' + name + '   <- ' + e.message);
    }
  });

// a crypter that really encrypts (AES-GCM), so a wrong key or a changed byte fails like the real
// one
const crypterWith = key => ({
  seal: buf => {
    const iv = crypto.randomBytes(12),
      c = crypto.createCipheriv('aes-256-gcm', key, iv);
    const body = Buffer.concat([c.update(buf), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), body]);
  },
  open: buf => {
    const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([d.update(buf.subarray(28)), d.final()]);
  },
});
const K1 = crypto.randomBytes(32),
  K2 = crypto.randomBytes(32),
  C1 = crypterWith(K1);
const S1 = 'https://a.example:8443',
  S2 = 'https://b.example';

check('put and get: the sign-in comes back for that exact server only', () => {
  const v = new A.Vault();
  assert.ok(v.put(S1, 'pia', 'pw1'));
  assert.strictEqual(v.get(S1).username, 'pia');
  assert.strictEqual(v.get(S2), null);
  assert.strictEqual(v.get(S1 + '/'), null);
  assert.strictEqual(v.get('https://a.example:8443.evil.example'), null);
});
check('only an exact https origin is kept, and odd text is refused', () => {
  const v = new A.Vault();
  for (const o of ['http://a.example', S1 + '/', S1 + '/app', 'a.example', '', null, 'https://'])
    assert.ok(!v.put(o, 'pia', 'pw'), String(o));
  assert.ok(!v.put(S1, '', 'pw'));
  assert.ok(!v.put(S1, 'pia', ''));
  assert.ok(!v.put(S1, 'pi\na', 'pw'));
  assert.ok(!v.put(S1, 'x'.repeat(65), 'pw'));
  assert.ok(!v.put(S1, 'pia', 'x'.repeat(129)));
  assert.ok(!v.put(S1, 5, 'pw'));
});
check('at most 30 accounts; replacing one is still allowed when full', () => {
  const v = new A.Vault();
  for (let i = 0; i < 30; i++) assert.ok(v.put(`https://h${i}.example`, 'u', 'p'));
  assert.ok(!v.put('https://extra.example', 'u', 'p'));
  assert.ok(v.put('https://h3.example', 'u2', 'p2'));
  assert.ok(!v.markNever('https://extra.example'));
});
check('sealed and opened again it is the same; the stored text shows nothing readable', () => {
  const v = new A.Vault();
  v.put(S1, 'pia', 'secret-pw');
  v.markNever(S2);
  v.markSignedOut(S1);
  v.failed(S1);
  const text = v.seal(C1);
  for (const w of ['pia', 'secret-pw', 'a.example'])
    assert.ok(!Buffer.from(text, 'base64').includes(w) && !text.includes(w), w);
  const w = A.Vault.open(text, C1);
  assert.strictEqual(w.get(S1).password, 'secret-pw');
  assert.ok(w.get(S1).signedOut);
  assert.strictEqual(w.get(S1).failures, 1);
  assert.ok(w.isNever(S2));
});
check('another key, a changed byte, junk, and empty all give an empty vault, not an error', () => {
  const v = new A.Vault();
  v.put(S1, 'pia', 'pw');
  const text = v.seal(C1);
  assert.deepStrictEqual(A.Vault.open(text, crypterWith(K2)).origins(), []);
  const b = Buffer.from(text, 'base64');
  b[b.length - 1] ^= 1;
  assert.deepStrictEqual(A.Vault.open(b.toString('base64'), C1).origins(), []);
  for (const t of ['junk', '', null, undefined, '////'])
    assert.deepStrictEqual(A.Vault.open(t, C1).origins(), []);
  assert.deepStrictEqual(A.Vault.open(text, null).origins(), []);
});
check('a damaged entry costs only itself; hand-edited values are put right', () => {
  const sealed = list => C1.seal(Buffer.from(JSON.stringify(list))).toString('base64');
  const v = A.Vault.open(
    sealed([
      null,
      5,
      { origin: 'http://x.example', username: 'a', password: 'b' },
      { origin: S1, username: 'pia', password: 'pw', failures: 99 },
      { origin: S1, username: 'dup', password: 'dup' },
      { origin: S2, username: '', password: 'x' },
      { origin: 'https://c.example', never: true },
    ]),
    C1,
  );
  assert.deepStrictEqual(v.origins(), [S1]);
  assert.strictEqual(v.get(S1).failures, A.MAX_FAILURES);
  assert.strictEqual(v.get(S1).username, 'pia');
  assert.ok(v.isNever('https://c.example'));
  assert.deepStrictEqual(A.Vault.open(sealed({ not: 'a list' }), C1).origins(), []);
});
check('never for this server holds until forgotten, and blocks put', () => {
  const v = new A.Vault();
  v.markNever(S1);
  assert.ok(v.isNever(S1));
  assert.ok(!v.put(S1, 'pia', 'pw'));
  assert.strictEqual(v.get(S1), null);
  assert.deepStrictEqual(v.origins(), []);
  v.forget(S1);
  assert.ok(v.put(S1, 'pia', 'pw'));
});
check(
  'automatic tries: once per 30 s, not after signing out by hand, not after 3 refusals; a manual sign-in (put) lifts both',
  () => {
    const v = new A.Vault();
    v.put(S1, 'pia', 'pw');
    assert.ok(v.nextAutoTry(S1, 1000));
    assert.strictEqual(v.nextAutoTry(S1, 1000 + 29_999), null);
    assert.ok(v.nextAutoTry(S1, 1000 + 30_000));
    assert.ok(v.nextAutoTry(S1, 0)); // the clock went backwards: not stuck
    v.markSignedOut(S1);
    assert.strictEqual(v.nextAutoTry(S1, 1e9), null);
    v.put(S1, 'pia', 'pw2');
    assert.ok(v.nextAutoTry(S1, 2e9));
    v.failed(S1);
    v.failed(S1);
    assert.ok(v.nextAutoTry(S1, 3e9));
    v.failed(S1);
    assert.strictEqual(v.nextAutoTry(S1, 4e9), null);
    v.put(S1, 'pia', 'pw3');
    assert.ok(v.nextAutoTry(S1, 5e9));
    v.failed(S1);
    v.succeeded(S1);
    assert.strictEqual(v.get(S1).failures, 0);
    assert.strictEqual(v.nextAutoTry(S2, 1e12), null);
  },
);
check("the server's answer: only a refusal counts against the password", () => {
  assert.strictEqual(A.classify(200), 'ok');
  for (const s of [401, 403, 422]) assert.strictEqual(A.classify(s), 'refused');
  assert.strictEqual(A.classify(429), 'throttled');
  for (const s of [0, 204, 302, 404, 500, 502, 503])
    assert.strictEqual(A.classify(s), 'unreachable', String(s));
});
check('a made-up password is 24 long, from the safe alphabet, and not the same twice', () => {
  const a = A.newPassword(),
    b = A.newPassword();
  assert.match(a, /^[abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789]{24}$/);
  assert.notStrictEqual(a, b);
});
check(
  'safeStorage: used when it works; none when unavailable, when it throws, or on Linux without a keyring',
  () => {
    const ok = {
      isEncryptionAvailable: () => true,
      encryptString: s => Buffer.from('E' + s),
      decryptString: b => b.toString().slice(1),
      getSelectedStorageBackend: () => 'gnome_libsecret',
    };
    const c = A.safeCrypter(ok, 'linux');
    assert.strictEqual(c.open(c.seal(Buffer.from('hi'))).toString(), 'hi');
    assert.strictEqual(A.safeCrypter({ ...ok, isEncryptionAvailable: () => false }, 'linux'), null);
    assert.strictEqual(
      A.safeCrypter({ ...ok, getSelectedStorageBackend: () => 'basic_text' }, 'linux'),
      null,
    );
    assert.ok(A.safeCrypter({ ...ok, getSelectedStorageBackend: () => 'basic_text' }, 'win32'));
    assert.strictEqual(
      A.safeCrypter(
        {
          ...ok,
          isEncryptionAvailable: () => {
            throw new Error('x');
          },
        },
        'win32',
      ),
      null,
    );
    assert.strictEqual(A.safeCrypter(null), null);
  },
);

function rig(over = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'totr-acct-'));
  const log = { login: [], ask: 0 };
  const state = { status: 200, session: true, answer: 0, crypter: C1, t: 1e6, ...over };
  const deps = {
    fs,
    dir,
    crypter: () => state.crypter,
    now: () => state.t,
    randomInt: crypto.randomInt,
    login: async (o, u, p) => {
      log.login.push({ o, u, p });
      if (state.throws) throw new Error('down');
      return { status: state.status };
    },
    hasSession: async () => state.session,
    ask: async () => {
      log.ask++;
      return state.answer;
    },
    servers: () => [S1, S2],
  };
  const make = () => A.create(deps);
  return { dir, log, state, acct: make(), make, file: path.join(dir, 'accounts.vault') };
}
const yes = async () => true;

check(
  'save asks the person once; Save keeps it sealed on disk; the next save for that server needs no question',
  async () => {
    const r = rig();
    assert.deepStrictEqual(await r.acct.call('save', { username: 'pia', password: 'pw1' }, S1), {
      ok: true,
    });
    assert.strictEqual(r.log.ask, 1);
    assert.ok(!fs.readFileSync(r.file, 'utf8').includes('pw1'));
    assert.deepStrictEqual(await r.acct.call('save', { username: 'pia', password: 'pw2' }, S1), {
      ok: true,
    });
    assert.strictEqual(r.log.ask, 1);
    assert.strictEqual(r.make().autoSignIn !== undefined, true);
    r.state.t += 1e6;
    // a restart finds it
    assert.deepStrictEqual(await r.make().call('auto', {}, S1), { signedIn: true });
    assert.strictEqual(r.log.login.at(-1).p, 'pw2');
    if (process.platform !== 'win32') assert.strictEqual(fs.statSync(r.file).mode & 0o077, 0);
  },
);
check(
  'Not now keeps nothing and does not ask again this run; Never keeps nothing and is remembered',
  async () => {
    const r = rig({ answer: 1 });
    assert.deepStrictEqual(await r.acct.call('save', { username: 'p', password: 'w' }, S1), {
      ok: false,
    });
    assert.deepStrictEqual(await r.acct.call('save', { username: 'p', password: 'w' }, S1), {
      ok: false,
    });
    assert.strictEqual(r.log.ask, 1);
    assert.ok(!fs.existsSync(r.file));
    const n = rig({ answer: 2 });
    await n.acct.call('save', { username: 'p', password: 'w' }, S1);
    n.state.answer = 0;
    const again = n.make();
    assert.deepStrictEqual(await again.call('save', { username: 'p', password: 'w' }, S1), {
      ok: false,
    });
    assert.strictEqual(n.log.ask, 1);
  },
);
check('no protected storage: nothing is saved, nothing is asked, nothing is written', async () => {
  const r = rig({ crypter: null });
  assert.deepStrictEqual(await r.acct.call('save', { username: 'p', password: 'w' }, S1), {
    ok: false,
  });
  assert.strictEqual(r.log.ask, 0);
  assert.ok(!fs.existsSync(r.file));
  assert.deepStrictEqual(await r.acct.call('auto', {}, S1), { signedIn: false });
  r.state.crypter = C1; // a keyring that turns up later is used (the empty vault was not kept)
  assert.deepStrictEqual(await r.acct.call('save', { username: 'p', password: 'w' }, S1), {
    ok: true,
  });
});
check(
  'a keyring that is missing at first and there later still finds the saved sign-ins',
  async () => {
    const r = rig();
    await r.acct.call('save', { username: 'pia', password: 'pw' }, S1);
    r.state.crypter = null;
    const later = r.make();
    assert.deepStrictEqual(await later.call('auto', {}, S1), { signedIn: false });
    r.state.crypter = C1;
    r.state.t += 1e6;
    assert.deepStrictEqual(await later.call('list', {}, S1, yes), {
      accounts: [{ origin: S1, username: 'pia' }],
    });
  },
);
check(
  'a page that is not an https app page (http, the offline page, nothing) can do nothing',
  async () => {
    const r = rig();
    for (const page of [
      '',
      'http://a.example',
      'file:///x',
      'https://a.example:8443/x',
      undefined,
    ]) {
      assert.deepStrictEqual(await r.acct.call('save', { username: 'p', password: 'w' }, page), {
        ok: false,
      });
      assert.deepStrictEqual(await r.acct.call('auto', {}, page), { signedIn: false });
    }
    assert.strictEqual(r.log.ask, 0);
    assert.strictEqual(r.log.login.length, 0);
  },
);
check("auto signs in with the saved password for the PAGE's server and nobody else's", async () => {
  const r = rig();
  await r.acct.call('save', { username: 'pia', password: 'pw' }, S1);
  r.state.t += 1e6;
  assert.deepStrictEqual(await r.acct.call('auto', {}, S2), { signedIn: false });
  assert.strictEqual(r.log.login.length, 0);
  assert.deepStrictEqual(await r.acct.call('auto', {}, S1), { signedIn: true });
  assert.deepStrictEqual(r.log.login, [{ o: S1, u: 'pia', p: 'pw' }]);
});
check(
  'auto: 30 s pause, signed out by hand, and 3 refusals stop it; a refusal is counted, a down server is not',
  async () => {
    const r = rig();
    await r.acct.call('save', { username: 'pia', password: 'pw' }, S1);
    r.state.t += 1e6;
    await r.acct.call('auto', {}, S1);
    assert.deepStrictEqual(await r.acct.call('auto', {}, S1), { signedIn: false });
    assert.strictEqual(r.log.login.length, 1); // too soon
    r.state.status = 500;
    r.state.t += 31_000;
    await r.acct.call('auto', {}, S1);
    r.state.throws = true;
    r.state.t += 31_000;
    await r.acct.call('auto', {}, S1);
    r.state.throws = false;
    r.state.status = 401;
    for (let i = 0; i < 2; i++) {
      r.state.t += 31_000;
      await r.acct.call('auto', {}, S1);
    }
    const before = r.log.login.length;
    r.state.t += 31_000;
    await r.acct.call('auto', {}, S1);
    // two refusals (not the 500 or the outage): still allowed
    assert.strictEqual(r.log.login.length, before + 1);
    const n = r.log.login.length;
    r.state.t += 31_000;
    await r.acct.call('auto', {}, S1);
    assert.strictEqual(r.log.login.length, n); // stopped
    // a manual sign-in lifts it
    await r.acct.call('save', { username: 'pia', password: 'new' }, S1);
    r.state.status = 200;
    r.state.t += 31_000;
    assert.deepStrictEqual(await r.acct.call('auto', {}, S1), { signedIn: true });
    await r.acct.call('signedOut', {}, S1);
    r.state.t += 31_000;
    assert.deepStrictEqual(await r.acct.call('auto', {}, S1), { signedIn: false });
    // also after a restart
    assert.deepStrictEqual(await r.make().call('auto', {}, S1), { signedIn: false });
  },
);
check('a 200 that set no session cookie is not a sign-in', async () => {
  const r = rig({ session: false });
  await r.acct.call('save', { username: 'pia', password: 'pw' }, S1);
  r.state.t += 1e6;
  assert.deepStrictEqual(await r.acct.call('auto', {}, S1), { signedIn: false });
});
check(
  'have, forget and list need the controls to be allowed, and never show a password',
  async () => {
    const r = rig();
    await r.acct.call('save', { username: 'pia', password: 'topsecret' }, S1);
    for (const op of ['have', 'forget', 'list'])
      assert.deepStrictEqual(await r.acct.call(op, { origin: S1 }, S1), { ok: false });
    assert.deepStrictEqual(await r.acct.call('have', { origin: S1 }, S2, yes), {
      have: true,
      username: 'pia',
    });
    assert.deepStrictEqual(await r.acct.call('have', { origin: S2 }, S1, yes), { have: false });
    assert.deepStrictEqual(await r.acct.call('list', {}, S1, yes), {
      accounts: [{ origin: S1, username: 'pia' }],
    });
    assert.ok(
      !JSON.stringify([
        await r.acct.call('have', { origin: S1 }, S1, yes),
        await r.acct.call('list', {}, S1, yes),
      ]).includes('topsecret'),
    );
    await r.acct.call('forget', { origin: S1 + '/' }, S1, yes);
    assert.deepStrictEqual(await r.acct.call('list', {}, S1, yes), { accounts: [] });
  },
);
check('forget (a removed server) takes the saved sign-in with it, on disk too', async () => {
  const r = rig();
  await r.acct.call('save', { username: 'pia', password: 'pw' }, S1);
  r.acct.forget(S1);
  assert.deepStrictEqual(await r.make().call('list', {}, S1, yes), { accounts: [] });
});
check('suggest gives a strong password; unknown ops and junk args do nothing', async () => {
  const r = rig();
  assert.strictEqual((await r.acct.call('suggest', {}, '')).password.length, 24);
  for (const op of ['', 'nope', '__proto__', 'constructor'])
    assert.deepStrictEqual(await r.acct.call(op, {}, S1), { ok: false });
  assert.deepStrictEqual(await r.acct.call('save', 'junk', S1), { ok: false });
  assert.deepStrictEqual(await r.acct.call('have', null, S1, yes), { have: false });
});
check('a disk that fails to write does not crash anything', async () => {
  const r = rig();
  const bad = {
    ...fs,
    writeFileSync: () => {
      throw new Error('disk full');
    },
  };
  const a = A.create({
    fs: bad,
    dir: r.dir,
    crypter: () => C1,
    login: async () => ({ status: 200 }),
    hasSession: async () => true,
    ask: async () => 0,
    servers: () => [],
  });
  assert.deepStrictEqual(await a.call('save', { username: 'p', password: 'w' }, S1), { ok: false });
});

(async () => {
  for (const t of queue) await t();
  console.log(bad ? `\nFAILED (${bad} failing)` : '\nALL PASSED');
  process.exit(bad ? 1 : 0);
})();
