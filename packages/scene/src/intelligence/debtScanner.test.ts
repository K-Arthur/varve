import { describe, expect, it } from 'vitest';
import { createDocument } from '../document';
import { addSwatch } from '../swatches';
import type { FrameNode, SceneNode, TextNode } from '../types';
import {
  checkDuplicateStyles,
  checkExcessiveNesting,
  checkHardcodedFontSizes,
  checkInconsistentBorderRadius,
  checkInlineSpacing,
  checkMissingExportPresets,
  checkMissingFonts,
  checkMixedColorSpaces,
  checkNamingViolations,
  checkOrphanedStyles,
  checkOversetText,
  checkUnnamedLayers,
  checkUntokenizedColors,
  checkUnusedComponents,
  runDebtScan,
} from './debtScanner';

function makeShape(
  name: string,
  color: { r: number; g: number; b: number; a?: number },
  cornerRadius = 0,
): SceneNode {
  return {
    id: `shape-${name}`,
    name,
    kind: 'shape',
    fill: { space: 'rgb', r: color.r, g: color.g, b: color.b, a: color.a ?? 255 },
    shape: { kind: 'rect', w: 100, h: 100, x: 0, y: 0, cornerRadius },
    transform: [1, 0, 0, 1, 0, 0],
    strokes: [],
    effects: [],
    order: 'a0',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
  } as unknown as SceneNode;
}

function makeFrame(name: string, layoutStyle?: FrameNode['layoutStyle']): FrameNode {
  return {
    id: `frame-${name}`,
    name,
    kind: 'frame',
    fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
    w: 200,
    h: 200,
    children: [],
    transform: [1, 0, 0, 1, 0, 0],
    strokes: [],
    effects: [],
    order: 'a0',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    layoutStyle,
  } as unknown as FrameNode;
}

function makeText(name: string, fontSize = 16, fontFamily = 'Inter'): TextNode {
  return {
    id: `text-${name}`,
    name,
    kind: 'text',
    text: 'Hello',
    fontSize,
    fontFamily,
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
    transform: [1, 0, 0, 1, 0, 0],
    strokes: [],
    effects: [],
    order: 'a0',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
  } as unknown as TextNode;
}

describe('runDebtScan', () => {
  it('returns report for an empty document', () => {
    const doc = createDocument();
    const report = runDebtScan(doc);
    // createDocument creates a default page root node, which may trigger missing-export-presets
    expect(report.totalErrors).toBe(0);
    expect(report.totalWarnings).toBe(0);
  });
});

describe('checkUntokenizedColors', () => {
  it('flags a color not in swatches', () => {
    let doc = createDocument();
    doc = addSwatch(doc, 'Brand Red', { space: 'rgb', r: 255, g: 0, b: 0, a: 255 });
    const node = makeShape('box', { r: 0, g: 128, b: 128, a: 255 });
    doc = { ...doc, nodes: { [node.id]: node }, rootChildren: [node.id] };
    const issues = checkUntokenizedColors(doc);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.checkId).toBe('untokenized-colors');
  });

  it('returns no issues when there are no swatches', () => {
    const doc = createDocument();
    const node = makeShape('box', { r: 0, g: 128, b: 128, a: 255 });
    const docWithNode = { ...doc, nodes: { [node.id]: node }, rootChildren: [node.id] };
    expect(checkUntokenizedColors(docWithNode)).toEqual([]);
  });

  it('provides an autoFix that adds the color as a new swatch', () => {
    let doc = createDocument();
    doc = addSwatch(doc, 'Brand Red', { space: 'rgb', r: 255, g: 0, b: 0, a: 255 });
    const node = makeShape('box', { r: 0, g: 128, b: 128, a: 255 });
    doc = { ...doc, nodes: { [node.id]: node }, rootChildren: [node.id] };

    const issues = checkUntokenizedColors(doc);
    expect(issues[0]!.fixable).toBe(true);
    const fixed = issues[0]!.autoFix!(doc);
    expect(fixed.swatches).toHaveLength(2);
    expect(checkUntokenizedColors(fixed)).toEqual([]);
  });
});

