import { describe, expect, it } from 'vitest';
import { createDocument, type Document } from '../document';
import type { FrameNode, TextNode } from '../types';
import { runIntelligenceAudit } from './audit';

function makeFrame(overrides: Partial<FrameNode> = {}): FrameNode {
  return {
    id: 'frame1',
    kind: 'frame',
    name: 'Frame',
    layerColor: null,
    order: 'a0',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    transform: [1, 0, 0, 1, 0, 0],
    fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
    children: ['text1'],
    strokes: [],
    effects: [],
    w: 400,
    h: 200,
    ...overrides,
  } as FrameNode;
}

function makeText(overrides: Partial<TextNode> = {}): TextNode {
  return {
    id: 'text1',
    kind: 'text',
    name: 'Label',
    layerColor: null,
    order: 'a0',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    transform: [1, 0, 0, 1, 0, 0],
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
    text: 'Hello',
    fontSize: 16,
    strokes: [],
    effects: [],
    ...overrides,
  } as TextNode;
}

function makeDoc(frame: FrameNode, text: TextNode): Document {
  return {
    ...createDocument('audit-test'),
    nodes: { [frame.id]: frame, [text.id]: text },
    rootChildren: [frame.id],
  };
}

describe('runIntelligenceAudit', () => {
  it('reports a contrast-aa-fail issue for low-contrast normal text', () => {
    // Light gray text (#CCC) on a white frame — well below 4.5:1.
    const frame = makeFrame({ fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 } });
    const text = makeText({ fill: { space: 'rgb', r: 204, g: 204, b: 204, a: 255 }, fontSize: 16 });
    const issues = runIntelligenceAudit(makeDoc(frame, text));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.nodeId).toBe('text1');
    expect(issues[0]?.type).toBe('contrast-aa-fail');
    expect(issues[0]?.message).toContain('WCAG AA minimum');
  });

  it('reports no issue for sufficiently contrasting text', () => {
    const frame = makeFrame({ fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 } });
    const text = makeText({ fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 }, fontSize: 16 });
    const issues = runIntelligenceAudit(makeDoc(frame, text));
    expect(issues).toHaveLength(0);
  });

  it('uses the lower large-text threshold for big/bold text', () => {
    // ~3.4:1 contrast: fails the 4.5:1 normal-text minimum but clears the
    // 3:1 large-text minimum.
    const frame = makeFrame({ fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 } });
    const midGray = { space: 'rgb' as const, r: 140, g: 140, b: 140, a: 255 };

    const normalText = makeText({ fill: midGray, fontSize: 16 });
    const normalIssues = runIntelligenceAudit(makeDoc(frame, normalText));
    expect(normalIssues).toHaveLength(1);

    const largeText = makeText({ fill: midGray, fontSize: 24 }); // 18pt
    const largeIssues = runIntelligenceAudit(makeDoc(frame, largeText));
    expect(largeIssues).toHaveLength(0);
  });

  it('skips text with no resolvable ancestor background', () => {
    const text = makeText({ fill: { space: 'rgb', r: 204, g: 204, b: 204, a: 255 } });
    const doc: Document = {
      ...createDocument('audit-test'),
      nodes: { [text.id]: text },
      rootChildren: [text.id],
    };
    expect(runIntelligenceAudit(doc)).toHaveLength(0);
  });

  it('handles non-RGB text fills without crashing', () => {
    const frame = makeFrame();
    const text = makeText({ fill: { space: 'cmyk', c: 0, m: 0, y: 0, k: 255, a: 255 } });
    expect(() => runIntelligenceAudit(makeDoc(frame, text))).not.toThrow();
    expect(runIntelligenceAudit(makeDoc(frame, text))).toHaveLength(0);
  });

  it('skips invisible text nodes', () => {
    const frame = makeFrame();
    const text = makeText({
      fill: { space: 'rgb', r: 204, g: 204, b: 204, a: 255 },
      visible: false,
    });
    expect(runIntelligenceAudit(makeDoc(frame, text))).toHaveLength(0);
  });

  it('autoFix produces a document where the text now meets the contrast minimum', () => {
    const frame = makeFrame({ fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 } });
    const text = makeText({ fill: { space: 'rgb', r: 204, g: 204, b: 204, a: 255 }, fontSize: 16 });
    const doc = makeDoc(frame, text);
    const issues = runIntelligenceAudit(doc);
    expect(issues[0]?.autoFix).toBeDefined();

    const fixedDoc = issues[0]!.autoFix!();
    const fixedIssues = runIntelligenceAudit(fixedDoc);
    expect(fixedIssues).toHaveLength(0);

    // The fix should not touch anything but the text node's fill.
    const fixedText = fixedDoc.nodes.text1 as TextNode;
    expect(fixedText.fill.space).toBe('rgb');
    expect(fixedDoc.nodes.frame1).toEqual(doc.nodes.frame1);
  });

  it('resolves the background through a solid `fills` entry when `fill` is transparent', () => {
    const frame = makeFrame({
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
      fills: [
        {
          type: 'solid',
          color: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
    });
    const text = makeText({ fill: { space: 'rgb', r: 204, g: 204, b: 204, a: 255 } });
    const issues = runIntelligenceAudit(makeDoc(frame, text));
    expect(issues).toHaveLength(1);
  });
});
