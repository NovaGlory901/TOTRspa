// Asking a server to let you in (electron/joinclient.cjs): the key, the signed request, the list of
// asks, and the whole trip against the real server.
// Run: node tests/joinclient.test.cjs
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const { spawn } = require('node:child_process');
const J = require('../electron/joinclient.cjs');
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'totr-join-'));
const ID = 'a'.repeat(32);

check('the install key is made once, kept private, and the same one comes back', () => {
  const k1 = J.loadKey(tmp, fs),
    k2 = J.loadKey(tmp, fs);
  assert.strictEqual(J.publicB64(k1), J.publicB64(k2));
  assert.strictEqual(J.publicB64(k1).length, 44);
  if (process.platform !== 'win32')
    assert.strictEqual(fs.statSync(path.join(tmp, 'install-key.json')).mode & 0o077, 0);
});
check('a damaged key file is replaced by a new key instead of crashing', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'totr-join-'));
  fs.writeFileSync(path.join(d, 'install-key.json'), '{nonsense');
  assert.strictEqual(J.publicB64(J.loadKey(d, fs)).length, 44);
  fs.writeFileSync(
    path.join(d, 'install-key.json'),
    JSON.stringify({
      private: crypto
        .generateKeyPairSync('rsa', { modulusLength: 2048 })
        .privateKey.export({ format: 'der', type: 'pkcs8' })
        .toString('base64'),
    }),
  );
  // an RSA key is not ours: a new Ed25519 one is made
  assert.strictEqual(J.publicB64(J.loadKey(d, fs)).length, 44);
});
check('a request carries a signature that verifies, and only the hash of the token', () => {
  const key = J.loadKey(tmp, fs),
    r = J.buildRequest(
      key,
      {
        name: ' Rae ',
        note: 'hi',
        platform: 'linux',
        appVersion: '0.7.0',
        history: { since: '2024-01-02', plays: 3, evil: 'x' },
      },
      1700000000000,
    );
  const pub = crypto.createPublicKey({
    key: Buffer.concat([
      Buffer.from('302a300506032b6570032100', 'hex'),
      Buffer.from(r.body.key, 'base64'),
    ]),
    format: 'der',
    type: 'spki',
  });
  assert.ok(
    crypto.verify(
      null,
      Buffer.from(J.PREFIX + r.body.payload),
      pub,
      Buffer.from(r.body.sig, 'base64'),
    ),
  );
  const p = JSON.parse(r.body.payload);
  assert.deepStrictEqual(
    [p.v, p.name, p.ts, p.history],
    [1, 'Rae', 1700000000, { since: '2024-01-02', plays: 3 }],
  );
  assert.strictEqual(p.invite_hash, crypto.createHash('sha256').update(r.token).digest('hex'));
  assert.ok(!r.body.payload.includes(r.token) && !JSON.stringify(r.body).includes(r.token));
  assert.ok(r.token.length >= 43);
});
check('every request has a new token; an empty name is refused; text is cleaned', () => {
  const key = J.loadKey(tmp, fs);
  assert.notStrictEqual(
    J.buildRequest(key, { name: 'A' }).token,
    J.buildRequest(key, { name: 'A' }).token,
  );
  assert.ok(J.buildRequest(key, { name: '  \n ' }).error);
  assert.strictEqual(
    JSON.parse(
      J.buildRequest(key, { name: 'A\u0000B' + 'x'.repeat(80), note: 'n'.repeat(500) }).body
        .payload,
    ).name.length,
    40,
  );
  assert.strictEqual(
    JSON.parse(J.buildRequest(key, { name: 'A', note: 'n'.repeat(500) }).body.payload).note.length,
    300,
  );
});
check('history keeps only known numbers and a date', () => {
  assert.deepStrictEqual(
    J.cleanHistory({ since: '2024-01-02', plays: 5, mixtapes: -1, songs: 1.5, x: 1 }),
    { since: '2024-01-02', plays: 5 },
  );
  assert.strictEqual(J.cleanHistory({ since: 'yesterday' }), null);
  assert.strictEqual(J.cleanHistory('x'), null);
  assert.strictEqual(J.cleanHistory(null), null);
});

