import { useState } from 'react';
import { Link } from 'react-router-dom';
import { coverUrl } from '../api.js';

export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
export const clock = s => {
  s = Math.max(0, Math.floor(s || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// An album cover that falls back to a glyph when the album has none.
export function Cover({ albumId, glyph = '[disc]', className = '' }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={`cover ${className}`}>
      {albumId && !failed ? (
        <img src={coverUrl(albumId)} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <span>{glyph}</span>
      )}
    </div>
  );
}

export function Card({ to, title, sub, albumId, glyph }) {
  return (
    <Link to={to} className="card">
      <Cover albumId={albumId} glyph={glyph} />
      <h3>{title}</h3>
      {sub && <p className="sub">{sub}</p>}
    </Link>
  );
}

export function Loading({ state }) {
  if (state.error) return <p className="bad">{state.error}</p>;
  if (!state.data) return <p className="muted">reading database...</p>;
  return null;
}

export function Section({ title, more, children }) {
  return (
    <section className="block">
      <div className="block-head">
        <h2>{title}</h2>
        {more}
      </div>
      {children}
    </section>
  );
}
