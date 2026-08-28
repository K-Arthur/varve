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
import {
  DEFAULT_ARTWORK_FONT_FAMILY,
  multiplyAffine,
  resolveTextGeometry,
  resolveTextGeometryMode,
  tryInvertAffine,
} from '@varve/shared';
import { hitTest } from './geometry';
import { transformPathShape } from './pathText';
import type { Backend, Engine, EngineFill, FillIR, RenderItem, Scene, SceneNode } from './types';
import type { WasmEngineModule } from './wasmLoader';
import { loadWasmEngineModule } from './wasmLoader';

/**
 * Derive a rect primitive from paint fills for shapeless nodes.
 * Mirrors the logic in @varve/scene/src/paint.ts deriveGeometryFromPaints
 * but operates on engine-level FillIRs.
 */
function derivePrimitiveFromPaints(node: SceneNode): import('./types').Primitive {
  // Check for image fills first — they define natural dimensions
  if (node.fills && node.fills.length > 0) {
    for (const f of node.fills) {
      if (!f.visible) continue;
      if (f.type === 'image' && f.image) {
        const w = f.image.imageWidth ?? 100;
        const h = f.image.imageHeight ?? 100;
        return { kind: 'rect', x: 0, y: 0, w, h };
      }
    }
  }
  // Default: 100×100 for non-image paints
  return { kind: 'rect', x: 0, y: 0, w: 100, h: 100 };
}

export type { Engine };

/** Resolve the path shape for a text node in path text mode. */
function resolvePathShape(
  node: SceneNode,
  nodeMap?: Map<string, SceneNode>,
): import('./types').Shape | undefined {
  if (node.kind !== 'text') return undefined;
  const settings = node.pathTextSettings;
  if (!settings || !nodeMap) return undefined;
  const pathNode = nodeMap.get(settings.pathNodeId);
  if (!pathNode) return undefined;
  if (!pathNode.shape) return undefined;
  const textInverse = tryInvertAffine(node.transform);
  if (!textInverse) return pathNode.shape;
  return transformPathShape(pathNode.shape, multiplyAffine(textInverse, pathNode.transform));
}

