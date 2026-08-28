// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OutputResolutionPanel } from './OutputResolutionPanel';

afterEach(cleanup);

describe('OutputResolutionPanel', () => {
  it('keeps saved preset resolution by default', () => {
    render(<OutputResolutionPanel value={null} onChange={() => {}} />);
    expect(screen.getByLabelText("Use each preset's resolution")).toBeChecked();
    expect(screen.queryByLabelText('Temporary raster output resolution in PPI')).toBeNull();
  });

  it('applies a temporary PPI override without mutating presets', () => {
    const onChange = vi.fn();
    render(<OutputResolutionPanel value={null} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Override raster outputs'));
    expect(onChange).toHaveBeenLastCalledWith(300);
  });

  it('allows an accessible custom PPI value', () => {
    const onChange = vi.fn();
    render(<OutputResolutionPanel value={300} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Temporary raster output resolution in PPI'), {
      target: { value: '600' },
    });
    expect(onChange).toHaveBeenLastCalledWith(600);
  });

  it('offers common PPI values without changing the saved preset', () => {
    const onChange = vi.fn();
    render(<OutputResolutionPanel value={300} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: '600 PPI' }));

    expect(onChange).toHaveBeenLastCalledWith(600);
    expect(screen.getByRole('button', { name: '300 PPI' })).toHaveAttribute('aria-pressed', 'true');
  });
});
