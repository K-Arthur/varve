/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RasterizeDialog } from './RasterizeDialog';

vi.mock('@varve/ui', () => ({
  Dialog: ({
    open,
    title,
    children,
  }: {
    open: boolean;
    title: string;
    children: React.ReactNode;
  }) =>
    open ? (
      <div role="dialog" aria-label={title}>
        {children}
      </div>
    ) : null,
}));

describe('RasterizeDialog', () => {
  it('offers common PPI values and defaults to a non-destructive transparent raster', () => {
    render(<RasterizeDialog open selectionCount={2} onClose={vi.fn()} onRasterize={vi.fn()} />);

    expect(screen.getByRole('dialog', { name: 'Rasterize' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '300 PPI' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Keep original editable layers (hidden)')).toBeChecked();
    expect(screen.getByLabelText('Background')).toHaveValue('transparent');
  });

  it('submits explicit options and allows replacing the source', () => {
    const onRasterize = vi.fn();
    render(<RasterizeDialog open selectionCount={1} onClose={vi.fn()} onRasterize={onRasterize} />);

    fireEvent.click(screen.getByRole('button', { name: '600 PPI' }));
    fireEvent.click(screen.getByLabelText('Keep original editable layers (hidden)'));
    fireEvent.click(screen.getByLabelText('Include visible effect overflow'));
    fireEvent.change(screen.getByLabelText('Background'), { target: { value: 'white' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rasterize' }));

    expect(onRasterize).toHaveBeenCalledWith({
      dpi: 600,
      includeEffectOverflow: false,
      background: 'white',
      keepOriginal: false,
    });
  });
});