describe('checkInlineSpacing', () => {
  it('flags a frame with off-grid gap', () => {
    const doc = createDocument();
    const frame = makeFrame('row', {
      mode: 'flex',
      direction: 'row',
      gap: 5,
      wrap: false,
      padding: [0, 0, 0, 0],
      grow: 0,
      shrink: 1,
    });
    const docWithFrame = { ...doc, nodes: { [frame.id]: frame }, rootChildren: [frame.id] };
    const issues = checkInlineSpacing(docWithFrame);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.checkId).toBe('inline-spacing');
  });

  it('allows a frame with grid-aligned spacing', () => {
    const doc = createDocument();
    const frame = makeFrame('row', {
      mode: 'flex',
      direction: 'row',
      gap: 8,
      wrap: false,
      padding: [16, 16, 16, 16],
      grow: 0,
      shrink: 1,
    });
    const docWithFrame = { ...doc, nodes: { [frame.id]: frame }, rootChildren: [frame.id] };
    expect(checkInlineSpacing(docWithFrame)).toEqual([]);
  });
});

describe('checkNamingViolations', () => {
  it('flags a component not in PascalCase', () => {
    const doc = createDocument();
    const docWithComp = {
      ...doc,
      components: {
        '1': { id: '1', name: 'primary-button', properties: [], variants: [], children: [] },
      },
    } as unknown as typeof doc;
    const issues = checkNamingViolations(docWithComp);
    expect(issues.some((i) => i.message.includes('primary-button'))).toBe(true);
  });
});

describe('checkOrphanedStyles', () => {
  it('reports an orphaned style', () => {
    const doc = createDocument();
    const docWithStyle = {
      ...doc,
      styles: {
        '1': {
          id: '1',
          name: 'Unused',
          type: 'color',
          description: '',
          color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
        },
      },
    } as unknown as typeof doc;
    const issues = checkOrphanedStyles(docWithStyle);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.checkId).toBe('orphan-styles');
  });
});

describe('checkUnusedComponents', () => {
  it('reports an unused component', () => {
    const doc = createDocument();
    const docWithComp = {
      ...doc,
      components: { '1': { id: '1', name: 'Unused', properties: [], variants: [], children: [] } },
    } as unknown as typeof doc;
    const issues = checkUnusedComponents(docWithComp);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.checkId).toBe('unused-components');
  });
});

describe('checkMissingFonts', () => {
  it('flags a text node with an unavailable font', () => {
    const doc = createDocument();
    const text = makeText('label', 16, 'Comic Sans');
    const docWithText = { ...doc, nodes: { [text.id]: text }, rootChildren: [text.id] };
    const issues = checkMissingFonts(docWithText, { availableFonts: new Set(['Inter', 'Roboto']) });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.checkId).toBe('missing-fonts');
  });

  it('returns no issues when no font registry is supplied', () => {
    const doc = createDocument();
    const text = makeText('label', 16, 'Unknown');
    const docWithText = { ...doc, nodes: { [text.id]: text }, rootChildren: [text.id] };
    expect(checkMissingFonts(docWithText, {})).toEqual([]);
  });

  it('provides an autoFix that swaps to the first available font', () => {
    const doc = createDocument();
    const text = makeText('label', 16, 'Comic Sans');
    const docWithText = { ...doc, nodes: { [text.id]: text }, rootChildren: [text.id] };
    const opts = { availableFonts: new Set(['Inter', 'Roboto']) };

    const issues = checkMissingFonts(docWithText, opts);
    expect(issues[0]!.fixable).toBe(true);
    const fixed = issues[0]!.autoFix!(docWithText);
    expect((fixed.nodes[text.id] as typeof text).fontFamily).toBe('Inter');
    expect(checkMissingFonts(fixed, opts)).toEqual([]);
  });
});

describe('checkDuplicateStyles', () => {
  it('flags duplicate styles with identical properties', () => {
    const doc = createDocument();
    doc.styles = {
      '1': {
        id: '1',
        name: 'Red',
        type: 'color',
        description: '',
        fill: {
          type: 'solid',
          color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      },
      '2': {
        fill: {
          visible: true,
          blendMode: 'normal',
          opacity: 1,
          color: { a: 255, b: 0, g: 0, r: 255, space: 'rgb' },
          type: 'solid',
        },
        description: '',
        type: 'color',
        name: 'Crimson',
        id: '2',
      },
    };
    doc.rootChildren = [];
    const issues = checkDuplicateStyles(doc);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.checkId).toBe('duplicate-styles');
  });
});

