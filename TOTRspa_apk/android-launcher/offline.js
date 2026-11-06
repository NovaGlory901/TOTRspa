// The offline player. This page is bundled in the app and runs with the network shut (see
// GuardClient.java): it reads the mixtapes saved on the phone (TotrNative.offlineIndex) and plays
// their files from https://localhost/_offline/<file>. The only way out is the "Go online" button.
const N = window.TotrNative;
const $ = id => document.getElementById(id);
const audio = $('audio'),
  view = $('view');
let mixtapes = [];
try {
  mixtapes = (JSON.parse(N.offlineIndex()).mixtapes || []).filter(
    m => m && Array.isArray(m.tracks),
  );
} catch {
  mixtapes = [];
}
const file = f => (f ? `/_offline/${encodeURIComponent(f)}` : '');
const text = (tag, cls, t) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.textContent = t;
  return e;
}; // textContent only: names come from the user but are still never parsed as HTML

let queue = [],
  at = -1,
  shuffle = false,
  openId = null;

function home() {
  openId = null;
  view.replaceChildren();
  view.append(text('h2', '', 'your mixtapes'));
  if (!mixtapes.length) {
    const p = document.createElement('div');
    p.className = 'panel';
    p.append(
      text('p', '', 'No mixtapes are saved on this phone yet.'),
      text(
        'p',
        'muted',
        'While online, open a mixtape and press "Save for offline". Then come back here.',
      ),
    );
    view.append(p);
  }
  for (const m of mixtapes) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tape';
    const cover = (m.tracks.find(t => t.cover) || {}).cover;
    if (cover) {
      const i = document.createElement('img');
      i.src = file(cover);
      i.alt = '';
      b.append(i);
    } else b.append(Object.assign(document.createElement('div'), { className: 'cover' }));
    const d = document.createElement('div');
    d.append(
      text('b', '', m.name || 'mixtape'),
      text('span', '', `${m.tracks.length} song${m.tracks.length === 1 ? '' : 's'}`),
    );
    b.append(d);
    b.onclick = () => tape(m.id);
    view.append(b);
  }
}

function tape(id) {
  const m = mixtapes.find(x => x.id === id);
  if (!m) return home();
  openId = id;
  view.replaceChildren();
  const back = text('button', '', '< all mixtapes');
  back.type = 'button';
  back.onclick = home;
  view.append(back, text('h2', '', m.name || 'mixtape'));
  const row = document.createElement('div');
  row.className = 'row';
  const play = text('button', 'primary', 'Play');
  play.type = 'button';
  play.onclick = () => start(m.tracks, 0, false);
  const shuf = text('button', '', 'Shuffle');
  shuf.type = 'button';
  shuf.onclick = () => start(m.tracks, Math.floor(Math.random() * m.tracks.length), true);
  row.append(play, shuf);
  view.append(row);
  m.tracks.forEach((t, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'song' + (queue === m.tracks && at === i ? ' now' : '');
    if (t.cover) {
      const im = document.createElement('img');
      im.className = 'cover';
      im.src = file(t.cover);
      im.alt = '';
      b.append(im);
    }
    const d = document.createElement('div');
    d.append(text('b', '', t.title || 'untitled'), text('span', '', t.artists || ''));
    b.append(d);
    b.onclick = () => start(m.tracks, i, false);
    view.append(b);
  });
}

function start(list, i, shuf) {
  queue = list;
  shuffle = shuf;
  load(i, true);
  if (openId) tape(openId);
}

function load(i, autoplay) {
  const t = queue[i];
  if (!t) return;
  at = i;
  audio.src = file(t.file);
  if (autoplay) audio.play().catch(() => {});
  $('bar').hidden = false;
  document.body.classList.add('playing');
  $('barTitle').textContent = t.title || 'untitled';
  $('barArtist').textContent = t.artists || '';
  const c = $('barCover');
  if (t.cover) {
    c.src = file(t.cover);
    c.hidden = false;
  } else c.hidden = true;
  if (N && N.setCover) N.setCover(t.cover ? `${location.origin}/_offline/${t.cover}` : '');
  tell();
}
function nextIndex() {
  if (shuffle && queue.length > 1) {
    let n;
    do {
      n = Math.floor(Math.random() * queue.length);
    } while (n === at);
    return n;
  }
  return (at + 1) % queue.length;
}
const next = () => {
  if (queue.length) {
    load(nextIndex(), true);
    if (openId) tape(openId);
  }
};
const prev = () => {
  if (!queue.length) return;
  if (audio.currentTime > 3) audio.currentTime = 0;
  else {
    load((at - 1 + queue.length) % queue.length, true);
    if (openId) tape(openId);
  }
};
const toggle = () => {
  if (!audio.src) return;
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
};

function tell() {
  // the lock screen and notification
  const t = queue[at];
  if (!t || !N || !N.update) return;
  try {
    N.update(
      t.title || '',
      t.artists || '',
      !audio.paused,
      Math.round(audio.currentTime * 1000),
      Math.round((isFinite(audio.duration) ? audio.duration : 0) * 1000),
    );
  } catch (e) {
    /* the music plays either way */
  }
}

$('prev').innerHTML = totrIcon('prev');
$('next').innerHTML = totrIcon('next');
$('toggle').innerHTML = totrIcon('play');
$('prev').onclick = prev;
$('next').onclick = next;
$('toggle').onclick = toggle;
audio.addEventListener('play', () => {
  $('toggle').innerHTML = totrIcon('pause');
  tell();
});
audio.addEventListener('pause', () => {
  $('toggle').innerHTML = totrIcon('play');
  tell();
});
audio.addEventListener('ended', next);
audio.addEventListener('loadedmetadata', tell);
audio.addEventListener('seeked', tell);
audio.addEventListener('error', () => {
  if (queue.length > 1) setTimeout(next, 600);
});
audio.addEventListener('timeupdate', () => {
  if (isFinite(audio.duration) && audio.duration > 0 && !seeking)
    $('seek').value = Math.round((audio.currentTime / audio.duration) * 1000);
});
let seeking = false;
$('seek').addEventListener('input', () => {
  seeking = true;
  if (isFinite(audio.duration)) audio.currentTime = (audio.duration * $('seek').value) / 1000;
});
$('seek').addEventListener('change', () => {
  seeking = false;
});

window.__totrMedia = a => {
  if (a === 'play') {
    if (audio.paused) toggle();
  } else if (a === 'pause') {
    if (!audio.paused) toggle();
  } else if (a === 'next') next();
  else if (a === 'prev') prev();
};
window.__totrSeek = ms => {
  if (Number.isFinite(ms)) audio.currentTime = ms / 1000;
};

$('online').onclick = () => {
  audio.pause();
  if (N && N.goOnline) N.goOnline();
};
home();
