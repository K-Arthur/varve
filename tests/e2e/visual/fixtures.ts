/**
 * Visual regression fixture corpus.
 *
 * Each fixture is a flat `RenderItem[]` — the same IR shape `replayIr`
 * consumes. This harness tests `replayIr` (packages/engine/src/replay.ts)
 * directly, NOT the full `CanvasArea`/`replaySubtreeToCtx` orchestration
 * layer (mask compositing, group isolation surfaces, nested clip paths) —
 * those live above the IR (they decide what gets flattened into a
 * `RenderItem[]` in the first place), and covering them needs a heavier
 * harness that mounts real `CanvasArea` against a real `Document`. That's
 * DEFERRED — see tests/e2e/visual/README.md for the full scope table.
 *
 * Coverage in this file: node types (rect/circle/ellipse/text), opacity,
 * 4 blend modes, one linear gradient with rotation, one stroke variant, and
 * a ~1,500-item pathological scene. Explicitly NOT covered here (deferred,
 * see README): nested groups, masks/clipping, image fills, filters/LUTs,
 * RTL/emoji/ligature text, conic/radial gradient variants, dashed/joined/
 * capped stroke variants beyond the one shipped, motion/bound-property
 * fixtures, GPU-vs-software or per-platform separate baselines.
 */
import type { RenderItem } from '@varve/engine';

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
