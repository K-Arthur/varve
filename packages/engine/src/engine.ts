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
import type { Backend, EngineFill, FillIR, Point, RenderItem, Scene, SceneNode } from './types';

export interface Engine {
  readonly backend: Backend;
  /** Build the render IR for a scene (crosses the IPC boundary on native/wasm). */
  buildIr(scene: Scene): Promise<RenderItem[]>;
  /** Hit-test a world-space point; returns the topmost node index or null.
   * Done locally (no round-trip) — the webview owns picking. */
  hitTest(scene: Scene, world: Point): Promise<number | null>;
}

function shapeToPrimitive(node: SceneNode): RenderItem['primitive'] {
  if (node.kind === 'image') {
    return { kind: 'image', w: node.w ?? 100, h: node.h ?? 100, src: node.src ?? '' };
  }
  if (node.kind === 'text') {
    const fontSize = node.fontSize ?? 14;
    return {
      kind: 'text',
      x: 0,
      y: 0,
      w: fontSize * 6,
      h: fontSize * 1.4,
      text: node.text ?? '',
      fontSize,
      fontFamily: node.fontFamily ?? 'sans-serif',
      fontWeight: node.fontWeight ?? 400,
      fontStyle: (node.fontStyle as 'normal' | 'italic' | undefined) ?? 'normal',
      textAlign: (node.textAlign as 'left' | 'center' | 'right' | 'justify' | undefined) ?? 'left',
      textAlignVertical:
        (node.textAlignVertical as 'top' | 'middle' | 'bottom' | undefined) ?? 'top',
      letterSpacing: node.letterSpacing ?? 0,
      lineHeight: node.lineHeight ?? 1.4,
      paragraphSpacing: node.paragraphSpacing ?? 0,
      textCase:
        (node.textCase as 'none' | 'uppercase' | 'lowercase' | 'capitalize' | undefined) ?? 'none',
      textDecoration:
        (node.textDecoration as 'none' | 'underline' | 'line-through' | undefined) ?? 'none',
      textOverflow: (node.textOverflow as 'clip' | 'ellipsis' | 'visible' | undefined) ?? 'visible',
      listStyle:
        (node.listStyle as 'none' | 'disc' | 'decimal' | 'circle' | 'square' | undefined) ?? 'none',
    };
  }
  const s = node.shape;
  if (!s) return { kind: 'rect', x: 0, y: 0, w: 100, h: 100 };
  switch (s.kind) {
    case 'rect':
      return {
        kind: 'rect',
        x: s.x,
        y: s.y,
        w: s.w,
        h: s.h,
        ...(node.cornerRadius ? { cornerRadius: node.cornerRadius } : {}),
      };
    case 'ellipse':
      return { kind: 'ellipse', cx: s.cx, cy: s.cy, rx: s.rx, ry: s.ry };
    case 'circle':
      return { kind: 'circle', cx: s.cx, cy: s.cy, r: s.r };
    case 'line':
      return { kind: 'line', from: s.from, to: s.to, tolerance: s.tolerance };
    case 'polygon':
      return {
        kind: 'polygon',
        cx: s.cx,
        cy: s.cy,
        radius: s.radius,
        sides: s.sides,
        rotation: s.rotation,
      };
    case 'star':
      return {
        kind: 'star',
        cx: s.cx,
        cy: s.cy,
        innerRadius: s.innerRadius,
        outerRadius: s.outerRadius,
        points: s.points,
        rotation: s.rotation,
      };
    case 'arrow':
      return {
        kind: 'arrow',
        from: s.from,
        to: s.to,
        tolerance: s.tolerance,
        arrowheadSize: s.arrowheadSize,
      };
    case 'path':
      return { kind: 'path', points: s.points, closed: s.closed, tolerance: s.tolerance };
  }
}

/** Pure-TS engine mirroring strata-engine::build_render_ir + strata-core::hit_test. */
function stubEngine(): Engine {
  return {
    backend: 'stub',
    async buildIr(scene) {
      return scene.nodes.map((n) => {
        const item: RenderItem = {
          transform: n.transform,
          fill: n.fill ?? ([0, 0, 0, 0] as [number, number, number, number]),
          primitive: shapeToPrimitive(n),
          opacity: n.opacity ?? 1,
          blendMode: n.blendMode ?? 'normal',
          strokes: n.strokes ?? [],
          effects: n.effects ?? [],
        };
        // P2: populate fills stack if present
        if (n.fills && n.fills.length > 0) {
          item.fills = n.fills
            .filter((f: EngineFill) => f.visible)
            .map((f: EngineFill): FillIR | null => {
              if (f.type === 'solid' && f.color) {
                return {
                  type: 'solid' as const,
                  color: f.color,
                  opacity: f.opacity,
                  blendMode: f.blendMode,
                  visible: f.visible,
                };
              }
              if (f.type === 'gradient' && f.gradient) {
                const result: FillIR = {
                  type: 'gradient' as const,
                  gradientType: f.gradient.type,
                  stops: f.gradient.stops.map((s) => ({
                    position: s.position,
                    color: s.color,
                  })),
                  rotation: f.gradient.rotation ?? 0,
                  opacity: f.opacity,
                  blendMode: f.blendMode,
                  visible: f.visible,
                };
                if (f.gradient.transform) {
                  (result as Record<string, unknown>).transform = f.gradient.transform;
                }
                return result;
              }
              if (f.type === 'image' && f.image) {
                return {
                  type: 'image' as const,
                  src: f.image.src,
                  fit: (f.image.fit as 'fill' | 'fit' | 'stretch' | 'tile') ?? 'fill',
                  x: f.image.x ?? 0,
                  y: f.image.y ?? 0,
                  scale: f.image.scale ?? 1,
                  opacity: f.opacity,
                  blendMode: f.blendMode,
                  visible: f.visible,
                };
              }
              if (f.type === 'pattern' && f.pattern) {
                return {
                  type: 'pattern' as const,
                  tileSrc: f.pattern.tileSrc,
                  spacing: f.pattern.spacing ?? 0,
                  rotation: f.pattern.rotation ?? 0,
                  opacity: f.opacity,
                  blendMode: f.blendMode,
                  visible: f.visible,
                };
              }
              return null;
            })
            .filter((f): f is FillIR => f !== null);
        }
        return item;
      });
    },
    async hitTest(scene, world) {
      return hitTest(scene.nodes, world);
    },
  };
}

type TauriCore = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
interface TauriGlobal {
  __TAURI__?: { core: TauriCore };
}

async function nativeEngine(): Promise<Engine> {
  const tauri = (globalThis as TauriGlobal).__TAURI__;
  if (!tauri?.core) return stubEngine();
  return {
    backend: 'native',
    async buildIr(scene) {
      const items = await tauri.core.invoke('build_render_ir', { nodes: scene.nodes });
      return items as RenderItem[];
    },
    async hitTest(scene, world) {
      const idx = await tauri.core.invoke('hit_test', {
        nodes: scene.nodes,
        x: world[0],
        y: world[1],
      });
      return idx as number | null;
    },
  };
}

/**
 * Create an engine. `auto` (default) prefers native (Tauri), then wasm, then
 * stub. Desktop callers should pass `'native'` and assert it resolved.
 */
export async function createEngine(preferred: Backend | 'auto' = 'auto'): Promise<Engine> {
  if (preferred === 'native') {
    return nativeEngine();
  }
  if (preferred === 'auto' && (globalThis as TauriGlobal).__TAURI__) {
    return nativeEngine();
  }
  if (preferred === 'wasm') {
    return stubEngine(); // TODO(0.7+): load the wasm-pack module dynamically.
  }
  return stubEngine();
}
