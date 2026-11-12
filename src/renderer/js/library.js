// Left panel: imported media and text styles.
(function () {
  const VS = window.VS, S = VS.state;
  const bin = document.getElementById('bin'), hint = document.getElementById('bin-hint'), presets = document.getElementById('presets');
  const ICON = { audio: '♫', video: '▶', image: '🖼' };

  function renderBin() {
    bin.innerHTML = '';
    const items = S.project.media.filter((m) => !m.hidden);
    hint.hidden = items.length > 0;
    for (const m of items) {
      const el = document.createElement('div');
      el.className = `media${m.missing ? ' missing' : ''}`;
      el.draggable = !m.missing;
      el.title = m.missing ? `File not found:\n${m.path}` : `${m.path}\nDouble-click to add to the timeline`;
      const meta = m.missing ? 'File missing' : m.kind === 'image' ? 'Image' : VS.fmt(m.duration);
      el.innerHTML = `<div class="thumb">${m.thumb ? '' : ICON[m.kind] || '?'}</div><div class="name"></div><div class="meta">${meta}</div><button class="rm" title="Remove from project">✕</button>`;
      if (m.thumb) el.querySelector('.thumb').style.backgroundImage = `url('${m.thumb}')`;
      el.querySelector('.name').textContent = m.name;
      el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('application/x-vs-media', m.id); e.dataTransfer.effectAllowed = 'copy'; });
      el.addEventListener('dblclick', () => {
        VS.checkpoint();
        const c = VS.addMedia(m);
        VS.changed();
        if (c) VS.select(c.id);
      });
      el.querySelector('.rm').addEventListener('click', (e) => { e.stopPropagation(); VS.removeMedia(m); });
      bin.appendChild(el);
    }
  }
  VS.on('media', renderBin);

  VS.PRESETS.forEach((p, i) => {
    const el = document.createElement('div');
    el.className = 'preset';
    el.draggable = true;
    el.innerHTML = '<div class="sample"></div><div class="pname"></div>';
    const s = el.querySelector('.sample');
    s.textContent = p.text.split('\n')[0];
    s.style.cssText = `font-family:"${p.font || 'Helvetica Neue'}",sans-serif;font-weight:${p.bold ? 700 : 400};color:${p.color || '#fff'};` +
      (p.bg ? `background:${p.bg.color};padding:2px 10px;border-radius:4px;` : '') +
      (p.outline ? '-webkit-text-stroke:1px #000;' : '') + `font-size:${Math.max(13, Math.min(26, (p.size || 90) / 5))}px`;
    el.querySelector('.pname').textContent = p.name;
    el.addEventListener('click', () => VS.addText(i));
    el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('application/x-vs-text', String(i)); e.dataTransfer.effectAllowed = 'copy'; });
    presets.appendChild(el);
  });

  VS.showTab = (name) => {
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
    document.getElementById('tab-media').hidden = name !== 'media';
    document.getElementById('tab-text').hidden = name !== 'text';
  };
  document.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => VS.showTab(b.dataset.tab)));

  // ---- importing ---------------------------------------------------------
  /** Import files into the library. With opts.time set, also place them on the timeline. */
  VS.importFiles = async (paths, opts = null) => {
    const added = [];
    for (const p of paths) {
      let m = S.project.media.find((x) => x.path === p);
      if (!m) {
        try {
          m = { id: VS.uid('m'), ...(await window.api.probe(p)) };
          S.project.media.push(m);
          VS.loadWave(m);
        } catch {
          VS.toast(`“${p.split('/').pop()}” isn't a supported video, audio or image file.`);
          continue;
        }
      }
      m.hidden = false;
      added.push(m);
      VS.emit('media');
    }
    if (!added.length) return;
    VS.showTab('media');
    if (opts) {
      VS.checkpoint();
      let t = opts.time, last = null;
      for (const m of added) {
        last = VS.addMedia(m, t, m.kind === 'audio' ? opts.row : null) || last;
        if (t != null) t += m.kind === 'image' ? 5 : m.duration;
      }
      if (last) S.sel = last.id;
    }
    VS.changed();
    VS.emit('select');
  };

  VS.loadWave = (m) => {
    if (m.missing || !m.hasAudio) return;
    window.api.waveform(m.path).then((url) => { m.wave = url; VS.emit('change'); }).catch(() => {});
  };

  renderBin();
})();
