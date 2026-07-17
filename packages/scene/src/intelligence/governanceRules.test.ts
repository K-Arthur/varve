import { describe, expect, it } from 'vitest';
import type { FrameNode, SceneNode, TextNode } from '../types';
import { createDocument } from '../document';
import { addSwatch } from '../swatches';
import {
  ruleFonts,
  ruleNaming,
  ruleOrphans,
  ruleSpacingTokens,
  ruleTokenColors,
  runGovernanceRules,
} from './governanceRules';

function makeShape(
  name: string,
  color: { r: number; g: number; b: number; a?: number },
): SceneNode {
  return {
    id: `shape-${name}`,
    name,
    kind: 'shape',
    fill: { space: 'rgb', r: color.r, g: color.g, b: color.b, a: color.a ?? 255 },
    shape: { kind: 'rect', w: 100, h: 100, x: 0, y: 0, cornerRadius: 0 },
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

function makeText(name: string, fontFamily = 'Inter'): TextNode {
  return {
    id: `text-${name}`,
    name,
    kind: 'text',
    text: 'Hello',
    fontSize: 16,
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

describe('runGovernanceRules', () => {
  it('returns empty array for an empty document', () => {
    const doc = createDocument();
    expect(runGovernanceRules(doc)).toEqual([]);
  });
});

describe('ruleTokenColors', () => {
  it('flags a color not in swatches', () => {
    let doc = createDocument();
    doc = addSwatch(doc, 'Brand Red', { space: 'rgb', r: 255, g: 0, b: 0, a: 255 });
    const node = makeShape('box', { r: 0, g: 128, b: 128, a: 255 });
    doc = { ...doc, nodes: { [node.id]: node }, rootChildren: [node.id] };
    const issues = ruleTokenColors(doc, {});
    expect(issues).toHaveLength(1);
    expect(issues[0]!.ruleId).toBe('token-color');
    expect(issues[0]!.nodeId).toBe(node.id);
  });

  it('skips fully transparent colors', () => {
    let doc = createDocument();
    doc = addSwatch(doc, 'Brand Red', { space: 'rgb', r: 255, g: 0, b: 0, a: 255 });
    const node = makeShape('box', { r: 0, g: 128, b: 128, a: 0 });
    doc = { ...doc, nodes: { [node.id]: node }, rootChildren: [node.id] };
    expect(ruleTokenColors(doc, {})).toEqual([]);
  });

  it('allows colors matching a swatch', () => {
    let doc = createDocument();
    doc = addSwatch(doc, 'Brand Red', { space: 'rgb', r: 255, g: 0, b: 0, a: 255 });
    const node = makeShape('box', { r: 255, g: 0, b: 0, a: 255 });
    doc = { ...doc, nodes: { [node.id]: node }, rootChildren: [node.id] };
    expect(ruleTokenColors(doc, {})).toEqual([]);
  });

  it('returns no issues when there are no swatches', () => {
    const doc = createDocument();
    const node = makeShape('box', { r: 0, g: 128, b: 128, a: 255 });
    const docWithNode = { ...doc, nodes: { [node.id]: node }, rootChildren: [node.id] };
    expect(ruleTokenColors(docWithNode, {})).toEqual([]);
  });
});

describe('ruleSpacingTokens', () => {
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
    const issues = ruleSpacingTokens(docWithFrame, {});
    expect(issues).toHaveLength(1);
    expect(issues[0]!.ruleId).toBe('spacing-token');
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
    expect(ruleSpacingTokens(docWithFrame, {})).toEqual([]);
  });

  it('ignores frames without layoutStyle', () => {
    const doc = createDocument();
    const frame = makeFrame('plain');
    const docWithFrame = { ...doc, nodes: { [frame.id]: frame }, rootChildren: [frame.id] };
    expect(ruleSpacingTokens(docWithFrame, {})).toEqual([]);
  });
});

describe('ruleNaming', () => {
  it('flags a component not in PascalCase', () => {
    const doc = createDocument();
    const docWithComp = {
      ...doc,
      components: {
        '1': { id: '1', name: 'primary-button', properties: [], variants: [], children: [] },
      },
    } as unknown as typeof doc;
    const issues = ruleNaming(docWithComp);
    const componentIssue = issues.find((i) => i.targetName === 'primary-button');
    expect(componentIssue).toBeDefined();
    expect(componentIssue!.severity).toBe('error');
  });

  it('flags a style with a space in its name', () => {
    const doc = createDocument();
    const docWithStyle = {
      ...doc,
      styles: {
        '1': {
          id: '1',
          name: 'Heading 1',
          type: 'text',
          description: '',
          text: { fontFamily: 'Inter', fontSize: 16, fontWeight: 400 },
        },
      },
    } as unknown as typeof doc;
    const issues = ruleNaming(docWithStyle);
    expect(issues.some((i) => i.message.includes('Heading 1'))).toBe(true);
  });
});

describe('ruleOrphans', () => {
  it('reports an unused component', () => {
    const doc = createDocument();
    const docWithComp = {
      ...doc,
      components: { '1': { id: '1', name: 'Unused', properties: [], variants: [], children: [] } },
    } as unknown as typeof doc;
    const issues = ruleOrphans(docWithComp);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.ruleId).toBe('orphan');
  });
});

describe('ruleFonts', () => {
  it('flags a text node with an unavailable font', () => {
    const doc = createDocument();
    const text = makeText('label', 'Comic Sans');
    const docWithText = { ...doc, nodes: { [text.id]: text }, rootChildren: [text.id] };
    const issues = ruleFonts(docWithText, { availableFonts: new Set(['Inter', 'Roboto']) });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.ruleId).toBe('font');
  });

  it('allows a text node with an available font', () => {
    const doc = createDocument();
    const text = makeText('label', 'Inter');
    const docWithText = { ...doc, nodes: { [text.id]: text }, rootChildren: [text.id] };
    expect(ruleFonts(docWithText, { availableFonts: new Set(['Inter']) })).toEqual([]);
  });

  it('returns no issues when no font registry is supplied', () => {
    const doc = createDocument();
    const text = makeText('label', 'Unknown');
    const docWithText = { ...doc, nodes: { [text.id]: text }, rootChildren: [text.id] };
    expect(ruleFonts(docWithText, {})).toEqual([]);
  });
});
