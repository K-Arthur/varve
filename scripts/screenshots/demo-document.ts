/**
 * Demo documents for the product screenshot pipeline.
 *
 * These are real Varve documents, built with the same `@varve/scene` factories
 * the application itself uses, and opened through the application's own
 * File > Open path. Nothing here fabricates UI: the editor renders these
 * documents exactly as it renders a user's own work.
 *
 * Why documents instead of driving the tools: composing artwork by scripting
 * mouse drags produces a single flat rectangle and depends on tool timing,
 * which is neither attractive nor deterministic. Authoring the document gives
 * a stable, seeded composition that exercises gradients, strokes, Bézier
 * paths, stacked fills and a real type hierarchy — the capabilities the
 * screenshots are supposed to show.
 *
 * Determinism: every id is fixed, no clock or RNG is read, so the same bytes
 * are produced on every run and by every contributor.
 */
import type { Affine, PathPoint } from '../../packages/engine/src/types.ts';
import {
  addChild,
  addNode,
  createDocument,
  makeFrameNode,
  makeShapeNode,
  makeTextNode,
} from '../../packages/scene/src/document.ts';
import { DocumentCodec } from '../../packages/scene/src/documentCodec.ts';
import type { Document, Fill, ManagedColor, Stroke } from '../../packages/scene/src/types.ts';

/* -------------------------------------------------------------------- */
/* Palette — the Varve brand strata: teal, sandstone, terracotta.        */
/* -------------------------------------------------------------------- */

function rgb(r: number, g: number, b: number, a = 255): ManagedColor {
  return { space: 'rgb', r, g, b, a };
}

const TEAL = rgb(45, 165, 158);
const TEAL_DEEP = rgb(18, 92, 92);
const SAND = rgb(226, 140, 60);
const TERRA = rgb(197, 75, 58);
const INK = rgb(16, 21, 31);
const PAPER = rgb(247, 245, 240);
const BONE = rgb(232, 227, 217);

function translate(x: number, y: number): Affine {
  return [1, 0, 0, 1, x, y];
}

function gradient(
  stops: { position: number; color: ManagedColor }[],
  type: 'linear' | 'radial' = 'linear',
  rotation = 0,
): Fill {
  return {
    type: 'gradient',
    gradient: { type, stops, rotation, interpolationSpace: 'oklab' },
    opacity: 1,
    blendMode: 'normal',
    visible: true,
  };
}

function stroke(color: ManagedColor, weight: number, dash: number[] = []): Stroke {
  return {
    color,
    weight,
    align: 'center',
    dashPattern: dash,
    dashOffset: 0,
    cap: 'round',
    join: 'round',
    miterLimit: 4,
    visible: true,
  };
}

function anchor(
  x: number,
  y: number,
  hIn: [number, number] | null,
  hOut: [number, number] | null,
): PathPoint {
  return { x, y, handleIn: hIn, handleOut: hOut };
}

/** Fixed ids keep the encoded bytes identical between runs. */
function seeded(doc: Document, id: string, name: string): Document {
  return { ...doc, id, name };
}

/* -------------------------------------------------------------------- */
/* 1. Poster — the workspace hero composition                            */
/* -------------------------------------------------------------------- */

/**
 * An editorial poster: gradient ground, layered strata bands, a display type
 * hierarchy and a stroked Bézier curve. Exercises stacked fills, gradients
 * with oklab interpolation, path geometry and text styling in one document.
 */
