/**
 * Exact model/runtime/platform support matrix (G4).
 *
 * A requested execution provider, a created GPU device, or a successful small
 * tensor run do not prove that a full graph executed on that provider. This
 * module records what was actually exercised, where, and with which artifact,
 * and it keeps unverified cells unverified instead of promoting them when a
 * device happens to expose an adapter.
 *
 * Consumers:
 * - Automatic routing filters on `status === 'verified'` cells only.
 * - Diagnostics and docs read the same cells, so a claim cannot drift from
 *   the evidence pointer it cites.
 */

export type PlatformEvidenceStatus = 'verified' | 'unverified' | 'unsupported';

export type PlatformEvidenceGroup =
  | 'text-discovery'
  | 'prompted-segmentation'
  | 'matting'
  | 'vision';

export interface PlatformMatrixCell {
  /** Stable id, `capability:runtime`. */
  id: string;
  group: PlatformEvidenceGroup;
  capability: string;
  runtime: 'wasm-single-thread' | 'wasm-threaded' | 'webgpu' | 'webgl' | 'native' | 'node-cpu';
  /** Exact host description; `*` means the cell is host-agnostic. */
  platform: string;
  status: PlatformEvidenceStatus;
  /** Why this status, in user-facing terms. */
  reason: string;
  /** Test/doc that produced the evidence; required for verified cells. */
  evidence?: string;
  /** Artifact/bundle identity the evidence applies to, when relevant. */
  artifact?: string;
}

/**
 * The matrix as of 2026-09-15. Every `verified` cell cites a run that this
 * repository can reproduce; every `unsupported` cell states the code or
 * artifact constraint that makes it unsupported; every other cell is
 * explicitly `unverified`.
 */
