'use strict';
const electron = require('electron');
const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen, shell, session } = electron;
const path = require('path');
const http = require('http');
const fs = require('fs');
const store = require('./store');
const yandex = require('./yandex');
const spotify = require('./spotify');
const vk = require('./vk');
const smtc = require('./smtc');

app.setAppUserModelId('com.island.player');
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const IS_AUTOSTART = process.argv.includes('--autostart');
const ICON = path.join(__dirname, '..', '..', 'assets', 'icon.png');
const YANDEX_AUTH_URL = 'https://oauth.yandex.ru/authorize?response_type=token&client_id=23cabbbdc6cd418abb4b39c32c41195d';
const DEFAULTS = { topOffset: 8, collapsedWidth: 200, visualizer: true, systemMedia: true, autostart: false, volume: 0.8, shuffle: false };
// обычный Chrome вместо Electron в User-Agent, иначе страницы входа могут вести себя иначе
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
// размеры окна включают поля вокруг острова под тень; ширина свёрнутого острова настраивается
const PAD = 20;
const EXPANDED = { w: 460, h: 192 };
const COLLAPSED_H = 52;

let settingsWin, islandWin, engineWin, tray, baseUrl;
let lastState = null;
let ownState = null;   // состояние собственного плеера (из скрытого окна)
let sysState = null;   // что играет в других приложениях Windows
let lastStarted = null; // 'own' или 'system': что запустилось последним
let pick = 'own';       // что сейчас показано в островке
let islandExpanded = false;
let quitting = false;

const settings = () => ({ ...DEFAULTS, ...(store.get('settings') || {}) });
const prefs = (extra = {}) => ({ preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, ...extra });
const alive = (w) => w && !w.isDestroyed();

