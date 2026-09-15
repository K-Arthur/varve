/**
 * Tests for the Design Linter scanner module.
 */

import { describe, expect, it } from 'vitest';
import { createDocument, type Document } from '../document';
import type { NodeId, SceneNode } from '../types';
import {
  checkEmptyContainers,
  checkOffCanvasLayers,
  checkTouchTargets,
  checkZeroSizeLayers,
  runLinterScan,
} from './linterScanner';

// ── Helpers ─────────────────────────────────────────────────────────────

function makeDoc(overrides: Partial<Record<string, unknown>> = {}): Document {
  return {
    ...(createDocument('test', { flat: true }) as unknown as Record<string, unknown>),
    ...overrides,
  } as unknown as Document;
}

function addNode(
  doc: Document,
  overrides: Partial<SceneNode> & { id: string; kind: SceneNode['kind']; name: string },
): Document {
  return {
    ...doc,
    nodes: {
      ...doc.nodes,
      [overrides.id]: overrides as unknown as SceneNode,
    },
  };
}

function makeShapeNode(
  id: string,
  name: string,
  shape: Record<string, number>,
  extra: Partial<SceneNode> = {},
): SceneNode {
  return {
    id,
    name,
    kind: 'shape',
    fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 1 },
    shape: {
      kind: 'rect',
      x: shape.x ?? 0,
      y: shape.y ?? 0,
      w: shape.w ?? 100,
      h: shape.h ?? 100,
      ...shape,
    },
    visible: true,
    locked: false,
    ...extra,
  } as unknown as SceneNode;
}

function makeFrameNode(
  id: string,
  name: string,
  w: number,
  h: number,
  children: NodeId[] = [],
  extra: Partial<SceneNode> = {},
): SceneNode {
  return {
    id,
    name,
    kind: 'frame',
    w,
    h,
    children,
    fill: { space: 'rgb', r: 240, g: 240, b: 240, a: 1 },
    visible: true,
    locked: false,
    ...extra,
  } as unknown as SceneNode;
}

// ── Zero-size layers ──────────────────────────────────────────────────

describe('checkZeroSizeLayers', () => {
  it('flags a shape node with zero width', () => {
    let doc = makeDoc();
    doc = addNode(doc, makeShapeNode('n1', 'zero-width', { x: 0, y: 0, w: 0, h: 100 }));
    const issues = checkZeroSizeLayers(doc);
    expect(issues.length).toBe(1);
    expect(issues[0]!.ruleId).toBe('layer-hygiene/zero-size/v1');
    expect(issues[0]!.nodeIds).toContain('n1');
  });

  it('flags a shape node with zero height', () => {
    let doc = makeDoc();
    doc = addNode(doc, makeShapeNode('n1', 'zero-height', { x: 0, y: 0, w: 100, h: 0 }));
    const issues = checkZeroSizeLayers(doc);
    expect(issues.length).toBe(1);
  });

  it('does NOT flag intentional zero-size kinds (path, line, arrow)', () => {
    let doc = makeDoc();
    doc = addNode(doc, {
      id: 'p1',
      name: 'path',
      kind: 'path',
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 1 },
      shape: { kind: 'path', points: [], closed: false },
      visible: true,
      locked: false,
    } as unknown as SceneNode);
    doc = addNode(doc, {
      id: 'l1',
      name: 'line shape',
      kind: 'shape',
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 1 },
      shape: { kind: 'line', x: 0, y: 0, w: 0, h: 100 },
      visible: true,
      locked: false,
    } as unknown as SceneNode);
    doc = addNode(doc, {
      id: 'a1',
      name: 'arrow shape',
      kind: 'shape',
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 1 },
      shape: { kind: 'arrow', x: 0, y: 0, w: 0, h: 100 },
      visible: true,
      locked: false,
    } as unknown as SceneNode);
    const issues = checkZeroSizeLayers(doc);
    expect(issues.length).toBe(0);
  });

  it('does not flag hidden or locked nodes', () => {
    let doc = makeDoc();
    doc = addNode(
      doc,
      makeShapeNode('n1', 'hidden', { x: 0, y: 0, w: 0, h: 100 }, { visible: false }),
    );
    doc = addNode(
      doc,
      makeShapeNode('n2', 'locked', { x: 0, y: 0, w: 0, h: 100 }, { locked: true }),
    );
    const issues = checkZeroSizeLayers(doc);
    expect(issues.length).toBe(0);
  });

  it('respects scopeIds', () => {
    let doc = makeDoc();
    doc = addNode(doc, makeShapeNode('n1', 'zero', { x: 0, y: 0, w: 0, h: 100 }));
    doc = addNode(doc, makeShapeNode('n2', 'normal', { x: 0, y: 0, w: 100, h: 100 }));
    const issues = checkZeroSizeLayers(doc, ['n2']);
    expect(issues.length).toBe(0);
  });
});

