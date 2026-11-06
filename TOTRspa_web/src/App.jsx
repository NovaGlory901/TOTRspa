import { useEffect, useState } from 'react';
import { NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { me, logout, setCsrf } from './api.js';
import { accountSignedOut } from './native.js';
import theme from './theme.js';
import { PlayerProvider } from './player.jsx';
import { MixtapePickerProvider } from './components/MixtapePicker.jsx';
import { MiniPlayer } from './components/Player.jsx';
import UpdateNotice from './UpdateNotice.jsx';
import RequestNotice from './RequestNotice.jsx';
import * as sync from './sync.js';
import { Search as SearchIcon } from './components/Icons.jsx';
import Login from './pages/Login.jsx';
import Home from './pages/Home.jsx';
import Archive from './pages/Archive.jsx';
import Artist from './pages/Artist.jsx';
import Album from './pages/Album.jsx';
import Search from './pages/Search.jsx';
import Mixtapes from './pages/Mixtapes.jsx';
import Mixtape from './pages/Mixtape.jsx';
import Radio from './pages/Radio.jsx';
import You from './pages/You.jsx';

const TABS = [
  ['/', 'Home', true],
  ['/archive', 'Archive'],
  ['/radio', 'Radio'],
  ['/mixtapes', 'Mixtapes'],
  ['/you', 'You'],
];
const ROOTS = TABS.map(t => t[0]);

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = checking, null = signed out
  // set when the server could not be reached at all (not the same as being signed out)
  const [down, setDown] = useState('');

  const load = () =>
    me()
      .then(async u => {
        setCsrf(u.csrf);
        await sync.pull(u.username);
        theme.setUser(u.username);
        setUser(u);
      })
      .catch(err => {
        setCsrf('');
        theme.setUser('');
        if (err && err.status === 0) {
          setDown(err.message);
          setUser(undefined);
        } else {
          setDown('');
          setUser(null);
        }
      });
  useEffect(() => {
    load();
  }, []);
  useEffect(() => (user ? sync.start(user.username) : undefined), [user && user.username]);

  if (down)
    return (
      <div className="screen">
        <p className="bad pad">{down}</p>
        <div className="actions pad">
          <button
            onClick={() => {
              setDown('');
              load();
            }}
          >
            Try again
          </button>
        </div>
        <UpdateNotice />
      </div>
    );
  if (user === undefined)
    return (
      <div className="screen">
        <p className="muted pad">connecting to the server...</p>
        <UpdateNotice />
      </div>
    );
  if (user === null)
    return (
      <div className="screen">
        <Login onDone={load} />
        <UpdateNotice />
      </div>
    );
  return (
    <PlayerProvider username={user.username} key={user.username}>
      <MixtapePickerProvider>
        <Shell
          user={user}
          onSignOut={() =>
            logout()
              .catch(() => {})
              .then(accountSignedOut)
              .then(load)
          }
        />
      </MixtapePickerProvider>
    </PlayerProvider>
  );
}

function Shell({ user, onSignOut }) {
  const nav = useNavigate();
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  const atRoot = ROOTS.includes(pathname);
  return (
    <div className="screen">
      <header className="site">
        {atRoot ? (
          <span className="spacer" />
        ) : (
          <button className="icon" onClick={() => nav(-1)} aria-label="Back">
            &lsaquo;
          </button>
        )}
        <NavLink to="/" className="site-title">
          <span className="logo-mark" aria-hidden="true" />
          TOTR<span className="cursor">_</span>
        </NavLink>
        <button className="icon" onClick={() => nav('/search')} aria-label="Search">
          <SearchIcon />
        </button>
      </header>
      <main className={pathname === '/radio' ? 'radio-wide' : undefined}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/archive" element={<Archive />} />
          <Route path="/artist/:id" element={<Artist />} />
          <Route path="/album/:id" element={<Album />} />
          <Route path="/search" element={<Search />} />
          <Route path="/mixtapes" element={<Mixtapes />} />
          <Route path="/mixtape/:id" element={<Mixtape />} />
          <Route path="/radio" element={<Radio username={user.username} />} />
          <Route path="/you" element={<You user={user} onSignOut={onSignOut} />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </main>
      <div className="dock">
        {pathname !== '/radio' && <MiniPlayer />}
        <nav className="tabbar" aria-label="Main">
          {TABS.map(([to, label, end]) => (
            <NavLink key={to} to={to} end={!!end}>
              {label}
            </NavLink>
          ))}
        </nav>
      </div>
      <RequestNotice />
      <UpdateNotice />
    </div>
  );
}
