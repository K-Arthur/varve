/**
 * Visual regression fixture corpus.
 *
 * Each fixture is a flat `RenderItem[]` — the same IR shape `replayIr`
 * consumes. This harness tests `replayIr` (packages/engine/src/replay.ts)
 * directly, NOT the full `CanvasArea`/`replaySubtreeToCtx` orchestration
 * layer (mask compositing, group isolation surfaces, nested clip paths) —
 * those live above the IR (they decide what gets flattened into a
 * `RenderItem[]` in the first place), and are covered by the companion real
 * editor-compositing spec.
 *
 * Coverage in this file: node types (rect/circle/ellipse/text), opacity,
 * blend modes, translated/rotated linear and radial gradients, angular/conic
 * and diamond gradients, image fills, filters/LUTs, fixed-time motion-bound
 * properties, all line caps, joined/dashed strokes, and a ~1,500-item
 * pathological scene. Nested groups and masks/clipping are covered by the
 * companion real-editor spec.
 */
import type { RenderItem } from '@varve/engine';
import type { Timeline } from '@varve/scene';

export interface VisualFixture {
  name: string;
  width: number;
  height: number;
  items: RenderItem[];
  /** Per-fixture pixel-diff tolerance passed to Playwright's toHaveScreenshot. */
  maxDiffPixels: number;
}

const TEAL = { space: 'rgb' as const, r: 57, g: 208, b: 198, a: 255 };
const RED = { space: 'rgb' as const, r: 220, g: 40, b: 40, a: 255 };
const BLUE = { space: 'rgb' as const, r: 40, g: 60, b: 220, a: 255 };
const BLACK = { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 };
const WHITE = { space: 'rgb' as const, r: 255, g: 255, b: 255, a: 255 };

