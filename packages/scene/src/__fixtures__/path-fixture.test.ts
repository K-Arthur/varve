import { describe, expect, it } from 'vitest';
import type { Document } from '../document';
import { validateDocument } from '../document';
import { CURRENT_DOCUMENT_VERSION, migrateDocument, serializeDocument } from '../version';
import pathFixture from './path-document-v1.6.json';

describe('Path Document Fixture (v1.6)', () => {
  it('round-trips: load -> migrate -> serialize -> parse -> verify path geometry', () => {
    // Load and migrate the fixture
    const doc = migrateDocument(pathFixture as Record<string, unknown>);
    expect(doc).not.toBeNull();
    expect(doc!.formatVersion).toBe(CURRENT_DOCUMENT_VERSION);

    // Serialize to JSON (stamps version)
    const json = serializeDocument(doc!);
    const parsed = JSON.parse(json);

    // Migrate again (should be a no-op)
    const reDoc = migrateDocument(parsed);
    expect(reDoc).not.toBeNull();
    expect(reDoc!.formatVersion).toBe(CURRENT_DOCUMENT_VERSION);

    // Verify all three path nodes are present and have correct shape
    const nodes = reDoc!.nodes as Record<string, unknown>;

    // Straight path
    const path1 = nodes['path-1'] as Record<string, unknown>;
    expect(path1).toBeDefined();
    expect(path1.kind).toBe('shape');
    const shape1 = (path1 as { shape?: { kind: string; points: unknown[]; closed: boolean } })
      .shape;
    expect(shape1?.kind).toBe('path');
    expect(shape1?.points).toHaveLength(3);
    expect(shape1?.closed).toBe(false);

    // Bezier curved path
    const bezierPath = nodes['bezier-path-1'] as Record<string, unknown>;
    expect(bezierPath).toBeDefined();
    const shape2 = (bezierPath as { shape?: { kind: string; points: unknown[]; closed: boolean } })
      .shape;
    expect(shape2?.kind).toBe('path');
    expect(shape2?.points).toHaveLength(4);
    const firstPt = (shape2!.points as Array<{ handleOut?: unknown }>)[0]!;
    expect(firstPt.handleOut).toBeDefined();

    // Closed path
    const closedPath = nodes['closed-path-1'] as Record<string, unknown>;
    expect(closedPath).toBeDefined();
    const shape3 = (closedPath as { shape?: { kind: string; points: unknown[]; closed: boolean } })
      .shape;
    expect(shape3?.kind).toBe('path');
    expect(shape3?.closed).toBe(true);

    // Validate the document
    const validation = validateDocument(reDoc! as unknown as Document);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);
  });

  it('preserves all path point coordinates through round-trip', () => {
    const doc = migrateDocument(pathFixture as Record<string, unknown>);
    expect(doc).not.toBeNull();
    const json = serializeDocument(doc!);
    const parsed = JSON.parse(json);
    const reDoc = migrateDocument(parsed);

    // Check that all coordinates are preserved verbatim
    const original = migrateDocument(pathFixture as Record<string, unknown>);
    const origNodes = original!.nodes as Record<string, unknown>;
    const reNodes = reDoc!.nodes as Record<string, unknown>;

    for (const [id, origNode] of Object.entries(origNodes)) {
      const n = origNode as {
        shape?: {
          kind?: string;
          points?: Array<{ x: number; y: number; handleIn?: unknown; handleOut?: unknown }>;
        };
      };
      if (n.shape?.kind === 'path' && n.shape.points) {
        const reNode = reNodes[id] as {
          shape: {
            kind?: string;
            points: Array<{ x: number; y: number; handleIn: unknown; handleOut: unknown }>;
          };
        };
        const reShape = reNode.shape;
        expect(reShape.kind).toBe('path');
        expect(reShape.points).toHaveLength(n.shape.points.length);

        for (let i = 0; i < n.shape.points.length; i++) {
          const origPt = n.shape.points[i]!;
          const rePt = reShape.points[i]!;
          expect(rePt.x).toBe(origPt.x);
          expect(rePt.y).toBe(origPt.y);
          expect(rePt.handleIn).toEqual(origPt.handleIn);
          expect(rePt.handleOut).toEqual(origPt.handleOut);
        }
      }
    }
  });
});
