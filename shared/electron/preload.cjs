// Tells the page which shell it is running in, so it can ask for a new installer when this one is
// too old. Nothing else is exposed.
const { contextBridge, ipcRenderer } = require('electron');
const info = ipcRenderer.sendSync('shell-info');
contextBridge.exposeInMainWorld('totrShell', {
  version: info.version,
  platform: info.platform,
  retry: () => ipcRenderer.send('shell-retry'),
  // the saved servers (the list lives in config.json): list() -> {current, list:[{name, origin}],
  // fixedByEnvironment}; add/remove/use -> {} or {error}. use() restarts the app.
  servers: {
    list: () => ipcRenderer.invoke('servers-list'),
    add: (name, address) =>
      ipcRenderer.invoke('servers-add', String(name || ''), String(address || '')),
    remove: origin => ipcRenderer.invoke('servers-remove', String(origin || '')),
    use: origin => ipcRenderer.invoke('servers-use', String(origin || '')),
  },
  // servers on the same network (private addresses only): start() -> {list} or {error}; list() ->
  // {list:[{name, origin, address, fingerprint}]}; stop().
  discover: {
    start: () => ipcRenderer.invoke('discover-start'),
    list: () => ipcRenderer.invoke('discover-list'),
    stop: () => ipcRenderer.invoke('discover-stop'),
  },
  // asking a server to let you in. ask(address, {name, note, history}) -> {joins} or {error};
  // refresh() asks the servers for answers -> {joins:[{requestId, origin, name, status}]};
  // cancel(id); finish(id) once status is 'approved' (restarts the app on that server's invite
  // page). The invite token never reaches the page.
  join: {
    ask: (address, details) =>
      ipcRenderer.invoke('join-ask', String(address || ''), {
        name: String((details && details.name) || ''),
        note: String((details && details.note) || ''),
        history: (details && details.history) || null,
      }),
    refresh: () => ipcRenderer.invoke('join-refresh'),
    cancel: id => ipcRenderer.invoke('join-cancel', String(id || '')),
    finish: id => ipcRenderer.invoke('join-finish', String(id || '')),
  },
  // remembered sign-ins: call(op, args) -> an object. op: auto -> {signedIn} | save {username,
  // password} -> {ok} | signedOut | suggest -> {password} | have / forget {origin} | list ->
  // {accounts}. The shell keeps the passwords and never hands one to a page; the server a sign-in
  // is used for is the window's real address.
  accounts: {
    call: (op, args) =>
      ipcRenderer.invoke(
        'accounts-call',
        String(op || ''),
        args && typeof args === 'object' ? args : {},
      ),
  },
  // the programs that ship inside the app (DejaVuAmp = 'amp', FalseHorizons = 'fh'): available() ->
  // the names this install has; launch(name) -> {} or {error}. Only a name can be given: the
  // program, its folder and its arguments are fixed in the shell.
  native: {
    available: () => ipcRenderer.invoke('native-available'),
    launch: name => ipcRenderer.invoke('native-launch', String(name || '')),
  },
  // updating the app itself (installer or AppImage): onChange(cb) gets {stage: unsupported | none |
  // available | download | ready | error, ...}
  updates: {
    onChange: cb => {
      const f = (_e, state) => cb(state);
      ipcRenderer.on('totr:update', f);
      ipcRenderer.send('update-state');
      return () => ipcRenderer.removeListener('totr:update', f);
    },
    check: () => ipcRenderer.send('update-check'),
    install: () => ipcRenderer.send('update-install'),
  },
});
