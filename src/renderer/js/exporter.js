// Export dialog: renders text frames, then hands everything to ffmpeg.
(function () {
  const VS = window.VS, S = VS.state;
  const $ = (id) => document.getElementById(id);
  const dlg = $('export-dlg');
  const panes = { form: $('export-form'), progress: $('export-progress'), done: $('export-done') };
  const show = (name) => Object.entries(panes).forEach(([k, el]) => (el.hidden = k !== name));
  let running = false, canceled = false, lastPath = null;

  VS.openExport = () => {
    if (running) { dlg.showModal(); return; }
    if (VS.total() <= 0) { VS.toast('Add something to the timeline before exporting.'); return; }
    const missing = VS.allClips().map((c) => c.mediaId && VS.media(c.mediaId)).find((m) => m && m.missing);
    if (missing) { VS.toast(`“${missing.name}” is missing. Remove it or restore the file before exporting.`); return; }
    VS.pause();
    show('form');
    dlg.showModal();
  };

  /** Render every text clip to transparent PNG frames at output size. */
  async function renderText(dir, W, H, fps, onProgress) {
    const canvas = new OffscreenCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const clips = S.project.text.filter((c) => c.text.trim());
    const overlays = [];
    for (let k = 0; k < clips.length; k++) {
      const c = clips[k];
      const frames = Math.max(1, Math.round(c.dur * fps));
      const [sa, sb] = VS.textStaticRange(c);
      let f = 0;
      while (f < frames) {
        if (canceled) return null;
        const local = f / fps;
        // Frames where nothing animates are identical: render once, reuse.
        const to = local >= sa && local <= sb ? Math.max(f, Math.min(frames - 1, Math.floor(sb * fps))) : f;
        ctx.clearRect(0, 0, W, H);
        VS.drawText(ctx, c, local, W, H);
        const blob = await canvas.convertToBlob({ type: 'image/png' });
        await window.api.exportFrames(dir, k, f, to, await blob.arrayBuffer());
        f = to + 1;
        onProgress((k + f / frames) / clips.length);
      }
      overlays.push({ index: k, start: Math.round(c.start * fps) / fps, frames });
    }
    return overlays;
  }

  VS.buildSpec = () => ({
    videoClips: S.project.video.map((c) => {
      const m = VS.media(c.mediaId);
      return { path: m.path, kind: m.kind, hasAudio: m.hasAudio, in: c.in, dur: VS.dur(c), volume: c.volume, muted: c.muted, fadeIn: c.fadeIn, fadeOut: c.fadeOut };
    }),
    audioClips: S.project.audio.filter((c) => c.volume > 0).map((c) => {
      const m = VS.media(c.mediaId);
      return { path: m.path, start: c.start, in: c.in, dur: VS.dur(c), volume: c.volume, fadeIn: c.fadeIn, fadeOut: c.fadeOut };
    }),
    overlays: [],
  });

  async function run() {
    const H = +$('ex-res').value, W = (H * 16) / 9, fps = +$('ex-fps').value;
    const name = S.path ? S.path.split('/').pop().replace(/\.vsproj$/, '') : 'My Video';
    const outPath = await window.api.exportChoosePath(name);
    if (!outPath) return;
    running = true; canceled = false;
    show('progress');
    const status = $('ex-status'), bar = $('ex-bar');
    bar.value = 0;
    let dir = null, result;
    try {
      dir = await window.api.exportBegin();
      status.textContent = 'Rendering text…';
      const spec = VS.buildSpec();
      const overlays = await renderText(dir, W, H, fps, (p) => (bar.value = p * 0.1));
      if (overlays) {
        spec.overlays = overlays;
        status.textContent = 'Encoding video… 0%';
        result = await window.api.exportRun(dir, spec, { width: W, height: H, fps, outPath });
      } else result = { ok: false, canceled: true };
    } catch (err) {
      result = { ok: false, error: String(err && err.message || err) };
    }
    window.api.exportCleanup(dir);
    running = false;
    if (result.canceled) { dlg.close(); VS.toast('Export canceled.'); return; }
    show('done');
    lastPath = result.ok ? result.path : null;
    $('ex-reveal').hidden = !result.ok;
    $('ex-result').textContent = result.ok
      ? `Your video is ready to upload to YouTube:\n${result.path}`
      : `Export failed.\n\n${result.error}`;
  }

  window.api.onExportProgress((p) => {
    $('ex-bar').value = 0.1 + p * 0.9;
    $('ex-status').textContent = `Encoding video… ${Math.round(p * 100)}%`;
  });
  $('ex-go').onclick = run;
  $('ex-cancel').onclick = () => dlg.close();
  $('ex-close').onclick = () => dlg.close();
  $('ex-reveal').onclick = () => { if (lastPath) window.api.reveal(lastPath); dlg.close(); };
  $('ex-stop').onclick = () => { canceled = true; window.api.exportCancel(); };
  dlg.addEventListener('cancel', (e) => { if (running) e.preventDefault(); }); // Esc must not hide a running export
})();
