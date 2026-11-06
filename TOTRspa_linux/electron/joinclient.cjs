// Asking a server to let you in. The server side is TOTRsrv/auth/join.py; read its header for the
// wire format.
//
// Each app install makes one Ed25519 key the first time it asks (install-key.json in the app's
// settings folder, readable only by this account) and signs every request with it. That lets an
// admin see "the same copy of the app asked before"; it cannot prove the app is unmodified. The app
// also makes up a one-time invite token for each request and sends only its SHA-256: when an admin
// approves, the server turns that hash into an invite, and only this app holds the token that opens
// it. So nothing secret crosses the network, and nobody who reads the server's database can walk
// in.
//
// The asks in progress live in config.json under "joins" (at most 5): { origin, requestId, token,
// name, status, createdAt }. The token stays there until the invite is used (it is good for one
// use, for 7 days, and only after an admin approved). Pure functions plus small helpers that take
// the file system and fetch as arguments.
const crypto = require('node:crypto');
const path = require('node:path');
const { parseServer } = require('./address.cjs');

const PREFIX = 'totr-join-request\n';
const MAX_JOINS = 5,
  MAX_AGE_MS = 14 * 24 * 3600 * 1000;
const ID = /^[0-9a-f]{32}$/;

function loadKey(dir, fs) {
  const file = path.join(dir, 'install-key.json');
  try {
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    const priv = crypto.createPrivateKey({
      key: Buffer.from(String(stored.private), 'base64'),
      format: 'der',
      type: 'pkcs8',
    });
    if (priv.asymmetricKeyType === 'ed25519') return priv;
  } catch {
    /* none yet, or damaged: make a new one (an old request then looks like a different install) */
  }
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({
      private: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
    }),
    { mode: 0o600 },
  );
  return privateKey;
}
const publicB64 = priv =>
  crypto
    .createPublicKey(priv)
    .export({ format: 'der', type: 'spki' })
    .subarray(-32)
    .toString('base64');

