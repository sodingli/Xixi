const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('xixi', {
  getConfig: () => ipcRenderer.invoke('app:get-config'),
  getVoiceConfig: (persona) => ipcRenderer.invoke('voice:get-config', persona),
  exchangeVoiceSdp: (offerSdp) => ipcRenderer.invoke('voice:exchange-sdp', offerSdp),
  setAlwaysOnTop: (enabled) => ipcRenderer.invoke('window:set-always-on-top', enabled),
  setCompact: (enabled) => ipcRenderer.invoke('window:set-compact', enabled),
  hideWindow: () => ipcRenderer.invoke('window:hide'),
  getWindowBounds: () => ipcRenderer.invoke('window:get-bounds'),
  moveWindow: (position) => ipcRenderer.invoke('window:move-to', position),
  chat: (payload) => ipcRenderer.invoke('assistant:chat', payload),
  detectEmotion: (payload) => ipcRenderer.invoke('emotion:detect', payload),
  scheduleReminder: (reminder) => ipcRenderer.invoke('reminder:schedule', reminder),
  cancelReminder: (id) => ipcRenderer.invoke('reminder:cancel', id),
  showNotification: (payload) => ipcRenderer.invoke('notification:show', payload),
  onReminderDue: (callback) => {
    const listener = (_event, reminder) => callback(reminder);
    ipcRenderer.on('reminder:due', listener);
    return () => ipcRenderer.removeListener('reminder:due', listener);
  }
});