const entry = (o = {}) => ({
  origin: 'https://totr.example:8443',
  requestId: ID,
  token: 't'.repeat(43),
  name: 'Rae',
  ...o,
});
check('add lists the ask; the page never sees the token', () => {
  const r = J.add({}, entry());
  assert.ok(!r.error);
  assert.deepStrictEqual(J.list(r.config).map(J.forPage), [
    { requestId: ID, origin: 'https://totr.example:8443', name: 'Rae', status: 'pending' },
  ]);
  assert.ok(!JSON.stringify(J.forPage(J.list(r.config)[0])).includes('ttttt'));
});
check('one waiting ask per server; at most 5 open', () => {
  const r = J.add({}, entry()).config;
  assert.ok(J.add(r, entry({ requestId: 'b'.repeat(32) })).error);
  let c = {};
  for (let i = 0; i < 5; i++)
    c = J.add(
      c,
      entry({ origin: `https://h${i}.example`, requestId: String(i).repeat(32) }),
    ).config;
  assert.ok(J.add(c, entry({ origin: 'https://more.example', requestId: 'c'.repeat(32) })).error);
});
check('junk and old entries in config.json are ignored', () => {
  const c = {
    joins: [
      null,
      5,
      {},
      entry({ token: 'short' }),
      entry({ requestId: 'zz' }),
      entry({ origin: 'nope://x' }),
      entry({ createdAt: 1 }),
      { ...entry(), createdAt: Date.now() },
    ],
  };
  assert.strictEqual(J.list(c).length, 1);
});
check(
  'finish needs an approval, saves the server, uses it, and keeps the token only as the pending invite',
  () => {
    let c = J.add({ servers: [] }, entry()).config;
    assert.ok(J.finish(c, ID).error); // still pending
    c = J.setStatus(c, ID, 'approved');
    const f = J.finish(c, ID);
    assert.ok(!f.error, f.error);
    assert.strictEqual(f.config.server, 'https://totr.example:8443');
    assert.ok(f.config.servers.some(s => s.origin === 'https://totr.example:8443'));
    assert.deepStrictEqual(f.config.joins, []);
    assert.strictEqual(f.config.pendingInvite.token, 't'.repeat(43));
    assert.ok(J.finish(c, 'f'.repeat(32)).error);
  },
);
check('the pending invite opens once, only on its own server, and only for a sane token', () => {
  const cfg = {
    server: 'https://totr.example:8443',
    pendingInvite: { origin: 'https://totr.example:8443', token: 't'.repeat(43) },
  };
  const t = J.takePendingInvite(cfg, 'https://totr.example:8443');
  assert.strictEqual(t.url, 'https://totr.example:8443/invite/' + 't'.repeat(43));
  assert.ok(!('pendingInvite' in t.config));
  assert.strictEqual(J.takePendingInvite(cfg, 'https://other.example'), null);
  for (const token of ['x', '../../admin', 'a b'.repeat(20), 'a'.repeat(200)])
    assert.strictEqual(
      J.takePendingInvite(
        { pendingInvite: { origin: 'https://s.example', token } },
        'https://s.example',
      ),
      null,
    );
  assert.strictEqual(J.takePendingInvite({}, 'https://s.example'), null);
});

// talking to a server (a stand-in)
const fake =
  routes =>
  async (url, init = {}) => {
    const k = (init.method || 'GET') + ' ' + new URL(url).pathname;
    const r = routes[k];
    if (!r) throw new Error('unreachable');
    return {
      ok: r.status === undefined || r.status < 400,
      status: r.status || 200,
      json: async () => {
        if (r.bad) throw new Error('x');
        return r.body;
      },
    };
  };
check('ask: closed server, open server, errors in plain words', async () => {
  const req = J.buildRequest(J.loadKey(tmp, fs), { name: 'Rae' });
  assert.match(
    (await J.ask(fake({ 'GET /api/join': { body: { open: false } } }), 'https://s', req)).error,
    /not taking join requests/,
  );
  assert.match((await J.ask(fake({}), 'https://s', req)).error, /could not be reached/);
  assert.match(
    (await J.ask(fake({ 'GET /api/join': { status: 404, body: {} } }), 'https://s', req)).error,
    /older version/,
  );
  assert.strictEqual(
    (
      await J.ask(
        fake({
          'GET /api/join': { body: { open: true } },
          'POST /api/join': { body: { request_id: ID } },
        }),
        'https://s',
        req,
      )
    ).requestId,
    ID,
  );
  assert.strictEqual(
    (
      await J.ask(
        fake({
          'GET /api/join': { body: { open: true } },
          'POST /api/join': {
            status: 429,
            body: { detail: 'Too many requests from here. Try again later.' },
          },
        }),
        'https://s',
        req,
      )
    ).error,
    'Too many requests from here. Try again later.',
  );
  assert.match(
    (
      await J.ask(
        fake({
          'GET /api/join': { body: { open: true } },
          'POST /api/join': { body: { request_id: '../x' } },
        }),
        'https://s',
        req,
      )
    ).error,
    /does not understand/,
  );
});
check('check: pending, approved, declined, gone, nonsense', async () => {
  const f = s => fake({ ['GET /api/join/' + ID]: s });
  for (const st of ['pending', 'approved', 'declined'])
    assert.strictEqual((await J.check(f({ body: { status: st } }), 'https://s', ID)).status, st);
  assert.strictEqual((await J.check(f({ status: 404, body: {} }), 'https://s', ID)).status, 'gone');
  assert.ok((await J.check(f({ body: { status: 'hacked' } }), 'https://s', ID)).error);
  assert.ok((await J.check(f({ body: {} }), 'https://s', '../x')).error);
});

