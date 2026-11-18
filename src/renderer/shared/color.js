// Подбирает акцентный цвет по обложке: насыщенные пиксели весят больше, яркость ограничена,
// чтобы цвет всегда был читаемым на тёмном фоне.
(() => {
  function rgb2hsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const l = (mx + mn) / 2;
    let h = 0, s = 0;
    if (mx !== mn) {
      const d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return [h, s, l];
  }

  window.coverColor = (url) => new Promise((resolve) => {
    if (!url) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = c.height = 16;
        const x = c.getContext('2d', { willReadFrequently: true });
        x.drawImage(img, 0, 0, 16, 16);
        const d = x.getImageData(0, 0, 16, 16).data;
        let r = 0, g = 0, b = 0, w = 0;
        for (let i = 0; i < d.length; i += 4) {
          const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
          const sat = (mx - mn) / (mx || 1);
          const wt = 0.1 + sat * sat * 3;
          r += d[i] * wt; g += d[i + 1] * wt; b += d[i + 2] * wt; w += wt;
        }
        const [h, s] = rgb2hsl(r / w, g / w, b / w);
        const S = Math.min(Math.max(s, 0.45), 0.9);
        resolve(`hsl(${Math.round(h)} ${Math.round(S * 100)}% 66%)`);
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
})();
