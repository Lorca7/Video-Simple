// Wiring: toolbar, transport, keyboard, menus, drag & drop, project files.
(function () {
  const VS = window.VS, S = VS.state;
  const $ = (id) => document.getElementById(id);

  // ---- toast -------------------------------------------------------------
  let toastTimer = null;
  VS.toast = (msg, ms = 4000) => {
    const el = $('toast');
    clearTimeout(toastTimer);
    el.hidden = !msg;
    el.textContent = msg || '';
    if (msg && ms) toastTimer = setTimeout(() => (el.hidden = true), ms);
  };

  // ---- buttons -----------------------------------------------------------
  const importDialog = async () => { const p = await window.api.importDialog(); if (p.length) VS.importFiles(p); };
  const split = () => { if (!VS.split()) VS.toast('Move the playhead over a clip to split it.', 2500); };
  const addText = () => { VS.showTab('text'); VS.addText(0); };
  $('btn-import').onclick = importDialog;
  $('btn-undo').onclick = VS.undo;
  $('btn-redo').onclick = VS.redo;
  $('btn-export').onclick = () => VS.openExport();
  $('btn-split').onclick = split;
  $('btn-delete').onclick = VS.deleteSelected;
  $('btn-duplicate').onclick = VS.duplicateSelected;
  $('btn-text').onclick = addText;
  $('btn-play').onclick = VS.toggle;
  $('btn-start').onclick = () => { VS.pause(); VS.seek(0); };
  $('btn-end').onclick = () => { VS.pause(); VS.seek(VS.total()); };
  const step = (d) => { VS.pause(); VS.seek(Math.round((S.time + d) / VS.FRAME) * VS.FRAME); };
  $('btn-back').onclick = () => step(-VS.FRAME);
  $('btn-fwd').onclick = () => step(VS.FRAME);

  function updateUi() {
    $('timecode').textContent = `${VS.fmt(S.time)} / ${VS.fmt(VS.total())}`;
    $('btn-play').textContent = S.playing ? '❚❚' : '▶';
    $('btn-undo').disabled = !VS.canUndo();
    $('btn-redo').disabled = !VS.canRedo();
    const sel = !!VS.selected();
    $('btn-delete').disabled = !sel;
    $('btn-duplicate').disabled = !sel;
    const name = S.path ? S.path.split('/').pop().replace(/\.vsproj$/, '') : 'Untitled';
    $('projname').textContent = name + (S.dirty ? ' — edited' : '');
  }
  for (const ev of ['time', 'change', 'select', 'playstate']) VS.on(ev, updateUi);

  // ---- keyboard ----------------------------------------------------------
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    const typing = t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || (t.tagName === 'INPUT' && !['range', 'checkbox', 'color'].includes(t.type));
    if (typing) { if (e.key === 'Escape') t.blur(); return; }
    if ($('export-dlg').open) return;
    const mod = e.metaKey || e.ctrlKey;
    let handled = true;
    if (mod && e.key.toLowerCase() === 'd') VS.duplicateSelected();
    else if (mod) handled = false; // other ⌘ shortcuts come from the menu
    else if (e.key === ' ') VS.toggle();
    else if (e.key === 's' || e.key === 'S') split();
    else if (e.key === 't' || e.key === 'T') addText();
    else if (e.key === 'Delete' || e.key === 'Backspace') VS.deleteSelected();
    else if (e.key === 'ArrowLeft' && t.type !== 'range') step(e.shiftKey ? -1 : -VS.FRAME);
    else if (e.key === 'ArrowRight' && t.type !== 'range') step(e.shiftKey ? 1 : VS.FRAME);
    else if (e.key === 'Home') { VS.pause(); VS.seek(0); }
    else if (e.key === 'End') { VS.pause(); VS.seek(VS.total()); }
    else if (e.key === '=' || e.key === '+') VS.setZoom(S.zoom * 1.3);
    else if (e.key === '-') VS.setZoom(S.zoom / 1.3);
    else if (e.key === 'Escape') VS.select(null);
    else handled = false;
    if (handled) { e.preventDefault(); if (t.blur && t !== document.body) t.blur(); }
  });

  // ---- project files -----------------------------------------------------
  function setProject(project, path) {
    VS.pause();
    VS.resetPlayer();
    S.project = project;
    S.path = path;
    S.sel = null;
    S.time = 0;
    S.dirty = false;
    VS.resetHistory();
    window.api.setDirty(false);
    window.api.setTitle(path ? `${path.split('/').pop()} — Video Simple` : 'Video Simple');
    VS.emit('media'); VS.emit('change'); VS.emit('select'); VS.emit('time');
    S.dirty = false; window.api.setDirty(false); updateUi(); // 'change' above marks dirty; a fresh project is clean
  }
  async function newProject() {
    if (await window.api.confirmDiscard()) setProject(VS.newProject(), null);
  }
  async function save(as) {
    const data = { app: 'video-simple', version: 1, project: { ...S.project, media: S.project.media.filter((m) => !m.hidden) } };
    const path = await window.api.saveProject(JSON.stringify(data, null, 1), as ? null : S.path);
    if (!path) return;
    S.path = path; S.dirty = false;
    window.api.setDirty(false);
    window.api.setTitle(`${path.split('/').pop()} — Video Simple`);
    updateUi();
    VS.toast('Project saved.', 1500);
  }
  async function open() {
    if (!(await window.api.confirmDiscard())) return;
    const r = await window.api.openProject();
    if (!r) return;
    let data;
    try { data = JSON.parse(r.json); if (data.app !== 'video-simple') throw 0; } catch { VS.toast('That file is not a Video Simple project.'); return; }
    const project = { ...VS.newProject(), ...data.project };
    // Re-check every media file: it may have moved, and cached thumbnails may be gone.
    for (const m of project.media) {
      try { Object.assign(m, await window.api.probe(m.path)); } catch { m.missing = true; }
    }
    setProject(project, r.path);
    project.media.forEach(VS.loadWave);
    const n = project.media.filter((m) => m.missing).length;
    if (n) VS.toast(`${n} media file${n > 1 ? 's are' : ' is'} missing (shown in red).`, 6000);
    VS.fit();
  }

  window.api.onMenu((cmd) => {
    const a = document.activeElement;
    const typing = a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && a.type === 'text'));
    ({
      new: newProject, open, save: () => save(false), saveAs: () => save(true), import: importDialog,
      export: () => VS.openExport(), split, text: addText,
      undo: () => (typing ? document.execCommand('undo') : VS.undo()),
      redo: () => (typing ? document.execCommand('redo') : VS.redo()),
    })[cmd]?.();
  });

  // ---- drag & drop from Finder -------------------------------------------
  const veil = $('dropveil');
  let depth = 0;
  const hasFiles = (e) => e.dataTransfer && e.dataTransfer.types.includes('Files');
  VS.hideVeil = () => { depth = 0; veil.hidden = true; };
  document.addEventListener('dragenter', (e) => { if (hasFiles(e)) { depth++; veil.hidden = false; } });
  document.addEventListener('dragleave', (e) => { if (hasFiles(e) && --depth <= 0) VS.hideVeil(); });
  document.addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  document.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    VS.hideVeil();
    const paths = [...e.dataTransfer.files].map((f) => window.api.pathFor(f)).filter(Boolean);
    // First files into an empty project go straight onto the timeline.
    const empty = VS.allClips().length === 0;
    if (paths.length) VS.importFiles(paths, empty ? { time: null, row: null } : null).then(() => empty && VS.fit());
  });

  updateUi();
})();