// the whole trip against the real server (Python, SQLite, one admin)
const py = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'TOTRsrv',
  '.venv',
  ...(process.platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python']),
);
if (fs.existsSync(py))
  check(
    'real server: ask, wait, be approved, finish, open the invite, make the account',
    async () => {
      const state = fs.mkdtempSync(path.join(os.tmpdir(), 'totr-join-srv-')),
        port = 18000 + Math.floor(Math.random() * 1000);
      const srv = spawn(
        path.resolve(py),
        [path.join(__dirname, 'fixtures', 'join_server.py'), String(port), state],
        { stdio: ['pipe', 'pipe', 'ignore'] },
      );
      try {
        await new Promise((res, rej) => {
          const t = setTimeout(() => rej(new Error('the server did not start')), 25000);
          srv.stdout.on('data', d => {
            if (String(d).includes('ready')) {
              clearTimeout(t);
              res();
            }
          });
          srv.on('exit', () => rej(new Error('the server stopped')));
        });
        const origin = `http://127.0.0.1:${port}`,
          key = J.loadKey(tmp, fs);
        const req = J.buildRequest(key, {
          name: 'Rae',
          note: 'a friend',
          platform: 'linux',
          appVersion: '0.7.0',
          history: { since: '2024-05-06', plays: 12 },
        });
        const asked = await J.ask(fetch, origin, req);
        assert.ok(asked.requestId, asked.error);
        assert.strictEqual((await J.check(fetch, origin, asked.requestId)).status, 'pending');
        let c = J.add(
          {},
          { origin, requestId: asked.requestId, token: req.token, name: 'Rae' },
        ).config;
        // the admin answers in the browser; here, with the same calls the page makes
        const login = await fetch(origin + '/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'boss', password: 'correct horse battery staple' }),
        });
        assert.strictEqual(login.status, 200);
        const cookie = login.headers
          .getSetCookie()
          .map(x => x.split(';')[0])
          .join('; ');
        const csrf = (await (await fetch(origin + '/api/auth/me', { headers: { cookie } })).json())
          .csrf;
        const admin = (p, body) =>
          fetch(origin + p, {
            method: 'POST',
            headers: { cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' },
            body: JSON.stringify(body || {}),
          });
        const waiting = (
          await (await fetch(origin + '/api/admin/join', { headers: { cookie } })).json()
        ).requests;
        assert.strictEqual(waiting.length, 1);
        assert.deepStrictEqual(
          [waiting[0].name, waiting[0].platform, waiting[0].history],
          ['Rae', 'linux', { since: '2024-05-06', plays: 12 }],
        );
        assert.strictEqual(waiting[0].install.length, 19);
        assert.strictEqual(
          (await J.ask(fetch, origin, J.buildRequest(key, { name: 'Again' }))).error,
          'This install already has a request waiting.',
        );
        assert.strictEqual(
          (await admin(`/api/admin/join/${asked.requestId}/approve`, { permissions: [] })).status,
          200,
        );
        assert.strictEqual((await J.check(fetch, origin, asked.requestId)).status, 'approved');
        c = J.setStatus(c, asked.requestId, 'approved');
        const f = J.finish(c, asked.requestId);
        assert.ok(!f.error, f.error);
        const open = J.takePendingInvite(f.config, origin);
        assert.ok(open.url.startsWith(origin + '/invite/'));
        const made = await fetch(origin + '/api/auth/accept-invite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: open.url.split('/').pop(),
            username: 'rae',
            password: 'another long passphrase',
          }),
        });
        assert.strictEqual(made.status, 200, await made.text());
        // a second ask by the same install after being let in is fine; a declined ask is told no
        // and leaves nothing
        const req2 = J.buildRequest(key, { name: 'Rae again' });
        const a2 = await J.ask(fetch, origin, req2);
        assert.ok(a2.requestId, a2.error);
        assert.strictEqual((await admin(`/api/admin/join/${a2.requestId}/decline`)).status, 200);
        assert.strictEqual((await J.check(fetch, origin, a2.requestId)).status, 'declined');
        const w = await J.withdraw(fetch, origin, ID);
        assert.ok(!w.error);
      } finally {
        srv.stdin.end();
        setTimeout(() => srv.kill(), 1500).unref();
      }
    },
  );
else console.log("skip real server trip: the server's Python environment was not found");

(async () => {
  for (const t of queue) await t();
  console.log(bad ? `\nFAILED (${bad} failing)` : '\nALL PASSED');
  process.exit(bad ? 1 : 0);
})();
