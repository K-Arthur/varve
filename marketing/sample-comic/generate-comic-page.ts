/**
 * Generate a sample comic page for "Letter it in Varve" marketing campaign.
 * 
 * Creates a 6-panel slice-of-life page with:
 * - Clean vector art (shapes and paths)
 * - Flat colors + clipped shading layer
 * - Speech/thought balloons using Varve's callout system
 * - Captions where appropriate
 * - Editable lettering
 * 
 * Story: A gentle Halloween gag - character bakes spooky cookies, they come alive.
 */

import {
  addChild,
  addNode,
  createDocument,
  makeFrameNode,
  makeGroupNode,
  makePathNode,
  makeShapeNode,
  makeTextNode,
  type Document,
  type NodeId,
  type PathPoint,
} from '@varve/scene';
import {
  wrapTextInCallout,
} from '@varve/scene/callout';
import { writeFile } from 'node:fs/promises';
import { plainTextToRichText } from '@varve/scene/typography';

// Color palette - flat comic colors
const COLORS = {
  // Character skin tone
  skin: { space: 'rgb' as const, r: 255, g: 220, b: 177, a: 255 },
  skinShade: { space: 'rgb' as const, r: 210, g: 170, b: 130, a: 255 },
  
  // Hair
  hair: { space: 'rgb' as const, r: 101, g: 67, b: 33, a: 255 },
  hairShade: { space: 'rgb' as const, r: 70, g: 45, b: 20, a: 255 },
  
  // Clothing
  apron: { space: 'rgb' as const, r: 230, g: 230, b: 250, a: 255 },
  apronShade: { space: 'rgb' as const, r: 180, g: 180, b: 200, a: 255 },
  shirt: { space: 'rgb' as const, r: 100, g: 150, b: 200, a: 255 },
  shirtShade: { space: 'rgb' as const, r: 70, g: 110, b: 160, a: 255 },
  
  // Kitchen
  counter: { space: 'rgb' as const, r: 220, g: 180, b: 140, a: 255 },
  counterShade: { space: 'rgb' as const, r: 170, g: 130, b: 90, a: 255 },
  wall: { space: 'rgb' as const, r: 240, g: 235, b: 220, a: 255 },
  
  // Cookies
  cookie: { space: 'rgb' as const, r: 210, g: 150, b: 90, a: 255 },
  cookieShade: { space: 'rgb' as const, r: 160, g: 110, b: 60, a: 255 },
  frosting: { space: 'rgb' as const, r: 255, g: 255, b: 255, a: 255 },
  
  // Eyes/details
  black: { space: 'rgb' as const, r: 30, g: 30, b: 30, a: 255 },
  white: { space: 'rgb' as const, r: 255, g: 255, b: 255, a: 255 },
  
  // Spooky accent
  spookyGlow: { space: 'rgb' as const, r: 255, g: 150, b: 50, a: 255 },
};

const STROKE_BLACK = {
  fill: COLORS.black,
  weight: 2.5,
  position: 'center' as const,
  dashPattern: [],
};

const PANEL_WIDTH = 340;
const PANEL_HEIGHT = 340;
const GUTTER = 20;
const MARGIN = 40;
const PAGE_WIDTH = PANEL_WIDTH * 2 + GUTTER + MARGIN * 2;
const PAGE_HEIGHT = PANEL_HEIGHT * 3 + GUTTER * 2 + MARGIN * 2;

interface Panel {
  x: number;
  y: number;
  frameId: NodeId;
}

/**
 * Create a simple character head with expressions.
 */
