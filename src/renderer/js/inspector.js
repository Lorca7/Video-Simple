// Right panel: properties of the selected clip.
(function () {
  const VS = window.VS, S = VS.state;
  const root = document.getElementById('inspector');
  let refreshers = [];
  let builtFor = null;

  const h = (tag, cls, text) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  };
  const row = (label, ...kids) => {
    const r = h('div', 'row');
    if (label) r.appendChild(h('label', null, label));
    kids.forEach((k) => r.appendChild(k));
    root.appendChild(r);
    return r;
  };
  const heading = (t) => root.appendChild(h('h4', null, t));

  // One undo step per interaction (a slider drag is one step, not hundreds).
  const edit = (el, fn) => {
    if (!el._open) { VS.checkpoint(); el._open = true; }
    fn();
    VS.changed();
  };
  const closeOn = (el) => { el.addEventListener('change', () => (el._open = false)); el.addEventListener('blur', () => (el._open = false)); };

  function range(label, get, set, min, max, step, fmt) {
    const el = h('input'); el.type = 'range'; el.min = min; el.max = max; el.step = step;
    const val = h('span', 'val');
    el.addEventListener('input', () => { edit(el, () => set(+el.value)); val.textContent = fmt(get()); });
    closeOn(el);
    refreshers.push(() => { if (document.activeElement !== el) el.value = get(); val.textContent = fmt(get()); });
    return row(label, el, val);
  }
  function check(label, get, set) {
    const el = h('input'); el.type = 'checkbox';
    el.addEventListener('change', () => { VS.checkpoint(); set(el.checked); VS.changed(); });
    refreshers.push(() => (el.checked = get()));
    const l = h('label', null, ''); l.style.width = 'auto'; l.style.display = 'flex'; l.style.gap = '6px'; l.style.color = 'inherit';
    l.append(el, label);
    return row(null, l);
  }
  function select(label, options, get, set) {
    const el = h('select');
    for (const [v, t] of options) { const o = h('option', null, t); o.value = v; el.appendChild(o); }
    el.addEventListener('change', () => { VS.checkpoint(); set(el.value); VS.changed(); el.blur(); });
    refreshers.push(() => (el.value = get()));
    return row(label, el);
  }
  function color(get, set) {
    const el = h('input'); el.type = 'color';
    el.addEventListener('input', () => edit(el, () => set(el.value)));
    closeOn(el);
    refreshers.push(() => { if (document.activeElement !== el) el.value = get(); });
    return el;
  }
  function seg(options, get, set, multi) {
    const box = h('div', 'seg');
    for (const [v, t, title] of options) {
      const b = h('button', null, t);
      if (title) b.title = title;
      b.onclick = () => { VS.checkpoint(); set(v); VS.changed(); };
      refreshers.push(() => b.classList.toggle('on', multi ? get(v) : get() === v));
      box.appendChild(b);
    }
    return box;
  }
  const pct = (v) => `${Math.round(v * 100)}%`;
  const sec = (v) => `${v.toFixed(1)}s`;

  function build() {
    const c = VS.selected();
    builtFor = c ? c.id : null;
    refreshers = [];
    root.innerHTML = '';
    if (!c) {
      root.appendChild(h('h3', null, 'Nothing selected'));
      const p = h('p', 'hint');
      p.innerHTML = 'Click a clip in the timeline to adjust it.<br><br><b>Basics</b><br>• Drag a clip’s edges to trim<br>• Drag clips to move or reorder<br>• <b>S</b> splits at the playhead<br>• <b>Delete</b> removes the selected clip<br>• <b>Space</b> plays / pauses<br>• <b>T</b> adds text — drag it on the preview to place it';
      root.appendChild(p);
      return;
    }
    const m = c.mediaId && VS.media(c.mediaId);
    root.appendChild(h('h3', null, c.type === 'text' ? 'Text' : c.type === 'audio' ? 'Audio clip' : m && m.kind === 'image' ? 'Image clip' : 'Video clip'));
    const sub = h('div', 'sub');
    root.appendChild(sub);
    refreshers.push(() => (sub.textContent = `${m ? m.name + ' · ' : ''}${VS.dur(c).toFixed(2)}s`));

    if (c.type === 'text') buildText(c);
    else {
      const isImage = m && m.kind === 'image';
      if (!isImage && (c.type === 'audio' || (m && m.hasAudio))) {
        heading('Sound');
        range('Volume', () => c.volume, (v) => (c.volume = v), 0, 2, 0.01, pct);
        if (c.type === 'video') check('Mute this clip', () => c.muted, (v) => (c.muted = v));
      }
      heading(c.type === 'audio' ? 'Fades' : 'Fade from / to black');
      range('Fade in', () => c.fadeIn, (v) => (c.fadeIn = v), 0, 5, 0.1, sec);
      range('Fade out', () => c.fadeOut, (v) => (c.fadeOut = v), 0, 5, 0.1, sec);
      if (!isImage) root.appendChild(h('p', 'hint', 'Volume above 100% is applied when you export.'));
    }
    refresh();
  }

  function buildText(c) {
    const ta = h('textarea');
    ta.spellcheck = false;
    ta.addEventListener('input', () => edit(ta, () => (c.text = ta.value)));
    closeOn(ta);
    refreshers.push(() => { if (document.activeElement !== ta) ta.value = c.text; });
    const r = row(null, ta); r.classList.add('col');

    heading('Style');
    select('Font', VS.FONTS.map((f) => [f, f]), () => c.font, (v) => (c.font = v));
    range('Size', () => c.size, (v) => (c.size = v), 20, 400, 2, (v) => String(v));
    row('Color', color(() => c.color, (v) => (c.color = v)),
      seg([['bold', 'B', 'Bold'], ['italic', 'I', 'Italic']], (k) => c[k], (k) => (c[k] = !c[k]), true));
    row('Align', seg([['left', 'Left'], ['center', 'Center'], ['right', 'Right']], () => c.align, (v) => (c.align = v)));
    row('Background', color(() => c.bg.color, (v) => { c.bg.color = v; c.bg.on = true; }),
      seg([[true, 'On'], [false, 'Off']], () => c.bg.on, (v) => (c.bg.on = v)));
    row('Outline', color(() => c.outline.color, (v) => { c.outline.color = v; c.outline.on = true; }),
      seg([[true, 'On'], [false, 'Off']], () => c.outline.on, (v) => (c.outline.on = v)));
    check('Drop shadow', () => c.shadow, (v) => (c.shadow = v));

    heading('Position');
    const grid = h('div', 'grid3');
    [['Top', 0.5, 0.14], ['Middle', 0.5, 0.5], ['Bottom', 0.5, 0.86]].forEach(([t, x, y]) => {
      const b = h('button', null, t);
      b.onclick = () => { VS.checkpoint(); c.x = x; c.y = y; VS.changed(); };
      grid.appendChild(b);
    });
    row(null, grid);
    root.appendChild(h('p', 'hint', 'Or drag the text right on the preview.'));

    heading('Motion');
    select('Animate in', VS.ANIM_IN, () => c.animIn, (v) => (c.animIn = v));
    select('Animate out', VS.ANIM_OUT, () => c.animOut, (v) => (c.animOut = v));
    range('Speed', () => c.animDur, (v) => (c.animDur = v), 0.2, 2, 0.1, sec);
    const play = h('button', null, '▶ Preview animation');
    play.onclick = () => { VS.pause(); VS.seek(c.start); VS.play(); };
    row(null, play);

    heading('Timing');
    range('Duration', () => c.dur, (v) => (c.dur = v), 0.5, 30, 0.1, sec);
  }

  function refresh() { refreshers.forEach((fn) => fn()); }

  VS.on('select', build);
  VS.on('change', () => {
    const c = VS.selected();
    if ((c ? c.id : null) !== builtFor) build(); else refresh();
  });
  build();
})();
