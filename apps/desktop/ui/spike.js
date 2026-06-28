// Render spike frontend. Measures two native→webview transports head-to-head:
//   1. "ir"      — compact scene IR (JSON), replayed via canvas2D fillRect.
//   2. "pixels"  — raw RGBA ArrayBuffer, drawn via putImageData.
// Each mode runs flat-out for DURATION_MS, self-reports to Rust (stdout), then
// the next mode starts. After both, calls `done` so the app exits cleanly and
// the shell returns with the captured measurements.
/* global window */
const invoke = window.__TAURI__.core.invoke;

const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');
const W = cv.width;
const H = cv.height;
const DURATION_MS = 5000;

const el = {
  status: document.getElementById('status'),
  mode: document.getElementById('mode'),
  fps: document.getElementById('fps'),
  bpf: document.getElementById('bpf'),
  bw: document.getElementById('bw'),
};

function setReadout(mode, fps, bpf) {
  el.mode.textContent = mode;
  el.fps.textContent = fps.toFixed(1);
  el.bpf.textContent = bpf.toLocaleString();
  el.bw.textContent = ((bpf * fps) / 1_000_000).toFixed(2) + ' MB/s';
}

async function measureIr() {
  el.status.textContent = 'measuring IR replay…';
  const start = performance.now();
  let frames = 0;
  let bytesAccum = 0;
  while (performance.now() - start < DURATION_MS) {
    const scene = await invoke('render_frame_ir', { width: W, height: H, frame: frames });
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    for (const s of scene.shapes) {
      const c = s.color;
      ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${(c[3] / 255).toFixed(3)})`;
      ctx.fillRect(s.x, s.y, s.w, s.h);
    }
    // Approximate payload size: each shape serializes to ~70 bytes of JSON.
    bytesAccum += 40 + scene.shapes.length * 70;
    frames += 1;
    setReadout('ir', frames / ((performance.now() - start) / 1000), bytesAccum / frames);
  }
  const elapsed = (performance.now() - start) / 1000;
  await invoke('report', {
    report: {
      mode: 'ir',
      fps: frames / elapsed,
      frames,
      elapsed,
      bytes_per_frame: bytesAccum / frames,
    },
  });
}

async function measurePixels() {
  el.status.textContent = 'measuring pixel push…';
  const start = performance.now();
  let frames = 0;
  let bytesAccum = 0;
  while (performance.now() - start < DURATION_MS) {
    const buf = await invoke('render_frame_pixels', { width: W, height: H, frame: frames });
    const img = new ImageData(new Uint8ClampedArray(buf), W, H);
    ctx.putImageData(img, 0, 0);
    bytesAccum += buf.byteLength;
    frames += 1;
    setReadout('pixels', frames / ((performance.now() - start) / 1000), bytesAccum / frames);
  }
  const elapsed = (performance.now() - start) / 1000;
  await invoke('report', {
    report: {
      mode: 'pixels',
      fps: frames / elapsed,
      frames,
      elapsed,
      bytes_per_frame: bytesAccum / frames,
    },
  });
}

async function main() {
  el.status.textContent = 'ready';
  await measureIr();
  await measurePixels();
  el.status.textContent = 'done — see stdout';
  await invoke('done');
}

main().catch((err) => {
  el.status.textContent = 'error: ' + err;
  console.error(err);
});
