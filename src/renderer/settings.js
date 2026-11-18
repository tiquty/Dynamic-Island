(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const plural = (n, f) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? f[2] : b > 1 && b < 5 ? f[1] : b === 1 ? f[0] : f[2]; };
  const cmd = (c) => api.send('player:cmd', c);

  const view = $('#view');
  let tab = 'account', src = 'yandex', detail = null;
  let player = null, cfg = {};
  let acc = { yandex: null, vk: null, spotify: { profile: null, clientId: '', redirect: '' } };
  const cache = { yandex: null, vk: null, spotify: null };
  let lastCover = null;

  hydrateIcons();

  /* ---------- окно ---------- */
  $('#btnIsland').onclick = () => api.send('ui:to-island');
  $('#btnTray').onclick = () => api.send('ui:hide-to-tray');

  document.querySelectorAll('.tabs button').forEach((b) => { b.onclick = () => setTab(b.dataset.tab); });
  function setTab(t) {
    tab = t;
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
    view.scrollTop = 0;
    ({ account: renderAccount, playlists: renderPlaylists, settings: renderSettings })[t]();
  }

  const msg = (id, text, kind) => {
    const el = $('#' + id);
    if (!el) return;
    el.textContent = text;
    el.className = 'hint' + (kind ? ' ' + kind : '');
  };

  /* ---------- Аккаунт ---------- */
  function renderAccount() {
    const y = acc.yandex, v = acc.vk, s = acc.spotify;
    view.innerHTML = `
      <h1>Аккаунты</h1>
      <div class="cards">
        <section class="card">
          <div class="card-head">
            <div class="badge ya">Я</div>
            <div><h3>Яндекс Музыка</h3><div class="sub state ${y ? 'on' : ''}">${y ? 'Подключено' : 'Не подключено'}</div></div>
          </div>
          ${y ? `
            <p>Вы вошли как <b>${esc(y.name)}</b>${y.hasPlus ? ' с подпиской Плюс' : ''}.</p>
            ${y.hasPlus ? '' : '<p class="hint">Без подписки Плюс Яндекс может отдавать только фрагменты треков.</p>'}
            <div style="margin-top:16px"><button class="btn danger" id="yaOut">Выйти из аккаунта</button></div>
          ` : `
            <button class="btn primary wide" id="yaWeb">Войти через Яндекс</button>
            <div class="or">или вставьте токен</div>
            <div class="row"><input type="password" id="yaToken" placeholder="Токен y0_…" autocomplete="off"><button class="btn" id="yaGo">Подключить</button></div>
            <p class="hint" id="yaMsg">Вход выполняется один раз. Токен хранится зашифрованным на вашем компьютере.</p>
          `}
        </section>

        <section class="card">
          <div class="card-head">
            <div class="badge vk">VK</div>
            <div><h3>ВКонтакте</h3><div class="sub state ${v ? 'on' : ''}">${v ? 'Подключено' : 'Не подключено'}</div></div>
          </div>
          ${v ? `
            <p>Вы вошли как <b>${esc(v.name)}</b>.</p>
            <div style="margin-top:16px"><button class="btn danger" id="vkOut">Выйти из аккаунта</button></div>
          ` : `
            <button class="btn primary wide" id="vkWeb">Войти через ВКонтакте</button>
            <div class="or">или вставьте токен</div>
            <div class="row"><input type="password" id="vkToken" placeholder="Токен vk1.a… или адрес после входа" autocomplete="off"><button class="btn" id="vkGo">Подключить</button></div>
            <p class="hint" id="vkMsg">Откроется настоящая страница входа ВКонтакте. Код из SMS и капчу обработает сам ВК, пароль программа не видит. Вход неофициальный, ВК может его ограничить.</p>
          `}
        </section>

        <section class="card">
          <div class="card-head">
            <div class="badge sp">S</div>
            <div><h3>Spotify</h3><div class="sub state ${s.profile ? 'on' : ''}">${s.profile ? 'Подключено' : 'Не подключено'}</div></div>
          </div>
          ${s.profile ? `
            <p>Вы вошли как <b>${esc(s.profile.name)}</b>${s.profile.product ? ' · ' + esc(s.profile.product) : ''}.</p>
            <p class="hint">Для воспроизведения нужна подписка Premium.</p>
            <div style="margin-top:16px"><button class="btn danger" id="spOut">Выйти из аккаунта</button></div>
          ` : `
            <div class="row"><input type="text" id="spId" placeholder="Client ID приложения Spotify" value="${esc(s.clientId)}" autocomplete="off"><button class="btn primary" id="spGo">Войти</button></div>
            <p class="hint" id="spMsg">Откроется браузер для подтверждения входа. Делать это нужно один раз.</p>
            <details>
              <summary>Как получить Client ID</summary>
              <ol>
                <li>Откройте <a href="https://developer.spotify.com/dashboard" target="_blank" style="color:var(--accent)">developer.spotify.com/dashboard</a> и нажмите Create app.</li>
                <li>В поле Redirect URI укажите <code id="spRedirect">${esc(s.redirect)}</code></li>
                <li>Отметьте Web API и Web Playback SDK, сохраните приложение.</li>
                <li>Скопируйте Client ID из настроек приложения и вставьте выше.</li>
              </ol>
            </details>
          `}
        </section>
      </div>`;

    if (y) {
      $('#yaOut').onclick = async () => { await api.call('yandex:logout'); acc.yandex = null; cache.yandex = null; renderAccount(); };
    } else {
      $('#yaWeb').onclick = async () => {
        msg('yaMsg', 'Открываю окно входа…');
        try { await connectYandex(await api.call('yandex:authWindow')); } catch (e) { msg('yaMsg', e.message, 'err'); }
      };
      $('#yaGo').onclick = async () => { try { await connectYandex($('#yaToken').value); } catch (e) { msg('yaMsg', e.message, 'err'); } };
    }

    if (v) {
      $('#vkOut').onclick = async () => { await api.call('vk:logout'); acc.vk = null; cache.vk = null; renderAccount(); };
    } else {
      $('#vkWeb').onclick = async () => {
        msg('vkMsg', 'Открываю страницу входа…');
        try { await connectVk(await api.call('vk:authWindow')); } catch (e) { msg('vkMsg', e.message, 'err'); }
      };
      $('#vkGo').onclick = async () => { try { await connectVk($('#vkToken').value); } catch (e) { msg('vkMsg', e.message, 'err'); } };
    }

    if (s.profile) {
      $('#spOut').onclick = async () => { await api.call('spotify:logout'); acc.spotify.profile = null; cache.spotify = null; renderAccount(); };
    } else {
      $('#spGo').onclick = async () => {
        const id = $('#spId').value.trim();
        if (!id) return msg('spMsg', 'Вставьте Client ID', 'err');
        try {
          await api.call('spotify:setClientId', id);
          msg('spMsg', 'Подтвердите вход в браузере…');
          acc.spotify.profile = await api.call('spotify:login');
          acc.spotify.clientId = id;
          cache.spotify = null;
          renderAccount();
        } catch (e) { msg('spMsg', e.message, 'err'); }
      };
    }
  }

  async function connectVk(token) {
    msg('vkMsg', 'Проверяю токен…');
    acc.vk = await api.call('vk:login', token);
    cache.vk = null;
    renderAccount();
  }

  async function connectYandex(token) {
    msg('yaMsg', 'Проверяю токен…');
    acc.yandex = await api.call('yandex:login', token);
    cache.yandex = null;
    renderAccount();
  }

  /* ---------- Плейлисты ---------- */
  const NAMES = { yandex: 'Яндекс Музыка', vk: 'ВКонтакте', spotify: 'Spotify' };
  const isLogged = (s) => (s === 'spotify' ? !!acc.spotify.profile : !!acc[s]);
  const artStyle = (u) => (u ? `style="background-image:url('${esc(u)}')"` : '');

  function renderPlaylists() {
    view.innerHTML = `<h1>Плейлисты</h1>
      <div class="seg">${Object.keys(NAMES).map((k) => `<button data-s="${k}">${NAMES[k]}</button>`).join('')}</div>
      <div id="plBody"></div>`;
    view.querySelectorAll('.seg button').forEach((b) => {
      b.classList.toggle('on', b.dataset.s === src);
      b.onclick = () => { if (src !== b.dataset.s) { src = b.dataset.s; detail = null; renderPlaylists(); } };
    });
    loadPlaylists();
  }

  async function loadPlaylists() {
    const mySrc = src;
    const body = $('#plBody');
    if (!isLogged(src)) {
      body.innerHTML = `<div class="center"><p>Сначала подключите ${NAMES[src]} на вкладке «Аккаунт».</p><button class="btn primary" id="goAcc">Перейти к аккаунтам</button></div>`;
      $('#goAcc').onclick = () => setTab('account');
      return;
    }
    if (!cache[src]) {
      body.innerHTML = '<div class="center"><div class="spin"></div></div>';
      try { cache[src] = await api.call(src + ':playlists'); }
      catch (e) {
        if (mySrc !== src || tab !== 'playlists') return;
        body.innerHTML = `<div class="center"><p>${esc(e.message)}</p><button class="btn" id="retry">Повторить</button></div>`;
        $('#retry').onclick = loadPlaylists;
        return;
      }
    }
    if (mySrc !== src || tab !== 'playlists' || !$('#plBody')) return;
    const list = cache[src];
    $('#plBody').innerHTML = `<div class="grid">${list.map((p, i) => `
      <button class="pl" data-i="${i}">
        <div class="art" ${artStyle(p.cover)}>${p.cover ? '' : ICONS.note}<span class="go">${ICONS.play}</span></div>
        <div class="t">${esc(p.title)}</div>
        <div class="c">${p.count != null ? p.count + ' ' + plural(p.count, ['трек', 'трека', 'треков']) : ''}</div>
      </button>`).join('')}</div>`;
    view.querySelectorAll('.pl').forEach((b) => { b.onclick = () => openPlaylist(list[+b.dataset.i]); });
  }

  async function openPlaylist(p) {
    const mySrc = src;
    detail = p;
    view.innerHTML = `<button class="back" id="back">${ICONS.back}Плейлисты</button><div class="center"><div class="spin"></div></div>`;
    $('#back').onclick = () => { detail = null; renderPlaylists(); };

    let tracks = [], note = '';
    try { tracks = await api.call(src + ':tracks', p.id); } catch (e) { note = e.message; }
    if (detail !== p || tab !== 'playlists' || mySrc !== src) return;

    const canPlay = tracks.length > 0 || (mySrc === 'spotify' && p.id !== 'liked');
    view.innerHTML = `
      <button class="back" id="back">${ICONS.back}Плейлисты</button>
      <div class="detail-head">
        <div class="art" ${artStyle(p.cover)}>${p.cover ? '' : ICONS.note}</div>
        <div>
          <h2>${esc(p.title)}</h2>
          <div class="sub">${tracks.length ? tracks.length + ' ' + plural(tracks.length, ['трек', 'трека', 'треков']) : (p.count != null ? p.count + ' ' + plural(p.count, ['трек', 'трека', 'треков']) : '')}</div>
          <div class="acts">
            <button class="btn primary" id="playAll" ${canPlay ? '' : 'disabled'}>Слушать</button>
            <button class="btn" id="playShuffle" ${canPlay ? '' : 'disabled'}>Вперемешку</button>
          </div>
        </div>
      </div>
      ${note ? `<p class="hint err" style="margin-bottom:14px">${esc(note)}</p>` : ''}
      <div class="rows" id="rows">${tracks.map((t, i) => `
        <button class="row-t" data-i="${i}" data-id="${esc(t.id)}">
          <div class="art" ${artStyle(t.cover)}>${t.cover ? '' : ICONS.note}</div>
          <div class="n"><div>${esc(t.title)}</div><div>${esc(t.artist)}</div></div>
          <div class="d">${t.duration ? fmt(t.duration) : ''}</div>
        </button>`).join('')}</div>`;

    $('#back').onclick = () => { detail = null; renderPlaylists(); };
    $('#playAll').onclick = () => play(p, tracks, 0, false);
    $('#playShuffle').onclick = () => play(p, tracks, 0, true);
    view.querySelectorAll('.row-t').forEach((r) => { r.onclick = () => play(p, tracks, +r.dataset.i); });
    markNowPlaying();
  }

  function play(p, tracks, index, shuffle) {
    if (shuffle !== undefined) cmd({ type: 'shuffle', value: shuffle });
    if (src !== 'spotify') {
      if (!tracks.length) return;
      if (shuffle) index = Math.floor(Math.random() * tracks.length);
      cmd({ type: 'playQueue', tracks, index });
    } else if (p.id === 'liked') {
      if (!tracks.length) return;
      if (shuffle) index = Math.floor(Math.random() * tracks.length);
      cmd({ type: 'playSpotify', uris: tracks.map((t) => t.uri), offsetPos: index });
    } else {
      cmd({ type: 'playSpotify', contextUri: p.uri, offsetUri: index > 0 && tracks[index] ? tracks[index].uri : undefined });
    }
  }

  function markNowPlaying() {
    view.querySelectorAll('.row-t').forEach((r) => r.classList.toggle('now', !!player && r.dataset.id === player.trackId));
  }

  /* ---------- Настройки ---------- */
  function renderSettings() {
    const vol = Math.round((player ? player.volume : cfg.volume) * 100);
    view.innerHTML = `
      <h1>Настройки</h1>
      <section class="card">
        <div class="setting">
          <div><b>Громкость</b></div>
          <div class="ctl"><input type="range" id="sVol" min="0" max="100" value="${vol}"><span class="val" id="sVolV">${vol}%</span></div>
        </div>
        <div class="setting">
          <div><b>Запускать вместе с Windows</b><div class="sub">Приложение стартует сразу в виде островка</div></div>
          <button class="switch ${cfg.autostart ? 'on' : ''}" id="sAuto" role="switch" aria-checked="${!!cfg.autostart}"></button>
        </div>
        <div class="setting">
          <div><b>Музыка из других приложений</b><div class="sub">YouTube в браузере, Яндекс Музыка и другие плееры Windows</div></div>
          <button class="switch ${cfg.systemMedia ? 'on' : ''}" id="sSys" role="switch" aria-checked="${!!cfg.systemMedia}"></button>
        </div>
        <div class="setting">
          <div><b>Визуализация в островке</b><div class="sub">Анимация полос во время воспроизведения</div></div>
          <button class="switch ${cfg.visualizer ? 'on' : ''}" id="sVis" role="switch" aria-checked="${!!cfg.visualizer}"></button>
        </div>
        <div class="setting">
          <div><b>Ширина островка</b><div class="sub">В свёрнутом виде</div></div>
          <div class="ctl"><input type="range" id="sWidth" min="140" max="360" step="5" value="${cfg.collapsedWidth}"><span class="val" id="sWidthV">${cfg.collapsedWidth} px</span></div>
        </div>
        <div class="setting">
          <div><b>Отступ островка от верха экрана</b></div>
          <div class="ctl"><input type="range" id="sTop" min="0" max="40" value="${cfg.topOffset}"><span class="val" id="sTopV">${cfg.topOffset} px</span></div>
        </div>
      </section>
      <div style="margin-top:18px"><button class="btn danger" id="sQuit">Закрыть приложение</button></div>`;

    $('#sVol').oninput = (e) => { $('#sVolV').textContent = e.target.value + '%'; cmd({ type: 'volume', value: e.target.value / 100 }); };
    $('#sWidth').oninput = (e) => { $('#sWidthV').textContent = e.target.value + ' px'; };
    $('#sWidth').onchange = (e) => api.call('settings:set', { collapsedWidth: +e.target.value });
    $('#sTop').oninput = (e) => { $('#sTopV').textContent = e.target.value + ' px'; };
    $('#sTop').onchange = (e) => api.call('settings:set', { topOffset: +e.target.value });
    const toggle = (id, key) => {
      $(id).onclick = async (e) => {
        const on = !e.currentTarget.classList.contains('on');
        e.currentTarget.classList.toggle('on', on);
        e.currentTarget.setAttribute('aria-checked', on);
        await api.call('settings:set', { [key]: on });
      };
    };
    toggle('#sAuto', 'autostart');
    toggle('#sVis', 'visualizer');
    toggle('#sSys', 'systemMedia');
    $('#sQuit').onclick = () => api.send('ui:quit');
  }

  /* ---------- Мини-плеер ---------- */
  let base = { pos: 0, at: 0, playing: false };
  function updateMini(s) {
    player = s;
    const mp = $('#mp'), err = $('#errbar');
    mp.hidden = !s.hasTrack;
    err.hidden = !s.error;
    err.textContent = s.error || '';
    if (s.hasTrack) {
      $('#mpTitle').textContent = s.title;
      $('#mpArtist').textContent = s.artist;
      $('#mpCover').style.backgroundImage = s.cover ? `url("${s.cover}")` : '';
      $('#mpPlay').innerHTML = ICONS[s.playing ? 'pause' : 'play'];
      $('#mpShuffle').classList.toggle('on', !!s.shuffle);
      $('#mpShuffle').style.display = s.source === 'system' ? 'none' : '';
      $('#mpVolBox').classList.toggle('off', s.source === 'system'); // громкость чужих приложений мы не меняем
      $('#mpVol').innerHTML = ICONS[s.volume <= 0 ? 'volumeOff' : 'volume'];
      if (s.volume > 0) lastVol = s.volume;
      if (document.activeElement !== $('#mpVolRange')) $('#mpVolRange').value = Math.round(s.volume * 100);
      base = { pos: s.position, at: performance.now(), playing: s.playing };
    }
    if (s.cover !== lastCover) {
      lastCover = s.cover;
      coverColor(s.cover).then((c) => document.documentElement.style.setProperty('--accent', c || '#9d8cff'));
    }
    markNowPlaying();
  }
  let lastVol = 0.8;
  $('#mpVolRange').oninput = (e) => { const v = e.target.value / 100; if (v > 0) lastVol = v; cmd({ type: 'volume', value: v }); };
  $('#mpVol').onclick = () => cmd({ type: 'volume', value: player && player.volume > 0 ? 0 : lastVol });
  $('#mpPlay').onclick = () => cmd({ type: 'toggle' });
  $('#mpNext').onclick = () => cmd({ type: 'next' });
  $('#mpPrev').onclick = () => cmd({ type: 'prev' });
  $('#mpShuffle').onclick = () => cmd({ type: 'shuffle', value: !(player && player.shuffle) });
  $('#mp .mp-prog').onclick = (e) => {
    if (!player || !player.duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    cmd({ type: 'seek', ms: ((e.clientX - r.left) / r.width) * player.duration });
  };
  (function tick() {
    if (player && player.hasTrack && player.duration) {
      const pos = Math.min(player.duration, base.pos + (base.playing ? performance.now() - base.at : 0));
      $('#mpFill').style.width = (pos / player.duration) * 100 + '%';
    }
    requestAnimationFrame(tick);
  })();

  /* ---------- Старт ---------- */
  api.on('player:state', updateMini);
  api.on('settings:changed', (c) => { cfg = c; });

  (async () => {
    cfg = await api.call('settings:get');
    acc.yandex = await api.call('yandex:profile');
    acc.vk = await api.call('vk:profile');
    acc.spotify = await api.call('spotify:state');
    const s = await api.call('player:getState');
    if (s) updateMini(s);
    setTab(acc.yandex || acc.vk || acc.spotify.profile ? 'playlists' : 'account');
  })();
})();
