// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { defaultBrushPreset } from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';
import { BrushEditor } from './BrushEditor';

describe('BrushEditor accumulation', () => {
  it('saves stroke-opacity as part of a brush preset', () => {
    const onSave = vi.fn();
    render(
      <BrushEditor
        preset={{ ...defaultBrushPreset('custom-wash', 'Custom Wash'), id: 'custom-wash' }}
        onSave={onSave}
      />,
    );

    fireEvent.change(screen.getByLabelText('Accumulation'), {
      target: { value: 'stroke-opacity' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ accumulation: 'stroke-opacity' }),
    );
  });
});
