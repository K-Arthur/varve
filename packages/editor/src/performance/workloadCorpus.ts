import {
  addMask,
  createDocument,
  type Document,
  type Effect,
  makeFrameNode,
  makeGroupNode,
  makeImageShapeNode,
  makePathNode,
  makeRasterLayerNode,
  makeShapeNode,
  makeTextNode,
  type Page,
  type SceneNode,
} from '@varve/scene';

export const PERFORMANCE_WORKLOAD_VERSION = 2 as const;

export type PerformanceWorkloadId =
  | 'small'
  | 'vector-100'
  | 'vector-500'
  | 'vector-1k'
  | 'vector-5k'
  | 'flat-10k'
  | 'deep-nesting'
  | 'dense-overlap'
  | 'wide-spread'
  | 'many-small'
  | 'few-large'
  | 'clipped-frames'
  | 'masked-content'
  | 'rotated-skewed'
  | 'thick-strokes'
  | 'effects-heavy'
  | 'blend-modes'
  | 'raster-heavy'
  | 'mixed-raster-vector'
  | 'hidden-locked'
  | 'offscreen-mixed'
  | 'boundary-crossing'
  | 'multi-page'
  | 'vector-heavy'
  | 'text-heavy'
  | 'effects-masks'
  | 'rapid-brush'
  | 'paint-raster-lod'
  | 'motion'
  | 'extreme-zoom'
  | 'document-switching'
  /**
   * These fixtures deliberately stay out of the default corpus because they
   * are intended for the camera-scaling benchmark, not every unit-test run.
   * They are created explicitly through `PERFORMANCE_STRESS_WORKLOAD_IDS`.
   */
  | 'viewport-1k'
  | 'viewport-10k'
  | 'viewport-100k';

export interface WorkloadPointerSample {
  x: number;
  y: number;
  pressure: number;
  timeOffsetMs: number;
}

export interface WorkloadViewport {
  pan: { x: number; y: number };
  zoom: number;
  rotation: number;
}

export interface PerformanceWorkload {
  id: PerformanceWorkloadId;
  version: typeof PERFORMANCE_WORKLOAD_VERSION;
  document: Document;
  fixtureChecksum: string;
  pointerSamples?: WorkloadPointerSample[];
  viewports?: readonly WorkloadViewport[];
  documentSequence?: Document[];
  expected: {
    nodeCount: number;
    /** Number of nodes intentionally placed in the initial origin viewport. */
    visibleNodeCount?: number;
    decodedImageBytes?: number;
    pointerSampleCount?: number;
    rasterTileCount?: number;
  };
}

function appendNodes(
  document: Document,
  nodes: SceneNode[],
  rootChildren = nodes.map((n) => n.id),
) {
  const nextNodes = { ...document.nodes };
  for (const node of nodes) nextNodes[node.id] = node;
  return {
    ...document,
    nodes: nextNodes,
    rootChildren: [...document.rootChildren, ...rootChildren],
  };
}

function workloadDocument(name: string): Document {
  return { ...createDocument(name, true), id: `perf-${name}` };
}

function checksum(value: unknown): string {
  const serialized = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index++) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function finish(
  id: PerformanceWorkloadId,
  document: Document,
  extras: Omit<
    PerformanceWorkload,
    'id' | 'version' | 'document' | 'fixtureChecksum' | 'expected'
  > & {
    expected?: Omit<PerformanceWorkload['expected'], 'nodeCount'>;
  } = {},
): PerformanceWorkload {
  const { expected, ...rest } = extras;
  const checksumInput = { document, ...rest };
  return {
    id,
    version: PERFORMANCE_WORKLOAD_VERSION,
    document,
    fixtureChecksum: checksum(checksumInput),
    ...rest,
    expected: { nodeCount: Object.keys(document.nodes).length, ...expected },
  };
}

function gridShapes(id: string, count: number): Document {
  const document = workloadDocument(id);
  const nodes: SceneNode[] = [];
  for (let index = 0; index < count; index++) {
    nodes.push(
      makeShapeNode(
        `${id}-${index}`,
        { kind: 'rect', x: 0, y: 0, w: 24, h: 24 },
        { transform: [1, 0, 0, 1, (index % 200) * 32, Math.floor(index / 200) * 32] },
      ),
    );
  }
  return appendNodes(document, nodes);
}

