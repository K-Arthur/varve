/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import {
  createTutorialDocument,
  TUTORIAL_DOCUMENT_ID,
  TUTORIAL_DOCUMENT_VERSION,
} from './tutorial-document';

describe('tutorial-document', () => {
  it('creates a valid Document with formatVersion', () => {
    const doc = createTutorialDocument();
    expect(doc).toBeDefined();
    expect(doc.formatVersion).toBeTruthy();
    expect(typeof doc.formatVersion).toBe('string');
    expect(doc.id).toBe(TUTORIAL_DOCUMENT_ID);
  });

  it('contains 3 frames (lessons)', () => {
    const doc = createTutorialDocument();
    const frameNodes = doc.rootChildren
      .map((id) => doc.nodes[id])
      .filter((n): n is import('@varve/scene').FrameNode => n?.kind === 'frame');
    expect(frameNodes).toHaveLength(3);

    const names = frameNodes.map((f) => f.name);
    expect(names[0]).toContain('Drawing Shapes');
    expect(names[1]).toContain('Working with Layers');
    expect(names[2]).toContain('Export Your Design');
  });

  it('each frame has educational TextNodes', () => {
    const doc = createTutorialDocument();
    const frameNodes = doc.rootChildren
      .map((id) => doc.nodes[id])
      .filter((n): n is import('@varve/scene').FrameNode => n?.kind === 'frame');

    for (const frame of frameNodes) {
      const childIds = frame.children;
      const textChildren = childIds.map((cid) => doc.nodes[cid]).filter((n) => n?.kind === 'text');
      expect(textChildren.length).toBeGreaterThanOrEqual(1);
      for (const t of textChildren) {
        expect((t as import('@varve/scene').TextNode).text).toBeTruthy();
      }
    }
  });

  it('layers have instructive names', () => {
    const doc = createTutorialDocument();
    const allNodes = Object.values(doc.nodes);
    const shapeNodes = allNodes.filter(
      (n): n is import('@varve/scene').ShapeNode => n.kind === 'shape',
    );
    for (const s of shapeNodes) {
      expect(s.name).toBeTruthy();
      expect(s.name.length).toBeGreaterThan(5);
    }
    const textNodes = allNodes.filter(
      (n): n is import('@varve/scene').TextNode => n.kind === 'text',
    );
    for (const t of textNodes) {
      expect(t.name).toBeTruthy();
    }
  });

  it('document has tutorial metadata flag', () => {
    const doc = createTutorialDocument();
    expect(doc.id).toBe(TUTORIAL_DOCUMENT_ID);
    expect(TUTORIAL_DOCUMENT_VERSION).toBe(1);
  });
});
