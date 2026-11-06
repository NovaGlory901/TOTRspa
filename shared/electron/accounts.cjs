// Remembered sign-ins (the desktop twin of the Android app's Vault / AccountStore). The app
// remembers a person's username and password for each server and signs in for them. A saved sign-in
// belongs to ONE exact https origin and is used only for a page of that server, read from the
// window's real address and never from anything the page sends. The page never receives a password,
// only yes or no. Nothing is kept unsealed: the vault is one text sealed by the operating system's
// own protected storage (Electron's safeStorage: Windows' credential protection, the macOS
// keychain, the Linux keyring); where that is not available nothing is saved at all. Rules, as on
// the phone: at most 30 accounts; signed out by hand means no automatic sign-in until a manual one;
// 3 refusals and the saved password is not tried again; at most one automatic try per server every
// 30 seconds; "never for this server" is remembered. Pure code with the disk, the network and the
// dialogs passed in, so tests/accounts.test.cjs runs it without Electron. main.cjs does the wiring.
const crypto = require('node:crypto');
const path = require('node:path');
const { parseServer } = require('./address.cjs');

const MAX = 30,
  MAX_FAILURES = 3,
  USER_MAX = 64,
  PASS_MAX = 128,
  RETRY_MS = 30_000;
const COOKIE = 'totr_session';

// the exact https origin of an address, or '' (plain http protects nothing, so nothing is saved for
// it)
const httpsOrigin = address => {
  const r = parseServer(address);
  return !r.error && r.origin.startsWith('https://') && r.origin === String(address)
    ? r.origin
    : '';
};
// is `o` itself an exact https origin?
const exact = o => typeof o === 'string' && o !== '' && httpsOrigin(o) === o;
const originOf = address => {
  const r = parseServer(address);
  return !r.error && r.origin.startsWith('https://') ? r.origin : '';
};
const clean = (s, max) =>
  typeof s === 'string' && s.length > 0 && s.length <= max && !/\p{C}/u.test(s);

class Vault {
  constructor() {
    this.entries = new Map();
    this.lastTry = new Map();
  }

  // The vault inside a stored text. Anything damaged, tampered with or sealed with another key
  // gives an empty vault, never an error.
  static open(stored, crypter) {
    const v = new Vault();
    if (!stored || !crypter) return v;
    let list;
    try {
      list = JSON.parse(crypter.open(Buffer.from(String(stored), 'base64')).toString('utf8'));
    } catch {
      return v;
    }
    if (!Array.isArray(list)) return v;
    for (const e of list) {
      // a damaged entry costs only itself
      if (!e || typeof e !== 'object' || v.entries.size >= MAX) continue;
      if (!exact(e.origin) || v.entries.has(e.origin)) continue;
      const never = e.never === true;
      if (!never && !(clean(e.username, USER_MAX) && clean(e.password, PASS_MAX))) continue;
      v.entries.set(e.origin, {
        username: never ? '' : e.username,
        password: never ? '' : e.password,
        signedOut: e.signedOut === true,
        never,
        failures: Number.isInteger(e.failures)
          ? Math.max(0, Math.min(MAX_FAILURES, e.failures))
          : 0,
      });
    }
    return v;
  }

  // The whole vault as one sealed text.
  seal(crypter) {
    const list = [...this.entries].map(([origin, e]) => ({ origin, ...e }));
    return crypter.seal(Buffer.from(JSON.stringify(list), 'utf8')).toString('base64');
  }

  // Remembers a sign-in the person made by hand (or just created). False when it must not be kept.
  put(origin, username, password) {
    if (!exact(origin) || !clean(username, USER_MAX) || !clean(password, PASS_MAX)) return false;
    const old = this.entries.get(origin);
    if (old && old.never) return false;
    if (!old && this.entries.size >= MAX) return false;
    this.entries.set(origin, { username, password, signedOut: false, never: false, failures: 0 });
    this.lastTry.delete(origin);
    return true;
  }
  get(origin) {
    const e = this.entries.get(origin);
    return e && !e.never && e.username && e.password ? e : null;
  }
  isNever(origin) {
    const e = this.entries.get(origin);
    return !!(e && e.never);
  }
  markNever(origin) {
    if (!exact(origin) || (!this.entries.has(origin) && this.entries.size >= MAX)) return false;
    this.entries.set(origin, {
      username: '',
      password: '',
      signedOut: false,
      never: true,
      failures: 0,
    });
    return true;
  }
  forget(origin) {
    this.entries.delete(origin);
    this.lastTry.delete(origin);
  }
  markSignedOut(origin) {
    const e = this.entries.get(origin);
    if (e) e.signedOut = true;
  }
  // The sign-in to try automatically now, or null: none saved, signed out by hand, three refusals
  // already, or tried less than 30 seconds ago. Asking counts as a try.
  nextAutoTry(origin, now) {
    const e = this.get(origin);
    if (!e || e.signedOut || e.failures >= MAX_FAILURES) return null;
    const last = this.lastTry.get(origin);
    if (last !== undefined && now >= last && now - last < RETRY_MS) return null;
    this.lastTry.set(origin, now);
    return e;
  }
  failed(origin) {
    const e = this.entries.get(origin);
    if (e && e.failures < MAX_FAILURES) e.failures++;
  }
  succeeded(origin) {
    const e = this.entries.get(origin);
    if (e) e.failures = 0;
  }
  origins() {
    return [...this.entries]
      .filter(([, e]) => !e.never && e.username && e.password)
      .map(([o]) => o);
  }
}

