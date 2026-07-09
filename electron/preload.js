import { contextBridge } from 'electron';

// Expose safe APIs to renderer if needed in the future
contextBridge.exposeInMainWorld('resonoteNative', {
  platform: process.platform,
  version: process.versions.electron
});