function small(): PerformanceWorkload {
  const document = gridShapes('small', 24);
  return finish('small', document);
}

function flat10k(): PerformanceWorkload {
  return finish('flat-10k', gridShapes('flat', 10_000));
}

/** Simple spread vector fixture at a named scale — the dirty-pruning bench. */
function vectorScale(id: PerformanceWorkloadId, count: number, spacing = 140): PerformanceWorkload {
  const nodes: SceneNode[] = [];
  const cols = Math.ceil(Math.sqrt(count * 1.6));
  for (let index = 0; index < count; index++) {
    nodes.push(
      makeShapeNode(
        `${id}-${index}`,
        { kind: 'rect', x: 0, y: 0, w: 64, h: 48 },
        {
          transform: [1, 0, 0, 1, (index % cols) * spacing, Math.floor(index / cols) * spacing],
        },
      ),
    );
  }
  return finish(id, appendNodes(workloadDocument(id), nodes));
}

function vector100(): PerformanceWorkload {
  return vectorScale('vector-100', 100);
}

function vector500(): PerformanceWorkload {
  return vectorScale('vector-500', 500);
}

function vector1k(): PerformanceWorkload {
  return vectorScale('vector-1k', 1_000);
}

function vector5k(): PerformanceWorkload {
  return vectorScale('vector-5k', 5_000);
}

/**
 * A camera-scaling fixture: exactly 100 nodes begin in the origin viewport;
 * every remaining node is placed in distant positive and negative clusters.
 *
 * It is intentionally flat. That makes any proportional growth in a camera
 * frame attributable to the render/culling path rather than recursive group
 * structure, and lets the benchmark compare 1k / 10k / 100k total nodes at
 * a fixed visible complexity. The stress fixtures are opt-in because building
 * and checksumming 100k immutable scene nodes is itself substantial work.
 */
function viewportComplexity(
  id: Extract<PerformanceWorkloadId, 'viewport-1k' | 'viewport-10k' | 'viewport-100k'>,
  count: number,
): PerformanceWorkload {
  const visibleCount = 100;
  const nodes: SceneNode[] = [];
  for (let index = 0; index < count; index++) {
    const visible = index < visibleCount;
    const clusterIndex = index - visibleCount;
    const clusterSign = clusterIndex % 2 === 0 ? 1 : -1;
    const x = visible ? (index % 10) * 72 : clusterSign * (2_000_000 + (clusterIndex % 500) * 120);
    const y = visible
      ? Math.floor(index / 10) * 72
      : clusterSign * (1_500_000 + Math.floor(clusterIndex / 500) * 120);
    nodes.push(
      makeShapeNode(
        `${id}-${index}`,
        { kind: 'rect', x: 0, y: 0, w: 48, h: 48 },
        { transform: [1, 0, 0, 1, x, y] },
      ),
    );
  }
  return finish(id, appendNodes(workloadDocument(id), nodes), {
    expected: { visibleNodeCount: visibleCount },
  });
}

function viewport1k(): PerformanceWorkload {
  return viewportComplexity('viewport-1k', 1_000);
}

function viewport10k(): PerformanceWorkload {
  return viewportComplexity('viewport-10k', 10_000);
}

function viewport100k(): PerformanceWorkload {
  return viewportComplexity('viewport-100k', 100_000);
}

function denseOverlap(): PerformanceWorkload {
  const nodes: SceneNode[] = [];
  for (let index = 0; index < 300; index++) {
    nodes.push(
      makeShapeNode(
        `dense-${index}`,
        { kind: 'rect', x: 0, y: 0, w: 120, h: 120 },
        {
          transform: [1, 0, 0, 1, (index % 15) * 24, Math.floor(index / 15) * 24],
          fill: { space: 'rgb', r: (index * 7) % 255, g: 90, b: 160, a: 180 },
        },
      ),
    );
  }
  return finish('dense-overlap', appendNodes(workloadDocument('dense-overlap'), nodes));
}

