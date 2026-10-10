/**
 * Generate Halloween Cookies comic using the actual v2.33 format
 * Based on reference-sample.varve from Varve 0.5.0
 */

import crypto from 'node:crypto';
import fs from 'node:fs';

// Read the reference file to understand the structure
const reference = JSON.parse(
  fs.readFileSync(
    '/home/ubuntu/.cursor/projects/workspace/uploads/reference-sample_d0f4.varve',
    'utf-8',
  ),
);

// Generate a unique ID for nodes
let nodeCounter = 1;
function makeNodeId() {
  const id = `n${nodeCounter}_${crypto.randomBytes(8).toString('hex')}`;
  nodeCounter++;
  return id;
}

// Document structure - using 2.33 format with designCanvases
const doc = {
  id: crypto.randomUUID(),
  formatVersion: '2.33',
  name: 'Halloween Cookies',
  rootChildren: [],
  nodes: {},
  components: {},
  patternDefinitions: {},
  nextId: 1,
  selectionSets: { version: 1, sets: [] },
  savedAreaSelections: [],
  gridSettings: reference.gridSettings, // Copy from reference
  designCanvases: [],
  activeDesignCanvasId: null,
};

// Create canvas content root
const canvasRootId = makeNodeId();
doc.nodes[canvasRootId] = {
  id: canvasRootId,
  kind: 'group',
  name: 'Canvas 1 content',
  layerColor: null,
  order: 'a0',
  visible: true,
  locked: false,
  opacity: 1,
  blendMode: 'normal',
  rotation: 0,
  transform: [1, 0, 0, 1, 0, 0],
  fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
  children: [],
  effects: [],
};

doc.rootChildren = [canvasRootId];

// Create design canvas
const canvasId = `canvas-${canvasRootId}`;
doc.designCanvases = [
  {
    id: canvasId,
    name: 'Canvas 1',
    order: 'a0',
    contentRoot: canvasRootId,
  },
];
doc.activeDesignCanvasId = canvasId;

// Helper to create a speech balloon group
function createSpeechBalloon(text, x, y) {
  const groupId = makeNodeId();
  const bodyId = makeNodeId();
  const textId = makeNodeId();
  const tailId = makeNodeId();

  const textWidth = Math.max(text.length * 10, 60);
  const textHeight = 38.4;
  const padding = 18;
  const bodyWidth = textWidth + padding * 2;
  const bodyHeight = textHeight + padding * 2;

  // Text node - matching reference structure exactly
  doc.nodes[textId] = {
    id: textId,
    kind: 'text',
    name: `Text: ${text}`,
    nameMode: 'automatic',
    layerColor: null,
    order: 'a3',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    text: text,
    transform: [1, 0, 0, 1, padding, padding],
    w: textWidth,
    h: textHeight,
    fill: { space: 'rgb', r: 16, g: 21, b: 31, a: 255 },
    fontSize: 16,
    fontFamily: 'IBM Plex Sans Variable',
    fontWeight: 400,
    fontStyle: 'normal',
    lineHeight: 1.2,
    letterSpacing: 0,
    textAlign: 'left',
    textResizing: 'fixed',
    textMode: 'point',
    textWrapShape: 'ellipse',
    strokes: [],
    effects: [],
  };

  // Body shape
  doc.nodes[bodyId] = {
    id: bodyId,
    kind: 'shape',
    name: 'Speech balloon',
    layerColor: null,
    order: 'a0',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    shape: { kind: 'rect', x: 0, y: 0, w: bodyWidth, h: bodyHeight },
    transform: [1, 0, 0, 1, 0, 0],
    fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
    strokes: [
      {
        color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
        weight: 2,
        align: 'center',
        dashPattern: [],
        dashOffset: 0,
        cap: 'round',
        join: 'miter',
        miterLimit: 4,
        visible: true,
        id: `stroke-${bodyId}-0`,
      },
    ],
    effects: [],
    cornerRadius: 28,
  };

  // Tail path
  const tailCenterX = bodyWidth / 2;
  doc.nodes[tailId] = {
    id: tailId,
    kind: 'path',
    name: 'Balloon tail',
    layerColor: null,
    order: 'a1',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    transform: [1, 0, 0, 1, 0, 0],
    fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
    points: [
      { x: tailCenterX - 10, y: bodyHeight - 3, handleIn: null, handleOut: null },
      { x: tailCenterX, y: bodyHeight + 35, handleIn: null, handleOut: null },
      { x: tailCenterX + 10, y: bodyHeight - 3, handleIn: null, handleOut: null },
    ],
    closed: false,
    strokes: [
      {
        color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
        weight: 2,
        align: 'center',
        dashPattern: [],
        dashOffset: 0,
        cap: 'round',
        join: 'miter',
        miterLimit: 4,
        visible: true,
        id: `stroke-${tailId}-0`,
      },
    ],
    effects: [],
  };

  // Group node with callout metadata
  doc.nodes[groupId] = {
    id: groupId,
    kind: 'group',
    name: 'Speech balloon',
    layerColor: null,
    order: 'a5',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    transform: [1, 0, 0, 1, x, y],
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
    children: [bodyId, tailId, textId],
    effects: [],
    callout: {
      version: 1,
      kind: 'speech',
      bodyNodeId: bodyId,
      textNodeId: textId,
      tailNodeIds: [tailId],
      tails: [
        {
          nodeIds: [tailId],
          style: 'pointed',
        },
      ],
      padding: padding,
      fitToText: false,
      fitPolicy: 'reflow',
      parametric: true,
    },
  };

  return groupId;
}

// Create two balloons
const balloon1 = createSpeechBalloon('Perfect!', 200, 200);
const balloon2 = createSpeechBalloon('Hmm...', 500, 200);

// Add to canvas
doc.nodes[canvasRootId].children = [balloon1, balloon2];

// Update nextId
doc.nextId = nodeCounter;

// Write the file
fs.writeFileSync('marketing/sample-comic/halloween-cookies.varve', JSON.stringify(doc, null, 2));
console.log('Generated halloween-cookies.varve with designCanvases format');
console.log(`  Nodes: ${Object.keys(doc.nodes).length}`);
console.log(`  Balloons: 2`);
console.log(`  Format: v${doc.formatVersion} (designCanvases)`);
