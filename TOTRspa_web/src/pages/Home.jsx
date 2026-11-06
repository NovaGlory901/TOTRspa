import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { mixtapes, radioNext, stats } from '../api.js';
import { useLoad } from '../useLoad.js';
import { usePlayer } from '../player.jsx';
import { Cover, Section, clock, plural } from '../components/Bits.jsx';
import { Play, Shuffle } from '../components/Icons.jsx';

// A user-focused home: pick up where you left off, one-tap listening, your mixtapes, what you
// played lately.
export default function Home() {
  const { last, recent, play, resumeLast, song } = usePlayer();
  const nav = useNavigate();
  const boxes = useLoad(mixtapes, []);
  const counts = useLoad(stats, []);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const shuffle = async () => {
    // a handful of random songs, then the player carries on through them
    setBusy(true);
    setMsg('');
    try {
      const picked = [];
      for (let i = 0; i < 8; i++) picked.push(await radioNext(picked.map(t => t.track_id)));
      play(picked, 0);
    } catch (e) {
      setMsg(e.message);
    }
    setBusy(false);
  };

  const mine = boxes.data && boxes.data.enabled ? boxes.data.mixtapes : null;
  return (
    <>
      {last && (!song || song.track_id !== last.song.track_id) && (
        <Section title="continue listening">
          <button className="resume" onClick={resumeLast}>
            <Cover albumId={last.song.album_id} className="small" />
            <span className="t-text">
              <span className="t-title">{last.song.title}</span>
              <span className="t-sub">
                {last.song.artists} &middot; from {clock(last.position)}
              </span>
            </span>
            <span className="icon big">
              <Play />
            </span>
          </button>
        </Section>
      )}

      <div className="big-buttons">
        <button onClick={() => nav('/radio')}>
          <Play /> Tune in the radio
        </button>
        <button onClick={shuffle} disabled={busy}>
          {busy ? (
            'mixing...'
          ) : (
            <>
              <Shuffle /> Shuffle my library
            </>
          )}
        </button>
      </div>
      {msg && (
        <p className="bad" role="status">
          {msg}
        </p>
      )}

      {mine && (
        <Section title="your mixtapes" more={<Link to="/mixtapes">all &gt;</Link>}>
          {mine.length ? (
            <div className="hscroll">
              {mine.slice(0, 12).map(m => (
                <Link key={m.mixtape_id} to={`/mixtape/${m.mixtape_id}`} className="tape">
                  <span className="tape-name">{m.name}</span>
                  <span className="muted">{plural(m.track_count, 'song')}</span>
                </Link>
              ))}
              <Link to="/mixtapes" className="tape new">
                + new
              </Link>
            </div>
          ) : (
            <p className="muted">
              No mixtapes yet. <Link to="/mixtapes">Make your first one.</Link>
            </p>
          )}
        </Section>
      )}

      {recent.length > 0 && (
        <Section title="recently played">
          <div className="hscroll">
            {recent.slice(0, 12).map((t, i) => (
              <button
                key={t.track_id}
                className="recent"
                onClick={() => play(recent, i)}
                aria-label={`Play ${t.title}`}
              >
                <Cover albumId={t.album_id} className="small" />
                <span className="t-title">{t.title}</span>
                <span className="t-sub">{t.artists}</span>
              </button>
            ))}
          </div>
        </Section>
      )}

      <p className="muted stats">
        library &gt;{' '}
        {counts.data
          ? `${counts.data.artists} artists / ${counts.data.albums} albums / ${counts.data.tracks} tracks`
          : counts.error
            ? 'server unreachable'
            : 'reading database...'}
      </p>
    </>
  );
}