function wideSpread(): PerformanceWorkload {
  const nodes: SceneNode[] = [];
  for (let index = 0; index < 400; index++) {
    const col = index % 40;
    const row = Math.floor(index / 40);
    nodes.push(
      makeShapeNode(
        `spread-${index}`,
        { kind: 'ellipse', cx: 0, cy: 0, rx: 18, ry: 18 },
        { transform: [1, 0, 0, 1, col * 700, row * 700] },
      ),
    );
  }
  return finish('wide-spread', appendNodes(workloadDocument('wide-spread'), nodes));
}

function manySmall(): PerformanceWorkload {
  const nodes: SceneNode[] = [];
  for (let index = 0; index < 1_000; index++) {
    nodes.push(
      makeShapeNode(
        `many-small-${index}`,
        { kind: 'rect', x: 0, y: 0, w: 8, h: 8 },
        { transform: [1, 0, 0, 1, (index % 50) * 12, Math.floor(index / 50) * 12] },
      ),
    );
  }
  return finish('many-small', appendNodes(workloadDocument('many-small'), nodes));
}

function fewLarge(): PerformanceWorkload {
  const nodes: SceneNode[] = [];
  for (let index = 0; index < 8; index++) {
    nodes.push(
      makeShapeNode(
        `few-large-${index}`,
        { kind: 'rect', x: 0, y: 0, w: 3000, h: 3000 },
        { transform: [1, 0, 0, 1, (index % 4) * 4200, Math.floor(index / 4) * 4200] },
      ),
    );
  }
  return finish('few-large', appendNodes(workloadDocument('few-large'), nodes));
}

function clippedFrames(): PerformanceWorkload {
  const nodes: SceneNode[] = [];
  const roots: string[] = [];
  for (let index = 0; index < 80; index++) {
    const frameId = `clip-frame-${index}`;
    const childId = `clip-child-${index}`;
    roots.push(frameId);
    nodes.push(
      makeFrameNode(frameId, {
        w: 160,
        h: 120,
        children: [childId],
        transform: [1, 0, 0, 1, (index % 10) * 180, Math.floor(index / 10) * 160],
      }),
      makeShapeNode(childId, { kind: 'rect', x: -80, y: -60, w: 320, h: 240 }),
    );
  }
  return finish('clipped-frames', appendNodes(workloadDocument('clipped-frames'), nodes, roots));
}

function maskedContent(): PerformanceWorkload {
  let document = workloadDocument('masked-content');
  const nodes: SceneNode[] = [];
  const roots: string[] = [];
  for (let index = 0; index < 40; index++) {
    const frameId = `mask-frame-${index}`;
    const childId = `mask-child-${index}`;
    const maskId = `mask-src-${index}`;
    roots.push(frameId);
    nodes.push(
      makeFrameNode(frameId, {
        w: 200,
        h: 200,
        children: [childId, maskId],
        transform: [1, 0, 0, 1, (index % 8) * 240, Math.floor(index / 8) * 240],
      }),
      makeShapeNode(childId, { kind: 'rect', x: 0, y: 0, w: 200, h: 200 }),
      makeShapeNode(
        maskId,
        { kind: 'ellipse', cx: 100, cy: 100, rx: 90 + index, ry: 90 },
        { rotation: index * 11 },
      ),
    );
  }
  document = appendNodes(document, nodes, roots);
  for (let index = 0; index < 40; index++) {
    document = addMask(document, `mask-frame-${index}`, `mask-src-${index}`, 'alpha');
  }
  return finish('masked-content', document);
}

function rotatedSkewed(): PerformanceWorkload {
  const nodes: SceneNode[] = [];
  for (let index = 0; index < 200; index++) {
    const skewX = 0.15 + (index % 3) * 0.1;
    nodes.push(
      makeShapeNode(
        `rot-${index}`,
        { kind: 'rect', x: 0, y: 0, w: 90, h: 60 },
        {
          rotation: (index * 37) % 360,
          transform: [1, skewX, 0, 1, (index % 14) * 130, Math.floor(index / 14) * 130],
        },
      ),
    );
  }
  return finish('rotated-skewed', appendNodes(workloadDocument('rotated-skewed'), nodes));
}

