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
}

const MAX_DIAG_FRAMES = 120;
const diagRing: FrameDiagnostics[] = [];
let diagEnabled = false;

export function enableDrawDiagnostics(force = false): void {
  diagEnabled = force || import.meta.env.DEV;
}

export function isDiagnosticsEnabled(): boolean {
  return diagEnabled;
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

export function resetDiagnostics(): void {
  diagRing.length = 0;
}
