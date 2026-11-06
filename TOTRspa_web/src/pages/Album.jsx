import { useParams } from 'react-router-dom';
import { album, albumTracks } from '../api.js';
import { useLoad } from '../useLoad.js';
import { Cover, Loading, plural } from '../components/Bits.jsx';
import TrackList, { PlayAll } from '../components/TrackList.jsx';

// Albums the collector added carry a free license: which one, and where the music came from (the
// server only sends http(s) links).
function Credit({ c }) {
  const link = (text, href) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {text}
    </a>
  );
  return (
    <p className="muted credit">
      Free music{c.source ? ` from ${c.source.replace(/_/g, ' ')}` : ''}. License:{' '}
      {c.license_url ? link(c.license || c.license_url, c.license_url) : c.license || 'unknown'}.
      {c.page_url && <> {link('Original page', c.page_url)}.</>}
      {c.needs_credit && c.attribution && (
        <>
          <br />
          Credit: {c.attribution}
        </>
      )}
    </p>
  );
}

export default function Album() {
  const { id } = useParams();
  const info = useLoad(() => album(id), [id]);
  const tracks = useLoad(() => albumTracks(id), [id]);
  if (!info.data || !tracks.data)
    return <Loading state={info.error ? info : tracks.error ? tracks : { data: null }} />;
  const list = tracks.data.map(t => ({ ...t, album_id: Number(id) }));
  return (
    <>
      <div className="album-head">
        <Cover albumId={id} className="big" />
        <div>
          <h1>{info.data.title}</h1>
          <p className="muted">
            {[info.data.owner, info.data.year, plural(list.length, 'song')]
              .filter(Boolean)
              .join(' / ')}
          </p>
        </div>
      </div>
      <PlayAll tracks={list} />
      <TrackList tracks={list} numbered />
      {info.data.credit && <Credit c={info.data.credit} />}
    </>
  );
}