export function createPosterDocument(): Document {
  let doc = seeded(createDocument('Varve Poster', true), 'varve-demo-poster', 'Varve Poster');

  const frame = makeFrameNode('poster-frame', {
    name: 'Poster — A3',
    w: 842,
    h: 1191,
    transform: translate(0, 0),
    fill: PAPER,
    clipContent: true,
  });
  doc = addNode(doc, frame);

  // Ground: a soft vertical gradient wash.
  const ground = makeShapeNode(
    'poster-ground',
    { kind: 'rect', x: 0, y: 0, w: 842, h: 1191 },
    {
      name: 'Ground',
      transform: translate(0, 0),
      fill: PAPER,
      order: 'a1',
    },
  );
  doc = addChild(doc, frame.id, {
    ...ground,
    fills: [
      gradient(
        [
          { position: 0, color: PAPER },
          { position: 0.62, color: BONE },
          { position: 1, color: rgb(214, 206, 193) },
        ],
        'linear',
        90,
      ),
    ],
  });

  // Varve: three sediment bands, the mark's core idea.
  const bands: [string, ManagedColor, number, number, number][] = [
    ['Layer — teal', TEAL, 470, 150, 0.92],
    ['Layer — sandstone', SAND, 604, 132, 0.9],
    ['Layer — terracotta', TERRA, 722, 118, 0.88],
  ];
  bands.forEach(([name, color, y, h, opacity], i) => {
    const band = makeShapeNode(
      `poster-band-${i}`,
      {
        kind: 'path',
        closed: true,
        tolerance: 0.25,
        points: [
          anchor(-30, y, null, [120, -22]),
          anchor(430, y - 30 + i * 8, [-140, 14], [150, -14]),
          anchor(880, y - 8 - i * 6, [-130, -18], null),
          anchor(880, y + h, null, null),
          anchor(-30, y + h + 14, null, null),
        ],
      },
      {
        name,
        transform: translate(0, 0),
        fill: color,
        opacity,
        order: `a${2 + i}`,
      },
    );
    doc = addChild(doc, frame.id, band);
  });

  // A stroked Bézier curve riding over the bands.
  const curve = makeShapeNode(
    'poster-curve',
    {
      kind: 'path',
      closed: false,
      tolerance: 0.25,
      points: [
        anchor(78, 402, null, [150, 96]),
        anchor(420, 520, [-140, -70], [160, 80]),
        anchor(764, 402, [-150, 96], null),
      ],
    },
    {
      name: 'Contour',
      transform: translate(0, 0),
      fill: rgb(0, 0, 0, 0),
      strokes: [stroke(TEAL_DEEP, 3)],
      order: 'a6',
    },
  );
  doc = addChild(doc, frame.id, curve);

  // Registration circle — a print mark, and a blend-mode demo.
  const disc = makeShapeNode(
    'poster-disc',
    { kind: 'circle', cx: 0, cy: 0, r: 96 },
    {
      name: 'Disc',
      transform: translate(648, 262),
      fill: TERRA,
      opacity: 0.85,
      blendMode: 'multiply',
      order: 'a7',
    },
  );
  doc = addChild(doc, frame.id, disc);

  // Type hierarchy.
  doc = addChild(
    doc,
    frame.id,
    makeTextNode('poster-kicker', 'ANNUAL LAYERS · NO. 07', {
      name: 'Kicker',
      transform: translate(78, 150),
      fontSize: 22,
      fontWeight: 600,
      letterSpacing: 3.4,
      fill: TEAL_DEEP,
      order: 'a8',
    }),
  );
  doc = addChild(
    doc,
    frame.id,
    makeTextNode('poster-title', 'Layers\nof time', {
      name: 'Display headline',
      transform: translate(72, 196),
      fontSize: 132,
      fontWeight: 800,
      lineHeight: 0.94,
      letterSpacing: -4,
      fill: INK,
      order: 'a9',
    }),
  );
  doc = addChild(
    doc,
    frame.id,
    makeTextNode(
      'poster-body',
      'A varve is a single year of sediment — one\nlight layer, one dark. Read together they\nkeep a record no single layer holds.',
      {
        name: 'Body copy',
        transform: translate(78, 860),
        fontSize: 27,
        lineHeight: 1.45,
        fill: INK,
        order: 'b1',
      },
    ),
  );
  doc = addChild(
    doc,
    frame.id,
    makeTextNode('poster-footer', 'Vector · Layout · Type · Motion · Print', {
      name: 'Footer',
      transform: translate(78, 1080),
      fontSize: 21,
      fontWeight: 500,
      letterSpacing: 0.6,
      fill: TEAL_DEEP,
      order: 'b2',
    }),
  );

  return doc;
}

/* -------------------------------------------------------------------- */
/* 2. Vector — a curve built for node editing                            */
/* -------------------------------------------------------------------- */

/**
 * A single expressive open path with generous handles: the point of this
 * scene is the anchor/handle overlay, so the geometry is deliberately
 * uncluttered and centred.
 */