/* ---------- Локальный сервер для страниц (нужен защищённый контекст для Widevine/Spotify) ---------- */
function startServer() {
  const root = path.join(__dirname, '..', 'renderer');
  const vendor = path.join(__dirname, '..', '..', 'node_modules', 'hls.js', 'dist');
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]);
      if (rel === '/media-thumb') {
        const t = smtc.getThumb();
        if (!t) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': t.type, 'Cache-Control': 'no-store' });
        return res.end(t.buf);
      }
      const isVendor = rel.startsWith('/vendor/');
      const base = isVendor ? vendor : root;
      const file = path.normalize(path.join(base, isVendor ? rel.slice(8) : rel === '/' ? 'settings.html' : rel));
      if (!file.startsWith(base + path.sep)) { res.writeHead(403); return res.end(); }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
        res.end(buf);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${srv.address().port}`));
  });
}

// Разрешаем читать аудио и обложки из страницы (нужно для визуализации звука и HLS ВКонтакте)
function setupCors() {
  session.defaultSession.webRequest.onHeadersReceived(
    { urls: ['*://*.yandex.net/*', '*://*.yandex.ru/*', '*://*.yandex.com/*', '*://*.vkuseraudio.net/*', '*://*.userapi.com/*', '*://*.vk-cdn.net/*'] },
    (details, cb) => {
      const h = { ...details.responseHeaders };
      for (const k of Object.keys(h)) if (k.toLowerCase().startsWith('access-control-allow-')) delete h[k];
      h['Access-Control-Allow-Origin'] = ['*'];
      cb({ responseHeaders: h });
    }
  );
}

/* ---------- Окна ---------- */
function createEngine() {
  engineWin = new BrowserWindow({
    show: false, width: 400, height: 300,
    webPreferences: prefs({ backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' }),
  });
  engineWin.loadURL(baseUrl + '/engine.html');
}

function createSettings(show) {
  settingsWin = new BrowserWindow({
    width: 940, height: 660, minWidth: 780, minHeight: 540,
    frame: false, show: false, backgroundColor: '#0b0b0e', title: 'Island Player', icon: ICON,
    webPreferences: prefs(),
  });
  settingsWin.loadURL(baseUrl + '/settings.html');
  settingsWin.once('ready-to-show', () => { if (show) settingsWin.show(); });
  settingsWin.on('close', (e) => { if (!quitting) { e.preventDefault(); settingsWin.hide(); } });
  settingsWin.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

function islandBounds(expanded) {
  const d = screen.getPrimaryDisplay();
  const { topOffset, collapsedWidth } = settings();
  const w = expanded ? EXPANDED.w : collapsedWidth + PAD * 2;
  const h = (expanded ? EXPANDED.h : COLLAPSED_H) + topOffset;
  return { x: Math.round(d.bounds.x + (d.bounds.width - w) / 2), y: d.bounds.y, width: w, height: h };
}

function createIsland() {
  islandWin = new BrowserWindow({
    ...islandBounds(false),
    frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false,
    alwaysOnTop: true, skipTaskbar: true, show: false, hasShadow: false, focusable: true,
    webPreferences: prefs(),
  });
  islandWin.setAlwaysOnTop(true, 'screen-saver');
  islandWin.setIgnoreMouseEvents(true, { forward: true });
  islandWin.loadURL(baseUrl + '/island.html');
  screen.on('display-metrics-changed', () => alive(islandWin) && islandWin.setBounds(islandBounds(islandExpanded)));
}

function showIsland() {
  islandExpanded = false;
  islandWin.setBounds(islandBounds(false));
  islandWin.webContents.send('island:reset');
  islandWin.setAlwaysOnTop(true, 'screen-saver');
  islandWin.showInactive();
}
const hideIsland = () => alive(islandWin) && islandWin.hide();

function showSettings() {
  hideIsland();
  if (settingsWin.isMinimized()) settingsWin.restore();
  settingsWin.show();
  settingsWin.focus();
}

function createTray() {
  const img = nativeImage.createFromPath(ICON).resize({ width: 20, height: 20 });
  tray = new Tray(img);
  tray.setToolTip('Island Player');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Открыть настройки', click: showSettings },
    { label: 'Показать островок', click: () => { settingsWin.hide(); showIsland(); } },
    { type: 'separator' },
    { label: 'Пауза / Играть', click: () => route({ type: 'toggle' }) },
    { label: 'Следующий трек', click: () => route({ type: 'next' }) },
    { type: 'separator' },
    { label: 'Выйти', click: quit },
  ]));
  tray.on('click', showSettings);
}

// Окно с настоящей страницей входа сервиса: забираем токен из адреса, на который сервис перенаправляет после входа
function openAuthWindow(url, title) {
  return new Promise((resolve, reject) => {
    const w = new BrowserWindow({
      width: 520, height: 700, parent: settingsWin, modal: true, autoHideMenuBar: true, title,
      webPreferences: { partition: 'auth-' + Date.now() }, // временная сессия: ничего не запоминается
    });
    let got = false;
    const check = (u) => {
      const m = /[#&?]access_token=([^&]+)/.exec(u);
      if (m && !got) { got = true; resolve(decodeURIComponent(m[1])); setTimeout(() => !w.isDestroyed() && w.destroy(), 0); }
    };
    w.webContents.on('will-redirect', (e, u) => check(u));
    w.webContents.on('did-navigate', (e, u) => check(u));
    w.webContents.on('did-navigate-in-page', (e, u) => check(u));
    w.on('closed', () => { if (!got) reject(new Error('Окно входа закрыто')); });
    w.loadURL(url, { userAgent: BROWSER_UA });
  });
}

/* ---------- Вспомогательное ---------- */
function sendCmd(cmd) { if (alive(engineWin)) engineWin.webContents.send('player:cmd', cmd); }

// Читаемое имя приложения из идентификатора Windows
function appName(id) {
  const rules = [[/chrome/i, 'Chrome'], [/edge/i, 'Edge'], [/firefox/i, 'Firefox'], [/opera/i, 'Opera'], [/spotify/i, 'Spotify'],
    [/yandex.*music|music.*yandex|desktop\.music/i, 'Яндекс Музыка'], [/yandex|browser/i, 'Яндекс Браузер']];
  for (const [re, name] of rules) if (re.test(id)) return name;
  return String(id).replace(/\.exe$/i, '').split(/[!.]/).filter(Boolean).pop() || 'Windows';
}

// В островке показывается то, что играет; если играют оба, то запущенное последним
function composeState() {
  const ownOn = ownState && ownState.hasTrack;
  const sysOn = sysState && sysState.hasTrack;
  if (ownOn && ownState.playing && sysOn && sysState.playing) pick = lastStarted === 'system' ? 'system' : 'own';
  else if (ownOn && ownState.playing) pick = 'own';
  else if (sysOn && sysState.playing) pick = 'system';
  else pick = lastStarted === 'system' && sysOn ? 'system' : ownOn ? 'own' : sysOn ? 'system' : 'own';
  return pick === 'system' ? { ...ownState, ...sysState } : ownState;
}

function publishState() {
  if (!ownState) return; // ждём первое состояние от плеера
  lastState = composeState();
  broadcast('player:state', lastState);
  if (tray) tray.setToolTip(lastState.hasTrack ? `${lastState.title} — ${lastState.artist}`.slice(0, 120) : 'Island Player');
}

function onSystemMedia(m) {
  const wasPlaying = !!(sysState && sysState.playing);
  sysState = m ? {
    source: 'system', appName: appName(m.app), hasTrack: true, trackId: null, title: m.title, artist: m.artist,
    cover: m.thumbVer ? `${baseUrl}/media-thumb?v=${m.thumbVer}` : null, playing: m.playing,
    position: m.position, duration: m.duration, shuffle: false, error: null,
  } : null;
  if (sysState && sysState.playing && !wasPlaying) lastStarted = 'system';
  publishState();
}

function setSystemMedia(on) {
  if (on) smtc.start(onSystemMedia);
  else { smtc.stop(); sysState = null; publishState(); }
}

// Команды управления идут тому, что сейчас показано; запуск своей музыки ставит чужую на паузу
function route(cmd) {
  if (pick === 'system' && ['toggle', 'next', 'prev', 'seek'].includes(cmd.type)) return smtc.send(cmd);
  if (cmd.type === 'playQueue' || cmd.type === 'playSpotify') smtc.send({ type: 'pause' });
  sendCmd(cmd);
}
function broadcast(ch, payload) { for (const w of [settingsWin, islandWin]) if (alive(w)) w.webContents.send(ch, payload); }
function quit() { quitting = true; app.quit(); }

function handle(ch, fn) {
  ipcMain.handle(ch, async (e, ...args) => {
    try { return { ok: true, data: await fn(...args) }; }
    catch (err) { return { ok: false, error: err.message || String(err) }; }
  });
}

/* ---------- IPC ---------- */
function registerIpc() {
  // плеер
  ipcMain.on('player:cmd', (e, cmd) => route(cmd));
  ipcMain.on('player:state', (e, s) => {
    if (s.playing && !(ownState && ownState.playing)) lastStarted = 'own';
    ownState = s;
    publishState();
  });
  ipcMain.on('player:levels', (e, l) => { if (alive(islandWin) && islandWin.isVisible()) islandWin.webContents.send('player:levels', l); });
  handle('player:getState', () => lastState);

  // окна
  ipcMain.on('ui:island-ignore', (e, ignore) => alive(islandWin) && islandWin.setIgnoreMouseEvents(ignore, ignore ? { forward: true } : undefined));
  handle('ui:island-size', (expanded) => { islandExpanded = !!expanded; islandWin.setBounds(islandBounds(islandExpanded)); });
  ipcMain.on('ui:to-island', () => { settingsWin.hide(); showIsland(); });
  ipcMain.on('ui:to-settings', showSettings);
  ipcMain.on('ui:hide-to-tray', () => { settingsWin.hide(); hideIsland(); });
  ipcMain.on('ui:quit', quit);

  // настройки
  handle('settings:get', () => settings());
  handle('settings:set', (patch) => {
    const s = { ...settings(), ...patch };
    store.set('settings', s);
    if ('autostart' in patch && app.isPackaged) app.setLoginItemSettings({ openAtLogin: !!s.autostart, args: ['--autostart'] });
    if (('topOffset' in patch || 'collapsedWidth' in patch) && alive(islandWin)) islandWin.setBounds(islandBounds(islandExpanded));
    if ('systemMedia' in patch) setSystemMedia(!!s.systemMedia);
    broadcast('settings:changed', s);
    return s;
  });

  // Яндекс
  handle('yandex:profile', () => (store.get('yandex') || {}).profile || null);
  handle('yandex:authWindow', () => openAuthWindow(YANDEX_AUTH_URL, 'Вход в Яндекс'));
  handle('yandex:login', async (raw) => {
    const token = String(raw || '').trim().replace(/^OAuth\s+/i, '');
    if (!token) throw new Error('Вставьте токен');
    const profile = await yandex.login(token);
    store.set('yandex', { token, profile });
    return profile;
  });
  handle('yandex:logout', () => { yandex.logout(); store.set('yandex', null); sendCmd({ type: 'stopQueue', source: 'yandex' }); });
  handle('yandex:playlists', () => yandex.getPlaylists());
  handle('yandex:tracks', (id) => yandex.getTracks(id));
  handle('yandex:streamUrl', (id) => yandex.getStreamUrl(id));

  // ВКонтакте
  handle('vk:profile', () => (store.get('vk') || {}).profile || null);
  handle('vk:authWindow', () => openAuthWindow(vk.AUTH_URL, 'Вход ВКонтакте'));
  handle('vk:login', async (raw) => {
    const { profile, session } = await vk.login(raw);
    store.set('vk', { ...session, profile });
    return profile;
  });
  handle('vk:logout', () => { vk.logout(); store.set('vk', null); sendCmd({ type: 'stopQueue', source: 'vk' }); });
  handle('vk:playlists', () => vk.getPlaylists());
  handle('vk:tracks', (id) => vk.getTracks(id));
  handle('vk:streamUrl', (id) => vk.getStreamUrl(id));

  // Spotify
  handle('spotify:state', () => ({ clientId: spotify.getClientId(), profile: spotify.getProfile(), redirect: spotify.REDIRECT }));
  handle('spotify:setClientId', (id) => spotify.setClientId(id));
  handle('spotify:login', async () => {
    const profile = await spotify.login();
    if (alive(engineWin)) engineWin.webContents.send('spotify:connected');
    return profile;
  });
  handle('spotify:logout', () => { spotify.logout(); if (alive(engineWin)) engineWin.webContents.send('spotify:disconnected'); });
  handle('spotify:token', () => spotify.getAccessToken());
  handle('spotify:api', (method, p, body) => spotify.api(method, p, body));
  handle('spotify:playlists', () => spotify.getPlaylists());
  handle('spotify:tracks', (id) => spotify.getTracks(id));
}

/* ---------- Запуск ---------- */
app.on('second-instance', () => settingsWin && showSettings());
app.on('window-all-closed', () => { /* живём в трее */ });
app.on('before-quit', () => { quitting = true; smtc.stop(); });

app.whenReady().then(async () => {
  // Сборка castlabs: скачиваем и подключаем Widevine (нужен для Spotify)
  if (electron.components) {
    try { await electron.components.whenReady(); } catch (e) { console.error('Widevine не загрузился:', e); }
  }
  store.init();
  const y = store.get('yandex');
  if (y && y.token) yandex.restore(y.token, y.profile && y.profile.uid);
  const v = store.get('vk');
  if (v && v.token) vk.restore(v);

  setupCors();
  registerIpc();
  baseUrl = await startServer();
  createEngine();
  createIsland();
  createSettings(!IS_AUTOSTART);
  createTray();
  if (settings().systemMedia) setSystemMedia(true);
  if (IS_AUTOSTART) islandWin.once('ready-to-show', showIsland);
});
