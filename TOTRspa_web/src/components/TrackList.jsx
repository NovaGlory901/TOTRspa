import { usePlayer } from '../player.jsx';
import { useMixtapePicker } from './MixtapePicker.jsx';
import { Play } from './Icons.jsx';

// Rows of songs. Tapping a row plays the list from that song; "+" adds it to a mixtape.
export default function TrackList({ tracks, numbered = false, onRemove, extra }) {
  const { play, song } = usePlayer();
  const pick = useMixtapePicker();
  return (
    <div className="tracks">
      {tracks.map((t, i) => (
        <div
          key={t.entry_id || `${t.track_id}-${i}`}
          className={`track${song && song.track_id === t.track_id ? ' playing' : ''}`}
        >
          <button className="row-main" onClick={() => play(tracks, i)}>
            <span className="num">{numbered ? (t.track_number ?? i + 1) : <Play />}</span>
            <span className="t-text">
              <span className="t-title">{t.title}</span>
              <span className="t-sub">{t.artists}</span>
            </span>
          </button>
          {extra && extra(t, i)}
          <button
            className="icon"
            aria-label={`Add ${t.title} to a mixtape`}
            onClick={() => pick([t.track_id])}
          >
            +
          </button>
          {onRemove && (
            <button className="icon" aria-label={`Remove ${t.title}`} onClick={() => onRemove(t)}>
              x
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export function PlayAll({ tracks, label = 'Play all', addAll = true }) {
  const { play } = usePlayer();
  const pick = useMixtapePicker();
  if (!tracks.length) return null;
  return (
    <div className="actions">
      <button onClick={() => play(tracks, 0)}>
        <Play /> {label}
      </button>
      {addAll && (
        <button onClick={() => pick(tracks.map(t => t.track_id))}>+ Add all to a mixtape</button>
      )}
    </div>
  );
}
