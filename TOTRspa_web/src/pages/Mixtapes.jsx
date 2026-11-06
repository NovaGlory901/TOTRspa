import { useState } from 'react';
import { Link } from 'react-router-dom';
import { createMixtape, mixtapes } from '../api.js';
import { useLoad } from '../useLoad.js';
import { Loading, plural } from '../components/Bits.jsx';

export default function Mixtapes() {
  const [version, setVersion] = useState(0);
  const list = useLoad(mixtapes, [version]);
  const [name, setName] = useState('');
  const [msg, setMsg] = useState('');
  const create = async e => {
    e.preventDefault();
    setMsg('');
    try {
      await createMixtape(name.trim());
      setName('');
      setVersion(v => v + 1);
    } catch (err) {
      setMsg(err.message);
    }
  };
  return (
    <>
      <h1>Mixtapes</h1>
      <p className="muted">Private playlists. Only you can see them.</p>
      <Loading state={list} />
      {list.data && !list.data.enabled && (
        <p className="warn">Mixtapes are not set up on the server yet.</p>
      )}
      {list.data && list.data.enabled && (
        <>
          <form className="inline" onSubmit={create}>
            <input
              placeholder="new mixtape name"
              maxLength={80}
              value={name}
              onChange={e => setName(e.target.value)}
            />
            <button type="submit" disabled={!name.trim()}>
              Create
            </button>
          </form>
          {msg && (
            <p className="bad" role="status">
              {msg}
            </p>
          )}
          {!list.data.mixtapes.length && (
            <p className="muted">No mixtapes yet. Make one above, or tap + on any song.</p>
          )}
          <div className="rows">
            {list.data.mixtapes.map(m => (
              <Link key={m.mixtape_id} to={`/mixtape/${m.mixtape_id}`} className="row-link">
                <span className="t-title">{m.name}</span>
                <span className="muted">{plural(m.track_count, 'song')}</span>
              </Link>
            ))}
          </div>
        </>
      )}
    </>
  );
}
