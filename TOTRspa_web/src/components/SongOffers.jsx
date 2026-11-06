import { useEffect, useRef, useState } from 'react';
import {
  acceptSongRequest,
  cancelSongOffer,
  declineSongRequest,
  makeSongOffer,
  me,
  songOffers,
  songRequests,
} from '../api.js';
import { listSavedSongs, sendSavedSong, songOffersSupported } from '../native.js';

// Share songs saved for offline (Android app): offer them to the server this app is on, or answer a
// server person's request for them. Someone who adds music there accepts some; then "Send the
// accepted songs" sends exactly those files. Nothing is sent without a tap here: an offer is the
// person's own tap, and an ask from the server only becomes an offer when they press Share. The
// phone reads and sends the files (native.js); this page only holds the list.
const mb = n => `${(n / 1048576).toFixed(n > 10485760 ? 0 : 1)} MB`;
const NAMES = {
  offered: 'waiting for an answer',
  accepted: 'accepted, ready to send',
  receiving: 'arriving...',
  declined: 'not taken',
  uploaded: 'added to the library',
  failed: 'did not arrive',
};
// which saved file each song of an offer is, kept on this phone so the accepted ones can be found
// again
const keyFor = id => `totr.offer.files.${id}`;
const remember = (id, files) => {
  try {
    localStorage.setItem(keyFor(id), JSON.stringify(files));
  } catch {
    /* the songs can then not be sent from here */
  }
};
const recall = id => {
  try {
    return JSON.parse(localStorage.getItem(keyFor(id)) || '[]');
  } catch {
    return [];
  }
};

