import { createDocument, imageFill, makeShapeNode, type ShapeNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { suggestExportFormat } from './exportAdvisor';

/**
 * Imported artwork stores a data URL (`data:image/jpeg;base64,…`), not a file
 * path. The advisor used to key only on the extension, so a placed photo was
 * classified as a vector shape and the Export tab advised SVG with the reason
 * "Vector path exports losslessly as SVG" — and hid the raster scale controls.
 */
function photoNode(src: string, w = 1920, h = 1280): ShapeNode {
  const node = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w, h }, { name: 'photo' });
  return { ...node, fills: [imageFill(src)] } as ShapeNode;
}

describe('suggestExportFormat — placed image detection', () => {
  it('reads a JPEG data URL as JPEG instead of a vector shape', () => {
    const doc = createDocument('Export', true);
    const suggestion = suggestExportFormat(
      photoNode('data:image/jpeg;base64,/9j/4AAQSkZJRg=='),
      doc,
    );
    expect(suggestion.format).toBe('image/jpeg');
    expect(suggestion.reason).toMatch(/JPEG/i);
  });

  it('reads a PNG data URL as PNG', () => {
    const doc = createDocument('Export', true);
    const suggestion = suggestExportFormat(photoNode('data:image/png;base64,iVBORw0KGgo='), doc);
    expect(suggestion.format).toBe('image/png');
  });

  it('keeps SVG sources on SVG', () => {
    const doc = createDocument('Export', true);
    const suggestion = suggestExportFormat(
      photoNode('data:image/svg+xml;base64,PHN2ZyB4bWxucz0='),
      doc,
    );
    expect(suggestion.format).toBe('svg');
  });

  it('never advises SVG for an unknown raster container', () => {
    const doc = createDocument('Export', true);
    const suggestion = suggestExportFormat(photoNode('data:image/webp;base64,UklGRg=='), doc);
    expect(suggestion.format).not.toBe('svg');
    expect(suggestion.format).toBe('image/png');
  });

  it('uses JPEG for an unknown large raster', () => {
    const doc = createDocument('Export', true);
    const suggestion = suggestExportFormat(
      photoNode('data:image/webp;base64,UklGRg==', 3200, 1800),
      doc,
    );
    expect(suggestion.format).toBe('image/jpeg');
  });

  it('still advises SVG for a pure vector shape and keeps file-path detection', () => {
    const doc = createDocument('Export', true);
    const rect = makeShapeNode(
      'n1',
      { kind: 'rect', x: 0, y: 0, w: 200, h: 120 },
      { name: 'rect' },
    );
    expect(suggestExportFormat(rect, doc).format).toBe('svg');

    const path = photoNode('file:///assets/photo.jpeg');
    expect(suggestExportFormat(path, doc).format).toBe('image/jpeg');
  });
});
