// Which servers' pages may use the shell's controls (switch servers, look for servers on the
// network, send join requests, open DejaVuAmp and FalseHorizons, install an update). Playing music
// needs none of them. The list lives in config.json under "access" (origins). A server that is not
// on it is asked about once, in a dialog of the shell that no web page can draw or press
// (main.cjs). Pure functions: they take a config and give back a new one, and never touch the disk.
const { parseServer } = require('./address.cjs');
const servers = require('./servers.cjs');

const MAX = 50;
const clean = config => {
  const seen = new Set(),
    out = [];
  for (const o of Array.isArray(config && config.access) ? config.access : []) {
    const r = typeof o === 'string' ? parseServer(o) : { error: 'no' };
    if (!r.error && r.origin === o && !seen.has(o) && out.length < MAX) {
      seen.add(o);
      out.push(o);
    }
  }
  return out;
};

const has = (config, origin) => clean(config).includes(origin);
const grant = (config, origin) =>
  has(config, origin) || clean(config).length >= MAX
    ? { ...config, access: clean(config) }
    : { ...config, access: [...clean(config), origin] };
const revoke = (config, origin) => ({ ...config, access: clean(config).filter(o => o !== origin) });

// An install from before this existed has no "access" list. The servers it already knew were chosen
// by the person, so they keep the controls; anything added later has to be asked about. Returns the
// config to save, or null when there is nothing to do.
function inherit(config, current) {
  if (config && Array.isArray(config.access)) return null;
  const known = servers.list(config || {}, current).map(s => s.origin);
  return known.length ? { ...config, access: known } : null;
}

module.exports = { has, grant, revoke, inherit };