function thickStrokes(): PerformanceWorkload {
  const nodes: SceneNode[] = [];
  for (let index = 0; index < 64; index++) {
    nodes.push(
      makePathNode(`stroke-path-${index}`, {
        closed: index % 2 === 0,
        transform: [1, 0, 0, 1, (index % 8) * 240, Math.floor(index / 8) * 240],
        points: [
          { x: 20, y: 120, handleIn: null, handleOut: null },
          { x: 60, y: 20, handleIn: null, handleOut: null },
          { x: 140, y: 160, handleIn: null, handleOut: null },
          { x: 180, y: 60, handleIn: null, handleOut: null },
        ],
        strokes: [
          {
            color: { space: 'rgb', r: 20 + index, g: 120, b: 200, a: 255 },
            weight: 18 + (index % 5) * 8,
            align: 'center',
            dashPattern: [],
            dashOffset: 0,
            cap: 'round',
            join: 'miter',
            miterLimit: 8,
            visible: true,
            arrowStart: index % 3 === 0 ? 'arrow' : 'none',
            arrowEnd: index % 3 === 1 ? 'diamond' : 'none',
          },
        ],
      }),
    );
  }
  return finish('thick-strokes', appendNodes(workloadDocument('thick-strokes'), nodes));
}

function effectsHeavy(): PerformanceWorkload {
  const nodes: SceneNode[] = [];
  for (let index = 0; index < 150; index++) {
    const effects: Effect[] = [];
    effects.push({
      type: 'dropShadow',
      x: 8,
      y: 10,
      blur: 24 + (index % 20),
      spread: 4,
      color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      opacity: 0.5,
      blendMode: 'normal',
      visible: true,
    });
    if (index % 3 === 0) {
      effects.push({ type: 'layerBlur', radius: 2 + (index % 6), visible: true });
    }
    if (index % 4 === 0) {
      effects.push({
        type: 'outerGlow',
        blur: 18,
        spread: 2,
        color: { space: 'rgb', r: 255, g: 120, b: 40, a: 255 },
        opacity: 0.7,
        blendMode: 'normal',
        visible: true,
      });
    }
    nodes.push(
      makeShapeNode(
        `fx-${index}`,
        { kind: 'rect', x: 0, y: 0, w: 140, h: 100 },
        {
          transform: [1, 0, 0, 1, (index % 12) * 160, Math.floor(index / 12) * 140],
          effects,
        },
      ),
    );
  }
  return finish('effects-heavy', appendNodes(workloadDocument('effects-heavy'), nodes));
}

function blendModes(): PerformanceWorkload {
  const modes = [
    'multiply',
    'screen',
    'darken',
    'lighten',
    'overlay',
    'colorBurn',
    'difference',
  ] as const;
  const nodes: SceneNode[] = [];
  for (let index = 0; index < 240; index++) {
    nodes.push(
      makeShapeNode(
        `blend-${index}`,
        { kind: 'ellipse', cx: 0, cy: 0, rx: 60, ry: 60 },
        {
          blendMode: modes[index % modes.length]!,
          transform: [1, 0, 0, 1, (index % 12) * 130 + 40, Math.floor(index / 12) * 130 + 40],
          fill: { space: 'rgb', r: (index * 13) % 255, g: 70, b: 200, a: 200 },
        },
      ),
    );
  }
  return finish('blend-modes', appendNodes(workloadDocument('blend-modes'), nodes));
}

function mixedRasterVector(): PerformanceWorkload {
  const images = Array.from({ length: 24 }, (_, index) =>
    makeImageShapeNode(`mix-image-${index}`, {
      src: `asset://mix-${index}.png`,
      imageWidth: 1024,
      imageHeight: 1024,
      w: 300,
      h: 300,
      transform: [1, 0, 0, 1, (index % 6) * 340, Math.floor(index / 6) * 340],
    }),
  );
  const vectors = Array.from({ length: 200 }, (_, index) =>
    makeShapeNode(
      `mix-vec-${index}`,
      { kind: 'rect', x: 0, y: 0, w: 60, h: 40 },
      { transform: [1, 0, 0, 1, (index % 12) * 160 + 60, Math.floor(index / 12) * 140 + 60] },
    ),
  );
  return finish(
    'mixed-raster-vector',
    appendNodes(workloadDocument('mixed-raster-vector'), [...images, ...vectors]),
  );
}