export const PLATFORM_EVIDENCE_MATRIX: readonly PlatformMatrixCell[] = [
  {
    id: 'grounding-dino:wasm-single-thread',
    group: 'text-discovery',
    capability: 'grounding-dino-tiny-int8',
    runtime: 'wasm-single-thread',
    platform: 'chromium-linux-x64 (editor worker)',
    status: 'verified',
    reason:
      'Real-photo query returned the expected phrase-attributed detection through the editor worker. The worker ORT runtime is pinned single-threaded. The verified run used the reference JS resize preprocessing identity (v1); the shipped canvas path (v2) is measured to differ in the model input domain (mean |delta| 0.31 normalized) and closer to an area-average resize, but has no detection run yet.',
    evidence: 'docs/architecture/text-discovery-system.md#verified-runtime-behavior',
    artifact: 'model_int8.onnx sha256 3bff430d…a0082a26',
  },
  {
    id: 'grounding-dino:wasm-threaded',
    group: 'text-discovery',
    capability: 'grounding-dino-tiny-int8',
    runtime: 'wasm-threaded',
    platform: 'chromium-linux-x64 (editor worker)',
    status: 'unverified',
    reason:
      'The shared inference worker pins ort.env.wasm.numThreads = 1 (a documented headless/AMD deadlock workaround), so no threaded configuration has ever executed this graph. A cross-origin isolated probe page reproduced the underlying failure on a different shipped graph: threaded session creation never returned within 120 s and was terminated. Cross-origin isolation raises the memory budget only.',
    evidence: 'tests/e2e/canvas/threaded-wasm-probe.spec.ts',
  },
  {
    id: 'wasm-threaded-runtime:chromium-linux-x64',
    group: 'vision',
    capability: 'wasm-threaded-runtime',
    runtime: 'wasm-threaded',
    platform: 'chromium-linux-x64, cross-origin isolated (8 logical CPUs)',
    status: 'unverified',
    reason:
      'Measured, not assumed: in a minimal COOP/COEP page (crossOriginIsolated true, SharedArrayBuffer present, 4 GiB shared-memory ceiling reservable) a real shipped 233 KB graph ran single-threaded in 157 ms/run after a 1.3 s session create, while numThreads = 2 never returned from session creation within 120 s and had to be terminated. Threaded WASM is therefore unusable on this host/browser/architecture until a different build or thread arrangement is measured.',
    evidence: 'tests/e2e/canvas/threaded-wasm-probe.spec.ts',
    artifact: 'yunet-face-detect.onnx (233 KB, input [1,3,640,640])',
  },
  {
    id: 'grounding-dino:webgpu',
    group: 'text-discovery',
    capability: 'grounding-dino-tiny-int8',
    runtime: 'webgpu',
    platform: 'chromium-linux-x64',
    status: 'unsupported',
    reason:
      'Four of the five graph inputs are int64 tensors; the catalog keeps this graph on WASM and the WebGPU EP int64 kernel coverage is narrow. Not offered as a GPU path.',
    evidence: 'docs/architecture/text-discovery-system.md#verified-runtime-behavior',
  },
  {
    id: 'sam2-hiera-tiny:node-cpu',
    group: 'prompted-segmentation',
    capability: 'sam2-hiera-tiny',
    runtime: 'node-cpu',
    platform: 'linux-x64 (A/B harness)',
    status: 'verified',
    reason:
      'All ten corpus categories measured through the production encode/decode functions; artifact bytes match the shipped manifest.',
    evidence:
      'packages/engine/src/segmentation/quality/evidence/provider-ab-results-2026-09-14.json',
    artifact: 'sam2-hiera-tiny.encoder.onnx sha256 b4cfd6c8…b88b41cf',
  },
  {
    id: 'sam2-hiera-tiny:webgpu',
    group: 'prompted-segmentation',
    capability: 'sam2-hiera-tiny',
    runtime: 'webgpu',
    platform: 'any',
    status: 'unverified',
    reason:
      'The manifest lists webgpu as supported, but no run has captured node assignment or compared outputs against the CPU reference. A created device is not execution evidence.',
    evidence: 'docs/quality/object-selection-parity.md',
  },
  {
    id: 'mobile-sam:node-cpu',
    group: 'prompted-segmentation',
    capability: 'mobile-sam',
    runtime: 'node-cpu',
    platform: 'linux-x64 (A/B harness)',
    status: 'verified',
    reason:
      'All ten corpus categories measured; the provider remains explicit-only and never eligible for automatic routing.',
    evidence:
      'packages/engine/src/segmentation/quality/evidence/provider-ab-results-2026-09-14.json',
    artifact: 'mobile_sam_image_encoder.onnx sha256 580f5fb6…760cc749',
  },
  {
    id: 'mobile-sam:webgpu',
    group: 'prompted-segmentation',
    capability: 'mobile-sam',
    runtime: 'webgpu',
    platform: 'any',
    status: 'unsupported',
    reason: 'The catalog entry declares WASM only for MobileSAM.',
    evidence: 'apps/desktop/public/models/manifest.json',
  },
  {
    id: 'efficient-sam-ti:node-cpu',
    group: 'prompted-segmentation',
    capability: 'efficient-sam-ti',
    runtime: 'node-cpu',
    platform: 'linux-x64 (A/B harness)',
    status: 'verified',
    reason:
      'Measured for the categories needed to gate an explicit selection; the provider is experimental and stays out of Auto.',
    evidence: 'docs/audits/efficient-sam-ti-ab-evaluation-2026-09-14.md',
    artifact: 'efficientsam_ti_encoder.onnx sha256 84ed466f…0e0951',
  },
  {
    id: 'modnet-portrait:wasm-single-thread',
    group: 'matting',
    capability: 'modnet-portrait',
    runtime: 'wasm-single-thread',
    platform: 'chromium-linux-x64 (editor worker)',
    status: 'verified',
    reason:
      'Browser run produced the portrait alpha mask, apply → mask asset → undo through the editor worker.',
    evidence: 'docs/agents/ai-selection-routing-2026-09-15-ownership.md',
    artifact: 'modnet-portrait/model.onnx',
  },
  {
    id: 'yunet-face-detect:wasm-single-thread',
    group: 'vision',
    capability: 'yunet-face-detect',
    runtime: 'wasm-single-thread',
    platform: 'chromium-linux-x64 (editor worker)',
    status: 'verified',
    reason:
      'Real-photo crop protection review ran through the editor worker with corrected preprocessing.',
    evidence: 'docs/audits/face-detection-evidence-2026-09-15.md',
  },
];

/** Automatic routing is allowed only for cells this repository has exercised. */
export function isVerifiedForAutomaticRouting(
  capability: string,
  runtime: PlatformMatrixCell['runtime'],
): boolean {
  return PLATFORM_EVIDENCE_MATRIX.some(
    (cell) =>
      cell.capability === capability && cell.runtime === runtime && cell.status === 'verified',
  );
}

export function platformCellsFor(capability: string): PlatformMatrixCell[] {
  return PLATFORM_EVIDENCE_MATRIX.filter((cell) => cell.capability === capability);
}

export function platformEvidenceFor(id: string): PlatformMatrixCell | undefined {
  return PLATFORM_EVIDENCE_MATRIX.find((cell) => cell.id === id);
}

/**
 * Contract check used by tests and release checks: verified cells must cite
 * evidence, and unsupported cells must state a reason.
 */
export function matrixIntegrityProblems(
  matrix: readonly PlatformMatrixCell[] = PLATFORM_EVIDENCE_MATRIX,
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const cell of matrix) {
    if (seen.has(cell.id)) problems.push(`duplicate cell id '${cell.id}'`);
    seen.add(cell.id);
    if (cell.status === 'verified' && !cell.evidence) {
      problems.push(`verified cell '${cell.id}' has no evidence pointer`);
    }
    if (cell.reason.trim().length < 12) {
      problems.push(`cell '${cell.id}' has no meaningful reason`);
    }
  }
  return problems;
}
