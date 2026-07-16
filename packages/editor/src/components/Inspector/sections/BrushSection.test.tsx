// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EditorProvider } from '../../../context';
import { BrushSection } from './BrushSection';

describe('BrushSection', () => {
  it('shows the full raster brush controls for the paint tool', () => {
    render(
      <EditorProvider>
        <BrushSection tool="paint" />
      </EditorProvider>,
    );
    expect(screen.getAllByText('Brush').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Brush preset')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Size/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Opacity/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Flow/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Hardness/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Spacing/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Smoothing/)).toBeInTheDocument();
  });

  it('shows only a stabilization control for the pencil tool, not raster brush concepts', () => {
    render(
      <EditorProvider>
        <BrushSection tool="pencil" />
      </EditorProvider>,
    );
    expect(screen.getAllByText('Pencil').length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/^Stabilization/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Brush preset')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Size/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Opacity/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Flow/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Hardness/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Spacing/)).not.toBeInTheDocument();
  });

  it('shows eraser-specific heading for the eraser tool', () => {
    render(
      <EditorProvider>
        <BrushSection tool="eraser" />
      </EditorProvider>,
    );
    expect(screen.getAllByText('Eraser').length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/^Spacing/)).toBeInTheDocument();
  });
});