// A strong random password for a new account: 24 characters, no look-alikes (about 143 bits).
function newPassword(randomInt = crypto.randomInt) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 24; i++) s += alphabet[randomInt(alphabet.length)];
  return s;
}

// What the server's answer means for the saved sign-in. Only a refusal says the password is wrong;
// a busy or absent server must not use up the three tries.
function classify(status) {
  if (status === 200) return 'ok';
  if (status === 401 || status === 403 || status === 422) return 'refused';
  if (status === 429) return 'throttled';
  return 'unreachable';
}

// safeStorage -> a crypter, or null when this computer cannot protect the vault (then nothing is
// saved). On Linux with no keyring Electron falls back to a fixed password ('basic_text'), which
// protects nothing, so that counts as unavailable too.
function safeCrypter(safeStorage, platform = process.platform) {
  try {
    if (!safeStorage || !safeStorage.isEncryptionAvailable()) return null;
    if (
      platform === 'linux' &&
      typeof safeStorage.getSelectedStorageBackend === 'function' &&
      safeStorage.getSelectedStorageBackend() === 'basic_text'
    )
      return null;
  } catch {
    return null;
  }
  return {
    seal: buf => safeStorage.encryptString(buf.toString('utf8')),
    open: buf => Buffer.from(safeStorage.decryptString(buf), 'utf8'),
  };
}

// the store and the page-facing calls
// deps: crypter() -> crypter | null; fs; dir (the app's settings folder); now(); randomInt;
// login(origin, username, password) -> { status } | throws (posts to <origin>/api/auth/login with
// the app's own session, so the session cookie lands in the window's jar); hasSession(origin) ->
// bool (is the session cookie there now); ask(origin) -> 0 save | 1 not now | 2 never; servers() ->
// the saved origins (what 'list' may show). call() is given `allowed`, the "app's controls"
// question for this page, for the calls that reach beyond its own server.
function create(deps) {
  const file = path.join(deps.dir, 'accounts.vault');
  let vault = null;
  const asked = new Set();
  const sealer = () => {
    try {
      return deps.crypter();
    } catch {
      return null;
    }
  };
  const load = () => {
    if (vault) return vault;
    const c = sealer();
    // no protected storage (yet): an empty vault, and not kept, so a keyring that appears later is
    // used
    if (!c) return new Vault();
    let text = '';
    try {
      text = deps.fs.readFileSync(file, 'utf8');
    } catch {
      /* none yet */
    }
    return (vault = Vault.open(text, c));
  };
  const persist = () => {
    const c = sealer();
    if (!c) return false; // never written unsealed
    try {
      deps.fs.mkdirSync(deps.dir, { recursive: true });
      deps.fs.writeFileSync(file + '.tmp', load().seal(c), { mode: 0o600 });
      deps.fs.renameSync(file + '.tmp', file);
      return true;
    } catch {
      return false;
    }
  };
  const now = () => (deps.now ? deps.now() : Date.now());
  const NO = { ok: false };

  async function autoSignIn(page) {
    const e = load().nextAutoTry(page, now());
    if (!e) return false;
    let status = 0;
    try {
      status = (await deps.login(page, e.username, e.password)).status;
    } catch {
      status = 0;
    }
    let result = classify(status);
    // answered 200 without a session: not a TOTR sign-in
    if (result === 'ok' && !(await deps.hasSession(page))) result = 'unreachable';
    if (result === 'ok') load().succeeded(page);
    else if (result === 'refused') load().failed(page);
    persist();
    return result === 'ok';
  }

  // op: auto | save | signedOut | suggest | have | forget | list. `page` is the https origin of the
  // window's real address ('' when it is not an app page).
  async function call(op, args, page, allowed = async () => false) {
    const a = args && typeof args === 'object' ? args : {};
    const own = httpsOrigin(page);
    switch (op) {
      case 'auto':
        return { signedIn: own ? await autoSignIn(own) : false };
      case 'save': {
        if (!own || !sealer() || load().isNever(own)) return NO;
        if (!load().get(own)) {
          // the first time for this server: the person decides, in a dialog of the shell
          if (asked.has(own)) return NO;
          asked.add(own);
          const answer = await deps.ask(own);
          if (answer === 2) {
            if (load().markNever(own)) persist();
            return NO;
          }
          if (answer !== 0) return NO;
        }
        return { ok: load().put(own, a.username, a.password) && persist() };
      }
      case 'signedOut':
        if (own) {
          load().markSignedOut(own);
          persist();
        }
        return { ok: true };
      case 'suggest':
        return { password: newPassword(deps.randomInt) };
      case 'have': {
        if (!(await allowed())) return NO;
        const e = load().get(originOf(a.origin));
        return e ? { have: true, username: e.username } : { have: false };
      }
      case 'forget': {
        if (!(await allowed())) return NO;
        const o = originOf(a.origin);
        if (o) {
          load().forget(o);
          persist();
        }
        return { ok: true };
      }
      case 'list': {
        if (!(await allowed())) return NO;
        const saved = new Set(load().origins());
        return {
          accounts: deps
            .servers()
            .filter(o => saved.has(o))
            .map(o => ({ origin: o, username: load().get(o).username })),
        };
      }
      default:
        return NO;
    }
  }
  // a server taken off the list takes its saved sign-in with it
  const forget = origin => {
    const o = originOf(origin);
    if (o) {
      load().forget(o);
      persist();
    }
  };
  return { call, forget, autoSignIn };
}

module.exports = {
  Vault,
  create,
  newPassword,
  classify,
  safeCrypter,
  httpsOrigin,
  MAX,
  MAX_FAILURES,
  RETRY_MS,
  COOKIE,
};
