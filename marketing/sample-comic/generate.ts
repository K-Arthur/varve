/**
 * Halloween Cookies — sample comic page for "Letter it in Varve".
 *
 * Built with the same @varve/scene factories the 0.5.0 app uses
 * (createDocument, createDesignCanvas, createCallout, DocumentCodec).
 * Artwork is original flat-colour vector; no generative imagery.
 *
 *   pnpm --filter @varve/ui exec tsx ../../marketing/sample-comic/generate.ts
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Affine } from '../../packages/engine/src/types.ts';
import { createCallout, removeCalloutTail } from '../../packages/scene/src/callout.ts';
import {
  createDesignCanvas,
  designCanvasContentRoot,
} from '../../packages/scene/src/designCanvas.ts';
import type { Document } from '../../packages/scene/src/document.ts';
import {
  addChild,
  createDocument,
  makeFrameNode,
  makeGroupNode,
  makePathNode,
  makeShapeNode,
} from '../../packages/scene/src/document.ts';
import { DocumentCodec } from '../../packages/scene/src/documentCodec.ts';
import { resetDefaultIdRng, setDefaultIdRng } from '../../packages/scene/src/identity.ts';
import { addMask } from '../../packages/scene/src/masks.ts';
import type {
  Fill,
  ManagedColor,
  SceneNode,
  Shape,
  Stroke,
} from '../../packages/scene/src/types.ts';

const PAGE_W = 900;
const PAGE_H = 1260;
const MARGIN = 36;
const GUTTER = 20;
const PANEL_W = (PAGE_W - MARGIN * 2 - GUTTER) / 2;
const PANEL_H = (PAGE_H - MARGIN * 2 - GUTTER * 2) / 3;

function rgb(r: number, g: number, b: number, a = 255): ManagedColor {
  return { space: 'rgb', r, g, b, a };
}

const C = {
  paper: rgb(246, 236, 214),
  ink: rgb(28, 22, 18),
  wallDay: rgb(255, 236, 210),
  wallNight: rgb(42, 38, 72),
  wallClose: rgb(232, 196, 150),
  floor: rgb(196, 154, 104),
  wood: rgb(176, 122, 70),
  woodDark: rgb(120, 78, 42),
  windowDay: rgb(168, 214, 232),
  windowNight: rgb(28, 36, 78),
  moon: rgb(255, 244, 200),
  skin: rgb(244, 196, 154),
  skinShade: rgb(214, 154, 110),
  hair: rgb(62, 40, 26),
  shirt: rgb(62, 118, 168),
  shirtShade: rgb(40, 82, 122),
  apron: rgb(248, 244, 236),
  hat: rgb(252, 250, 246),
  dough: rgb(210, 150, 88),
  doughShade: rgb(168, 108, 56),
  frost: rgb(252, 248, 240),
  pumpkin: rgb(232, 122, 28),
  pumpkinShade: rgb(176, 78, 12),
  stem: rgb(72, 118, 48),
  glow: rgb(255, 176, 64),
  caption: rgb(255, 244, 196),
  balloon: rgb(255, 253, 248),
  shelf: rgb(148, 98, 56),
  jar: rgb(120, 176, 168),
  bowl: rgb(232, 220, 200),
};

function stroke(color: ManagedColor, weight: number): Stroke {
  return {
    color,
    weight,
    align: 'center',
    dashPattern: [],
    dashOffset: 0,
    cap: 'round',
    join: 'round',
    miterLimit: 4,
    visible: true,
  };
}

const INK = stroke(C.ink, 2.4);

function t(x: number, y: number): Affine {
  return [1, 0, 0, 1, x, y];
}

let seq = 0;
function hid(prefix: string): string {
  seq += 1;
  return `hc-${prefix}-${seq}`;
}

function shape(
  id: string,
  geometry: Shape,
  opts: {
    name?: string;
    fill?: ManagedColor | Fill;
    strokes?: Stroke[];
    transform?: Affine;
    opacity?: number;
    blendMode?: SceneNode['blendMode'];
    cornerRadius?: number;
    order?: string;
  } = {},
) {
  return makeShapeNode(id, geometry, {
    name: opts.name ?? id,
    fill: (opts.fill as ManagedColor) ?? C.ink,
    strokes: opts.strokes ?? [INK],
    transform: opts.transform ?? t(0, 0),
    opacity: opts.opacity,
    blendMode: opts.blendMode,
    cornerRadius: opts.cornerRadius,
    order: opts.order,
  });
}

function ellipse(cx: number, cy: number, rx: number, ry: number): Shape {
  return { kind: 'ellipse', cx, cy, rx, ry };
}

function circle(cx: number, cy: number, r: number): Shape {
  return { kind: 'circle', cx, cy, r };
}

function rect(x: number, y: number, w: number, h: number): Shape {
  return { kind: 'rect', x, y, w, h };
}

function add(doc: Document, parent: string, node: SceneNode): Document {
  return addChild(doc, parent, node);
}

function addClippedShade(
  doc: Document,
  parent: string,
  name: string,
  matte: SceneNode,
  overlay: SceneNode,
): Document {
  const groupId = hid('shade');
  let next = add(doc, parent, makeGroupNode(groupId, { name, children: [] }));
  next = add(next, groupId, matte);
  next = add(next, groupId, overlay);
  return addMask(next, groupId, matte.id, 'clip', { hideMaskSource: true });
}

function addBaker(
  doc: Document,
  parent: string,
  x: number,
  y: number,
  expression: 'neutral' | 'happy' | 'surprised',
  scale = 1,
): Document {
  const g = hid('baker');
  let next = add(
    doc,
    parent,
    makeGroupNode(g, { name: 'Baker', children: [], transform: t(x, y) }),
  );
  const s = scale;

  next = add(
    next,
    g,
    shape(hid('shirt'), rect(18 * s, 78 * s, 64 * s, 78 * s), {
      name: 'Shirt',
      fill: C.shirt,
      cornerRadius: 10,
    }),
  );
  next = add(
    next,
    g,
    shape(hid('apron'), rect(28 * s, 88 * s, 44 * s, 72 * s), {
      name: 'Apron',
      fill: C.apron,
      cornerRadius: 8,
    }),
  );
  next = add(
    next,
    g,
    shape(hid('arm-l'), ellipse(16 * s, 108 * s, 10 * s, 22 * s), {
      name: 'Left arm',
      fill: C.skin,
    }),
  );
  next = add(
    next,
    g,
    shape(hid('arm-r'), ellipse(84 * s, 108 * s, 10 * s, 22 * s), {
      name: 'Right arm',
      fill: C.skin,
    }),
  );
  next = add(
    next,
    g,
    shape(hid('head'), ellipse(50 * s, 52 * s, 32 * s, 36 * s), {
      name: 'Head',
      fill: C.skin,
    }),
  );
  next = add(
    next,
    g,
    shape(hid('hair'), ellipse(50 * s, 28 * s, 34 * s, 18 * s), {
      name: 'Hair',
      fill: C.hair,
    }),
  );
  next = add(
    next,
    g,
    shape(hid('hat-band'), rect(20 * s, 10 * s, 60 * s, 16 * s), {
      name: 'Hat band',
      fill: C.hat,
      cornerRadius: 4,
    }),
  );
  next = add(
    next,
    g,
    shape(hid('hat-puff'), ellipse(50 * s, 2 * s, 28 * s, 16 * s), {
      name: 'Hat puff',
      fill: C.hat,
    }),
  );

  const eyeRy = expression === 'surprised' ? 8 * s : 4 * s;
  next = add(
    next,
    g,
    shape(hid('eye-l'), ellipse(38 * s, 50 * s, 4 * s, eyeRy), {
      name: 'Left eye',
      fill: C.ink,
      strokes: [],
    }),
  );
  next = add(
    next,
    g,
    shape(hid('eye-r'), ellipse(62 * s, 50 * s, 4 * s, eyeRy), {
      name: 'Right eye',
      fill: C.ink,
      strokes: [],
    }),
  );

  if (expression === 'happy') {
    next = add(
      next,
      g,
      makePathNode(hid('mouth'), {
        name: 'Smile',
        points: [
          { x: 38 * s, y: 66 * s, handleIn: null, handleOut: null },
          { x: 50 * s, y: 74 * s, handleIn: null, handleOut: null },
          { x: 62 * s, y: 66 * s, handleIn: null, handleOut: null },
        ],
        closed: false,
        fill: rgb(0, 0, 0, 0),
        strokes: [stroke(C.ink, 2.2)],
      }),
    );
  } else if (expression === 'surprised') {
    next = add(
      next,
      g,
      shape(hid('mouth'), ellipse(50 * s, 70 * s, 7 * s, 9 * s), {
        name: 'Surprised mouth',
        fill: C.ink,
        strokes: [],
      }),
    );
  } else {
    next = add(
      next,
      g,
      makePathNode(hid('mouth'), {
        name: 'Mouth',
        points: [
          { x: 42 * s, y: 68 * s, handleIn: null, handleOut: null },
          { x: 58 * s, y: 68 * s, handleIn: null, handleOut: null },
        ],
        closed: false,
        fill: rgb(0, 0, 0, 0),
        strokes: [stroke(C.ink, 2)],
      }),
    );
  }

  next = addClippedShade(
    next,
    g,
    'Baker shade',
    shape(hid('baker-matte'), ellipse(50 * s, 52 * s, 32 * s, 36 * s), {
      name: 'Head matte',
      fill: C.skin,
      strokes: [],
    }),
    shape(hid('baker-shade'), ellipse(68 * s, 64 * s, 22 * s, 28 * s), {
      name: 'Head shade',
      fill: C.skinShade,
      strokes: [],
      blendMode: 'multiply',
      opacity: 0.55,
    }),
  );
  next = addClippedShade(
    next,
    g,
    'Body shade',
    shape(hid('body-matte'), rect(18 * s, 78 * s, 64 * s, 78 * s), {
      name: 'Body matte',
      fill: C.shirt,
      strokes: [],
      cornerRadius: 10,
    }),
    shape(hid('body-shade'), rect(50 * s, 86 * s, 36 * s, 74 * s), {
      name: 'Body shade',
      fill: C.shirtShade,
      strokes: [],
      blendMode: 'multiply',
      opacity: 0.45,
    }),
  );
  return next;
}

function addCookie(
  doc: Document,
  parent: string,
  x: number,
  y: number,
  kind: 'ghost' | 'pumpkin',
  alive: boolean,
  scale = 1,
): Document {
  const g = hid(kind);
  let next = add(
    doc,
    parent,
    makeGroupNode(g, {
      name: kind === 'ghost' ? 'Ghost cookie' : 'Pumpkin cookie',
      children: [],
      transform: t(x, y),
    }),
  );
  const s = scale;

  if (kind === 'ghost') {
    next = add(
      next,
      g,
      shape(hid('dough'), ellipse(28 * s, 32 * s, 26 * s, 30 * s), {
        name: 'Dough',
        fill: C.dough,
      }),
    );
    next = add(
      next,
      g,
      shape(hid('frost'), ellipse(28 * s, 30 * s, 20 * s, 24 * s), {
        name: 'Frosting',
        fill: C.frost,
      }),
    );
    next = addClippedShade(
      next,
      g,
      'Ghost shade',
      shape(hid('g-matte'), ellipse(28 * s, 32 * s, 26 * s, 30 * s), {
        name: 'Ghost matte',
        fill: C.dough,
        strokes: [],
      }),
      shape(hid('g-shade'), ellipse(40 * s, 42 * s, 16 * s, 20 * s), {
        name: 'Ghost shade',
        fill: C.doughShade,
        strokes: [],
        blendMode: 'multiply',
        opacity: 0.5,
      }),
    );
  } else {
    next = add(
      next,
      g,
      shape(hid('dough'), circle(28 * s, 30 * s, 26 * s), {
        name: 'Dough',
        fill: C.dough,
      }),
    );
    next = add(
      next,
      g,
      shape(hid('frost'), circle(28 * s, 30 * s, 20 * s), {
        name: 'Frosting',
        fill: C.pumpkin,
      }),
    );
    next = add(
      next,
      g,
      shape(hid('stem'), rect(24 * s, 2 * s, 8 * s, 12 * s), {
        name: 'Stem',
        fill: C.stem,
        cornerRadius: 2,
      }),
    );
    next = addClippedShade(
      next,
      g,
      'Pumpkin shade',
      shape(hid('p-matte'), circle(28 * s, 30 * s, 26 * s), {
        name: 'Pumpkin matte',
        fill: C.dough,
        strokes: [],
      }),
      shape(hid('p-shade'), ellipse(40 * s, 40 * s, 16 * s, 18 * s), {
        name: 'Pumpkin shade',
        fill: C.pumpkinShade,
        strokes: [],
        blendMode: 'multiply',
        opacity: 0.5,
      }),
    );
  }

  if (alive) {
    next = add(
      next,
      g,
      shape(hid('e-l'), ellipse(20 * s, 26 * s, 3.2 * s, 5 * s), {
        name: 'Left eye',
        fill: C.ink,
        strokes: [],
      }),
    );
    next = add(
      next,
      g,
      shape(hid('e-r'), ellipse(36 * s, 26 * s, 3.2 * s, 5 * s), {
        name: 'Right eye',
        fill: C.ink,
        strokes: [],
      }),
    );
    next = add(
      next,
      g,
      makePathNode(hid('smile'), {
        name: 'Smile',
        points: [
          { x: 20 * s, y: 36 * s, handleIn: null, handleOut: null },
          { x: 28 * s, y: 41 * s, handleIn: null, handleOut: null },
          { x: 36 * s, y: 36 * s, handleIn: null, handleOut: null },
        ],
        closed: false,
        fill: rgb(0, 0, 0, 0),
        strokes: [stroke(C.ink, 2)],
      }),
    );
  }
  return next;
}

function addKitchen(
  doc: Document,
  panel: string,
  mood: 'day' | 'night' | 'closeup' | 'glow',
): Document {
  let next = doc;
  const wall =
    mood === 'night' || mood === 'glow'
      ? C.wallNight
      : mood === 'closeup'
        ? C.wallClose
        : C.wallDay;
  next = add(
    next,
    panel,
    shape(hid('wall'), rect(0, 0, PANEL_W, PANEL_H), {
      name: 'Wall',
      fill: wall,
      strokes: [],
    }),
  );

  if (mood === 'closeup') {
    next = add(
      next,
      panel,
      shape(hid('counter'), rect(0, 0, PANEL_W, PANEL_H), {
        name: 'Counter close-up',
        fill: C.wood,
        strokes: [],
      }),
    );
    next = addClippedShade(
      next,
      panel,
      'Counter shade',
      shape(hid('c-matte'), rect(0, 0, PANEL_W, PANEL_H), {
        name: 'Counter matte',
        fill: C.wood,
        strokes: [],
      }),
      shape(hid('c-shade'), rect(PANEL_W * 0.45, 0, PANEL_W * 0.55, PANEL_H), {
        name: 'Counter shade',
        fill: C.woodDark,
        strokes: [],
        blendMode: 'multiply',
        opacity: 0.28,
      }),
    );
    return next;
  }

  const winFill = mood === 'day' ? C.windowDay : C.windowNight;
  next = add(
    next,
    panel,
    shape(hid('window'), rect(PANEL_W - 118, 28, 88, 72), {
      name: 'Window',
      fill: winFill,
      cornerRadius: 6,
    }),
  );
  if (mood === 'night' || mood === 'glow') {
    next = add(
      next,
      panel,
      shape(hid('moon'), circle(PANEL_W - 74, 54, 14), {
        name: 'Moon',
        fill: C.moon,
        strokes: [],
      }),
    );
  }
  next = add(
    next,
    panel,
    shape(hid('shelf'), rect(18, 36, 110, 10), {
      name: 'Shelf',
      fill: C.shelf,
      cornerRadius: 2,
    }),
  );
  next = add(
    next,
    panel,
    shape(hid('jar'), ellipse(46, 22, 12, 16), {
      name: 'Jar',
      fill: C.jar,
    }),
  );
  next = add(
    next,
    panel,
    shape(hid('bowl'), ellipse(88, 24, 16, 12), {
      name: 'Bowl',
      fill: C.bowl,
    }),
  );
  next = add(
    next,
    panel,
    shape(hid('counter'), rect(0, PANEL_H - 128, PANEL_W, 128), {
      name: 'Counter',
      fill: C.wood,
      strokes: [INK],
    }),
  );
  next = addClippedShade(
    next,
    panel,
    'Counter shade',
    shape(hid('ctr-matte'), rect(0, PANEL_H - 128, PANEL_W, 128), {
      name: 'Counter matte',
      fill: C.wood,
      strokes: [],
    }),
    shape(hid('ctr-shade'), rect(PANEL_W * 0.5, PANEL_H - 128, PANEL_W * 0.5, 128), {
      name: 'Counter shade',
      fill: C.woodDark,
      strokes: [],
      blendMode: 'multiply',
      opacity: 0.3,
    }),
  );

  if (mood === 'night') {
    next = add(
      next,
      panel,
      shape(hid('door'), rect(16, 86, 64, PANEL_H - 214), {
        name: 'Door',
        fill: C.woodDark,
        cornerRadius: 6,
      }),
    );
  }

  if (mood === 'glow') {
    next = add(
      next,
      panel,
      shape(hid('glow-a'), circle(150, PANEL_H - 86, 54), {
        name: 'Glow A',
        fill: C.glow,
        strokes: [],
        opacity: 0.38,
      }),
    );
    next = add(
      next,
      panel,
      shape(hid('glow-b'), circle(250, PANEL_H - 86, 54), {
        name: 'Glow B',
        fill: C.glow,
        strokes: [],
        opacity: 0.38,
      }),
    );
  }
  return next;
}

function addBalloon(
  doc: Document,
  parent: string,
  options: {
    kind: 'speech' | 'thought' | 'caption' | 'shout';
    text: string;
    x: number;
    y: number;
    w: number;
    h: number;
    tail?: { x: number; y: number };
  },
): Document {
  const created = createCallout(doc, {
    kind: options.kind,
    x: options.x,
    y: options.y,
    w: options.w,
    h: options.h,
    text: options.text,
    padding: options.kind === 'caption' ? 12 : 16,
    tailEndpoint: options.tail,
    parentId: parent,
  });
  let next = created.document;
  const group = next.nodes[created.groupId];
  if (group?.kind === 'group' && group.callout && options.kind === 'caption') {
    for (const tailId of [...(group.callout.tailNodeIds ?? [])]) {
      next = removeCalloutTail(next, created.groupId, tailId);
    }
    const body = next.nodes[created.bodyId];
    if (body?.kind === 'shape') {
      next = {
        ...next,
        nodes: {
          ...next.nodes,
          [created.bodyId]: { ...body, fill: C.caption },
        },
      };
    }
  }
  const text = next.nodes[created.textId];
  if (text?.kind === 'text') {
    next = {
      ...next,
      nodes: {
        ...next.nodes,
        [created.textId]: {
          ...text,
          fontFamily: 'IBM Plex Sans Variable',
          fontWeight: options.kind === 'shout' ? 700 : options.kind === 'caption' ? 600 : 500,
          fontStyle: options.kind === 'caption' ? 'italic' : 'normal',
          textAlign: 'center',
          fontSize: options.kind === 'shout' ? 18 : 15,
        },
      },
    };
  }
  return next;
}

export function createHalloweenCookiesDocument(): Document {
  seq = 0;
  let doc = createDocument('Halloween Cookies', true);
  doc = { ...doc, id: 'halloween-cookies-2026', name: 'Halloween Cookies' };
  doc = createDesignCanvas(doc, { name: 'Canvas 1', id: 'halloween-canvas' });
  const canvasRoot = designCanvasContentRoot(doc);
  if (!canvasRoot) throw new Error('design canvas root missing');

  const page = makeFrameNode('hc-page', {
    name: 'Halloween Cookies page',
    w: PAGE_W,
    h: PAGE_H,
    fill: C.paper,
    clipContent: true,
    strokes: [stroke(C.ink, 3)],
    transform: t(0, 0),
  });
  doc = add(doc, canvasRoot, page);

  const panels: string[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 2; col++) {
      const id = `hc-panel-${row * 2 + col + 1}`;
      const x = MARGIN + col * (PANEL_W + GUTTER);
      const y = MARGIN + row * (PANEL_H + GUTTER);
      doc = add(
        doc,
        page.id,
        makeFrameNode(id, {
          name: `Panel ${row * 2 + col + 1}`,
          w: PANEL_W,
          h: PANEL_H,
          fill: C.wallDay,
          clipContent: true,
          strokes: [stroke(C.ink, 3.2)],
          cornerRadius: 8,
          transform: t(x, y),
          panel: { version: 1, panelId: id, readingOrder: row * 2 + col + 1 },
        }),
      );
      panels.push(id);
    }
  }

  // Panel 1 — morning kitchen, caption
  doc = addKitchen(doc, panels[0]!, 'day');
  doc = add(
    doc,
    panels[0]!,
    shape(hid('cutter-g'), ellipse(248, PANEL_H - 78, 22, 26), {
      name: 'Ghost cutter',
      fill: rgb(196, 196, 200),
    }),
  );
  doc = add(
    doc,
    panels[0]!,
    shape(hid('cutter-p'), circle(310, PANEL_H - 74, 22), {
      name: 'Pumpkin cutter',
      fill: rgb(196, 196, 200),
    }),
  );
  doc = addBaker(doc, panels[0]!, 36, 86, 'neutral', 1.05);
  doc = addBalloon(doc, panels[0]!, {
    kind: 'caption',
    text: 'That morning...',
    x: 16,
    y: 12,
    w: 188,
    h: 44,
  });

  // Panel 2 — decorating close-up
  doc = addKitchen(doc, panels[1]!, 'closeup');
  doc = addCookie(doc, panels[1]!, 70, 150, 'ghost', false, 1.6);
  doc = addCookie(doc, panels[1]!, 230, 168, 'pumpkin', false, 1.5);
  doc = add(
    doc,
    panels[1]!,
    shape(hid('hand'), ellipse(150, 92, 36, 20), {
      name: 'Hand',
      fill: C.skin,
    }),
  );
  doc = add(
    doc,
    panels[1]!,
    shape(hid('bag'), rect(142, 48, 16, 48), {
      name: 'Piping bag',
      fill: C.frost,
      cornerRadius: 4,
    }),
  );

  // Panel 3 — Perfect!
  doc = addKitchen(doc, panels[2]!, 'day');
  doc = addCookie(doc, panels[2]!, 168, PANEL_H - 118, 'ghost', false, 1);
  doc = addCookie(doc, panels[2]!, 236, PANEL_H - 114, 'pumpkin', false, 1);
  doc = addCookie(doc, panels[2]!, 304, PANEL_H - 118, 'ghost', false, 1);
  doc = addBaker(doc, panels[2]!, 28, 92, 'happy', 1.05);
  doc = addBalloon(doc, panels[2]!, {
    kind: 'speech',
    text: 'Perfect!',
    x: 196,
    y: 58,
    w: 150,
    h: 72,
    tail: { x: 40, y: 110 },
  });

  // Panel 4 — later that night
  doc = addKitchen(doc, panels[3]!, 'night');
  doc = addCookie(doc, panels[3]!, 196, PANEL_H - 118, 'ghost', false, 1);
  doc = addCookie(doc, panels[3]!, 272, PANEL_H - 114, 'pumpkin', false, 1);
  doc = addBalloon(doc, panels[3]!, {
    kind: 'caption',
    text: 'Later that night...',
    x: 96,
    y: 14,
    w: 220,
    h: 46,
  });

  // Panel 5 — alive + shout
  doc = addKitchen(doc, panels[4]!, 'glow');
  doc = addCookie(doc, panels[4]!, 122, PANEL_H - 124, 'ghost', true, 1.15);
  doc = addCookie(doc, panels[4]!, 222, PANEL_H - 120, 'pumpkin', true, 1.15);
  doc = addBalloon(doc, panels[4]!, {
    kind: 'shout',
    text: "WE'RE ALIVE!",
    x: 108,
    y: 48,
    w: 188,
    h: 88,
    tail: { x: 94, y: 140 },
  });

  // Panel 6 — shocked baker + thought
  doc = addKitchen(doc, panels[5]!, 'night');
  doc = addBaker(doc, panels[5]!, 18, 88, 'surprised', 1.05);
  doc = addCookie(doc, panels[5]!, 214, PANEL_H - 124, 'ghost', true, 1.1);
  doc = addCookie(doc, panels[5]!, 292, PANEL_H - 118, 'pumpkin', true, 1.1);
  doc = addBalloon(doc, panels[5]!, {
    kind: 'thought',
    text: 'Did I use\nmagic flour...?',
    x: 168,
    y: 18,
    w: 200,
    h: 92,
    tail: { x: 36, y: 150 },
  });

  return doc;
}

export function encodeHalloweenCookiesDocument(options: { lettered?: boolean } = {}): string {
  let counter = 0;
  setDefaultIdRng(() => `hc${(counter++).toString(16).padStart(4, '0')}`);
  try {
    let doc = createHalloweenCookiesDocument();
    if (options.lettered === false) {
      const nodes = { ...doc.nodes };
      for (const [id, node] of Object.entries(nodes)) {
        if (node.kind === 'group' && node.callout) {
          nodes[id] = { ...node, visible: false };
        }
      }
      doc = { ...doc, nodes };
    }
    return DocumentCodec.encode(doc);
  } finally {
    resetDefaultIdRng();
  }
}

const here = dirname(fileURLToPath(import.meta.url));
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const lettered = !process.argv.includes('--unlettered');
  const json = encodeHalloweenCookiesDocument({ lettered });
  const out = join(
    here,
    lettered ? 'halloween-cookies.varve' : 'halloween-cookies-unlettered.varve',
  );
  writeFileSync(out, `${json}\n`, 'utf8');
  const decoded = DocumentCodec.decode(json);
  if (!decoded.ok) {
    throw new Error(`generated document failed codec decode: ${decoded.error}`);
  }
  const callouts = Object.values(decoded.document.nodes).filter(
    (node) => node.kind === 'group' && node.callout,
  );
  process.stdout.write(
    [
      `Wrote ${out}`,
      `format ${decoded.document.formatVersion}`,
      `${Object.keys(decoded.document.nodes).length} nodes`,
      `${callouts.length} callouts (${callouts.map((node) => node.kind === 'group' && node.callout?.kind).join(', ')})`,
      `designCanvases ${decoded.document.designCanvases?.length ?? 0}`,
      lettered ? 'lettered' : 'unlettered',
      '',
    ].join('\n'),
  );
}
