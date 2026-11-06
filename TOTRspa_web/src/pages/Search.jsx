import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { search } from '../api.js';
import { Card, Loading, Section, plural } from '../components/Bits.jsx';
import TrackList, { PlayAll } from '../components/TrackList.jsx';

export default function Search() {
  const [params, setParams] = useSearchParams();
  const q = (params.get('q') || '').trim();
  const [text, setText] = useState(q);
  const [state, setState] = useState({ data: null, error: '' });

  useEffect(() => {
    // typing updates the address after a short pause
    const t = setTimeout(() => {
      if (text.trim() !== q) setParams(text.trim() ? { q: text.trim() } : {}, { replace: true });
    }, 300);
    return () => clearTimeout(t);
  }, [text, q, setParams]);
  useEffect(() => {
    if (!q) {
      setState({ data: null, error: '' });
      return undefined;
    }
    let live = true;
    search(q).then(
      data => live && setState({ data, error: '' }),
      e => live && setState({ data: null, error: e.message }),
    );
    return () => {
      live = false;
    };
  }, [q]);

  const r = state.data;
  const songs = r
    ? r.songs.map(s => ({
        track_id: s.track_id,
        title: s.title,
        album_id: s.album_id,
        artists: [s.artists, s.album].filter(Boolean).join(' / '),
      }))
    : [];
  const more = (shown, total) =>
    shown < total ? (
      <p className="muted">
        Showing the first {shown} of {total}. Type more to narrow it down.
      </p>
    ) : null;
  return (
    <>
      <h1>Search</h1>
      <input
        className="searchbar-input"
        type="search"
        autoFocus
        maxLength={100}
        placeholder="artists, albums and songs"
        value={text}
        onChange={e => setText(e.target.value)}
        aria-label="Search the archive"
      />
      {q && <Loading state={state} />}
      {r && !r.artists.length && !r.albums.length && !r.songs.length && (
        <p className="muted">Nothing found. Punctuation and capital letters do not matter.</p>
      )}
      {r && r.artists.length > 0 && (
        <Section title="Artists">
          <div className="grid">
            {r.artists.map(a => (
              <Card
                key={a.artist_id}
                to={`/artist/${a.artist_id}`}
                title={a.name}
                sub={plural(a.track_count, 'song')}
                glyph="[usr]"
              />
            ))}
          </div>
          {more(r.artists.length, r.totals.artists)}
        </Section>
      )}
      {r && r.albums.length > 0 && (
        <Section title="Albums">
          <div className="grid">
            {r.albums.map(al => (
              <Card
                key={al.album_id}
                to={`/album/${al.album_id}`}
                title={al.title}
                sub={[al.owner, plural(al.tracks, 'song')].filter(Boolean).join(' / ')}
                albumId={al.album_id}
              />
            ))}
          </div>
          {more(r.albums.length, r.totals.albums)}
        </Section>
      )}
      {r && songs.length > 0 && (
        <Section title="Songs">
          <PlayAll tracks={songs} addAll={false} />
          <TrackList tracks={songs} />
          {more(songs.length, r.totals.songs)}
        </Section>
      )}
    </>
  );
}
