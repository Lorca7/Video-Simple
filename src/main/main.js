const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const ff = require('./ffmpeg');

let win = null;
let dirty = false;
let forceClose = false;
let exportProc = null;
let exportCanceled = false;

const MEDIA_EXT = ['mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi', 'mts', 'gif', 'mp3', 'wav', 'm4a', 'aac', 'aif', 'aiff', 'flac', 'ogg',
  'jpg', 'jpeg', 'png', 'bmp', 'webp'];

function cacheDir() {
  const d = path.join(app.getPath('userData'), 'cache');
  fs.mkdirSync(d, { recursive: true });
  return d;
}
function cacheFile(file, suffix) {
  const st = fs.statSync(file);
  const key = crypto.createHash('sha1').update(`${file}|${st.size}|${st.mtimeMs}`).digest('hex').slice(0, 20);
  return path.join(cacheDir(), key + suffix);
}
const toUrl = (p) => pathToFileURL(p).href;
const send = (channel, ...a) => win && !win.isDestroyed() && win.webContents.send(channel, ...a);

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1000, minHeight: 640,
    backgroundColor: '#17181c',
    title: 'Video Simple',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault()); // dropped files must never navigate the window
  win.on('close', (e) => {
    if (!dirty || forceClose || process.env.VS_TEST) return;
    e.preventDefault();
    const r = dialog.showMessageBoxSync(win, {
      type: 'warning', buttons: ['Cancel', 'Discard Changes'], defaultId: 0, cancelId: 0,
      message: 'You have unsaved changes.', detail: 'Close without saving your project?',
    });
    if (r === 1) { forceClose = true; win.close(); }
  });
  win.on('closed', () => { win = null; forceClose = false; dirty = false; });
}

function buildMenu() {
  const m = (label, accelerator, cmd) => ({ label, accelerator, click: () => send('menu', cmd) });
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [
      m('New Project', 'CmdOrCtrl+N', 'new'),
      m('Open Project…', 'CmdOrCtrl+O', 'open'),
      { type: 'separator' },
      m('Save Project', 'CmdOrCtrl+S', 'save'),
      m('Save Project As…', 'Shift+CmdOrCtrl+S', 'saveAs'),
      { type: 'separator' },
      m('Import Media…', 'CmdOrCtrl+I', 'import'),
      m('Export for YouTube…', 'CmdOrCtrl+E', 'export'),
      ...(process.platform === 'darwin' ? [] : [{ type: 'separator' }, { role: 'quit' }]),
    ] },
    { label: 'Edit', submenu: [
      m('Undo', 'CmdOrCtrl+Z', 'undo'),
      m('Redo', 'Shift+CmdOrCtrl+Z', 'redo'),
      { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      { type: 'separator' },
      m('Split at Playhead', 'CmdOrCtrl+B', 'split'),
      m('Add Text', 'CmdOrCtrl+T', 'text'),
    ] },
    { label: 'View', submenu: [{ role: 'togglefullscreen' }, ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }, { role: 'reload' }])] },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- media -------------------------------------------------------------
ipcMain.handle('media:probe', async (_e, file) => {
  const name = path.basename(file);
  if (!fs.existsSync(file)) return { path: file, name, missing: true };
  const info = await ff.probe(file);
  let thumb = null;
  if (info.kind !== 'audio') {
    const out = cacheFile(file, '.jpg');
    if (!fs.existsSync(out)) await ff.thumbnail(file, info, out).catch(() => {});
    if (fs.existsSync(out)) thumb = toUrl(out);
  }
  let proxyUrl = null;
  const px = cacheFile(file, '.proxy.mp4');
  if (fs.existsSync(px)) proxyUrl = toUrl(px);
  return { ...info, path: file, name, url: toUrl(file), thumb, proxyUrl, missing: false };
});

ipcMain.handle('media:waveform', async (_e, file) => {
  const out = cacheFile(file, '.wave.png');
  if (!fs.existsSync(out)) await ff.waveform(file, out);
  return toUrl(out);
});

ipcMain.handle('media:proxy', async (_e, file) => {
  const out = cacheFile(file, '.proxy.mp4');
  if (!fs.existsSync(out)) await ff.proxy(file, out);
  return toUrl(out);
});

ipcMain.handle('dialog:import', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Import Media', properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Video, audio and images', extensions: MEDIA_EXT }],
  });
  return r.canceled ? [] : r.filePaths;
});

