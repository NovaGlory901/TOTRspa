import { useEffect, useState } from 'react';
import {
  accountForget,
  accountList,
  accountsSupported,
  serverAdd,
  serverList,
  serverRemove,
  serverUse,
} from '../native.js';
import { NearServers } from './NearServers.jsx';

// The You tab's Servers panel: the servers this install knows, which one is in use, switch /
// remove, and add a new one. The list is kept by the app around the page (see native.js), so it is
// the same whichever server this page came from. Switching reopens the app on the other server;
// each server keeps its own sign-in, so coming back does not ask for a password again.
export function ServersSection() {
  const [info, setInfo] = useState(null);
  const [msg, setMsg] = useState('');
  const [form, setForm] = useState({ name: '', address: '' });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState({}); // origin -> the username the app signs in with there
  const load = () =>
    serverList()
      .then(setInfo)
      .catch(() => setInfo({ current: '', list: [] }));
  useEffect(() => {
    load();
  }, []);
  const loadSaved = () => {
    if (accountsSupported())
      accountList()
        .then(l => setSaved(Object.fromEntries(l.map(a => [a.origin, a.username]))))
        .catch(() => setSaved({}));
  };
  useEffect(() => {
    loadSaved();
  }, []);

  const run = async job => {
    setBusy(true);
    setMsg('');
    try {
      const r = await job();
      if (r && r.error) setMsg(r.error);
      else return true;
    } catch (e) {
      setMsg(e.message || 'That did not work.');
    } finally {
      setBusy(false);
    }
    return false;
  };
  const add = async e => {
    e.preventDefault();
    if (await run(() => serverAdd(form.name, form.address))) {
      setForm({ name: '', address: '' });
      setMsg('Added. Press Switch to go there.');
      load();
    }
  };
  const remove = async origin => {
    if (await run(() => serverRemove(origin))) load();
  };
  const forget = async origin => {
    if (await run(() => accountForget(origin))) loadSaved();
  };
  const use = async origin => {
    if (await run(() => serverUse(origin))) setMsg('Switching...');
  };

  if (!info) return <p className="muted">reading the list...</p>;
  return (
    <div className="panel">
      {info.fixedByEnvironment && (
        <p className="warn">
          TOTR_SERVER is set on this computer, so it wins over the server you pick here.
        </p>
      )}
      {info.list.length === 0 && <p className="muted">No servers saved yet.</p>}
      {info.list.map(s => (
        <div className="device" key={s.origin}>
          <span className="t-text">
            <span className="t-title">{s.name || s.origin}</span>
            {s.name && <span className="t-sub">{s.origin}</span>}
            {saved[s.origin] && (
              <span className="t-sub">signed in automatically as {saved[s.origin]}</span>
            )}
          </span>
          {saved[s.origin] && (
            <button
              disabled={busy}
              onClick={() => forget(s.origin)}
              aria-label={`Forget the saved sign-in for ${s.name || s.origin}`}
            >
              Forget
            </button>
          )}
          {s.origin === info.current ? (
            <span className="ok">in use</span>
          ) : (
            <>
              <button disabled={busy} onClick={() => use(s.origin)}>
                Switch
              </button>
              <button
                disabled={busy}
                onClick={() => remove(s.origin)}
                aria-label={`Remove ${s.name || s.origin}`}
              >
                Remove
              </button>
            </>
          )}
        </div>
      ))}
      <form onSubmit={add} autoComplete="off" className="addserver">
        <div className="row">
          <label htmlFor="srv-name">Name (optional)</label>
          <input
            id="srv-name"
            maxLength={40}
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
          />
        </div>
        <div className="row">
          <label htmlFor="srv-addr">Address</label>
          <input
            id="srv-addr"
            inputMode="url"
            autoCapitalize="none"
            spellCheck="false"
            placeholder="https://totr.example:8443"
            required
            value={form.address}
            onChange={e => setForm({ ...form, address: e.target.value })}
          />
        </div>
        <button type="submit" disabled={busy}>
          Add server
        </button>
      </form>
      {msg && (
        <p role="status" className={/^(Added|Switching)/.test(msg) ? 'ok' : 'bad'}>
          {msg}
        </p>
      )}
      <NearServers current={info.current} />
    </div>
  );
}