export function SongOffers() {
  const [offers, setOffers] = useState([]),
    [requests, setRequests] = useState([]),
    [songs, setSongs] = useState(null),
    [picking, setPicking] = useState(null);
  const [chosen, setChosen] = useState({}),
    [note, setNote] = useState(''),
    [msg, setMsg] = useState(''),
    [busy, setBusy] = useState(false),
    [sending, setSending] = useState('');
  const alive = useRef(true);

  const load = async () => {
    try {
      const [o, r] = await Promise.all([songOffers(), songRequests()]);
      if (alive.current) {
        setOffers(o.offers || []);
        setRequests(r.requests || []);
      }
    } catch (e) {
      if (alive.current && e && e.status === 503) setMsg(e.message);
    }
  };
  useEffect(() => {
    alive.current = true;
    load();
    const t = setInterval(load, 10000);
    return () => {
      alive.current = false;
      clearInterval(t);
    };
  }, []);

  if (!songOffersSupported()) return null;
  const choose = async kind => {
    setBusy(true);
    setMsg('');
    try {
      const list = await listSavedSongs();
      if (!list.length) {
        setMsg('Nothing is saved for offline on this phone yet. Save a mixtape for offline first.');
        return;
      }
      setSongs(list);
      setPicking(kind);
      setNote('');
      // an offer starts empty; an answer to a request starts with everything ticked
      setChosen(Object.fromEntries(list.map(s => [s.sha256, kind !== 'offer'])));
    } finally {
      setBusy(false);
    }
  };
  const picked = () => (songs || []).filter(s => chosen[s.sha256]);
  const submit = async e => {
    e.preventDefault();
    const list = picked();
    if (!list.length) {
      setMsg('Tick at least one song.');
      return;
    }
    setBusy(true);
    setMsg('');
    try {
      const items = list.map(({ title, artist, album, ext, size, sha256 }) => ({
        title,
        artist,
        album,
        ext,
        size,
        sha256,
      }));
      const r =
        picking === 'offer'
          ? await makeSongOffer(note, items)
          : await acceptSongRequest(picking.request_id, items);
      remember(
        r.offer_id,
        list.map(s => s.file),
      );
      setPicking(null);
      setSongs(null);
      setMsg(
        picking === 'offer'
          ? 'Offered. You will see here when someone takes some.'
          : 'Shared. Press "Send the accepted songs" below.',
      );
      load();
    } catch (err) {
      setMsg(err.message || 'That did not work.');
    } finally {
      setBusy(false);
    }
  };
  const decline = async r => {
    setBusy(true);
    try {
      await declineSongRequest(r.request_id);
      load();
    } catch (err) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  };
  const cancel = async o => {
    setBusy(true);
    try {
      await cancelSongOffer(o.offer_id);
      load();
    } catch (err) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  };
  const sendAll = async o => {
    const files = recall(o.offer_id),
      todo = o.items.filter(i => i.status === 'accepted' || i.status === 'failed');
    setBusy(true);
    setMsg('');
    try {
      const csrf = (await me()).csrf;
      let ok = 0,
        last = '';
      for (const i of todo) {
        setSending(`Sending ${ok + 1} of ${todo.length}: ${i.title}`);
        const r = files[i.item_no]
          ? await sendSavedSong(o.offer_id, i.item_no, files[i.item_no], csrf)
          : { ok: false, message: 'that song is no longer saved on this phone' };
        if (r.ok) ok++;
        else last = `${i.title}: ${r.message}`;
      }
      setMsg(
        ok === todo.length
          ? `Sent ${ok} song(s). The server added them to its library.`
          : `Sent ${ok} of ${todo.length}. ${last}`,
      );
    } catch (err) {
      setMsg(err.message || 'That did not work.');
    } finally {
      setBusy(false);
      setSending('');
      load();
    }
  };
  const open = offers.filter(
    o =>
      o.items.some(i => i.status !== 'declined' && i.status !== 'uploaded') ||
      o.status === 'pending',
  );

  return (
    <div className="panel">
      <p className="muted">
        Songs you saved for offline can be offered to this server. Someone who adds music there
        chooses which to take, and only those are sent.
      </p>
      {requests.map(r => (
        <div className="device" key={r.request_id}>
          <span className="t-text">
            <span className="t-title">{r.asked_by} asks for your saved songs</span>
            <span className="t-sub">
              {r.note || 'No note. Nothing is sent unless you press Share and then Send.'}
            </span>
          </span>
          <button disabled={busy} onClick={() => choose(r)}>
            Share...
          </button>
          <button disabled={busy} onClick={() => decline(r)}>
            Decline
          </button>
        </div>
      ))}
      {picking && songs && (
        <form onSubmit={submit} className="addserver">
          <p>
            {picking === 'offer'
              ? 'Tick the songs to offer.'
              : `Tick the songs ${picking.asked_by} may take.`}
          </p>
          {songs.map(s => (
            <label key={s.sha256} className="check" style={{ display: 'block' }}>
              <input
                type="checkbox"
                checked={!!chosen[s.sha256]}
                onChange={e => setChosen({ ...chosen, [s.sha256]: e.target.checked })}
              />{' '}
              {s.title || s.file}
              {s.artist ? ` / ${s.artist}` : ''} ({mb(s.size)})
            </label>
          ))}
          {picking === 'offer' && (
            <div className="row">
              <label htmlFor="offer-note">A note (optional)</label>
              <input
                id="offer-note"
                maxLength={300}
                value={note}
                onChange={e => setNote(e.target.value)}
              />
            </div>
          )}
          <button type="submit" disabled={busy}>
            {picking === 'offer' ? 'Offer these' : 'Share these'}
          </button>{' '}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setPicking(null);
              setSongs(null);
            }}
          >
            Never mind
          </button>
        </form>
      )}
      {!picking && (
        <button disabled={busy} onClick={() => choose('offer')}>
          Offer some of my saved songs
        </button>
      )}
      {open.map(o => {
        const ready = o.items.filter(i => i.status === 'accepted' || i.status === 'failed').length;
        return (
          <div key={o.offer_id} className="device" style={{ display: 'block' }}>
            <p className="t-title">
              {o.asked ? 'Shared on request' : 'Your offer'}
              {o.answered_by ? ` (answered by ${o.answered_by})` : ' (waiting)'}
            </p>
            {o.items.map(i => (
              <p key={i.item_no} className="t-sub">
                {i.title}: {NAMES[i.status] || i.status}
                {i.error ? ` (${i.error})` : ''}
              </p>
            ))}
            {ready > 0 && (
              <button disabled={busy} onClick={() => sendAll(o)}>
                Send the accepted songs ({ready})
              </button>
            )}
            {o.status === 'pending' && (
              <button disabled={busy} onClick={() => cancel(o)}>
                Cancel the offer
              </button>
            )}
          </div>
        );
      })}
      {sending && (
        <p className="muted" role="status">
          {sending}
        </p>
      )}
      {msg && (
        <p role="status" className={/^(Offered|Shared|Sent \d+ song)/.test(msg) ? 'ok' : 'bad'}>
          {msg}
        </p>
      )}
    </div>
  );
}
