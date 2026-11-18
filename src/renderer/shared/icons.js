(() => {
  const S = (b) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${b}</svg>`;
  const F = (b) => `<svg viewBox="0 0 24 24" fill="currentColor">${b}</svg>`;
  const next = '<path d="M6 6.2v11.6a.8.8 0 0 0 1.25.66l8.6-5.8a.8.8 0 0 0 0-1.32l-8.6-5.8A.8.8 0 0 0 6 6.2z"/><rect x="16.5" y="5.5" width="2.5" height="13" rx="1.2"/>';

  window.ICONS = {
    play: F('<path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/>'),
    pause: F('<rect x="6.5" y="5" width="4" height="14" rx="1.3"/><rect x="13.5" y="5" width="4" height="14" rx="1.3"/>'),
    next: F(next),
    prev: F(`<g transform="translate(24 0) scale(-1 1)">${next}</g>`),
    shuffle: S('<path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/>'),
    up: S('<path d="m6 15 6-6 6 6"/>'),
    back: S('<path d="m15 18-6-6 6-6"/>'),
    close: S('<path d="M6 6l12 12M18 6 6 18"/>'),
    island: S('<rect x="3" y="4" width="18" height="7" rx="3.5"/><path d="M8 17h8M10 21h4"/>'),
    sliders: S('<path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"/>'),
    user: S('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>'),
    list: S('<path d="M3 6h12M3 12h12M3 18h7"/><path d="M19 17V7l3-1"/><circle cx="17" cy="17" r="2"/>'),
    volume: S('<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a9 9 0 0 1 0 14"/>'),
    volumeOff: S('<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="m22 9-6 6"/><path d="m16 9 6 6"/>'),
    note: S('<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>'),
  };

  window.hydrateIcons = (root = document) => {
    root.querySelectorAll('[data-i]').forEach((el) => { el.innerHTML = window.ICONS[el.dataset.i] || ''; });
  };
})();
