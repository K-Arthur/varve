/**
 * Gradient preset browser + import dialog tests.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import type { GradientPreset } from '@varve/scene';
import { makeGradientPreset } from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';
import { GradientImportDialog } from './GradientImportDialog';
import { GradientMapPresetBrowser } from './GradientMapPresetBrowser';

const rgb = (r: number, g = r, b = r) => ({ space: 'rgb' as const, r, g, b, a: 255 });

function preset(
  name: string,
  id: string,
  color: number,
  opts: Partial<GradientPreset> = {},
): GradientPreset {
  return makeGradientPreset({
    id,
    name,
    colorStops: [
      { position: 0, color: rgb(0) },
      { position: 1, color: rgb(color) },
    ],
    ...opts,
  });
}

describe('GradientMapPresetBrowser', () => {
  it('lists presets and selects on click', () => {
    const onSelect = vi.fn();
    const a = preset('Alpha', 'gpreset-a', 40);
    const b = preset('Beta', 'gpreset-b', 200);
    render(
      <GradientMapPresetBrowser
        presets={[a, b]}
        favoriteIds={new Set()}
        recentIds={[]}
        onSelect={onSelect}
      />,
    );
    expect(screen.getByRole('option', { name: /Alpha/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: /Alpha/ }));
    expect(onSelect).toHaveBeenCalledWith(a);
  });

  it('filters by search query', () => {
    render(
      <GradientMapPresetBrowser
        presets={[preset('Alpha', 'a', 40), preset('Beta', 'b', 200)]}
        favoriteIds={new Set()}
        recentIds={[]}
        onSelect={() => undefined}
      />,
    );
    const search = screen.getByPlaceholderText('Search presets');
    fireEvent.change(search, { target: { value: 'bet' } });
    expect(screen.queryByRole('option', { name: /Alpha/ })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Beta/ })).toBeInTheDocument();
  });

  it('filters by favorites', () => {
    render(
      <GradientMapPresetBrowser
        presets={[preset('Alpha', 'a', 40), preset('Beta', 'b', 200)]}
        favoriteIds={new Set(['a'])}
        recentIds={[]}
        onSelect={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /favorites/i }));
    expect(screen.getByRole('option', { name: /Alpha/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Beta/ })).not.toBeInTheDocument();
  });

  it('shows read-only badges for unsupported presets', () => {
    const noisy = preset('Noise', 'n', 40, {
      kind: 'noise',
      compatibility: { status: 'unsupported', message: 'noise gradient imported as read-only' },
    });
    render(
      <GradientMapPresetBrowser
        presets={[noisy]}
        favoriteIds={new Set()}
        recentIds={[]}
        onSelect={() => undefined}
      />,
    );
    expect(screen.getByText('Read-only')).toBeInTheDocument();
  });

  it('supports keyboard activation via Enter', () => {
    const onSelect = vi.fn();
    const a = preset('Alpha', 'a', 40);
    render(
      <GradientMapPresetBrowser
        presets={[a]}
        favoriteIds={new Set()}
        recentIds={[]}
        onSelect={onSelect}
      />,
    );
    const list = screen.getByRole('listbox');
    list.focus();
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(list, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(a);
  });
});

describe('GradientImportDialog', () => {
  it('shows discovered presets with selection and warnings', () => {
    const onImport = vi.fn();
    const onClose = vi.fn();
    render(
      <GradientImportDialog
        open
        fileName="test.grd"
        presets={[
          preset('Alpha', 'a', 40),
          preset('Noise', 'n', 40, {
            kind: 'noise',
            compatibility: { status: 'unsupported', message: 'read-only' },
          }),
        ]}
        warnings={['Noise gradient "Noise" imported as read-only']}
        duplicateCount={0}
        onClose={onClose}
        onImport={onImport}
      />,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/2 gradients found/)).toBeInTheDocument();
    expect(screen.getAllByText(/read-only/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/imported as read-only/i)).toBeInTheDocument();

    // Select the first preset and confirm.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Alpha' }));
    const importButtons = screen.getAllByRole('button', { name: /import/i });
    fireEvent.click(importButtons[importButtons.length - 1]!);
    expect(onImport).toHaveBeenCalledWith([expect.objectContaining({ id: 'a' })], 'library');
    expect(onClose).toHaveBeenCalled();
  });

  it('disables confirm when nothing is selected', () => {
    render(
      <GradientImportDialog
        open
        presets={[preset('Alpha', 'a', 40)]}
        warnings={[]}
        duplicateCount={0}
        onClose={() => undefined}
        onImport={() => undefined}
      />,
    );
    const confirm = screen.getByRole('button', { name: /import.*preset/i });
    expect(confirm).toBeDisabled();
  });

  it('reports duplicate counts', () => {
    render(
      <GradientImportDialog
        open
        presets={[preset('Alpha', 'a', 40)]}
        warnings={[]}
        duplicateCount={2}
        onClose={() => undefined}
        onImport={() => undefined}
      />,
    );
    expect(screen.getByText(/2 presets already in your library/i)).toBeInTheDocument();
  });
});