function hiddenLocked(): PerformanceWorkload {
  const nodes: SceneNode[] = [];
  for (let index = 0; index < 400; index++) {
    nodes.push(
      makeShapeNode(
        `hl-${index}`,
        { kind: 'rect', x: 0, y: 0, w: 70, h: 50 },
        {
          transform: [1, 0, 0, 1, (index % 20) * 90, Math.floor(index / 20) * 80],
          visible: index % 4 !== 0,
          locked: index % 8 === 0,
        },
      ),
    );
  }
  return finish('hidden-locked', appendNodes(workloadDocument('hidden-locked'), nodes));
}

function offscreenMixed(): PerformanceWorkload {
  const nodes: SceneNode[] = [];
  for (let index = 0; index < 300; index++) {
    const offscreen = index % 2 === 0;
    nodes.push(
      makeShapeNode(
        `off-${index}`,
        { kind: 'rect', x: 0, y: 0, w: 80, h: 60 },
        {
          transform: [
            1,
            0,
            0,
            1,
            (index % 15) * 110,
            offscreen ? -4000 + (index % 3) * 40 : Math.floor(index / 15) * 90,
          ],
        },
      ),
    );
  }
  return finish('offscreen-mixed', appendNodes(workloadDocument('offscreen-mixed'), nodes));
}

function boundaryCrossing(): PerformanceWorkload {
  const nodes: SceneNode[] = [];
  const positions = [
    [-140, 60],
    [-90, -110],
    [20, -80],
    [1380, 60],
    [1440, 860],
    [1350, -120],
    [-60, 840],
    [1360, 40],
  ] as const;
  for (let index = 0; index < 160; index++) {
    const [ox, oy] = positions[index % positions.length]!;
    nodes.push(
      makeShapeNode(
        `bc-${index}`,
        { kind: 'rect', x: 0, y: 0, w: 160, h: 120 },
        { transform: [1, 0, 0, 1, ox + (index % 8) * 220, oy + Math.floor(index / 8) * 140] },
      ),
    );
  }
  return finish('boundary-crossing', appendNodes(workloadDocument('boundary-crossing'), nodes));
}

function multiPage(): PerformanceWorkload {
  const nodes: SceneNode[] = [];
  const roots: string[] = [];
  const pages: Page[] = [];
  for (let page = 0; page < 3; page++) {
    const rootId = `multipage-root-${page}`;
    const childIds: string[] = [];
    for (let index = 0; index < 60; index++) {
      const id = `multipage-${page}-${index}`;
      childIds.push(id);
      nodes.push(
        makeShapeNode(
          id,
          { kind: 'rect', x: 0, y: 0, w: 60, h: 40 },
          { transform: [1, 0, 0, 1, (index % 10) * 90, Math.floor(index / 10) * 70] },
        ),
      );
    }
    nodes.push(makeGroupNode(rootId, { name: `Page ${page + 1} content`, children: childIds }));
    roots.push(rootId);
    pages.push({
      id: `multipage-page-${page}`,
      name: `Page ${page + 1}`,
      order: `p${page}`,
      width: 960,
      height: 600,
      backgrounds: [],
      contentRoot: rootId,
    });
  }
  const document = {
    ...appendNodes(workloadDocument('multi-page'), nodes, roots),
    activePageId: 'multipage-page-0',
    pages,
  } as Document;
  return finish('multi-page', document);
}

