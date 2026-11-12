// Draws a text clip onto a canvas. The same function is used for the live
// preview and for the frames rendered at export, so what you see is what you get.
(function () {
  const VS = window.VS;
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const easeOut = (p) => 1 - Math.pow(1 - p, 3);
  const easeBack = (p) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); };
  const charCount = (c) => Array.from(c.text.replace(/\n/g, '')).length;

  const animLen = (c) => Math.max(0.05, Math.min(c.animDur, c.dur / 2));
  const typeLen = (c) => Math.min(c.dur * 0.7, Math.max(animLen(c), charCount(c) * 0.06));

  /** [from, to] local-time range in which the clip is not animating (every frame identical). */
  VS.textStaticRange = (c) => {
    const a = c.animIn === 'none' ? 0 : c.animIn === 'typewriter' ? typeLen(c) : animLen(c);
    const b = c.dur - (c.animOut === 'none' ? 0 : animLen(c));
    return [a, b];
  };

  /**
   * Draw clip `c` at `local` seconds into the clip on a W×H canvas.
   * Returns the text's resting bounding box (ignores animation) for hit testing.
   */
  VS.drawText = (ctx, c, local, W, H) => {
    const s = H / 1080;
    const size = c.size * s;
    ctx.save();
    ctx.font = `${c.italic ? 'italic ' : ''}${c.bold ? 700 : 400} ${size}px "${c.font}", "Helvetica Neue", Arial, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const lines = (c.text || ' ').split('\n');
    const lh = size * 1.2;
    const widths = lines.map((l) => ctx.measureText(l).width);
    const bw = Math.max(1, ...widths), bh = lh * lines.length;
    const cx = c.x * W, cy = c.y * H;
    const padX = size * 0.4, padY = size * 0.18;
    const box = { x: cx - bw / 2 - padX, y: cy - bh / 2 - padY, w: bw + padX * 2, h: bh + padY * 2 };

    // --- animation state ---
    let alpha = 1, dx = 0, dy = 0, scale = 1, chars = Infinity;
    const d = animLen(c), dist = 140 * s;
    const apply = (kind, p, out) => {
      const off = 1 - easeOut(p), dir = out ? -1 : 1;
      switch (kind) {
        case 'fade': alpha *= p; break;
        case 'slide-up': dy += dir * off * dist; alpha *= clamp01(p * 2); break;
        case 'slide-down': dy -= dir * off * dist; alpha *= clamp01(p * 2); break;
        case 'slide-left': dx += dir * off * dist * 2; alpha *= clamp01(p * 2); break;
        case 'slide-right': dx -= dir * off * dist * 2; alpha *= clamp01(p * 2); break;
        case 'pop': scale *= out ? 0.4 + 0.6 * easeOut(p) : 0.4 + 0.6 * easeBack(p); alpha *= clamp01(p * 3); break;
        case 'zoom': scale *= 1 + off * 0.8; alpha *= p; break;
      }
    };
    if (c.animIn === 'typewriter') chars = Math.floor(charCount(c) * clamp01(local / typeLen(c)) + 1e-6);
    else if (c.animIn !== 'none' && local < d) apply(c.animIn, clamp01(local / d), false);
    if (c.animOut !== 'none' && c.dur - local < d) apply(c.animOut, clamp01((c.dur - local) / d), true);

    ctx.translate(cx + dx, cy + dy);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cy);

    if (c.bg.on) {
      ctx.globalAlpha = alpha * c.bg.opacity;
      ctx.fillStyle = c.bg.color;
      ctx.beginPath();
      ctx.roundRect(box.x, box.y, box.w, box.h, size * 0.16);
      ctx.fill();
    }
    ctx.globalAlpha = alpha;
    ctx.fillStyle = c.color;
    ctx.lineJoin = 'round';
    ctx.lineWidth = size * 0.1;
    ctx.strokeStyle = c.outline.color;
    const shadowOn = () => {
      if (!c.shadow) return;
      ctx.shadowColor = 'rgba(0,0,0,0.65)'; ctx.shadowBlur = size * 0.14; ctx.shadowOffsetY = size * 0.04;
    };
    const shadowOff = () => { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; };

    let remaining = chars;
    lines.forEach((line, i) => {
      if (remaining <= 0) return;
      let str = line;
      const arr = Array.from(line);
      if (remaining < arr.length) str = arr.slice(0, remaining).join('');
      remaining -= arr.length;
      const x = c.align === 'left' ? cx - bw / 2 : c.align === 'right' ? cx + bw / 2 - widths[i] : cx - widths[i] / 2;
      const y = cy - bh / 2 + lh * (i + 0.5);
      if (c.outline.on) {
        shadowOn(); ctx.strokeText(str, x, y);
        shadowOff(); ctx.fillText(str, x, y);
      } else {
        shadowOn(); ctx.fillText(str, x, y); shadowOff();
      }
    });
    ctx.restore();
    return box;
  };
})();
