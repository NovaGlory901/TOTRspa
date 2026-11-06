import { useEffect, useState } from 'react';
import { programOpen, programsAvailable } from '../native.js';

// The You tab's Programs panel (desktop app only): the two programs that come inside the app. They
// are windows of their own that work on your own files (no server, no sign-in), keep them in plain
// folders in your home folder, and update with the app.
const PROGRAMS = [
  {
    name: 'amp',
    title: 'DejaVuAmp',
    folder: '~/DejaVuAmp',
    text: 'a player with a 10-band equalizer: put songs (or folders of them) in its music folder',
  },
  {
    name: 'fh',
    title: 'FalseHorizons',
    folder: '~/FalseHorizons',
    text: 'a music visualizer that reacts to whatever the computer plays: put pictures and GIFs in its backgrounds and artifacts folders',
  },
];

export function ProgramsSection() {
  const [have, setHave] = useState(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState({});
  useEffect(() => {
    programsAvailable().then(setHave);
  }, []);
  const open = async name => {
    setBusy(name);
    setMsg(m => ({ ...m, [name]: '' }));
    const r = await programOpen(name);
    setBusy('');
    setMsg(m => ({ ...m, [name]: r.error ? { bad: r.error } : { ok: 'Opened.' } }));
  };
  if (!have) return <p className="muted">looking...</p>;
  return (
    <div className="panel">
      {have.length === 0 && (
        <p className="muted">
          These programs are not part of this install of the app. Install the newest TOTR app to get
          them.
        </p>
      )}
      {PROGRAMS.filter(p => have.includes(p.name)).map(p => (
        <div className="device" key={p.name}>
          <span className="t-text">
            <span className="t-title">{p.title}</span>
            <span className="t-sub">
              {p.text} ({p.folder})
            </span>
          </span>
          <button disabled={busy === p.name} onClick={() => open(p.name)}>
            Open
          </button>
          {msg[p.name] && (
            <span role="status" className={msg[p.name].bad ? 'bad' : 'ok'}>
              {msg[p.name].bad || msg[p.name].ok}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
