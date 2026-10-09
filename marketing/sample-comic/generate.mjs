/**
 * Generate a sample comic page for "Letter it in Varve" marketing campaign.
 * Simple Node.js script that generates the document JSON directly.
 */

import { writeFile } from 'node:fs/promises';

// Unique ID generator
let idCounter = 1000;
function nextId() {
  return `n${idCounter++}`;
}

function cryptoId() {
  return `id-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

// Color palette
const COLORS = {
  skin: { space: 'rgb', r: 255, g: 220, b: 177, a: 255 },
  skinShade: { space: 'rgb', r: 210, g: 170, b: 130, a: 255 },
  hair: { space: 'rgb', r: 101, g: 67, b: 33, a: 255 },
  apron: { space: 'rgb', r: 230, g: 230, b: 250, a: 255 },
  shirt: { space: 'rgb', r: 100, g: 150, b: 200, a: 255 },
  counter: { space: 'rgb', r: 220, g: 180, b: 140, a: 255 },
  wall: { space: 'rgb', r: 240, g: 235, b: 220, a: 255 },
  cookie: { space: 'rgb', r: 210, g: 150, b: 90, a: 255 },
  frosting: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
  orange: { space: 'rgb', r: 255, g: 140, b: 0, a: 255 },
  green: { space: 'rgb', r: 80, g: 120, b: 40, a: 255 },
  black: { space: 'rgb', r: 30, g: 30, b: 30, a: 255 },
  white: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
  spookyGlow: { space: 'rgb', r: 255, g: 150, b: 50, a: 255 },
};

const STROKE_BLACK = {
  fill: COLORS.black,
  weight: 2.5,
  position: 'center',
  dashPattern: [],
};

const PANEL_WIDTH = 340;
const PANEL_HEIGHT = 340;
const GUTTER = 20;
const MARGIN = 40;
const PAGE_WIDTH = PANEL_WIDTH * 2 + GUTTER + MARGIN * 2;
const PAGE_HEIGHT = PANEL_HEIGHT * 3 + GUTTER * 2 + MARGIN * 2;

/**
 * Create character head group
 */
function createCharacterHead(x, y, expression = 'normal') {
  const headId = nextId();
  const hairId = nextId();
  const leftEyeId = nextId();
  const rightEyeId = nextId();
  const mouthId = nextId();
  const groupId = nextId();

  const nodes = {};

  // Head
  nodes[headId] = {
    id: headId,
    kind: 'shape',
    name: 'Head',
    layerColor: null,
    order: 'a0',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    fill: COLORS.skin,
    shape: { kind: 'ellipse', cx: x + 40, cy: y + 40, rx: 35, ry: 40 },
    strokes: [STROKE_BLACK],
    effects: [],
    transform: [1, 0, 0, 1, 0, 0],
  };

  // Hair
  nodes[hairId] = {
    id: hairId,
    kind: 'shape',
    name: 'Hair',
    layerColor: null,
    order: 'a1',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    fill: COLORS.hair,
    shape: { kind: 'ellipse', cx: x + 40, cy: y + 15, rx: 38, ry: 25 },
    strokes: [STROKE_BLACK],
    effects: [],
    transform: [1, 0, 0, 1, 0, 0],
  };

  // Eyes
  const eyeRy = expression === 'surprised' ? 8 : 3;
  nodes[leftEyeId] = {
    id: leftEyeId,
    kind: 'shape',
    name: 'Left Eye',
    layerColor: null,
    order: 'a2',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    fill: COLORS.black,
    shape: { kind: 'ellipse', cx: x + 27, cy: y + 35, rx: 3, ry: eyeRy },
    strokes: [],
    effects: [],
    transform: [1, 0, 0, 1, 0, 0],
  };

  nodes[rightEyeId] = {
    id: rightEyeId,
    kind: 'shape',
    name: 'Right Eye',
    layerColor: null,
    order: 'a3',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    fill: COLORS.black,
    shape: { kind: 'ellipse', cx: x + 53, cy: y + 35, rx: 3, ry: eyeRy },
    strokes: [],
    effects: [],
    transform: [1, 0, 0, 1, 0, 0],
  };

  // Mouth (simple path)
  let mouthPoints;
  if (expression === 'happy') {
    mouthPoints = [
      { x: x + 30, y: y + 50, type: 'point' },
      { x: x + 40, y: y + 57, type: 'point' },
      { x: x + 50, y: y + 50, type: 'point' },
    ];
  } else if (expression === 'surprised') {
    mouthPoints = [
      { x: x + 37, y: y + 50, type: 'point' },
      { x: x + 35, y: y + 55, type: 'point' },
      { x: x + 40, y: y + 57, type: 'point' },
      { x: x + 45, y: y + 55, type: 'point' },
      { x: x + 43, y: y + 50, type: 'point' },
    ];
  } else {
    mouthPoints = [
      { x: x + 32, y: y + 52, type: 'point' },
      { x: x + 40, y: y + 54, type: 'point' },
      { x: x + 48, y: y + 52, type: 'point' },
    ];
  }

  nodes[mouthId] = {
    id: mouthId,
    kind: 'path',
    name: 'Mouth',
    layerColor: null,
    order: 'a4',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    points: mouthPoints,
    closed: false,
    strokes: [
      {
        fill: COLORS.black,
        weight: 2,
        position: 'center',
        dashPattern: [],
      },
    ],
    effects: [],
    transform: [1, 0, 0, 1, 0, 0],
  };

  // Group
  nodes[groupId] = {
    id: groupId,
    kind: 'group',
    name: 'Character',
    layerColor: null,
    order: 'a5',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    children: [headId, hairId, leftEyeId, rightEyeId, mouthId],
    transform: [1, 0, 0, 1, 0, 0],
  };

  return { nodes, groupId, children: [headId, hairId, leftEyeId, rightEyeId, mouthId] };
}

/**
 * Create a cookie shape
 */
function createCookie(x, y, type = 'ghost', alive = false) {
  const bodyId = nextId();
  const groupId = nextId();
  const nodes = {};
  const children = [bodyId];

  if (type === 'ghost') {
    nodes[bodyId] = {
      id: bodyId,
      kind: 'shape',
      name: 'Cookie Body',
      layerColor: null,
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      fill: COLORS.frosting,
      shape: { kind: 'rect', x, y, w: 30, h: 35 },
      cornerRadius: 15,
      strokes: [STROKE_BLACK],
      effects: [],
      transform: [1, 0, 0, 1, 0, 0],
    };

    if (alive) {
      const leftEyeId = nextId();
      const rightEyeId = nextId();
      nodes[leftEyeId] = {
        id: leftEyeId,
        kind: 'shape',
        name: 'Left Eye',
        layerColor: null,
        order: 'a1',
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'normal',
        rotation: 0,
        fill: COLORS.black,
        shape: { kind: 'ellipse', cx: x + 10, cy: y + 12, rx: 3, ry: 3 },
        strokes: [],
        effects: [],
        transform: [1, 0, 0, 1, 0, 0],
      };
      nodes[rightEyeId] = {
        id: rightEyeId,
        kind: 'shape',
        name: 'Right Eye',
        layerColor: null,
        order: 'a2',
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'normal',
        rotation: 0,
        fill: COLORS.black,
        shape: { kind: 'ellipse', cx: x + 20, cy: y + 12, rx: 3, ry: 3 },
        strokes: [],
        effects: [],
        transform: [1, 0, 0, 1, 0, 0],
      };
      children.push(leftEyeId, rightEyeId);
    }
  } else {
    // Pumpkin
    nodes[bodyId] = {
      id: bodyId,
      kind: 'shape',
      name: 'Cookie Body',
      layerColor: null,
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      fill: COLORS.orange,
      shape: { kind: 'ellipse', cx: x + 15, cy: y + 15, rx: 15, ry: 15 },
      strokes: [STROKE_BLACK],
      effects: [],
      transform: [1, 0, 0, 1, 0, 0],
    };

    const stemId = nextId();
    nodes[stemId] = {
      id: stemId,
      kind: 'shape',
      name: 'Stem',
      layerColor: null,
      order: 'a1',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      fill: COLORS.green,
      shape: { kind: 'rect', x: x + 12, y: y - 5, w: 6, h: 8 },
      strokes: [STROKE_BLACK],
      effects: [],
      transform: [1, 0, 0, 1, 0, 0],
    };
    children.push(stemId);
  }

  nodes[groupId] = {
    id: groupId,
    kind: 'group',
    name: 'Cookie',
    layerColor: null,
    order: 'a3',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    children,
    transform: [1, 0, 0, 1, 0, 0],
  };

  return { nodes, groupId, children };
}

/**
 * Create a speech balloon around text
 */
function createBalloon(textId, x, y, text, kind = 'speech', tailX, tailY) {
  const bodyId = nextId();
  const tailId = nextId();
  const groupId = nextId();
  const nodes = {};

  // Measure approximate text width
  const textWidth = Math.max(80, text.length * 9);
  const textHeight = 40;
  const padding = 12;

  // Body (ellipse for speech, rounded rect for thought)
  if (kind === 'thought') {
    nodes[bodyId] = {
      id: bodyId,
      kind: 'shape',
      name: 'Balloon Body',
      layerColor: null,
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      fill: COLORS.white,
      shape: {
        kind: 'rect',
        x: x - padding,
        y: y - padding,
        w: textWidth + padding * 2,
        h: textHeight + padding * 2,
      },
      cornerRadius: 48,
      strokes: [
        {
          fill: COLORS.black,
          weight: 2,
          position: 'center',
          dashPattern: [],
        },
      ],
      effects: [],
      transform: [1, 0, 0, 1, 0, 0],
    };

    // Thought bubbles (3 small circles)
    const bubble1Id = nextId();
    const bubble2Id = nextId();
    const bubble3Id = nextId();

    const dx = tailX - (x + textWidth / 2);
    const dy = tailY - (y + textHeight / 2);
    const dist = Math.sqrt(dx * dx + dy * dy);
    const ux = dx / dist;
    const uy = dy / dist;

    nodes[bubble1Id] = {
      id: bubble1Id,
      kind: 'shape',
      name: 'Bubble 1',
      layerColor: null,
      order: 'a1',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      fill: COLORS.white,
      shape: {
        kind: 'ellipse',
        cx: x + textWidth / 2 + ux * 40,
        cy: y + textHeight / 2 + uy * 40,
        rx: 10,
        ry: 10,
      },
      strokes: [{ fill: COLORS.black, weight: 2, position: 'center', dashPattern: [] }],
      effects: [],
      transform: [1, 0, 0, 1, 0, 0],
    };

    nodes[bubble2Id] = {
      id: bubble2Id,
      kind: 'shape',
      name: 'Bubble 2',
      layerColor: null,
      order: 'a2',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      fill: COLORS.white,
      shape: {
        kind: 'ellipse',
        cx: x + textWidth / 2 + ux * 60,
        cy: y + textHeight / 2 + uy * 60,
        rx: 7,
        ry: 7,
      },
      strokes: [{ fill: COLORS.black, weight: 2, position: 'center', dashPattern: [] }],
      effects: [],
      transform: [1, 0, 0, 1, 0, 0],
    };

    nodes[bubble3Id] = {
      id: bubble3Id,
      kind: 'shape',
      name: 'Bubble 3',
      layerColor: null,
      order: 'a3',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      fill: COLORS.white,
      shape: { kind: 'ellipse', cx: tailX, cy: tailY, rx: 5, ry: 5 },
      strokes: [{ fill: COLORS.black, weight: 2, position: 'center', dashPattern: [] }],
      effects: [],
      transform: [1, 0, 0, 1, 0, 0],
    };

    nodes[groupId] = {
      id: groupId,
      kind: 'group',
      name: 'Thought Balloon',
      layerColor: null,
      order: 'b0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      children: [bodyId, bubble1Id, bubble2Id, bubble3Id, textId],
      transform: [1, 0, 0, 1, 0, 0],
      callout: {
        version: 1,
        kind: 'thought',
        bodyNodeId: bodyId,
        textNodeId: textId,
        tailNodeIds: [bubble1Id, bubble2Id, bubble3Id],
        padding,
        parametric: true,
        tails: [
          {
            nodeIds: [bubble1Id, bubble2Id, bubble3Id],
            style: 'thought',
            bubbleCount: 3,
          },
        ],
      },
    };

    return { nodes, groupId, children: [bodyId, bubble1Id, bubble2Id, bubble3Id, textId] };
  } else {
    // Speech balloon
    nodes[bodyId] = {
      id: bodyId,
      kind: 'shape',
      name: 'Balloon Body',
      layerColor: null,
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      fill: COLORS.white,
      shape: {
        kind: 'rect',
        x: x - padding,
        y: y - padding,
        w: textWidth + padding * 2,
        h: textHeight + padding * 2,
      },
      cornerRadius: 28,
      strokes: [
        {
          fill: COLORS.black,
          weight: 2,
          position: 'center',
          dashPattern: [],
        },
      ],
      effects: [],
      transform: [1, 0, 0, 1, 0, 0],
    };

    // Tail (simple triangle path)
    const bodyEdgeX = x + textWidth / 2;
    const bodyEdgeY = y + textHeight + padding;

    const tailPoints = [
      { x: bodyEdgeX - 10, y: bodyEdgeY, type: 'point' },
      { x: tailX, y: tailY, type: 'point' },
      { x: bodyEdgeX + 10, y: bodyEdgeY, type: 'point' },
    ];

    nodes[tailId] = {
      id: tailId,
      kind: 'path',
      name: 'Balloon Tail',
      layerColor: null,
      order: 'a1',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      fill: COLORS.white,
      points: tailPoints,
      closed: true,
      strokes: [
        {
          fill: COLORS.black,
          weight: 2,
          position: 'center',
          dashPattern: [],
        },
      ],
      effects: [],
      transform: [1, 0, 0, 1, 0, 0],
    };

    nodes[groupId] = {
      id: groupId,
      kind: 'group',
      name: 'Speech Balloon',
      layerColor: null,
      order: 'b0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      children: [bodyId, tailId, textId],
      transform: [1, 0, 0, 1, 0, 0],
      callout: {
        version: 1,
        kind: 'speech',
        bodyNodeId: bodyId,
        textNodeId: textId,
        tailNodeIds: [tailId],
        padding,
        parametric: true,
        tails: [
          {
            nodeIds: [tailId],
            style: 'pointed',
            curve: 0,
            baseWidth: 20,
          },
        ],
      },
    };

    return { nodes, groupId, children: [bodyId, tailId, textId] };
  }
}

/**
 * Generate the full document
 */
function generateDocument() {
  const doc = {
    id: cryptoId(),
    formatVersion: '2.33',
    name: 'Halloween Cookies',
    nextId: 10000,
    rootChildren: [],
    nodes: {},
    components: {},
    patternDefinitions: {},
    selectionSets: { sets: [], nextId: 1 },
    savedAreaSelections: [],
    activePageId: cryptoId(),
    globalChildren: [],
    pages: [],
    documentUnit: 'px',
    physicalWidth: PAGE_WIDTH,
    physicalHeight: PAGE_HEIGHT,
    dpi: 300,
  };

  const contentRootId = nextId();
  doc.nodes[contentRootId] = {
    id: contentRootId,
    kind: 'group',
    name: 'Page 1 content',
    layerColor: null,
    order: 'a0',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    children: [],
    transform: [1, 0, 0, 1, 0, 0],
  };

  doc.pages.push({
    id: doc.activePageId,
    name: 'Page 1',
    order: 'a0',
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
    backgrounds: [],
    contentRoot: contentRootId,
  });

  doc.rootChildren.push(contentRootId);

  // Create 6 panels (2x3 grid)
  const panels = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 2; col++) {
      const x = MARGIN + col * (PANEL_WIDTH + GUTTER);
      const y = MARGIN + row * (PANEL_HEIGHT + GUTTER);
      const panelId = nextId();

      doc.nodes[panelId] = {
        id: panelId,
        kind: 'frame',
        name: `Panel ${row * 2 + col + 1}`,
        layerColor: null,
        order: `p${row}${col}`,
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'normal',
        rotation: 0,
        fill: COLORS.wall,
        transform: [1, 0, 0, 1, x, y],
        w: PANEL_WIDTH,
        h: PANEL_HEIGHT,
        children: [],
        clipContent: true,
        strokes: [
          {
            fill: COLORS.black,
            weight: 3,
            position: 'center',
            dashPattern: [],
          },
        ],
        effects: [],
        panel: {
          semantic: true,
          order: row * 2 + col,
        },
      };

      doc.nodes[contentRootId].children.push(panelId);
      panels.push({ id: panelId, x, y, row, col });
    }
  }

  // Panel 1: Baker and cookie cutters
  {
    const allNodes = {};

    // Counter
    const counterId = nextId();
    allNodes[counterId] = {
      id: counterId,
      kind: 'shape',
      name: 'Counter',
      layerColor: null,
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      fill: COLORS.counter,
      shape: { kind: 'rect', x: 10, y: 200, w: PANEL_WIDTH - 20, h: 120 },
      strokes: [STROKE_BLACK],
      effects: [],
      transform: [1, 0, 0, 1, 0, 0],
    };

    // Character
    const char = createCharacterHead(50, 60, 'normal');
    Object.assign(allNodes, char.nodes);

    // Cookies
    const cookie1 = createCookie(180, 230, 'ghost');
    Object.assign(allNodes, cookie1.nodes);

    const cookie2 = createCookie(220, 230, 'pumpkin');
    Object.assign(allNodes, cookie2.nodes);

    Object.assign(doc.nodes, allNodes);
    doc.nodes[panels[0].id].children.push(
      counterId,
      char.groupId,
      cookie1.groupId,
      cookie2.groupId,
    );
  }

  // Panel 2: Decorating close-up
  {
    const allNodes = {};

    const cookie1 = createCookie(100, 120, 'ghost');
    Object.assign(allNodes, cookie1.nodes);

    const cookie2 = createCookie(180, 130, 'pumpkin');
    Object.assign(allNodes, cookie2.nodes);

    // Hand
    const handId = nextId();
    allNodes[handId] = {
      id: handId,
      kind: 'shape',
      name: 'Hand',
      layerColor: null,
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      fill: COLORS.skin,
      shape: { kind: 'ellipse', cx: 120, cy: 80, rx: 25, ry: 15 },
      strokes: [STROKE_BLACK],
      effects: [],
      transform: [1, 0, 0, 1, 0, 0],
    };

    Object.assign(doc.nodes, allNodes);
    doc.nodes[panels[1].id].children.push(handId, cookie1.groupId, cookie2.groupId);
  }

  // Panel 3: Happy baker with speech balloon
  {
    const allNodes = {};

    // Counter
    const counterId = nextId();
    allNodes[counterId] = {
      id: counterId,
      kind: 'shape',
      name: 'Counter',
      layerColor: null,
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      fill: COLORS.counter,
      shape: { kind: 'rect', x: 10, y: 200, w: PANEL_WIDTH - 20, h: 120 },
      strokes: [STROKE_BLACK],
      effects: [],
      transform: [1, 0, 0, 1, 0, 0],
    };

    // Character
    const char = createCharacterHead(50, 80, 'happy');
    Object.assign(allNodes, char.nodes);

    // Cookies
    const c1 = createCookie(120, 230, 'ghost');
    const c2 = createCookie(160, 230, 'pumpkin');
    const c3 = createCookie(200, 230, 'ghost');
    Object.assign(allNodes, c1.nodes);
    Object.assign(allNodes, c2.nodes);
    Object.assign(allNodes, c3.nodes);

    // Text and balloon
    const textId = nextId();
    allNodes[textId] = {
      id: textId,
      kind: 'text',
      name: 'Text',
      layerColor: null,
      order: 'b0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      text: 'Perfect!',
      transform: [1, 0, 0, 1, 150, 60],
      fontSize: 16,
      fontFamily: 'IBM Plex Sans Variable',
      fontWeight: 400,
      fontStyle: 'normal',
      lineHeight: 1.2,
      letterSpacing: 0,
      textAlign: 'left',
      fill: COLORS.black,
      strokes: [],
      effects: [],
    };

    const balloon = createBalloon(textId, 150, 60, 'Perfect!', 'speech', 130, 100);
    Object.assign(allNodes, balloon.nodes);

    Object.assign(doc.nodes, allNodes);
    doc.nodes[panels[2].id].children.push(
      counterId,
      char.groupId,
      c1.groupId,
      c2.groupId,
      c3.groupId,
      balloon.groupId,
    );
  }

  // Panel 4: Baker leaving
  {
    const allNodes = {};

    // Counter
    const counterId = nextId();
    allNodes[counterId] = {
      id: counterId,
      kind: 'shape',
      name: 'Counter',
      layerColor: null,
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      fill: COLORS.counter,
      shape: { kind: 'rect', x: 10, y: 200, w: PANEL_WIDTH - 20, h: 120 },
      strokes: [STROKE_BLACK],
      effects: [],
      transform: [1, 0, 0, 1, 0, 0],
    };

    // Door
    const doorId = nextId();
    allNodes[doorId] = {
      id: doorId,
      kind: 'shape',
      name: 'Door',
      layerColor: null,
      order: 'a1',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      fill: { space: 'rgb', r: 160, g: 120, b: 80, a: 255 },
      shape: { kind: 'rect', x: 10, y: 60, w: 60, h: 140 },
      strokes: [STROKE_BLACK],
      effects: [],
      transform: [1, 0, 0, 1, 0, 0],
    };

    // Cookies
    const c1 = createCookie(120, 230, 'ghost');
    const c2 = createCookie(160, 230, 'pumpkin');
    const c3 = createCookie(200, 230, 'ghost');
    Object.assign(allNodes, c1.nodes);
    Object.assign(allNodes, c2.nodes);
    Object.assign(allNodes, c3.nodes);

    Object.assign(doc.nodes, allNodes);
    doc.nodes[panels[3].id].children.push(counterId, doorId, c1.groupId, c2.groupId, c3.groupId);
  }

  // Panel 5: Cookies come alive (glow)
  {
    const allNodes = {};

    // Counter
    const counterId = nextId();
    allNodes[counterId] = {
      id: counterId,
      kind: 'shape',
      name: 'Counter',
      layerColor: null,
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      fill: COLORS.counter,
      shape: { kind: 'rect', x: 0, y: 180, w: PANEL_WIDTH, h: 160 },
      strokes: [STROKE_BLACK],
      effects: [],
      transform: [1, 0, 0, 1, 0, 0],
    };

    // Glow
    const glowId = nextId();
    allNodes[glowId] = {
      id: glowId,
      kind: 'shape',
      name: 'Glow',
      layerColor: null,
      order: 'a1',
      visible: true,
      locked: false,
      opacity: 0.3,
      blendMode: 'normal',
      rotation: 0,
      fill: COLORS.spookyGlow,
      shape: { kind: 'ellipse', cx: 95, cy: 227, rx: 25, ry: 25 },
      strokes: [],
      effects: [],
      transform: [1, 0, 0, 1, 0, 0],
    };

    // Cookie with eyes
    const c1 = createCookie(80, 210, 'ghost', true);
    Object.assign(allNodes, c1.nodes);

    Object.assign(doc.nodes, allNodes);
    doc.nodes[panels[4].id].children.push(counterId, glowId, c1.groupId);
  }

  // Panel 6: Surprised baker with thought balloon
  {
    const allNodes = {};

    // Counter
    const counterId = nextId();
    allNodes[counterId] = {
      id: counterId,
      kind: 'shape',
      name: 'Counter',
      layerColor: null,
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      fill: COLORS.counter,
      shape: { kind: 'rect', x: 10, y: 200, w: PANEL_WIDTH - 20, h: 120 },
      strokes: [STROKE_BLACK],
      effects: [],
      transform: [1, 0, 0, 1, 0, 0],
    };

    // Character
    const char = createCharacterHead(50, 60, 'surprised');
    Object.assign(allNodes, char.nodes);

    // Animated cookies
    const c1 = createCookie(120, 220, 'ghost', true);
    const c2 = createCookie(160, 225, 'pumpkin', false);
    const c3 = createCookie(200, 220, 'ghost', true);
    Object.assign(allNodes, c1.nodes);
    Object.assign(allNodes, c2.nodes);
    Object.assign(allNodes, c3.nodes);

    // Text and thought balloon
    const textId = nextId();
    allNodes[textId] = {
      id: textId,
      kind: 'text',
      name: 'Text',
      layerColor: null,
      order: 'b0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      text: 'Did I use\nmagic flour...?',
      transform: [1, 0, 0, 1, 150, 40],
      w: 120,
      fontSize: 14,
      fontFamily: 'IBM Plex Sans Variable',
      fontWeight: 400,
      fontStyle: 'normal',
      lineHeight: 1.2,
      letterSpacing: 0,
      textAlign: 'left',
      fill: COLORS.black,
      strokes: [],
      effects: [],
    };

    const balloon = createBalloon(
      textId,
      150,
      40,
      'Did I use\nmagic flour...?',
      'thought',
      100,
      70,
    );
    Object.assign(allNodes, balloon.nodes);

    Object.assign(doc.nodes, allNodes);
    doc.nodes[panels[5].id].children.push(
      counterId,
      char.groupId,
      c1.groupId,
      c2.groupId,
      c3.groupId,
      balloon.groupId,
    );
  }

  return doc;
}

// Main
const doc = generateDocument();
const json = JSON.stringify(doc, null, 2);
await writeFile('/workspace/marketing/sample-comic/halloween-cookies.varve', json, 'utf-8');

console.log('Generated halloween-cookies.varve');
console.log(`  Nodes: ${Object.keys(doc.nodes).length}`);
console.log(`  Panels: 6`);
