import { useEffect, useRef, useState } from 'react';
import { api, coverUrl } from '../api.js';
import { usePlayer } from '../player.jsx';
import Collage from '../components/Collage.jsx';
import { Next, Pause, Play, Prev } from '../components/Icons.jsx';
import { ampInstance, handlers, openAmp } from '../amp.js';
import { fhInstance, handlers as fhHandlers, openFh, sceneFor } from '../fh.js';

// Nonstop random music over the drifting collage. The radio uses the app's one player, so the mini
// player and lock-screen controls work too.
export default function Radio({ username }) {
  const { audio, radio, radioError, song, playing, startRadio, stopRadio, toggle, next, prev } =
    usePlayer();
  const [media, setMedia] = useState([]);
  useEffect(() => {
    let live = true;
    api('/api/radio/media').then(
      m => live && setMedia(m),
      () => {},
    );
    return () => {
      live = false;
    };
  }, []);
  const slot = useRef(null);
  const [ampOpen, setAmpOpen] = useState(false);
  Object.assign(handlers, { prev, next, toggle }); // the rack's own buttons drive the app's player
  useEffect(() => {
    const a = ampInstance();
    if (a && slot.current) {
      slot.current.append(a.el);
      setAmpOpen(true);
    }
  }, []); // it was opened earlier this session
  const toggleAmp = () => {
    if (ampOpen) {
      setAmpOpen(false);
      return;
    }
    // inside this tap: the browser allows the audio graph to be built now
    const a = openAmp(audio, username);
    slot.current.append(a.el);
    setAmpOpen(true);
  };

  // FalseHorizon (the visuals). Tapping "Visuals" builds it (and the audio graph under it) once;
  // the page then shows or hides it from its settings.
  const stage = useRef(null),
    vizSlot = useRef(null);
  const [vizOpen, setVizOpen] = useState(false),
    [vizOn, setVizOn] = useState(false),
    [presetName, setPresetName] = useState('');
  const nameTimer = useRef(0);
  const syncViz = () => {
    const f = fhInstance();
    if (!f || !stage.current) return;
    const s = f.ui.settings(),
      e = f.engine,
      want = !!(e.supported && s.on);
    const src = want ? sceneFor(stage.current.querySelector('.layers'), syncViz) : null;
    e.setScene(src);
    stage.current.classList.toggle('fh-on', !!src);
    f.canvas.hidden = !want;
    e.setIntensity(s.intensity);
    if (want) e.start();
    else e.stop();
    f.ui.setStatus(e.supported ? '' : e.reason);
    setVizOn(want);
  };
  Object.assign(fhHandlers, {
    change: syncViz,
    preset: name => {
      setPresetName(name);
      clearTimeout(nameTimer.current);
      nameTimer.current = setTimeout(() => setPresetName(''), 3500);
    },
  });
  const attachViz = f => {
    stage.current.insertBefore(f.canvas, stage.current.querySelector('.vignette'));
    vizSlot.current.append(f.el);
    setVizOpen(true);
    syncViz();
  };
  useEffect(() => {
    // it was opened earlier this session
    const f = fhInstance();
    if (f && f.ui.settings().on) attachViz(f);
    return () => {
      const g = fhInstance();
      if (g) {
        g.engine.stop();
        g.engine.setScene(null);
        g.canvas.remove();
      }
      clearTimeout(nameTimer.current);
    };
  }, []);
  const toggleViz = () => {
    const f = fhInstance();
    if (f && vizOpen) {
      f.ui.change({ on: false });
      setVizOpen(false);
      return;
    }
    // inside this tap: the browser allows the audio graph to be built now
    const g = openFh(audio, username);
    g.ui.change({ on: true });
    attachViz(g);
  };
  useEffect(() => {
    const f = fhInstance();
    if (f) f.engine.setSources(media.filter(m => m.type === 'image').map(m => m.url));
  }, [media, vizOpen]);
  useEffect(() => {
    const f = fhInstance();
    if (f && song && song.album_id) f.engine.prioritise(coverUrl(song.album_id));
  }, [song && song.track_id, vizOpen]);

  const [showing, setShowing] = useState(true);
  useEffect(() => {
    const f = () => setShowing(!document.hidden);
    document.addEventListener('visibilitychange', f);
    return () => document.removeEventListener('visibilitychange', f);
  }, []);

  return (
    <>
      <div className="actions center">
        <button onClick={prev} disabled={!radio}>
          <Prev /> Prev
        </button>
        <button onClick={toggle} disabled={!radio}>
          {playing ? (
            <>
              <Pause /> Pause
            </>
          ) : (
            <>
              <Play /> Play
            </>
          )}
        </button>
        <button onClick={next} disabled={!radio}>
          Skip <Next />
        </button>
        <button onClick={stopRadio} disabled={!radio}>
          Tune out
        </button>
      </div>
      <div className="stage" ref={stage}>
        <div className="sky" />
        <div className="stars" />
        <div className="floor" />
        <Collage active={radio && showing} song={song} media={media} />
        <div
          className="fh-name"
          role="status"
          aria-live="polite"
          style={{ opacity: presetName ? 0.9 : 0 }}
        >
          {presetName}
        </div>
        <div className="vignette" />
        {!radio && (
          <div className="intro">
            <h2>TOTR Radio</h2>
            <p className="muted">Nonstop music from the archive. Headphones recommended.</p>
            <button onClick={startRadio}>Tune in</button>
            {radioError && (
              <p className="bad" role="status">
                {radioError}
              </p>
            )}
            <p className="muted">
              {media.length ? `${media.length} pictures and videos in the sky` : ''}
            </p>
          </div>
        )}
      </div>
      <div className="strip">
        <div className="t-text">
          <b className="t-title">{radio && song ? song.title : 'off air'}</b>
          <span className="t-sub">{radio && song ? song.artists : 'press Tune in to start'}</span>
        </div>
      </div>
      <div className="actions center">
        <button onClick={toggleAmp} aria-expanded={ampOpen}>
          DejaVuAmp: {ampOpen ? 'hide' : 'equalizer'}
        </button>
        <button onClick={toggleViz} aria-expanded={vizOpen}>
          Visuals: {vizOpen && vizOn ? 'on' : 'off'}
        </button>
      </div>
      <div ref={slot} className="amp-slot" hidden={!ampOpen} />
      <div ref={vizSlot} className="fh-slot" hidden={!vizOpen} />
    </>
  );
}
