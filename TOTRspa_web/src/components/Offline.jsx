import { useEffect, useState } from 'react';
import {
  goOffline,
  offlineBytes,
  offlineIndex,
  offlineSupported,
  onOfflineProgress,
  removeMixtapeOffline,
  saveMixtapeOffline,
} from '../native.js';

// Offline mode lives in the Android app only: mixtapes can be saved on the phone, and the app can
// close itself up and play just those.
const mb = n => `${(n / 1048576).toFixed(n > 10485760 ? 0 : 1)} MB`;

// One progress line, shared: only one mixtape saves at a time.
function useProgress() {
  const [p, setP] = useState(null);
  useEffect(() => onOfflineProgress(setP), []);
  return [p, setP];
}

// On a mixtape: "Save for offline" / "Saved on this phone" with Remove.
export function SaveOffline({ id, name, tracks }) {
  const [p, setP] = useProgress();
  const [, again] = useState(0);
  if (!offlineSupported()) return null;
  const saved = offlineIndex().find(m => m.id === String(id));
  const working = p && p.stage === 'saving' && p.name === name;
  const save = () => {
    setP({ stage: 'saving', name, done: 0, total: tracks.length });
    saveMixtapeOffline({ id, name, tracks });
  };
  const drop = () => {
    removeMixtapeOffline(id);
    setP(null);
    again(n => n + 1);
  };
  return (
    <div className="panel">
      <p className="muted">
        {working
          ? `saving for offline... ${p.done} of ${p.total} songs`
          : saved
            ? `saved on this phone (${saved.tracks.length} songs)`
            : 'not saved for offline'}
      </p>
      {p && p.stage === 'error' && (
        <p className="bad" role="status">
          Could not save it: {p.message}
        </p>
      )}
      <div className="actions">
        <button onClick={save} disabled={working || !tracks.length}>
          {saved ? 'Save again (updates it)' : 'Save for offline'}
        </button>
        {saved && !working && <button onClick={drop}>Remove from this phone</button>}
      </div>
    </div>
  );
}

// On You: the switch, and what is saved.
export function OfflineSection() {
  const [, again] = useState(0);
  useProgress();
  if (!offlineSupported()) return null;
  const list = offlineIndex();
  return (
    <div className="panel">
      <p>
        Offline mode closes the app up completely: it stops talking to any network and plays only
        the mixtapes saved on this phone. It stays that way until you press <b>Go online</b> inside
        it.
      </p>
      {list.length ? (
        list.map(m => (
          <p key={m.id}>
            <span className="muted">saved &gt;</span> {m.name} ({m.tracks.length}){' '}
            <button
              onClick={() => {
                removeMixtapeOffline(m.id);
                again(n => n + 1);
              }}
            >
              Remove
            </button>
          </p>
        ))
      ) : (
        <p className="muted">Nothing is saved yet. Open a mixtape and press "Save for offline".</p>
      )}
      <p className="muted">{mb(offlineBytes())} used on this phone</p>
      <div className="actions">
        <button
          onClick={() => {
            if (
              window.confirm(
                'Go offline? The app closes up and plays only the mixtapes saved on this phone, until you press Go online.',
              )
            )
              goOffline();
          }}
        >
          Go offline
        </button>
      </div>
    </div>
  );
}