function shapeToPrimitive(
  node: SceneNode,
  nodeMap?: Map<string, SceneNode>,
): RenderItem['primitive'] {
  // Raster layer nodes produce a rasterLayer primitive from their tile data.
  if (node.kind === 'rasterLayer' && node.rasterLayerData) {
    return {
      kind: 'rasterLayer',
      width: node.rasterLayerData.width,
      height: node.rasterLayerData.height,
      pixelMode: node.rasterLayerData.pixelMode,
      tiles: node.rasterLayerData.tiles,
      layerId: node.id,
    };
  }
  if (node.kind === 'text' || (node.shape as { kind?: string } | undefined)?.kind === 'text') {
    const textShape =
      node.shape && 'text' in node.shape
        ? (node.shape as {
            text?: string;
            fontSize?: number;
            fontFamily?: string;
            fontWeight?: number;
            fontStyle?: string;
            w?: number;
            h?: number;
          })
        : null;
    const fontSize = node.fontSize ?? textShape?.fontSize ?? 14;
    const text = node.text ?? textShape?.text ?? '';
    const fontFamily = node.fontFamily ?? DEFAULT_ARTWORK_FONT_FAMILY;
    const explicitWidth = node.w ?? textShape?.w;
    const explicitHeight = node.h ?? textShape?.h;
    const geometry = resolveTextGeometry({
      text,
      w: explicitWidth,
      h: explicitHeight,
      fontSize,
      fontFamily,
      fontWeight: node.fontWeight ?? 400,
      fontStyle: (node.fontStyle as 'normal' | 'italic' | undefined) ?? 'normal',
      letterSpacing: node.letterSpacing,
      lineHeight: node.lineHeight,
      textMode: node.textMode ?? textShape?.textMode,
      textResizing: node.textResizing,
      richText: node.richText as never,
      variableAxes: node.variableAxes,
    });
    const geometryMode = resolveTextGeometryMode({
      text,
      w: explicitWidth,
      h: explicitHeight,
      textMode: node.textMode ?? textShape?.textMode,
      textResizing: node.textResizing,
    });
    const textMode =
      geometryMode === 'path' ? 'path' : geometryMode === 'autoWidth' ? 'point' : 'area';
    return {
      kind: 'text',
      x: 0,
      y: 0,
      w: Math.max(geometry.bounds.w, 1),
      h: Math.max(geometry.bounds.h, 1),
      text,
      fontSize,
      fontFamily: node.fontFamily ?? DEFAULT_ARTWORK_FONT_FAMILY,
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
      richText: node.richText,
      variableAxes: node.variableAxes,
      openTypeFeatures: node.openTypeFeatures,
      textMode,
      pathTextSettings: node.pathTextSettings,
      pathShape: resolvePathShape(node, nodeMap),
      direction: (node.direction as 'ltr' | 'rtl' | 'auto' | undefined) ?? 'auto',
      language: node.language,
      kerningMode: node.kerningMode,
      glyphAdjustments: node.glyphAdjustments,
      pairAdjustments: node.pairAdjustments,
    };
  }
  // V1.8+: shapeless nodes derive geometry from their paint
  // (e.g. an image's natural dimensions become the rect bounds)
  if ('shapeless' in node && node.shapeless === true) {
    return derivePrimitiveFromPaints(node);
  }
  const s = node.shape;
  if (!s) return { kind: 'rect', x: 0, y: 0, w: 100, h: 100 };
  // V2.15+: native tables arrive fully compiled (ADR-0016 D3).
  if (s.kind === 'table') {
    return s;
  }
  switch (s.kind) {
    case 'rect':
      return {
        kind: 'rect',
        x: s.x,
        y: s.y,
        w: s.w,
        h: s.h,
        ...(node.cornerRadius ? { cornerRadius: node.cornerRadius } : {}),
        ...(node.cornerSmoothing ? { cornerSmoothing: node.cornerSmoothing } : {}),
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
      return {
        kind: 'path',
        points: s.points,
        closed: s.closed,
        tolerance: s.tolerance,
        ...(s.holes && s.holes.length > 0 ? { holes: s.holes } : {}),
        ...(s.fillRule ? { fillRule: s.fillRule } : {}),
      };
  }
}

/** Pure-TS engine mirroring strata-engine::build_render_ir + strata-core::hit_test. */
function stubEngine(): Engine {
  return {
    backend: 'stub',
    async buildIr(scene) {
      const nodeMap = new Map<string, SceneNode>();
      for (const n of scene.nodes) nodeMap.set(n.id, n);
      return scene.nodes.map((n) => {
        const item: RenderItem = {
          transform: n.transform,
          fill: n.fill ?? { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
          primitive: shapeToPrimitive(n, nodeMap),
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
                    ...(s.midpoint !== undefined ? { midpoint: s.midpoint } : {}),
                  })),
                  rotation: f.gradient.rotation ?? 0,
                  // The engine receives resolved scene data for live editor
                  // renders. A missing field is therefore the historical
                  // Canvas2D encoded-sRGB behavior; new gradients are created
                  // with an explicit `document` setting by @varve/scene.
                  interpolationSpace: f.gradient.interpolationSpace ?? 'srgb',
                  hueInterpolation: f.gradient.hueInterpolation ?? 'shorter',
                  tilingMode: f.gradient.tilingMode ?? undefined,
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
                  fit: f.image.fit,
                  x: f.image.x,
                  y: f.image.y,
                  scale: f.image.scale,
                  imageWidth: f.image.imageWidth,
                  imageHeight: f.image.imageHeight,
                  crop: f.image.crop,
                  rotation: f.image.rotation,
                  flipH: f.image.flipH,
                  flipV: f.image.flipV,
                  opacity: f.opacity,
                  blendMode: f.blendMode,
                  visible: f.visible,
                  // Propagate node-level alpha mask (from background removal on shape nodes)
                  alphaMask: n.alphaMask,
                };
              }
              if (f.type === 'pattern' && f.pattern) {
                return {
                  type: 'pattern' as const,
                  tileSrc: f.pattern.tileSrc,
                  spacing: f.pattern.spacing,
                  rotation: f.pattern.rotation,
                  imageWidth: f.pattern.imageWidth,
                  imageHeight: f.pattern.imageHeight,
                  opacity: f.opacity,
                  blendMode: f.blendMode,
                  visible: f.visible,
                };
              }
              return null;
            })
            .filter((f): f is FillIR => f !== null);
        }
        // Phase 5: pass through filters from scene node to render item
        if (n.filters && n.filters.length > 0) {
          item.filters = n.filters;
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
 * Wrap a native/wasm engine so a `buildIr`/`hitTest` failure degrades to the
 * pure-TS stub instead of aborting the frame.
 *
 * The Rust deserializer (strata-bridge `IpcSceneNode`) is strict: every node
 * must carry a valid `shape`, and text needs `shape: { kind: 'text', … }`. A
 * single malformed node makes `build_ir_json` throw `missing field \`shape\``,
 * which rejects the whole batch and leaves the canvas blank for *every* node —
 * a catastrophic, whole-scene failure from one bad record. The stub is the
 * reference implementation and never throws, so falling back to it keeps the
 * scene painting while surfacing the contract violation via a single warning.
 */
export function withStubFallback(primary: Engine): Engine {
  if (primary.backend === 'stub') return primary;
  const stub = stubEngine();
  // The Rust/WASM backends currently carry the vector IR contract only. A
  // raster layer's tile payload is deliberately kept in the TypeScript
  // renderer, where replay can upload it to the retained tile surface. Route
  // scenes containing raster data through that reference implementation until
  // the native wire format grows an equivalent tile transport. Without this
  // guard a browser paint stroke reaches the document but the WASM compiler
  // silently turns the layer into a transparent rect (or drops it entirely).
  const requiresRasterFallback = (scene: Scene): boolean =>
    scene.nodes.some((node) => node.kind === 'rasterLayer' && node.rasterLayerData !== undefined);
  // Contract failures (missing/invalid `shape`, colour objects where Rust wants
  // `[u8; 4]`, …) are deterministic, not transient. Once `buildIr` throws, keep
  // using the stub so we don't burn a JSON round-trip through the failing
  // backend on every subsequent frame (circuit breaker).
  let buildIrBroken = false;
  const warnOnce = (err: unknown): void => {
    console.warn(
      `[strata-engine] ${primary.backend} buildIr failed; falling back to the stub renderer ` +
        'for the rest of this session. A node reached the engine with a shape/colour that the ' +
        'native deserializer rejects.',
      err,
    );
  };
  return {
    backend: primary.backend,
    async buildIr(scene) {
      if (requiresRasterFallback(scene)) return stub.buildIr(scene);
      if (buildIrBroken) return stub.buildIr(scene);
      try {
        return await primary.buildIr(scene);
      } catch (err) {
        buildIrBroken = true;
        warnOnce(err);
        return stub.buildIr(scene);
      }
    },
    async hitTest(scene, world) {
      try {
        return await primary.hitTest(scene, world);
      } catch {
        return stub.hitTest(scene, world);
      }
    },
  };
}

/**
 * Shape a loaded WASM module's raw exports into the `Engine` interface.
 * wasmLoader.ts only knows how to load raw exports (or fail); it has no
 * knowledge of `Engine` at all. This is the one place that connects the two.
 */
export function createWasmEngineFromModule(mod: WasmEngineModule): Engine {
  return {
    backend: 'wasm',
    async buildIr(scene) {
      const json = mod.build_ir_json(JSON.stringify(scene.nodes));
      return JSON.parse(json) as RenderItem[];
    },
    async hitTest(scene, world) {
      const idx = mod.hit_test_json(JSON.stringify(scene.nodes), world[0], world[1]);
      return idx >= 0 ? idx : null;
    },
  };
}

/**
 * Attempt to load and shape the WASM engine, falling back to `stubEngine` if
 * loading fails. This is the one place that decides what a WASM load failure
 * means (unsupported browser, CSP blocking the binary, network failure, a
 * corrupt build artifact, out-of-memory during instantiation) — surfaced as a
 * single console warning rather than failing silently.
 */
let wasmLoadFailureWarned = false;

export async function tryWasmEngine(stubEngineFactory: () => Engine): Promise<Engine> {
  const mod = await loadWasmEngineModule();
  if (!mod) {
    if (!wasmLoadFailureWarned) {
      wasmLoadFailureWarned = true;
      console.warn(
        '[strata-engine] WASM engine failed to load (unsupported browser, CSP blocking the ' +
          'WASM binary, network failure, or a corrupt build artifact); falling back to the ' +
          'pure-TS stub renderer for this session.',
      );
    }
    return stubEngineFactory();
  }
  return createWasmEngineFromModule(mod);
}

/**
 * Create an engine. `auto` (default) prefers native (Tauri), then wasm, then
 * stub. Desktop callers should pass `'native'` and assert it resolved.
 *
 * Native/wasm engines are wrapped with a stub fallback so a strict-deserializer
 * failure never blanks the canvas (see `withStubFallback`).
 */
export async function createEngine(preferred: Backend | 'auto' = 'auto'): Promise<Engine> {
  if (preferred === 'native') {
    return withStubFallback(await nativeEngine());
  }
  if (preferred === 'auto' && (globalThis as TauriGlobal).__TAURI__) {
    return withStubFallback(await nativeEngine());
  }
  if (preferred === 'wasm') {
    return withStubFallback(await tryWasmEngine(stubEngine));
  }
  if (preferred === 'auto' && !(globalThis as TauriGlobal).__TAURI__) {
    const eng = await tryWasmEngine(stubEngine);
    if (eng.backend === 'wasm') return withStubFallback(eng);
  }
  return stubEngine();
}

/**
 * Apply resolved style overrides to a scene node.
 * Returns a new node with overrides merged in (no mutation).
 * This is the wiring point for `resolveAllStyles` from @varve/scene.
 *
 * Usage:
 *   const resolved = resolveAllStyles(doc);
 *   const mergedNodes = flatNodes.map(n =>
 *     applyStyleOverrides(n, resolved.get(n.id))
 *   );
 *   const ir = await eng.buildIr({ nodes: mergedNodes });
 */
export function applyStyleOverrides(
  node: SceneNode,
  overrides: Record<string, unknown> | undefined,
): SceneNode {
  if (!overrides) return node;
  return { ...node, ...overrides };
}
