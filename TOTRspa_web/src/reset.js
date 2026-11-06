// "Reset app": forgets what this device keeps for TOTR (themes, the player's place, Home's lists,
// anything cached) and loads the app fresh. It does not touch the saved servers (the desktop shell
// and the Android launcher keep those outside the page), the sign-in (a cookie the server owns), or
// anything on the server. If settings sync is on, the server gives back the saved look and place on
// the next start; the reset removes what is only on this device and whatever has gone wrong in it.
// `env` is for tests; the app passes nothing.
export async function resetLocal(env = globalThis) {
  const done = [];
  for (const [name, getStore] of [
    ['localStorage', () => env.localStorage],
    ['sessionStorage', () => env.sessionStorage],
  ]) {
    try {
      getStore().clear();
      done.push(name);
    } catch {
      /* storage blocked here: nothing was kept in it */
    }
  }
  try {
    const cache = env.caches;
    if (cache) {
      for (const key of await cache.keys()) await cache.delete(key);
      done.push('caches');
    }
  } catch {
    /* no cache storage */
  }
  try {
    const regs =
      env.navigator && env.navigator.serviceWorker && env.navigator.serviceWorker.getRegistrations
        ? await env.navigator.serviceWorker.getRegistrations()
        : [];
    for (const r of regs) await r.unregister();
  } catch {
    /* no service worker */
  }
  try {
    if (env.indexedDB && env.indexedDB.databases)
      for (const d of await env.indexedDB.databases())
        if (d.name) env.indexedDB.deleteDatabase(d.name);
  } catch {
    /* not supported */
  }
  return done;
}
