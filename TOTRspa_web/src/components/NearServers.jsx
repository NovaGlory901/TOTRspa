import { useEffect, useRef, useState } from 'react';
import {
  joinAsk,
  joinCancel,
  joinFinish,
  joinRefresh,
  nearList,
  nearStart,
  nearStop,
  nearSupported,
} from '../native.js';
import { me, mySummary } from '../api.js';

// "Servers near you" (desktop app): TOTR servers on the same network that take join requests, and
// the requests this person has open. The app around the page does the looking and the asking (see
// native.js); this page only shows the list and the form. Asking sends a name, an optional note
// and, only if the person ticks the box, a few counts from the server they are on now (the day
// their account began, their mixtapes, the songs in the library). An admin on the other server
// approves or declines; once approved, "Finish" opens that server's invite page, where the person
// picks a username and password.
export function NearServers({ current }) {
  const [near, setNear] = useState(null),
    [problem, setProblem] = useState(''),
    [joins, setJoins] = useState([]);
  const [asking, setAsking] = useState(null),
    [form, setForm] = useState({ name: '', note: '', share: false });
  const [msg, setMsg] = useState(''),
    [busy, setBusy] = useState(false);
  const timers = useRef([]);

  useEffect(() => {
    if (!nearSupported()) return undefined;
    let alive = true;
    const looks = async () => {
      const r = await nearList().catch(() => null);
      if (alive && r && r.list) setNear(r.list);
    };
    const answers = async () => {
      const r = await joinRefresh().catch(() => null);
      if (alive && r && r.joins) setJoins(r.joins);
    };
    nearStart()
      .then(r => {
        if (!alive) return;
        if (r && r.error) setProblem(r.error);
        else if (r && r.list) setNear(r.list);
      })
      .catch(() => setProblem('Looking for servers did not start.'));
    answers();
    timers.current = [setInterval(looks, 4000), setInterval(answers, 10000)];
    me()
      .then(u => {
        if (alive && u && u.username) setForm(f => (f.name ? f : { ...f, name: u.username }));
      })
      .catch(() => {
        /* not signed in: the person types a name */
      });
    return () => {
      alive = false;
      timers.current.forEach(clearInterval);
      nearStop().catch(() => {
        /* closing */
      });
    };
  }, []);

  if (!nearSupported()) return null;
  const open = origin => joins.some(j => j.origin === origin && j.status === 'pending');
  const shown = (near || []).filter(s => s.origin !== current);

  const send = async e => {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    try {
      let history = null;
      // the counts the server on this page holds; if it cannot give them, nothing is sent
      if (form.share) history = await mySummary().catch(() => null);
      const r = await joinAsk(asking.origin, { name: form.name, note: form.note, history });
      if (r && r.error) setMsg(r.error);
      else {
        setJoins(r.joins || []);
        setAsking(null);
        setMsg(
          'Sent. The people who run that server will see your request. This page shows their answer here.',
        );
      }
    } catch (err) {
      setMsg(err.message || 'That did not work.');
    } finally {
      setBusy(false);
    }
  };
  const cancel = async j => {
    setBusy(true);
    try {
      const r = await joinCancel(j.requestId);
      if (r && r.joins) setJoins(r.joins);
    } finally {
      setBusy(false);
    }
  };
  const finish = async j => {
    setBusy(true);
    setMsg('');
    try {
      const r = await joinFinish(j.requestId);
      if (r && r.error) setMsg(r.error);
      else setMsg('Opening the other server...');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="near">
      <h3>Servers near you</h3>
      <p className="muted">
        TOTR servers on this network that are letting people ask to join. Nothing here is on the
        internet.
      </p>
      {problem && <p className="bad">{problem}</p>}
      {!problem && near && shown.length === 0 && (
        <p className="muted">
          None found right now. If you know a server's address, add it above; it has to be taking
          join requests for you to ask.
        </p>
      )}
      {!near && !problem && <p className="muted">looking...</p>}
      {shown.map(s => (
        <div className="device" key={s.origin}>
          <span className="t-text">
            <span className="t-title">{s.name}</span>
            <span className="t-sub">
              {s.origin}
              {s.fingerprint ? ` / authority code ${s.fingerprint}` : ''}
            </span>
          </span>
          <button
            disabled={busy || open(s.origin)}
            onClick={() => {
              setAsking(s);
              setMsg('');
            }}
          >
            {open(s.origin) ? 'Asked' : 'Ask to join'}
          </button>
        </div>
      ))}
      {asking && (
        <form onSubmit={send} autoComplete="off" className="addserver">
          <p>
            Ask to join <b>{asking.name}</b> ({asking.origin}).
          </p>
          <div className="row">
            <label htmlFor="join-name">Your name there</label>
            <input
              id="join-name"
              required
              maxLength={40}
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="row">
            <label htmlFor="join-note">A note for the admin (optional)</label>
            <input
              id="join-note"
              maxLength={300}
              value={form.note}
              onChange={e => setForm({ ...form, note: e.target.value })}
            />
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={form.share}
              onChange={e => setForm({ ...form, share: e.target.checked })}
            />{' '}
            Also tell them when my account here began, how many mixtapes I have and how many songs
            this library holds. Nothing else is shared.
          </label>
          <p className="muted">
            You choose your own username and password after they say yes. They never see a password.
          </p>
          <button type="submit" disabled={busy}>
            Send request
          </button>{' '}
          <button type="button" disabled={busy} onClick={() => setAsking(null)}>
            Never mind
          </button>
        </form>
      )}
      {joins.length > 0 && <h3>Your requests</h3>}
      {joins.map(j => (
        <div className="device" key={j.requestId}>
          <span className="t-text">
            <span className="t-title">{j.origin}</span>
            <span className="t-sub">
              {j.status === 'approved'
                ? 'Approved. Press Finish to choose your username and password.'
                : j.status === 'declined'
                  ? 'They said no.'
                  : 'Waiting for an admin to answer...'}
            </span>
          </span>
          {j.status === 'approved' && (
            <button disabled={busy} onClick={() => finish(j)}>
              Finish
            </button>
          )}
          <button disabled={busy} onClick={() => cancel(j)}>
            {j.status === 'pending' ? 'Cancel' : 'Dismiss'}
          </button>
        </div>
      ))}
      {msg && (
        <p role="status" className={/^(Sent|Opening)/.test(msg) ? 'ok' : 'bad'}>
          {msg}
        </p>
      )}
    </div>
  );
}
