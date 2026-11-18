'use strict';
// Скачивает сборку Electron с Widevine (castlabs) прямо из релиза на GitHub
// и распаковывает её в node_modules/electron/dist.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const TAG = 'v42.11.0+wvcus';
const root = path.join(__dirname, '..');
const dist = path.join(root, 'node_modules', 'electron', 'dist');
const zip = path.join(root, '.build-tools', 'electron.zip');
const headers = { 'User-Agent': 'island-player', Accept: 'application/vnd.github+json' };
if (process.env.GITHUB_TOKEN) headers.Authorization = 'Bearer ' + process.env.GITHUB_TOKEN; // в облаке лимиты API общие

async function get(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${url} ответил кодом ${res.status}`);
  return res;
}

(async () => {
  const release = await (await get(`https://api.github.com/repos/castlabs/electron-releases/releases/tags/${encodeURIComponent(TAG)}`)).json();
  const assets = release.assets || [];
  const asset = assets.find((a) => /^electron-v.*-win32-x64\.zip$/.test(a.name));
  if (!asset) throw new Error('В релизе нет сборки для Windows x64. Файлы: ' + assets.map((a) => a.name).join(', '));

  console.log(`Скачиваю ${asset.name} (${Math.round(asset.size / 1048576)} МБ)...`);
  const buf = Buffer.from(await (await get(asset.browser_download_url)).arrayBuffer());
  fs.mkdirSync(path.dirname(zip), { recursive: true });
  fs.writeFileSync(zip, buf);

  console.log('Распаковываю...');
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });
  execFileSync('tar', ['-xf', zip, '-C', dist], { stdio: 'inherit' });
  fs.rmSync(zip);

  if (!fs.existsSync(path.join(dist, 'electron.exe'))) throw new Error('После распаковки нет electron.exe');
  console.log('Electron готов.');
})().catch((e) => {
  console.error('ОШИБКА: ' + e.message + (e.cause ? ' (' + (e.cause.code || e.cause.message) + ')' : ''));
  process.exit(1);
});
