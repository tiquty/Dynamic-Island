'use strict';
// Клиент неофициального API Яндекс Музыки. Работает в main-процессе (нет проблем с CORS).
const crypto = require('crypto');

const BASE = 'https://api.music.yandex.net';
const SIGN_SALT = 'XGRlBW9FXlekgbPrRHuSiA';

let token = null;
let uid = null;

const coverUrl = (uri, size) => (uri ? 'https://' + uri.replace('%%', size) : null);

async function call(p, { method = 'GET', form } = {}) {
  if (!token) throw new Error('Яндекс Музыка не подключена');
  const headers = {
    Authorization: 'OAuth ' + token,
    'X-Yandex-Music-Client': 'YandexMusicAndroid/24023231',
    'Accept-Language': 'ru',
  };
  const opts = { method, headers };
  if (form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    opts.body = new URLSearchParams(form).toString();
  }
  const r = await fetch(BASE + p, opts);
  if (r.status === 401 || r.status === 403) throw new Error('Токен Яндекса недействителен. Войдите заново на вкладке «Аккаунт».');
  if (!r.ok) throw new Error('Яндекс Музыка вернула ошибку ' + r.status);
  return (await r.json()).result;
}

async function ensureUid() {
  if (uid) return;
  const s = await call('/account/status');
  uid = s.account.uid;
}

function restore(savedToken, savedUid) {
  token = savedToken;
  uid = savedUid || null;
}

async function login(newToken) {
  token = newToken;
  uid = null;
  try {
    const s = await call('/account/status');
    uid = s.account.uid;
    return {
      uid,
      name: s.account.displayName || s.account.fullName || s.account.login || 'Пользователь',
      hasPlus: !!(s.plus && s.plus.hasPlus),
    };
  } catch (e) {
    token = null;
    throw e;
  }
}

function logout() {
  token = null;
  uid = null;
}

function mapTrack(t) {
  if (!t || !t.id) return null;
  return {
    source: 'yandex',
    id: String(t.id),
    title: t.title + (t.version ? ` (${t.version})` : ''),
    artist: (t.artists || []).map((a) => a.name).join(', '),
    cover: coverUrl(t.coverUri || t.ogImage, '400x400'),
    duration: t.durationMs || 0,
    available: t.available !== false,
  };
}

async function getPlaylists() {
  await ensureUid();
  const out = [{ id: 'likes', title: 'Мне нравится', cover: null, count: null }];
  const seen = new Set(['likes']);
  const add = (p) => {
    if (!p || !p.title) return false;
    const id = `${p.owner?.uid ?? p.uid}:${p.kind}`;
    if (seen.has(id)) return true;
    seen.add(id);
    out.push({
      id,
      title: p.title,
      count: p.trackCount ?? null,
      cover: coverUrl(p.cover?.uri || p.cover?.itemsUri?.[0] || p.ogImage, '300x300'),
    });
    return true;
  };

  (await call(`/users/${uid}/playlists/list`)).forEach(add);

  // плейлисты, на которые пользователь подписан
  let liked = [];
  try { liked = (await call(`/users/${uid}/likes/playlists`)) || []; } catch { /* не критично */ }
  const missing = [];
  for (const l of liked) {
    const p = l.playlist || l;
    if (!add(p)) missing.push(`${p.uid ?? p.owner?.uid}:${p.kind}`);
  }
  if (missing.length) {
    try {
      const full = await call('/playlists/list', { method: 'POST', form: { 'playlist-ids': missing.join(',') } });
      full.forEach(add);
    } catch { /* не критично */ }
  }
  return out;
}

async function getTracks(id) {
  await ensureUid();
  if (id === 'likes') {
    const r = await call(`/users/${uid}/likes/tracks`);
    const ids = (r.library?.tracks || [])
      .slice()
      .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))
      .slice(0, 300)
      .map((t) => String(t.id));
    const byId = new Map();
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const arr = await call('/tracks', { method: 'POST', form: { 'track-ids': chunk.join(',') } });
      for (const t of arr) byId.set(String(t.id), t);
    }
    return ids.map((i) => mapTrack(byId.get(i))).filter(Boolean);
  }
  const [owner, kind] = id.split(':');
  const pl = await call(`/users/${owner}/playlists/${kind}?rich-tracks=true`);
  return (pl.tracks || []).map((x) => mapTrack(x.track)).filter(Boolean);
}

// Прямая ссылка на mp3 (живёт несколько минут, поэтому берём в момент воспроизведения)
async function getStreamUrl(trackId) {
  await ensureUid();
  const infos = await call(`/tracks/${trackId}/download-info`);
  const best = infos.filter((i) => i.codec === 'mp3').sort((a, b) => b.bitrateInKbps - a.bitrateInKbps)[0] || infos[0];
  if (!best) throw new Error('Для трека нет ссылки на аудио');
  const u = best.downloadInfoUrl + (best.downloadInfoUrl.includes('?') ? '&' : '?') + 'format=json';
  const r = await fetch(u, { headers: { Authorization: 'OAuth ' + token } });
  if (!r.ok) throw new Error('Не удалось получить ссылку на трек (' + r.status + ')');
  const d = await r.json();
  const sign = crypto.createHash('md5').update(SIGN_SALT + d.path.slice(1) + d.s).digest('hex');
  return `https://${d.host}/get-mp3/${sign}/${d.ts}${d.path}`;
}

module.exports = { restore, login, logout, getPlaylists, getTracks, getStreamUrl };
