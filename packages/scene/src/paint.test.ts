/**
 * Tests for the Paint entity system (v1.8+ unified content model).
 *
 * Covers:
 * - Paint creation and identity
 * - paintRefs resolution chain (paintRefs → paints → fills → fill)
 * - shapeless geometry derivation from image paints
 * - Document paint CRUD operations
 * - Migration v1.7 → v1.8
 * - makeImageShapeNode with shapeless flag
 */
import { describe, expect, it } from 'vitest';
import {
  addPaintToDocument,
  createDocument,
  makeImageShapeNode,
  removePaintFromDocument,
  updatePaintInDocument,
} from './document';
import { imageFill, solidFill } from './fills';
import { deriveGeometryFromPaints, getPaintImageDimensions, resolveNodePaints } from './paint';
import type { Paint, ShapeNode } from './types';
import { CURRENT_DOCUMENT_VERSION, migrateDocument } from './version';

// ── Helpers ──────────────────────────────────────────────────────────────────

function createImagePaint(id: string = 'p1', name: string = 'My Image'): Paint {
  return {
    id,
    name,
    fill: imageFill('data:image/png;base64,iVBORw0KGgo=', {
      fit: 'fill',
    }),
  };
}

function createSolidPaint(id: string = 'p2', name: string = 'My Color'): Paint {
  return {
    id,
    name,
    fill: solidFill({ space: 'rgb', r: 255, g: 0, b: 0, a: 255 }),
  };
}

// ── Paint Entity Tests ────────────────────────────────────────────────────────

describe('Paint entity', () => {
  it('creates a paint with identity', () => {
    const paint = createImagePaint('p1', 'My Image');
    expect(paint.id).toBe('p1');
    expect(paint.name).toBe('My Image');
    expect(paint.fill.type).toBe('image');
    expect(paint.fill.image?.src).toContain('iVBORw0KGgo');
  });

  it('creates a solid paint', () => {
    const paint = createSolidPaint('p2', 'Red');
    expect(paint.fill.type).toBe('solid');
    expect(paint.fill.color).toBeDefined();
  });
});

// ── resolveNodePaints Tests ───────────────────────────────────────────────────

describe('resolveNodePaints', () => {
  it('resolves paintRefs to paints from document', () => {
    const paints = {
      p1: createImagePaint('p1', 'Image 1'),
      p2: createSolidPaint('p2', 'Red'),
    };
    const node = { paintRefs: ['p1', 'p2'] };
    const doc = { paints };

    const fills = resolveNodePaints(node, doc);
    expect(fills).toHaveLength(2);
    expect(fills[0]!.type).toBe('image');
    expect(fills[0]!.image?.src).toBe(paints.p1.fill.image?.src);
    expect(fills[1]!.type).toBe('solid');
  });

  it('falls back to inline fills when paintRefs is empty', () => {
    const node = {
      paintRefs: [],
      fills: [solidFill({ space: 'rgb' as const, r: 0, g: 255, b: 0, a: 255 })],
      fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 0 },
    };
    const doc = { paints: {} };

    const fills = resolveNodePaints(node, doc);
    expect(fills).toHaveLength(1);
    expect(fills[0]!.type).toBe('solid');
    // Verify green channel on the color (is RgbColor)
    const color = fills[0]!.color!;
    if ('g' in color) {
      expect(color.g).toBe(255);
    }
  });

  it('falls back to legacy fill when neither paintRefs nor fills are present', () => {
    const node = {
      fill: { space: 'rgb' as const, r: 0, g: 0, b: 255, a: 255 },
    };
    const doc = {};

    const fills = resolveNodePaints(node, doc);
    expect(fills).toHaveLength(1);
    expect(fills[0]!.type).toBe('solid');
    // Verify blue channel on the color (is RgbColor)
    const color = fills[0]!.color!;
    if ('b' in color) {
      expect(color.b).toBe(255);
    }
  });

  it('returns empty fills when paintRefs reference non-existent paints', () => {
    const node = { paintRefs: ['nonexistent'] };
    const doc = { paints: {} };

    const fills = resolveNodePaints(node, doc);
    expect(fills).toHaveLength(0);
  });

  it('skips paintRefs when paints map is missing from document', () => {
    const node = { paintRefs: ['p1'] };
    const doc = {} as { paints?: Record<string, Paint> };

    const fills = resolveNodePaints(node, doc);
    expect(fills).toHaveLength(0);
  });
});

