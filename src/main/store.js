'use strict';
// Хранилище настроек и токенов. Файл шифруется через Windows DPAPI (safeStorage),
// поэтому токены лежат на диске не в открытом виде и переживают перезапуск.
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

let file;
let data = {};

function init() {
  file = path.join(app.getPath('userData'), 'store.dat');
  try {
    const buf = fs.readFileSync(file);
    const txt = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8');
    data = JSON.parse(txt);
  } catch {
    data = {};
  }
}

function save() {
  const txt = JSON.stringify(data);
  const buf = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(txt) : Buffer.from(txt, 'utf8');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
}

const get = (key) => data[key];
const set = (key, value) => {
  if (value === null || value === undefined) delete data[key];
  else data[key] = value;
  save();
};

module.exports = { init, get, set };
