'use strict';
// Spotify: вход по OAuth (PKCE, без секрета), автообновление токена, обращения к Web API.
// Звук играет встроенный Web Playback SDK (см. renderer/engine.js).
const { shell } = require('electron');
const http = require('http');
const crypto = require('crypto');
const store = require('./store');

const PORT = 38123;
const REDIRECT = `http://127.0.0.1:${PORT}/callback`;
const SCOPES = [
  'streaming', 'user-read-email', 'user-read-private',
  'user-read-playback-state', 'user-modify-playback-state',
  'user-library-read', 'playlist-read-private', 'playlist-read-collaborative',
].join(' ');

const get = () => store.get('spotify') || {};
const patch = (o) => store.set('spotify', { ...get(), ...o });
const b64url = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const getClientId = () => get().clientId || '';
const setClientId = (id) => patch({ clientId: String(id || '').trim() });
const getProfile = () => get().profile || null;

function logout() {
  const { clientId } = get();
  store.set('spotify', clientId ? { clientId } : null);
}

let refreshing = null;
async function exchange(params) {
  const { clientId } = get();
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, ...params }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error_description || j.error || 'Spotify отклонил запрос токена');
  const prev = get().tokens || {};
  patch({ tokens: { access: j.access_token, refresh: j.refresh_token || prev.refresh, expires: Date.now() + j.expires_in * 1000 } });
}

async function getAccessToken() {
  const t = get().tokens;
  if (!t) throw new Error('Spotify не подключён');
  if (t.expires - 60000 > Date.now()) return t.access;
  if (!refreshing) {
    refreshing = exchange({ grant_type: 'refresh_token', refresh_token: t.refresh }).finally(() => { refreshing = null; });
  }
  await refreshing;
  return get().tokens.access;
}

async function api(method, p, body) {
  const token = await getAccessToken();
  const r = await fetch(p.startsWith('http') ? p : 'https://api.spotify.com/v1' + p, {
    method,
    headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 204 || r.status === 202) return null;
  const txt = await r.text();
  let j = null;
  try { j = JSON.parse(txt); } catch { /* пустой ответ */ }
  if (!r.ok) {
    const e = new Error(j?.error?.message || 'Spotify вернул ошибку ' + r.status);
    e.status = r.status;
    throw e;
  }
  return j;
}

const donePage = (text) => `<!doctype html><meta charset="utf-8"><title>Island Player</title>
<body style="margin:0;height:100vh;display:grid;place-items:center;background:#0b0b0e;color:#f5f5f7;font:18px 'Segoe UI',sans-serif">
<div style="text-align:center"><div style="width:64px;height:24px;border-radius:12px;background:#000;border:1px solid #333;margin:0 auto 24px"></div>${text}</div></body>`;

let cancelLogin = null; // отмена незавершённой попытки входа, чтобы освободить порт

function login() {
  if (cancelLogin) cancelLogin();
  const clientId = getClientId();
  if (!clientId) return Promise.reject(new Error('Укажите Client ID'));
  const verifier = b64url(crypto.randomBytes(64));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(12));

  return new Promise((resolve, reject) => {
    let done = false;
    let timer;
    const finish = (err, val) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      cancelLogin = null;
      srv.close();
      if (srv.closeAllConnections) srv.closeAllConnections();
      err ? reject(err) : resolve(val);
    };
    cancelLogin = () => finish(new Error('Вход отменён: начата новая попытка'));
    const srv = http.createServer(async (req, res) => {
      const u = new URL(req.url, REDIRECT);
      if (u.pathname !== '/callback') { res.writeHead(404); return res.end(); }
      const code = u.searchParams.get('code');
      const ok = code && u.searchParams.get('state') === state;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(donePage(ok ? 'Готово. Эту вкладку можно закрыть и вернуться в Island Player.' : 'Войти не удалось. Закройте вкладку и попробуйте снова.'));
      if (!ok) return finish(new Error(u.searchParams.get('error') || 'Вход отменён'));
      try {
        await exchange({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, code_verifier: verifier });
        const me = await api('GET', '/me');
        const profile = { name: me.display_name || me.id, product: me.product || null };
        patch({ profile });
        finish(null, profile);
      } catch (e) { finish(e); }
    });
    srv.on('error', (e) => finish(new Error(e.code === 'EADDRINUSE'
      ? `Порт ${PORT} занят другой программой. Закройте её или перезапустите Island Player и повторите вход.`
      : 'Не удалось открыть порт ' + PORT + ': ' + e.message)));
    timer = setTimeout(() => finish(new Error('Время ожидания входа истекло')), 180000);
    srv.listen(PORT, '127.0.0.1', () => {
      const q = new URLSearchParams({
        client_id: clientId, response_type: 'code', redirect_uri: REDIRECT,
        scope: SCOPES, code_challenge_method: 'S256', code_challenge: challenge, state,
      });
      shell.openExternal('https://accounts.spotify.com/authorize?' + q);
    });
  });
}

function mapTrack(t) {
  if (!t || !t.uri || t.type === 'episode') return null;
  const imgs = t.album?.images || [];
  return {
    source: 'spotify',
    id: t.id,
    uri: t.uri,
    title: t.name,
    artist: (t.artists || []).map((a) => a.name).join(', '),
    cover: imgs[1]?.url || imgs[0]?.url || null,
    duration: t.duration_ms || 0,
  };
}

async function getPlaylists() {
  const out = [{ id: 'liked', title: 'Понравившиеся треки', cover: null, count: null }];
  let url = '/me/playlists?limit=50';
  while (url && out.length < 300) {
    const j = await api('GET', url);
    for (const p of j.items || []) {
      if (!p) continue;
      out.push({
        id: p.id, uri: p.uri, title: p.name,
        count: p.items?.total ?? p.tracks?.total ?? null,
        cover: p.images?.[0]?.url || null,
      });
    }
    url = j.next;
  }
  return out;
}

async function getTracks(id) {
  const out = [];
  const isLiked = id === 'liked';
  let url = isLiked ? '/me/tracks?limit=50' : `/playlists/${id}/items?limit=100`;
  const limit = isLiked ? 100 : 500;
  try {
    while (url && out.length < limit) {
      const j = await api('GET', url);
      for (const it of j.items || []) {
        const t = mapTrack(it.item || it.track); // после февраля 2026 поле называется item
        if (t) out.push(t);
      }
      url = j.next;
    }
  } catch (e) {
    if (e.status === 403 || e.status === 404) {
      throw new Error('Spotify не отдаёт список треков этого плейлиста (доступно только для ваших плейлистов). Кнопки «Слушать» и «Вперемешку» всё равно работают.');
    }
    throw e;
  }
  return out;
}

module.exports = { REDIRECT, getClientId, setClientId, getProfile, login, logout, getAccessToken, api, getPlaylists, getTracks };
