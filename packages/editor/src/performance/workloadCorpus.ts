import {
  addMask,
  createDocument,
  type Document,
  makeFrameNode,
  makeImageShapeNode,
  makePathNode,
  makeShapeNode,
  makeTextNode,
  type SceneNode,
} from '@strata/scene';

export const PERFORMANCE_WORKLOAD_VERSION = 1 as const;

export type PerformanceWorkloadId =
  | 'small'
  | 'flat-10k'
  | 'deep-nesting'
  | 'raster-heavy'
  | 'vector-heavy'
  | 'text-heavy'
  | 'effects-masks'
  | 'rapid-brush'
  | 'motion'
  | 'extreme-zoom'
  | 'document-switching';

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
  viewports?: WorkloadViewport[];
  documentSequence?: Document[];
  expected: {
    nodeCount: number;
    decodedImageBytes?: number;
    pointerSampleCount?: number;
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
    viewports: [
      { pan: { x: 0, y: 0 }, zoom: 0.01, rotation: 0 },
      { pan: { x: -100_000, y: 75_000 }, zoom: 1, rotation: 17 },
      { pan: { x: 2_000_000, y: -2_000_000 }, zoom: 256, rotation: 359.9 },
    ],
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
  'flat-10k': flat10k,
  'deep-nesting': deepNesting,
  'raster-heavy': rasterHeavy,
  'vector-heavy': vectorHeavy,
  'text-heavy': textHeavy,
  'effects-masks': effectsMasks,
  'rapid-brush': rapidBrush,
  motion,
  'extreme-zoom': extremeZoom,
  'document-switching': documentSwitching,
};

export const PERFORMANCE_WORKLOAD_IDS = Object.freeze(
  Object.keys(FACTORIES) as PerformanceWorkloadId[],
);

export function createPerformanceWorkload(id: PerformanceWorkloadId): PerformanceWorkload {
  return FACTORIES[id]();
}

export function createPerformanceWorkloadCorpus(): PerformanceWorkload[] {
  return PERFORMANCE_WORKLOAD_IDS.map(createPerformanceWorkload);
}
