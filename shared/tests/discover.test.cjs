// "TOTR servers near you" (electron/discover.cjs): what it accepts, what it throws away, and one
// real find on this machine's network. Run: node tests/discover.test.cjs
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const D = require('../electron/discover.cjs');
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

class FakeMdns extends EventEmitter {
  constructor() {
    super();
    this.queries = [];
    this.destroyed = false;
  }
  query(q) {
    this.queries.push(q);
  }
  destroy() {
    this.destroyed = true;
  }
}
const SVC = '_totr._tcp.local';
const txt = o => Object.entries(o).map(([k, v]) => Buffer.from(`${k}=${v}`));
const goodPacket = (over = {}) => ({
  answers: [{ name: SVC, type: 'PTR', data: `Home._totr._tcp.local` }],
  additionals: [
    { name: 'home._totr._tcp.local', type: 'SRV', data: { port: 8443, target: 'box.local' } },
    {
      name: 'home._totr._tcp.local',
      type: 'TXT',
      data: txt({
        v: 1,
        n: 'Home radio',
        https: 8443,
        http: 8080,
        fp: '89ee-e75c-1a98-e49a-c350-f24e',
        join: 1,
        ...over,
      }),
    },
    { name: 'box.local', type: 'A', data: '192.168.1.20' },
  ],
});
let clock = 1000;
const make = () => {
  const m = new FakeMdns();
  const d = D.create({
    mdnsFactory: () => m,
    now: () => clock,
    setTimer: () => ({ unref() {} }),
    clearTimer: () => {},
  });
  return { m, d };
};
const LAN = { address: '192.168.1.20' };

check('addresses: private, link-local and VPN ranges are local; public ones are not', () => {
  for (const ip of [
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.0.9',
    '169.254.1.1',
    '100.64.0.1',
    '100.127.255.255',
  ])
    assert.ok(D.isLocalV4(ip), ip);
  for (const ip of [
    '8.8.8.8',
    '172.32.0.1',
    '172.15.0.1',
    '100.128.0.1',
    '100.63.0.1',
    '192.169.0.1',
    '1.2.3.4',
    '256.1.1.1',
    '10.0.0',
    'fe80::1',
    '',
    null,
    undefined,
    '10.0.0.1.5',
    '0x0a.0.0.1',
  ])
    assert.ok(!D.isLocalV4(ip), String(ip));
});
check('a good announcement becomes a listed server (https preferred, name from the record)', () => {
  const { m, d } = make();
  d.start();
  m.emit('response', goodPacket(), LAN);
  assert.deepStrictEqual(d.list(), [
    {
      name: 'Home radio',
      origin: 'https://192.168.1.20:8443',
      address: '192.168.1.20',
      fingerprint: '89ee-e75c-1a98-e49a-c350-f24e',
      instance: 'Home',
    },
  ]);
});
check('start asks the network with a PTR question for _totr._tcp', () => {
  const { m, d } = make();
  d.start();
  assert.deepStrictEqual(m.queries[0], { questions: [{ name: SVC, type: 'PTR' }] });
});
check('http only: an http address is built', () => {
  const { m, d } = make();
  d.start();
  m.emit('response', goodPacket({ https: '', fp: '' }), LAN);
  assert.strictEqual(d.list()[0].origin, 'http://192.168.1.20:8080');
  assert.strictEqual(d.list()[0].fingerprint, '');
});
check('a packet from a public address is ignored', () => {
  const { m, d } = make();
  d.start();
  m.emit('response', goodPacket(), { address: '8.8.8.8' });
  assert.deepStrictEqual(d.list(), []);
});
check('a server that points at a public address is ignored', () => {
  const { m, d } = make();
  d.start();
  const p = goodPacket();
  p.additionals[2].data = '8.8.8.8';
  m.emit('response', p, LAN);
  assert.deepStrictEqual(d.list(), []);
});
check(
  'a server that does not take join requests (join missing or 0) or has another version is not listed',
  () => {
    for (const over of [{ join: 0 }, { join: '' }, { v: 2 }, { v: '' }]) {
      const { m, d } = make();
      d.start();
      m.emit('response', goodPacket(over), LAN);
      assert.deepStrictEqual(d.list(), [], JSON.stringify(over));
    }
  },
);
check('bad ports, a bad fingerprint and a control-character name are cleaned or refused', () => {
  let t = make();
  t.d.start();
  t.m.emit('response', goodPacket({ https: 0, http: 70000 }), LAN);
  assert.deepStrictEqual(t.d.list(), []);
  t = make();
  t.d.start();
  t.m.emit(
    'response',
    goodPacket({ fp: 'not-a-fingerprint', n: 'A\u0000B\nC' + 'x'.repeat(100) }),
    LAN,
  );
  const s = t.d.list()[0];
  assert.strictEqual(s.fingerprint, '');
  assert.ok(s.name.startsWith('A B C') && s.name.length <= 40);
});
check('junk of every kind is dropped without throwing', () => {
  const { m, d } = make();
  d.start();
  for (const junk of [
    null,
    undefined,
    5,
    'x',
    {},
    { answers: 5 },
    { answers: [null, 7, {}, { name: 5 }, { name: SVC, type: 'PTR', data: 5 }] },
    { answers: [{ name: SVC, type: 'PTR', data: 'a'.repeat(5000) + '._totr._tcp.local' }] },
    { additionals: [{ name: 'x', type: 'TXT', data: 'nope' }] },
    { answers: [{ name: 'x'.repeat(300), type: 'A', data: '10.0.0.1' }] },
  ])
    m.emit('response', junk, LAN);
  m.emit('response', goodPacket(), null);
  m.emit('response', goodPacket(), {});
  assert.deepStrictEqual(d.list(), []);
});
check('TXT bigger than 600 characters stops being read', () => {
  const { m, d } = make();
  d.start();
  const p = goodPacket();
  p.additionals[1].data = [
    Buffer.from('x=' + 'y'.repeat(700)),
    ...txt({ v: 1, https: 8443, join: 1, n: 'Late' }),
  ];
  m.emit('response', p, LAN);
  assert.deepStrictEqual(d.list(), []);
});
check('no more than 50 servers are kept', () => {
  const { m, d } = make();
  d.start();
  for (let i = 0; i < 80; i++) {
    const p = goodPacket();
    const n = `s${i}._totr._tcp.local`;
    p.answers[0].data = n;
    p.additionals[0].name = n;
    p.additionals[1].name = n;
    p.additionals[0].data.target = `h${i}.local`;
    p.additionals[2].name = `h${i}.local`;
    p.additionals[2].data = `10.0.${i % 250}.${1 + (i % 200)}`;
    m.emit('response', p, LAN);
  }
  assert.ok(d.list().length <= 50 && d.list().length > 0, String(d.list().length));
});
check('a server not heard from for two minutes disappears; hearing again brings it back', () => {
  clock = 1000;
  const { m, d } = make();
  d.start();
  m.emit('response', goodPacket(), LAN);
  assert.strictEqual(d.list().length, 1);
  clock += 121000;
  assert.strictEqual(d.list().length, 0);
  m.emit('response', goodPacket(), LAN);
  assert.strictEqual(d.list().length, 1);
});
check('the listener hears of changes, and a throwing listener does not stop discovery', () => {
  const { m, d } = make();
  let seen = 0;
  d.start(() => {
    seen++;
    throw new Error('boom');
  });
  m.emit('response', goodPacket(), LAN);
  assert.ok(seen >= 1);
  assert.strictEqual(d.list().length, 1);
});
check('stop closes the socket and forgets everything; start again works', () => {
  const { m, d } = make();
  d.start();
  m.emit('response', goodPacket(), LAN);
  d.stop();
  assert.ok(m.destroyed);
  assert.deepStrictEqual(d.list(), []);
  d.start();
  m.emit('response', goodPacket(), LAN);
  assert.strictEqual(d.list().length, 1);
});
check('a network that will not open gives a plain sentence, not a crash', () => {
  const d = D.create({
    mdnsFactory: () => {
      const e = new Error('x');
      e.code = 'EADDRINUSE';
      throw e;
    },
  });
  const r = d.start();
  assert.ok(r.error && !/EADDRINUSE|Error/.test(r.error), r.error);
});

