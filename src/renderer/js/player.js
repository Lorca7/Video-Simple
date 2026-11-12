// Live preview: keeps <video>/<audio> elements in sync with the playhead and
// draws text on a canvas above them.
(function () {
  const VS = window.VS, S = VS.state, clamp = VS.clamp;
  const wrap = document.getElementById('stage-wrap');
  const stage = document.getElementById('stage');
  const canvas = document.getElementById('overlay');
  const empty = document.getElementById('empty');
  const ctx = canvas.getContext('2d');
  const layers = new Map(); // media id -> <video> | <img>
  const sounds = new Map(); // audio clip id -> <audio>
  let boxes = [];           // [{clip, box}] of text currently on screen (canvas pixels)
  let guides = null;

  // ---- stage sizing (always 16:9) ----------------------------------------
  function resize() {
    const w = wrap.clientWidth - 24, h = wrap.clientHeight - 24;
    const sw = Math.max(160, Math.min(w, (h * 16) / 9));
    stage.style.width = `${sw}px`;
    stage.style.height = `${(sw * 9) / 16}px`;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(sw * dpr);
    canvas.height = Math.round(((sw * 9) / 16) * dpr);
    sync();
  }
  new ResizeObserver(resize).observe(wrap);

  // ---- media elements ----------------------------------------------------
  const proxying = new Set();
  async function needProxy(m, el) {
    if (m.proxyUrl || proxying.has(m.id) || m.missing) return;
    proxying.add(m.id);
    VS.toast(`Preparing a preview of “${m.name}”…`, 0);
    try {
      m.proxyUrl = await window.api.proxy(m.path);
      for (const e of [layers.get(m.id), ...sounds.values()]) if (e && e._media === m.id && e.tagName !== 'IMG') e.src = m.proxyUrl;
      VS.toast(null);
    } catch {
      VS.toast(`“${m.name}” can't be previewed, but it will still export.`);
    }
    proxying.delete(m.id);
    if (el) sync();
  }
  function watch(el, m) {
    el._media = m.id;
    el.preload = 'auto';
    el.addEventListener('error', () => needProxy(m, el));
    el.addEventListener('loadedmetadata', () => {
      if (el.tagName === 'VIDEO' && m.kind === 'video' && !el.videoWidth) needProxy(m, el);
      sync();
    });
    el.addEventListener('seeked', () => !S.playing && sync());
    el.src = m.proxyUrl || m.url;
  }
  function layerFor(m) {
    let el = layers.get(m.id);
    if (el) return el;
    if (m.kind === 'image') { el = new Image(); el.src = m.url; } else { el = document.createElement('video'); el.playsInline = true; watch(el, m); }
    el.className = 'layer';
    stage.insertBefore(el, canvas);
    layers.set(m.id, el);
    return el;
  }
  function soundFor(c, m) {
    let el = sounds.get(c.id);
    if (!el) { el = document.createElement('audio'); watch(el, m); sounds.set(c.id, el); }
    return el;
  }

  const fadeGain = (c, local) => {
    const d = VS.dur(c);
    let g = 1;
    if (c.fadeIn > 0) g = Math.min(g, local / c.fadeIn);
    if (c.fadeOut > 0) g = Math.min(g, (d - local) / c.fadeOut);
    return clamp(g, 0, 1);
  };

  function drive(el, target, vol) {
    el.volume = clamp(vol, 0, 1); // boosts above 100% are applied on export
    el.muted = vol <= 0;
    if (el.readyState < 1) return;
    if (S.playing) {
      if (el.paused) { el.currentTime = target; el.play().catch(() => {}); }
      else if (Math.abs(el.currentTime - target) > 0.3) el.currentTime = target;
    } else {
      if (!el.paused) el.pause();
      if (!el.seeking && Math.abs(el.currentTime - target) > 0.02) el.currentTime = target;
    }
  }

  // ---- sync everything to S.time -----------------------------------------
  function sync() {
    const t = S.time, P = S.project;
    const lay = VS.videoLayout();
    const end = lay.length ? lay[lay.length - 1].end : 0;
    let act = lay.find((l) => t >= l.start && t < l.end);
    if (!act && lay.length && !S.playing && Math.abs(t - end) < 1e-6 && t >= VS.total()) act = lay[lay.length - 1]; // parked at the very end
    const actMedia = act && VS.media(act.clip.mediaId);

    for (const [id, el] of layers) {
      if (!actMedia || id !== actMedia.id) {
        el.style.visibility = 'hidden';
        if (el.tagName === 'VIDEO' && !el.paused) el.pause();
      }
    }
    if (actMedia && !actMedia.missing) {
      const c = act.clip, local = Math.min(t - act.start, VS.dur(c) - 0.001);
      const el = layerFor(actMedia);
      const g = fadeGain(c, local);
      el.style.visibility = 'visible';
      el.style.opacity = g;
      if (el.tagName === 'VIDEO') drive(el, c.in + local, c.muted ? 0 : c.volume * g);
    }

    const live = new Set();
    for (const c of P.audio) {
      const m = VS.media(c.mediaId);
      if (!m || m.missing) continue;
      const local = t - c.start;
      if (local >= 0 && local < VS.dur(c)) {
        live.add(c.id);
        drive(soundFor(c, m), c.in + local, c.volume * fadeGain(c, local));
      }
    }
    for (const [id, el] of sounds) {
      if (live.has(id)) continue;
      if (!el.paused) el.pause();
      if (!VS.find(id)) { el.removeAttribute('src'); el.load(); sounds.delete(id); }
    }

    // text
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    boxes = [];
    for (const c of P.text) {
      const local = t - c.start;
      if (local < 0 || local >= c.dur) continue;
      boxes.push({ clip: c, box: VS.drawText(ctx, c, local, W, H) });
    }
    const sel = boxes.find((b) => b.clip.id === S.sel);
    if (sel && !S.playing) {
      const b = sel.box, dpr = window.devicePixelRatio || 1;
      ctx.save();
      ctx.strokeStyle = '#4c8dff'; ctx.lineWidth = 1.5 * dpr; ctx.setLineDash([6 * dpr, 4 * dpr]);
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      if (guides) {
        ctx.setLineDash([]); ctx.strokeStyle = '#ffd60a'; ctx.lineWidth = dpr;
        ctx.beginPath();
        if (guides.x) { ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); }
        if (guides.y) { ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); }
        ctx.stroke();
      }
      ctx.restore();
    }
    empty.hidden = VS.allClips().length > 0;
  }
  VS.sync = sync;

  // ---- transport ---------------------------------------------------------
  let last = 0;
  function tick(now) {
    if (!S.playing) return;
    const total = VS.total();
    S.time += (now - last) / 1000;
    last = now;
    if (S.time >= total) { S.time = total; VS.pause(); return; }
    VS.emit('time');
    requestAnimationFrame(tick);
  }
  VS.play = () => {
    const total = VS.total();
    if (S.playing || total <= 0) return;
    if (S.time >= total - 0.02) S.time = 0;
    S.playing = true;
    last = performance.now();
    VS.emit('playstate');
    VS.emit('time');
    requestAnimationFrame(tick);
  };
  VS.pause = () => {
    if (!S.playing) return;
    S.playing = false;
    VS.emit('playstate');
    VS.emit('time');
  };
  VS.toggle = () => (S.playing ? VS.pause() : VS.play());

  VS.on('time', sync);
  VS.on('change', sync);
  VS.on('select', sync);

  // ---- drag text directly on the preview ---------------------------------
  const hit = (e) => {
    const r = canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * canvas.width, y = ((e.clientY - r.top) / r.height) * canvas.height;
    for (let i = boxes.length - 1; i >= 0; i--) {
      const b = boxes[i].box;
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return boxes[i].clip;
    }
    return null;
  };
  canvas.addEventListener('pointermove', (e) => { if (!e.buttons) canvas.style.cursor = hit(e) ? 'move' : 'default'; });
  canvas.addEventListener('pointerdown', (e) => {
    const c = hit(e);
    if (!c) return;
    VS.pause();
    VS.select(c.id);
    const r = canvas.getBoundingClientRect();
    const x0 = e.clientX, y0 = e.clientY, ox = c.x, oy = c.y;
    let moved = false;
    const move = (ev) => {
      if (!moved) { if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 3) return; moved = true; VS.checkpoint(); }
      let x = ox + (ev.clientX - x0) / r.width, y = oy + (ev.clientY - y0) / r.height;
      guides = { x: Math.abs(x - 0.5) < 0.015, y: Math.abs(y - 0.5) < 0.02 };
      if (guides.x) x = 0.5;
      if (guides.y) y = 0.5;
      c.x = clamp(x, 0, 1); c.y = clamp(y, 0, 1);
      VS.changed();
    };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      guides = null;
      sync();
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  });
  canvas.addEventListener('dblclick', (e) => {
    if (!hit(e)) return;
    const ta = document.querySelector('#inspector textarea');
    if (ta) { ta.focus(); ta.select(); }
  });

  VS.resetPlayer = () => {
    for (const el of [...layers.values(), ...sounds.values()]) { if (el.pause) { el.pause(); el.removeAttribute('src'); el.load?.(); } el.remove(); }
    layers.clear(); sounds.clear();
  };
})();
