import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { audioUrl, coverUrl, ping, radioNext } from './api.js';
import { nativeButtons, nativeCover, nativeStop, nativeUpdate } from './native.js';
import { ampInstance } from './amp.js';

// One audio element for the whole app, so a song keeps playing while you move between pages. Songs
// are {track_id, title, artists, album_id}. The lock-screen / notification controls come from the
// Media Session API. What was played last is kept on this device (not the server) for the Home
// page's "continue listening" and "recently played" rows.
const Ctx = createContext(null);
export const usePlayer = () => useContext(Ctx);

const RECENT_MAX = 20,
  RADIO_QUEUE_MAX = 200;
const read = (key, fallback) => {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
};
const write = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage blocked: Home just has less to show */
  }
};
const slim = t => ({
  track_id: t.track_id,
  title: t.title,
  artists: t.artists || '',
  album_id: t.album_id || null,
});

export function PlayerProvider({ username, children }) {
  const audio = useRef(null);
  if (!audio.current) audio.current = new Audio();
  const keyRecent = `totr.app.${username}.recent`,
    keyLast = `totr.app.${username}.last`;

  const [queue, setQueue] = useState([]);
  const [index, setIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState({ now: 0, total: 0 });
  const [recent, setRecent] = useState(() => read(keyRecent, []));
  // {song, position}: where "continue listening" resumes
  const [last, setLast] = useState(() => read(keyLast, null));
  // radio mode: the queue grows with a random song whenever it runs out
  const [radio, setRadio] = useState(false);
  const radioOn = useRef(false);
  const radioBusy = useRef(false);
  // the next radio song, fetched while this one plays: with the screen off a phone can freeze the
  // page once the sound stops, so the next song must not need the network at the moment this one
  // ends
  const pending = useRef(null);
  const [radioError, setRadioError] = useState('');
  const errors = useRef(0);
  const state = useRef({ queue, index });
  state.current = { queue, index };
  const song = index >= 0 ? queue[index] : null;

  const load = useCallback(
    (list, i, { autoplay = true, startAt = 0 } = {}) => {
      const t = list[i];
      if (!t) return;
      setQueue(list);
      setIndex(i);
      const a = audio.current;
      a.src = audioUrl(t.track_id);
      if (startAt)
        a.addEventListener(
          'loadedmetadata',
          () => {
            a.currentTime = startAt;
          },
          { once: true },
        );
      if (autoplay) a.play().catch(() => {});
      if (radioOn.current && i === list.length - 1) {
        // radio: get the following song ready now
        pending.current = null;
        radioNext(list.slice(-40).map(x => x.track_id)).then(
          n => {
            if (radioOn.current && state.current.queue[state.current.index] === t)
              pending.current = slim(n);
          },
          () => {},
        );
      }
      setRecent(prev => {
        const next = [slim(t), ...prev.filter(x => x.track_id !== t.track_id)].slice(0, RECENT_MAX);
        write(keyRecent, next);
        return next;
      });
    },
    [keyRecent],
  );

  const next = useCallback(async () => {
    const { queue: q, index: i } = state.current;
    if (i + 1 < q.length) return load(q, i + 1);
    if (!radioOn.current) return audio.current.pause();
    if (radioBusy.current) return undefined;
    radioBusy.current = true;
    try {
      const ready = pending.current;
      pending.current = null;
      // the server skips songs played lately
      const t = ready || (await radioNext(q.slice(-40).map(x => x.track_id)));
      if (!radioOn.current) return undefined;
      let list = [...q, slim(t)];
      let at = list.length - 1;
      if (list.length > RADIO_QUEUE_MAX) {
        list = list.slice(-RADIO_QUEUE_MAX / 2);
        at = list.length - 1;
      }
      setRadioError('');
      load(list, at);
    } catch (e) {
      setRadioError(e.message || 'signal lost');
      radioOn.current = false;
      setRadio(false);
      audio.current.pause();
    } finally {
      radioBusy.current = false;
    }
    return undefined;
  }, [load]);
  const prev = useCallback(() => {
    const { queue: q, index: i } = state.current;
    if (audio.current.currentTime > 3 || i <= 0) audio.current.currentTime = 0;
    else load(q, i - 1);
  }, [load]);
  const toggle = useCallback(() => {
    const a = audio.current;
    if (!a.src) return;
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  }, []);
  const seek = useCallback(seconds => {
    audio.current.currentTime = seconds;
  }, []);
  const play = useCallback(
    (list, i = 0) => {
      radioOn.current = false;
      pending.current = null;
      setRadio(false);
      load(list.map(slim), i);
    },
    [load],
  );
  const startRadio = useCallback(() => {
    // must run inside a tap: the phone only lets audio start then
    radioOn.current = true;
    setRadio(true);
    setRadioError('');
    if (state.current.queue.length && state.current.index >= 0 && audio.current.src) {
      audio.current.play().catch(() => {});
      return;
    }
    next();
  }, [next]);
  const stopRadio = useCallback(() => {
    radioOn.current = false;
    pending.current = null;
    setRadio(false);
    audio.current.pause();
  }, []);
  const resumeLast = useCallback(() => {
    if (last) load([last.song], 0, { startAt: last.position });
  }, [last, load]);

  useEffect(() => {
    const a = audio.current;
    const on = (name, fn) => {
      a.addEventListener(name, fn);
      return () => a.removeEventListener(name, fn);
    };
    const offs = [
      on('play', () => setPlaying(true)),
      on('pause', () => setPlaying(false)),
      on('playing', () => {
        errors.current = 0;
      }),
      on('ended', () => {
        errors.current = 0;
        next();
      }),
      on('error', () => {
        if (a.src && ++errors.current < 5) setTimeout(next, 800);
      }), // skip a broken file, but not forever
      on('timeupdate', () =>
        setTime({ now: a.currentTime, total: isFinite(a.duration) ? a.duration : 0 }),
      ),
    ];
    return () => offs.forEach(f => f());
  }, [next]);

  // remember where we were, about every 5 seconds and when the app is hidden
  useEffect(() => {
    if (!song) return undefined;
    const save = () => {
      const next = { song: slim(song), position: Math.floor(audio.current.currentTime) };
      write(keyLast, next);
      setLast(next);
    };
    const timer = setInterval(() => {
      if (!audio.current.paused) save();
    }, 5000);
    document.addEventListener('visibilitychange', save);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', save);
    };
  }, [song, keyLast]);

  // tell the server who is listening (the admin Status tab shows it): every 30 s while playing,
  // plus on changes
  useEffect(() => {
    const send = () =>
      ping(song ? song.track_id : null, !song ? 'stopped' : playing ? 'playing' : 'paused').catch(
        () => {},
      );
    send();
    if (!playing) return undefined;
    const timer = setInterval(send, 30000);
    return () => clearInterval(timer);
  }, [song, playing]);

  // the equalizer's title ticker, once the rack has been opened
  useEffect(() => {
    const a = ampInstance();
    if (a) a.rack.setNowPlaying(song ? { title: song.title, artist: song.artists } : null);
  }, [song]);

  // lock screen and notification controls
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    if (song) {
      ms.metadata = new MediaMetadata({
        title: song.title,
        artist: song.artists,
        album: '',
        artwork: song.album_id
          ? [{ src: new URL(coverUrl(song.album_id), location.href).href, sizes: '512x512' }]
          : [],
      });
    }
    ms.playbackState = playing ? 'playing' : song ? 'paused' : 'none';
  }, [song, playing]);
  useEffect(() => {
    if (!('mediaSession' in navigator)) return undefined;
    const ms = navigator.mediaSession;
    const set = (action, fn) => {
      try {
        ms.setActionHandler(action, fn);
      } catch {
        /* not supported here */
      }
    };
    set('play', toggle);
    set('pause', toggle);
    set('nexttrack', next);
    set('previoustrack', prev);
    set('seekto', e => {
      if (e.seekTime != null) seek(e.seekTime);
    });
    return () =>
      ['play', 'pause', 'nexttrack', 'previoustrack', 'seekto'].forEach(a => set(a, null));
  }, [toggle, next, prev, seek]);

  // Android app: the native service keeps the music alive with the screen off and shows the
  // controls (see native.js; it does nothing elsewhere)
  useEffect(() => {
    if (!song) {
      nativeStop();
      return;
    }
    nativeCover(song.album_id ? new URL(coverUrl(song.album_id), location.href).href : '');
    nativeUpdate({
      title: song.title,
      artist: song.artists,
      playing,
      positionSec: audio.current.currentTime,
      durationSec: time.total,
    });
  }, [song, playing, time.total]);
  useEffect(
    () =>
      nativeButtons({
        play: () => {
          if (audio.current.paused) toggle();
        },
        pause: () => {
          if (!audio.current.paused) toggle();
        },
        next,
        prev,
        seek,
      }),
    [toggle, next, prev, seek],
  );

  const value = useMemo(
    () => ({
      audio: audio.current,
      queue,
      index,
      song,
      playing,
      time,
      recent,
      last,
      radio,
      radioError,
      play,
      next,
      prev,
      toggle,
      seek,
      resumeLast,
      startRadio,
      stopRadio,
    }),
    [
      queue,
      index,
      song,
      playing,
      time,
      recent,
      last,
      radio,
      radioError,
      play,
      next,
      prev,
      toggle,
      seek,
      resumeLast,
      startRadio,
      stopRadio,
    ],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
