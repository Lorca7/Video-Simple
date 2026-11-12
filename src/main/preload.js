const { contextBridge, ipcRenderer, webUtils } = require('electron');

const inv = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);

contextBridge.exposeInMainWorld('api', {
  pathFor: (file) => webUtils.getPathForFile(file),
  probe: inv('media:probe'),
  waveform: inv('media:waveform'),
  proxy: inv('media:proxy'),
  importDialog: inv('dialog:import'),
  saveProject: inv('project:save'),
  openProject: inv('project:open'),
  confirmDiscard: inv('project:confirmDiscard'),
  setDirty: (d) => ipcRenderer.send('dirty', d),
  setTitle: (t) => ipcRenderer.send('title', t),
  exportChoosePath: inv('export:choosePath'),
  exportBegin: inv('export:begin'),
  exportFrames: inv('export:frames'),
  exportRun: inv('export:run'),
  exportCancel: inv('export:cancel'),
  exportCleanup: inv('export:cleanup'),
  reveal: inv('shell:reveal'),
  onMenu: (fn) => ipcRenderer.on('menu', (_e, cmd) => fn(cmd)),
  onExportProgress: (fn) => ipcRenderer.on('export:progress', (_e, p) => fn(p)),
});
