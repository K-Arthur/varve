/** Per-clip capture manifest: what was recorded, from what, and how it verified. */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

function gitCommit(root) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

export function writeManifest(path, entry, root) {
  const manifest = {
    workflow: entry.workflow,
    slug: entry.slug,
    purpose: entry.purpose,
    gitCommit: gitCommit(root),
    capturedAt: new Date().toISOString(),
    viewport: `${entry.viewport.width}x${entry.viewport.height}`,
    dpr: entry.dpr ?? 1,
    fixture: entry.fixture ?? null,
    captureRuntime: `chromium ${entry.browserVersion ?? 'unknown'} / node ${process.version}`,
    sourceDuration: Number((entry.sourceDuration ?? 0).toFixed(2)),
    deliveredDuration: Number((entry.deliveredDuration ?? 0).toFixed(2)),
    fps: entry.fps ?? 30,
    outputs: entry.outputs ?? {},
    productAssertions: entry.assertions ?? [],
    verification: entry.verification ?? {},
  };
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
