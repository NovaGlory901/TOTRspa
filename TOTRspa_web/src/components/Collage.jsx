import { useEffect, useRef } from 'react';
import { coverUrl } from '../api.js';

// The radio's drifting dreamcore collage, ported from the web portal's radio page: covers and
// pictures, fake "dream windows", floating phrases and glowing orbs, animated with the Web
// Animations API. Layers are plain DOM elements that remove themselves when done.
const PHRASES = [
  'you are here',
  'nothing is lost',
  '夢',
  'remember the internet',
  'あなたは ここに いる',
  'the signal is warm',
  'wake up later',
  'ｗｅｌｃｏｍｅ ｈｏｍｅ',
  '00:00 forever',
  '窓の向こう',
  'still loading...',
  'this is a safe place',
  '再生中',
  'you were always here',
  '✦ ✦ ✦',
  'low battery, high hopes',
];
const BLENDS = ['screen', 'lighten', 'soft-light', 'overlay', 'normal', 'difference'];
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const reduce = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function Collage({ active, song, media }) {
  const box = useRef(null);
  const live = useRef({ song, media });
  live.current = { song, media };

  // the song's own cover drifts in front each time the song changes
  useEffect(() => {
    if (active && song && song.album_id && box.current)
      spawnMedia(box.current, { type: 'image', url: coverUrl(song.album_id) }, true);
  }, [active, song && song.track_id]);

  useEffect(() => {
    if (!active || !box.current) return undefined;
    const el = box.current;
    const max = reduce() ? 4 : 7;
    const spawn = () => {
      if (document.hidden || el.children.length >= max) return;
      const r = Math.random(),
        { media: pool, song: now } = live.current;
      if (r < 0.48 && pool && pool.length) {
        if (spawnMedia(el, pick(pool), false)) return;
      }
      if (r < 0.66) spawnWindow(el, now);
      else if (r < 0.86) spawnPhrase(el);
      else spawnOrb(el);
    };
    const first = [0, 1, 2].map(i => setTimeout(spawn, i * 400));
    const timer = setInterval(spawn, reduce() ? 4000 : 2400);
    return () => {
      first.forEach(clearTimeout);
      clearInterval(timer);
    };
  }, [active]);

  return <div className="layers" ref={box} />;
}

function drift(e, opacity, ms) {
  const calm = reduce();
  const rot = calm ? 0 : rnd(-14, 14),
    dx = calm ? 0 : rnd(-18, 18),
    dy = calm ? 0 : rnd(-14, 14);
  const anim = e.animate(
    [
      { opacity: 0, transform: `translate(0,0) rotate(${rot}deg) scale(.9)` },
      { opacity, offset: 0.18 },
      { opacity, offset: 0.8 },
      {
        opacity: 0,
        transform: `translate(${dx}vw,${dy}vh) rotate(${rot + rnd(-10, 10)}deg) scale(${calm ? 1 : rnd(0.85, 1.3)})`,
      },
    ],
    { duration: ms, easing: 'ease-in-out', fill: 'forwards' },
  );
  anim.onfinish = () => {
    if (e.tagName === 'VIDEO') {
      e.pause();
      e.removeAttribute('src');
      e.load();
    }
    e.remove();
  };
}

function put(box, e, widthPct, opacity, ms) {
  e.classList.add('layer');
  e.style.left = rnd(-6, 70) + '%';
  e.style.top = rnd(-6, 68) + '%';
  if (widthPct) e.style.width = widthPct + '%';
  e.style.zIndex = Math.floor(rnd(1, 9));
  box.append(e);
  drift(e, opacity, ms);
}

function spawnMedia(box, item, hero) {
  const w = hero ? rnd(44, 62) : rnd(24, 48);
  const style = e => {
    e.style.mixBlendMode = hero ? 'normal' : pick(BLENDS);
    e.style.filter = `hue-rotate(${Math.floor(rnd(-40, 40))}deg) saturate(${rnd(1, 1.6).toFixed(2)}) blur(${hero ? 0 : rnd(0, 2).toFixed(1)}px)`;
  };
  if (item.type === 'video') {
    if (box.querySelectorAll('video').length >= 1) return false; // phones decode one clip at a time
    const v = document.createElement('video');
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.autoplay = true;
    v.onerror = () => v.remove();
    v.onloadeddata = () => {
      style(v);
      put(box, v, w, rnd(0.4, 0.75), rnd(18000, 32000));
      v.play().catch(() => {});
    };
    v.src = item.url;
  } else {
    const img = new Image();
    img.alt = '';
    img.onload = () => {
      style(img);
      put(box, img, w, hero ? 0.85 : rnd(0.35, 0.8), hero ? 26000 : rnd(14000, 28000));
    };
    img.src = item.url; // a 404 just means nothing appears
  }
  return true;
}

function spawnOrb(box) {
  const o = document.createElement('div');
  o.className = 'orb';
  const h = Math.floor(rnd(150, 340));
  o.style.background = `radial-gradient(circle, hsla(${h},95%,78%,.9), hsla(${h + 40},90%,70%,0) 68%)`;
  put(box, o, rnd(30, 56), rnd(0.4, 0.8), rnd(12000, 24000));
}

function spawnPhrase(box) {
  const p = document.createElement('div');
  const text = pick(PHRASES);
  p.className = 'phrase' + (/[぀-ヿ一-鿿]/.test(text) && Math.random() < 0.6 ? ' v' : '');
  p.textContent = text;
  put(box, p, 0, rnd(0.5, 0.9), rnd(9000, 18000));
}

function spawnWindow(box, song) {
  const w = document.createElement('div');
  w.className = 'dwin';
  const bar = document.createElement('div');
  bar.className = 'dbar';
  const t = document.createElement('span');
  t.textContent = (song ? song.title : pick(PHRASES)).slice(0, 22) + '.exe';
  const x = document.createElement('span');
  x.textContent = '_ o x';
  bar.append(t, x);
  const body = document.createElement('div');
  body.className = 'dbody';
  const lines =
    Math.random() < 0.5 && song
      ? ['now playing:', song.title, song.artists]
      : [pick(PHRASES), pick(PHRASES)];
  lines.forEach(l => {
    const d = document.createElement('div');
    d.textContent = l;
    body.append(d);
  });
  w.append(bar, body);
  put(box, w, 0, rnd(0.6, 0.9), rnd(10000, 20000));
}
