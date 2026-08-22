/**
 * ffmpeg/ffprobe wrappers for delivering and inspecting capture output.
 *
 * Delivery is normalised rather than passed through: Playwright's recorder
 * writes a variable-frame-rate WebM whose timing tracks how busy the page
 * was, which is not something to ship or to measure durations against.
 */
import { spawn } from 'node:child_process';

function run(bin, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.stderr.on('data', (d) => {
      err += d;
    });
    child.on('close', (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${bin} exited ${code}: ${err.slice(-800)}`)),
    );
    child.on('error', reject);
  });
}

export async function hasFfmpeg() {
  try {
    await run('ffmpeg', ['-version']);
    await run('ffprobe', ['-version']);
    return true;
  } catch {
    return false;
  }
}

const ffmpeg = (args) => run('ffmpeg', ['-y', '-loglevel', 'error', ...args]);

/**
 * Constant-rate VP9. Re-encoded, not stream-copied, so the cut is frame-exact.
 *
 * `-cpu-used 4` is not a quality compromise worth arguing about here: at the
 * default speed libvpx-vp9 spends many minutes and a great deal of memory on
 * a 1440x900 screencast, and this repo is routinely shared with several other
 * agents running builds and test suites. A capture that gets killed partway
 * through delivery is worth less than one encoded a notch faster.
 */
export function toWebm(src, dest, { start = 0, duration, fps = 30, threads = 4 }) {
  return ffmpeg([
    '-ss',
    start.toFixed(3),
    ...(duration ? ['-t', duration.toFixed(3)] : []),
    '-i',
    src,
    '-c:v',
    'libvpx-vp9',
    '-crf',
    '32',
    '-b:v',
    '0',
    '-row-mt',
    '1',
    '-deadline',
    'good',
    '-cpu-used',
    '4',
    '-threads',
    String(threads),
    '-r',
    String(fps),
    '-an',
    dest,
  ]);
}

/** H.264 with yuv420p and +faststart, the combination that plays everywhere. */
export function toMp4(src, dest, { start = 0, duration, fps = 30 }) {
  return ffmpeg([
    '-ss',
    start.toFixed(3),
    ...(duration ? ['-t', duration.toFixed(3)] : []),
    '-i',
    src,
    '-c:v',
    'libx264',
    '-crf',
    '20',
    '-preset',
    'medium',
    '-threads',
    '4',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    '-r',
    String(fps),
    '-an',
    dest,
  ]);
}

/** Poster taken from the delivered cut, never from a separately staged shot. */
export function posterFrom(src, dest, atSeconds = 0.2) {
  return ffmpeg(['-ss', atSeconds.toFixed(3), '-i', src, '-frames:v', '1', '-update', '1', dest]);
}

/** One frame at a wall-clock offset, for review of the delivered file. */
export function frameAt(src, dest, seconds) {
  return ffmpeg(['-ss', seconds.toFixed(3), '-i', src, '-frames:v', '1', '-update', '1', dest]);
}

export async function probe(path) {
  const raw = await run('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration,size:stream=codec_name,width,height,avg_frame_rate,nb_read_packets',
    '-select_streams',
    'v:0',
    '-count_packets',
    '-of',
    'json',
    path,
  ]);
  const parsed = JSON.parse(raw);
  const stream = parsed.streams?.[0] ?? {};
  const [num, den] = String(stream.avg_frame_rate ?? '0/1')
    .split('/')
    .map(Number);
  return {
    codec: stream.codec_name ?? null,
    width: stream.width ?? null,
    height: stream.height ?? null,
    fps: den ? Number((num / den).toFixed(3)) : null,
    frames: stream.nb_read_packets ? Number(stream.nb_read_packets) : null,
    duration: Number(parsed.format?.duration ?? 0),
    bytes: Number(parsed.format?.size ?? 0),
  };
}

/**
 * Mean luma of a frame, 0-255.
 *
 * Cheap way to catch the failure that a passing Playwright run cannot: a clip
 * that is technically valid but shows a black or blank editor.
 */
export async function frameLuma(path) {
  const out = await run('ffprobe', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    `movie=${path.replace(/[\\:]/g, '\\$&')},signalstats`,
    '-show_entries',
    'frame_tags=lavfi.signalstats.YAVG',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    '-read_intervals',
    '%+#1',
  ]);
  return Number.parseFloat(out.trim().split('\n')[0]) || 0;
}