function deepNesting(): PerformanceWorkload {
  let document = workloadDocument('deep-nesting');
  const nodes: SceneNode[] = [];
  const depth = 128;
  for (let index = 0; index < depth; index++) {
    nodes.push(
      makeFrameNode(`frame-${index}`, {
        name: `Nested frame ${index}`,
        w: 2048 - index * 4,
        h: 2048 - index * 4,
        transform: [1, 0, 0, 1, 2, 2],
        children: index === depth - 1 ? ['deep-leaf'] : [`frame-${index + 1}`],
      }),
    );
  }
  nodes.push(makeShapeNode('deep-leaf', { kind: 'ellipse', cx: 32, cy: 32, rx: 32, ry: 32 }));
  document = appendNodes(document, nodes, ['frame-0']);
  return finish('deep-nesting', document);
}

/**
 * Deterministic pattern for a paint-raster tile (brief §53/§54 corpus): the
 * absolute-coordinate functions place hard content ON tile boundaries —
 * a 32px checkerboard, 1px lines at every 128px (the tile grid), a diagonal
 * every 256px, a horizontal gradient, and a semi-transparent band. The
 * visual seam corpus screenshots this at low zoom and asserts no hairline
 * discontinuities where tiles meet.
 */
function rasterLodTilePixels(
  pixels: Uint8ClampedArray,
  tileSize: number,
  col: number,
  row: number,
): void {
  for (let ty = 0; ty < tileSize; ty++) {
    for (let tx = 0; tx < tileSize; tx++) {
      const x = col * tileSize + tx;
      const y = row * tileSize + ty;
      const i = (ty * tileSize + tx) * 4;
      if (x % 128 === 0 || y % 128 === 0) {
        // Hairline on the tile grid: the seam probe's worst case.
        pixels[i] = 255;
        pixels[i + 1] = 0;
        pixels[i + 2] = 0;
        pixels[i + 3] = 255;
        continue;
      }
      if ((x + y) % 256 === 0 || (x - y) % 256 === 0) {
        // 45-degree diagonals crossing boundaries.
        pixels[i] = 0;
        pixels[i + 1] = 255;
        pixels[i + 2] = 0;
        pixels[i + 3] = 255;
        continue;
      }
      if (y > 1024 && y < 1152) {
        // Semi-transparent band: alpha-downsampling probe.
        pixels[i] = 255;
        pixels[i + 1] = 255;
        pixels[i + 2] = 0;
        pixels[i + 3] = 128;
        continue;
      }
      const check = ((x >> 5) + (y >> 5)) & 1;
      pixels[i] = check ? 200 : 40;
      pixels[i + 1] = check ? 60 : 40;
      pixels[i + 2] = check ? 60 : 200;
      pixels[i + 3] = 255;
    }
  }
}

function paintRasterLod(): PerformanceWorkload {
  // An 8192x8192 sparse paint layer whose content lives in a dense
  // 2048x2048 block at the origin. At 25% zoom on a 1440x900 viewport the
  // visible fraction is ~0.31 — the pyramid crossover engages at L2 with
  // 4x minification, exactly the seam-stress regime.
  const layer = makeRasterLayerNode('raster-lod-1', {
    width: 8192,
    height: 8192,
  });
  for (let row = 0; row < 16; row++) {
    for (let col = 0; col < 16; col++) {
      const pixels = new Uint8ClampedArray(128 * 128 * 4);
      rasterLodTilePixels(pixels, 128, col, row);
      layer.tiles.set(`${col}:${row}`, { pixels, version: 1 });
    }
  }
  const document = appendNodes(workloadDocument('paint-raster-lod'), [layer]);
  return finish('paint-raster-lod', document, {
    expected: {
      decodedImageBytes: 0,
      rasterTileCount: 256,
    },
  });
}

function rasterHeavy(): PerformanceWorkload {
  const imageCount = 48;
  const dimension = 4096;
  const document = appendNodes(
    workloadDocument('raster-heavy'),
    Array.from({ length: imageCount }, (_, index) =>
      makeImageShapeNode(`raster-${index}`, {
        src: `asset://raster-${index}.png`,
        imageWidth: dimension,
        imageHeight: dimension,
        w: 512,
        h: 512,
        transform: [1, 0, 0, 1, (index % 8) * 520, Math.floor(index / 8) * 520],
      }),
    ),
  );
  return finish('raster-heavy', document, {
    expected: { decodedImageBytes: imageCount * dimension * dimension * 4 },
  });
}

