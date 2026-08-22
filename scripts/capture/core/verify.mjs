/**
 * Inspecting the delivered file, not just the run that produced it.
 *
 * A Playwright script can exit zero having recorded a black rectangle. Every
 * clip is therefore probed for codec/geometry/duration and sampled at fixed
 * points, and the sampled frames are written out for review.
 */
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { frameAt, frameLuma, probe } from './ffmpeg.mjs';

/** Luma below this is a black or near-black frame — never a real editor. */
const BLACK_LUMA = 16;
/** Above this the frame is essentially a white void: no chrome, no canvas. */
const BLANK_LUMA = 250;

export async function verifyClip(path, expected) {
  const findings = [];
  const ok = (cond, message) => {
    if (!cond) findings.push(message);
  };

  if (!existsSync(path)) return { pass: false, findings: [`missing file: ${path}`] };
  const bytes = statSync(path).size;
  ok(bytes > 0, 'file is empty');

  const info = await probe(path);
  ok(info.codec === expected.codec, `codec is ${info.codec}, expected ${expected.codec}`);
  ok(
    info.width === expected.width && info.height === expected.height,
    `dimensions are ${info.width}x${info.height}, expected ${expected.width}x${expected.height}`,
  );
  ok(
    info.fps !== null && Math.abs(info.fps - expected.fps) < 0.5,
    `frame rate is ${info.fps}, expected ${expected.fps}`,
  );
  ok(
    info.duration >= expected.minSeconds && info.duration <= expected.maxSeconds,
    `duration ${info.duration.toFixed(1)}s outside ${expected.minSeconds}-${expected.maxSeconds}s`,
  );
  ok(bytes <= expected.maxBytes, `${(bytes / 1e6).toFixed(2)} MB exceeds budget`);

  return { pass: findings.length === 0, findings, info };
}

/**
 * Extracts the review frames named in the brief — start, quarters, and the
 * last meaningful frame — and flags any that are black or blank.
 *
 * The final sample is pulled slightly inside the end: asking for the exact
 * duration lands past the last packet and yields nothing.
 */
export async function sampleFrames(path, duration, outDir, slug) {
  mkdirSync(outDir, { recursive: true });
  const marks = [
    ['start', Math.min(0.15, duration * 0.02)],
    ['q1', duration * 0.25],
    ['mid', duration * 0.5],
    ['q3', duration * 0.75],
    ['final', Math.max(0, duration - 0.25)],
  ];

  const frames = [];
  for (const [label, at] of marks) {
    const dest = join(outDir, `${slug}-${label}.png`);
    await frameAt(path, dest, at);
    const luma = existsSync(dest) ? await frameLuma(dest) : 0;
    frames.push({
      label,
      at: Number(at.toFixed(2)),
      path: dest,
      luma: Number(luma.toFixed(1)),
      black: luma < BLACK_LUMA,
      blank: luma > BLANK_LUMA,
      exists: existsSync(dest),
    });
  }
  return frames;
}

export function frameFindings(frames) {
  const findings = [];
  for (const f of frames) {
    if (!f.exists) findings.push(`frame ${f.label} could not be extracted`);
    else if (f.black) findings.push(`frame ${f.label} is black (luma ${f.luma})`);
    else if (f.blank) findings.push(`frame ${f.label} is blank (luma ${f.luma})`);
  }
  return findings;
}
