// Движок воспроизведения. Живёт в скрытом окне, остальные окна только отправляют команды
// и получают состояние. Яндекс и ВК: <audio> + собственная очередь (ВК может отдавать HLS,
// его играет hls.js). Spotify: Web Playback SDK, очередью управляет сам Spotify.
(() => {
  const S = { source: null, track: null, shuffle: false, volume: 0.8, error: null };
  let queue = [], order = [], orderPos = 0, errCount = 0;
  let audio, audioCtx, analyser, freq, hls = null;
  const sp = { player: null, deviceId: null, st: null, ts: 0 };

  /* ---------- Яндекс и ВК: аудио и визуализация ---------- */
  const isQueue = () => S.source === 'yandex' || S.source === 'vk';

  function setStream(url) {
    if (hls) { hls.destroy(); hls = null; }
    if (/\.m3u8/.test(url) && window.Hls && Hls.isSupported()) {
      hls = new Hls();
      hls.on(Hls.Events.ERROR, (_e, d) => { if (d.fatal) failTrack('Не удалось загрузить поток'); });
      hls.loadSource(url);
      hls.attachMedia(audio);
    } else {
      audio.src = url;
    }
  }

  function makeAudio(cors) {
    const a = new Audio();
    a.preload = 'auto';
    if (cors) a.crossOrigin = 'anonymous'; // нужно, чтобы читать спектр
    a.volume = S.volume;
    a.addEventListener('ended', () => next());
    a.addEventListener('playing', publish);
    a.addEventListener('pause', publish);
    a.addEventListener('error', onAudioError);
    return a;
  }

  function attachAnalyser(a) {
    try {
      audioCtx = audioCtx || new AudioContext();
      const node = audioCtx.createMediaElementSource(a);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.78;
      node.connect(analyser);
      analyser.connect(audioCtx.destination);
      freq = new Uint8Array(analyser.frequencyBinCount);
    } catch { analyser = null; }
  }

  function onAudioError() {
    if (!isQueue() || !audio.src || hls) return;
    if (audio.crossOrigin) {
      // CORS не сработал: играем без анализатора (визуализация станет синтетической)
      const url = audio.src;
      audio.removeAttribute('src');
      audio = makeAudio(false);
      analyser = null;
      audio.src = url;
      audio.play().catch(() => {});
      return;
    }
    failTrack('Не удалось загрузить трек');
  }

  function failTrack(msg) {
    errCount++;
    S.error = msg;
    publish();
    if (errCount < 4 && queue.length > 1) setTimeout(() => next(), 800);
  }

  function buildOrder(startIdx) {
    order = queue.map((_, i) => i);
    if (S.shuffle) {
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      const p = order.indexOf(startIdx);
      [order[0], order[p]] = [order[p], order[0]];
    }
    orderPos = order.indexOf(startIdx);
  }

  async function playIndex(i) {
    const t = queue[i];
    if (!t) return;
    S.source = t.source;
    S.track = t;
    S.error = null;
    publish();
    updateMedia();
    try {
      const url = await api.call(t.source + ':streamUrl', t.id);
      if (S.track !== t) return;
      setStream(url);
      if (audioCtx && audioCtx.state === 'suspended') await audioCtx.resume();
      await audio.play();
      errCount = 0;
    } catch (e) {
      if (S.track !== t || e.name === 'AbortError') return;
      failTrack(e.message);
    }
  }

  function playQueue({ tracks, index }) {
    stopSpotify();
    const target = tracks[index || 0];
    queue = tracks.filter((t) => t.available !== false);
    if (!queue.length) { S.error = 'В этом плейлисте нет доступных треков'; return publish(); }
    let idx = queue.indexOf(target);
    if (idx < 0) idx = 0;
    buildOrder(idx);
    playIndex(idx);
  }

  function stopQueue(source) {
    if (S.source !== source) return;
    audio.pause();
    if (hls) { hls.destroy(); hls = null; }
    audio.removeAttribute('src');
    queue = []; order = [];
    S.source = null; S.track = null;
    publish();
  }

  /* ---------- Spotify ---------- */
  function loadSpotifySdk() {
    if (window.__spSdk) { if (window.Spotify) initSpotify(); return; }
    window.__spSdk = true;
    window.onSpotifyWebPlaybackSDKReady = initSpotify;
    const s = document.createElement('script');
    s.src = 'https://sdk.scdn.co/spotify-player.js';
    document.head.appendChild(s);
  }

  function initSpotify() {
    if (sp.player) return;
    const p = new Spotify.Player({
      name: 'Island Player',
      volume: S.volume,
      getOAuthToken: (cb) => api.call('spotify:token').then(cb).catch((e) => { S.error = 'Spotify: ' + e.message; publish(); }),
    });
    p.addListener('ready', ({ device_id }) => { sp.deviceId = device_id; publish(); });
    p.addListener('not_ready', () => { sp.deviceId = null; publish(); });
    p.addListener('player_state_changed', (st) => { if (!st) return; sp.st = st; sp.ts = performance.now(); publish(); });
    for (const ev of ['initialization_error', 'authentication_error', 'account_error', 'playback_error']) {
      p.addListener(ev, (e) => {
        S.error = ev === 'initialization_error'
          ? 'Spotify: плеер не запустился. Нужна сборка Electron с Widevine (см. README). ' + e.message
          : ev === 'account_error' ? 'Spotify: для воспроизведения нужен Premium. ' + e.message : 'Spotify: ' + e.message;
        publish();
      });
    }
    p.connect();
    sp.player = p;
  }

  function stopSpotify() {
    if (sp.player) sp.player.pause().catch(() => {});
  }

  function disconnectSpotify() {
    if (sp.player) { sp.player.disconnect(); sp.player = null; }
    sp.deviceId = null; sp.st = null;
    if (S.source === 'spotify') { S.source = null; S.track = null; }
    publish();
  }

  async function playSpotify(p) {
    if (!sp.deviceId) throw new Error('Плеер Spotify ещё запускается, попробуйте через пару секунд');
    audio.pause();
    S.source = 'spotify';
    S.error = null;
    try { sp.player.activateElement && (await sp.player.activateElement()); } catch { /* не критично */ }
    const body = p.contextUri
      ? { context_uri: p.contextUri, ...(p.offsetUri ? { offset: { uri: p.offsetUri } } : {}) }
      : { uris: p.uris, ...(p.offsetPos != null ? { offset: { position: p.offsetPos } } : {}) };
    await api.call('spotify:api', 'PUT', `/me/player/shuffle?state=${S.shuffle}&device_id=${sp.deviceId}`).catch(() => {});
    await api.call('spotify:api', 'PUT', `/me/player/play?device_id=${sp.deviceId}`, body);
  }

  /* ---------- Общие команды ---------- */
  const spPos = () => (sp.st ? (sp.st.paused ? sp.st.position : sp.st.position + (performance.now() - sp.ts)) : 0);

  function next() {
    if (S.source === 'spotify') return sp.player && sp.player.nextTrack();
    if (!queue.length) return;
    orderPos = (orderPos + 1) % order.length;
    playIndex(order[orderPos]);
  }

  function prev() {
    if (S.source === 'spotify') {
      if (!sp.player) return;
      return spPos() > 3000 ? sp.player.seek(0) : sp.player.previousTrack();
    }
    if (!queue.length) return;
    if (audio.currentTime > 3) { audio.currentTime = 0; return; }
    orderPos = (orderPos - 1 + order.length) % order.length;
    playIndex(order[orderPos]);
  }

  function toggle() {
    if (S.source === 'spotify') sp.player && sp.player.togglePlay();
    else if (isQueue()) (audio.paused ? audio.play().catch(() => {}) : audio.pause());
  }

  function seek(ms) {
    if (S.source === 'spotify') sp.player && sp.player.seek(ms);
    else if (isQueue()) audio.currentTime = ms / 1000;
  }

  function setShuffle(v) {
    S.shuffle = !!v;
    if (isQueue() && queue.length) buildOrder(order[orderPos]);
    if (S.source === 'spotify' && sp.deviceId) api.call('spotify:api', 'PUT', `/me/player/shuffle?state=${S.shuffle}&device_id=${sp.deviceId}`).catch(() => {});
    api.call('settings:set', { shuffle: S.shuffle }).catch(() => {});
    publish();
  }

  let volTimer;
  function setVolume(v) {
    S.volume = Math.min(1, Math.max(0, v));
    audio.volume = S.volume;
    if (sp.player) sp.player.setVolume(S.volume).catch(() => {});
    clearTimeout(volTimer);
    volTimer = setTimeout(() => api.call('settings:set', { volume: S.volume }).catch(() => {}), 400);
    publish();
  }

  /* ---------- Состояние для интерфейсов ---------- */
  function current() {
    if (isQueue() && S.track) {
      const d = audio.duration && isFinite(audio.duration) ? audio.duration * 1000 : S.track.duration;
      return { id: S.track.id, title: S.track.title, artist: S.track.artist, cover: S.track.cover, playing: !audio.paused && !audio.ended, position: audio.currentTime * 1000, duration: d };
    }
    if (S.source === 'spotify' && sp.st) {
      const t = sp.st.track_window.current_track;
      if (t) {
        const imgs = (t.album && t.album.images) || [];
        return { id: t.id, title: t.name, artist: t.artists.map((a) => a.name).join(', '), cover: (imgs[1] || imgs[0] || {}).url || null, playing: !sp.st.paused, position: spPos(), duration: sp.st.duration };
      }
    }
    return null;
  }

  function publish() {
    const c = current();
    api.send('player:state', {
      source: S.source, hasTrack: !!c, trackId: c ? c.id : null,
      title: c ? c.title : '', artist: c ? c.artist : '', cover: c ? c.cover : null,
      playing: !!(c && c.playing),
      position: c ? Math.min(c.position, c.duration || c.position) : 0, duration: c ? c.duration : 0,
      shuffle: S.shuffle, volume: S.volume, error: S.error, spotifyReady: !!sp.deviceId,
    });
  }

  // 5 полос для визуализации: реальный спектр (Яндекс) или плавная синтетика (Spotify защищён DRM)
  setInterval(() => {
    const c = current();
    let lv = [0, 0, 0, 0, 0];
    if (c && c.playing) {
      if (isQueue() && analyser) {
        analyser.getByteFrequencyData(freq);
        const bands = [[0, 1], [2, 4], [5, 9], [10, 17], [18, 30]];
        lv = bands.map(([a, b]) => {
          let s = 0;
          for (let i = a; i <= b; i++) s += freq[i];
          return Math.min(1, Math.pow(s / (b - a + 1) / 255, 1.3) * 1.35);
        });
      } else {
        const t = performance.now() / 1000;
        lv = [0, 1, 2, 3, 4].map((i) => Math.min(1, Math.max(0.12, 0.38 + 0.3 * Math.sin(t * (2.1 + i * 0.7) + i * 1.3) * Math.sin(t * (1.3 + i * 0.4)) + 0.2 * Math.sin(t * 5.3 + i))));
      }
    }
    api.send('player:levels', lv);
  }, 33);
  setInterval(publish, 500);

  /* ---------- Медиаклавиши Windows ---------- */
  function updateMedia() {
    const c = current();
    if (!c || !('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: c.title, artist: c.artist, artwork: c.cover ? [{ src: c.cover, sizes: '400x400' }] : [] });
  }
  if ('mediaSession' in navigator) {
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', toggle);
    ms.setActionHandler('pause', toggle);
    ms.setActionHandler('nexttrack', next);
    ms.setActionHandler('previoustrack', prev);
  }

  /* ---------- Команды от интерфейсов ---------- */
  api.on('player:cmd', async (cmd) => {
    try {
      switch (cmd.type) {
        case 'toggle': toggle(); break;
        case 'next': next(); break;
        case 'prev': prev(); break;
        case 'seek': seek(cmd.ms); break;
        case 'shuffle': setShuffle(cmd.value); break;
        case 'volume': setVolume(cmd.value); break;
        case 'playQueue': playQueue(cmd); break;
        case 'playSpotify': await playSpotify(cmd); break;
        case 'stopQueue': stopQueue(cmd.source); break;
      }
    } catch (e) { S.error = e.message; publish(); }
  });
  api.on('spotify:connected', loadSpotifySdk);
  api.on('spotify:disconnected', disconnectSpotify);

  /* ---------- Старт ---------- */
  (async () => {
    const cfg = await api.call('settings:get');
    S.volume = cfg.volume; S.shuffle = cfg.shuffle;
    audio = makeAudio(true);
    attachAnalyser(audio);
    const spState = await api.call('spotify:state');
    if (spState.profile) loadSpotifySdk();
    publish();
  })();
})();
