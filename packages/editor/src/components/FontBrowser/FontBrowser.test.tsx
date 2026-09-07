// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
});