// what the page may ask
const text = (v, max) =>
  String(v == null ? '' : v)
    .replace(/[^\P{C}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
function cleanHistory(h) {
  if (!h || typeof h !== 'object') return null;
  const out = {};
  if (typeof h.since === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(h.since)) out.since = h.since;
  for (const k of ['plays', 'mixtapes', 'songs'])
    if (Number.isInteger(h[k]) && h[k] >= 0 && h[k] <= 1e9) out[k] = h[k];
  return Object.keys(out).length ? out : null;
}

// -> { body, token, inviteHash } ready to POST to <origin>/api/join
function buildRequest(
  priv,
  { name, note, history, platform, appVersion },
  now = Date.now(),
  random = crypto.randomBytes,
) {
  const n = text(name, 40);
  if (!n) return { error: 'Please give a name.' };
  const token = random(32).toString('base64url');
  const inviteHash = crypto.createHash('sha256').update(token).digest('hex');
  const payload = JSON.stringify({
    v: 1,
    name: n,
    note: text(note, 300),
    platform: text(platform, 40),
    app_version: text(appVersion, 20),
    history: cleanHistory(history),
    invite_hash: inviteHash,
    ts: Math.floor(now / 1000),
  });
  const sig = crypto.sign(null, Buffer.from(PREFIX + payload, 'utf8'), priv).toString('base64');
  return { body: { payload, key: publicB64(priv), sig }, token, inviteHash };
}

// talking to the server (fetch is injected: main.cjs gives it the session that knows the pinned
// authorities)
async function call(fetch, origin, pathAndQuery, init) {
  let r;
  try {
    r = await fetch(origin + pathAndQuery, { redirect: 'error', ...init });
  } catch {
    return {
      error: 'The server could not be reached. Check the network and that the server is on.',
    };
  }
  let j = {};
  try {
    j = await r.json();
  } catch {
    /* not JSON */
  }
  if (!r.ok)
    return {
      error:
        typeof j.detail === 'string'
          ? j.detail
          : r.status === 404
            ? 'That server does not take join requests (it may be an older version).'
            : 'The server did not accept the request.',
      status: r.status,
    };
  return { json: j };
}
const post = (fetch, origin, p, body) =>
  call(fetch, origin, p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });

async function ask(fetch, origin, request) {
  const info = await call(fetch, origin, '/api/join', { method: 'GET' });
  if (info.error) return info;
  if (!info.json.open) return { error: 'This server is not taking join requests right now.' };
  const r = await post(fetch, origin, '/api/join', request.body);
  if (r.error) return r;
  return ID.test(String(r.json.request_id))
    ? { requestId: r.json.request_id }
    : { error: 'The server gave an answer this app does not understand.' };
}
async function check(fetch, origin, requestId) {
  if (!ID.test(requestId)) return { error: 'Not a request.' };
  const r = await call(fetch, origin, '/api/join/' + requestId, { method: 'GET' });
  if (r.error) return r.status === 404 ? { status: 'gone' } : r;
  return ['pending', 'approved', 'declined'].includes(r.json.status)
    ? { status: r.json.status }
    : { error: 'The server gave an answer this app does not understand.' };
}
const withdraw = (fetch, origin, requestId) =>
  ID.test(requestId)
    ? post(fetch, origin, `/api/join/${requestId}/withdraw`, {})
    : Promise.resolve({ error: 'Not a request.' });

// the list of asks in config.json
const entryOk = j =>
  j &&
  typeof j === 'object' &&
  ID.test(String(j.requestId)) &&
  typeof j.token === 'string' &&
  j.token.length >= 32 &&
  !parseServer(j.origin).error;
function list(config, now = Date.now()) {
  const raw = Array.isArray(config && config.joins) ? config.joins : [];
  return raw
    .filter(j => entryOk(j) && now - Number(j.createdAt || 0) < MAX_AGE_MS)
    .slice(0, MAX_JOINS);
}
const forPage = j => ({
  requestId: j.requestId,
  origin: j.origin,
  name: text(j.name, 40),
  status: j.status || 'pending',
}); // never the token
function add(config, entry, now = Date.now()) {
  const have = list(config, now);
  if (have.some(j => j.origin === entry.origin && (j.status || 'pending') === 'pending'))
    return {
      error: 'You already asked this server. Wait for the answer, or cancel that request first.',
    };
  if (have.length >= MAX_JOINS) return { error: 'Too many requests are open. Cancel one first.' };
  return {
    config: { ...config, joins: [...have, { ...entry, status: 'pending', createdAt: now }] },
  };
}
const setStatus = (config, requestId, status) => ({
  ...config,
  joins: list(config).map(j => (j.requestId === requestId ? { ...j, status } : j)),
});
const remove = (config, requestId) => ({
  ...config,
  joins: list(config).filter(j => j.requestId !== requestId),
});

// Approved: the server becomes a saved server, the one in use, and the next start opens its invite
// page (config.pendingInvite), where the person picks a username and
// password. The invite page is on the server itself. The token is dropped from the list as it moves
// to pendingInvite.
function finish(config, requestId) {
  const j = list(config).find(x => x.requestId === requestId);
  if (!j) return { error: 'That request is gone.' };
  if (j.status !== 'approved') return { error: 'That request has not been approved.' };
  const withServer = require('./servers.cjs').use(config, j.origin, '');
  if (withServer.error) return withServer;
  return {
    config: {
      ...remove(withServer.config, requestId),
      pendingInvite: { origin: j.origin, token: j.token },
    },
    origin: j.origin,
  };
}

// The page to open on start: the invite page once, then forget it. -> { url, config } or null
function takePendingInvite(config, serverOrigin) {
  const p = config && config.pendingInvite;
  if (
    !p ||
    typeof p.token !== 'string' ||
    !/^[A-Za-z0-9_-]{32,64}$/.test(p.token) ||
    parseServer(p.origin).error ||
    parseServer(p.origin).origin !== serverOrigin
  )
    return null;
  const { pendingInvite, ...rest } = config;
  return { url: `${serverOrigin}/invite/${p.token}`, config: rest };
}

module.exports = {
  loadKey,
  publicB64,
  buildRequest,
  ask,
  check,
  withdraw,
  list,
  forPage,
  add,
  setStatus,
  remove,
  finish,
  takePendingInvite,
  cleanHistory,
  PREFIX,
};