// ── deriveGeometryFromPaints Tests ────────────────────────────────────────────

describe('deriveGeometryFromPaints', () => {
  it('derives rect from image paint natural dimensions', () => {
    const fills = [imageFill('img.png', { fit: 'fill' })];
    fills[0]!.image!.imageWidth = 800;
    fills[0]!.image!.imageHeight = 600;

    const geom = deriveGeometryFromPaints(fills);
    expect(geom.kind).toBe('rect');
    expect(geom.w).toBe(800);
    expect(geom.h).toBe(600);
  });

  it('falls back to 100×100 for image paint without natural dimensions', () => {
    const fills = [imageFill('img.png')];
    const geom = deriveGeometryFromPaints(fills);
    expect(geom.w).toBe(100);
    expect(geom.h).toBe(100);
  });

  it('falls back to 100×100 for solid paint', () => {
    const fills = [solidFill({ space: 'rgb', r: 255, g: 0, b: 0, a: 255 })];
    const geom = deriveGeometryFromPaints(fills);
    expect(geom.w).toBe(100);
    expect(geom.h).toBe(100);
  });

  it('picks the first visible image paint', () => {
    const fills = [
      solidFill({ space: 'rgb', r: 255, g: 0, b: 0, a: 255 }),
      imageFill('img.png', { fit: 'fill' }),
    ];
    fills[1]!.image!.imageWidth = 1920;
    fills[1]!.image!.imageHeight = 1080;

    const geom = deriveGeometryFromPaints(fills);
    expect(geom.w).toBe(1920);
    expect(geom.h).toBe(1080);
  });

  it('skips invisible fills', () => {
    const fills = [
      imageFill('img.png', { visible: false }),
      solidFill({ space: 'rgb', r: 255, g: 0, b: 0, a: 255 }),
    ];
    fills[0]!.visible = false;
    const geom = deriveGeometryFromPaints(fills);
    expect(geom.w).toBe(100);
    expect(geom.h).toBe(100);
  });
});

// ── getPaintImageDimensions Tests ─────────────────────────────────────────────

describe('getPaintImageDimensions', () => {
  it('returns dimensions from visible image fill', () => {
    const fills = [imageFill('img.png')];
    fills[0]!.image!.imageWidth = 800;
    fills[0]!.image!.imageHeight = 600;

    const dims = getPaintImageDimensions(fills);
    expect(dims).toEqual({ w: 800, h: 600 });
  });

  it('returns null when no image fill has dimensions', () => {
    const fills = [solidFill({ space: 'rgb', r: 0, g: 0, b: 0, a: 255 })];
    expect(getPaintImageDimensions(fills)).toBeNull();
  });

  it('returns null for invisible image fill', () => {
    const fills = [imageFill('img.png', { visible: false })];
    fills[0]!.visible = false;
    expect(getPaintImageDimensions(fills)).toBeNull();
  });
});

// ── Document Paint CRUD Tests ─────────────────────────────────────────────────

describe('Document paint CRUD', () => {
  it('adds a paint to the document', () => {
    const doc = createDocument('test', { flat: true });
    const paint = createImagePaint('p1', 'Test Image');
    const result = addPaintToDocument(doc, paint);

    expect(result.paints).toBeDefined();
    expect(result.paints!.p1).toBeDefined();
    expect(result.paints!.p1!.name).toBe('Test Image');
    // Original document unchanged
    expect(doc.paints).toBeUndefined();
  });

  it('removes a paint from the document', () => {
    const doc = createDocument('test', { flat: true });
    const paint = createImagePaint('p1', 'Test');
    const withPaint = addPaintToDocument(doc, paint);
    const result = removePaintFromDocument(withPaint, 'p1');

    expect(result.paints).toBeUndefined();
  });

  it('updates a paint in the document', () => {
    const doc = createDocument('test', { flat: true });
    const paint = createImagePaint('p1', 'Old Name');
    const withPaint = addPaintToDocument(doc, paint);
    const result = updatePaintInDocument(withPaint, 'p1', { name: 'New Name' });

    expect(result.paints!.p1!.name).toBe('New Name');
    // Original paint unchanged
    expect(paint.name).toBe('Old Name');
  });

  it('does not update a non-existent paint', () => {
    const doc = createDocument('test', { flat: true });
    const result = updatePaintInDocument(doc, 'nonexistent', { name: 'New' });
    expect(result).toBe(doc);
  });

  it('does not remove a non-existent paint', () => {
    const doc = createDocument('test', { flat: true });
    const result = removePaintFromDocument(doc, 'nonexistent');
    expect(result).toBe(doc);
  });
});