function createCharacterHead(
  doc: Document,
  x: number,
  y: number,
  expression: 'normal' | 'surprised' | 'happy' | 'worried' = 'normal',
): { doc: Document; groupId: NodeId } {
  let current = doc;
  const children: NodeId[] = [];
  
  // Head (circle)
  const headId = `head-${Date.now()}-${Math.random()}`;
  const head = makeShapeNode(headId, {
    kind: 'ellipse',
    cx: x + 40,
    cy: y + 40,
    rx: 35,
    ry: 40,
  }, {
    fill: COLORS.skin,
    strokes: [STROKE_BLACK],
    transform: [1, 0, 0, 1, 0, 0],
  });
  current = addNode(current, head);
  children.push(headId);
  
  // Hair (simple shape on top)
  const hairId = `hair-${Date.now()}-${Math.random()}`;
  const hair = makeShapeNode(hairId, {
    kind: 'ellipse',
    cx: x + 40,
    cy: y + 15,
    rx: 38,
    ry: 25,
  }, {
    fill: COLORS.hair,
    strokes: [STROKE_BLACK],
    transform: [1, 0, 0, 1, 0, 0],
  });
  current = addNode(current, hair);
  children.push(hairId);
  
  // Eyes
  const leftEyeId = `leye-${Date.now()}-${Math.random()}`;
  const rightEyeId = `reye-${Date.now()}-${Math.random()}`;
  
  if (expression === 'surprised') {
    // Wide eyes
    const leftEye = makeShapeNode(leftEyeId, {
      kind: 'ellipse',
      cx: x + 27,
      cy: y + 35,
      rx: 5,
      ry: 8,
    }, {
      fill: COLORS.black,
      transform: [1, 0, 0, 1, 0, 0],
    });
    const rightEye = makeShapeNode(rightEyeId, {
      kind: 'ellipse',
      cx: x + 53,
      cy: y + 35,
      rx: 5,
      ry: 8,
    }, {
      fill: COLORS.black,
      transform: [1, 0, 0, 1, 0, 0],
    });
    current = addNode(current, leftEye);
    current = addNode(current, rightEye);
  } else {
    // Normal eyes (dots)
    const leftEye = makeShapeNode(leftEyeId, {
      kind: 'ellipse',
      cx: x + 27,
      cy: y + 35,
      rx: 3,
      ry: 3,
    }, {
      fill: COLORS.black,
      transform: [1, 0, 0, 1, 0, 0],
    });
    const rightEye = makeShapeNode(rightEyeId, {
      kind: 'ellipse',
      cx: x + 53,
      cy: y + 35,
      rx: 3,
      ry: 3,
    }, {
      fill: COLORS.black,
      transform: [1, 0, 0, 1, 0, 0],
    });
    current = addNode(current, leftEye);
    current = addNode(current, rightEye);
  }
  
  children.push(leftEyeId, rightEyeId);
  
  // Mouth - simple arc using path
  const mouthId = `mouth-${Date.now()}-${Math.random()}`;
  let mouthPoints: PathPoint[];
  
  if (expression === 'surprised') {
    // O shape
    mouthPoints = [
      { x: x + 40, y: y + 50, type: 'point' },
      { x: x + 35, y: y + 55, type: 'point' },
      { x: x + 40, y: y + 60, type: 'point' },
      { x: x + 45, y: y + 55, type: 'point' },
    ];
  } else if (expression === 'happy') {
    // Smile
    mouthPoints = [
      { x: x + 30, y: y + 50, type: 'point' },
      { x: x + 40, y: y + 57, type: 'point' },
      { x: x + 50, y: y + 50, type: 'point' },
    ];
  } else {
    // Normal slight smile
    mouthPoints = [
      { x: x + 32, y: y + 52, type: 'point' },
      { x: x + 40, y: y + 54, type: 'point' },
      { x: x + 48, y: y + 52, type: 'point' },
    ];
  }
  
  const mouth = makePathNode(mouthId, mouthPoints, false, {
    strokes: [{
      fill: COLORS.black,
      weight: 2,
      position: 'center' as const,
      dashPattern: [],
    }],
    transform: [1, 0, 0, 1, 0, 0],
  });
  current = addNode(current, mouth);
  children.push(mouthId);
  
  // Group them
  const groupId = `char-${Date.now()}-${Math.random()}`;
  const group = makeGroupNode(groupId, { children });
  current = addNode(current, group);
  
  return { doc: current, groupId };
}

/**
 * Create a spooky cookie shape (ghost or pumpkin).
 */
