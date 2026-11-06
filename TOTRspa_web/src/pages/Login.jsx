import { useEffect, useState } from 'react';
import { login } from '../api.js';
import { accountAuto, accountSave, accountsSupported } from '../native.js';

export default function Login({ onDone }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  // The app around this page may remember the sign-in for this server and sign in by itself.
  useEffect(() => {
    if (accountsSupported())
      accountAuto().then(ok => {
        if (ok) onDone();
      });
  }, []);

  const submit = async e => {
    e.preventDefault();
    setError('');
    try {
      await login(username, password);
      accountSave(username, password);
      onDone();
    } catch (err) {
      // the app offers to remember it (it asks on its own screen; this page does not wait)
      setError(err.message);
    }
  };

  return (
    <form className="login" onSubmit={submit}>
      <h1 className="logo">
        TOTR<span className="cursor">_</span>
      </h1>
      <p className="muted">tv on the radio</p>
      <input
        placeholder="Username"
        autoComplete="username"
        autoCapitalize="none"
        value={username}
        onChange={e => setUsername(e.target.value)}
      />
      <input
        placeholder="Password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={e => setPassword(e.target.value)}
      />
      <button type="submit">Sign in</button>
      {error && (
        <p className="bad" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
