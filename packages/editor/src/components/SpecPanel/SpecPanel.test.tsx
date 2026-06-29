// @vitest-environment jsdom

import { createDocument, makeShapeNode } from '@strata/scene';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SpecPanel } from './SpecPanel';

describe('SpecPanel', () => {
  it('renders node name and kind', () => {
    const doc = createDocument('Test');
    const node = makeShapeNode(
      'n1',
      { kind: 'rect', x: 0, y: 0, w: 200, h: 100 },
      {
        name: 'Test Rect',
        transform: [1, 0, 0, 1, 100, 200],
        fill: [57, 208, 198, 255],
      },
    );
    const { container } = render(<SpecPanel nodes={[node]} doc={doc} />);
    expect(container.querySelector('.spec-panel__name')?.textContent).toBe('Test Rect');
    expect(container.querySelector('.spec-panel__kind')?.textContent).toBe('shape');
  });

  it('shows section placeholders', () => {
    const doc = createDocument('Test');
    const node = makeShapeNode(
      'n2',
      { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
      {
        name: 'Rect',
        fill: [0, 0, 0, 255],
      },
    );
    const { container } = render(<SpecPanel nodes={[node]} doc={doc} />);
    const sections = container.querySelectorAll('.spec-panel__section');
    expect(sections.length).toBeGreaterThanOrEqual(1);
  });

  it('returns null for empty nodes', () => {
    const doc = createDocument('Test');
    const { container } = render(<SpecPanel nodes={[]} doc={doc} />);
    expect(container.innerHTML).toBe('');
  });
});
