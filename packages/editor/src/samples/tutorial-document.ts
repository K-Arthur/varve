import type { ManagedColor, Affine } from '@strata/engine';
import {
  createDocument,
  makeFrameNode,
  makeShapeNode,
  makeTextNode,
  addNode,
  addChild,
} from '@strata/scene';
import type { Document } from '@strata/scene';

export const TUTORIAL_DOCUMENT_VERSION = 1;
export const TUTORIAL_DOCUMENT_ID = 'strata-tutorial';

function rgb(r: number, g: number, b: number, a = 255): ManagedColor {
  return { space: 'rgb' as const, r, g, b, a };
}

function translate(x: number, y: number): Affine {
  return [1, 0, 0, 1, x, y];
}

const TEAL = rgb(57, 208, 198);
const WHITE = rgb(255, 255, 255);
const DARK = rgb(16, 21, 31);
const PINK = rgb(227, 115, 155);
const YELLOW = rgb(245, 211, 87);

export function createTutorialDocument(): Document {
  let doc = createDocument('Tutorial', true);
  doc = { ...doc, id: TUTORIAL_DOCUMENT_ID, name: 'Tutorial' };

  // ── Lesson 1 Frame — Drawing Shapes ────────────────────────────────────
  const frame1 = makeFrameNode('frame-1', {
    name: 'Lesson 1 \u2014 Drawing Shapes',
    w: 640,
    h: 560,
    transform: translate(80, 80),
    fill: WHITE,
    clipContent: true,
  });
  doc = addNode(doc, frame1);

  // Instruction text
  const txt1a = makeTextNode('txt-1a', 'Double-click this text to edit. Try selecting me!', {
    name: 'Instruction text',
    transform: translate(40, 40),
    fontSize: 16,
    fill: DARK,
  });
  doc = addChild(doc, frame1.id, txt1a);

  // Rectangle shape
  const rect1 = makeShapeNode(
    'rect-1',
    { kind: 'rect', x: 0, y: 0, w: 160, h: 120 },
    {
      name: 'Rectangle \u2014 try changing my color',
      transform: translate(40, 120),
      fill: TEAL,
    },
  );
  doc = addChild(doc, frame1.id, rect1);

  // Ellipse shape
  const ellipse1 = makeShapeNode(
    'ellipse-1',
    { kind: 'ellipse', cx: 60, cy: 60, rx: 60, ry: 60 },
    {
      name: 'Ellipse \u2014 hold Shift to keep me round',
      transform: translate(80, 280),
      fill: TEAL,
    },
  );
  doc = addChild(doc, frame1.id, ellipse1);

  // Line shape
  const line1 = makeShapeNode(
    'line-1',
    { kind: 'line', from: [0, 0] as [number, number], to: [160, 0] as [number, number], tolerance: 5 },
    {
      name: 'Line \u2014 connect things with lines',
      transform: translate(40, 440),
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 0 } as ManagedColor,
      strokes: [{ color: DARK, weight: 2, align: 'center', cap: 'round', join: 'miter', miterLimit: 4, visible: true, dashPattern: [], dashOffset: 0 }],
    },
  );
  doc = addChild(doc, frame1.id, line1);

  // ── Lesson 2 Frame — Working with Layers ───────────────────────────────
  const frame2 = makeFrameNode('frame-2', {
    name: 'Lesson 2 \u2014 Working with Layers',
    w: 640,
    h: 560,
    transform: translate(80, 80),
    fill: WHITE,
    clipContent: true,
  });
  doc = addNode(doc, frame2);

  const txt2a = makeTextNode('txt-2a', 'Layers organize your design. Try reordering these shapes.', {
    name: 'Instruction text',
    transform: translate(40, 40),
    fontSize: 16,
    fill: DARK,
  });
  doc = addChild(doc, frame2.id, txt2a);

  const rect2 = makeShapeNode(
    'rect-2',
    { kind: 'rect', x: 0, y: 0, w: 200, h: 160 },
    {
      name: 'Background rectangle',
      transform: translate(40, 120),
      fill: PINK,
    },
  );
  doc = addChild(doc, frame2.id, rect2);

  const circle2a = makeShapeNode(
    'circle-2a',
    { kind: 'circle', cx: 60, cy: 60, r: 60 },
    {
      name: 'Teal circle (opacity 0.8)',
      transform: translate(120, 200),
      fill: TEAL,
      opacity: 0.8,
    },
  );
  doc = addChild(doc, frame2.id, circle2a);

  const circle2b = makeShapeNode(
    'circle-2b',
    { kind: 'circle', cx: 50, cy: 50, r: 50 },
    {
      name: 'Yellow circle (opacity 0.7)',
      transform: translate(60, 150),
      fill: YELLOW,
      opacity: 0.7,
    },
  );
  doc = addChild(doc, frame2.id, circle2b);

  // ── Lesson 3 Frame — Export Your Design ────────────────────────────────
  const frame3 = makeFrameNode('frame-3', {
    name: 'Lesson 3 \u2014 Export Your Design',
    w: 640,
    h: 560,
    transform: translate(80, 80),
    fill: WHITE,
    clipContent: true,
  });
  doc = addNode(doc, frame3);

  const txt3a = makeTextNode(
    'txt-3a',
    'Press Ctrl+E to export this design. You\u2019ve completed the tutorial!',
    {
      name: 'Completion message',
      transform: translate(40, 120),
      fontSize: 20,
      fontWeight: 600,
      fill: DARK,
    },
  );
  doc = addChild(doc, frame3.id, txt3a);

  const txt3b = makeTextNode(
    'txt-3b',
    'Strata supports PNG, SVG, PDF, and code export.',
    {
      name: 'Export formats info',
      transform: translate(40, 180),
      fontSize: 14,
      fill: DARK,
    },
  );
  doc = addChild(doc, frame3.id, txt3b);

  // Star shape at center as decorative element
  const star1 = makeShapeNode(
    'star-1',
    { kind: 'star', cx: 100, cy: 100, innerRadius: 40, outerRadius: 100, points: 5, rotation: 0 },
    {
      name: 'Decorative star',
      transform: translate(220, 240),
      fill: TEAL,
    },
  );
  doc = addChild(doc, frame3.id, star1);

  // Small decorative circles around the star
  for (let i = 0; i < 5; i++) {
    const angle = (i * 2 * Math.PI) / 5 - Math.PI / 2;
    const cx = 320 + Math.cos(angle) * 130;
    const cy = 340 + Math.sin(angle) * 130;
    const dot = makeShapeNode(
      `dot-${i}`,
      { kind: 'circle', cx: 8, cy: 8, r: 8 },
      {
        name: 'Decoration dot',
        transform: [1, 0, 0, 1, cx - 8, cy - 8],
        fill: i % 2 === 0 ? TEAL : PINK,
      },
    );
    doc = addChild(doc, frame3.id, dot);
  }

  // A decorative rounded rectangle
  const decorRect = makeShapeNode(
    'decor-rect',
    { kind: 'rect', x: 0, y: 0, w: 160, h: 4 },
    {
      name: 'Decorative line',
      transform: translate(240, 480),
      fill: TEAL,
    },
  );
  doc = addChild(doc, frame3.id, decorRect);

  return doc;
}
