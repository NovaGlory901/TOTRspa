import { useParams } from 'react-router-dom';
import { artist, artistAlbums, artistDiscography, artistSongs } from '../api.js';
import { useLoad } from '../useLoad.js';
import { Card, Loading, Section, plural } from '../components/Bits.jsx';
import TrackList, { PlayAll } from '../components/TrackList.jsx';

export default function Artist() {
  const { id } = useParams();
  const a = useLoad(() => artist(id), [id]);
  const albums = useLoad(() => artistAlbums(id), [id]);
  const singles = useLoad(() => artistDiscography(id), [id]);
  const all = useLoad(() => artistSongs(id), [id]);
  if (!a.data || !albums.data)
    return <Loading state={a.error ? a : albums.error ? albums : { data: null }} />;
  const songs = (all.data || []).map(s => ({
    ...s,
    artists: [s.artists, s.album].filter(Boolean).join(' / '),
  }));
  return (
    <>
      <h1>{a.data.name}</h1>
      <Section title="Albums">
        {albums.data.length ? (
          <div className="grid">
            {albums.data.map(al => (
              <Card
                key={al.album_id}
                to={`/album/${al.album_id}`}
                title={al.title}
                albumId={al.album_id}
                sub={
                  al.their_tracks === al.total_tracks
                    ? plural(al.total_tracks, 'song')
                    : `${al.their_tracks} of ${al.total_tracks} songs`
                }
              />
            ))}
          </div>
        ) : (
          <p className="muted">No albums.</p>
        )}
      </Section>
      {singles.data && singles.data.length > 0 && (
        <Section title="Singles">
          <p className="muted">Songs that do not belong to an album, oldest first.</p>
          <PlayAll tracks={singles.data} />
          <TrackList tracks={singles.data} />
        </Section>
      )}
      {songs.length > 0 && (
        <Section title="All songs">
          <p className="muted">Every song by {a.data.name}, A to Z.</p>
          <PlayAll tracks={songs} />
          <TrackList tracks={songs} />
        </Section>
      )}
    </>
  );
}