// ── makeImageShapeNode with shapeless flag Tests ──────────────────────────────

describe('makeImageShapeNode with shapeless', () => {
  it('creates shapeless image node', () => {
    const node = makeImageShapeNode('n1', {
      src: 'test.png',
      imageWidth: 400,
      imageHeight: 300,
      shapeless: true,
    });

    expect(node.kind).toBe('shape');
    expect(node.shapeless).toBe(true);
    expect(node.fills).toHaveLength(1);
    expect(node.fills![0]!.type).toBe('image');
    expect(node.fills![0]!.image?.src).toBe('test.png');
    expect(node.fills![0]!.image?.imageWidth).toBe(400);
    expect(node.fills![0]!.image?.imageHeight).toBe(300);
  });

  it('creates non-shapeless image node by default', () => {
    const node = makeImageShapeNode('n1', { src: 'test.png' });
    expect(node.shapeless).toBe(false);
  });

  it('creates shapeless image node with natural dimensions as geometry', () => {
    const node = makeImageShapeNode('n1', {
      src: 'photo.png',
      imageWidth: 1920,
      imageHeight: 1080,
      shapeless: true,
    });

    // The makeImageShapeNode sets the rect dimensions from imageWidth/imageHeight
    expect(node.shape.kind).toBe('rect');
    if (node.shape.kind === 'rect') {
      expect(node.shape.w).toBe(1920);
      expect(node.shape.h).toBe(1080);
    }
  });

  it('supports paintRefs on the created node', () => {
    const node = makeImageShapeNode('n1', { src: 'test.png' });
    // paintRefs can be set externally — verify the node type supports it
    const withRefs: ShapeNode = { ...node, paintRefs: ['p1'] };
    expect(withRefs.paintRefs).toEqual(['p1']);
  });
});

// ── Migration Tests ───────────────────────────────────────────────────────────

describe('v1.7 → v1.8 migration', () => {
  it('migrates v1.7 document to v1.8', () => {
    const v1doc = {
      formatVersion: '1.7',
      id: 'test-doc',
      name: 'Test',
      rootChildren: [],
      nodes: {},
      components: {},
      nextId: 1,
    };

    const result = migrateDocument(v1doc);
    expect(result).not.toBeNull();
    expect(result!.formatVersion).toBe(CURRENT_DOCUMENT_VERSION);
  });

  it('adds paints field (undefined) during migration', () => {
    const v1doc = {
      formatVersion: '1.7',
      id: 'test-doc',
      name: 'Test',
      rootChildren: [],
      nodes: {},
      components: {},
      nextId: 1,
    };

    const result = migrateDocument(v1doc);
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('paints');
    expect(result!.paints).toBeUndefined();
  });

  it('preserves existing paints during migration', () => {
    const paints = {
      p1: createImagePaint('p1', 'My Image'),
    };
    const v1doc = {
      formatVersion: '1.7',
      id: 'test-doc',
      name: 'Test',
      rootChildren: [],
      nodes: {},
      components: {},
      nextId: 1,
      paints,
    };

    const result = migrateDocument(v1doc);
    expect(result).not.toBeNull();
    expect(result!.paints).toBeDefined();
    expect((result!.paints as Record<string, Paint>).p1!.name).toBe('My Image');
  });

  it('still migrates older versions through v1.8', () => {
    const v1doc = {
      formatVersion: '1.0',
      id: 'test-doc',
      name: 'Test',
      rootChildren: [],
      nodes: {},
      components: {},
      nextId: 1,
    };

    const result = migrateDocument(v1doc);
    expect(result).not.toBeNull();
    expect(result!.formatVersion).toBe(CURRENT_DOCUMENT_VERSION);
    expect(result).toHaveProperty('paints');
  });
});
