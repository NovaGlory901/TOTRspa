// The list of saved servers in the desktop app's config.json: { "server": "<the one in use>",
// "servers": [ { "name": "Home", "origin": "https://totr.example:8443" } ] }. Pure functions: they
// take a config and give back a new one, and never touch the disk (main.cjs does that).
const { parseServer } = require('./address.cjs');

const MAX_NAME = 40,
  MAX_SERVERS = 30;
const tidyName = n =>
  String(n || '')
    .trim()
    .slice(0, MAX_NAME);

// The saved servers, cleaned: only valid addresses, no repeats. `current` (the address in use) is
// always included, first, even if it was never saved.
function list(config, current) {
  const seen = new Set(),
    out = [];
  const put = (name, address) => {
    const r = parseServer(address);
    if (r.error || seen.has(r.origin) || out.length >= MAX_SERVERS) return;
    seen.add(r.origin);
    out.push({ name: tidyName(name), origin: r.origin });
  };
  const saved = Array.isArray(config && config.servers) ? config.servers : [];
  if (current)
    put((saved.find(s => s && parseServer(s.origin).origin === current) || {}).name, current);
  for (const s of saved) if (s && typeof s === 'object') put(s.name, s.origin);
  return out;
}

function add(config, name, address, current) {
  const r = parseServer(address);
  if (r.error) return { error: r.error };
  const have = list(config, current);
  if (have.some(s => s.origin === r.origin))
    return { error: 'That server is already in the list.' };
  if (have.length >= MAX_SERVERS)
    return { error: `The list is full (${MAX_SERVERS} servers). Remove one first.` };
  return { config: { ...config, servers: [...have, { name: tidyName(name), origin: r.origin }] } };
}

function remove(config, origin, current) {
  if (origin === current)
    return { error: 'This is the server in use. Switch to another one first.' };
  return { config: { ...config, servers: list(config, current).filter(s => s.origin !== origin) } };
}

// Makes `origin` the server in use (and keeps it in the list).
function use(config, origin, current) {
  const r = parseServer(origin);
  if (r.error) return { error: r.error };
  const withIt = list(config, current),
    has = withIt.some(s => s.origin === r.origin);
  return {
    config: {
      ...config,
      server: r.origin,
      servers: has ? withIt : [...withIt, { name: '', origin: r.origin }],
    },
  };
}

module.exports = { list, add, remove, use };
