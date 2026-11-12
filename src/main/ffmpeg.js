// ffmpeg helpers: probing media, thumbnails, waveforms, preview proxies and
// building the YouTube export command. No Electron imports, so it can be
// tested with plain node.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.bmp', '.webp']);

function ffmpegPath() {
  if (process.env.VS_FFMPEG) return process.env.VS_FFMPEG;
  try {
    let p = require('ffmpeg-static');
    if (p) {
      // Binaries cannot run from inside the asar archive.
      p = p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
      if (fs.existsSync(p)) return p;
    }
  } catch { /* fall through to PATH */ }
  return 'ffmpeg';
}

function run(args, { onStdout, onSpawn } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
    if (onSpawn) onSpawn(proc);
    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr += d;
      if (stderr.length > 200000) stderr = stderr.slice(-100000);
    });
    proc.stdout.on('data', (d) => onStdout && onStdout(String(d)));
    proc.on('error', reject);
    proc.on('close', (code) => resolve({ code, stderr }));
  });
}

function parseProbe(stderr, file) {
  const ext = path.extname(file).toLowerCase();
  const d = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  const duration = d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : 0;
  const lines = stderr.split('\n');
  const vLine = lines.find((l) => /Stream #.*Video:/.test(l) && !/attached pic/.test(l));
  const hasAudio = lines.some((l) => /Stream #.*Audio:/.test(l));
  let width = 0, height = 0, fps = 0;
  if (vLine) {
    const m = /, (\d{2,5})x(\d{2,5})/.exec(vLine);
    if (m) { width = +m[1]; height = +m[2]; }
    const f = /([\d.]+) fps/.exec(vLine);
    if (f) fps = +f[1];
    if (/rotation of -?(90|270)/.test(stderr)) [width, height] = [height, width];
  }
  let kind;
  if (vLine && IMAGE_EXT.has(ext)) kind = 'image';
  else if (vLine && duration > 0) kind = 'video';
  else if (hasAudio && duration > 0) kind = 'audio';
  else throw new Error('Unsupported file');
  return { kind, duration: kind === 'image' ? 0 : duration, width, height, fps, hasAudio: kind !== 'image' && hasAudio };
}

async function probe(file) {
  const { stderr } = await run(['-hide_banner', '-i', file]);
  return parseProbe(stderr, file);
}

async function thumbnail(file, info, out) {
  const args = ['-hide_banner', '-y'];
  if (info.kind === 'video') args.push('-ss', String(Math.min(1, info.duration / 2)));
  args.push('-i', file, '-frames:v', '1', '-vf', 'scale=-2:120', '-q:v', '4', out);
  const r = await run(args);
  if (r.code !== 0) throw new Error('thumbnail failed');
}

async function waveform(file, out) {
  const r = await run(['-hide_banner', '-y', '-i', file, '-filter_complex',
    'aformat=channel_layouts=mono,showwavespic=s=2400x96:colors=white:scale=sqrt', '-frames:v', '1', out]);
  if (r.code !== 0) throw new Error('waveform failed');
}

// Small H.264 copy for previewing formats the built-in player cannot decode.
async function proxy(file, out) {
  const tmp = out + '.part.mp4';
  const r = await run(['-hide_banner', '-y', '-i', file, '-map', '0:v:0?', '-map', '0:a:0?',
    '-vf', 'scale=-2:540', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-movflags', '+faststart', tmp]);
  if (r.code !== 0) { fs.rmSync(tmp, { force: true }); throw new Error('proxy failed'); }
  fs.renameSync(tmp, out);
}

// YouTube recommended SDR upload bitrates (Mbps) by height: [<=30fps, >30fps]
const BITRATES = { 720: [5, 7.5], 1080: [8, 12], 1440: [16, 24], 2160: [40, 60] };

const n = (x) => (+x).toFixed(4);

/**
 * spec: {
 *   videoClips: [{ path, kind, hasAudio, in, dur, volume, muted, fadeIn, fadeOut }]  (played back to back)
 *   audioClips: [{ path, start, in, dur, volume, fadeIn, fadeOut }]
 *   overlays:   [{ pattern, start, frames }]   PNG sequences rendered at output size
 * }
 * opts: { width, height, fps, outPath }
 * Returns { args, total }.
 */
function buildExportArgs(spec, opts) {
  const { width: W, height: H, fps } = opts;
  const snap = (t) => Math.max(1, Math.round(t * fps)) / fps;
  const args = ['-hide_banner', '-y'];
  const fc = [];
  let idx = 0;
  const AFMT = 'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo';

  const fades = (c, D, a) => {
    let s = '';
    const fi = Math.min(c.fadeIn || 0, D), fo = Math.min(c.fadeOut || 0, D);
    if (fi > 0) s += `,${a}fade=t=in:st=0:d=${n(fi)}`;
    if (fo > 0) s += `,${a}fade=t=out:st=${n(D - fo)}:d=${n(fo)}`;
    return s;
  };

  // --- main video track -------------------------------------------------
  let vidDur = 0;
  let concatIn = '';
  spec.videoClips.forEach((c, i) => {
    const D = snap(c.dur);
    vidDur += D;
    if (c.kind === 'image') args.push('-loop', '1', '-framerate', String(fps), '-t', n(D + 1), '-i', c.path);
    else args.push('-ss', n(c.in), '-t', n(D + 1), '-i', c.path);
    const k = idx++;
    fc.push(`[${k}:v:0]fps=${fps}:start_time=0,` +
      `scale=${W}:${H}:force_original_aspect_ratio=decrease:out_color_matrix=bt709:out_range=tv,` +
      `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuv420p,` +
      `tpad=stop_mode=clone:stop_duration=2,trim=duration=${n(D)},setpts=PTS-STARTPTS${fades(c, D, '')}[v${i}]`);
    if (c.kind !== 'image' && c.hasAudio && !c.muted && c.volume > 0) {
      fc.push(`[${k}:a:0]${AFMT},apad,atrim=duration=${n(D)},asetpts=PTS-STARTPTS,volume=${n(c.volume)}${fades(c, D, 'a')}[a${i}]`);
    } else {
      fc.push(`anullsrc=r=48000:cl=stereo,aformat=sample_fmts=fltp,atrim=duration=${n(D)}[a${i}]`);
    }
    concatIn += `[v${i}][a${i}]`;
  });

  let total = vidDur;
  for (const a of spec.audioClips) total = Math.max(total, a.start + a.dur);
  for (const o of spec.overlays) total = Math.max(total, o.start + o.frames / fps);
  total = snap(total);

  let v, a;
  if (spec.videoClips.length) {
    fc.push(`${concatIn}concat=n=${spec.videoClips.length}:v=1:a=1[vc][ac]`);
    v = 'vc'; a = 'ac';
    if (total > vidDur + 1e-6) {
      fc.push(`[vc]tpad=stop_duration=${n(total - vidDur)}:color=black[vp]`);
      v = 'vp';
    }
  } else {
    fc.push(`color=c=black:s=${W}x${H}:r=${fps}:d=${n(total)},format=yuv420p[vc]`);
    fc.push(`anullsrc=r=48000:cl=stereo,aformat=sample_fmts=fltp,atrim=duration=${n(total)}[ac]`);
    v = 'vc'; a = 'ac';
  }

  // --- text overlays ----------------------------------------------------
  spec.overlays.forEach((o, i) => {
    args.push('-framerate', String(fps), '-start_number', '0', '-i', o.pattern);
    const k = idx++;
    fc.push(`[${k}:v]format=rgba,setpts=PTS+${n(o.start)}/TB[o${i}]`);
    fc.push(`[${v}][o${i}]overlay=0:0:eof_action=pass[vo${i}]`);
    v = `vo${i}`;
  });
  fc.push(`[${v}]format=yuv420p[vout]`);

  // --- extra audio (music, voice-over) ----------------------------------
  const mix = [`[${a}]`];
  spec.audioClips.forEach((c, i) => {
    args.push('-ss', n(c.in), '-t', n(c.dur + 1), '-i', c.path);
    const k = idx++;
    const ms = Math.round(c.start * 1000);
    fc.push(`[${k}:a:0]${AFMT},atrim=duration=${n(c.dur)},asetpts=PTS-STARTPTS,volume=${n(c.volume)}${fades(c, c.dur, 'a')},adelay=${ms}:all=1[x${i}]`);
    mix.push(`[x${i}]`);
  });
  if (mix.length > 1) {
    fc.push(`${mix.join('')}amix=inputs=${mix.length}:duration=longest:dropout_transition=0:normalize=0[am]`);
    a = 'am';
  }
  fc.push(`[${a}]apad,atrim=duration=${n(total)},alimiter=limit=0.97:level=0,${AFMT}[aout]`);

  const mbps = (BITRATES[H] || BITRATES[1080])[fps > 30 ? 1 : 0];
  args.push(
    '-filter_complex', fc.join(';'),
    '-map', '[vout]', '-map', '[aout]',
    // Video: H.264 High, progressive, 4:2:0, closed GOP of half the frame rate, 2 B-frames
    '-c:v', 'libx264', '-preset', 'medium', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-crf', '17', '-maxrate', `${Math.round(mbps * 1500)}k`, '-bufsize', `${Math.round(mbps * 3000)}k`,
    '-r', String(fps), '-g', String(Math.round(fps / 2)), '-bf', '2', '-flags', '+cgop',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv',
    // Audio: AAC-LC stereo 48 kHz 384 kbps
    '-c:a', 'aac', '-b:a', '384k', '-ar', '48000', '-ac', '2',
    // MP4 with the moov atom at the front (fast start)
    '-movflags', '+faststart', '-t', n(total),
    '-progress', 'pipe:1', '-nostats', opts.outPath,
  );
  return { args, total };
}

module.exports = { ffmpegPath, run, probe, parseProbe, thumbnail, waveform, proxy, buildExportArgs, IMAGE_EXT };
