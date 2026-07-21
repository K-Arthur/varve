/**
 * Dev-only diagnostics overlay for canvas draw timing and correctness.
 *
 * Collects per-frame metrics in a ring buffer and exposes them for a
 * <canvas> overlay or console inspection. Guarded by (import.meta as any).env.DEV.
 */

export interface FrameDiagnostics {
  frameIndex: number;
  docVersion: number;
  redrawCount: number;
  nodeCount: number;
  culledCount: number;
  cacheHitCount: number;
  buildIrMs: number;
  replayMs: number;
  totalMs: number;
  renderPath: 'structural' | 'worker' | 'worker-cached' | 'compositor';
  wasDirty: boolean;
  partialRedraw: boolean;
  cacheBytes: number;
  cacheEntries: number;
}

const MAX_DIAG_FRAMES = 120;
const diagRing: FrameDiagnostics[] = [];
let diagEnabled = false;

export function enableDrawDiagnostics(force = false): void {
  diagEnabled = force || (import.meta as any).env.DEV;
}

export function isDiagnosticsEnabled(): boolean {
  return diagEnabled;
}

export function resetDiagnostics(): void {
  diagRing.length = 0;
}

export function recordFrame(frame: FrameDiagnostics): void {
  if (!diagEnabled) return;
  diagRing.push(frame);
  if (diagRing.length > MAX_DIAG_FRAMES) diagRing.shift();
}

export function getRecentFrames(n = 10): FrameDiagnostics[] {
  return diagRing.slice(-n);
}

export function getFrameCount(): number {
  return diagRing.length;
}

export function getLastFrame(): FrameDiagnostics | null {
  return diagRing.length > 0 ? diagRing[diagRing.length - 1]! : null;
}

/** Render the diagnostics overlay onto a 2D context. */
export function renderDrawDiagnostics(ctx: CanvasRenderingContext2D, canvasWidth: number): void {
  if (!diagEnabled || diagRing.length === 0) return;
  const last = diagRing[diagRing.length - 1]!;
  const recent = diagRing.slice(-30);
  const avgMs = recent.reduce((s, f) => s + f.totalMs, 0) / recent.length;
  const sorted = [...recent].sort((a, b) => a.totalMs - b.totalMs);
  const p95Ms = sorted[Math.floor(recent.length * 0.95)]?.totalMs ?? 0;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = '11px monospace';
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(canvasWidth - 420, 4, 416, 140);
  ctx.fillStyle = '#0f0';
  ctx.textAlign = 'right';
  const lines = [
    `F#${last.frameIndex}  dv#${last.docVersion}  rc#${last.redrawCount}`,
    `path:${last.renderPath}  ${last.wasDirty ? 'dirty' : 'clean'}  ${last.partialRedraw ? 'partial' : 'full'}`,
    `nodes:${last.nodeCount}  culled:${last.culledCount}  cache:${last.cacheHitCount}`,
    `cache: ${last.cacheEntries} entries, ${(last.cacheBytes / 1024).toFixed(0)} KB`,
    `build:${last.buildIrMs.toFixed(1)}ms  replay:${last.replayMs.toFixed(1)}ms`,
    `total:${last.totalMs.toFixed(1)}ms  avg30:${avgMs.toFixed(1)}ms  p95:${p95Ms.toFixed(1)}ms`,
  ];
  lines.forEach((line, i) => {
    ctx.fillText(line, canvasWidth - 8, 20 + i * 18);
  });
  ctx.restore();
}
