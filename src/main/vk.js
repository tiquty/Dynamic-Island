'use strict';
// ВКонтакте. Официального API аудио нет, поэтому используется токен приложения Kate Mobile
// (так делают сторонние клиенты вроде VK X). Токен выдаёт сама страница входа ВК, которая сама
// обрабатывает двухфакторную защиту и капчу, пароль программа не видит.
const UA = 'KateMobileAndroid/56 lite-460 (Android 4.4.2; SDK 19; x86; unknown Android SDK built for x86; en)';
const V = '5.131';

// Адрес страницы входа ВК (client_id Kate Mobile, доступ ко всему, как у vkhost)
const AUTH_URL = 'https://oauth.vk.com/authorize?' + new URLSearchParams({
  client_id: '2685278', display: 'page', redirect_uri: 'https://oauth.vk.com/blank.html',
  scope: '1073737727', response_type: 'token', v: V, revoke: '1',
});

let token = null;
let userId = null;

async function api(method, params = {}) {
  if (!token) throw new Error('ВКонтакте не подключён');
  const q = new URLSearchParams({ ...params, access_token: token, v: V });
  const r = await fetch(`https://api.vk.com/method/${method}?${q}`, { headers: { 'User-Agent': UA } });
  const j = await r.json();
  if (j.error) {
    if (j.error.error_code === 5) throw new Error('Сессия ВКонтакте истекла. Войдите заново на вкладке «Аккаунт».');
    throw new Error(j.error.error_msg || 'Ошибка ВКонтакте');
  }
  return j.response;
}

function restore(saved) {
  token = saved.token;
  userId = saved.userId;
}

function logout() {
  token = null;
  userId = null;
}

// Принимает токен или целиком адрес, на который ВК перенаправил после входа
async function login(raw) {
  const text = String(raw || '').trim();
  const m = /access_token=([^&\s]+)/.exec(text);
  const candidate = m ? decodeURIComponent(m[1]) : text;
  if (!candidate) throw new Error('Вставьте токен');
  token = candidate;
  try {
    const me = (await api('users.get'))[0];
    userId = me.id;
    return { profile: { name: `${me.first_name} ${me.last_name}`, userId }, session: { token, userId } };
  } catch {
    logout();
    throw new Error('ВКонтакте не принял токен. Попробуйте войти ещё раз.');
  }
}

const refOf = (o) => `${o.owner_id}_${o.id}${o.access_key ? '_' + o.access_key : ''}`;

function mapTrack(a) {
  if (!a || !a.id) return null;
  const thumb = a.album && a.album.thumb;
  return {
    source: 'vk',
    id: refOf(a),
    title: a.title,
    artist: a.artist,
    cover: thumb ? (thumb.photo_300 || thumb.photo_270 || thumb.photo_135 || null) : null,
    duration: (a.duration || 0) * 1000,
    available: !a.content_restricted,
  };
}

async function getPlaylists() {
  const out = [{ id: 'my', title: 'Моя музыка', cover: null, count: null }];
  const r = await api('audio.getPlaylists', { owner_id: userId, count: 100 });
  for (const p of r.items || []) {
    const ph = p.photo || (p.thumbs && p.thumbs[0]) || {};
    out.push({ id: refOf(p), title: p.title, count: p.count ?? null, cover: ph.photo_300 || ph.photo_270 || null });
  }
  return out;
}

async function getTracks(id) {
  const params = { count: 300 };
  if (id === 'my') {
    params.owner_id = userId;
  } else {
    const [owner, album, key] = id.split('_');
    Object.assign(params, { owner_id: owner, album_id: album });
    if (key) params.access_key = key;
  }
  const r = await api('audio.get', params);
  return (r.items || []).map(mapTrack).filter(Boolean);
}

// Ссылка на аудио привязана ко времени и IP, поэтому запрашиваем её прямо перед воспроизведением
async function getStreamUrl(ref) {
  const r = await api('audio.getById', { audios: ref });
  const a = Array.isArray(r) ? r[0] : r && r.items && r.items[0];
  if (!a || !a.url) throw new Error('Трек недоступен (правообладатель или ограничение ВКонтакте)');
  return a.url;
}

module.exports = { AUTH_URL, restore, login, logout, getPlaylists, getTracks, getStreamUrl };