// ── Off-canvas layers ─────────────────────────────────────────────────

describe('checkOffCanvasLayers', () => {
  it('flags a node far outside the canvas', () => {
    let doc = makeDoc({ canvasWidth: 1920, canvasHeight: 1080 });
    doc = addNode(doc, makeShapeNode('n1', 'far-away', { x: 10000, y: 10000, w: 100, h: 100 }));
    const issues = checkOffCanvasLayers(doc);
    expect(issues.length).toBe(1);
    expect(issues[0]!.ruleId).toBe('layer-hygiene/off-canvas/v1');
    expect(issues[0]!.nodeIds).toContain('n1');
  });

  it('does not flag nodes within canvas bounds', () => {
    let doc = makeDoc({ canvasWidth: 1920, canvasHeight: 1080 });
    doc = addNode(doc, makeShapeNode('n1', 'on-canvas', { x: 100, y: 100, w: 100, h: 100 }));
    const issues = checkOffCanvasLayers(doc);
    expect(issues.length).toBe(0);
  });

  it('does not flag nodes slightly outside (within margin)', () => {
    let doc = makeDoc({ canvasWidth: 1920, canvasHeight: 1080 });
    doc = addNode(doc, makeShapeNode('n1', 'near-edge', { x: -100, y: 100, w: 100, h: 100 }));
    const issues = checkOffCanvasLayers(doc);
    expect(issues.length).toBe(0);
  });

  it('does not flag hidden nodes', () => {
    let doc = makeDoc({ canvasWidth: 1920, canvasHeight: 1080 });
    doc = addNode(
      doc,
      makeShapeNode('n1', 'hidden-far', { x: 10000, y: 10000, w: 100, h: 100 }, { visible: false }),
    );
    const issues = checkOffCanvasLayers(doc);
    expect(issues.length).toBe(0);
  });
});

// ── Empty containers ──────────────────────────────────────────────────

