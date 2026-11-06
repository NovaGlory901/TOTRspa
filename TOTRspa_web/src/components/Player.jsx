import { useState } from 'react';
import { usePlayer } from '../player.jsx';
import { Cover, clock } from './Bits.jsx';
import { useMixtapePicker } from './MixtapePicker.jsx';
import { Next, Pause, Play, Prev } from './Icons.jsx';

// The strip above the tab bar while something is loaded; tap it for the full player.
export function MiniPlayer() {
  const { song, playing, toggle, next, time } = usePlayer();
  const [open, setOpen] = useState(false);
  if (!song) return null;
  const pct = time.total ? Math.min(100, (time.now / time.total) * 100) : 0;
  return (
    <>
      <div className="mini">
        <div className="mini-bar" style={{ width: `${pct}%` }} />
        <button className="mini-main" onClick={() => setOpen(true)} aria-label="Open the player">
          <Cover albumId={song.album_id} className="tiny" />
          <span className="t-text">
            <span className="t-title">{song.title}</span>
            <span className="t-sub">{song.artists}</span>
          </span>
        </button>
        <button className="icon big" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? <Pause /> : <Play />}
        </button>
        <button className="icon big" onClick={next} aria-label="Next song">
          <Next />
        </button>
      </div>
      {open && <FullPlayer onClose={() => setOpen(false)} />}
    </>
  );
}

function FullPlayer({ onClose }) {
  const { song, playing, toggle, next, prev, seek, time, queue, index } = usePlayer();
  const pick = useMixtapePicker();
  if (!song) return null;
  return (
    <div className="full" role="dialog" aria-label="Player">
      <button className="icon close" onClick={onClose} aria-label="Close the player">
        v
      </button>
      <Cover albumId={song.album_id} className="huge" glyph="[disc]" />
      <h2 className="np-title">{song.title}</h2>
      <p className="muted np-artist">{song.artists}</p>
      <input
        type="range"
        className="seek"
        min="0"
        max={Math.max(1, Math.floor(time.total))}
        value={Math.floor(time.now)}
        onChange={e => seek(Number(e.target.value))}
        aria-label="Seek"
      />
      <div className="times">
        <span>{clock(time.now)}</span>
        <span>{clock(time.total)}</span>
      </div>
      <div className="transport">
        <button className="icon xl" onClick={prev} aria-label="Previous song">
          <Prev />
        </button>
        <button className="icon xl main" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? <Pause /> : <Play />}
        </button>
        <button className="icon xl" onClick={next} aria-label="Next song">
          <Next />
        </button>
      </div>
      <div className="actions center">
        <button onClick={() => pick([song.track_id])}>+ Add to a mixtape</button>
      </div>
      <p className="muted center">
        song {index + 1} of {queue.length}
      </p>
    </div>
  );
}
