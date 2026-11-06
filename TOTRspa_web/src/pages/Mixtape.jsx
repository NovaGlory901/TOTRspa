import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { deleteMixtape, mixtape, moveInMixtape, removeFromMixtape, renameMixtape } from '../api.js';
import { useLoad } from '../useLoad.js';
import { Loading, plural } from '../components/Bits.jsx';
import TrackList, { PlayAll } from '../components/TrackList.jsx';
import { SaveOffline } from '../components/Offline.jsx';

export default function Mixtape() {
  const { id } = useParams();
  const nav = useNavigate();
  const [version, setVersion] = useState(0);
  const m = useLoad(() => mixtape(id), [id, version]);
  const [msg, setMsg] = useState('');
  const again = () => setVersion(v => v + 1);
  const run = async fn => {
    setMsg('');
    try {
      await fn();
      again();
    } catch (e) {
      setMsg(e.message);
    }
  };
  if (!m.data) return <Loading state={m} />;
  const tracks = m.data.tracks;

  const rename = () => {
    const n = window.prompt('Rename this mixtape', m.data.name);
    if (n && n.trim()) run(() => renameMixtape(id, n.trim()));
  };
  const remove = async () => {
    if (!window.confirm(`Delete "${m.data.name}"? The songs stay in the archive.`)) return;
    try {
      await deleteMixtape(id);
      nav('/mixtapes', { replace: true });
    } catch (e) {
      setMsg(e.message);
    }
  };
  const mover = (t, i) => (
    <>
      <button
        className="icon"
        disabled={i === 0}
        aria-label="Move up"
        onClick={() => run(() => moveInMixtape(id, t.entry_id, 'up'))}
      >
        ^
      </button>
      <button
        className="icon"
        disabled={i === tracks.length - 1}
        aria-label="Move down"
        onClick={() => run(() => moveInMixtape(id, t.entry_id, 'down'))}
      >
        v
      </button>
    </>
  );
  return (
    <>
      <h1>{m.data.name}</h1>
      <p className="muted">{plural(tracks.length, 'song')}</p>
      <div className="actions">
        <button onClick={rename}>Rename</button>
        <button onClick={remove}>Delete</button>
      </div>
      {msg && (
        <p className="bad" role="status">
          {msg}
        </p>
      )}
      <SaveOffline id={id} name={m.data.name} tracks={tracks} />
      <PlayAll tracks={tracks} addAll={false} />
      {!tracks.length && <p className="muted">Empty. Tap + on any song to add it here.</p>}
      <TrackList
        tracks={tracks}
        extra={mover}
        onRemove={t => run(() => removeFromMixtape(id, t.entry_id))}
      />
    </>
  );
}