// the real thing: the server's own announcer (TOTRsrv/discovery.py) found by the real multicast-dns
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs'),
  os = require('node:os');
const root = path.join(__dirname, '..', '..', '..', 'TOTRsrv');
const venvPython =
  process.platform === 'win32'
    ? path.join(root, '.venv', 'Scripts', 'python.exe')
    : path.join(root, '.venv', 'bin', 'python');
const py = [venvPython, 'python3'].find(p => p === 'python3' || fs.existsSync(p));
const probe = spawnSync(py, ['-c', 'import zeroconf'], { encoding: 'utf8' });
const ip = Object.values(os.networkInterfaces())
  .flat()
  .find(i => i && i.family === 'IPv4' && !i.internal && D.isLocalV4(i.address));
if (probe.status !== 0 || !ip) {
  console.log(
    'skip real discovery: ' +
      (probe.status !== 0
        ? "the server's Python environment has no zeroconf"
        : 'no local network address on this machine'),
  );
  finish();
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'totr-disc-'));
  fs.writeFileSync(path.join(tmp, 'app_settings.json'), JSON.stringify({ join_open: true }));
  const child = spawn(
    py,
    ['-c', 'import discovery, time; print(discovery.sync(), flush=True); time.sleep(30)'],
    {
      cwd: root,
      stdio: ['ignore', 'pipe', 'inherit'],
      env: {
        ...process.env,
        APP_SETTINGS: path.join(tmp, 'app_settings.json'),
        TOTR_STATE_DIR: tmp,
        HOST: ip.address,
        PORT: '8766',
        SITE_NAME: 'Test radio',
      },
    },
  );
  const real = D.create({ mdnsFactory: () => require('multicast-dns')() });
  const t0 = Date.now();
  real.start();
  const poll = setInterval(() => {
    const found = real.list().find(s => s.name === 'Test radio');
    if (found || Date.now() - t0 > 8000) {
      clearInterval(poll);
      real.stop();
      child.kill();
      if (found)
        check('the real server is found by the real browser, with its address and port', () => {
          assert.strictEqual(found.origin, `http://${ip.address}:8766`);
          assert.strictEqual(found.address, ip.address);
        });
      else
        console.log(
          'skip real discovery: nothing found within 8 s (this network may not allow multicast)',
        );
      finish();
    }
  }, 300);
}
function finish() {
  console.log(bad ? `\nFAILED (${bad} failing)` : '\nALL PASSED');
  process.exit(bad ? 1 : 0);
}