export function createVectorDocument(): Document {
  let doc = seeded(createDocument('Vector Study', true), 'varve-demo-vector', 'Vector Study');

  const frame = makeFrameNode('vec-frame', {
    name: 'Vector study',
    w: 900,
    h: 640,
    transform: translate(0, 0),
    fill: PAPER,
    clipContent: true,
  });
  doc = addNode(doc, frame);

  const leaf = makeShapeNode(
    'vec-leaf',
    {
      kind: 'path',
      closed: true,
      tolerance: 0.25,
      points: [
        anchor(140, 380, [-40, 120], [70, -190]),
        anchor(450, 130, [-150, -30], [150, 30]),
        anchor(760, 380, [-70, -190], [-40, 120]),
        anchor(450, 520, [140, -40], [-140, -40]),
      ],
    },
    {
      name: 'Petal',
      transform: translate(0, 0),
      fill: TEAL,
      order: 'a1',
    },
  );
  doc = addChild(doc, frame.id, {
    ...leaf,
    fills: [
      gradient(
        [
          { position: 0, color: TEAL },
          { position: 1, color: TEAL_DEEP },
        ],
        'linear',
        35,
      ),
    ],
    strokes: [stroke(INK, 2)],
  });

  doc = addChild(
    doc,
    frame.id,
    makeShapeNode(
      'vec-arc',
      {
        kind: 'path',
        closed: false,
        tolerance: 0.25,
        points: [
          anchor(160, 470, null, [180, 90]),
          anchor(450, 560, [-150, -40], [150, -40]),
          anchor(740, 470, [-180, 90], null),
        ],
      },
      {
        name: 'Arc',
        transform: translate(0, 0),
        fill: rgb(0, 0, 0, 0),
        strokes: [stroke(SAND, 3, [14, 10])],
        order: 'a2',
      },
    ),
  );

  return doc;
}

/* -------------------------------------------------------------------- */
/* 3. Typography — a specimen with a real hierarchy                      */
/* -------------------------------------------------------------------- */

/**
 * A type specimen: display, subhead, body and caption in one frame, plus a
 * baseline rule. Shows the typography panel against text that actually has
 * something to inspect.
 */
export function createTypeSpecimenDocument(): Document {
  let doc = seeded(createDocument('Type Specimen', true), 'varve-demo-type', 'Type Specimen');

  const frame = makeFrameNode('type-frame', {
    name: 'Specimen',
    w: 960,
    h: 720,
    transform: translate(0, 0),
    fill: PAPER,
    clipContent: true,
  });
  doc = addNode(doc, frame);

  doc = addChild(
    doc,
    frame.id,
    makeShapeNode(
      'type-rule',
      { kind: 'rect', x: 0, y: 0, w: 864, h: 3 },
      { name: 'Baseline rule', transform: translate(48, 236), fill: TEAL, order: 'a1' },
    ),
  );

  doc = addChild(
    doc,
    frame.id,
    makeTextNode('type-display', 'Aa', {
      name: 'Display — 168',
      transform: translate(48, 56),
      fontSize: 168,
      fontWeight: 800,
      letterSpacing: -6,
      fill: INK,
      order: 'a2',
    }),
  );

  doc = addChild(
    doc,
    frame.id,
    makeTextNode('type-scale', 'ABCDEFGHIJKLM\nNOPQRSTUVWXYZ\n0123456789', {
      name: 'Character set',
      transform: translate(320, 76),
      fontSize: 44,
      fontWeight: 500,
      lineHeight: 1.24,
      letterSpacing: 1.2,
      fill: TEAL_DEEP,
      order: 'a3',
    }),
  );

  doc = addChild(
    doc,
    frame.id,
    makeTextNode('type-subhead', 'Design across disciplines.', {
      name: 'Subhead — 64',
      transform: translate(48, 290),
      fontSize: 64,
      fontWeight: 700,
      letterSpacing: -1.4,
      fill: INK,
      order: 'a4',
    }),
  );

  doc = addChild(
    doc,
    frame.id,
    makeTextNode(
      'type-body',
      'Set a paragraph the way it will print. Line height, tracking,\noptical size and OpenType features are edited in place, on\nthe canvas, with the same controls used for a headline.',
      {
        name: 'Body — 30',
        transform: translate(48, 392),
        fontSize: 30,
        lineHeight: 1.5,
        fill: INK,
        order: 'a5',
      },
    ),
  );

  doc = addChild(
    doc,
    frame.id,
    makeTextNode('type-caption', 'IBM PLEX SANS · VARIABLE · 400 / 500 / 700 / 800', {
      name: 'Caption',
      transform: translate(48, 620),
      fontSize: 20,
      fontWeight: 600,
      letterSpacing: 2.2,
      fill: SAND,
      order: 'a6',
    }),
  );

  return doc;
}

