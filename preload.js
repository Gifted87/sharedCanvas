// preload.js
const { contextBridge, ipcRenderer } = require('electron');

// Expose specific APIs safely to the renderer process (client.js)
// We don't need to expose anything for basic functionality right now.
contextBridge.exposeInMainWorld('electronAPI', {
  // Example: If you needed to trigger an Electron dialog from the client:
  // openDialog: (options) => ipcRenderer.invoke('dialog:open', options)
});

console.log('Preload script loaded. No specific APIs exposed currently.');