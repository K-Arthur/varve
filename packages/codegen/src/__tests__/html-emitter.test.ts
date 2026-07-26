/**
 * Tests for the semantic HTML/CSS emitter.
 */

import { createDocument, makeFrameNode, makeTextNode } from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { exportIrToHtml } from '../html';
import { sceneToIR } from '../ir-converter';

describe('exportIrToHtml', () => {
  it('produces valid HTML document structure', () => {
    const doc = createDocument('Test Design');
    const frame = makeFrameNode('f1', { name: 'Container' });

    const docWithNodes = {
      ...doc,
      nodes: { [frame.id]: frame },
      rootChildren: [frame.id],
    };

    const ir = sceneToIR(docWithNodes);
    const result = exportIrToHtml(ir, { includeReset: true });

    expect(result.html).toContain('<!DOCTYPE html>');
    expect(result.html).toContain('<html');
    expect(result.html).toContain('<head>');
    expect(result.html).toContain('<body>');
    expect(result.html).toContain('Test Design');
    expect(result.css).toContain('box-sizing: border-box');
  });

  it('generates CSS with proper layout properties', () => {
    const doc = createDocument('Test');
    const frame = makeFrameNode('f1', { name: 'Panel', w: 200, h: 100 });
    const frameWithLayout = {
      ...frame,
      layoutStyle: {
        mode: 'flex' as const,
        wrap: false,
        grow: 0,
        shrink: 0,
        direction: 'row' as const,
        gap: 8,
        padding: [4, 4, 4, 4] as [number, number, number, number],
      },
    };

    const docWithNodes = {
      ...doc,
      nodes: { [frameWithLayout.id]: frameWithLayout },
      rootChildren: [frameWithLayout.id],
    };

    const ir = sceneToIR(docWithNodes);
    const result = exportIrToHtml(ir);

    expect(result.css).toContain('display: flex');
    expect(result.css).toContain('padding:');
  });

  it('includes reduced-motion media query by default', () => {
    const doc = createDocument('Test');
    const ir = sceneToIR(doc);
    const result = exportIrToHtml(ir);

    expect(result.css).toContain('prefers-reduced-motion: reduce');
  });

  it('uses semantic HTML elements from IR hints', () => {
    const doc = createDocument('Test');
    const button = makeFrameNode('b1', { name: 'Submit Button' });
    const header = makeFrameNode('h1', { name: 'Header' });
    const text = makeTextNode('t1', 'Click me', { fontSize: 14 });

    const docWithNodes = {
      ...doc,
      nodes: { [button.id]: button, [header.id]: header, [text.id]: text },
      rootChildren: [button.id, header.id, text.id],
    };

    const ir = sceneToIR(docWithNodes);
    const result = exportIrToHtml(ir);

    // The button hint should be 'button'
    expect(result.html).toContain('<button');
    // The header hint should be 'header'
    expect(result.html).toContain('<header');
  });

  it('adds aria attributes for accessibility', () => {
    const doc = createDocument('Test');
    const button = makeFrameNode('b1', { name: 'Submit Button' });

    const docWithNodes = {
      ...doc,
      nodes: { [button.id]: button },
      rootChildren: [button.id],
    };

    const ir = sceneToIR(docWithNodes);
    const result = exportIrToHtml(ir);

    expect(result.html).toContain('aria-label');
  });

  it('reports fidelity warnings from the IR', () => {
    const doc = createDocument('Test');
    const ir = sceneToIR(doc);

    const result = exportIrToHtml(ir);
    expect(result.warnings).toBeDefined();
  });
});