function vectorHeavy(): PerformanceWorkload {
  const nodes = Array.from({ length: 256 }, (_, pathIndex) =>
    makePathNode(`path-${pathIndex}`, {
      closed: true,
      transform: [1, 0, 0, 1, (pathIndex % 16) * 180, Math.floor(pathIndex / 16) * 180],
      points: Array.from({ length: 128 }, (_, pointIndex) => {
        const angle = (pointIndex / 128) * Math.PI * 2;
        const radius = 40 + ((pointIndex * 17 + pathIndex * 13) % 45);
        return {
          x: 90 + Math.cos(angle) * radius,
          y: 90 + Math.sin(angle) * radius,
          handleIn: null,
          handleOut: null,
        };
      }),
    }),
  );
  return finish('vector-heavy', appendNodes(workloadDocument('vector-heavy'), nodes));
}

function textHeavy(): PerformanceWorkload {
  const paragraph = 'Strata typography العربية 日本語 हिन्दी office ffi 0123456789';
  const nodes = Array.from({ length: 600 }, (_, index) =>
    makeTextNode(`text-${index}`, `${paragraph} — paragraph ${index}`, {
      w: 640,
      h: 72,
      fontSize: 18 + (index % 5),
      transform: [1, 0, 0, 1, (index % 4) * 660, Math.floor(index / 4) * 80],
    }),
  );
  return finish('text-heavy', appendNodes(workloadDocument('text-heavy'), nodes));
}

function effectsMasks(): PerformanceWorkload {
  let document = workloadDocument('effects-masks');
  const nodes: SceneNode[] = [];
  for (let index = 0; index < 120; index++) {
    const frameId = `effect-frame-${index}`;
    const shapeId = `effect-shape-${index}`;
    nodes.push(
      makeFrameNode(frameId, {
        w: 180,
        h: 180,
        children: [shapeId],
        transform: [1, 0, 0, 1, (index % 12) * 200, Math.floor(index / 12) * 200],
        effects: [
          { type: 'layerBlur', radius: 4 + (index % 12), visible: true },
          {
            type: 'dropShadow',
            x: 6,
            y: 8,
            blur: 18,
            spread: 2,
            color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
            opacity: 0.45,
            blendMode: 'normal',
            visible: true,
          },
        ],
      }),
      makeShapeNode(shapeId, { kind: 'rect', x: 0, y: 0, w: 180, h: 180 }),
    );
  }
  document = appendNodes(
    document,
    nodes,
    Array.from({ length: 120 }, (_, index) => `effect-frame-${index}`),
  );
  for (let index = 0; index < 120; index++) {
    document = addMask(document, `effect-frame-${index}`, undefined, 'clip', {
      vectorMask: {
        points: [
          { x: 0, y: 0, handleIn: null, handleOut: null },
          { x: 180, y: 0, handleIn: null, handleOut: null },
          { x: 90, y: 180, handleIn: null, handleOut: null },
        ],
        closed: true,
        fillRule: 'nonzero',
      },
    });
  }
  return finish('effects-masks', document);
}

function rapidBrush(): PerformanceWorkload {
  const pointerSamples = Array.from({ length: 4_096 }, (_, index) => ({
    x: index * 0.7,
    y: 240 + Math.sin(index / 17) * 120,
    pressure: 0.15 + ((index * 37) % 850) / 1_000,
    timeOffsetMs: index * 2,
  }));
  return finish('rapid-brush', gridShapes('brush-background', 50), {
    pointerSamples,
    expected: { pointerSampleCount: pointerSamples.length },
  });
}

