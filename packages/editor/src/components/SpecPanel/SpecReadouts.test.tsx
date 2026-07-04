// @vitest-environment jsdom

import { createDocument, makeShapeNode, makeTextNode } from '@strata/scene';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SpecReadouts } from './SpecReadouts';

describe('SpecReadouts', () => {
  it('renders layout section for a shape node', () => {
    const doc = createDocument('Test');
    const node = makeShapeNode(
      'n1',
      { kind: 'rect', x: 10, y: 20, w: 200, h: 100 },
      {
        name: 'R1',
        transform: [1, 0, 0, 1, 50, 60],
      },
    );
    const { container } = render(
      <SpecReadouts node={node} doc={doc} unit="px" baseFontSize={16} />,
    );
    const headings = container.querySelectorAll('h3');
    const headingTexts = Array.from(headings).map((h) => h.textContent);
    expect(headingTexts).toContain('Layout');
    expect(headingTexts).toContain('Color & Fill');
    expect(headingTexts).toContain('Content');
  });

  it('renders typography section for text node', () => {
    const doc = createDocument('Test');
    const node = makeTextNode('n1', 'Hello World', {
      fontSize: 16,
      name: 'T1',
    });
    const { container } = render(
      <SpecReadouts node={node} doc={doc} unit="px" baseFontSize={16} />,
    );
    const headings = container.querySelectorAll('h3');
    const headingTexts = Array.from(headings).map((h) => h.textContent);
    expect(headingTexts).toContain('Typography');
  });

  it('shows color swatch and hex value', () => {
    const doc = createDocument('Test');
    const node = makeShapeNode(
      'n1',
      { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
      {
        name: 'R1',
        fill: { space: 'rgb' as const, r: 57, g: 208, b: 198, a: 255 },
      },
    );
    const { container } = render(
      <SpecReadouts node={node} doc={doc} unit="px" baseFontSize={16} />,
    );
    const swatches = container.querySelectorAll('.spec-swatch');
    expect(swatches.length).toBe(1);
    const hex = container.querySelectorAll('.spec-row__value');
    const hexValues = Array.from(hex).map((el) => el.textContent);
    const hasHex = hexValues.some((v) => v?.includes('#39d0c6'));
    expect(hasHex).toBe(true);
  });
});
