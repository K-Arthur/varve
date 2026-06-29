// @vitest-environment jsdom

import { createDocument, makeShapeNode } from '@strata/scene';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MeasurementReadout } from './MeasurementReadout';

describe('MeasurementReadout', () => {
  it('renders width and height', () => {
    const doc = createDocument('Test');
    const node = makeShapeNode(
      'n1',
      { kind: 'rect', x: 0, y: 0, w: 200, h: 100 },
      {
        name: 'R1',
        transform: [1, 0, 0, 1, 50, 60],
      },
    );
    const { container } = render(
      <MeasurementReadout node={node} doc={doc} unit="px" baseFontSize={16} />,
    );
    const rows = container.querySelectorAll('.spec-row');
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const values = container.querySelectorAll('.spec-row__value');
    expect(values.length).toBeGreaterThanOrEqual(2);
  });

  it('converts unit to rem', () => {
    const doc = createDocument('Test');
    const node = makeShapeNode(
      'n1',
      { kind: 'rect', x: 0, y: 0, w: 32, h: 16 },
      {
        name: 'R1',
      },
    );
    const { container } = render(
      <MeasurementReadout node={node} doc={doc} unit="rem" baseFontSize={16} />,
    );
    const values = container.querySelectorAll('.spec-row__value');
    expect(values[0]?.textContent).toBe('2rem');
    expect(values[1]?.textContent).toBe('1rem');
  });
});
