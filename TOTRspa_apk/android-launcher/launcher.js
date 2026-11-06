// The first page of the Android app. It decides what to show:
//   offline mode on          -> the offline player (offline.html), without looking for any server;
//   no server saved yet      -> ask for the address;
//  server saved -> check it answers, then open <server>/app/ (the listener app the server
// publishes);
//  server does not answer -> the NO SIGNAL screen (retry, offline mode, change server) and a small
// secret.
const N = window.TotrNative;
const KEY = 'totr.server';
const $ = id => document.getElementById(id);
const clean = v => (v || '').trim().replace(/\/+$/, '');
const saved = () => {
  try {
    return clean(localStorage.getItem(KEY));
  } catch {
    return '';
  }
};
const show = id => {
  for (const s of ['looking', 'setup', 'nosignal', 'dial']) $(s).hidden = s !== id;
};
const canOffline = () => !!(N && typeof N.goOffline === 'function');

function open(origin) {
  try {
    localStorage.setItem(KEY, origin);
  } catch {
    /* storage blocked: asked again next launch */
  }
  // in use now, and on the saved list
  if (N && typeof N.rememberServer === 'function') N.rememberServer(origin);
  location.replace(`${origin}/app/`);
}

function parse(v) {
  let u;
  try {
    u = new URL(v);
  } catch {
    return { error: 'That is not a web address.' };
  }
  if (u.protocol === 'http:')
    return { error: 'The app only talks to a server over https. Use an https:// address.' };
  if (u.protocol !== 'https:') return { error: 'Use an https:// address.' };
  return { origin: u.origin };
}

// Look for the server, then open it or show NO SIGNAL. An install from before the check existed
// just opens it, as it always did.
function look(origin) {
  show('looking');
  $('lookingText').textContent = 'tuning in...';
  if (!N || typeof N.probe !== 'function') {
    open(origin);
    return;
  }
  window.__totrProbe = (o, ok) => {
    if (o !== origin) return;
    if (ok) open(origin);
    else noSignal(origin);
  };
  N.probe(origin);
}

function noSignal(origin) {
  show('nosignal');
  $('why').textContent = origin.startsWith('http:')
    ? `${origin} is plain http, which this app no longer uses. Press Change server and enter the https address.`
    : `can't reach ${origin}`;
  $('goOffline').hidden = !canOffline();
  $('offlineHint').hidden = !canOffline();
  $('retry').onclick = () => look(origin);
  $('goOffline').onclick = () => N.goOffline();
  $('change').onclick = () => {
    $('server').value = origin;
    showSetup();
  };
  snow.start();
}

function showSetup() {
  snow.stop();
  show('setup');
  $('setupOffline').hidden = !canOffline();
  showSaved();
  // someone who came here by mistake can go back to the server they had
  $('setupBack').hidden = !saved();
  $('setupBack').onclick = () => look(saved());
  $('setupOfflineBtn').onclick = () => N.goOffline();
}

// The saved servers (kept by the app, see TotrBridge): tap one to go there. Not shown on an install
// from before the list existed.
function showSaved() {
  let info = null;
  try {
    info = N && typeof N.servers === 'function' ? JSON.parse(N.servers()) : null;
  } catch {
    info = null;
  }
  const list = $('savedList');
  list.replaceChildren();
  for (const s of (info && info.list) || []) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = s.name ? `${s.name} (${s.origin})` : s.origin;
    b.onclick = () => look(s.origin);
    list.append(b);
  }
  $('saved').hidden = !list.children.length;
}

$('f').addEventListener('submit', e => {
  e.preventDefault();
  const r = parse($('server').value);
  if (r.error) {
    $('err').textContent = r.error;
    return;
  }
  look(r.origin);
});

// the static on the NO SIGNAL screen
const snow = (() => {
  const c = $('snow'),
    g = c.getContext('2d'),
    img = g.createImageData(c.width, c.height);
  let raf = 0;
  const frame = () => {
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = Math.random() * 255;
      d[i] = v * 0.8;
      d[i + 1] = v * 0.85;
      d[i + 2] = v;
      d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    raf = requestAnimationFrame(frame);
  };
  // one frame of static, not moving
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  return {
    start() {
      if (raf) return;
      frame();
      if (still) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    },
    stop() {
      cancelAnimationFrame(raf);
      raf = 0;
    },
  };
})();

// a small secret: tap the _ five times
// A tuning dial. Between the stations there is only static (made here, quietly, once you touch the
// dial); on a station a few words come through. Find all four and the fifth one says something to
// you.
const STATIONS = [
  { f: 913, say: 'you are here' },
  { f: 977, say: 'nothing is lost' },
  { f: 1011, say: 'the signal is warm' },
  { f: 1045, say: 'remember the internet' },
];
const LAST = { f: 1079, say: 'the server is somewhere. so are you. it will be back.' };
const heard = new Set();
let taps = 0,
  tapTimer = 0,
  noise = null;
$('cursor').addEventListener('click', () => {
  clearTimeout(tapTimer);
  tapTimer = setTimeout(() => {
    taps = 0;
  }, 1500);
  if (++taps >= 5) {
    taps = 0;
    snow.stop();
    show('dial');
    tune();
  }
});
$('dialBack').onclick = () => {
  stopNoise();
  noSignal(saved());
};

function startNoise() {
  if (noise) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)(),
      buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate),
      d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(),
      gain = ctx.createGain();
    src.buffer = buf;
    src.loop = true;
    src.connect(gain);
    gain.connect(ctx.destination);
    src.start();
    noise = { ctx, gain };
  } catch {
    noise = { ctx: null, gain: null };
  }
}
function stopNoise() {
  if (noise && noise.ctx) noise.ctx.close();
  noise = null;
}

function tune() {
  const f = Number($('dialRange').value),
    all = STATIONS.concat(heard.size >= STATIONS.length ? [LAST] : []);
  $('dialShow').textContent = (f / 10).toFixed(1);
  const near = all.find(s => Math.abs(s.f - f) <= 2);
  const dist = Math.min(...all.map(s => Math.abs(s.f - f)));
  if (noise && noise.gain) noise.gain.gain.value = near ? 0.01 : Math.min(0.12, 0.03 + dist / 400);
  if (near) {
    heard.add(near.f);
    $('dialSay').textContent = near.say;
  } else $('dialSay').textContent = '';
  const left = STATIONS.length - STATIONS.filter(s => heard.has(s.f)).length;
  $('dialCount').textContent =
    heard.size >= STATIONS.length
      ? heard.has(LAST.f)
        ? 'every station found'
        : 'one more, near the top of the dial'
      : `${left} station${left === 1 ? '' : 's'} still hiding`;
}
$('dialRange').addEventListener('input', () => {
  startNoise();
  tune();
});

if (N && typeof N.isOffline === 'function' && N.isOffline()) location.replace('offline.html');
else {
  $('server').value = saved(); // no built-in address: a first run asks
  const use = new URLSearchParams(location.search).get('use'),
    r = use ? parse(use) : null; // the You tab's Servers panel asks for a saved server
  if (r && r.origin) look(r.origin);
  else if (saved() && !location.search.includes('change')) look(saved());
  else showSetup();
}
