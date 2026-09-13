// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { getFontRegistry } from '@varve/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FontBrowser } from './FontBrowser';

afterEach(cleanup);

describe('FontBrowser', () => {
  it('treats a family search as an exact catalog search and keeps selection for inspection', () => {
    const onSelect = vi.fn();
    render(<FontBrowser layout="modal" showDownloadable onSelect={onSelect} />);

    const search = screen.getByRole('searchbox', {
      name: 'Search fonts by name or design language',
    });
    fireEvent.change(search, { target: { value: 'gothic' } });

    const gothicButton = screen
      .getAllByRole('button')
      .find(
        (button) =>
          button.classList.contains('font-browser__select-btn') &&
          button.textContent?.includes('Gothic A1'),
      );
    expect(gothicButton).toBeVisible();
    const adaminaButton = screen
      .getAllByRole('button')
      .find(
        (button) =>
          button.classList.contains('font-browser__select-btn') &&
          button.textContent?.includes('Adamina'),
      );
    expect(adaminaButton).toBeUndefined();

    fireEvent.click(gothicButton!);

    expect(screen.getByRole('heading', { name: 'Gothic A1' })).toBeVisible();
    expect(screen.getByLabelText('Preview text')).toHaveValue(
      'The quick brown fox jumps over the lazy dog',
    );
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('updates the live specimen without applying the family to the document', () => {
    const onSelect = vi.fn();
    render(
      <FontBrowser
        layout="modal"
        showDownloadable
        selectedFamily="Gothic A1"
        onSelect={onSelect}
      />,
    );

    const specimenInput = screen.getByLabelText('Preview text');
    fireEvent.change(specimenInput, { target: { value: 'Varve specimen 123' } });

    expect(screen.getByText('Varve specimen 123')).toBeVisible();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('keeps an exact family visible when its catalog search terms are also semantic filters', () => {
    render(<FontBrowser layout="modal" showDownloadable selectedFamily="IBM Plex Sans Variable" />);

    const search = screen.getByRole('searchbox', {
      name: 'Search fonts by name or design language',
    });
    fireEvent.change(search, { target: { value: 'IBM Plex Sans Variable' } });

    const exactRow = screen
      .getAllByRole('button')
      .find(
        (button) =>
          button.classList.contains('font-browser__select-btn') &&
          button.textContent?.includes('IBM Plex Sans Variable'),
      );
    expect(exactRow).toBeVisible();

    const familyRows = screen
      .getAllByRole('button')
      .filter((button) => button.classList.contains('font-browser__select-btn'));
    expect(new Set(familyRows.map((button) => button.textContent)).size).toBe(familyRows.length);
  });

  it('marks a family as a favorite without applying it to the document', () => {
    const onSelect = vi.fn();
    render(<FontBrowser layout="modal" showDownloadable onSelect={onSelect} />);

    fireEvent.change(
      screen.getByRole('searchbox', { name: 'Search fonts by name or design language' }),
      {
        target: { value: 'gothic' },
      },
    );
    const favorite = screen.getByRole('button', { name: 'Add Gothic A1 to favorites' });
    fireEvent.click(favorite);

    expect(screen.getByRole('button', { name: 'Remove Gothic A1 from favorites' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Remove Gothic A1 from favorites' }));
    expect(screen.getByRole('button', { name: 'Add Gothic A1 to favorites' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('exposes local font discovery as an explicit action', async () => {
    render(<FontBrowser layout="modal" showDownloadable />);

    const refresh = screen.getByRole('button', { name: 'Refresh local fonts' });
    expect(refresh).toBeVisible();
    expect(screen.queryByText(/local (families|family) ready/i)).not.toBeInTheDocument();

    fireEvent.click(refresh);
    expect(
      await screen.findByText('Local font access is unavailable; using the compatibility list'),
    ).toBeVisible();
  });

  it('resets search and source or semantic filters in one action', () => {
    render(<FontBrowser layout="modal" showDownloadable />);

    const search = screen.getByRole('searchbox', {
      name: 'Search fonts by name or design language',
    });
    fireEvent.change(search, { target: { value: 'gothic' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Favorites' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Semantic font filter' }), {
      target: { value: 'variable' },
    });

    const reset = screen.getByRole('button', { name: 'Reset font browser filters' });
    expect(reset).toBeVisible();
    fireEvent.click(reset);

    expect(search).toHaveValue('');
    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('combobox', { name: 'Semantic font filter' })).toHaveValue('all');
    expect(
      screen.queryByRole('button', { name: 'Reset font browser filters' }),
    ).not.toBeInTheDocument();
  });

  it('applies the exact registered face chosen from an expanded family', () => {
    const onSelectFace = vi.fn();
    render(
      <FontBrowser
        layout="modal"
        showDownloadable
        selectedFamily="IBM Plex Sans Variable"
        onSelectFace={onSelectFace}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Expand IBM Plex Sans Variable faces' }));
    const boldFace = screen
      .getAllByRole('button', { name: /700 normal/ })
      .find((button) => button.classList.contains('font-browser__face-row'));
    expect(boldFace).toBeTruthy();

    fireEvent.click(boldFace!);
    fireEvent.click(screen.getByRole('button', { name: 'Use IBM Plex Sans Variable face' }));

    expect(onSelectFace).toHaveBeenCalledWith(
      expect.objectContaining({
        family: 'IBM Plex Sans Variable',
        weight: 700,
        style: 'normal',
      }),
    );
  });

  it('exposes real named variable instances with their authored coordinates', () => {
    const entry = getFontRegistry().getEntries('IBM Plex Sans Variable')[0];
    expect(entry).toBeTruthy();
    entry!.namedInstances = [
      { name: 'Text', coordinates: { wght: 400, wdth: 100 } },
      { name: 'Display', coordinates: { wght: 600, wdth: 92 } },
    ];
    const onSelectFace = vi.fn();
    render(
      <FontBrowser
        layout="modal"
        showDownloadable
        selectedFamily="IBM Plex Sans Variable"
        onSelectFace={onSelectFace}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Expand IBM Plex Sans Variable faces' }));
    const display = screen.getByRole('button', { name: /Display.*600 normal/ });
    fireEvent.click(display);
    fireEvent.click(screen.getByRole('button', { name: 'Use IBM Plex Sans Variable face' }));

    expect(onSelectFace).toHaveBeenCalledWith(
      expect.objectContaining({
        namedInstanceName: 'Display',
        variableAxes: { wght: 600, wdth: 92 },
        weight: 600,
      }),
    );
    entry!.namedInstances = undefined;
  });

  it('edits supported variable axes in the preview and applies the chosen values explicitly', () => {
    const onSelectFace = vi.fn();
    render(
      <FontBrowser
        layout="modal"
        showDownloadable
        selectedFamily="IBM Plex Sans Variable"
        onSelectFace={onSelectFace}
      />,
    );

    const weight = screen.getByRole('slider', { name: 'Weight (wght)' });
    expect(weight).toHaveAttribute('min', '100');
    expect(weight).toHaveAttribute('max', '700');
    expect(weight).toHaveValue('400');
    expect(screen.getByText('Variable axes')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled();

    fireEvent.change(weight, { target: { value: '650' } });

    expect(weight).toHaveValue('650');
    expect(onSelectFace).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Reset' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Use IBM Plex Sans Variable face' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Use IBM Plex Sans Variable face' }));
    expect(onSelectFace).toHaveBeenCalledWith(
      expect.objectContaining({
        family: 'IBM Plex Sans Variable',
        weight: 650,
        variableAxes: expect.objectContaining({ wght: 650 }),
      }),
    );
  });

  it('resets custom variable axes to the face defaults without applying a change', () => {
    const onSelectFace = vi.fn();
    render(
      <FontBrowser
        layout="modal"
        showDownloadable
        selectedFamily="IBM Plex Sans Variable"
        onSelectFace={onSelectFace}
      />,
    );

    const weight = screen.getByRole('slider', { name: 'Weight (wght)' });
    fireEvent.change(weight, { target: { value: '650' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

    expect(weight).toHaveValue('400');
    expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled();
    expect(onSelectFace).not.toHaveBeenCalled();
  });
});
