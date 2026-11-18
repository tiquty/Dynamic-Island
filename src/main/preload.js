'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // вызов с ответом; ошибки приходят как обычный Error с понятным текстом
  call: async (channel, ...args) => {
    const r = await ipcRenderer.invoke(channel, ...args);
    if (!r || !r.ok) throw new Error((r && r.error) || 'Неизвестная ошибка');
    return r.data;
  },
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),
  on: (channel, fn) => {
    const h = (_e, ...a) => fn(...a);
    ipcRenderer.on(channel, h);
    return () => ipcRenderer.removeListener(channel, h);
  },
});
