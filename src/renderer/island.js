(() => {
  const $ = (id) => document.getElementById(id);
  const island = $('island');
  const bars = [...$('bars').children];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const fmt = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

  const SOURCES = { yandex: 'Яндекс Музыка', vk: 'ВКонтакте', spotify: 'Spotify' };
  let volDrag = false, lastVol = 0.8;
  let expanded = false, busy = false, st = null, vis = true, lastCover = null;
  let base = { pos: 0, at: performance.now(), playing: false };

  hydrateIcons();

  /* ---------- раскрытие / сворачивание ---------- */
  async function setExpanded(v) {
    if (busy || v === expanded) return;
    busy = true;
    expanded = v;
    if (v) {
      await api.call('ui:island-size', true);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      island.classList.add('expanded');
    } else {
      island.classList.remove('expanded');
      await sleep(430);
      await api.call('ui:island-size', false);
    }
    busy = false;
  }

  island.addEventListener('click', () => { if (!expanded) setExpanded(true); });
  $('btnCollapse').onclick = (e) => { e.stopPropagation(); setExpanded(false); };
  $('btnSettings').onclick = (e) => { e.stopPropagation(); api.send('ui:to-settings'); };

  // прозрачная часть окна не должна перехватывать клики по другим программам
  island.addEventListener('mouseenter', () => api.send('ui:island-ignore', false));
  island.addEventListener('mouseleave', () => api.send('ui:island-ignore', true));

  api.on('island:reset', () => {
    island.classList.remove('expanded');
    expanded = false; busy = false;
  });

  /* ---------- управление ---------- */
  const cmd = (c) => api.send('player:cmd', c);
  $('btnPlay').onclick = () => cmd({ type: 'toggle' });
  $('btnNext').onclick = () => cmd({ type: 'next' });
  $('btnPrev').onclick = () => cmd({ type: 'prev' });
  $('btnShuffle').onclick = () => cmd({ type: 'shuffle', value: !(st && st.shuffle) });
  $('volRange').addEventListener('pointerdown', () => { volDrag = true; });
  window.addEventListener('pointerup', () => { volDrag = false; });
  $('volRange').oninput = (e) => { const v = e.target.value / 100; if (v > 0) lastVol = v; cmd({ type: 'volume', value: v }); };
  $('btnVol').onclick = () => cmd({ type: 'volume', value: st && st.volume > 0 ? 0 : lastVol });
  $('bar').addEventListener('click', (e) => {
    if (!st || !st.duration) return;
    const r = $('bar').getBoundingClientRect();
    cmd({ type: 'seek', ms: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * st.duration });
  });

  /* ---------- отрисовка ---------- */
  function setCover(el, url) {
    el.style.backgroundImage = url ? `url("${url}")` : '';
    el.classList.toggle('has-img', !!url);
  }

  function render(s) {
    st = s;
    $('title').textContent = s.hasTrack ? s.title : (s.error ? 'Ошибка воспроизведения' : 'Ничего не играет');
    $('artist').textContent = s.hasTrack ? s.artist : (s.error || 'Выберите плейлист в настройках');
    $('tDur').textContent = fmt(s.duration);
    $('src').textContent = s.source === 'system' ? (s.appName || 'Windows') : (SOURCES[s.source] || '');
    if (s.volume > 0) lastVol = s.volume;
    if (!volDrag) $('volRange').value = Math.round(s.volume * 100);
    $('btnVol').innerHTML = ICONS[s.volume <= 0 ? 'volumeOff' : 'volume'];
    $('vol').classList.toggle('off', s.source === 'system'); // громкость чужих приложений мы не меняем
    $('btnShuffle').style.visibility = s.source === 'system' ? 'hidden' : '';
    $('btnShuffle').classList.toggle('on', !!s.shuffle);
    $('btnPlay').innerHTML = ICONS[s.playing ? 'pause' : 'play'];
    base = { pos: s.position, at: performance.now(), playing: s.playing };

    if (s.cover !== lastCover) {
      lastCover = s.cover;
      setCover($('cover'), s.cover);
      setCover($('miniCover'), s.cover);
      coverColor(s.cover).then((c) => island.style.setProperty('--accent', c || '#fff'));
    }
  }

  api.on('player:state', render);
  api.on('player:levels', (lv) => {
    if (!vis || (st && st.source === 'system')) return;
    bars.forEach((b, i) => { b.style.transform = `scaleY(${Math.max(0.18, lv[i])})`; });
  });
  api.on('settings:changed', applySettings);

  function applySettings(c) {
    vis = !!c.visualizer;
    island.classList.toggle('novis', !vis);
    document.documentElement.style.setProperty('--top', c.topOffset + 'px');
    island.style.setProperty('--cw', c.collapsedWidth + 'px');
  }

  // для музыки из других приложений реального звука мы не слышим, поэтому полосы играют плавную анимацию
  setInterval(() => {
    if (!vis || !st || st.source !== 'system') return;
    const t = performance.now() / 1000;
    bars.forEach((b, i) => {
      const v = st.playing ? 0.38 + 0.3 * Math.sin(t * (2.1 + i * 0.7) + i * 1.3) * Math.sin(t * (1.3 + i * 0.4)) + 0.2 * Math.sin(t * 5.3 + i) : 0;
      b.style.transform = `scaleY(${Math.min(1, Math.max(0.18, v))})`;
    });
  }, 33);

  // плавный прогресс между обновлениями состояния
  function tick() {
    if (expanded && st && st.duration) {
      const pos = Math.min(st.duration, base.pos + (base.playing ? performance.now() - base.at : 0));
      $('fill').style.width = (pos / st.duration) * 100 + '%';
      $('tCur').textContent = fmt(pos);
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  (async () => {
    applySettings(await api.call('settings:get'));
    const s = await api.call('player:getState');
    if (s) render(s);
  })();
})();
