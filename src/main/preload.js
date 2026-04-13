const { contextBridge, ipcRenderer } = require('electron');

const ELECTRON_CHANNELS = new Set([
  'settings:chooseLogoFile',
  'settings:chooseRestoreFile',
  'settings:uploadLogo',
  'settings:restoreBackup',
  'products:chooseImportFile',
  'products:chooseSaveFile',
]);

contextBridge.exposeInMainWorld('electron', {
  invoke: async (channel, data) => {
    if (ELECTRON_CHANNELS.has(channel)) {
      return ipcRenderer.invoke(channel, data);
    }

    const res = await fetch('http://127.0.0.1:3001/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, data: data || {} }),
    });
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    return json.result;
  },
  on: (channel, callback) => {
    ipcRenderer.on(channel, (event, ...args) => callback(...args));
  },
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
});
