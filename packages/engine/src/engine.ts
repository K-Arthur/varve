/**
 * Dual-backend engine facade (Strata plan §0.3 + ADR-0001).
 *
 * `createEngine()` returns one surface used by all feature code:
 *   - 'native' → Tauri IPC into the natively-compiled Rust crates (desktop).
 *   - 'wasm'   → wasm-pack build of the same crates (web).
 *   - 'stub'   → a pure-TS implementation mirroring the Rust logic, used for
 *                tests and as a fallback when neither binding is present.
 *
 * The desktop build MUST select native (asserted) — that is the strategic wedge
 * (no WASM memory ceiling). The web build selects wasm.
 */
import { hitTest } from './geometry';
import type { Backend, Point, RenderItem, Scene, SceneNode } from './types';

export interface Engine {
  readonly backend: Backend;
  /** Build the render IR for a scene (crosses the IPC boundary on native/wasm). */
  buildIr(scene: Scene): Promise<RenderItem[]>;
  /** Hit-test a world-space point; returns the topmost node index or null.
   * Done locally (no round-trip) — the webview owns picking. */
  hitTest(scene: Scene, world: Point): Promise<number | null>;
}

function shapeToPrimitive(node: SceneNode): RenderItem['primitive'] {
  const s = node.shape;
  switch (s.kind) {
    case 'rect':
      return { kind: 'rect', x: s.x, y: s.y, w: s.w, h: s.h };
    case 'ellipse':
      return { kind: 'ellipse', cx: s.cx, cy: s.cy, rx: s.rx, ry: s.ry };
    case 'circle':
      return { kind: 'circle', cx: s.cx, cy: s.cy, r: s.r };
    case 'line':
      return { kind: 'line', from: s.from, to: s.to, tolerance: s.tolerance };
  }
}

/** Pure-TS engine mirroring strata-engine::build_render_ir + strata-core::hit_test. */
function stubEngine(): Engine {
  return {
    backend: 'stub',
    async buildIr(scene) {
      return scene.nodes.map((n) => ({
        transform: n.transform,
        fill: n.fill,
        primitive: shapeToPrimitive(n),
      }));
    },
    async hitTest(scene, world) {
      return hitTest(scene.nodes, world);
    },
  };
}

function tauriInvokeAvailable(): boolean {
  return (
    typeof globalThis !== 'undefined' && Boolean((globalThis as Record<string, unknown>).__TAURI__)
  );
}

/**
 * Create an engine. `auto` (default) prefers native (Tauri), then wasm, then
 * stub. Desktop callers should pass `'native'` and assert it resolved.
 */
export async function createEngine(preferred: Backend | 'auto' = 'auto'): Promise<Engine> {
  if (preferred === 'native' || (preferred === 'auto' && tauriInvokeAvailable())) {
    // The native IPC commands (render_frame_ir / hit_test) are wired when the
    // desktop editor integrates (task 0.9). Until then fall through to stub so
    // the facade is exercised everywhere.
    return stubEngine(); // TODO(0.9): return nativeEngine() backed by invoke().
  }
  if (preferred === 'wasm') {
    return stubEngine(); // TODO(0.7+): load the wasm-pack module dynamically.
  }
  return stubEngine();
}