describe('checkInconsistentBorderRadius', () => {
  it('reports when more than 2 distinct radius values are used', () => {
    const doc = createDocument();
    const node1 = makeShape('rect1', { r: 0, g: 0, b: 0, a: 255 }, 8);
    const node2 = makeShape('rect2', { r: 0, g: 0, b: 0, a: 255 }, 12);
    const node3 = makeShape('rect3', { r: 0, g: 0, b: 0, a: 255 }, 16);
    const docWithNodes = {
      ...doc,
      nodes: { [node1.id]: node1, [node2.id]: node2, [node3.id]: node3 },
      rootChildren: [node1.id, node2.id, node3.id],
    };
    const issues = checkInconsistentBorderRadius(docWithNodes);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.checkId).toBe('inconsistent-radius');
  });
});

describe('checkHardcodedFontSizes', () => {
  it('flags font sizes not on type scale', () => {
    const doc = createDocument();
    const text = makeText('label', 15);
    const docWithText = { ...doc, nodes: { [text.id]: text }, rootChildren: [text.id] };
    const issues = checkHardcodedFontSizes(docWithText);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.checkId).toBe('hardcoded-font-sizes');
  });
});

describe('checkMixedColorSpaces', () => {
  it('flags RGB fills in a CMYK document', () => {
    const doc = createDocument();
    const docWithCmyk = {
      ...doc,
      colorConfig: { mode: 'cmyk', profiles: { rgb: 'sRGB', cmyk: 'CoatedFOGRA39' } },
    } as unknown as typeof doc;
    const node = makeShape('box', { r: 0, g: 128, b: 128, a: 255 });
    const docWithNode = {
      ...docWithCmyk,
      nodes: { [node.id]: node },
      rootChildren: [node.id],
    } as unknown as typeof doc;
    const issues = checkMixedColorSpaces(docWithNode);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.checkId).toBe('mixed-color-spaces');
  });
});

describe('checkOversetText', () => {
  it('flags text nodes with overflow set to ellipsis or clip', () => {
    const doc = createDocument();
    const text = makeText('label', 16, 'Inter');
    const textWithOverflow = { ...text, textOverflow: 'ellipsis' as const };
    const docWithText = {
      ...doc,
      nodes: { [textWithOverflow.id]: textWithOverflow },
      rootChildren: [textWithOverflow.id],
    };
    const issues = checkOversetText(docWithText);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.checkId).toBe('overset-text');
  });
});

describe('checkUnnamedLayers', () => {
  it('flags nodes with default names', () => {
    const doc = createDocument();
    const node = makeShape('Rectangle 1', { r: 0, g: 0, b: 0, a: 255 });
    const docWithNode = { ...doc, nodes: { [node.id]: node }, rootChildren: [node.id] };
    const issues = checkUnnamedLayers(docWithNode);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.checkId).toBe('unnamed-layers');
  });
});

describe('checkExcessiveNesting', () => {
  it('flags when nesting depth exceeds 5', () => {
    const doc = createDocument();
    const frame1 = makeFrame('f1');
    const frame2 = makeFrame('f2');
    const frame3 = makeFrame('f3');
    const frame4 = makeFrame('f4');
    const frame5 = makeFrame('f5');
    const frame6 = makeFrame('f6');
    frame6.children = [];
    frame5.children = [frame6.id];
    frame4.children = [frame5.id];
    frame3.children = [frame4.id];
    frame2.children = [frame3.id];
    frame1.children = [frame2.id];
    const docWithNodes = {
      ...doc,
      nodes: {
        [frame1.id]: frame1,
        [frame2.id]: frame2,
        [frame3.id]: frame3,
        [frame4.id]: frame4,
        [frame5.id]: frame5,
        [frame6.id]: frame6,
      },
      rootChildren: [frame1.id],
    };
    const issues = checkExcessiveNesting(docWithNodes);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.checkId).toBe('excessive-nesting');
  });
});

describe('checkMissingExportPresets', () => {
  it('flags root nodes without export presets', () => {
    const doc = createDocument();
    const node = makeShape('root', { r: 0, g: 0, b: 0, a: 255 });
    const docWithNode = { ...doc, nodes: { [node.id]: node }, rootChildren: [node.id] };
    const issues = checkMissingExportPresets(docWithNode);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.checkId).toBe('missing-export-presets');
  });
});
