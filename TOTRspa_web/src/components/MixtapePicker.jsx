import { createContext, useCallback, useContext, useState } from 'react';
import { addToMixtape, createMixtape, mixtapes } from '../api.js';

// "Add to a mixtape" sheet, opened from any "+" button: pick one of yours or start a new one. The
// server takes 200 songs at a time.
const Ctx = createContext(() => {});
export const useMixtapePicker = () => useContext(Ctx);

export function MixtapePickerProvider({ children }) {
  const [ids, setIds] = useState(null);
  const open = useCallback(list => setIds(list), []);
  return (
    <Ctx.Provider value={open}>
      {children}
      {ids && <Sheet ids={ids} onClose={() => setIds(null)} />}
    </Ctx.Provider>
  );
}

function Sheet({ ids, onClose }) {
  const [state, setState] = useState({ list: null, error: '' });
  const [name, setName] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  if (state.list === null && !state.error)
    mixtapes().then(
      r =>
        setState({
          list: r.enabled ? r.mixtapes : [],
          error: r.enabled ? '' : 'Mixtapes are not set up on the server yet.',
        }),
      e => setState({ list: [], error: e.message }),
    );

  const chunks = list => {
    const out = [];
    for (let i = 0; i < list.length; i += 200) out.push(list.slice(i, i + 200));
    return out;
  };
  const finish = async (id, label) => {
    setBusy(true);
    setMsg('');
    try {
      let added = 0;
      for (const part of chunks(ids)) {
        const r = await addToMixtape(id, part);
        added += r.added || 0;
      }
      setMsg(`Added ${added} song${added === 1 ? '' : 's'} to "${label}".`);
    } catch (e) {
      setMsg(e.message);
    }
    setBusy(false);
  };
  const create = async e => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setMsg('');
    try {
      const r = await createMixtape(name.trim(), ids.slice(0, 200));
      if (ids.length > 200) await finish(r.mixtape_id, name.trim());
      else
        setMsg(
          `Created "${name.trim()}" with ${Math.min(ids.length, 200)} song${ids.length === 1 ? '' : 's'}.`,
        );
      setName('');
    } catch (err) {
      setMsg(err.message);
    }
    setBusy(false);
  };

  return (
    <div className="sheet-back" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-label="Add to a mixtape"
        onClick={e => e.stopPropagation()}
      >
        <h3>Add {ids.length === 1 ? 'this song' : `${ids.length} songs`} to a mixtape</h3>
        {state.error && <p className="bad">{state.error}</p>}
        {state.list &&
          state.list.map(m => (
            <button
              key={m.mixtape_id}
              className="wide"
              disabled={busy}
              onClick={() => finish(m.mixtape_id, m.name)}
            >
              {m.name} <span className="muted">({m.track_count})</span>
            </button>
          ))}
        {state.list && !state.error && (
          <form onSubmit={create} className="inline">
            <input
              placeholder="new mixtape name"
              maxLength={80}
              value={name}
              onChange={e => setName(e.target.value)}
            />
            <button type="submit" disabled={busy || !name.trim()}>
              Create
            </button>
          </form>
        )}
        {msg && (
          <p className="ok" role="status">
            {msg}
          </p>
        )}
        <button className="wide" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
