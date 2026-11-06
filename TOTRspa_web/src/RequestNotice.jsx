import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { declineSongRequest, songRequests } from './api.js';
import { songOffersSupported } from './native.js';

// Tells a person that someone who runs this server asked for their saved songs. It shows on every
// page, in every kind of app, because the ask is made on the server and nothing else would tell
// them. Sharing needs the Android app (the songs are the ones saved for offline); anywhere else, or
// in an older Android app, the notice says so and the person can still decline. "Later" hides it
// until a different request arrives.
const CHECK_EVERY_MS = 60 * 1000;

export default function RequestNotice() {
  const [list, setList] = useState([]),
    [later, setLater] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    const look = () =>
      songRequests()
        .then(r => {
          if (alive) setList(r.requests || []);
        })
        .catch(() => {
          /* not set up on this server yet, or offline: nothing to show */
        });
    look();
    const t = setInterval(look, CHECK_EVERY_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  const r = list[0];
  if (!r || later === r.request_id) return null;
  const decline = async () => {
    setBusy(true);
    try {
      await declineSongRequest(r.request_id);
      setList(l => l.filter(x => x.request_id !== r.request_id));
    } catch {
      /* it will show again at the next check */
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="update-notice"
      role="status"
      style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 230px)' }}
    >
      <p>
        <b>{r.asked_by}</b> asked for your saved songs{r.note ? `: "${r.note}"` : '.'} Nothing is
        sent unless you say yes{list.length > 1 ? ` (${list.length} requests are waiting)` : ''}.
      </p>
      {songOffersSupported() ? (
        <p>
          <Link to="/you?tab=apps" onClick={() => setLater(r.request_id)}>
            Open it
          </Link>{' '}
          to choose what to share.
        </p>
      ) : (
        <p className="muted">
          Sharing works from the newest TOTR Android app, with songs saved for offline. You can say
          no here.
        </p>
      )}
      <button disabled={busy} onClick={decline}>
        Decline
      </button>
      <button onClick={() => setLater(r.request_id)}>Later</button>
    </div>
  );
}
