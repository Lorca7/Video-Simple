// Timeline: ruler, tracks, clips; drag to move, reorder and trim.
(function () {
  const VS = window.VS, S = VS.state, clamp = VS.clamp;
  const $ = (id) => document.getElementById(id);
  const scroll = $('tl-scroll'), inner = $('tl-inner'), ruler = $('ruler'), tracksEl = $('tracks'), playhead = $('playhead'), heads = $('tl-heads');
  const TRACKS = [
    { key: 'text', row: 1, label: 'Text 2' },
    { key: 'text', row: 0, label: 'Text 1' },
    { key: 'video', label: 'Video' },
    { key: 'audio', row: 0, label: 'Audio 1' },
    { key: 'audio', row: 1, label: 'Audio 2' },
  ];
  const ZMIN = 2, ZMAX = 400;

  const trackEls = TRACKS.map((t) => {
    const h = document.createElement('div');
    h.className = `h-${t.key}`; h.textContent = t.label;
    heads.appendChild(h);
    const el = document.createElement('div');
    el.className = `track ${t.key}`;
    el.dataset.key = t.key;
    if (t.row != null) el.dataset.row = t.row;
    tracksEl.appendChild(el);
    return el;
  });

  const timeAt = (e) => Math.max(0, (e.clientX - inner.getBoundingClientRect().left) / S.zoom);

  // ---- rendering ---------------------------------------------------------
  function drawRuler() {
    const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800];
    const step = steps.find((s) => s * S.zoom >= 64) || 3600;
    const from = Math.floor(scroll.scrollLeft / S.zoom / step) * step;
    const to = (scroll.scrollLeft + scroll.clientWidth) / S.zoom;
    let html = '';
    for (let t = from; t <= to; t += step) {
      const m = Math.floor(t / 60), s = t - m * 60;
      const lbl = step < 1 ? `${m}:${s.toFixed(2).padStart(5, '0')}` : `${m}:${String(Math.round(s)).padStart(2, '0')}`;
      html += `<span style="left:${t * S.zoom}px">${lbl}</span>`;
    }
    ruler.innerHTML = html;
  }

  function clipEl(c, start) {
    const m = c.mediaId && VS.media(c.mediaId);
    const d = VS.dur(c), w = d * S.zoom;
    const el = document.createElement('div');
    el.className = `clip ${c.type}${c.id === S.sel ? ' sel' : ''}${m && m.missing ? ' missing' : ''}`;
    el.dataset.id = c.id;
    el.style.left = `${start * S.zoom}px`;
    el.style.width = `${Math.max(4, w - 1)}px`;
    let html = '';
    if (c.type === 'video' && m && m.thumb) html += `<div class="thumbs" style="background-image:url('${m.thumb}')"></div>`;
    if (m && m.wave && c.type === 'audio') {
      html += `<div class="wave" style="background-image:url('${m.wave}');background-size:${m.duration * S.zoom}px 100%;background-position:${-c.in * S.zoom}px 0"></div>`;
    }
    if (c.fadeIn > 0) html += `<div class="fade in" style="width:${Math.min(c.fadeIn, d) * S.zoom}px"></div>`;
    if (c.fadeOut > 0) html += `<div class="fade out" style="width:${Math.min(c.fadeOut, d) * S.zoom}px"></div>`;
    html += '<div class="lbl"></div><div class="hl"></div><div class="hr"></div>';
    if (c.type === 'video' && c.muted) html += '<div class="mute">🔇</div>';
    el.innerHTML = html;
    el.querySelector('.lbl').textContent = c.type === 'text' ? c.text.replace(/\n/g, ' ') : m ? m.name : 'Missing';
    return el;
  }

  function render() {
    const total = VS.total();
    inner.style.width = `${Math.max(total + 15, 30) * S.zoom}px`;
    trackEls.forEach((el) => (el.innerHTML = ''));
    const rowEl = (key, row) => trackEls[TRACKS.findIndex((t) => t.key === key && (t.row ?? 0) === (row ? 1 : 0))];
    for (const l of VS.videoLayout()) rowEl('video').appendChild(clipEl(l.clip, l.start));
    for (const c of S.project.text) rowEl('text', c.row).appendChild(clipEl(c, c.start));
    for (const c of S.project.audio) rowEl('audio', c.row).appendChild(clipEl(c, c.start));
    drawRuler();
    movePlayhead();
  }

  function movePlayhead() {
    const x = S.time * S.zoom;
    playhead.style.transform = `translateX(${x}px)`;
    if (S.playing) {
      if (x > scroll.scrollLeft + scroll.clientWidth - 40) scroll.scrollLeft = x - 80;
      else if (x < scroll.scrollLeft) scroll.scrollLeft = Math.max(0, x - 80);
    }
  }

  VS.on('change', render);
  VS.on('select', render);
  VS.on('time', movePlayhead);
  scroll.addEventListener('scroll', drawRuler);
  new ResizeObserver(drawRuler).observe(scroll);

  // ---- zoom --------------------------------------------------------------
  const zoomIn = $('zoom');
  const z2s = (z) => (Math.log(z / ZMIN) / Math.log(ZMAX / ZMIN)) * 100;
  VS.setZoom = (z, anchorTime = S.time) => {
    const before = anchorTime * S.zoom - scroll.scrollLeft;
    S.zoom = clamp(z, ZMIN, ZMAX);
    zoomIn.value = z2s(S.zoom);
    render();
    scroll.scrollLeft = anchorTime * S.zoom - before;
    drawRuler();
  };
  zoomIn.addEventListener('input', () => VS.setZoom(ZMIN * Math.pow(ZMAX / ZMIN, zoomIn.value / 100)));
  VS.fit = () => {
    const total = VS.total();
    if (total > 0) { VS.setZoom((scroll.clientWidth - 60) / total); scroll.scrollLeft = 0; }
  };
  $('btn-fit').onclick = VS.fit;
  scroll.addEventListener('wheel', (e) => {
    if (e.metaKey || e.ctrlKey) { e.preventDefault(); VS.setZoom(S.zoom * Math.exp(-e.deltaY * 0.01), timeAt(e)); }
    else if (!e.deltaX && e.deltaY) { scroll.scrollLeft += e.deltaY; }
  }, { passive: false });
  $('chk-snap').onchange = (e) => (S.snap = e.target.checked);

  // ---- snapping ----------------------------------------------------------
  function snapPoints(skip) {
    const pts = [0, S.time];
    for (const l of VS.videoLayout()) pts.push(l.end);
    for (const c of [...S.project.text, ...S.project.audio]) if (c !== skip) pts.push(c.start, c.start + VS.dur(c));
    return pts;
  }
  /** Returns the offset to add so one of `edges` lands on a snap point (0 if none close). */
  function snapDelta(edges, pts, e) {
    if (!S.snap || e.altKey) return 0;
    let best = 0, bestD = 8 / S.zoom;
    for (const edge of edges) for (const p of pts) {
      const d = Math.abs(p - edge);
      if (d < bestD) { bestD = d; best = p - edge; }
    }
    return best;
  }

  // ---- pointer interaction -----------------------------------------------
  function drag(onMove, onUp) {
    const up = (e) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', up);
      if (onUp) onUp(e);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', up);
  }

  inner.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const el = e.target.closest('.clip');
    if (!el) {
      // click / drag on empty space or ruler = move the playhead
      VS.pause();
      if (!e.target.closest('#ruler')) VS.select(null);
      VS.seek(timeAt(e));
      drag((ev) => VS.seek(timeAt(ev)));
      return;
    }
    const c = VS.find(el.dataset.id);
    if (!c) return;
    VS.pause();
    VS.select(c.id);
    const mode = e.target.classList.contains('hl') ? 'l' : e.target.classList.contains('hr') ? 'r' : 'move';
    const o = { ...c }, x0 = e.clientX, m = c.mediaId && VS.media(c.mediaId);
    const maxOut = c.type === 'text' || (m && m.kind === 'image') ? Infinity : m ? m.duration : c.out;
    const pts = snapPoints(c);
    let started = false;

    drag((ev) => {
      if (!started) {
        if (Math.abs(ev.clientX - x0) < 4) return;
        started = true;
        VS.checkpoint();
      }
      let d = (ev.clientX - x0) / S.zoom;
      const od = VS.dur(o);

      if (c.type === 'video') {
        if (mode === 'move') {
          const list = S.project.video, tp = timeAt(ev);
          let t = 0, idx = 0;
          for (const other of list) {
            if (other === c) continue;
            const dd = VS.dur(other);
            if (t + dd / 2 < tp) idx++;
            t += dd;
          }
          const cur = list.indexOf(c);
          if (idx !== cur) { list.splice(cur, 1); list.splice(idx, 0, c); }
        } else if (m && m.kind === 'image') {
          c.out = Math.max(0.2, mode === 'l' ? o.out - d : o.out + d);
        } else if (mode === 'l') {
          c.in = clamp(o.in + d, 0, o.out - 0.1);
        } else {
          c.out = clamp(o.out + d, o.in + 0.1, maxOut);
        }
      } else if (mode === 'move') {
        d += snapDelta([o.start + d, o.start + d + od], pts, ev);
        c.start = Math.max(0, o.start + d);
        const tr = document.elementFromPoint(ev.clientX, ev.clientY)?.closest(`.track.${c.type}`);
        if (tr) c.row = +tr.dataset.row;
      } else if (mode === 'l') {
        d += snapDelta([o.start + d], pts, ev);
        d = clamp(d, Math.max(-o.start, c.type === 'audio' ? -o.in : -Infinity), od - 0.1);
        c.start = o.start + d;
        if (c.type === 'text') c.dur = o.dur - d; else c.in = o.in + d;
      } else {
        d += snapDelta([o.start + od + d], pts, ev);
        if (c.type === 'text') c.dur = Math.max(0.2, o.dur + d);
        else c.out = clamp(o.out + d, o.in + 0.1, maxOut);
      }
      VS.changed();
    });
  });

  // ---- drop targets ------------------------------------------------------
  const accepts = (e) => ['application/x-vs-media', 'application/x-vs-text', 'Files'].some((t) => e.dataTransfer.types.includes(t));
  scroll.addEventListener('dragover', (e) => {
    if (!accepts(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    trackEls.forEach((t) => t.classList.remove('over'));
    e.target.closest?.('.track')?.classList.add('over');
  });
  scroll.addEventListener('dragleave', () => trackEls.forEach((t) => t.classList.remove('over')));
  scroll.addEventListener('drop', (e) => {
    trackEls.forEach((t) => t.classList.remove('over'));
    if (!accepts(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const time = timeAt(e);
    const rowOf = (key) => { const tr = e.target.closest?.(`.track.${key}`); return tr ? +tr.dataset.row : null; };
    const row = rowOf('audio');
    const mid = e.dataTransfer.getData('application/x-vs-media');
    const preset = e.dataTransfer.getData('application/x-vs-text');
    if (mid) {
      const m = VS.media(mid);
      if (!m) return;
      VS.checkpoint();
      const c = VS.addMedia(m, time, row);
      VS.changed();
      if (c) VS.select(c.id);
    } else if (preset !== '') {
      VS.addText(+preset, time, rowOf('text'));
    } else if (e.dataTransfer.files.length) {
      VS.importFiles([...e.dataTransfer.files].map((f) => window.api.pathFor(f)), { time, row });
    }
    VS.hideVeil?.();
  });

  render();
})();