function motion(): PerformanceWorkload {
  const document = gridShapes('motion', 240);
  document.timelines = {
    'timeline-main': {
      id: 'timeline-main',
      name: 'Corpus motion',
      duration: 10_000,
      defaultEasing: { kind: 'linear' },
      tracks: Array.from({ length: 240 }, (_, index) => ({
        id: `track-${index}`,
        nodeId: `motion-${index}`,
        property: index % 2 === 0 ? 'opacity' : 'rotation',
        interpolation: 'linear' as const,
        enabled: true,
        keyframes: [
          { progress: 0, value: index % 2 === 0 ? 0.2 : 0 },
          { progress: 0.5, value: index % 2 === 0 ? 1 : 180 },
          { progress: 1, value: index % 2 === 0 ? 0.2 : 360 },
        ],
      })),
    },
  };
  document.activeTimelineId = 'timeline-main';
  return finish('motion', document);
}

function extremeZoom(): PerformanceWorkload {
  return finish('extreme-zoom', gridShapes('zoom', 1_000), {
    viewports: EXTREME_ZOOM_VIEWPORTS,
  });
}

function documentSwitching(): PerformanceWorkload {
  const documentSequence = [
    small().document,
    gridShapes('switch-medium', 1_000),
    deepNesting().document,
  ];
  return finish('document-switching', documentSequence[0]!, { documentSequence });
}

const FACTORIES: Record<PerformanceWorkloadId, () => PerformanceWorkload> = {
  small,
  'vector-100': vector100,
  'vector-500': vector500,
  'vector-1k': vector1k,
  'vector-5k': vector5k,
  'flat-10k': flat10k,
  'deep-nesting': deepNesting,
  'dense-overlap': denseOverlap,
  'wide-spread': wideSpread,
  'many-small': manySmall,
  'few-large': fewLarge,
  'clipped-frames': clippedFrames,
  'masked-content': maskedContent,
  'rotated-skewed': rotatedSkewed,
  'thick-strokes': thickStrokes,
  'effects-heavy': effectsHeavy,
  'blend-modes': blendModes,
  'raster-heavy': rasterHeavy,
  'mixed-raster-vector': mixedRasterVector,
  'hidden-locked': hiddenLocked,
  'offscreen-mixed': offscreenMixed,
  'boundary-crossing': boundaryCrossing,
  'multi-page': multiPage,
  'vector-heavy': vectorHeavy,
  'text-heavy': textHeavy,
  'effects-masks': effectsMasks,
  'rapid-brush': rapidBrush,
  'paint-raster-lod': paintRasterLod,
  motion,
  'extreme-zoom': extremeZoom,
  'document-switching': documentSwitching,
  'viewport-1k': viewport1k,
  'viewport-10k': viewport10k,
  'viewport-100k': viewport100k,
};

/** Exact product zoom points plus representative far-world/rotation probes. */
export const EXTREME_ZOOM_LEVELS = Object.freeze([
  0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8, 16, 32, 64,
] as const);

export const EXTREME_ZOOM_VIEWPORTS: readonly WorkloadViewport[] = Object.freeze(
  EXTREME_ZOOM_LEVELS.map((zoom, index) => ({
    pan:
      index === 0
        ? { x: 0, y: 0 }
        : index % 2 === 0
          ? { x: 2_000_000, y: -2_000_000 }
          : { x: -100_000, y: 75_000 },
    zoom,
    rotation: index === 0 ? 0 : index % 2 === 0 ? 359.9 : 17,
  })),
);

export const PERFORMANCE_STRESS_WORKLOAD_IDS = Object.freeze([
  'viewport-1k',
  'viewport-10k',
  'viewport-100k',
] as const satisfies readonly PerformanceWorkloadId[]);

export const PERFORMANCE_WORKLOAD_IDS = Object.freeze(
  (Object.keys(FACTORIES) as PerformanceWorkloadId[]).filter(
    (id) => !PERFORMANCE_STRESS_WORKLOAD_IDS.includes(id as never),
  ),
);

export function createPerformanceWorkload(id: PerformanceWorkloadId): PerformanceWorkload {
  return FACTORIES[id]();
}

export function createPerformanceWorkloadCorpus(
  options: { includeStress?: boolean } = {},
): PerformanceWorkload[] {
  const ids = options.includeStress
    ? [...PERFORMANCE_WORKLOAD_IDS, ...PERFORMANCE_STRESS_WORKLOAD_IDS]
    : PERFORMANCE_WORKLOAD_IDS;
  return ids.map(createPerformanceWorkload);
}