/* -------------------------------------------------------------------- */
/* 4. Layout — a two-spread editorial layout                             */
/* -------------------------------------------------------------------- */

/**
 * Two facing artboards with a shared grid: the layout scene needs to show
 * more than one page-sized frame side by side, which is what multi-page
 * print work actually looks like.
 */
export function createLayoutDocument(): Document {
  let doc = seeded(
    createDocument('Editorial Spread', true),
    'varve-demo-layout',
    'Editorial Spread',
  );

  const pages: { id: string; x: number; title: string; folio: string }[] = [
    { id: 'spread-left', x: 0, title: 'Reading\nthe record', folio: '12' },
    { id: 'spread-right', x: 660, title: 'One year,\none layer', folio: '13' },
  ];

  pages.forEach((page, index) => {
    const frame = makeFrameNode(page.id, {
      name: `Page ${page.folio}`,
      w: 620,
      h: 840,
      transform: translate(page.x, 0),
      fill: PAPER,
      clipContent: true,
    });
    doc = addNode(doc, frame);

    doc = addChild(
      doc,
      frame.id,
      makeTextNode(`${page.id}-title`, page.title, {
        name: 'Headline',
        transform: translate(56, 84),
        fontSize: 62,
        fontWeight: 800,
        lineHeight: 1,
        letterSpacing: -2,
        fill: INK,
        order: 'a1',
      }),
    );

    // Two-column body text. Each column is sized to run out above the plate
    // at y=596 — 15px/1.62 over a 300px measure is ~12 lines.
    COLUMNS[index].forEach((copy, col) => {
      doc = addChild(
        doc,
        frame.id,
        makeTextNode(`${page.id}-col-${col}`, copy, {
          name: `Column ${col + 1}`,
          transform: translate(56 + col * 258, 268),
          w: 232,
          fontSize: 15,
          lineHeight: 1.62,
          fill: INK,
          order: `a${2 + col}`,
        }),
      );
    });

    doc = addChild(
      doc,
      frame.id,
      makeShapeNode(
        `${page.id}-plate`,
        { kind: 'rect', x: 0, y: 0, w: 508, h: 190 },
        {
          name: 'Plate',
          transform: translate(56, 596),
          fill: index === 0 ? TEAL : SAND,
          order: 'a4',
        },
      ),
    );

    doc = addChild(
      doc,
      frame.id,
      makeTextNode(`${page.id}-folio`, page.folio, {
        name: 'Folio',
        transform: translate(56, 800),
        fontSize: 15,
        fontWeight: 600,
        fill: TEAL_DEEP,
        order: 'a5',
      }),
    );
  });

  return doc;
}

/** Two columns per page, distinct copy so the spread reads as real work. */
const COLUMNS: string[][] = [
  [
    'A varve is a pair of sediment\nlayers laid down in a single\nyear: a pale spring layer of\nfine silt, and a darker winter\nlayer of clay.',
    'Counted downward they date\na lake bed the way tree rings\ndate a trunk — one line per\nyear, in order, without gaps.',
  ],
  [
    'Read one layer on its own and\nit says very little. Read the\nsequence and it keeps a record\nno single layer holds.',
    'The thinnest bands mark dry\nyears; the thickest follow a\nflood. The record is legible\nbecause the order survived.',
  ],
];

/* -------------------------------------------------------------------- */
/* CLI                                                                   */
/* -------------------------------------------------------------------- */

export const DEMO_DOCUMENTS: Record<string, () => Document> = {
  poster: createPosterDocument,
  vector: createVectorDocument,
  type: createTypeSpecimenDocument,
  layout: createLayoutDocument,
};

export function encodeDemoDocument(name: keyof typeof DEMO_DOCUMENTS | string): string {
  const build = DEMO_DOCUMENTS[name];
  if (!build) throw new Error(`unknown demo document "${name}"`);
  return DocumentCodec.encode(build());
}