// ---- project files -----------------------------------------------------
ipcMain.handle('project:save', async (_e, json, file) => {
  if (!file) {
    const r = await dialog.showSaveDialog(win, {
      title: 'Save Project', defaultPath: path.join(app.getPath('documents'), 'My Video.vsproj'),
      filters: [{ name: 'Video Simple Project', extensions: ['vsproj'] }],
    });
    if (r.canceled) return null;
    file = r.filePath;
  }
  fs.writeFileSync(file, json);
  return file;
});

ipcMain.handle('project:open', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Open Project', properties: ['openFile'],
    filters: [{ name: 'Video Simple Project', extensions: ['vsproj'] }],
  });
  if (r.canceled) return null;
  return { path: r.filePaths[0], json: fs.readFileSync(r.filePaths[0], 'utf8') };
});

ipcMain.handle('project:confirmDiscard', async () => {
  if (!dirty) return true;
  const r = await dialog.showMessageBox(win, {
    type: 'warning', buttons: ['Cancel', 'Discard Changes'], defaultId: 0, cancelId: 0,
    message: 'You have unsaved changes.', detail: 'Continue without saving your project?',
  });
  return r.response === 1;
});

ipcMain.on('dirty', (_e, d) => { dirty = !!d; if (win && process.platform === 'darwin') win.setDocumentEdited(dirty); });
ipcMain.on('title', (_e, t) => win && win.setTitle(t));

// ---- export ------------------------------------------------------------
const TMP_PREFIX = 'videosimple-export-';
const isExportDir = (d) => path.dirname(d) === fs.realpathSync(os.tmpdir()) && path.basename(d).startsWith(TMP_PREFIX);

ipcMain.handle('export:choosePath', async (_e, name) => {
  if (process.env.VS_TEST_EXPORT) return process.env.VS_TEST_EXPORT;
  const r = await dialog.showSaveDialog(win, {
    title: 'Export for YouTube', buttonLabel: 'Export',
    defaultPath: path.join(app.getPath('desktop'), `${name || 'My Video'}.mp4`),
    filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
  });
  return r.canceled ? null : r.filePath;
});

ipcMain.handle('export:begin', () => fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), TMP_PREFIX)));

// Write one rendered text frame, repeated for frames [from, to].
ipcMain.handle('export:frames', (_e, dir, clip, from, to, buf) => {
  if (!isExportDir(dir)) throw new Error('bad export dir');
  const file = (f) => path.join(dir, `t${clip}_${String(f).padStart(6, '0')}.png`);
  fs.writeFileSync(file(from), Buffer.from(buf));
  for (let f = from + 1; f <= to; f++) {
    try { fs.linkSync(file(from), file(f)); } catch { fs.copyFileSync(file(from), file(f)); }
  }
});

ipcMain.handle('export:run', async (_e, dir, spec, opts) => {
  if (!isExportDir(dir)) throw new Error('bad export dir');
  spec.overlays = spec.overlays.map((o) => ({ ...o, pattern: path.join(dir, `t${o.index}_%06d.png`) }));
  const { args, total } = ff.buildExportArgs(spec, opts);
  exportCanceled = false;
  const r = await ff.run(args, {
    onSpawn: (p) => { exportProc = p; },
    onStdout: (s) => {
      const m = [...s.matchAll(/out_time_(?:us|ms)=(\d+)/g)].pop();
      if (m) send('export:progress', Math.min(1, +m[1] / 1e6 / total));
    },
  }).catch((err) => ({ code: -1, stderr: String(err) }));
  exportProc = null;
  if (r.code === 0) return { ok: true, path: opts.outPath };
  fs.rmSync(opts.outPath, { force: true });
  if (exportCanceled) return { ok: false, canceled: true };
  return { ok: false, error: r.stderr.trim().split('\n').slice(-6).join('\n') };
});

ipcMain.handle('export:cancel', () => { exportCanceled = true; if (exportProc) exportProc.kill('SIGKILL'); });
ipcMain.handle('export:cleanup', (_e, dir) => { if (dir && isExportDir(dir)) fs.rmSync(dir, { recursive: true, force: true }); });
ipcMain.handle('shell:reveal', (_e, file) => shell.showItemInFolder(file));

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => { if (!win) createWindow(); });
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { if (exportProc) exportProc.kill('SIGKILL'); });
