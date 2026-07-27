import { createDiagnosticsLabel, getRuntimeCapabilities } from './RuntimeCapabilities';
import type { DiagnosticsReport, ExecutionProvider, ModelInstallInfo } from './types';

let recentErrors: Array<{ code: string; message: string; time: string }> = [];

export function recordError(code: string, message: string): void {
  recentErrors.push({ code, message, time: new Date().toISOString() });
  if (recentErrors.length > 50) {
    recentErrors = recentErrors.slice(-50);
  }
}

export function getRecentErrors(): Array<{ code: string; message: string; time: string }> {
  return [...recentErrors];
}

export function clearErrors(): void {
  recentErrors = [];
}

export interface DiagnosticsStorageInfo {
  backend: string;
  modelsInstalled: number;
  storageUsedMB: number;
  quotaMB: number | null;
}

export async function buildDiagnosticsReport(
  installedModels: ModelInstallInfo[],
  precisionInfos?: Array<{
    provider: ExecutionProvider;
    int8Accelerated: boolean;
    fp16Supported: boolean;
    measuredSpeedup: number | null;
  }>,
  _storageInfo?: DiagnosticsStorageInfo,
): Promise<DiagnosticsReport> {
  const caps = await getRuntimeCapabilities();
  return {
    applicationVersion: getAppVersion(),
    ortVersion: getOrtVersion(),
    runtimeCapabilities: caps,
    installedModels,
    recentErrors: getRecentErrors(),
    precisionCapabilities: precisionInfos ?? [],
  };
}

export function formatDiagnosticsReport(report: DiagnosticsReport): string {
  const lines: string[] = [];
  lines.push('=== Strata AI Diagnostics Report ===');
  lines.push(`App Version: ${report.applicationVersion}`);
  lines.push(`ONNX Runtime: ${report.ortVersion}`);
  lines.push('');
  lines.push('--- Runtime ---');
  const caps = report.runtimeCapabilities;
  lines.push(createDiagnosticsLabel(caps));
  lines.push(`OS: ${caps.os ?? 'unknown'}`);
  lines.push(`CPU: ${caps.cpuArch ?? 'unknown'} · ${caps.logicalProcessors ?? '?'} cores`);
  lines.push(
    `Memory: ~${caps.approximateMemoryMB ? Math.round(caps.approximateMemoryMB / 1024) : '?'} GB`,
  );
  lines.push(`WebGPU: ${caps.hasWebGPU ? 'yes' : 'no'}`);
  lines.push(`WebGL: ${caps.hasWebGL ? 'yes' : 'no'}`);
  lines.push(`SharedArrayBuffer: ${caps.sharedMemoryAvailable ? 'yes' : 'no'}`);
  lines.push(`Cross-Origin Isolated: ${caps.crossOriginIsolated ? 'yes' : 'no'}`);
  lines.push(`Workers: ${caps.hasWorker ? 'yes' : 'no'}`);
  lines.push(`Tauri: ${caps.isTauri ? 'yes' : 'no'}`);
  lines.push(`ONNX Providers: ${caps.preferredOnnxProviders.join(', ')}`);
  lines.push(`WASM Safe: ${formatBytes(caps.wasmSafeModelBytes)}`);
  lines.push(`Memory Tier: ${caps.memoryTier ?? 'unknown'}`);
  lines.push(`WebGPU Device Lost: ${caps.webgpuDeviceLost ? 'yes' : 'no'}`);
  lines.push(`Battery Powered: ${caps.batteryPowered ? 'yes' : 'no'}`);
  lines.push(`Network: ${caps.networkType ?? 'unknown'}`);

  lines.push('');
  lines.push('--- Precision Capabilities ---');
  for (const pc of report.precisionCapabilities) {
    lines.push(
      `${pc.provider}: INT8 ${pc.int8Accelerated ? 'accelerated' : 'not accelerated'} · FP16 ${pc.fp16Supported ? 'supported' : 'not supported'}${pc.measuredSpeedup !== null ? ` · speedup: ${pc.measuredSpeedup.toFixed(2)}x` : ''}`,
    );
  }

  lines.push('');
  lines.push('--- Installed Models ---');
  for (const m of report.installedModels) {
    lines.push(
      `${m.installed ? '[X]' : '[ ]'} ${m.name} (${m.id}) · ${formatBytes(m.sizeBytes)} · ${m.state} · ${m.source}`,
    );
  }

  lines.push('');
  lines.push('--- Recent Errors ---');
  if (report.recentErrors.length === 0) {
    lines.push('(none)');
  } else {
    for (const err of report.recentErrors) {
      lines.push(`[${err.time}] ${err.code}: ${err.message}`);
    }
  }

  return lines.join('\n');
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${Math.round(bytes / 1_000_000)} MB`;
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${bytes} B`;
}

function getAppVersion(): string {
  try {
    return process?.env?.PACKAGE_VERSION ?? 'dev';
  } catch {
    return 'dev';
  }
}

function getOrtVersion(): string {
  try {
    return '1.27.0';
  } catch {
    return 'unknown';
  }
}

export class DiagnosticsCollector {
  private startTimes = new Map<string, number>();

  begin(correlationId: string): void {
    this.startTimes.set(correlationId, performance.now());
  }

  end(correlationId: string): number {
    const start = this.startTimes.get(correlationId);
    if (start === undefined) return 0;
    this.startTimes.delete(correlationId);
    return performance.now() - start;
  }
}