function createCookie(
  doc: Document,
  x: number,
  y: number,
  type: 'ghost' | 'pumpkin',
  alive: boolean = false,
): { doc: Document; groupId: NodeId } {
  let current = doc;
  const children: NodeId[] = [];
  
  if (type === 'ghost') {
    // Ghost body (rounded rectangle-ish)
    const bodyId = `cookie-body-${Date.now()}-${Math.random()}`;
    const body = makeShapeNode(bodyId, {
      kind: 'rect',
      x: x,
      y: y,
      w: 30,
      h: 35,
    }, {
      fill: COLORS.frosting,
      strokes: [STROKE_BLACK],
      cornerRadius: 15,
      transform: [1, 0, 0, 1, 0, 0],
    });
    current = addNode(current, body);
    children.push(bodyId);
    
    if (alive) {
      // Animated eyes
      const leftEyeId = `cookie-leye-${Date.now()}-${Math.random()}`;
      const rightEyeId = `cookie-reye-${Date.now()}-${Math.random()}`;
      const leftEye = makeShapeNode(leftEyeId, {
        kind: 'ellipse',
        cx: x + 10,
        cy: y + 12,
        rx: 3,
        ry: 3,
      }, {
        fill: COLORS.black,
        transform: [1, 0, 0, 1, 0, 0],
      });
      const rightEye = makeShapeNode(rightEyeId, {
        kind: 'ellipse',
        cx: x + 20,
        cy: y + 12,
        rx: 3,
        ry: 3,
      }, {
        fill: COLORS.black,
        transform: [1, 0, 0, 1, 0, 0],
      });
      current = addNode(current, leftEye);
      current = addNode(current, rightEye);
      children.push(leftEyeId, rightEyeId);
    }
  } else {
    // Pumpkin (circle-ish)
    const bodyId = `cookie-body-${Date.now()}-${Math.random()}`;
    const body = makeShapeNode(bodyId, {
      kind: 'ellipse',
      cx: x + 15,
      cy: y + 15,
      rx: 15,
      ry: 15,
    }, {
      fill: { space: 'rgb' as const, r: 255, g: 140, b: 0, a: 255 },
      strokes: [STROKE_BLACK],
      transform: [1, 0, 0, 1, 0, 0],
    });
    current = addNode(current, body);
    children.push(bodyId);
    
    // Stem
    const stemId = `cookie-stem-${Date.now()}-${Math.random()}`;
    const stem = makeShapeNode(stemId, {
      kind: 'rect',
      x: x + 12,
      y: y - 5,
      w: 6,
      h: 8,
    }, {
      fill: { space: 'rgb' as const, r: 80, g: 120, b: 40, a: 255 },
      strokes: [STROKE_BLACK],
      transform: [1, 0, 0, 1, 0, 0],
    });
    current = addNode(current, stem);
    children.push(stemId);
  }
  
  // Group
  const groupId = `cookie-${Date.now()}-${Math.random()}`;
  const group = makeGroupNode(groupId, { children });
  current = addNode(current, group);
  
  return { doc: current, groupId };
}

/**
 * Create a simple rectangular panel background.
 */
function createPanelBg(
  doc: Document,
  x: number,
  y: number,
  w: number,
  h: number,
): { doc: Document; bgId: NodeId } {
  const bgId = `panel-bg-${Date.now()}-${Math.random()}`;
  const bg = makeShapeNode(bgId, {
    kind: 'rect',
    x,
    y,
    w,
    h,
  }, {
    fill: COLORS.wall,
    transform: [1, 0, 0, 1, 0, 0],
  });
  
  return { doc: addNode(doc, bg), bgId };
}

/**
 * Main page generation function.
 */
