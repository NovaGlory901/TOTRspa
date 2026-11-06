// Talks to the TOTR server. The session is an HttpOnly cookie; the CSRF token comes from
// /api/auth/me and goes on every POST. The app is always served by the TOTR server itself (browser,
// Electron and the Android shell all open <server>/app/), so every URL is relative and same-origin:
// no CORS, no proxy, cookies and audio seeking work as in the web portal.
let csrf = '';
export const setCsrf = token => {
  csrf = token || '';
};

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// What to say when the server gave no reason of its own.
export function failureText(status) {
  if (status === 401) return 'You are signed out. Sign in again.';
  if (status === 403) return 'You are not allowed to do that.';
  if (status === 404) return 'That was not found. It may have been removed.';
  if (status === 429) return 'Too many tries. Wait a minute and try again.';
  if (status === 502 || status === 503 || status === 504)
    return 'The server is busy or restarting. Try again in a minute.';
  if (status >= 500)
    return `The server had a problem (${status}). Try again; if it keeps happening, tell whoever runs the server.`;
  return `That did not work (${status}).`;
}

export async function api(url, { method = 'GET', body } = {}) {
  const headers = {};
  const opts = { method, credentials: 'same-origin', headers };
  if (method !== 'GET' && method !== 'HEAD') headers['X-CSRF-Token'] = csrf;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, opts);
  } catch {
    throw new ApiError(
      0,
      'Cannot reach the server. Check that you are on the right network and that the server is on, then try again.',
    );
  } // not the browser's "Failed to fetch"
  const data = await res.json().catch(() => null);
  if (!res.ok)
    throw new ApiError(
      res.status,
      (data && typeof data.detail === 'string' && data.detail) || failureText(res.status),
    );
  return data;
}

export const login = (username, password) =>
  api('/api/auth/login', { method: 'POST', body: { username, password } });
export const logout = () => api('/api/auth/logout', { method: 'POST' });
export const me = () => api('/api/auth/me');
export const artists = () => api('/api/artists');
export const compilations = () => api('/api/compilations');
export const artistDiscography = id => api(`/api/artists/${id}/discography`);
export const artistSongs = id => api(`/api/artists/${id}/songs`);
export const search = q => api('/api/search?q=' + encodeURIComponent(q));
export const stats = () => api('/api/library/stats');
export const radioNext = (exclude = []) =>
  api('/api/radio/next' + (exclude.length ? '?exclude=' + exclude.join(',') : ''));
export const mixtapes = () => api('/api/mixtapes');
export const mixtape = id => api(`/api/mixtapes/${id}`);
export const createMixtape = (name, trackIds) =>
  api('/api/mixtapes', { method: 'POST', body: { name, track_ids: trackIds || [] } });
export const renameMixtape = (id, name) =>
  api(`/api/mixtapes/${id}/rename`, { method: 'POST', body: { name } });
export const deleteMixtape = id => api(`/api/mixtapes/${id}/delete`, { method: 'POST', body: {} });
export const addToMixtape = (id, trackIds) =>
  api(`/api/mixtapes/${id}/tracks`, { method: 'POST', body: { track_ids: trackIds } });
export const removeFromMixtape = (id, entry) =>
  api(`/api/mixtapes/${id}/tracks/${entry}/remove`, { method: 'POST', body: {} });
export const moveInMixtape = (id, entry, direction) =>
  api(`/api/mixtapes/${id}/tracks/${entry}/move`, { method: 'POST', body: { direction } });
export const mySummary = () => api('/api/me/summary');
export const songOffers = () => api('/api/songs/offers');
export const makeSongOffer = (note, items) =>
  api('/api/songs/offers', { method: 'POST', body: { note, items } });
export const cancelSongOffer = id =>
  api(`/api/songs/offers/${id}/cancel`, { method: 'POST', body: {} });
export const songRequests = () => api('/api/songs/requests');
export const acceptSongRequest = (id, items) =>
  api(`/api/songs/requests/${id}/accept`, { method: 'POST', body: { items } });
export const declineSongRequest = id =>
  api(`/api/songs/requests/${id}/decline`, { method: 'POST', body: {} });
export const account = () => api('/api/account');
export const revokeSession = id =>
  api(`/api/account/sessions/${id}/revoke`, { method: 'POST', body: {} });
export const signOutAll = () => api('/api/auth/signout-all', { method: 'POST', body: {} });
export const changePassword = (current, next) =>
  api('/api/auth/change-password', { method: 'POST', body: { current, new: next } });
export const ping = (trackId, state) =>
  api('/api/listening/ping', {
    method: 'POST',
    body: { track_id: trackId, state, source: 'archive' },
  });
export const artist = id => api(`/api/artists/${id}`);
export const artistAlbums = id => api(`/api/artists/${id}/albums`);
export const album = id => api(`/api/albums/${id}`);
export const albumTracks = id => api(`/api/albums/${id}/tracks`);
export const audioUrl = trackId => `/api/tracks/${trackId}/audio`;
export const coverUrl = albumId => `/api/albums/${albumId}/cover`;
export const myData = () => api('/api/me/data');
export const saveMyData = (name, value, updatedMs) =>
  api(`/api/me/data/${name}`, { method: 'PUT', body: { value, updated_ms: updatedMs } });
