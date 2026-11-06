import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { account, changePassword, revokeSession, signOutAll } from '../api.js';
import { useLoad } from '../useLoad.js';
import theme from '../theme.js';
import { Loading, Section } from '../components/Bits.jsx';
import { fetchVersion, reloadFresh } from '../UpdateNotice.jsx';
import { resetLocal } from '../reset.js';
import * as sync from '../sync.js';
import {
  accountSave,
  nativeStatus,
  offlineSupported,
  programsSupported,
  serversSupported,
  shellInfo,
  songOffersSupported,
} from '../native.js';
import { OfflineSection } from '../components/Offline.jsx';
import { SongOffers } from '../components/SongOffers.jsx';
import { ProgramsSection } from '../components/Programs.jsx';
import { ServersSection } from '../components/Servers.jsx';

const SYNC_TEXT = {
  on: 'on (your settings and place follow you to your other devices)',
  setup:
    'waiting for the server to be set up (an administrator runs sql/user_data.sql); settings stay on this device',
  old: 'the server does not have this feature yet (it needs the new version and a restart); settings stay on this device',
  offline: 'could not sync just now; settings stay on this device',
  off: 'not started',
};

const when = iso => (iso ? new Date(iso).toLocaleString() : 'never');

export default function You({ user, onSignOut }) {
  const [version, setVersion] = useState(0);
  const acct = useLoad(account, [version]);
  const [current, setCurrent] = useState(theme.current());
  const [display, setDisplay] = useState(theme.display());
  const [pw, setPw] = useState({ current: '', next: '', again: '' });
  const [msg, setMsg] = useState({ pw: '', dev: '' });
  const [upd, setUpd] = useState('');
  // the You page is four tabs (the same tab buttons the Archive page has): who you are, how it
  // looks, which servers and programs, and about this app. "Servers & apps" only exists where there
  // is something to show (the desktop and Android apps).
  const [params, setParams] = useSearchParams();
  const TABS = [
    ['you', 'You'],
    ['look', 'Look'],
    ...(serversSupported() || programsSupported() || offlineSupported()
      ? [['apps', 'Servers & apps']]
      : []),
    ['about', 'About'],
  ];
  const tab = TABS.some(([key]) => key === params.get('tab')) ? params.get('tab') : 'you';
  const resetApp = async () => {
    if (!confirm('Reset the app on this device? Your servers and sign-in stay. The app restarts.'))
      return;
    await resetLocal();
    reloadFresh();
  };
  const checkUpdates = async () => {
    setUpd('checking...');
    try {
      const v = await fetchVersion();
      if (v && v.buildId && v.buildId !== __BUILD_ID__) {
        setUpd(`A newer version is ready (${v.buildId}). Loading it...`);
        setTimeout(reloadFresh, 600);
      } else setUpd(`You have the latest version. The server has ${v && v.buildId}.`);
    } catch (e) {
      setUpd(`Could not check: ${e.message || 'the server did not answer'}.`);
    }
  };
  useEffect(() => {
    theme.setUser(user.username);
    setCurrent(theme.current());
    setDisplay(theme.display());
  }, [user.username]);
  const pick = id => {
    theme.select(id);
    setCurrent(id);
  };
  const fx = (key, value) =>
    setDisplay(theme.setDisplay({ [key]: value === 'auto' ? null : value === 'on' }));
  const fxValue = v => (v === null ? 'auto' : v ? 'on' : 'off');

  const submitPw = async e => {
    e.preventDefault();
    if (pw.next !== pw.again)
      return setMsg(m => ({ ...m, pw: 'The two new passwords do not match.' }));
    try {
      await changePassword(pw.current, pw.next);
      accountSave(user.username, pw.next);
      setPw({ current: '', next: '', again: '' });
      setMsg(m => ({ ...m, pw: 'Password changed. Your other devices were signed out.' }));
      setVersion(v => v + 1);
    } catch (err) {
      setMsg(m => ({ ...m, pw: err.message }));
    }
  };
  const revoke = async id => {
    try {
      await revokeSession(id);
      setVersion(v => v + 1);
    } catch (err) {
      setMsg(m => ({ ...m, dev: err.message }));
    }
  };

  return (
    <>
      <h1>You</h1>
      <div className="tabs">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            aria-current={tab === key}
            onClick={() => setParams(key === 'you' ? {} : { tab: key }, { replace: true })}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'you' && (
        <>
          <Section title="account">
            <div className="panel">
              <p>
                <span className="muted">name &gt;</span> {user.username}
              </p>
              {acct.data && (
                <>
                  <p>
                    <span className="muted">joined &gt;</span> {when(acct.data.created_at)}
                  </p>
                  <p>
                    <span className="muted">last sign-in &gt;</span> {when(acct.data.last_login_at)}
                  </p>
                </>
              )}
              <button onClick={onSignOut}>Sign out</button>
            </div>
          </Section>

          <Section title="devices">
            <Loading state={acct} />
            {acct.data && (
              <div className="panel">
                {acct.data.sessions.map(s => (
                  <div className="device" key={s.id}>
                    <span className="t-text">
                      <span className="t-title">
                        {s.current ? 'This device' : (s.user_agent || 'A device').slice(0, 60)}
                      </span>
                      <span className="t-sub">
                        {s.ip} &middot; seen {when(s.last_seen)}
                      </span>
                    </span>
                    {!s.current && <button onClick={() => revoke(s.id)}>Sign out</button>}
                  </div>
                ))}
                <button
                  onClick={async () => {
                    try {
                      await signOutAll();
                      onSignOut();
                    } catch (e) {
                      setMsg(m => ({ ...m, dev: e.message }));
                    }
                  }}
                >
                  Sign out everywhere
                </button>
                {msg.dev && (
                  <p className="bad" role="status">
                    {msg.dev}
                  </p>
                )}
              </div>
            )}
          </Section>

          <Section title="change password">
            <form className="panel" onSubmit={submitPw} autoComplete="off">
              <div className="row">
                <label htmlFor="pw0">Current password</label>
                <input
                  id="pw0"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={pw.current}
                  onChange={e => setPw({ ...pw, current: e.target.value })}
                />
              </div>
              <div className="row">
                <label htmlFor="pw1">New password (12 or more characters)</label>
                <input
                  id="pw1"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={128}
                  value={pw.next}
                  onChange={e => setPw({ ...pw, next: e.target.value })}
                />
              </div>
              <div className="row">
                <label htmlFor="pw2">New password again</label>
                <input
                  id="pw2"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={128}
                  value={pw.again}
                  onChange={e => setPw({ ...pw, again: e.target.value })}
                />
              </div>
              <button type="submit">Change password</button>
              {msg.pw && (
                <p role="status" className={msg.pw.startsWith('Password changed') ? 'ok' : 'bad'}>
                  {msg.pw}
                </p>
              )}
            </form>
          </Section>
        </>
      )}

      {tab === 'look' && (
        <>
          <Section title="themes">
            <div className="themes">
              {theme.all().map(t => (
                <button
                  key={t.id}
                  className="theme-card"
                  aria-pressed={current === t.id}
                  onClick={() => pick(t.id)}
                >
                  <span className="sw">
                    {['bg', 'pink', 'cyan', 'lilac', 'fg'].map(k => (
                      <i key={k} style={{ background: t.colors[k] }} />
                    ))}
                  </span>
                  {t.name}
                </button>
              ))}
            </div>
          </Section>

          <Section title="effects">
            <div className="panel">
              {[
                ['scanlines', 'Scanlines'],
                ['glow', 'Text glow'],
                ['motion', 'Animation'],
              ].map(([key, label]) => (
                <div className="row" key={key}>
                  <label htmlFor={`fx-${key}`}>{label}</label>
                  <select
                    id={`fx-${key}`}
                    value={
                      key === 'motion'
                        ? display.motion === false
                          ? 'off'
                          : 'on'
                        : fxValue(display[key])
                    }
                    onChange={e =>
                      key === 'motion'
                        ? setDisplay(theme.setDisplay({ motion: e.target.value === 'on' }))
                        : fx(key, e.target.value)
                    }
                  >
                    {key !== 'motion' && <option value="auto">Whatever the theme says</option>}
                    <option value="on">On</option>
                    <option value="off">Off</option>
                  </select>
                </div>
              ))}
              <button
                onClick={() => {
                  theme.reset();
                  setCurrent(theme.current());
                  setDisplay(theme.display());
                }}
              >
                Back to the default look
              </button>
            </div>
          </Section>
        </>
      )}

      {tab === 'apps' && (
        <>
          {serversSupported() && (
            <Section title="servers">
              <ServersSection />
            </Section>
          )}
          {programsSupported() && (
            <Section title="programs">
              <ProgramsSection />
            </Section>
          )}
          {offlineSupported() && (
            <Section title="offline mode">
              <OfflineSection />
            </Section>
          )}
          {songOffersSupported() && (
            <Section title="share saved songs">
              <SongOffers />
            </Section>
          )}
        </>
      )}

      {tab === 'about' && (
        <>
          <Section title="about">
            <div className="panel">
              <p>
                <span className="muted">app version &gt;</span> {__BUILD_ID__}
              </p>
              <p>
                <span className="muted">shell &gt;</span>{' '}
                {shellInfo()
                  ? `${shellInfo().platform} ${shellInfo().version}`
                  : /; wv\)/.test(navigator.userAgent)
                    ? 'android (older install: no version, reinstall the newest APK)'
                    : 'browser'}
              </p>
              <p>
                <span className="muted">background audio &gt;</span> {nativeStatus()}
              </p>
              <p>
                <span className="muted">settings sync &gt;</span> {SYNC_TEXT[sync.state.status]}
                {sync.state.status === 'offline' && sync.state.detail
                  ? ` (${sync.state.detail})`
                  : ''}
              </p>
              <div className="actions">
                <button onClick={checkUpdates}>Check for updates</button>
                <button onClick={reloadFresh}>Reload app</button>
              </div>
              {upd && (
                <p role="status" className="muted">
                  {upd}
                </p>
              )}
            </div>
          </Section>
          <Section title="reset">
            <div className="panel">
              <p className="muted">
                If the app misbehaves, this forgets what this device keeps for TOTR (looks, your
                place, lists on Home, saved copies of pages) and starts it fresh. Your servers, your
                sign-in and everything on the server stay as they are.
              </p>
              <div className="actions">
                <button onClick={resetApp}>Reset app</button>
              </div>
            </div>
          </Section>
        </>
      )}
    </>
  );
}
