// Project model, undo history and editing operations.
(function () {
  const VS = (window.VS = {});
  const listeners = {};
  VS.on = (ev, fn) => (listeners[ev] ||= []).push(fn);
  VS.emit = (ev, arg) => (listeners[ev] || []).forEach((fn) => fn(arg));

  let counter = 0;
  VS.uid = (p) => p + Date.now().toString(36) + (counter++).toString(36);
  VS.clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  VS.FRAME = 1 / 30;

  VS.newProject = () => ({ media: [], video: [], text: [], audio: [] });
  const S = (VS.state = { project: VS.newProject(), sel: null, time: 0, playing: false, zoom: 60, snap: true, path: null, dirty: false });

  // ---- lookups -----------------------------------------------------------
  VS.media = (id) => S.project.media.find((m) => m.id === id);
  VS.dur = (c) => (c.type === 'text' ? c.dur : c.out - c.in);
  VS.videoLayout = () => {
    let t = 0;
    return S.project.video.map((clip) => {
      const o = { clip, start: t, end: t + VS.dur(clip) };
      t = o.end;
      return o;
    });
  };
  VS.startOf = (c) => (c.type === 'video' ? VS.videoLayout().find((l) => l.clip === c).start : c.start);
  VS.listOf = (c) => S.project[c.type];
  VS.allClips = () => [...S.project.video, ...S.project.text, ...S.project.audio];
  VS.find = (id) => VS.allClips().find((c) => c.id === id) || null;
  VS.selected = () => (S.sel ? VS.find(S.sel) : null);
  VS.total = () => {
    const v = S.project.video.reduce((s, c) => s + VS.dur(c), 0);
    return Math.max(v, ...S.project.text.map((c) => c.start + c.dur), ...S.project.audio.map((c) => c.start + VS.dur(c)));
  };
  VS.fmt = (t) => {
    t = Math.max(0, t);
    const m = Math.floor(t / 60), s = t - m * 60;
    return `${m}:${s.toFixed(2).padStart(5, '0')}`;
  };

  // ---- state changes -----------------------------------------------------
  const undo = [], redo = [];
  const snapshot = () => JSON.stringify({ video: S.project.video, text: S.project.text, audio: S.project.audio });
  const restore = (json) => {
    Object.assign(S.project, JSON.parse(json));
    for (const c of VS.allClips()) { const m = c.mediaId && VS.media(c.mediaId); if (m) m.hidden = false; }
    if (!VS.selected()) S.sel = null;
    VS.changed();
    VS.emit('select');
    VS.emit('media');
  };
  /** Call before mutating clips so the change can be undone. */
  VS.checkpoint = () => { undo.push(snapshot()); if (undo.length > 200) undo.shift(); redo.length = 0; };
  /** Call after mutating the project. */
  VS.changed = () => {
    S.dirty = true;
    window.api.setDirty(true);
    S.time = VS.clamp(S.time, 0, VS.total());
    VS.emit('change');
  };
  VS.undo = () => { if (undo.length) { redo.push(snapshot()); restore(undo.pop()); } };
  VS.redo = () => { if (redo.length) { undo.push(snapshot()); restore(redo.pop()); } };
  VS.canUndo = () => undo.length > 0;
  VS.canRedo = () => redo.length > 0;
  VS.resetHistory = () => { undo.length = 0; redo.length = 0; };

  VS.select = (id) => { if (S.sel !== id) { S.sel = id; VS.emit('select'); } };
  VS.seek = (t) => { S.time = VS.clamp(t, 0, VS.total()); VS.emit('time'); };

  // ---- text presets ------------------------------------------------------
  VS.FONTS = ['Helvetica Neue', 'Avenir Next', 'Futura', 'Gill Sans', 'Optima', 'Arial', 'Arial Black', 'Impact', 'Verdana',
    'Georgia', 'Times New Roman', 'Didot', 'Baskerville', 'American Typewriter', 'Menlo', 'Courier New', 'Marker Felt',
    'Chalkboard SE', 'Copperplate'];
  VS.ANIM_IN = [['none', 'None'], ['fade', 'Fade in'], ['slide-up', 'Slide up'], ['slide-down', 'Slide down'], ['slide-left', 'Slide left'],
    ['slide-right', 'Slide right'], ['pop', 'Pop'], ['zoom', 'Zoom'], ['typewriter', 'Typewriter']];
  VS.ANIM_OUT = [['none', 'None'], ['fade', 'Fade out'], ['slide-up', 'Slide up'], ['slide-down', 'Slide down'], ['slide-left', 'Slide left'],
    ['slide-right', 'Slide right'], ['pop', 'Shrink']];
  const baseText = {
    text: 'Your text', font: 'Helvetica Neue', size: 90, color: '#ffffff', bold: false, italic: false, align: 'center',
    x: 0.5, y: 0.5, bg: { on: false, color: '#000000', opacity: 0.7 }, outline: { on: false, color: '#000000' },
    shadow: true, animIn: 'fade', animOut: 'fade', animDur: 0.6, dur: 4,
  };
  VS.PRESETS = [
    { name: 'Title', text: 'Your Title', size: 130, bold: true },
    { name: 'Subtitle', text: 'A subtitle goes here', size: 64, y: 0.64, animIn: 'slide-up' },
    { name: 'Lower Third', text: 'Name Here', size: 56, bold: true, x: 0.2, y: 0.82, shadow: false,
      bg: { on: true, color: '#111111', opacity: 0.8 }, animIn: 'slide-right', animOut: 'slide-left' },
    { name: 'Caption', text: 'Caption text', size: 48, y: 0.88, shadow: false, bg: { on: true, color: '#000000', opacity: 0.7 }, animIn: 'none', animOut: 'none' },
    { name: 'Pop', text: 'WOW!', size: 180, bold: true, font: 'Arial Black', color: '#ffd60a', outline: { on: true, color: '#000000' }, animIn: 'pop', animOut: 'pop', animDur: 0.4 },
    { name: 'Typewriter', text: 'Typing this out…', size: 72, font: 'Menlo', animIn: 'typewriter' },
    { name: 'End Card', text: 'Thanks for watching!\nSubscribe for more', size: 96, bold: true, animIn: 'zoom', dur: 6 },
  ];

  // ---- clip creation -----------------------------------------------------
  const insertVideo = (clip, time) => {
    const v = S.project.video;
    if (time == null) { v.push(clip); return; }
    const idx = VS.videoLayout().filter((l) => (l.start + l.end) / 2 < time).length;
    v.splice(idx, 0, clip);
  };
  const freeRow = (start, dur, list = S.project.audio) => {
    const busy = (row) => list.some((c) => (c.row || 0) === row && c.start < start + dur && start < c.start + VS.dur(c));
    return busy(0) && !busy(1) ? 1 : 0;
  };

  /** Add a library item to the timeline. `time` null = sensible default. `row` = audio row if dropped on one. */
  VS.addMedia = (m, time = null, row = null) => {
    if (m.missing) return null;
    let clip;
    if (m.kind === 'audio' || (row != null && m.hasAudio)) {
      const start = Math.max(0, time ?? S.time);
      clip = { id: VS.uid('a'), type: 'audio', mediaId: m.id, row: row ?? freeRow(start, m.duration), start, in: 0, out: m.duration, volume: 1, fadeIn: 0, fadeOut: 0 };
      S.project.audio.push(clip);
    } else {
      clip = { id: VS.uid('v'), type: 'video', mediaId: m.id, in: 0, out: m.kind === 'image' ? 5 : m.duration, volume: 1, muted: false, fadeIn: 0, fadeOut: 0 };
      insertVideo(clip, time);
    }
    return clip;
  };

  VS.addText = (presetIndex = 0, time = null, row = null) => {
    const p = VS.PRESETS[presetIndex] || VS.PRESETS[0];
    const clip = JSON.parse(JSON.stringify({ ...baseText, ...p, bg: { ...baseText.bg, ...p.bg }, outline: { ...baseText.outline, ...p.outline } }));
    delete clip.name;
    const start = Math.max(0, time ?? S.time);
    Object.assign(clip, { id: VS.uid('t'), type: 'text', start, row: row ?? freeRow(start, clip.dur, S.project.text) });
    VS.checkpoint();
    S.project.text.push(clip);
    VS.changed();
    VS.select(clip.id);
    return clip;
  };

  // ---- editing -----------------------------------------------------------
  VS.split = () => {
    const t = S.time;
    const inside = (c) => { const s = VS.startOf(c); return t > s + 0.05 && t < s + VS.dur(c) - 0.05; };
    let c = VS.selected();
    if (!c || !inside(c)) c = S.project.video.find(inside) || S.project.audio.find(inside) || S.project.text.find(inside);
    if (!c) return false;
    const off = t - VS.startOf(c);
    VS.checkpoint();
    const b = JSON.parse(JSON.stringify(c));
    b.id = VS.uid(c.type[0]);
    if (c.type === 'text') {
      b.start = t; b.dur = c.dur - off; c.dur = off;
      c.animOut = 'none'; b.animIn = 'none';
    } else {
      c.out = c.in + off; b.in = c.out;
      c.fadeOut = 0; b.fadeIn = 0;
      if (c.type === 'audio') b.start = t;
    }
    const list = VS.listOf(c);
    list.splice(list.indexOf(c) + 1, 0, b);
    VS.changed();
    VS.select(b.id);
    return true;
  };

  VS.deleteSelected = () => {
    const c = VS.selected();
    if (!c) return;
    VS.checkpoint();
    const list = VS.listOf(c);
    list.splice(list.indexOf(c), 1);
    S.sel = null;
    VS.changed();
    VS.emit('select');
  };

  VS.duplicateSelected = () => {
    const c = VS.selected();
    if (!c) return;
    VS.checkpoint();
    const b = JSON.parse(JSON.stringify(c));
    b.id = VS.uid(c.type[0]);
    if (c.type !== 'video') b.start = c.start + VS.dur(c);
    if (c.type === 'audio') b.row = c.row;
    const list = VS.listOf(c);
    list.splice(list.indexOf(c) + 1, 0, b);
    VS.changed();
    VS.select(b.id);
  };

  VS.removeMedia = (m) => {
    VS.checkpoint();
    for (const k of ['video', 'audio']) S.project[k] = S.project[k].filter((c) => c.mediaId !== m.id);
    m.hidden = true;
    if (!VS.selected()) { S.sel = null; VS.emit('select'); }
    VS.changed();
    VS.emit('media');
  };
})();
