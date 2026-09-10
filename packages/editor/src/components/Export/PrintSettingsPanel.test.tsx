// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PrintOptions } from '@varve/scene';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrintSettingsPanel } from './PrintSettingsPanel';

afterEach(cleanup);

function makePrint(overrides: Partial<PrintOptions> = {}): PrintOptions {
  return {
    bleedMm: 3,
    includeCropMarks: true,
    includeRegistrationMarks: true,
    includeColorBars: false,
    enforceDpi: 300,
    outlineText: false,
    ...overrides,
  };
}

describe('PrintSettingsPanel', () => {
  it('renders all press controls with accessible labels', () => {
    render(<PrintSettingsPanel value={makePrint()} onChange={() => {}} standard="pdf-x4" />);
    expect(screen.getByText('Press / print settings (PDF/X-4)')).toBeTruthy();
    expect(screen.getByLabelText('Bleed in millimetres')).toBeTruthy();
    expect(screen.getByLabelText('Minimum effective image resolution in DPI')).toBeTruthy();
    expect(screen.getByLabelText('Crop marks')).toBeTruthy();
    expect(screen.getByLabelText('Registration marks')).toBeTruthy();
    expect(screen.getByLabelText('Color bars')).toBeTruthy();
    expect(screen.getByLabelText('Convert text to outlines')).toBeTruthy();
  });

  it('updates bleed and clamps to the supported range', () => {
    const onChange = vi.fn();
    render(<PrintSettingsPanel value={makePrint()} onChange={onChange} standard="pdf-x4" />);
    const bleed = screen.getByLabelText('Bleed in millimetres');
    fireEvent.change(bleed, { target: { value: '12.5' } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ bleedMm: 12.5 }));
  });

  it('updates the resolution floor', () => {
    const onChange = vi.fn();
    render(<PrintSettingsPanel value={makePrint()} onChange={onChange} standard="pdf-x4" />);
    const dpi = screen.getByLabelText('Minimum effective image resolution in DPI');
    fireEvent.change(dpi, { target: { value: '600' } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ enforceDpi: 600 }));
  });

  it('toggles marks and outline text', () => {
    const onChange = vi.fn();
    render(<PrintSettingsPanel value={makePrint()} onChange={onChange} standard="pdf-x4" />);
    fireEvent.click(screen.getByLabelText('Color bars'));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ includeColorBars: true }));
    fireEvent.click(screen.getByLabelText('Convert text to outlines'));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ outlineText: true }));
  });

  it('explains the Fogra39 conversion instead of exposing an ignored selector', () => {
    render(<PrintSettingsPanel value={makePrint()} onChange={() => {}} standard="pdf-x1a" />);
    expect(screen.getByText(/Fogra39/)).toBeTruthy();
  });
});
