// Smoke test for the export pipeline: generates sample media with ffmpeg,
// exports a small project and checks the result is YouTube-shaped.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const ff = require('../src/main/ffmpeg');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-test-'));
  const gen = async (args) => { const r = await ff.run(['-hide_banner', '-y', ...args]); assert.strictEqual(r.code, 0, r.stderr); };
  const a = path.join(dir, 'a.mp4'), b = path.join(dir, 'portrait.mov'), img = path.join(dir, 'pic.png'), music = path.join(dir, 'music.mp3');
  await gen(['-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=25:d=4', '-f', 'lavfi', '-i', 'sine=f=440:d=4', '-pix_fmt', 'yuv420p', '-shortest', a]);
  await gen(['-f', 'lavfi', '-i', 'testsrc=s=720x1280:r=30:d=3', '-pix_fmt', 'yuv420p', b]); // portrait, no audio
  await gen(['-f', 'lavfi', '-i', 'color=c=red:s=800x600', '-frames:v', '1', img]);
  await gen(['-f', 'lavfi', '-i', 'sine=f=220:d=20', music]);
  // a fake text overlay sequence
  for (let i = 0; i < 30; i++) fs.copyFileSync(img, path.join(dir, `t0_${String(i).padStart(6, '0')}.png`));

  const pa = await ff.probe(a), pb = await ff.probe(b), pi = await ff.probe(img), pm = await ff.probe(music);
  assert.deepStrictEqual([pa.kind, pa.hasAudio, pa.width], ['video', true, 1280]);
  assert.deepStrictEqual([pb.kind, pb.hasAudio, pb.height], ['video', false, 1280]);
  assert.strictEqual(pi.kind, 'image');
  assert.strictEqual(pm.kind, 'audio');

  const out = path.join(dir, 'out.mp4');
  const spec = {
    videoClips: [
      { path: a, kind: 'video', hasAudio: true, in: 1, dur: 2, volume: 1, muted: false, fadeIn: 0.5, fadeOut: 0 },
      { path: b, kind: 'video', hasAudio: false, in: 0, dur: 1.5, volume: 1, muted: false, fadeIn: 0, fadeOut: 0 },
      { path: img, kind: 'image', hasAudio: false, in: 0, dur: 1, volume: 1, muted: false, fadeIn: 0, fadeOut: 0.5 },
    ],
    audioClips: [{ path: music, start: 0.5, in: 2, dur: 5, volume: 0.5, fadeIn: 1, fadeOut: 1 }],
    overlays: [{ pattern: path.join(dir, 't0_%06d.png'), start: 1, frames: 30 }],
  };
  const { args, total } = ff.buildExportArgs(spec, { width: 1920, height: 1080, fps: 30, outPath: out });
  let progress = 0;
  const r = await ff.run(args, { onStdout: (s) => { if (/out_time_us=\d+/.test(s)) progress++; } });
  assert.strictEqual(r.code, 0, r.stderr.slice(-3000));
  assert.ok(progress > 0, 'no progress reported');
  assert.strictEqual(total, 5.5); // music runs past the 4.5s of video

  const info = (await ff.run(['-hide_banner', '-i', out])).stderr;
  const po = ff.parseProbe(info, out);
  assert.deepStrictEqual([po.width, po.height, po.fps, po.hasAudio], [1920, 1080, 30, true]);
  assert.ok(Math.abs(po.duration - 5.5) < 0.1, `duration ${po.duration}`);
  assert.match(info, /h264 \(High\)/);
  assert.match(info, /yuv420p\(tv, bt709/);
  assert.match(info, /aac \(LC\).*48000 Hz, stereo/);
  // fast start: moov atom before mdat
  const head = fs.readFileSync(out).subarray(0, 4096).toString('latin1');
  assert.ok(head.includes('moov'), 'moov atom not at the front');

  // text overlay visible only while it should be: frame at 1.5s is red, at 2.5s is not
  const pix = async (t) => {
    const p = path.join(dir, `f${t}.rgb`);
    await gen(['-ss', String(t), '-i', out, '-frames:v', '1', '-vf', 'crop=4:4:100:100', '-f', 'rawvideo', '-pix_fmt', 'rgb24', p]);
    return [...fs.readFileSync(p).subarray(0, 3)];
  };
  const on = await pix(1.5), off = await pix(2.5);
  assert.ok(on[0] > 200 && on[1] < 60, `overlay missing at 1.5s: ${on}`);
  assert.ok(!(off[0] > 200 && off[1] < 60), `overlay still showing at 2.5s: ${off}`);

  // text/audio only project (no video clips)
  const out2 = path.join(dir, 'out2.mp4');
  const r2 = await ff.run(ff.buildExportArgs({ videoClips: [], audioClips: spec.audioClips, overlays: spec.overlays }, { width: 1280, height: 720, fps: 24, outPath: out2 }).args);
  assert.strictEqual(r2.code, 0, r2.stderr.slice(-3000));

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('export test passed');
})().catch((e) => { console.error(e); process.exit(1); });
