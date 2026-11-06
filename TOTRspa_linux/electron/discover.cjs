// "TOTR servers near you": finds servers on the same network by mDNS ("Bonjour", service
// _totr._tcp; the server side is TOTRsrv/discovery.py). Everything that arrives is a packet from
// anyone on the network, so it is treated as hostile: only the shape we asked for is read, sizes
// and counts are capped, text is cleaned, and an announcement is ignored unless it comes from, and
// points at, a private or link-local address (this is a LAN feature; nothing on the public internet
// can appear here). The list is only a convenience: choosing a server still goes through the usual
// trust check (pins.cjs), and the fingerprint in an announcement is shown to compare, never trusted
// by itself.
const SERVICE = '_totr._tcp.local';
const MAX_SERVERS = 50,
  MAX_ADDRESSES = 8,
  MAX_TXT = 600,
  TTL_MS = 120 * 1000,
  QUERY_EVERY_MS = 15 * 1000;
const FP = /^[0-9a-f]{4}(-[0-9a-f]{4}){5}$/;

// 10/8, 172.16/12, 192.168/16, 169.254/16 and 100.64/10 (the range VPNs such as Tailscale use).
// IPv4 only; anything else is not a local address for our purposes.
function isLocalV4(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(ip));
  if (!m) return false;
  const [a, b, c, d] = m.slice(1).map(Number);
  if ([a, b, c, d].some(n => n > 255)) return false;
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

const clean = (v, max) =>
  String(v == null ? '' : v)
    .replace(/[^\P{C}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
const port = v =>
  /^\d{1,5}$/.test(String(v)) && Number(v) >= 1 && Number(v) <= 65535 ? Number(v) : 0;

function parseTxt(data) {
  const out = {};
  if (!Array.isArray(data)) return out;
  let total = 0;
  for (const item of data.slice(0, 20)) {
    const text = Buffer.isBuffer(item)
      ? item.toString('utf8')
      : typeof item === 'string'
        ? item
        : '';
    total += text.length;
    if (total > MAX_TXT) break;
    const i = text.indexOf('=');
    if (i > 0) out[text.slice(0, i).toLowerCase()] = text.slice(i + 1);
  }
  return out;
}

// What one server looks like to the app: { name, origin, address, fingerprint, instance } or null
// if it is not usable.
function describe(inst) {
  if (!inst.srv || !inst.txt) return null;
  const t = inst.txt;
  if (t.v !== '1' || t.join !== '1') return null;
  const addrs = [...inst.addrs].filter(isLocalV4).slice(0, MAX_ADDRESSES);
  if (!addrs.length) return null;
  const https = port(t.https),
    http = port(t.http);
  if (!https && !http) return null;
  const address = addrs[0];
  const name = clean(t.n, 40) || clean(inst.label, 40);
  if (!name) return null;
  return {
    name,
    origin: https ? `https://${address}:${https}` : `http://${address}:${http}`,
    address,
    fingerprint: FP.test(t.fp || '') ? t.fp : '',
    instance: inst.label,
  };
}

// `mdnsFactory` makes the multicast-dns object (a stand-in in tests). Nothing is sent or opened
// until start().
function create({
  mdnsFactory,
  now = Date.now,
  setTimer = setInterval,
  clearTimer = clearInterval,
} = {}) {
  let mdns = null,
    timer = null,
    listener = null;
  const instances = new Map(); // instance name -> { label, srv, txt, addrs:Set, seen }
  const hosts = new Map(); // host name -> Set of addresses
  const changed = () => {
    if (listener) {
      try {
        listener(list());
      } catch {
        /* a bad listener must not stop discovery */
      }
    }
  };

  function onResponse(res, rinfo) {
    try {
      if (!rinfo || !isLocalV4(rinfo.address)) return; // from outside the local network: ignore
      const records = [
        ...(Array.isArray(res && res.answers) ? res.answers : []),
        ...(Array.isArray(res && res.additionals) ? res.additionals : []),
      ].slice(0, 60);
      const t = now();
      for (const r of records) {
        if (!r || typeof r.name !== 'string' || r.name.length > 255) continue;
        const name = r.name.toLowerCase();
        if (
          r.type === 'PTR' &&
          name === SERVICE &&
          typeof r.data === 'string' &&
          r.data.toLowerCase().endsWith('.' + SERVICE)
        ) {
          const label = r.data.slice(0, r.data.length - SERVICE.length - 1);
          if (
            !label ||
            label.length > 80 ||
            (!instances.has(r.data.toLowerCase()) && instances.size >= MAX_SERVERS)
          )
            continue;
          const key = r.data.toLowerCase(),
            inst = instances.get(key) || { label, srv: null, txt: null, addrs: new Set(), seen: t };
          inst.seen = t;
          instances.set(key, inst);
        } else if (name.endsWith('.' + SERVICE) && instances.has(name)) {
          const inst = instances.get(name);
          if (
            r.type === 'SRV' &&
            r.data &&
            typeof r.data.target === 'string' &&
            r.data.target.length <= 255
          ) {
            inst.srv = { target: r.data.target.toLowerCase() };
            inst.seen = t;
          }
          if (r.type === 'TXT') {
            inst.txt = parseTxt(r.data);
            inst.seen = t;
          }
        } else if (r.type === 'A' && typeof r.data === 'string' && isLocalV4(r.data)) {
          const set = hosts.get(name) || new Set();
          if (set.size < MAX_ADDRESSES) set.add(r.data);
          if (hosts.size < 200 || hosts.has(name)) hosts.set(name, set);
        }
      }
      for (const inst of instances.values())
        if (inst.srv) inst.addrs = new Set(hosts.get(inst.srv.target) || []);
      changed();
    } catch {
      /* a damaged packet is dropped */
    }
  }

  function list() {
    const t = now(),
      out = [];
    for (const [key, inst] of instances) {
      if (t - inst.seen > TTL_MS) {
        instances.delete(key);
        continue;
      }
      const d = describe(inst);
      if (d) out.push(d);
    }
    return out.sort((a, b) => a.name.localeCompare(b.name)).slice(0, MAX_SERVERS);
  }

  const ask = () => {
    try {
      mdns.query({ questions: [{ name: SERVICE, type: 'PTR' }] });
    } catch {
      /* the network may be down: try again next time */
    }
  };
  function start(onChange) {
    listener = onChange || null;
    if (mdns) {
      ask();
      return { ok: true };
    }
    try {
      mdns = mdnsFactory();
    } catch (e) {
      mdns = null;
      return {
        error:
          'Looking for servers on the network did not start. ' +
          (e && e.code === 'EADDRINUSE'
            ? 'Another program is using the discovery port.'
            : 'The network does not allow it.'),
      };
    }
    mdns.on('response', onResponse);
    mdns.on('error', () => {
      /* an unreachable network is not an error worth showing */
    });
    ask();
    timer = setTimer(() => {
      ask();
      changed();
    }, QUERY_EVERY_MS);
    if (timer && timer.unref) timer.unref();
    return { ok: true };
  }
  function stop() {
    if (timer) clearTimer(timer);
    timer = null;
    listener = null;
    if (mdns) {
      try {
        mdns.destroy();
      } catch {
        /* already closed */
      }
    }
    mdns = null;
    instances.clear();
    hosts.clear();
  }
  return { start, stop, list };
}

module.exports = { create, isLocalV4, parseTxt, describe, SERVICE };
