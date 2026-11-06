if (new URLSearchParams(location.search).get('problem') === 'config')
  document.getElementById('configNote').hidden = false;
if (new URLSearchParams(location.search).get('first')) {
  document.getElementById('title').textContent = 'Choose a server';
  document.getElementById('lost').hidden = true;
  document.getElementById('firstRun').hidden = false;
  document.getElementById('addrLabel').textContent =
    "The server's address (like https://totr.example:8443):";
}
document.getElementById('server').textContent =
  new URLSearchParams(location.search).get('server') || '';
if (new URLSearchParams(location.search).get('reason') === 'certificate')
  document.getElementById('certWarn').hidden = false;
document
  .getElementById('retry')
  .addEventListener('click', () => window.totrShell && window.totrShell.retry());

// A new server by its address, for when the one the app starts on is down or wrong (nothing saved
// yet to pick from). It is saved and the app restarts on it.
const addrBox = document.getElementById('addr'),
  addrMsg = document.getElementById('addrMsg');
async function useAddress() {
  const shell = window.totrShell;
  if (!shell || !shell.servers) {
    addrMsg.textContent = 'This version of the app cannot change servers here.';
    return;
  }
  addrMsg.textContent = '';
  // cleans the address, saves it, and restarts the app on it
  const used = await shell.servers.use(addrBox.value);
  if (used && used.error) addrMsg.textContent = used.error;
}
document.getElementById('useAddr').addEventListener('click', () => {
  useAddress().catch(e => {
    addrMsg.textContent = String((e && e.message) || e);
  });
});
addrBox.addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('useAddr').click();
});

// The other saved servers, so a down server can be left without editing any file. Using one
// restarts the app on it.
const shell = window.totrShell;
if (shell && shell.servers) {
  shell.servers
    .list()
    .then(info => {
      const here = new URLSearchParams(location.search).get('server') || info.current;
      const others = info.list.filter(s => s.origin !== here);
      if (!others.length || info.fixedByEnvironment) return;
      for (const s of others) {
        const b = document.createElement('button');
        b.textContent = s.name ? `${s.name} (${s.origin})` : s.origin;
        b.addEventListener('click', () => shell.servers.use(s.origin));
        document.getElementById('savedList').append(b);
      }
      document.getElementById('saved').hidden = false;
    })
    .catch(() => {
      /* an older shell: no list */
    });
}

// Servers near you (the app looks on the local network; electron/discover.cjs) and asking one to
// let this person in (electron/joinclient.cjs). Text only, no markup built from the network.
if (shell && shell.discover && shell.join) {
  const el = id => document.getElementById(id),
    here = new URLSearchParams(location.search).get('server') || '';
  const say = (t, bad) => {
    el('nearMsg').textContent = t;
    el('nearMsg').style.color = bad ? '#f77' : '#5f5';
  };
  let asking = null,
    joins = [];
  const mk = (tag, text, on) => {
    const n = document.createElement(tag);
    n.textContent = text;
    if (on) n.addEventListener('click', on);
    return n;
  };
  const paintNear = list => {
    const box = el('nearList');
    box.replaceChildren();
    const shown = list.filter(s => s.origin !== here);
    for (const s of shown) {
      const waiting = joins.some(j => j.origin === s.origin && j.status === 'pending');
      const b = mk('button', waiting ? 'Asked' : 'Ask to join', () => {
        asking = s;
        el('askWho').textContent =
          `Ask to join ${s.name} (${s.origin})${s.fingerprint ? ', authority code ' + s.fingerprint : ''}.`;
        el('askForm').hidden = false;
      });
      b.disabled = waiting;
      box.append(mk('div', `${s.name}  ${s.origin}  `), b);
    }
    el('nearNone').textContent = shown.length
      ? ''
      : 'None found right now. Type an address above if you know it.';
  };
  const paintJoins = () => {
    const box = el('joinList');
    box.replaceChildren();
    for (const j of joins) {
      const line = mk(
        'div',
        `${j.origin}: ${j.status === 'approved' ? 'approved.' : j.status === 'declined' ? 'they said no.' : 'waiting for an admin to answer...'} `,
      );
      if (j.status === 'approved')
        line.append(
          mk('button', 'Finish: choose my username and password', async () => {
            const r = await shell.join.finish(j.requestId);
            if (r && r.error) say(r.error, true);
          }),
        );
      line.append(
        mk('button', j.status === 'pending' ? 'Cancel' : 'Dismiss', async () => {
          const r = await shell.join.cancel(j.requestId);
          if (r && r.joins) {
            joins = r.joins;
            paintJoins();
          }
        }),
      );
      box.append(line);
    }
  };
  el('askCancel').addEventListener('click', () => {
    el('askForm').hidden = true;
    asking = null;
  });
  el('askForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (!asking) return;
    const r = await shell.join.ask(asking.origin, {
      name: el('askName').value,
      note: el('askNote').value,
    });
    if (r && r.error) return say(r.error, true);
    joins = r.joins || [];
    el('askForm').hidden = true;
    asking = null;
    paintJoins();
    say('Sent. This page shows their answer here.');
  });
  let last = [];
  const refreshNear = () =>
    shell.discover
      .list()
      .then(r => {
        if (r && r.list) {
          last = r.list;
          paintNear(last);
        }
      })
      .catch(() => {
        /* try again */
      });
  const refreshJoins = () =>
    shell.join
      .refresh()
      .then(r => {
        if (r && r.joins) {
          joins = r.joins;
          paintJoins();
          paintNear(last);
        }
      })
      .catch(() => {
        /* try again */
      });
  shell.discover
    .start()
    .then(r => {
      el('near').hidden = false;
      if (r && r.error) {
        el('nearNone').textContent = r.error;
        return;
      }
      last = (r && r.list) || [];
      paintNear(last);
      refreshJoins();
      setInterval(refreshNear, 4000);
      setInterval(refreshJoins, 10000);
    })
    .catch(() => {
      /* an older shell */
    });
}
