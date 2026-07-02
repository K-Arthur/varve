/**
 * TDD tests for the library/publishing system.
 *
 * Tests: library creation, component publishing, style publishing,
 * library installation, versioning, dependency tracking.
 */
import { describe, it, expect } from 'vitest';
import { createDocument, addNode, makeShapeNode, makeFrameNode } from './document';
import { createComponent } from './component';
import { createColorStyle } from './styles';
import {
  createLibrary,
  publishComponentToLibrary,
  publishStyleToLibrary,
  installLibrary,
  listLibraryComponents,
  listLibraryStyles,
  type Library,
  type LibraryPackage,
} from './library';
import type { Fill } from './types';

describe('Library System', () => {
  it('creates a library with metadata', () => {
    const lib = createLibrary('Design System', 'Core design tokens', '1.0.0');
    expect(lib.name).toBe('Design System');
    expect(lib.version).toBe('1.0.0');
    expect(lib.id).toBeDefined();
  });

  it('publishes a component to a library', () => {
    let doc = createDocument('test');
    const master = makeFrameNode('m1', { name: 'Button', w: 120, h: 40 });
    doc = addNode(doc, master);
    const { component, doc: d1 } = createComponent(doc, 'Button', 'm1', []);
    doc = d1;

    const lib = createLibrary('UI Kit', 'Components', '0.1.0');
    const result = publishComponentToLibrary(lib, component, doc);
    expect(result.library.components).toHaveLength(1);
    expect(result.library.components[0]?.name).toBe('Button');
  });

  it('publishes a style to a library', () => {
    let doc = createDocument('test');
    const fill: Fill = { type: 'solid', color: [57, 208, 198, 255], opacity: 1, blendMode: 'normal', visible: true };
    const { style, doc: d1 } = createColorStyle(doc, 'Teal', fill);
    doc = d1;

    const lib = createLibrary('Tokens', 'Colors', '1.0.0');
    const result = publishStyleToLibrary(lib, style);
    expect(result.library.styles).toHaveLength(1);
    expect(result.library.styles[0]?.name).toBe('Teal');
  });

  it('creates a library package for export/import', () => {
    let doc = createDocument('test');
    const master = makeFrameNode('m1', { name: 'Button', w: 120, h: 40 });
    doc = addNode(doc, master);
    const { component, doc: d1 } = createComponent(doc, 'Button', 'm1', []);
    doc = d1;

    const lib = createLibrary('UI Kit', 'Components', '1.0.0');
    const { library } = publishComponentToLibrary(lib, component, doc);

    const pkg: LibraryPackage = {
      formatVersion: '1.0',
      library,
      exportedAt: new Date().toISOString(),
    };

    expect(pkg.library.components).toHaveLength(1);
    expect(pkg.formatVersion).toBe('1.0');
  });

  it('installs a library into a document', () => {
    let doc = createDocument('test');
    const master = makeFrameNode('m1', { name: 'Button', w: 120, h: 40 });
    doc = addNode(doc, master);
    const { component, doc: d1 } = createComponent(doc, 'Button', 'm1', []);
    doc = d1;

    const lib = createLibrary('UI Kit', 'Components', '1.0.0');
    const { library } = publishComponentToLibrary(lib, component, doc);

    // Install into a fresh document
    const freshDoc = createDocument('consumer');
    const result = installLibrary(freshDoc, library);
    expect(result.doc.installedLibraries).toHaveLength(1);
    expect(result.doc.installedLibraries?.[0]?.id).toBe(library.id);
  });

  it('lists library components', () => {
    let doc = createDocument('test');
    const m1 = makeFrameNode('m1', { name: 'Button', w: 120, h: 40 });
    doc = addNode(doc, m1);
    const { component: c1, doc: d1 } = createComponent(doc, 'Button', 'm1', []);
    doc = d1;

    const m2 = makeFrameNode('m2', { name: 'Card', w: 300, h: 200 });
    doc = addNode(doc, m2);
    const { component: c2, doc: d2 } = createComponent(doc, 'Card', 'm2', []);
    doc = d2;

    let lib = createLibrary('UI Kit', 'Components', '1.0.0');
    const r1 = publishComponentToLibrary(lib, c1, doc);
    lib = r1.library;
    const r2 = publishComponentToLibrary(lib, c2, doc);
    lib = r2.library;

    const names = listLibraryComponents(lib).map((c) => c.name);
    expect(names).toEqual(['Button', 'Card']);
  });

  it('lists library styles', () => {
    let doc = createDocument('test');
    const fill: Fill = { type: 'solid', color: [57, 208, 198, 255], opacity: 1, blendMode: 'normal', visible: true };
    const { style: s1, doc: d1 } = createColorStyle(doc, 'Primary', fill);
    doc = d1;
    const { style: s2 } = createColorStyle(doc, 'Secondary', { type: 'solid', color: [0, 0, 0, 255], opacity: 1, blendMode: 'normal', visible: true });

    let lib = createLibrary('Tokens', 'Colors', '1.0.0');
    const r1 = publishStyleToLibrary(lib, s1);
    lib = r1.library;
    const r2 = publishStyleToLibrary(lib, s2);
    lib = r2.library;

    expect(listLibraryStyles(lib)).toHaveLength(2);
  });
});
