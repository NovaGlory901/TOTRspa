import { useNavigate, useSearchParams } from 'react-router-dom';
import { artists, compilations } from '../api.js';
import { useLoad } from '../useLoad.js';
import { Card, Loading, plural } from '../components/Bits.jsx';

export default function Archive() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'comp' ? 'comp' : 'artists';
  const nav = useNavigate();
  const list = useLoad(tab === 'comp' ? compilations : artists, [tab]);
  return (
    <>
      <h1>Music Archive</h1>
      <form
        className="searchbar"
        onSubmit={e => {
          e.preventDefault();
          const q = new FormData(e.currentTarget).get('q').trim();
          if (q) nav(`/search?q=${encodeURIComponent(q)}`);
        }}
      >
        <input
          name="q"
          type="search"
          maxLength={100}
          placeholder="search artists, albums and songs"
          aria-label="Search the archive"
        />
      </form>
      <div className="tabs">
        <button aria-current={tab === 'artists'} onClick={() => setParams({})}>
          Artists
        </button>
        <button aria-current={tab === 'comp'} onClick={() => setParams({ tab: 'comp' })}>
          Compilations
        </button>
      </div>
      <Loading state={list} />
      {list.data && !list.data.length && <p className="muted">Nothing here yet.</p>}
      {list.data && (
        <div className="grid">
          {tab === 'artists'
            ? list.data.map(a => (
                <Card
                  key={a.artist_id}
                  to={`/artist/${a.artist_id}`}
                  title={a.name}
                  sub={plural(a.track_count, 'song')}
                  albumId={a.cover_album_id}
                  glyph="[usr]"
                />
              ))
            : list.data.map(al => (
                <Card
                  key={al.album_id}
                  to={`/album/${al.album_id}`}
                  title={al.title}
                  sub={`${plural(al.total_tracks, 'song')}, ${al.artist_count} artists`}
                  albumId={al.album_id}
                />
              ))}
        </div>
      )}
    </>
  );
}