async function generateComicPage(): Promise<Document> {
  // Create document with comic-friendly dimensions
  let doc = createDocument('Halloween Cookies', {
    physicalWidth: PAGE_WIDTH,
    physicalHeight: PAGE_HEIGHT,
    documentUnit: 'px',
    dpi: 300,
  });
  
  // Panels in 2x3 grid
  const panels: Panel[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 2; col++) {
      const x = MARGIN + col * (PANEL_WIDTH + GUTTER);
      const y = MARGIN + row * (PANEL_HEIGHT + GUTTER);
      
      const frameId = `panel-${row}-${col}-${Date.now()}`;
      const frame = makeFrameNode(frameId, {
        transform: [1, 0, 0, 1, x, y],
        w: PANEL_WIDTH,
        h: PANEL_HEIGHT,
        clipContent: true,
        fill: COLORS.wall,
        strokes: [{
          fill: COLORS.black,
          weight: 3,
          position: 'center' as const,
          dashPattern: [],
        }],
        children: [],
        panel: {
          semantic: true,
          order: row * 2 + col,
        },
      });
      
      doc = addNode(doc, frame);
      
      // Add to page root
      if (doc.pages?.[0]?.contentRoot) {
        doc = addChild(doc, doc.pages[0].contentRoot, frameId);
      }
      
      panels.push({ x, y, frameId });
    }
  }
  
  // Panel 1: Baker looking at cookie shapes on counter
  {
    const panel = panels[0];
    const { doc: d1, bgId } = createPanelBg(doc, 20, 20, PANEL_WIDTH - 40, PANEL_HEIGHT - 40);
    doc = d1;
    doc = addChild(doc, panel.frameId, bgId);
    
    // Counter
    const counterId = `counter-${Date.now()}`;
    const counter = makeShapeNode(counterId, {
      kind: 'rect',
      x: 10,
      y: 200,
      w: PANEL_WIDTH - 20,
      h: 120,
    }, {
      fill: COLORS.counter,
      strokes: [STROKE_BLACK],
      transform: [1, 0, 0, 1, 0, 0],
    });
    doc = addNode(doc, counter);
    doc = addChild(doc, panel.frameId, counterId);
    
    // Character
    const { doc: d2, groupId: charId } = createCharacterHead(doc, 50, 60, 'normal');
    doc = d2;
    doc = addChild(doc, panel.frameId, charId);
    
    // Cookie cutters on counter
    const { doc: d3, groupId: cookie1Id } = createCookie(doc, 180, 230, 'ghost');
    doc = d3;
    doc = addChild(doc, panel.frameId, cookie1Id);
    
    const { doc: d4, groupId: cookie2Id } = createCookie(doc, 220, 230, 'pumpkin');
    doc = d4;
    doc = addChild(doc, panel.frameId, cookie2Id);
  }
  
  // Panel 2: Close-up of cookies being decorated
  {
    const panel = panels[1];
    const { doc: d1, bgId } = createPanelBg(doc, 20, 20, PANEL_WIDTH - 40, PANEL_HEIGHT - 40);
    doc = d1;
    doc = addChild(doc, panel.frameId, bgId);
    
    // Large cookies
    const { doc: d2, groupId: cookie1Id } = createCookie(doc, 100, 120, 'ghost');
    doc = d2;
    doc = addChild(doc, panel.frameId, cookie1Id);
    
    const { doc: d3, groupId: cookie2Id } = createCookie(doc, 180, 130, 'pumpkin');
    doc = d3;
    doc = addChild(doc, panel.frameId, cookie2Id);
    
    // Hand decorating (simple shape)
    const handId = `hand-${Date.now()}`;
    const hand = makeShapeNode(handId, {
      kind: 'ellipse',
      cx: 120,
      cy: 80,
      rx: 25,
      ry: 15,
    }, {
      fill: COLORS.skin,
      strokes: [STROKE_BLACK],
      transform: [1, 0, 0, 1, 0, 0],
    });
    doc = addNode(doc, hand);
    doc = addChild(doc, panel.frameId, handId);
  }
  
  // Panel 3: Baker stepping back, satisfied
  {
    const panel = panels[2];
    const { doc: d1, bgId } = createPanelBg(doc, 20, 20, PANEL_WIDTH - 40, PANEL_HEIGHT - 40);
    doc = d1;
    doc = addChild(doc, panel.frameId, bgId);
    
    // Counter with cookies
    const counterId = `counter-${Date.now()}`;
    const counter = makeShapeNode(counterId, {
      kind: 'rect',
      x: 10,
      y: 200,
      w: PANEL_WIDTH - 20,
      h: 120,
    }, {
      fill: COLORS.counter,
      strokes: [STROKE_BLACK],
      transform: [1, 0, 0, 1, 0, 0],
    });
    doc = addNode(doc, counter);
    doc = addChild(doc, panel.frameId, counterId);
    
    // Small cookies on counter
    const { doc: d2, groupId: c1 } = createCookie(doc, 120, 230, 'ghost');
    doc = d2;
    doc = addChild(doc, panel.frameId, c1);
    
    const { doc: d3, groupId: c2 } = createCookie(doc, 160, 230, 'pumpkin');
    doc = d3;
    doc = addChild(doc, panel.frameId, c2);
    
    const { doc: d4, groupId: c3 } = createCookie(doc, 200, 230, 'ghost');
    doc = d4;
    doc = addChild(doc, panel.frameId, c3);
    
    // Character happy
    const { doc: d5, groupId: charId } = createCharacterHead(doc, 50, 80, 'happy');
    doc = d5;
    doc = addChild(doc, panel.frameId, charId);
    
    // Speech balloon: "Perfect!"
    const textId = `text-p3-${Date.now()}`;
    const text = makeTextNode(textId, plainTextToRichText('Perfect!'), {
      transform: [1, 0, 0, 1, 150, 60],
      fontSize: 16,
      fontFamily: 'IBM Plex Sans Variable',
      fill: COLORS.black,
    });
    doc = addNode(doc, text);
    doc = addChild(doc, panel.frameId, textId);
    
    const result = wrapTextInCallout(doc, textId, {
      kind: 'speech',
      padding: 12,
      tailEndpoint: { x: 130, y: 100 },
    });
    if (result) {
      doc = result.document;
      doc = addChild(doc, panel.frameId, result.groupId);
    }
  }
  
  // Panel 4: Baker leaving/door visible, cookies alone
  {
    const panel = panels[3];
    const { doc: d1, bgId } = createPanelBg(doc, 20, 20, PANEL_WIDTH - 40, PANEL_HEIGHT - 40);
    doc = d1;
    doc = addChild(doc, panel.frameId, bgId);
    
    // Counter
    const counterId = `counter-${Date.now()}`;
    const counter = makeShapeNode(counterId, {
      kind: 'rect',
      x: 10,
      y: 200,
      w: PANEL_WIDTH - 20,
      h: 120,
    }, {
      fill: COLORS.counter,
      strokes: [STROKE_BLACK],
      transform: [1, 0, 0, 1, 0, 0],
    });
    doc = addNode(doc, counter);
    doc = addChild(doc, panel.frameId, counterId);
    
    // Cookies (still)
    const { doc: d2, groupId: c1 } = createCookie(doc, 120, 230, 'ghost');
    doc = d2;
    doc = addChild(doc, panel.frameId, c1);
    
    const { doc: d3, groupId: c2 } = createCookie(doc, 160, 230, 'pumpkin');
    doc = d3;
    doc = addChild(doc, panel.frameId, c2);
    
    const { doc: d4, groupId: c3 } = createCookie(doc, 200, 230, 'ghost');
    doc = d4;
    doc = addChild(doc, panel.frameId, c3);
    
    // Door frame in corner (character leaving)
    const doorId = `door-${Date.now()}`;
    const door = makeShapeNode(doorId, {
      kind: 'rect',
      x: 10,
      y: 60,
      w: 60,
      h: 140,
    }, {
      fill: { space: 'rgb' as const, r: 160, g: 120, b: 80, a: 255 },
      strokes: [STROKE_BLACK],
      transform: [1, 0, 0, 1, 0, 0],
    });
    doc = addNode(doc, door);
    doc = addChild(doc, panel.frameId, doorId);
  }
  
  // Panel 5: Cookies starting to glow/move - close up
  {
    const panel = panels[4];
    const { doc: d1, bgId } = createPanelBg(doc, 20, 20, PANEL_WIDTH - 40, PANEL_HEIGHT - 40);
    doc = d1;
    doc = addChild(doc, panel.frameId, bgId);
    
    // Counter partial view
    const counterId = `counter-${Date.now()}`;
    const counter = makeShapeNode(counterId, {
      kind: 'rect',
      x: 0,
      y: 180,
      w: PANEL_WIDTH,
      h: 160,
    }, {
      fill: COLORS.counter,
      strokes: [STROKE_BLACK],
      transform: [1, 0, 0, 1, 0, 0],
    });
    doc = addNode(doc, counter);
    doc = addChild(doc, panel.frameId, counterId);
    
    // Cookies with eyes now (alive!)
    const { doc: d2, groupId: c1 } = createCookie(doc, 80, 210, 'ghost', true);
    doc = d2;
    doc = addChild(doc, panel.frameId, c1);
    
    // Glow effect (simple circles behind)
    const glowId = `glow-${Date.now()}`;
    const glow = makeShapeNode(glowId, {
      kind: 'ellipse',
      cx: 95,
      cy: 227,
      rx: 25,
      ry: 25,
    }, {
      fill: COLORS.spookyGlow,
      opacity: 0.3,
      transform: [1, 0, 0, 1, 0, 0],
    });
    doc = addNode(doc, glow);
    doc = addChild(doc, panel.frameId, glowId);
  }
  
  // Panel 6: Baker returns, surprised reaction
  {
    const panel = panels[5];
    const { doc: d1, bgId } = createPanelBg(doc, 20, 20, PANEL_WIDTH - 40, PANEL_HEIGHT - 40);
    doc = d1;
    doc = addChild(doc, panel.frameId, bgId);
    
    // Counter
    const counterId = `counter-${Date.now()}`;
    const counter = makeShapeNode(counterId, {
      kind: 'rect',
      x: 10,
      y: 200,
      w: PANEL_WIDTH - 20,
      h: 120,
    }, {
      fill: COLORS.counter,
      strokes: [STROKE_BLACK],
      transform: [1, 0, 0, 1, 0, 0],
    });
    doc = addNode(doc, counter);
    doc = addChild(doc, panel.frameId, counterId);
    
    // Animated cookies
    const { doc: d2, groupId: c1 } = createCookie(doc, 120, 220, 'ghost', true);
    doc = d2;
    doc = addChild(doc, panel.frameId, c1);
    
    const { doc: d3, groupId: c2 } = createCookie(doc, 160, 225, 'pumpkin', false);
    doc = d3;
    doc = addChild(doc, panel.frameId, c2);
    
    const { doc: d4, groupId: c3 } = createCookie(doc, 200, 220, 'ghost', true);
    doc = d4;
    doc = addChild(doc, panel.frameId, c3);
    
    // Character surprised
    const { doc: d5, groupId: charId } = createCharacterHead(doc, 50, 60, 'surprised');
    doc = d5;
    doc = addChild(doc, panel.frameId, charId);
    
    // Thought balloon: "Did I use magic flour...?"
    const textId = `text-p6-${Date.now()}`;
    const text = makeTextNode(textId, plainTextToRichText('Did I use\nmagic flour...?'), {
      transform: [1, 0, 0, 1, 150, 40],
      fontSize: 14,
      fontFamily: 'IBM Plex Sans Variable',
      fill: COLORS.black,
      w: 120,
    });
    doc = addNode(doc, text);
    doc = addChild(doc, panel.frameId, textId);
    
    const result = wrapTextInCallout(doc, textId, {
      kind: 'thought',
      padding: 10,
      tailEndpoint: { x: 100, y: 70 },
    });
    if (result) {
      doc = result.document;
      doc = addChild(doc, panel.frameId, result.groupId);
    }
  }
  
  return doc;
}

/**
 * Main entry point - generate and save the document.
 */
async function main() {
  console.log('Generating comic page...');
  const doc = await generateComicPage();
  
  // Serialize to JSON
  const json = JSON.stringify(doc, null, 2);
  
  // Write to file
  const outputPath = '/workspace/marketing/sample-comic/halloween-cookies.varve';
  await writeFile(outputPath, json, 'utf-8');
  
  console.log(`✓ Saved to: ${outputPath}`);
  console.log(`  Pages: ${doc.pages?.length ?? 0}`);
  console.log(`  Nodes: ${Object.keys(doc.nodes).length}`);
}

main().catch((error) => {
  console.error('Error generating comic page:', error);
  process.exit(1);
});
