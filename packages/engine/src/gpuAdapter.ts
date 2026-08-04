/// <reference path="./webgpu-ambient.d.ts" />

/**
 * Shared WebGPU adapter selection: power-preference fallback iteration and
 * software/emulated-adapter detection, used identically by the render
 * compositor (`@varve/compositor`) and the background-removal GPU
 * accelerator (`GpuAccelerator`).
 *
 * Consolidates what used to be three independent, textually-different
 * implementations (compositor's `WebGPUBackend.init`, compositor's
 * `detectWebGPU`, and `GpuAccelerator.initialize`) that could disagree on
 * whether the same adapter was "real" hardware or a software rasterizer —
 * only one of the three declined software adapters at all (ADR-0003's
 * Minimum Supported Baseline), and the two that did used different
 * substrings on different `GPUAdapterInfo` fields.
 */

/** Substrings identifying known software/emulated WebGPU adapters, checked
 * case-insensitively across every `GPUAdapterInfo` string field. Covers
 * Chromium/ANGLE's SwiftShader, generic "fallback adapter" self-reporting,
 * and Mesa's llvmpipe/lavapipe (the software rasterizers actually reachable
 * on this project's primary Linux dev target, CI, and VMs — neither of the
 * two heuristics this replaces recognized them). */
const SOFTWARE_ADAPTER_MARKERS = ['swift', 'fallback', 'software', 'llvmpipe', 'lavapipe'];

export function isSoftwareAdapter(adapter: GPUAdapter): boolean {
  const info = adapter.info;
  const haystack = [info?.vendor, info?.architecture, info?.device, info?.description]
    .filter((s): s is string => !!s)
    .join(' ')
    .toLowerCase();
  return SOFTWARE_ADAPTER_MARKERS.some((marker) => haystack.includes(marker));
}

export type AdapterSelectionResult =
  /** A usable adapter — `isFallbackAdapter` is true when it's a software
   * adapter the caller chose to accept anyway (`requireHardwareAdapter: false`). */
  | { kind: 'accepted'; adapter: GPUAdapter; isFallbackAdapter: boolean }
  /** Every adapter found across all power preferences was software-emulated
   * and `requireHardwareAdapter: true` declined all of them. Distinct from
   * `unavailable` so diagnostics can report "GPU fallback (software adapter
   * declined)" rather than "no WebGPU at all". */
  | { kind: 'declined-software' }
  /** No adapter of any kind was returned for any power preference. */
  | { kind: 'unavailable' };

/**
 * Request a WebGPU adapter, trying `high-performance` before `low-power`
 * (or the reverse if a preference is given) so laptops/integrated-only
 * systems that fail on a discrete-GPU request still get a working adapter.
 *
 * When `requireHardwareAdapter` is true (ADR-0003's Minimum Supported
 * Baseline), a software/emulated adapter is skipped rather than accepted —
 * the hand-tuned CPU/Canvas2D fallback outperforms software-rendered
 * WebGPU, so callers that care about that tradeoff (the render compositor)
 * should decline it instead of silently running in degraded GPU mode. When
 * false (used by `GpuAccelerator`'s compute-shader path, which has no CPU
 * fallback ADR to honor today), a software adapter is returned as
 * `'accepted'` with `isFallbackAdapter: true` so callers can still report it
 * in diagnostics.
 */
export async function selectWebGpuAdapter(
  gpu: GPU,
  options: { powerPreference?: GPUPowerPreference; requireHardwareAdapter: boolean },
): Promise<AdapterSelectionResult> {
  const { powerPreference, requireHardwareAdapter } = options;
  const preferences: GPUPowerPreference[] = powerPreference
    ? [powerPreference, powerPreference === 'high-performance' ? 'low-power' : 'high-performance']
    : ['high-performance', 'low-power'];

  let sawSoftwareAdapter = false;
  for (const pref of preferences) {
    let adapter: GPUAdapter | null;
    try {
      adapter = await gpu.requestAdapter({ powerPreference: pref });
    } catch {
      continue;
    }
    if (!adapter) continue;
    const isFallbackAdapter = isSoftwareAdapter(adapter);
    if (isFallbackAdapter && requireHardwareAdapter) {
      sawSoftwareAdapter = true;
      continue;
    }
    return { kind: 'accepted', adapter, isFallbackAdapter };
  }
  return sawSoftwareAdapter ? { kind: 'declined-software' } : { kind: 'unavailable' };
}