// Inline SVG keeps the image-fill fixture self-contained while still
// exercising the production ImageCache → HTMLImageElement → drawImage path.
// Its explicit dimensions and hard-edged geometry make fit/crop/flip output
// straightforward to inspect and stable across browser runs.
const IMAGE_SRC = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48" viewBox="0 0 64 48"><rect width="64" height="48" fill="#172033"/><rect width="32" height="48" fill="#e33b52"/><circle cx="48" cy="24" r="14" fill="#39d0c6"/><path d="M4 4h20v8H4z" fill="#fff"/></svg>',
)}`;

const CHANNEL_SWAP_LUT = JSON.stringify({
  kind: '1d',
  size: 2,
  inputMin: [0, 0, 0],
  inputMax: [1, 1, 1],
  r: [0, 1],
  g: [1, 0],
  b: [1, 0],
  metadata: { title: 'Deterministic channel swap visual fixture' },
});

function baseItem(overrides: Partial<RenderItem>): RenderItem {
  return {
    transform: [1, 0, 0, 1, 0, 0],
    fill: TEAL,
    primitive: { kind: 'rect', x: 8, y: 8, w: 48, h: 48 },
    opacity: 1,
    blendMode: 'normal',
    strokes: [],
    effects: [],
    ...overrides,
  };
}

export const FIXTURES: VisualFixture[] = [
  {
    name: 'node-types',
    width: 320,
    height: 96,
    // Anti-aliased edges (circle/ellipse arcs) need a real tolerance —
    // 0 would be flaky across GPU/driver AA differences, per the edge-case
    // notes; 40px is small relative to the 320x96 canvas (~0.13% of pixels).
    maxDiffPixels: 40,
    items: [
      baseItem({
        transform: [1, 0, 0, 1, 0, 0],
        primitive: { kind: 'rect', x: 8, y: 8, w: 64, h: 64 },
        fill: TEAL,
      }),
      baseItem({
        transform: [1, 0, 0, 1, 80, 0],
        primitive: { kind: 'circle', cx: 40, cy: 40, r: 32 },
        fill: RED,
      }),
      baseItem({
        transform: [1, 0, 0, 1, 160, 0],
        primitive: { kind: 'ellipse', cx: 40, cy: 40, rx: 36, ry: 24 },
        fill: BLUE,
      }),
      baseItem({
        transform: [1, 0, 0, 1, 240, 0],
        primitive: {
          kind: 'text',
          text: 'Ag',
          fontSize: 32,
          fontFamily: 'sans-serif',
          fontWeight: 700,
          fontStyle: 'normal',
          textAlign: 'left',
          textAlignVertical: 'top',
          letterSpacing: 0,
          lineHeight: 1.2,
          paragraphSpacing: 0,
          textCase: 'none',
          textDecoration: 'none',
          textOverflow: 'visible',
          listStyle: 'none',
          x: 0,
          y: 0,
          w: 64,
          h: 64,
        },
        fill: BLACK,
      }),
    ],
  },
  {
    name: 'opacity-and-blend-modes',
    width: 320,
    height: 96,
    maxDiffPixels: 60,
    items: [
      // Backdrop rect all four groups composite against.
      baseItem({
        transform: [1, 0, 0, 1, 0, 0],
        primitive: { kind: 'rect', x: 0, y: 0, w: 320, h: 96 },
        fill: { space: 'rgb', r: 230, g: 230, b: 230, a: 255 },
      }),
      baseItem({
        transform: [1, 0, 0, 1, 8, 16],
        primitive: { kind: 'rect', x: 0, y: 0, w: 56, h: 56 },
        fill: TEAL,
        opacity: 0.5,
      }),
      baseItem({
        transform: [1, 0, 0, 1, 88, 16],
        primitive: { kind: 'rect', x: 0, y: 0, w: 56, h: 56 },
        fill: RED,
        blendMode: 'multiply',
      }),
      baseItem({
        transform: [1, 0, 0, 1, 168, 16],
        primitive: { kind: 'rect', x: 0, y: 0, w: 56, h: 56 },
        fill: BLUE,
        blendMode: 'screen',
      }),
      baseItem({
        transform: [1, 0, 0, 1, 248, 16],
        primitive: { kind: 'rect', x: 0, y: 0, w: 56, h: 56 },
        fill: TEAL,
        blendMode: 'difference',
      }),
    ],
  },
  {
    name: 'linear-gradient-rotated',
    width: 160,
    height: 160,
    maxDiffPixels: 80,
    items: [
      baseItem({
        transform: [1, 0, 0, 1, 0, 0],
        fill: BLACK,
        fills: [
          {
            type: 'gradient',
            gradientType: 'linear',
            stops: [
              { position: 0, color: TEAL },
              { position: 0.5, color: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 } },
              { position: 1, color: RED },
            ],
            rotation: 35,
            opacity: 1,
            blendMode: 'normal',
            visible: true,
          },
        ],
        primitive: { kind: 'rect', x: 0, y: 0, w: 160, h: 160 },
      }),
    ],
  },
  {
    name: 'linear-gradient-translated',
    width: 240,
    height: 160,
    maxDiffPixels: 80,
    items: [
      baseItem({
        transform: [1, 0, 0, 1, 40, 0],
        fill: BLACK,
        fills: [
          {
            type: 'gradient',
            gradientType: 'linear',
            stops: [
              { position: 0, color: TEAL },
              { position: 0.5, color: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 } },
              { position: 1, color: RED },
            ],
            rotation: 35,
            opacity: 1,
            blendMode: 'normal',
            visible: true,
          },
        ],
        primitive: { kind: 'rect', x: 0, y: 0, w: 160, h: 160 },
      }),
    ],
  },
  {
    name: 'radial-gradient-rotated',
    width: 160,
    height: 160,
    maxDiffPixels: 80,
    items: [
      baseItem({
        fill: BLACK,
        fills: [
          {
            type: 'gradient',
            gradientType: 'radial',
            stops: [
              { position: 0, color: TEAL },
              { position: 0.55, color: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 } },
              { position: 1, color: RED },
            ],
            rotation: 35,
            opacity: 1,
            blendMode: 'normal',
            visible: true,
          },
        ],
        primitive: { kind: 'rect', x: 0, y: 0, w: 160, h: 160 },
      }),
    ],
  },
  {
    name: 'stroke-center-solid',
    width: 96,
    height: 96,
    maxDiffPixels: 50,
    items: [
      baseItem({
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
        primitive: { kind: 'rect', x: 16, y: 16, w: 64, h: 64 },
        strokes: [
          {
            color: BLACK,
            weight: 6,
            align: 'center',
            cap: 'butt',
            join: 'miter',
            dashPattern: [],
            dashOffset: 0,
            miterLimit: 4,
            visible: true,
          },
        ],
      }),
    ],
  },
  {
    name: 'multilingual-text',
    width: 900,
    height: 260,
    // Script fallback and emoji color glyphs have anti-aliased edges, but the
    // tolerance remains small relative to the full fixture surface.
    maxDiffPixels: 240,
    items: [
      baseItem({
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
        primitive: { kind: 'rect', x: 0, y: 0, w: 900, h: 260 },
      }),
      baseItem({
        primitive: {
          kind: 'text',
          text: 'Latin office — ﬁ ﬂ · Arabic: العربية بالعربية',
          fontSize: 28,
          fontFamily: 'sans-serif',
          fontWeight: 400,
          fontStyle: 'normal',
          textAlign: 'left',
          textAlignVertical: 'top',
          letterSpacing: 0,
          lineHeight: 1.25,
          paragraphSpacing: 0,
          textCase: 'none',
          textDecoration: 'none',
          textOverflow: 'visible',
          listStyle: 'none',
          textMode: 'point',
          direction: 'auto',
          language: 'en',
          x: 32,
          y: 24,
          w: 836,
          h: 40,
        },
        fill: BLACK,
      }),
      baseItem({
        primitive: {
          kind: 'text',
          text: 'עברית RTL — English 123 · हिन्दी नमस्ते',
          fontSize: 28,
          fontFamily: 'sans-serif',
          fontWeight: 400,
          fontStyle: 'normal',
          textAlign: 'left',
          textAlignVertical: 'top',
          letterSpacing: 0,
          lineHeight: 1.25,
          paragraphSpacing: 0,
          textCase: 'none',
          textDecoration: 'none',
          textOverflow: 'visible',
          listStyle: 'none',
          textMode: 'point',
          direction: 'auto',
          language: 'he',
          x: 32,
          y: 82,
          w: 836,
          h: 40,
        },
        fill: BLACK,
      }),
      baseItem({
        primitive: {
          kind: 'text',
          text: '日本語の文章 · \u{1F469}\u{1F3FD}\u200D\u{1F4BB} · family: \u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}',
          fontSize: 28,
          fontFamily: 'sans-serif',
          fontWeight: 400,
          fontStyle: 'normal',
          textAlign: 'left',
          textAlignVertical: 'top',
          letterSpacing: 0,
          lineHeight: 1.25,
          paragraphSpacing: 0,
          textCase: 'none',
          textDecoration: 'none',
          textOverflow: 'visible',
          listStyle: 'none',
          textMode: 'point',
          direction: 'auto',
          language: 'ja',
          x: 32,
          y: 140,
          w: 836,
          h: 40,
        },
        fill: BLACK,
      }),
      baseItem({
        primitive: {
          kind: 'text',
          text: 'Combining: e\u0301 · ZWJ: \u{1F9D1}\u{1F3FE}\u200D\u{1F680} · punctuation: (אבג)',
          fontSize: 28,
          fontFamily: 'sans-serif',
          fontWeight: 400,
          fontStyle: 'normal',
          textAlign: 'left',
          textAlignVertical: 'top',
          letterSpacing: 0,
          lineHeight: 1.25,
          paragraphSpacing: 0,
          textCase: 'none',
          textDecoration: 'none',
          textOverflow: 'visible',
          listStyle: 'none',
          textMode: 'point',
          direction: 'auto',
          language: 'en',
          x: 32,
          y: 198,
          w: 836,
          h: 40,
        },
        fill: BLACK,
      }),
    ],
  },
  {
    name: 'image-fills',
    width: 360,
    height: 180,
    maxDiffPixels: 120,
    items: [
      baseItem({
        fill: WHITE,
        primitive: { kind: 'rect', x: 0, y: 0, w: 360, h: 180 },
      }),
      baseItem({
        fill: BLACK,
        fills: [
          {
            type: 'image',
            src: IMAGE_SRC,
            fit: 'fill',
            x: 0,
            y: 0,
            scale: 1,
            imageWidth: 64,
            imageHeight: 48,
            opacity: 1,
            blendMode: 'normal',
            visible: true,
          },
        ],
        primitive: { kind: 'rect', x: 16, y: 16, w: 144, h: 64 },
      }),
      baseItem({
        fill: BLACK,
        fills: [
          {
            type: 'image',
            src: IMAGE_SRC,
            fit: 'fit',
            x: 0,
            y: 0,
            scale: 1,
            imageWidth: 64,
            imageHeight: 48,
            rotation: 180,
            flipH: true,
            opacity: 1,
            blendMode: 'normal',
            visible: true,
          },
        ],
        primitive: { kind: 'rect', x: 200, y: 16, w: 144, h: 64 },
      }),
      baseItem({
        fill: BLACK,
        fills: [
          {
            type: 'image',
            src: IMAGE_SRC,
            fit: 'crop',
            x: 0,
            y: 0,
            scale: 1,
            imageWidth: 64,
            imageHeight: 48,
            crop: { x: 24, y: 0, w: 40, h: 48 },
            opacity: 1,
            blendMode: 'normal',
            visible: true,
          },
        ],
        primitive: { kind: 'rect', x: 16, y: 100, w: 144, h: 64 },
      }),
      baseItem({
        fill: BLACK,
        fills: [
          {
            type: 'image',
            src: IMAGE_SRC,
            fit: 'tile',
            x: 0,
            y: 0,
            scale: 0.5,
            imageWidth: 64,
            imageHeight: 48,
            opacity: 1,
            blendMode: 'normal',
            visible: true,
          },
        ],
        primitive: { kind: 'rect', x: 200, y: 100, w: 144, h: 64 },
      }),
    ],
  },
  {
    name: 'angular-and-diamond-gradients',
    width: 320,
    height: 160,
    maxDiffPixels: 120,
    items: [
      baseItem({
        fill: WHITE,
        primitive: { kind: 'rect', x: 0, y: 0, w: 320, h: 160 },
      }),
      baseItem({
        fill: BLACK,
        fills: [
          {
            type: 'gradient',
            gradientType: 'angular',
            stops: [
              { position: 0, color: RED },
              { position: 0.25, color: TEAL },
              { position: 0.5, color: BLUE },
              { position: 0.75, color: WHITE },
              { position: 1, color: RED },
            ],
            rotation: 25,
            opacity: 1,
            blendMode: 'normal',
            visible: true,
          },
        ],
        primitive: { kind: 'circle', cx: 80, cy: 80, r: 64 },
      }),
      baseItem({
        fill: BLACK,
        fills: [
          {
            type: 'gradient',
            gradientType: 'diamond',
            stops: [
              { position: 0, color: WHITE },
              { position: 0.45, color: TEAL },
              { position: 1, color: BLUE },
            ],
            rotation: 40,
            opacity: 1,
            blendMode: 'normal',
            visible: true,
          },
        ],
        primitive: { kind: 'rect', x: 176, y: 16, w: 128, h: 128 },
      }),
    ],
  },
  {
    name: 'stroke-variants',
    width: 360,
    height: 180,
    maxDiffPixels: 180,
    items: [
      baseItem({
        fill: { space: 'rgb', r: 248, g: 249, b: 252, a: 255 },
        primitive: { kind: 'rect', x: 0, y: 0, w: 360, h: 180 },
      }),
      ...(['butt', 'round', 'square'] as const).map((cap, index) =>
        baseItem({
          fill: { space: 'rgb', r: 248, g: 249, b: 252, a: 0 },
          primitive: {
            kind: 'line',
            from: [24, 28 + index * 36],
            to: [116, 28 + index * 36],
            tolerance: 0,
          },
          strokes: [
            {
              color: [RED, TEAL, BLUE][index]!,
              weight: 14,
              align: 'center',
              cap,
              join: 'miter',
              dashPattern: [],
              dashOffset: 0,
              miterLimit: 4,
              visible: true,
            },
          ],
        }),
      ),
      baseItem({
        fill: { space: 'rgb', r: 248, g: 249, b: 252, a: 0 },
        primitive: {
          kind: 'path',
          points: [
            { x: 166, y: 112, handleIn: null, handleOut: null },
            { x: 198, y: 44, handleIn: null, handleOut: null },
            { x: 230, y: 112, handleIn: null, handleOut: null },
          ],
          closed: false,
          tolerance: 0,
        },
        strokes: [
          {
            color: BLACK,
            weight: 12,
            align: 'center',
            cap: 'round',
            join: 'round',
            dashPattern: [],
            dashOffset: 0,
            miterLimit: 4,
            visible: true,
          },
        ],
      }),
      baseItem({
        fill: { space: 'rgb', r: 248, g: 249, b: 252, a: 0 },
        primitive: {
          kind: 'line',
          from: [260, 28],
          to: [336, 28],
          tolerance: 0,
        },
        strokes: [
          {
            color: BLACK,
            weight: 8,
            align: 'center',
            cap: 'round',
            join: 'bevel',
            dashPattern: [14, 7],
            dashOffset: 3,
            miterLimit: 4,
            visible: true,
          },
        ],
      }),
      baseItem({
        fill: { space: 'rgb', r: 248, g: 249, b: 252, a: 0 },
        primitive: {
          kind: 'path',
          points: [
            { x: 260, y: 80, handleIn: null, handleOut: null },
            { x: 298, y: 46, handleIn: null, handleOut: null },
            { x: 336, y: 80, handleIn: null, handleOut: null },
          ],
          closed: false,
          tolerance: 0,
        },
        strokes: [
          {
            color: RED,
            weight: 10,
            align: 'center',
            cap: 'butt',
            join: 'bevel',
            dashPattern: [],
            dashOffset: 0,
            miterLimit: 4,
            visible: true,
          },
        ],
      }),
    ],
  },
  {
    name: 'filters-and-lut',
    width: 360,
    height: 180,
    maxDiffPixels: 260,
    items: [
      baseItem({
        fill: WHITE,
        primitive: { kind: 'rect', x: 0, y: 0, w: 360, h: 180 },
      }),
      baseItem({
        fill: RED,
        primitive: { kind: 'rect', x: 16, y: 16, w: 96, h: 64 },
        filters: [
          { kind: 'brightness', value: 1.35, opacity: 1, blendMode: 'normal' },
          { kind: 'blur', radius: 2, opacity: 1, blendMode: 'normal' },
        ],
      }),
      baseItem({
        fill: TEAL,
        primitive: { kind: 'rect', x: 132, y: 16, w: 96, h: 64 },
        filters: [
          {
            kind: 'gradientMap',
            stops: [
              { position: 0, color: [BLUE.r, BLUE.g, BLUE.b, BLUE.a] },
              { position: 1, color: [RED.r, RED.g, RED.b, RED.a] },
            ],
            dither: false,
            preserveLuminosity: false,
            intensity: 1,
            opacity: 1,
            blendMode: 'normal',
          },
        ],
      }),
      baseItem({
        fill: BLUE,
        primitive: { kind: 'rect', x: 248, y: 16, w: 96, h: 64 },
        filters: [
          {
            kind: 'lut',
            lutJson: CHANNEL_SWAP_LUT,
            inputSpace: 'sRGB',
            interpolation: 'linear',
            intensity: 1,
            linearize: false,
            opacity: 1,
            blendMode: 'normal',
          },
        ],
      }),
      baseItem({
        fill: { space: 'rgb', r: 70, g: 80, b: 90, a: 255 },
        primitive: { kind: 'rect', x: 16, y: 104, w: 328, h: 52 },
        filters: [
          {
            kind: 'colorBalance',
            shadows: { cyanRed: 35, magentaGreen: -20, yellowBlue: 15 },
            midtones: { cyanRed: 0, magentaGreen: 25, yellowBlue: -25 },
            highlights: { cyanRed: -20, magentaGreen: 0, yellowBlue: 30 },
            preserveLuminosity: true,
            opacity: 0.85,
            blendMode: 'normal',
          },
        ],
      }),
    ],
  },
];

export interface MotionVisualFixture {
  name: string;
  width: number;
  height: number;
  maxDiffPixels: number;
  time: number;
  items: { nodeId: string; item: RenderItem }[];
  timeline: Timeline;
}

const motionBackground = baseItem({
  fill: WHITE,
  primitive: { kind: 'rect', x: 0, y: 0, w: 320, h: 160 },
});

export const MOTION_FIXTURES: MotionVisualFixture[] = [
  {
    name: 'motion-bound-properties-at-fixed-time',
    width: 320,
    height: 160,
    maxDiffPixels: 80,
    time: 500,
    items: [
      { nodeId: 'background', item: motionBackground },
      {
        nodeId: 'moving',
        item: baseItem({
          fill: TEAL,
          primitive: { kind: 'rect', x: 0, y: 0, w: 56, h: 56 },
        }),
      },
      {
        nodeId: 'fading',
        item: baseItem({
          fill: RED,
          primitive: { kind: 'rect', x: 180, y: 48, w: 72, h: 72 },
        }),
      },
      {
        nodeId: 'color-bound',
        item: baseItem({
          fill: BLACK,
          fills: [
            {
              type: 'solid',
              color: BLUE,
              opacity: 1,
              blendMode: 'normal',
              visible: true,
            },
          ],
          primitive: { kind: 'rect', x: 76, y: 84, w: 72, h: 48 },
        }),
      },
    ],
    timeline: {
      id: 'motion-fixed-time',
      name: 'Fixed-time visual fixture',
      duration: 1000,
      defaultEasing: { kind: 'linear' },
      tracks: [
        {
          id: 'move-x',
          nodeId: 'moving',
          property: 'transform',
          keyframes: [
            { progress: 0, value: [1, 0, 0, 1, 0, 0] },
            { progress: 1, value: [1, 0, 0, 1, 180, 12] },
          ],
        },
        {
          id: 'fade-opacity',
          nodeId: 'fading',
          property: 'opacity',
          keyframes: [
            { progress: 0, value: 0.2 },
            { progress: 1, value: 0.9 },
          ],
        },
        {
          id: 'color-fill',
          nodeId: 'color-bound',
          property: 'fills[0].color',
          keyframes: [
            { progress: 0, value: BLUE },
            { progress: 1, value: RED },
          ],
        },
      ],
    },
  },
];

/** ~1,500-item pathological scene: a grid of small rects at varying opacity/blend. */
export function makePathologicalFixture(count = 1500): VisualFixture {
  const items: RenderItem[] = [];
  const cols = 50;
  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    items.push(
      baseItem({
        transform: [1, 0, 0, 1, col * 16, row * 16],
        primitive: { kind: 'rect', x: 0, y: 0, w: 14, h: 14 },
        fill: i % 3 === 0 ? TEAL : i % 3 === 1 ? RED : BLUE,
        opacity: 0.6 + 0.4 * ((i % 5) / 5),
        blendMode: i % 7 === 0 ? 'multiply' : 'normal',
      }),
    );
  }
  return {
    name: `pathological-${count}`,
    width: cols * 16,
    height: Math.ceil(count / cols) * 16,
    maxDiffPixels: Math.round(count * 0.15), // scales with node count, not a fixed constant
    items,
  };
}
