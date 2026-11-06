// Settings and "continue listening" that follow a person from device to device. The app keeps all
// of these in this device's localStorage (themes, recently played, where you stopped, the equalizer
// and visuals settings); this copies them to the server (per person, `/api/me/data`) and brings
// them back when the app starts. The server stores text and never interprets it; every part of the
// app that reads these values already checks them. * On start (before the app is drawn, waiting at
// most a few seconds): an item the server has that is newer than this device's copy replaces it. *
// While the app is open: changed items are sent about every 15 seconds, and when the app is hidden
// or closed. * Which copy is newer is decided by the time of the change on the device that made it.
// A device that has never synced counts as oldest. * If the server is not set up for this
// (sql/user_data.sql not run) or cannot be reached, nothing breaks: the app just keeps working per
// device.
import './amp.js';
import './fh.js';
import { myData, saveMyData } from './api.js';

const LIMIT = 30000; // characters per item: the server refuses more
let store = null;
try {
  store = window.localStorage;
} catch {
  store = null;
}

// 'on' | 'setup' | 'old' | 'offline' | 'off', shown on the You page
export const state = { status: 'off', detail: '' };

const keys = u => ({
  'theme-current': `totr.v1.${u}.current`,
  'theme-themes': `totr.v1.${u}.themes`,
  'theme-display': `totr.v1.${u}.display`,
  recent: `totr.app.${u}.recent`,
  last: `totr.app.${u}.last`,
  amp: window.DejaVuAmpCore.storageKey(u),
  visuals: window.FalseHorizonCore.storageKey(u),
});
const metaKey = u => `totr.app.${u}.sync`;
const getItem = k => {
  try {
    return store ? store.getItem(k) : null;
  } catch {
    return null;
  }
};
const setItem = (k, v) => {
  try {
    if (store) store.setItem(k, v);
  } catch {
    /* full or blocked: this device just keeps its own */
  }
};
const readMeta = u => {
  try {
    return JSON.parse(getItem(metaKey(u))) || {};
  } catch {
    return {};
  }
};
const writeMeta = (u, m) => setItem(metaKey(u), JSON.stringify(m));
const withTimeout = (p, ms) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
const noteFailure = e => {
  if (e && e.status === 503) {
    state.status = 'setup';
    state.detail = e.message;
  } else if (e && e.status === 404) {
    state.status = 'old';
    state.detail = e.message;
  } // the server does not have /api/me/data: it has not been restarted with this version
  else {
    state.status = 'offline';
    state.detail = (e && e.message) || '';
  }
};

// Run once after sign-in, before the app is drawn.
export async function pull(user, waitMs = 4000) {
  if (!store) return;
  try {
    const { items } = await withTimeout(myData(), waitMs);
    const names = keys(user),
      meta = readMeta(user);
    for (const [name, local] of Object.entries(names)) {
      const s = items && items[name],
        m = meta[name] || { ms: 0, base: null, dirty: false };
      const mine = getItem(local);
      if (s && typeof s.value === 'string' && (mine === null || s.updated_ms > m.ms)) {
        setItem(local, s.value);
        meta[name] = { ms: s.updated_ms, base: s.value, dirty: false };
        // first time here: send what this device has
      } else if (!m.base && mine !== null) meta[name] = { ms: Date.now(), base: mine, dirty: true };
    }
    writeMeta(user, meta);
    state.status = 'on';
    state.detail = '';
  } catch (e) {
    noteFailure(e);
  }
}

// Send what changed. Returns when done; never throws.
// after a "not set up" or "not there" answer, try again only every few minutes
let blockedUntil = 0;
export async function push(user) {
  if (!store) return;
  if ((state.status === 'setup' || state.status === 'old') && Date.now() < blockedUntil) return;
  const names = keys(user),
    meta = readMeta(user);
  for (const [name, local] of Object.entries(names)) {
    const v = getItem(local);
    if (v === null) continue;
    const m = meta[name] || { ms: 0, base: null, dirty: false };
    if (v !== m.base) {
      m.ms = Date.now();
      m.base = v;
      m.dirty = true;
    } // changed since the last copy: stamped with the time of the change
    meta[name] = m;
  }
  writeMeta(user, meta);
  for (const [name, m] of Object.entries(meta)) {
    if (!m.dirty || !names[name]) continue;
    const v = getItem(names[name]);
    if (v === null || v.length > LIMIT) {
      m.dirty = false;
      continue;
    }
    try {
      const r = await saveMyData(name, v, m.ms);
      m.dirty = false;
      // the server had something newer: the next start brings it here
      if (!r.kept) m.ms = r.updated_ms;
      state.status = 'on';
      state.detail = '';
    } catch (e) {
      noteFailure(e);
      if (state.status === 'setup' || state.status === 'old') {
        blockedUntil = Date.now() + 120000;
        break;
      }
    }
  }
  writeMeta(user, meta);
}

// While the app is open. Returns a function that stops it.
export function start(user) {
  if (!store) return () => {};
  const timer = setInterval(() => push(user), 15000);
  const flush = () => {
    if (document.hidden) push(user);
  };
  document.addEventListener('visibilitychange', flush);
  window.addEventListener('pagehide', flush);
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', flush);
    window.removeEventListener('pagehide', flush);
    push(user);
  };
}