describe('checkEmptyContainers', () => {
  it('flags a frame with only invisible children', () => {
    let doc = makeDoc();
    doc = addNode(doc, {
      id: 'c1',
      name: 'child',
      kind: 'shape',
      fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 1 },
      shape: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
      visible: false,
      locked: false,
    } as unknown as SceneNode);
    doc = addNode(
      doc,
      makeFrameNode('f1', 'empty-frame', 200, 200, ['c1'], {
        fills: [],
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
      }),
    );
    const issues = checkEmptyContainers(doc);
    expect(issues.length).toBe(1);
    expect(issues[0]!.ruleId).toBe('layer-hygiene/empty-container/v1');
  });

  it('does not flag a frame with visible children', () => {
    let doc = makeDoc();
    doc = addNode(doc, makeShapeNode('c1', 'child', { x: 10, y: 10, w: 50, h: 50 }));
    doc = addNode(doc, makeFrameNode('f1', 'parent-frame', 200, 200, ['c1']));
    const issues = checkEmptyContainers(doc);
    expect(issues.length).toBe(0);
  });

  it('does not flag a frame with its own visible fill', () => {
    let doc = makeDoc();
    doc = addNode(doc, {
      id: 'f1',
      name: 'filled-frame',
      kind: 'frame',
      w: 200,
      h: 200,
      children: [],
      fill: { space: 'rgb', r: 100, g: 100, b: 100, a: 1 },
      fills: [
        {
          type: 'solid',
          color: { space: 'rgb', r: 100, g: 100, b: 100, a: 1 },
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      visible: true,
      locked: false,
    } as unknown as SceneNode);
    const issues = checkEmptyContainers(doc);
    expect(issues.length).toBe(0);
  });

  it('does not flag non-container nodes (shape, text)', () => {
    let doc = makeDoc();
    doc = addNode(doc, makeShapeNode('s1', 'shape', { x: 0, y: 0, w: 0, h: 0 }));
    const issues = checkEmptyContainers(doc);
    expect(issues.length).toBe(0);
  });
});

// ── Touch targets ────────────────────────────────────────────────────

describe('checkTouchTargets', () => {
  it('flags an interactive node smaller than 44px', () => {
    let doc = makeDoc();
    // Add prototype interactions to make it "interactive"
    doc = {
      ...doc,
      interactions: {
        n1: { trigger: { kind: 'onClick' }, action: { kind: 'navigateTo', targetId: 'page2' } },
      },
    } as unknown as Document;
    doc = addNode(doc, makeShapeNode('n1', 'small-hotspot', { x: 0, y: 0, w: 30, h: 30 }));
    const issues = checkTouchTargets(doc);
    expect(issues.length).toBe(1);
    expect(issues[0]!.ruleId).toBe('accessibility/touch-target/v1');
    expect(issues[0]!.evidence).toBeDefined();
    expect((issues[0]!.evidence as Record<string, unknown>).actualSize).toBe(30);
  });

  it('does not flag a sufficiently large interactive node', () => {
    let doc = makeDoc();
    doc = {
      ...doc,
      interactions: {
        n1: { trigger: { kind: 'onClick' }, action: { kind: 'navigateTo', targetId: 'page2' } },
      },
    } as unknown as Document;
    doc = addNode(doc, makeShapeNode('n1', 'big-hotspot', { x: 0, y: 0, w: 48, h: 48 }));
    const issues = checkTouchTargets(doc);
    expect(issues.length).toBe(0);
  });

  it('returns no issues when no prototype interactions exist', () => {
    let doc = makeDoc();
    doc = addNode(doc, makeShapeNode('n1', 'small', { x: 0, y: 0, w: 10, h: 10 }));
    const issues = checkTouchTargets(doc);
    expect(issues.length).toBe(0);
  });
});

// ── runLinterScan integration ─────────────────────────────────────────

describe('runLinterScan', () => {
  it('returns a LinterReport with all rules applied', () => {
    let doc = makeDoc({ canvasWidth: 1920, canvasHeight: 1080 });
    doc = addNode(doc, makeShapeNode('n1', 'zero-w', { x: 0, y: 0, w: 0, h: 100 }));
    doc = addNode(doc, makeShapeNode('n2', 'off-canvas', { x: 10000, y: 10000, w: 100, h: 100 }));
    doc = addNode(doc, {
      id: 'c1',
      name: 'hidden-child',
      kind: 'shape',
      fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 1 },
      shape: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
      visible: false,
      locked: false,
    } as unknown as SceneNode);
    doc = addNode(doc, makeFrameNode('f1', 'empty', 200, 200, ['c1']));
    doc = addNode(doc, makeShapeNode('n4', 'interactive', { x: 0, y: 0, w: 30, h: 30 }));
    doc = {
      ...doc,
      interactions: {
        n4: { trigger: { kind: 'onClick' }, action: { kind: 'navigateTo', targetId: 'page2' } },
      },
    } as unknown as Document;

    const report = runLinterScan(doc);
    expect(report.issues.length).toBeGreaterThanOrEqual(3);
    expect(report.scanId).toBeGreaterThan(0);
    expect(report.scanDurationMs).toBeGreaterThanOrEqual(0);
    expect(report.totalWarnings).toBeGreaterThanOrEqual(1);
    expect(report.byCategory['layer-hygiene']).toBeDefined();
    expect(report.byRuleId).toBeDefined();
    expect(report.bySeverity).toBeDefined();
  });

  it('supports scoped scanning', () => {
    let doc = makeDoc();
    doc = addNode(doc, makeShapeNode('n1', 'zero-w', { x: 0, y: 0, w: 0, h: 100 }));
    doc = addNode(doc, makeShapeNode('n2', 'normal', { x: 0, y: 0, w: 100, h: 100 }));
    const report = runLinterScan(doc, { scopeIds: ['n2'] });
    expect(report.issues.length).toBe(0);
  });
});
